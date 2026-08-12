from __future__ import annotations

import argparse
import json
import time
from collections.abc import Callable, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

import psycopg

from backtest.ingestion import ingestion_window
from backtest.ingestion_repository import (
    PostgresRequestRepository,
    QueuedIngestionRequest,
)
from backtest.providers import ProviderUnavailableError
from backtest.publication import PreparedDatasetPublication, prepare_dataset_publication
from backtest.snapshots import ActiveSnapshot, merge_snapshot
from ingest_market_data import (
    load_database_url,
    provider_for_code,
    psycopg_connection_url,
    read_bounded_environment_integer,
)


APPROVED_PROVIDER_CODES = frozenset(
    {"binance-public", "msn-via-vnstock", "vnstock-vci-free"}
)


class RequestRepository(Protocol):
    def claim_next_request(self) -> QueuedIngestionRequest | None: ...

    def load_active(self, request: QueuedIngestionRequest) -> ActiveSnapshot | None: ...

    def publish(
        self, request: QueuedIngestionRequest, prepared: PreparedDatasetPublication
    ) -> Any: ...

    def complete_request(
        self, request: QueuedIngestionRequest, dataset_version_id: str
    ) -> None: ...

    def retry_or_fail(self, request: QueuedIngestionRequest, code: str) -> None: ...

    def fail_request(self, request: QueuedIngestionRequest, code: str) -> None: ...


def _prepare_request_dataset(
    request: QueuedIngestionRequest,
    repository: RequestRepository,
    provider_factory: Callable[[str], Any],
    now: datetime,
) -> PreparedDatasetPublication:
    if request.timeframe not in {"1h", "1d"}:
        raise ValueError("Unsupported ingestion timeframe.")
    active = repository.load_active(request)
    window = ingestion_window(request.timeframe, now=now, active=active)
    provider = provider_factory(request.provider_code)
    incoming = provider.fetch(
        symbol=request.provider_symbol,
        asset=request.asset,
        timeframe=request.timeframe,
        start=window.fetch_start,
        end=window.fetch_end,
        now=now,
    )
    if not incoming:
        raise ValueError("Provider returned no closed bars.")
    if active is None or active.is_fixture:
        rows = incoming
    else:
        rows = merge_snapshot(
            active.rows,
            incoming,
            overlap_start=window.overlap_start,
        )
    fallback_source = next(
        (row.source for row in rows if row.source.startswith("ccxt:")), None
    )
    return prepare_dataset_publication(
        rows,
        market=request.market,
        provider_code=request.provider_code,
        provider_name=request.provider_name,
        provider_symbol=request.provider_symbol,
        canonical_key=request.canonical_key,
        asset_name=request.asset_name,
        currency=request.currency,
        venue=request.venue or "OTC",
        timezone_name=request.timezone_name,
        maximum_leverage=request.maximum_leverage,
        terms_url=request.terms_url,
        source_metadata={
            "mode": "live",
            "licenseScope": "research_only",
            "provider": request.provider_code,
            "providerSymbol": request.provider_symbol,
            "fallbackProvider": fallback_source,
        },
    )


def process_next_ingestion_request(
    repository: RequestRepository,
    provider_factory: Callable[[str], Any],
    *,
    now: datetime | None = None,
) -> dict[str, str]:
    request = repository.claim_next_request()
    if request is None:
        return {"status": "idle"}
    if request.provider_code not in APPROVED_PROVIDER_CODES:
        repository.fail_request(request, "PROVIDER_NOT_APPROVED")
        return {
            "status": "failed",
            "id": request.id,
            "code": "PROVIDER_NOT_APPROVED",
        }

    try:
        prepared = _prepare_request_dataset(
            request,
            repository,
            provider_factory,
            now or datetime.now(timezone.utc),
        )
        publication = repository.publish(request, prepared)
        repository.complete_request(request, publication.dataset_version_id)
        return {
            "status": "succeeded",
            "id": request.id,
            "datasetVersionId": publication.dataset_version_id,
        }
    except ProviderUnavailableError:
        repository.retry_or_fail(request, "PROVIDER_UNAVAILABLE")
        return {
            "status": "failed",
            "id": request.id,
            "code": "PROVIDER_UNAVAILABLE",
        }
    except ValueError:
        repository.fail_request(request, "INGESTION_INVALID")
        return {
            "status": "failed",
            "id": request.id,
            "code": "INGESTION_INVALID",
        }
    except Exception:
        repository.retry_or_fail(request, "INGESTION_FAILED")
        return {
            "status": "failed",
            "id": request.id,
            "code": "INGESTION_FAILED",
        }


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Process queued market ingestion requests.")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--poll-seconds", type=float, default=5.0)
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    connection_factory: Callable[..., Any] = psycopg.connect,
) -> int:
    args = _argument_parser().parse_args(argv)
    if not 1 <= args.limit <= 20 or args.poll_seconds <= 0 or args.poll_seconds > 60:
        print(json.dumps({"status": "fatal", "errorCode": "configuration_error"}))
        return 2
    try:
        max_pages = read_bounded_environment_integer(
            "MARKET_INGEST_MAX_PAGES", default=128, minimum=1, maximum=512
        )
        max_rows = read_bounded_environment_integer(
            "MARKET_INGEST_MAX_ROWS", default=100_000, minimum=100, maximum=250_000
        )
        database_url = psycopg_connection_url(load_database_url(Path(args.env_file)))
        factory = lambda code: provider_for_code(code, max_pages, max_rows)
        processed = 0
        failed = 0
        with connection_factory(database_url, autocommit=True) as connection:
            repository = PostgresRequestRepository(connection)
            while True:
                batch_processed = 0
                for _ in range(args.limit):
                    outcome = process_next_ingestion_request(repository, factory)
                    if outcome["status"] == "idle":
                        break
                    batch_processed += 1
                    processed += 1
                    failed += outcome["status"] != "succeeded"
                    print(json.dumps(outcome, separators=(",", ":"), sort_keys=True))
                if not args.watch:
                    break
                if batch_processed == 0:
                    time.sleep(args.poll_seconds)
        print(
            json.dumps(
                {
                    "status": "succeeded" if failed == 0 else "partial_failure",
                    "processed": processed,
                    "failed": failed,
                },
                separators=(",", ":"),
            )
        )
        return 0 if failed == 0 else 1
    except KeyboardInterrupt:
        return 0
    except (OSError, ValueError):
        print(json.dumps({"status": "fatal", "errorCode": "configuration_error"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
