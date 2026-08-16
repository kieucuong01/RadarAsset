from __future__ import annotations

import argparse
import json
import threading
import time
from collections.abc import Callable, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

import psycopg

from backtest.ingestion import certified_active_rows, ingestion_window
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
    {
        "binance-public",
        "dukascopy-public",
        "msn-via-vnstock",
        "vnstock-kbs-free",
        "vnstock-vci-free",
    }
)


class RequestRepository(Protocol):
    lease_heartbeat_interval_seconds: float

    def heartbeat(self, current_request_id: str | None = None) -> None: ...

    def renew_lease(self, request: QueuedIngestionRequest) -> bool: ...

    def fail_exhausted_requests(self) -> int: ...

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

    def requeue_failed_requests(
        self,
        *,
        limit: int,
        error_code: str | None = None,
        provider_code: str | None = None,
    ) -> int: ...


class _LeaseHeartbeat:
    def __init__(self, repository: RequestRepository, request: QueuedIngestionRequest) -> None:
        self.repository = repository
        self.request = request
        self.stopped = threading.Event()
        self.lost = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        interval = self.repository.lease_heartbeat_interval_seconds
        while not self.stopped.wait(interval):
            try:
                if not self.repository.renew_lease(self.request):
                    self.lost.set()
                    return
            except Exception:
                self.lost.set()
                return

    def __enter__(self) -> "_LeaseHeartbeat":
        self.repository.heartbeat(self.request.id)
        self.thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self.stopped.set()
        self.thread.join()
        self.repository.heartbeat(None)


def _prepare_request_dataset(
    request: QueuedIngestionRequest,
    repository: RequestRepository,
    provider_factory: Callable[[str], Any],
    now: datetime,
) -> PreparedDatasetPublication:
    if request.timeframe != "1d":
        raise ValueError("Unsupported ingestion timeframe.")
    active = repository.load_active(request)
    window = ingestion_window(
        request.timeframe,
        now=now,
        active=active,
        market=request.market,
    )
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
            certified_active_rows(active.rows, market=request.market),
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
        repository.heartbeat(None)
        return {"status": "idle"}
    if request.provider_code not in APPROVED_PROVIDER_CODES:
        repository.fail_request(request, "PROVIDER_NOT_APPROVED")
        return {
            "status": "failed",
            "id": request.id,
            "code": "PROVIDER_NOT_APPROVED",
        }

    try:
        with _LeaseHeartbeat(repository, request) as lease:
            prepared = _prepare_request_dataset(
                request,
                repository,
                provider_factory,
                now or datetime.now(timezone.utc),
            )
            if lease.lost.is_set():
                return {
                    "status": "failed",
                    "id": request.id,
                    "code": "worker_lost",
                }
            publication = repository.publish(request, prepared)
            if lease.lost.is_set():
                return {
                    "status": "failed",
                    "id": request.id,
                    "code": "worker_lost",
                }
            repository.complete_request(request, publication.dataset_version_id)
            return {
                "status": "succeeded",
                "id": request.id,
                "datasetVersionId": publication.dataset_version_id,
            }
    except ProviderUnavailableError as error:
        repository.retry_or_fail(request, error.code)
        return {
            "status": "failed",
            "id": request.id,
            "code": error.code,
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


def process_ingestion_backlog(
    repository: RequestRepository,
    provider_factory: Callable[[str], Any],
    *,
    batch_limit: int,
    drain: bool,
    watch: bool = False,
    max_total: int,
    sleep: Callable[[float], None] = time.sleep,
    poll_seconds: float = 5.0,
    request_delay_seconds: float = 0.0,
    now: datetime | None = None,
    emit: Callable[[dict[str, str]], None] | None = None,
) -> dict[str, int | str]:
    repository.fail_exhausted_requests()
    processed = 0
    failed = 0
    while watch or processed < max_total:
        batch_processed = 0
        for _ in range(batch_limit):
            if not watch and processed >= max_total:
                break
            outcome = process_next_ingestion_request(
                repository,
                provider_factory,
                now=now,
            )
            if outcome["status"] == "idle":
                if watch:
                    break
                return {
                    "status": "succeeded" if failed == 0 else "partial_failure",
                    "processed": processed,
                    "failed": failed,
                }
            batch_processed += 1
            processed += 1
            failed += outcome["status"] != "succeeded"
            if emit is not None:
                emit(outcome)
            if request_delay_seconds > 0 and (watch or processed < max_total):
                sleep(request_delay_seconds)
        if not drain and not watch:
            break
        if batch_processed == 0:
            sleep(poll_seconds)
    return {
        "status": "succeeded" if failed == 0 else "partial_failure",
        "processed": processed,
        "failed": failed,
    }


def requeue_failed_requests(
    repository: RequestRepository,
    *,
    limit: int,
    error_code: str | None = None,
    provider_code: str | None = None,
) -> int:
    if not 1 <= limit <= 10_000:
        raise ValueError("Retry limit is outside the supported range.")
    return repository.requeue_failed_requests(
        limit=limit,
        error_code=error_code,
        provider_code=provider_code,
    )


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Process queued market ingestion requests.")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--drain", action="store_true")
    parser.add_argument("--max-total", type=int, default=500)
    parser.add_argument("--poll-seconds", type=float, default=5.0)
    parser.add_argument("--request-delay-seconds", type=float, default=1.1)
    parser.add_argument("--retry-failed", action="store_true")
    parser.add_argument("--retry-limit", type=int, default=500)
    parser.add_argument("--retry-error-code")
    parser.add_argument("--retry-provider-code", choices=tuple(sorted(APPROVED_PROVIDER_CODES)))
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    connection_factory: Callable[..., Any] = psycopg.connect,
) -> int:
    args = _argument_parser().parse_args(argv)
    if (
        not 1 <= args.limit <= 20
        or not 1 <= args.max_total <= 10_000
        or not 1 <= args.retry_limit <= 10_000
        or args.poll_seconds <= 0
        or args.poll_seconds > 60
        or args.request_delay_seconds < 0
        or args.request_delay_seconds > 60
    ):
        print(json.dumps({"status": "fatal", "errorCode": "configuration_error"}))
        return 2
    try:
        max_pages = read_bounded_environment_integer(
            "MARKET_INGEST_MAX_PAGES", default=128, minimum=1, maximum=512
        )
        max_rows = read_bounded_environment_integer(
            "MARKET_INGEST_MAX_ROWS", default=250_000, minimum=100, maximum=250_000
        )
        database_url = psycopg_connection_url(load_database_url(Path(args.env_file)))
        factory = lambda code: provider_for_code(code, max_pages, max_rows)
        with connection_factory(database_url, autocommit=True) as connection:
            repository = PostgresRequestRepository(connection)
            if args.retry_failed:
                count = requeue_failed_requests(
                    repository,
                    limit=args.retry_limit,
                    error_code=args.retry_error_code,
                    provider_code=args.retry_provider_code,
                )
                print(
                    json.dumps(
                        {"status": "requeued", "count": count},
                        separators=(",", ":"),
                    )
                )
            summary = process_ingestion_backlog(
                repository,
                factory,
                batch_limit=args.limit,
                drain=args.drain,
                watch=args.watch,
                max_total=args.max_total if args.drain else (10_000 if args.watch else args.limit),
                poll_seconds=args.poll_seconds,
                request_delay_seconds=args.request_delay_seconds,
                emit=lambda outcome: print(
                    json.dumps(outcome, separators=(",", ":"), sort_keys=True)
                ),
            )
        print(json.dumps(summary, separators=(",", ":")))
        return 0 if summary["failed"] == 0 else 1
    except KeyboardInterrupt:
        return 0
    except (OSError, ValueError):
        print(json.dumps({"status": "fatal", "errorCode": "configuration_error"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
