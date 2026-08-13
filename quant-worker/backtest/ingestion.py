from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal, Protocol

from .catalog import FEEDS
from .models import Bar
from .providers import INTERVALS, ProviderUnavailableError
from .publication import (
    PreparedDatasetPublication,
    PublicationResult,
    prepare_dataset_publication,
)
from .snapshots import ActiveSnapshot, merge_snapshot


AssetSymbol = str
Timeframe = Literal["1h", "1d"]
IngestionStatus = Literal[
    "succeeded", "unchanged", "skipped", "failed", "unavailable"
]


@dataclass(frozen=True)
class IngestionSelection:
    asset: str
    timeframe: str

    def __post_init__(self) -> None:
        if self.asset not in FEEDS or self.timeframe not in INTERVALS:
            raise ValueError("Unsupported ingestion selection.")


@dataclass(frozen=True)
class IngestionWindow:
    fetch_start: datetime
    fetch_end: datetime
    overlap_start: datetime


@dataclass(frozen=True)
class IngestionOutcome:
    asset: str
    timeframe: str
    status: IngestionStatus
    fetched_row_count: int = 0
    dataset_version_id: str | None = None
    error_code: str | None = None


class MarketDataProvider(Protocol):
    def fetch(
        self,
        *,
        symbol: str,
        asset: str,
        timeframe: str,
        start: datetime,
        end: datetime,
        now: datetime | None = None,
    ) -> list[Bar]: ...


class IngestionRepository(Protocol):
    def fail_stale_runs(self, now: datetime) -> int: ...

    def try_lock(self, selection: IngestionSelection) -> bool: ...

    def unlock(self, selection: IngestionSelection) -> None: ...

    def record_skipped(
        self, selection: IngestionSelection, scheduled_at: datetime, reason: str
    ) -> None: ...

    def start_run(
        self, selection: IngestionSelection, scheduled_at: datetime
    ) -> str: ...

    def load_active(self, selection: IngestionSelection) -> ActiveSnapshot | None: ...

    def publish_and_finish(
        self,
        run_id: str,
        prepared: PreparedDatasetPublication,
        fetched_row_count: int,
    ) -> PublicationResult: ...

    def finish_error(
        self,
        run_id: str,
        *,
        status: str,
        error_code: str,
        error_message: str,
    ) -> None: ...


def ingestion_window(
    timeframe: str,
    *,
    now: datetime,
    active: ActiveSnapshot | None,
    market: str | None = None,
) -> IngestionWindow:
    if timeframe not in INTERVALS:
        raise ValueError("Unsupported ingestion timeframe.")
    if market == "crypto_spot":
        initial_start = datetime(2017, 1, 1, tzinfo=timezone.utc)
    elif market == "metal_spot":
        initial_start = (
            datetime(2003, 5, 5, tzinfo=timezone.utc)
            if timeframe == "1h"
            else datetime(1999, 6, 3, tzinfo=timezone.utc)
        )
    else:
        initial_start = now - timedelta(days=3653)
    history_is_truncated = bool(
        active is not None
        and len(active.rows) > 1
        and active.rows[0].timestamp > initial_start + timedelta(days=7)
    )
    if active is None or active.is_fixture or history_is_truncated:
        fetch_start = initial_start
        return IngestionWindow(
            fetch_start=fetch_start,
            fetch_end=now,
            overlap_start=fetch_start,
        )

    default_overlap = now - timedelta(days=10 if timeframe == "1d" else 3)
    if active.rows:
        catchup_start = active.rows[-1].timestamp - INTERVALS[timeframe]
        fetch_start = min(default_overlap, catchup_start)
    else:
        fetch_start = default_overlap
    return IngestionWindow(
        fetch_start=fetch_start,
        fetch_end=now,
        overlap_start=fetch_start,
    )


def prepare_for_feed(
    selection: IngestionSelection, rows: list[Bar]
) -> PreparedDatasetPublication:
    feed = FEEDS[selection.asset]
    fallback_source = next((row.source for row in rows if row.source.startswith("ccxt:")), None)
    return prepare_dataset_publication(
        rows,
        market=feed.market,
        provider_code=feed.provider_code,
        provider_name=feed.provider_name,
        provider_symbol=feed.provider_symbol,
        canonical_key=feed.canonical_key,
        asset_name=feed.asset_name,
        currency=feed.currency,
        venue=feed.venue,
        timezone_name=feed.timezone_name,
        maximum_leverage=feed.maximum_leverage,
        terms_url=feed.terms_url,
        source_metadata={
            "mode": "live",
            "licenseScope": "research_only",
            "provider": feed.provider_code,
            "providerSymbol": feed.provider_symbol,
            "clientProvider": feed.client_provider,
            "upstreamProvider": feed.upstream_provider,
            "fallbackProvider": fallback_source,
        },
    )


def _safe_error_message(status: str) -> str:
    if status == "unavailable":
        return "Market data provider is unavailable."
    return "Market ingestion failed."


def _provider_for(
    provider_factory: object, selection: IngestionSelection
) -> MarketDataProvider:
    factory = provider_factory
    if not callable(factory):
        raise TypeError("Provider factory is not callable.")
    return factory(selection.asset)


def _fetch(
    selection: IngestionSelection,
    *,
    provider_factory: object,
    window: IngestionWindow,
    now: datetime,
) -> list[Bar]:
    feed = FEEDS[selection.asset]
    rows = _provider_for(provider_factory, selection).fetch(
        symbol=feed.provider_symbol,
        asset=feed.symbol,
        timeframe=selection.timeframe,
        start=window.fetch_start,
        end=window.fetch_end,
        now=now,
    )
    if not rows:
        raise ValueError("Provider returned no closed bars.")
    return rows


def _run_dry_selection(
    selection: IngestionSelection,
    *,
    provider_factory: object,
    now: datetime,
) -> IngestionOutcome:
    try:
        window = ingestion_window(
            selection.timeframe,
            now=now,
            active=None,
            market=FEEDS[selection.asset].market,
        )
        incoming = _fetch(
            selection,
            provider_factory=provider_factory,
            window=window,
            now=now,
        )
        prepare_for_feed(selection, incoming)
        return IngestionOutcome(
            asset=selection.asset,
            timeframe=selection.timeframe,
            status="succeeded",
            fetched_row_count=len(incoming),
        )
    except ProviderUnavailableError as error:
        return IngestionOutcome(
            asset=selection.asset,
            timeframe=selection.timeframe,
            status="unavailable",
            error_code=error.code,
        )
    except Exception:
        return IngestionOutcome(
            asset=selection.asset,
            timeframe=selection.timeframe,
            status="failed",
            error_code="ingestion_failed",
        )


def _run_live_selection(
    selection: IngestionSelection,
    *,
    repository: IngestionRepository,
    provider_factory: object,
    now: datetime,
) -> IngestionOutcome:
    locked = False
    run_id: str | None = None
    fetched_row_count = 0
    try:
        locked = repository.try_lock(selection)
        if not locked:
            repository.record_skipped(selection, now, "already_running")
            return IngestionOutcome(
                asset=selection.asset,
                timeframe=selection.timeframe,
                status="skipped",
            )

        run_id = repository.start_run(selection, now)
        active = repository.load_active(selection)
        window = ingestion_window(
            selection.timeframe,
            now=now,
            active=active,
            market=FEEDS[selection.asset].market,
        )
        incoming = _fetch(
            selection,
            provider_factory=provider_factory,
            window=window,
            now=now,
        )
        fetched_row_count = len(incoming)
        active_rows = () if active is None or active.is_fixture else active.rows
        merged = merge_snapshot(
            active_rows,
            incoming,
            overlap_start=window.overlap_start,
        )
        prepared = prepare_for_feed(selection, merged)
        publication = repository.publish_and_finish(
            run_id, prepared, fetched_row_count
        )
        return IngestionOutcome(
            asset=selection.asset,
            timeframe=selection.timeframe,
            status=publication.status,
            fetched_row_count=fetched_row_count,
            dataset_version_id=publication.dataset_version_id,
        )
    except ProviderUnavailableError as error:
        if run_id is not None:
            repository.finish_error(
                run_id,
                status="unavailable",
                error_code=error.code,
                error_message=_safe_error_message("unavailable"),
            )
        return IngestionOutcome(
            asset=selection.asset,
            timeframe=selection.timeframe,
            status="unavailable",
            fetched_row_count=fetched_row_count,
            error_code=error.code,
        )
    except Exception:
        if run_id is not None:
            repository.finish_error(
                run_id,
                status="failed",
                error_code="ingestion_failed",
                error_message=_safe_error_message("failed"),
            )
        return IngestionOutcome(
            asset=selection.asset,
            timeframe=selection.timeframe,
            status="failed",
            fetched_row_count=fetched_row_count,
            error_code="ingestion_failed",
        )
    finally:
        if locked:
            repository.unlock(selection)


def run_ingestion(
    selections: list[IngestionSelection],
    *,
    repository: IngestionRepository | None,
    provider_factory: object,
    now: datetime,
    dry_run: bool = False,
) -> tuple[list[IngestionOutcome], int]:
    if not selections:
        raise ValueError("At least one ingestion selection is required.")
    if not dry_run and repository is None:
        raise ValueError("Live ingestion requires a repository.")

    if dry_run:
        outcomes = [
            _run_dry_selection(
                item,
                provider_factory=provider_factory,
                now=now,
            )
            for item in selections
        ]
    else:
        assert repository is not None
        repository.fail_stale_runs(now)
        outcomes = [
            _run_live_selection(
                item,
                repository=repository,
                provider_factory=provider_factory,
                now=now,
            )
            for item in selections
        ]

    exit_code = (
        2
        if any(item.status in {"failed", "unavailable"} for item in outcomes)
        else 0
    )
    return outcomes, exit_code
