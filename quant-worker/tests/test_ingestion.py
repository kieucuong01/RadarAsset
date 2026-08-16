from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import pytest

from backtest.ingestion import (
    IngestionSelection,
    certified_active_rows,
    ingestion_window,
    run_ingestion,
)
from backtest.models import Bar
from backtest.providers import ProviderUnavailableError
from backtest.publication import PublicationResult
from backtest.snapshots import ActiveSnapshot


NOW = datetime(2026, 8, 10, 12, 10, tzinfo=timezone.utc)


def bar(
    asset: str,
    hour: int,
    *,
    source: str = "qa-live",
    day: int = 10,
) -> Bar:
    return Bar(
        asset=asset,
        timestamp=datetime(2026, 8, day, hour, tzinfo=timezone.utc),
        timeframe="1d",
        open=Decimal("100"),
        high=Decimal("101"),
        low=Decimal("99"),
        close=Decimal("100"),
        volume=Decimal("10"),
        source=source,
    )


def snapshot(
    asset: str,
    *,
    source: str = "qa-live",
    mode: str = "live",
    day: int = 10,
) -> ActiveSnapshot:
    return ActiveSnapshot(
        dataset_id=f"dataset-{asset}",
        dataset_version_id=f"version-{asset}-old",
        version=1,
        checksum="a" * 64,
        source_metadata={"mode": mode},
        rows=(bar(asset, 9, source=source, day=day),),
    )


class FakeProvider:
    def __init__(self, result: list[Bar] | Exception) -> None:
        self.result = result
        self.calls: list[dict[str, Any]] = []

    def fetch(self, **kwargs: Any) -> list[Bar]:
        self.calls.append(kwargs)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class FakeProviderFactory:
    def __init__(self, providers: dict[str, FakeProvider]) -> None:
        self.providers = providers
        self.assets: list[str] = []

    def __call__(self, asset: str) -> FakeProvider:
        self.assets.append(asset)
        return self.providers[asset]


class FakeRepository:
    def __init__(
        self,
        *,
        active: dict[tuple[str, str], ActiveSnapshot] | None = None,
        lock_available: bool = True,
        publication_status: str = "succeeded",
    ) -> None:
        self.active = active or {}
        self.lock_available = lock_available
        self.publication_status = publication_status
        self.calls: list[tuple[str, Any]] = []
        self.prepared: list[Any] = []
        self.finished: list[dict[str, Any]] = []

    def fail_stale_runs(self, now: datetime) -> int:
        self.calls.append(("fail_stale_runs", now))
        return 0

    def try_lock(self, selection: IngestionSelection) -> bool:
        self.calls.append(("try_lock", selection))
        return self.lock_available

    def unlock(self, selection: IngestionSelection) -> None:
        self.calls.append(("unlock", selection))

    def record_skipped(
        self, selection: IngestionSelection, scheduled_at: datetime, reason: str
    ) -> None:
        self.calls.append(("record_skipped", (selection, scheduled_at, reason)))

    def start_run(
        self, selection: IngestionSelection, scheduled_at: datetime
    ) -> str:
        self.calls.append(("start_run", selection))
        return f"run-{selection.asset}-{selection.timeframe}"

    def load_active(
        self, selection: IngestionSelection
    ) -> ActiveSnapshot | None:
        self.calls.append(("load_active", selection))
        return self.active.get((selection.asset, selection.timeframe))

    def publish_and_finish(
        self, run_id: str, prepared: Any, fetched_row_count: int
    ) -> PublicationResult:
        self.calls.append(("publish_and_finish", run_id))
        self.prepared.append(prepared)
        return PublicationResult(
            status=self.publication_status,  # type: ignore[arg-type]
            dataset_version_id=f"version-{prepared.asset}-new",
            version=2,
            checksum=prepared.checksum,
            row_count=prepared.row_count,
            missing_bar_count=prepared.missing_bar_count,
            quality_status=prepared.quality_status,
        )

    def finish_error(
        self,
        run_id: str,
        *,
        status: str,
        error_code: str,
        error_message: str,
    ) -> None:
        self.finished.append(
            {
                "run_id": run_id,
                "status": status,
                "error_code": error_code,
                "error_message": error_message,
            }
        )


def selection(asset: str, timeframe: str = "1d") -> IngestionSelection:
    return IngestionSelection(asset=asset, timeframe=timeframe)


def test_vn_daily_publication_keeps_only_calendar_certified_active_history() -> None:
    rows = (
        Bar(
            asset="HPG",
            timestamp=datetime(2023, 12, 29, tzinfo=timezone.utc),
            timeframe="1d",
            open=Decimal("100"),
            high=Decimal("101"),
            low=Decimal("99"),
            close=Decimal("100"),
            volume=Decimal("10"),
            source="legacy-live",
        ),
        Bar(
            asset="HPG",
            timestamp=datetime(2024, 1, 2, tzinfo=timezone.utc),
            timeframe="1d",
            open=Decimal("100"),
            high=Decimal("101"),
            low=Decimal("99"),
            close=Decimal("100"),
            volume=Decimal("10"),
            source="certified-live",
        ),
    )

    assert certified_active_rows(rows, market="vn_equity") == (rows[1],)
    assert certified_active_rows(rows, market="crypto_spot") == rows


def test_provider_failure_preserves_active_version_and_other_feed_succeeds() -> None:
    repository = FakeRepository(active={("BTC", "1d"): snapshot("BTC")})
    providers = FakeProviderFactory(
        {
            "BTC": FakeProvider(
                ProviderUnavailableError("rate_limited", "Provider request failed.")
            ),
            "XAU": FakeProvider([bar("XAU", 10)]),
        }
    )

    outcomes, exit_code = run_ingestion(
        [selection("BTC"), selection("XAU")],
        repository=repository,
        provider_factory=providers,
        now=NOW,
    )

    assert [item.status for item in outcomes] == ["unavailable", "succeeded"]
    assert exit_code == 2
    assert repository.active[("BTC", "1d")].dataset_version_id == "version-BTC-old"
    assert [prepared.asset for prepared in repository.prepared] == ["XAU"]
    assert repository.finished[0]["error_code"] == "rate_limited"


def test_busy_advisory_lock_skips_without_fetching() -> None:
    repository = FakeRepository(lock_available=False)
    providers = FakeProviderFactory({"BTC": FakeProvider([bar("BTC", 10)])})

    outcomes, exit_code = run_ingestion(
        [selection("BTC")],
        repository=repository,
        provider_factory=providers,
        now=NOW,
    )

    assert outcomes[0].status == "skipped"
    assert exit_code == 0
    assert providers.assets == []
    assert any(call[0] == "record_skipped" for call in repository.calls)


def test_fixture_snapshot_is_replaced_by_live_backfill_without_mixing_rows() -> None:
    repository = FakeRepository(
        active={
            ("BTC", "1d"): snapshot(
                "BTC", source="research_fixture", mode="fixture", day=1
            )
        }
    )
    provider = FakeProvider([bar("BTC", 10)])

    outcomes, exit_code = run_ingestion(
        [selection("BTC")],
        repository=repository,
        provider_factory=FakeProviderFactory({"BTC": provider}),
        now=NOW,
    )

    assert outcomes[0].status == "succeeded"
    assert exit_code == 0
    assert [row.source for row in repository.prepared[0].rows] == ["qa-live"]
    assert provider.calls[0]["start"] == datetime(2017, 1, 1, tzinfo=timezone.utc)


def test_dry_run_fetches_and_validates_without_touching_a_repository() -> None:
    provider = FakeProvider([bar("BTC", 10)])

    outcomes, exit_code = run_ingestion(
        [selection("BTC")],
        repository=None,
        provider_factory=FakeProviderFactory({"BTC": provider}),
        now=NOW,
        dry_run=True,
    )

    assert outcomes[0].status == "succeeded"
    assert outcomes[0].dataset_version_id is None
    assert outcomes[0].fetched_row_count == 1
    assert exit_code == 0


def test_dry_run_maps_provider_unavailability_without_database_writes() -> None:
    provider = FakeProvider(
        ProviderUnavailableError("provider_unavailable", "Provider request failed.")
    )

    outcomes, exit_code = run_ingestion(
        [selection("FPT")],
        repository=None,
        provider_factory=FakeProviderFactory({"FPT": provider}),
        now=NOW,
        dry_run=True,
    )

    assert outcomes[0].status == "unavailable"
    assert outcomes[0].error_code == "provider_unavailable"
    assert exit_code == 2


def test_unchanged_checksum_returns_existing_version_without_failure() -> None:
    repository = FakeRepository(publication_status="unchanged")

    outcomes, exit_code = run_ingestion(
        [selection("XAU")],
        repository=repository,
        provider_factory=FakeProviderFactory({"XAU": FakeProvider([bar("XAU", 10)])}),
        now=NOW,
    )

    assert outcomes[0].status == "unchanged"
    assert outcomes[0].dataset_version_id == "version-XAU-new"
    assert exit_code == 0


def test_unexpected_errors_are_sanitized_and_capped() -> None:
    repository = FakeRepository()
    provider = FakeProvider(RuntimeError("postgresql://user:secret@host/db token=abc"))

    outcomes, exit_code = run_ingestion(
        [selection("BTC")],
        repository=repository,
        provider_factory=FakeProviderFactory({"BTC": provider}),
        now=NOW,
    )

    assert outcomes[0].status == "failed"
    assert outcomes[0].error_code == "ingestion_failed"
    assert exit_code == 2
    stored_message = repository.finished[0]["error_message"]
    assert stored_message == "Market ingestion failed."
    assert "secret" not in stored_message
    assert len(stored_message) <= 200


def test_live_run_marks_stale_rows_once_before_processing() -> None:
    repository = FakeRepository()

    run_ingestion(
        [selection("BTC"), selection("XAU")],
        repository=repository,
        provider_factory=FakeProviderFactory(
            {"BTC": FakeProvider([bar("BTC", 10)]), "XAU": FakeProvider([bar("XAU", 10)])}
        ),
        now=NOW,
    )

    assert [call[0] for call in repository.calls].count("fail_stale_runs") == 1


def test_ingestion_windows_use_initial_backfill_and_incremental_overlap() -> None:
    initial = ingestion_window("1d", now=NOW, active=None, market="vn_equity")
    crypto_initial = ingestion_window("1d", now=NOW, active=None, market="crypto_spot")
    metal_daily_initial = ingestion_window(
        "1d", now=NOW, active=None, market="metal_spot"
    )
    incremental = ingestion_window("1d", now=NOW, active=snapshot("BTC"))

    assert initial.fetch_start == datetime(2024, 1, 1, tzinfo=timezone.utc)
    assert initial.overlap_start == initial.fetch_start
    assert crypto_initial.fetch_start == datetime(2017, 1, 1, tzinfo=timezone.utc)
    assert metal_daily_initial.fetch_start == datetime(1999, 6, 3, tzinfo=timezone.utc)
    assert incremental.fetch_start == NOW - timedelta(days=10)
    assert incremental.overlap_start == NOW - timedelta(days=10)


def test_ingestion_window_restarts_backfill_when_active_history_is_truncated() -> None:
    active = snapshot("BTC")
    truncated = ActiveSnapshot(
        dataset_id=active.dataset_id,
        dataset_version_id=active.dataset_version_id,
        version=active.version,
        checksum=active.checksum,
        source_metadata=active.source_metadata,
        rows=(bar("BTC", 9, day=1), bar("BTC", 9, day=10)),
    )

    window = ingestion_window("1d", now=NOW, active=truncated)

    assert window.fetch_start == NOW - timedelta(days=3653)
    assert window.overlap_start == window.fetch_start


@pytest.mark.parametrize(
    ("asset", "timeframe"),
    [("DOGE", "1h"), ("BTC", "4h"), ("", "1d")],
)
def test_selection_rejects_values_outside_the_catalog(
    asset: str, timeframe: str
) -> None:
    with pytest.raises(ValueError, match="Unsupported ingestion selection"):
        IngestionSelection(asset=asset, timeframe=timeframe)
