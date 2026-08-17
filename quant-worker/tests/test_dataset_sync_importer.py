from __future__ import annotations

from contextlib import nullcontext
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from backtest.models import Bar
from backtest.quality import canonical_bar_checksum
from dataset_sync.contracts import BatchManifest, DatasetKey, DatasetManifest
from dataset_sync.importer import (
    DatasetImportCoordinator,
    ImportPublication,
    PostgresDatasetImportRepository,
)


UTC = timezone.utc


def _bars() -> tuple[Bar, ...]:
    return tuple(
        Bar(
            asset="BTC",
            timestamp=datetime(2024, 1, day, tzinfo=UTC),
            timeframe="1d",
            open=Decimal("100"),
            high=Decimal("110"),
            low=Decimal("90"),
            close=Decimal("101"),
            volume=Decimal("10"),
            source="binance-public",
        )
        for day in range(1, 4)
    )


def _manifest() -> BatchManifest:
    rows = _bars()
    dataset = DatasetManifest(
        key=DatasetKey("binance-public", "CRYPTO:BTC", "1d", "raw"),
        symbol="BTC",
        asset_name="Bitcoin",
        market="crypto_spot",
        venue="BINANCE",
        currency="USDT",
        timezone_name="UTC",
        maximum_leverage="1",
        provider_name="Binance public",
        provider_symbol="BTCUSDT",
        terms_url=None,
        coverage_start=rows[0].timestamp,
        coverage_end=rows[-1].timestamp,
        row_count=len(rows),
        missing_bar_count=0,
        quality_status="passed",
        quality_summary={"status": "passed"},
        quality_issues=(),
        source_metadata={"mode": "live"},
        dataset_checksum=canonical_bar_checksum(list(rows)),
        object_key="operations/dataset-sync/20260817T010203Z-0123456789ab/datasets/BTC.csv.gz",
        compressed_bytes=1,
        compressed_sha256="a" * 64,
    )
    return BatchManifest(
        schema_version=1,
        batch_id="20260817T010203Z-0123456789ab",
        exported_at=datetime(2026, 8, 17, tzinfo=UTC),
        status="complete",
        datasets=(dataset,),
    )


class _Store:
    def __init__(self) -> None:
        self.downloads: list[Path] = []

    def download_dataset(self, _: DatasetManifest, destination: Path) -> Path:
        destination.write_bytes(b"package")
        self.downloads.append(destination)
        return destination


class _Repository:
    def __init__(self, *, active_checksum: str | None = None) -> None:
        self.active_checksum = active_checksum
        self.published: list[object] = []

    def resolve_symbol(self, _: DatasetManifest) -> str:
        return "BTC"

    def current_checksum(self, _: DatasetManifest, __: str) -> str | None:
        return self.active_checksum

    def publish(self, prepared: object) -> ImportPublication:
        self.published.append(prepared)
        return ImportPublication("dataset-version-1", 3, "passed")

    def prune_superseded(self, _: DatasetManifest, __: str, ___: str) -> tuple[int, int]:
        return (1, 0)

    def transaction(self):
        return nullcontext()


def test_dry_run_does_not_download_or_write() -> None:
    repository = _Repository()
    store = _Store()
    importer = DatasetImportCoordinator(repository, decoder=lambda *_: _bars())

    report = importer.dry_run(_manifest(), store)

    assert report.outcomes[0].status == "would_import"
    assert store.downloads == []
    assert repository.published == []


def test_apply_skips_matching_checksum_without_download(tmp_path: Path) -> None:
    manifest = _manifest()
    repository = _Repository(active_checksum=manifest.datasets[0].dataset_checksum)
    store = _Store()

    report = DatasetImportCoordinator(repository, decoder=lambda *_: _bars()).apply(
        manifest, store, tmp_path
    )

    assert report.outcomes[0].status == "already_present"
    assert store.downloads == []
    assert repository.published == []


def test_apply_imports_then_removes_the_vps_spool_file(tmp_path: Path) -> None:
    repository = _Repository()
    store = _Store()

    report = DatasetImportCoordinator(repository, decoder=lambda *_: _bars()).apply(
        _manifest(), store, tmp_path
    )

    assert report.outcomes[0].status == "imported"
    assert report.outcomes[0].pruned_versions == 1
    assert store.downloads[0].exists() is False
    assert repository.published


def test_postgres_repository_suppresses_strategy_fanout_for_bootstrap_import() -> None:
    class Publisher:
        def __init__(self) -> None:
            self.arguments: list[bool] = []

        def publish_if_changed(self, _: object, *, enqueue_evaluations: bool):
            self.arguments.append(enqueue_evaluations)
            return SimpleNamespace(
                dataset_version_id="dataset-version-1",
                row_count=3,
                quality_status="passed",
            )

    publisher = Publisher()
    repository = PostgresDatasetImportRepository(object(), publisher=publisher)
    prepared = DatasetImportCoordinator._prepared(_manifest().datasets[0], _bars(), "BTC")

    result = repository.publish(prepared)

    assert publisher.arguments == [False]
    assert result == ImportPublication("dataset-version-1", 3, "passed")
