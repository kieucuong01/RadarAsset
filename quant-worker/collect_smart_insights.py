from __future__ import annotations

import argparse
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from decimal import Decimal
import json
import os
from pathlib import Path
import re
from typing import Any
from urllib.parse import urljoin

import psycopg
from psycopg.rows import dict_row

from smart_insights.artifacts import ArtifactStore
from smart_insights.collectors import CollectionBatch
from smart_insights.collectors.alternative_fng import AlternativeFearGreedCollector
from smart_insights.collectors.bitinfocharts import BitInfoChartsCollector
from smart_insights.collectors.coinmetrics import CoinMetricsCollector
from smart_insights.collectors.coinshares import CoinSharesCollector
from smart_insights.collectors.defillama import (
    DefiLlamaChainsCollector,
    DefiLlamaStablecoinsCollector,
)
from smart_insights.collectors.deribit import DeribitCollector
from smart_insights.collectors.farside import FarsideEtfCollector
from smart_insights.collectors.mempool import MempoolSpaceCollector
from smart_insights.contracts import SourceDefinition, SourceRunResult
from smart_insights.crypto_pipeline import run_crypto_pipeline
from smart_insights.firecrawl import FirecrawlClient
from smart_insights.http import SourceFetchError
from smart_insights.metrics.crypto import CRYPTO_METRIC_DEFINITIONS
from smart_insights.repository import PostgresInsightRepository
from smart_insights.sources import (
    SOURCE_CODES,
    is_source_url_allowed,
    source_for_code,
)
from smart_insights.validation import ObservationValidationError
from smart_insights.validation import validate_observations


SCHEDULES = (
    "daily",
    "weekly",
    "monthly",
    "calendar-current",
    "calendar-next",
    "calendar-event",
)
_SOURCE_SCHEDULE = {
    "daily": "daily",
    "weekly": "weekly",
    "monthly": "source_period",
    "calendar-current": "calendar",
    "calendar-next": "calendar",
    "calendar-event": "calendar",
}


@dataclass(frozen=True, slots=True)
class CollectionOutcome:
    source_code: str
    status: str
    records_fetched: int
    error_code: str | None


Collector = Callable[[SourceDefinition], SourceRunResult]
BatchCollector = Callable[[datetime], CollectionBatch]


@dataclass(frozen=True, slots=True)
class LiveSmokeOutcome:
    source_code: str
    status: str
    records_fetched: int
    effective_at: datetime | None
    error_code: str | None


def select_sources(
    schedule: str,
    *,
    source_code: str | None = None,
    include_disabled: bool = False,
) -> tuple[SourceDefinition, ...]:
    source_schedule = _SOURCE_SCHEDULE.get(schedule)
    if source_schedule is None:
        raise ValueError("Schedule is not supported.")
    if source_code is not None:
        if "://" in source_code:
            raise ValueError("Source must be a registered code.")
        try:
            source = source_for_code(source_code)
        except KeyError as error:
            raise ValueError("Source must be a registered code.") from error
        if source.schedule != source_schedule:
            raise ValueError("Source is not configured for this schedule.")
        return (source,)
    return tuple(
        source
        for source in (source_for_code(code) for code in SOURCE_CODES)
        if (include_disabled or source.enabled) and source.schedule == source_schedule
    )


def run_collection(
    schedule: str,
    *,
    source_code: str | None,
    dry_run: bool,
    collectors: Mapping[str, Collector],
) -> tuple[list[CollectionOutcome], int]:
    sources = select_sources(
        schedule, source_code=source_code, include_disabled=dry_run
    )
    if not sources:
        return [], 2
    outcomes: list[CollectionOutcome] = []
    for source in sources:
        if dry_run:
            outcomes.append(CollectionOutcome(source.code, "dry_run", 0, None))
            continue
        collector = collectors.get(source.code)
        if collector is None:
            outcomes.append(
                CollectionOutcome(source.code, "failed", 0, "SOURCE_NOT_IMPLEMENTED")
            )
            continue
        try:
            result = collector(source)
            outcomes.append(
                CollectionOutcome(
                    source.code,
                    result.status,
                    result.records_fetched,
                    result.error_code,
                )
            )
        except (SourceFetchError, ObservationValidationError) as error:
            outcomes.append(CollectionOutcome(source.code, "failed", 0, error.code))
        except Exception:
            outcomes.append(CollectionOutcome(source.code, "failed", 0, "INTERNAL_ERROR"))
    succeeded = {"succeeded", "unchanged", "dry_run"}
    return outcomes, 0 if all(outcome.status in succeeded for outcome in outcomes) else 1


def run_live_smoke(
    source_code: str,
    *,
    as_of: datetime,
    batch_collectors: Mapping[str, BatchCollector],
) -> LiveSmokeOutcome:
    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("Live smoke time must be timezone-aware.")
    if source_code not in SOURCE_CODES:
        raise ValueError("Source must be a registered code.")
    collector = batch_collectors.get(source_code)
    if collector is None:
        return LiveSmokeOutcome(
            source_code, "failed", 0, None, "SOURCE_NOT_IMPLEMENTED"
        )
    try:
        batch = collector(as_of)
        if batch.source.code != source_code:
            raise ValueError("Collector returned another source.")
        if batch.error_code is not None:
            return LiveSmokeOutcome(source_code, "failed", 0, None, batch.error_code)
        validated = validate_observations(batch.source, batch.observations)
    except SourceFetchError as error:
        return LiveSmokeOutcome(source_code, "failed", 0, None, error.code)
    except ObservationValidationError as error:
        return LiveSmokeOutcome(source_code, "failed", 0, None, error.code)
    except ValueError:
        return LiveSmokeOutcome(source_code, "failed", 0, None, "INVALID_RESPONSE")
    return LiveSmokeOutcome(
        source_code=source_code,
        status="succeeded",
        records_fetched=len(validated),
        effective_at=max(row.effective_at for row in validated),
        error_code=None,
    )


_COINSHARES_REPORT = re.compile(
    r"(?:https://coinshares\.com)?(?:/us)?/insights/research-data/"
    r"fund-flows-(\d{1,2})-(\d{1,2})-(\d{4})/",
    re.IGNORECASE,
)


def _discover_coinshares_report(firecrawl: FirecrawlClient) -> str:
    source = source_for_code("coinshares-weekly")
    snapshot = firecrawl.scrape(source, source.urls[0])
    try:
        payload = json.loads(snapshot.content)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SourceFetchError("INVALID_RESPONSE") from error
    markdown = payload.get("markdown") if isinstance(payload, dict) else None
    if not isinstance(markdown, str):
        raise SourceFetchError("SCHEMA_DRIFT")
    candidates: list[tuple[datetime, str]] = []
    for match in _COINSHARES_REPORT.finditer(markdown):
        try:
            report_date = datetime(
                int(match.group(3)), int(match.group(2)), int(match.group(1)),
                tzinfo=timezone.utc,
            )
        except ValueError:
            continue
        url = urljoin("https://coinshares.com", match.group(0))
        if is_source_url_allowed(source, url):
            candidates.append((report_date, url))
    if not candidates:
        raise SourceFetchError("SCHEMA_DRIFT")
    return max(candidates, key=lambda row: (row[0], row[1]))[1]


def _previous_large_address_balances(
    repository: PostgresInsightRepository | None, as_of: datetime
) -> dict[str, Decimal]:
    if repository is None:
        return {}
    current_date = as_of.astimezone(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    rows = tuple(
        row
        for row in repository.metric_observations(
            "crypto.large_address.address_balance_btc", as_of=as_of
        )
        if row.effective_at < current_date and row.dimensions.get("address")
    )
    if not rows:
        return {}
    previous_date = max(row.effective_at for row in rows)
    return {
        row.dimensions["address"]: row.value
        for row in rows
        if row.effective_at == previous_date
    }


def build_batch_collectors(
    repository: PostgresInsightRepository | None = None,
) -> Mapping[str, BatchCollector]:
    firecrawl = FirecrawlClient(
        os.getenv("FIRECRAWL_API_URL", "http://127.0.0.1:3002"),
        api_key=os.getenv("FIRECRAWL_API_KEY"),
    )

    def coinshares(as_of: datetime) -> CollectionBatch:
        report_url = _discover_coinshares_report(firecrawl)
        return CoinSharesCollector(
            firecrawl=firecrawl, report_url=report_url
        ).collect(as_of)

    def bitinfocharts(as_of: datetime) -> CollectionBatch:
        previous = _previous_large_address_balances(repository, as_of)
        return BitInfoChartsCollector(firecrawl=firecrawl).collect(
            as_of,
            previous_balances=previous or None,
        )

    return {
        "alternative-fng": lambda as_of: AlternativeFearGreedCollector().collect(as_of),
        "farside-btc-etf": lambda as_of: FarsideEtfCollector(
            "BTC", firecrawl=firecrawl
        ).collect(as_of),
        "farside-eth-etf": lambda as_of: FarsideEtfCollector(
            "ETH", firecrawl=firecrawl
        ).collect(as_of),
        "farside-sol-etf": lambda as_of: FarsideEtfCollector(
            "SOL", firecrawl=firecrawl
        ).collect(as_of),
        "coinmetrics-community": lambda as_of: CoinMetricsCollector().collect(as_of),
        "mempool-space": lambda as_of: MempoolSpaceCollector().collect(as_of),
        "defillama-stablecoins": lambda as_of: DefiLlamaStablecoinsCollector().collect(as_of),
        "defillama-chains": lambda as_of: DefiLlamaChainsCollector().collect(as_of),
        "deribit-public": lambda as_of: DeribitCollector().collect(as_of),
        "coinshares-weekly": coinshares,
        "bitinfocharts-top-addresses": bitinfocharts,
    }


def build_production_collectors(
    repository: PostgresInsightRepository,
    artifact_store: ArtifactStore,
    batch_collectors: Mapping[str, BatchCollector],
    *,
    clock: Callable[[], datetime] | None = None,
) -> Mapping[str, Collector]:
    now = clock or (lambda: datetime.now(timezone.utc))
    collectors: dict[str, Collector] = {}
    for source_code, batch_collector in batch_collectors.items():
        def collect(
            source: SourceDefinition,
            *,
            collector: BatchCollector = batch_collector,
            expected_code: str = source_code,
        ) -> SourceRunResult:
            started_at = now()
            if source.code != expected_code:
                raise ValueError("Collector source does not match its registry code.")
            batch = collector(started_at)
            artifact = artifact_store.write(batch.snapshot, source.code)
            if not batch.observations:
                error_code = batch.error_code or "MISSING_REQUIRED_FIELD"
                repository.quarantine(
                    source, batch.snapshot, artifact, error_code=error_code
                )
                return SourceRunResult(
                    source.code,
                    "quarantined",
                    0,
                    error_code,
                    0,
                    started_at,
                    now(),
                )
            publication = repository.publish(
                source, batch.snapshot, artifact, batch.observations
            )
            return SourceRunResult(
                source.code,
                publication.status,
                len(batch.observations),
                batch.error_code,
                0,
                started_at,
                now(),
            )

        collectors[source_code] = collect
    return collectors


def load_environment(env_file: Path) -> None:
    if not env_file.exists():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if not name or not name.replace("_", "").isalnum() or name[0].isdigit():
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if "\n" not in value and "\r" not in value:
            os.environ.setdefault(name, value)


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Collect registered Smart Insights sources.")
    parser.add_argument("schedule", choices=SCHEDULES)
    parser.add_argument("--source")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--live-smoke", action="store_true")
    parser.add_argument("--env-file", default=".env.local")
    return parser


def _emit(outcomes: Sequence[CollectionOutcome], exit_code: int) -> None:
    for outcome in outcomes:
        print(json.dumps(asdict(outcome), separators=(",", ":"), sort_keys=True))
    print(
        json.dumps(
            {
                "failed": sum(outcome.status == "failed" for outcome in outcomes),
                "selected": len(outcomes),
                "status": "ok" if exit_code == 0 else "error",
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


def _emit_smoke(outcome: LiveSmokeOutcome) -> None:
    print(
        json.dumps(
            {
                "effectiveAt": (
                    outcome.effective_at.isoformat()
                    if outcome.effective_at is not None
                    else None
                ),
                "errorCode": outcome.error_code,
                "recordsFetched": outcome.records_fetched,
                "sourceCode": outcome.source_code,
                "status": outcome.status,
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


def main(
    argv: Sequence[str] | None = None,
    *,
    collectors: Mapping[str, Collector] | None = None,
    smoke_collectors: Mapping[str, BatchCollector] | None = None,
) -> int:
    args = _argument_parser().parse_args(argv)
    load_environment(Path(args.env_file))
    if args.live_smoke:
        if args.dry_run or not args.source:
            return 2
        try:
            outcome = run_live_smoke(
                args.source,
                as_of=datetime.now(timezone.utc),
                batch_collectors=smoke_collectors or build_batch_collectors(),
            )
        except ValueError:
            return 2
        _emit_smoke(outcome)
        return 0 if outcome.status == "succeeded" else 1

    connection: psycopg.Connection[Any] | None = None
    try:
        active_collectors = collectors
        repository: PostgresInsightRepository | None = None
        if active_collectors is None and not args.dry_run:
            database_url = os.getenv("DATABASE_URL")
            if not database_url:
                raise ValueError("DATABASE_URL is required.")
            connection = psycopg.connect(
                database_url, autocommit=True, row_factory=dict_row
            )
            repository = PostgresInsightRepository(connection)
            repository.upsert_metric_definitions(CRYPTO_METRIC_DEFINITIONS)
            artifact_store = ArtifactStore(
                Path(
                    os.getenv(
                        "SMART_INSIGHTS_ARTIFACT_ROOT",
                        ".local-data/smart-insights",
                    )
                )
            )
            active_collectors = build_production_collectors(
                repository,
                artifact_store,
                build_batch_collectors(repository),
            )
        outcomes, exit_code = run_collection(
            args.schedule,
            source_code=args.source,
            dry_run=args.dry_run,
            collectors=active_collectors or {},
        )
        if (
            repository is not None
            and args.schedule == "daily"
            and exit_code == 0
        ):
            run_crypto_pipeline(repository, as_of=datetime.now(timezone.utc))
    except ValueError:
        outcomes, exit_code = [], 2
    finally:
        if connection is not None:
            connection.close()
    _emit(outcomes, exit_code)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
