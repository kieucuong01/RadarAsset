from __future__ import annotations

import argparse
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import json
import os
from pathlib import Path
import re
from typing import Any
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row

from ingest_market_data import psycopg_connection_url
from smart_insights.artifacts import ArtifactStore
from smart_insights.bitinfocharts_acquisition import (
    BitInfoChartsCrawler,
    NodriverBitInfoChartsClient,
)
from smart_insights.briefing_pipeline import (
    PostgresBriefingRepository,
    generate_briefing,
    replay_briefing,
)
from smart_insights.collectors import CollectionBatch
from smart_insights.collectors.alternative_fng import AlternativeFearGreedCollector
from smart_insights.collectors.bitinfocharts import BitInfoChartsCollector
from smart_insights.collectors.bis import BisCollector
from smart_insights.collectors.coinmetrics import CoinMetricsCollector
from smart_insights.collectors.coinshares import CoinSharesCollector
from smart_insights.collectors.coinglass import (
    CoinGlassMarginCollector,
    CoinGlassMaxPainCollector,
)
from smart_insights.collectors.cftc import CftcCollector
from smart_insights.collectors.cryptocraft import CryptoCraftCollector
from smart_insights.collectors.defillama import (
    DefiLlamaChainsCollector,
    DefiLlamaStablecoinsCollector,
)
from smart_insights.collectors.deribit import DeribitCollector
from smart_insights.collectors.eonet import EonetCollector
from smart_insights.collectors.gdacs import GdacsCollector
from smart_insights.collectors.gdelt import GdeltCollector
from smart_insights.collectors.farside import FarsideEtfCollector
from smart_insights.collectors.fred import FredCollector
from smart_insights.collectors.mempool import MempoolSpaceCollector
from smart_insights.collectors.mempool_large_addresses import (
    AddressWatch,
    MempoolLargeAddressCollector,
)
from smart_insights.collectors.blockchaincenter import (
    BlockchainCenterAltcoinSeasonCollector,
)
from smart_insights.collectors.cbbi import CbbiCollector
from smart_insights.collectors.usgs import UsgsCollector
from smart_insights.contracts import RawSnapshot, SourceDefinition, SourceRunResult
from smart_insights.event_contracts import EventCollectionBatch
from smart_insights.event_repository import PostgresEventRepository
from smart_insights.crypto_pipeline import run_crypto_pipeline
from smart_insights.scrapling_client import ScraplingClient
from smart_insights.rendered_page_client import NodriverRenderedPageClient
from smart_insights.gold_pipeline import run_gold_pipeline
from smart_insights.http import SourceFetchError
from smart_insights.metrics.crypto import CRYPTO_METRIC_DEFINITIONS
from smart_insights.metrics.gold import GOLD_METRIC_DEFINITIONS
from smart_insights.macro_pipeline import run_global_event_risk_pipeline, run_macro_pipeline
from smart_insights.macro_registry import CFTC_MARKETS, FRED_SERIES
from smart_insights.metrics.macro import MACRO_METRIC_DEFINITIONS
from smart_insights.repository import PostgresInsightRepository
from smart_insights.scheduling import due_calendar_jobs
from smart_insights.sources import (
    SOURCE_CODES,
    is_source_url_allowed,
    source_for_code,
)
from smart_insights.validation import ObservationValidationError
from smart_insights.validation import validate_observations


SCHEDULES = (
    "daily",
    "four-hourly",
    "weekly",
    "calendar-current",
    "calendar-next",
    "calendar-event",
    "briefing",
    "briefing-refresh",
    "replay",
)
EVENT_SOURCE_CODES = frozenset(
    {"gdelt-events", "gdacs-events", "usgs-earthquakes", "nasa-eonet"}
)
ENERGY_SOURCE_CODES = frozenset({"eia-energy", "bis-statistics"})
_SOURCE_SCHEDULE = {
    "daily": "daily",
    "four-hourly": "four-hourly",
    "weekly": "weekly",
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
EventCollector = Callable[[datetime], EventCollectionBatch]


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
        if not include_disabled and not source.enabled:
            return ()
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
    succeeded = {"succeeded", "unchanged", "not_due", "dry_run"}
    return outcomes, 0 if all(outcome.status in succeeded for outcome in outcomes) else 1


def run_calendar_schedule(
    schedule: str,
    *,
    as_of: datetime,
    repository: PostgresInsightRepository,
    artifact_store: ArtifactStore,
    collector: CryptoCraftCollector,
) -> tuple[list[CollectionOutcome], int]:
    if schedule not in {"calendar-current", "calendar-next", "calendar-event"}:
        raise ValueError("Calendar schedule is not supported.")
    latest_events = repository.latest_calendar_events(as_of=as_of)
    due = due_calendar_jobs(
        as_of,
        events=latest_events,
        last_success=repository.last_successful_calendar_jobs(),
    )
    if schedule == "calendar-next":
        due = tuple(job for job in due if job.job_code == "cryptocraft-next")
    elif schedule == "calendar-event":
        due = tuple(job for job in due if job.job_code.startswith("cryptocraft-event:"))
    if not due:
        return [CollectionOutcome("cryptocraft", "not_due", 0, None)], 0

    source = source_for_code("cryptocraft")
    outcomes: list[CollectionOutcome] = []
    for job in due:
        batch = (
            collector.collect_week(job.target, observed_at=as_of)
            if job.target in {"current", "next"}
            else collector.collect_detail(job.target, observed_at=as_of)
        )
        artifact = artifact_store.write(batch.snapshot, source.code)
        if batch.error_code is not None or not batch.events:
            error_code = batch.error_code or "MISSING_REQUIRED_FIELD"
            repository.quarantine(
                source, batch.snapshot, artifact, error_code=error_code
            )
            outcomes.append(CollectionOutcome(job.job_code, "quarantined", 0, error_code))
            continue
        publication = repository.publish_calendar_batch(
            source,
            batch.snapshot,
            artifact,
            batch.events,
            job_code=job.job_code,
        )
        outcomes.append(
            CollectionOutcome(
                job.job_code,
                publication.status,
                len(batch.events),
                None,
            )
        )
    successful = {"succeeded", "unchanged", "not_due"}
    return outcomes, 0 if all(row.status in successful for row in outcomes) else 1


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
    except ValueError as error:
        error_code = (
            "CONFIG_MISSING" if str(error).startswith("FRED_API_KEY") else "INVALID_RESPONSE"
        )
        return LiveSmokeOutcome(source_code, "failed", 0, None, error_code)
    return LiveSmokeOutcome(
        source_code=source_code,
        status="succeeded",
        records_fetched=len(validated),
        effective_at=max(row.effective_at for row in validated),
        error_code=None,
    )


def build_event_collectors(*, transport: Any | None = None) -> Mapping[str, EventCollector]:
    return {
        "gdelt-events": lambda as_of: GdeltCollector(transport=transport).collect(observed_at=as_of),
        "gdacs-events": lambda as_of: GdacsCollector(transport=transport).collect(observed_at=as_of),
        "usgs-earthquakes": lambda as_of: UsgsCollector(transport=transport).collect(observed_at=as_of),
        "nasa-eonet": lambda as_of: EonetCollector(transport=transport).collect(observed_at=as_of),
    }


def run_event_live_smoke(
    source_code: str,
    *,
    as_of: datetime,
    event_collectors: Mapping[str, EventCollector],
) -> LiveSmokeOutcome:
    if source_code not in EVENT_SOURCE_CODES:
        raise ValueError("Source is not a registered global-event source.")
    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("Live smoke time must be timezone-aware.")
    collector = event_collectors.get(source_code)
    if collector is None:
        return LiveSmokeOutcome(source_code, "failed", 0, None, "SOURCE_NOT_IMPLEMENTED")
    try:
        batch = collector(as_of)
    except SourceFetchError as error:
        return LiveSmokeOutcome(source_code, "failed", 0, None, error.code)
    except ValueError:
        return LiveSmokeOutcome(source_code, "failed", 0, None, "INVALID_RESPONSE")
    if batch.source_code != source_code or batch.error_code is not None or not batch.events:
        return LiveSmokeOutcome(
            source_code,
            "failed",
            0,
            None,
            batch.error_code or "MISSING_REQUIRED_FIELD",
        )
    return LiveSmokeOutcome(
        source_code,
        "succeeded",
        len(batch.events),
        max(event.occurred_at for event in batch.events),
        None,
    )


def run_calendar_live_smoke(
    collector: CryptoCraftCollector, *, as_of: datetime
) -> LiveSmokeOutcome:
    try:
        batch = collector.collect_week("current", observed_at=as_of)
    except SourceFetchError as error:
        return LiveSmokeOutcome("cryptocraft", "failed", 0, None, error.code)
    except ValueError:
        return LiveSmokeOutcome("cryptocraft", "failed", 0, None, "INVALID_RESPONSE")
    if batch.error_code is not None or not batch.events:
        return LiveSmokeOutcome(
            "cryptocraft", "failed", 0, None,
            batch.error_code or "MISSING_REQUIRED_FIELD",
        )
    timed = tuple(
        event.event_at_utc for event in batch.events if event.event_at_utc is not None
    )
    effective_at = max(timed) if timed else as_of
    return LiveSmokeOutcome(
        "cryptocraft", "succeeded", len(batch.events), effective_at, None
    )


_COINSHARES_REPORT = re.compile(
    r"(?:https://coinshares\.com)?(?:/us)?/insights/research-data/"
    r"fund-flows-(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})/",
    re.IGNORECASE,
)
def _discover_coinshares_report(crawler: Any) -> str:
    source = source_for_code("coinshares-weekly")
    index_urls = (source.urls[0],) + tuple(
        f"{source.urls[0]}?page={page}" for page in range(1, 6)
    )
    for index_url in index_urls:
        snapshot = crawler.scrape(source, index_url)
        try:
            payload = json.loads(snapshot.content)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise SourceFetchError("INVALID_RESPONSE") from error
        markdown = payload.get("markdown") if isinstance(payload, dict) else None
        raw_html = payload.get("rawHtml") if isinstance(payload, dict) else None
        documents = tuple(
            value
            for value in (markdown, raw_html)
            if isinstance(value, str) and value.strip()
        )
        if not documents:
            raise SourceFetchError("SCHEMA_DRIFT")
        document = "\n".join(documents)
        candidates: list[tuple[datetime, str]] = []
        for match in _COINSHARES_REPORT.finditer(document):
            try:
                year = int(match.group(3))
                if year < 100:
                    year += 2_000
                report_date = datetime(
                    year, int(match.group(2)), int(match.group(1)),
                    tzinfo=timezone.utc,
                )
            except ValueError:
                continue
            url = urljoin("https://coinshares.com", match.group(0))
            if is_source_url_allowed(source, url):
                candidates.append((report_date, url))
        if candidates:
            return max(candidates, key=lambda row: (row[0], row[1]))[1]
    raise SourceFetchError("SCHEMA_DRIFT")


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


def _latest_large_address_watchlist(
    repository: PostgresInsightRepository | None, as_of: datetime
) -> tuple[AddressWatch, ...]:
    if repository is None:
        return ()
    rows = tuple(
        row
        for row in repository.metric_observations(
            "crypto.large_address.address_balance_btc", as_of=as_of
        )
        if row.dimensions.get("address")
        and row.dimensions.get("rank")
        and row.dimensions.get("cohort_version")
    )
    if not rows:
        return ()
    latest_effective_at = max(row.effective_at for row in rows)
    result: list[AddressWatch] = []
    for row in rows:
        if row.effective_at != latest_effective_at:
            continue
        try:
            result.append(
                AddressWatch(
                    address=row.dimensions["address"],
                    rank=int(row.dimensions["rank"]),
                    discovery_balance_btc=row.value,
                    label_status=row.dimensions.get("label_status", "unknown"),
                    cohort_version=row.dimensions["cohort_version"],
                )
            )
        except (KeyError, ValueError):
            continue
    return tuple(sorted(result, key=lambda item: (item.rank, item.address)))


def _large_address_history(
    repository: PostgresInsightRepository | None, as_of: datetime
) -> tuple[
    datetime | None,
    dict[date, dict[str, Decimal]],
    dict[str, datetime],
]:
    if repository is None:
        return None, {}, {}
    balance_rows = repository.metric_observations(
        "crypto.large_address.confirmed_balance_btc", as_of=as_of
    )
    balance_history: dict[date, dict[str, Decimal]] = {}
    for row in balance_rows:
        address = row.dimensions.get("address")
        if address:
            balance_history.setdefault(row.effective_at.date(), {})[address] = row.value
    previous_cutoff = (
        max(row.effective_at for row in balance_rows) if balance_rows else None
    )
    outgoing_rows = repository.metric_observations(
        "crypto.large_address.confirmed_outgoing_btc", as_of=as_of
    )
    last_outgoing: dict[str, datetime] = {}
    for row in outgoing_rows:
        address = row.dimensions.get("address")
        if address and (
            address not in last_outgoing or row.effective_at > last_outgoing[address]
        ):
            last_outgoing[address] = row.effective_at
    return previous_cutoff, balance_history, last_outgoing


def _bounded_environment_int(
    name: str, default: int, *, minimum: int, maximum: int
) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as error:
        raise ValueError(f"{name} must be an integer.") from error
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} is outside its allowed range.")
    return value


def _merge_api_batches(
    source_code: str,
    batches: Sequence[CollectionBatch],
    *,
    observed_at: datetime,
) -> CollectionBatch:
    source = source_for_code(source_code)
    payloads: list[object] = []
    observations = []
    error_code: str | None = None
    for batch in batches:
        if batch.source.code != source_code:
            raise ValueError("Cannot merge batches from another source.")
        try:
            payloads.append(json.loads(batch.snapshot.content))
        except (UnicodeDecodeError, json.JSONDecodeError):
            payloads.append({"contentHashOnly": True})
        observations.extend(batch.observations)
        error_code = error_code or batch.error_code
    snapshot = RawSnapshot(
        content=json.dumps(payloads, sort_keys=True, separators=(",", ":")).encode("utf-8"),
        content_type="application/json",
        source_url=source.urls[0],
        effective_at=(
            max((row.effective_at for row in observations), default=None)
        ),
        published_at=None,
        observed_at=observed_at,
        metadata={
            "merged_batches": len(batches),
            "parser_version": source.parser_version,
        },
    )
    return CollectionBatch(
        source,
        snapshot,
        tuple(observations) if error_code is None else (),
        error_code,
    )


def build_batch_collectors(
    repository: PostgresInsightRepository | None = None,
    *,
    scrapling_client: Any | None = None,
    rendered_client: Any | None = None,
    large_address_transport: Any | None = None,
    bitinfocharts_crawler: Any | None = None,
    bitinfocharts_fallback: Any | None = None,
    bitinfocharts_markdown_converter: Callable[[str, str], str] | None = None,
    cbbi_backfill: bool = False,
) -> Mapping[str, BatchCollector]:
    scrapling = scrapling_client or ScraplingClient()
    rendered = rendered_client or NodriverRenderedPageClient()
    bitinfocharts_acquisition = bitinfocharts_crawler or BitInfoChartsCrawler(
        primary=scrapling,
        fallback=bitinfocharts_fallback
        or NodriverBitInfoChartsClient(renderer=rendered),
        markdown_converter=bitinfocharts_markdown_converter,
    )

    def coinshares(as_of: datetime) -> CollectionBatch:
        report_url = _discover_coinshares_report(scrapling)
        return CoinSharesCollector(
            crawler=scrapling, report_url=report_url
        ).collect(as_of)

    def bitinfocharts(as_of: datetime) -> CollectionBatch:
        previous = _previous_large_address_balances(repository, as_of)
        return BitInfoChartsCollector(crawler=bitinfocharts_acquisition).collect(
            as_of,
            previous_balances=previous or None,
        )

    def mempool_large_addresses(as_of: datetime) -> CollectionBatch:
        previous_cutoff, balance_history, last_outgoing = _large_address_history(
            repository, as_of
        )
        return MempoolLargeAddressCollector(
            transport=large_address_transport
        ).collect(
            as_of,
            watchlist=_latest_large_address_watchlist(repository, as_of),
            previous_cutoff=previous_cutoff,
            balance_history=balance_history,
            last_outgoing=last_outgoing,
        )

    def fred(as_of: datetime) -> CollectionBatch:
        overlap_days = _bounded_environment_int(
            "SMART_INSIGHTS_FRED_OVERLAP_DAYS", 14, minimum=1, maximum=365
        )
        collector = FredCollector(api_key=os.getenv("FRED_API_KEY", ""))
        batches = tuple(
            collector.collect(
                series,
                (
                    as_of
                    - timedelta(
                        days=max(overlap_days, 196)
                        if series.series_id == "M2SL"
                        else overlap_days
                    )
                ).date(),
                as_of.date(),
            )
            for series in FRED_SERIES.values()
        )
        return _merge_api_batches("fred", batches, observed_at=as_of)

    def cftc_legacy(as_of: datetime) -> CollectionBatch:
        overlap_weeks = _bounded_environment_int(
            "SMART_INSIGHTS_CFTC_OVERLAP_WEEKS", 8, minimum=1, maximum=520
        )
        collector = CftcCollector()
        batches = tuple(
            collector.collect(
                market,
                report_date_from=(as_of - timedelta(weeks=overlap_weeks)).date(),
            )
            for market in CFTC_MARKETS.values()
            if market.source_code == "cftc-legacy"
        )
        return _merge_api_batches("cftc-legacy", batches, observed_at=as_of)

    def cftc_disaggregated(as_of: datetime) -> CollectionBatch:
        overlap_weeks = _bounded_environment_int(
            "SMART_INSIGHTS_CFTC_OVERLAP_WEEKS", 8, minimum=1, maximum=520
        )
        collector = CftcCollector()
        batch = collector.collect(
            CFTC_MARKETS["GOLD"],
            report_date_from=(as_of - timedelta(weeks=overlap_weeks)).date(),
        )
        return _merge_api_batches("cftc-disaggregated", (batch,), observed_at=as_of)

    def bis_statistics(as_of: datetime) -> CollectionBatch:
        context = BisCollector().collect_context(observed_at=as_of)
        if context.snapshot is None:
            raise ValueError("BIS collector returned no evidence snapshot.")
        return CollectionBatch(
            source_for_code("bis-statistics"),
            context.snapshot,
            context.observations,
            context.error_code,
        )

    return {
        "alternative-fng": lambda as_of: AlternativeFearGreedCollector().collect(as_of),
        "farside-btc-etf": lambda as_of: FarsideEtfCollector(
            "BTC", crawler=scrapling
        ).collect(as_of),
        "farside-eth-etf": lambda as_of: FarsideEtfCollector(
            "ETH", crawler=scrapling
        ).collect(as_of),
        "farside-sol-etf": lambda as_of: FarsideEtfCollector(
            "SOL", crawler=scrapling
        ).collect(as_of),
        "coinmetrics-community": lambda as_of: CoinMetricsCollector().collect(as_of),
        "mempool-space": lambda as_of: MempoolSpaceCollector().collect(as_of),
        "mempool-btc-large-addresses": mempool_large_addresses,
        "defillama-stablecoins": lambda as_of: DefiLlamaStablecoinsCollector().collect(as_of),
        "defillama-chains": lambda as_of: DefiLlamaChainsCollector().collect(as_of),
        "deribit-public": lambda as_of: DeribitCollector().collect(as_of),
        "coinshares-weekly": coinshares,
        "bitinfocharts-top-addresses": bitinfocharts,
        "coinglass-margin-borrow": lambda as_of: CoinGlassMarginCollector(
            crawler=rendered
        ).collect(as_of),
        "coinglass-liquidation-maxpain": lambda as_of: CoinGlassMaxPainCollector(
            crawler=rendered
        ).collect(as_of),
        "blockchaincenter-altcoin-season": lambda as_of: BlockchainCenterAltcoinSeasonCollector(
            crawler=scrapling
        ).collect(as_of),
        "cbbi-public": lambda as_of: CbbiCollector(
            crawler=scrapling, backfill=cbbi_backfill
        ).collect(as_of),
        "fred": fred,
        "cftc-legacy": cftc_legacy,
        "cftc-disaggregated": cftc_disaggregated,
        "bis-statistics": bis_statistics,
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


def build_production_event_collectors(
    repository: PostgresEventRepository,
    quarantine_repository: PostgresInsightRepository,
    artifact_store: ArtifactStore,
    event_collectors: Mapping[str, EventCollector],
    *,
    clock: Callable[[], datetime] | None = None,
) -> Mapping[str, Collector]:
    now = clock or (lambda: datetime.now(timezone.utc))
    collectors: dict[str, Collector] = {}
    for source_code, event_collector in event_collectors.items():
        def collect(
            source: SourceDefinition,
            *,
            collector: EventCollector = event_collector,
            expected_code: str = source_code,
        ) -> SourceRunResult:
            started_at = now()
            if source.code != expected_code:
                raise ValueError("Event collector source does not match its registry code.")
            batch = collector(started_at)
            artifact = artifact_store.write(batch.snapshot, source.code)
            if batch.error_code is not None or not batch.events:
                error_code = batch.error_code or "MISSING_REQUIRED_FIELD"
                quarantine_repository.quarantine(
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
                source, batch.snapshot, artifact, batch.events
            )
            return SourceRunResult(
                source.code,
                "succeeded" if publication.inserted else "unchanged",
                len(batch.events),
                None,
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
    parser.add_argument("--organization-id")
    parser.add_argument("--user-id")
    parser.add_argument("--all-memberships", action="store_true")
    parser.add_argument("--local-date")
    parser.add_argument("--timezone", default="Asia/Bangkok")
    parser.add_argument("--briefing-id")
    parser.add_argument("--reason")
    parser.add_argument("--cbbi-backfill", action="store_true")
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


def connect_database(
    database_url: str, *, connection_factory: Callable[..., Any] = psycopg.connect
) -> Any:
    return connection_factory(
        psycopg_connection_url(database_url),
        autocommit=True,
        row_factory=dict_row,
    )


def main(
    argv: Sequence[str] | None = None,
    *,
    collectors: Mapping[str, Collector] | None = None,
    smoke_collectors: Mapping[str, BatchCollector] | None = None,
) -> int:
    args = _argument_parser().parse_args(argv)
    if args.cbbi_backfill and args.source != "cbbi-public":
        return 2
    load_environment(Path(args.env_file))
    if args.live_smoke:
        if args.dry_run or not args.source:
            return 2
        try:
            smoke_time = datetime.now(timezone.utc)
            if args.source == "cryptocraft":
                crawler = ScraplingClient()
                outcome = run_calendar_live_smoke(
                    CryptoCraftCollector(crawler=crawler), as_of=smoke_time
                )
            elif args.source in EVENT_SOURCE_CODES:
                outcome = run_event_live_smoke(
                    args.source,
                    as_of=smoke_time,
                    event_collectors=build_event_collectors(),
                )
            else:
                outcome = run_live_smoke(
                    args.source,
                    as_of=smoke_time,
                    batch_collectors=smoke_collectors
                    or build_batch_collectors(cbbi_backfill=args.cbbi_backfill),
                )
        except ValueError:
            return 2
        _emit_smoke(outcome)
        return 0 if outcome.status == "succeeded" else 1

    connection: psycopg.Connection[Any] | None = None
    try:
        active_collectors = collectors
        repository: PostgresInsightRepository | None = None
        event_repository: PostgresEventRepository | None = None
        if active_collectors is None and not args.dry_run:
            database_url = os.getenv("DATABASE_URL")
            if not database_url:
                raise ValueError("DATABASE_URL is required.")
            connection = connect_database(database_url)
            repository = PostgresInsightRepository(connection)
            repository.upsert_metric_definitions(
                CRYPTO_METRIC_DEFINITIONS
                + MACRO_METRIC_DEFINITIONS
                + GOLD_METRIC_DEFINITIONS
            )
            if args.schedule in {"briefing", "briefing-refresh", "replay"}:
                briefing_repository = PostgresBriefingRepository(connection)
                if args.schedule == "replay":
                    if not args.briefing_id:
                        raise ValueError("Replay requires --briefing-id.")
                    record = replay_briefing(briefing_repository, args.briefing_id)
                    outcomes, exit_code = [
                        CollectionOutcome("briefing", "unchanged", len(record.items), None)
                    ], 0
                else:
                    timezone_name = args.timezone
                    timezone_info = ZoneInfo(timezone_name)
                    as_of = datetime.now(timezone.utc)
                    local_day = (
                        datetime.fromisoformat(args.local_date).date()
                        if args.local_date
                        else as_of.astimezone(timezone_info).date()
                    )
                    memberships: list[tuple[str, str]] = []
                    if args.all_memberships:
                        with connection.cursor(row_factory=dict_row) as cursor:
                            cursor.execute(
                                "SELECT organization_id, user_id FROM organization_memberships ORDER BY organization_id, user_id"
                            )
                            memberships = [
                                (str(row["organization_id"]), str(row["user_id"]))
                                for row in cursor.fetchall()
                            ]
                    elif args.organization_id and args.user_id:
                        with connection.cursor(row_factory=dict_row) as cursor:
                            cursor.execute(
                                "SELECT 1 FROM organization_memberships WHERE organization_id = %s AND user_id = %s",
                                (args.organization_id, args.user_id),
                            )
                            if cursor.fetchone() is None:
                                raise ValueError("User is not a member of the organization.")
                        memberships = [(args.organization_id, args.user_id)]
                    else:
                        raise ValueError("Briefing requires scoped IDs or --all-memberships.")
                    generated = [
                        generate_briefing(
                            briefing_repository,
                            organization_id=organization_id,
                            user_id=user_id,
                            local_date=local_day,
                            timezone_name=timezone_name,
                            as_of=as_of,
                        )
                        for organization_id, user_id in memberships
                    ]
                    outcomes, exit_code = [
                        CollectionOutcome("briefing", "succeeded", len(generated), None)
                    ], 0
                _emit(outcomes, exit_code)
                return exit_code
            artifact_store = ArtifactStore(
                Path(
                    os.getenv(
                        "SMART_INSIGHTS_ARTIFACT_ROOT",
                        ".local-data/smart-insights",
                    )
                )
            )
            if args.schedule.startswith("calendar-"):
                source = source_for_code("cryptocraft")
                if args.source not in {None, source.code}:
                    raise ValueError("Calendar schedule requires the CryptoCraft source.")
                if not source.enabled:
                    outcomes, exit_code = [
                        CollectionOutcome(source.code, "failed", 0, "SOURCE_DISABLED")
                    ], 1
                else:
                    crawler = ScraplingClient()
                    outcomes, exit_code = run_calendar_schedule(
                        args.schedule,
                        as_of=datetime.now(timezone.utc),
                        repository=repository,
                        artifact_store=artifact_store,
                        collector=CryptoCraftCollector(crawler=crawler),
                    )
            else:
                active_collectors = dict(build_production_collectors(
                    repository,
                    artifact_store,
                    build_batch_collectors(
                        repository, cbbi_backfill=args.cbbi_backfill
                    ),
                ))
                event_repository = PostgresEventRepository(connection)
                active_collectors.update(
                    build_production_event_collectors(
                        event_repository,
                        repository,
                        artifact_store,
                        build_event_collectors(),
                    )
                )
        if not (repository is not None and args.schedule.startswith("calendar-")):
            outcomes, exit_code = run_collection(
                args.schedule,
                source_code=args.source,
                dry_run=args.dry_run,
                collectors=active_collectors or {},
            )
        if repository is not None and exit_code == 0:
            pipeline_time = datetime.now(timezone.utc)
            if args.schedule == "daily":
                run_crypto_pipeline(repository, as_of=pipeline_time)
            if args.schedule in {
                "daily", "weekly", "calendar-current", "calendar-next", "calendar-event"
            }:
                run_macro_pipeline(repository, as_of=pipeline_time)
            if args.schedule == "daily" and event_repository is not None:
                run_global_event_risk_pipeline(
                    event_repository, repository, as_of=pipeline_time
                )
            if args.schedule in {"daily", "weekly"}:
                run_gold_pipeline(repository, as_of=pipeline_time)
    except ValueError:
        outcomes, exit_code = [], 2
    finally:
        if connection is not None:
            connection.close()
    _emit(outcomes, exit_code)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
