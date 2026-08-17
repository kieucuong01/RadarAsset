from __future__ import annotations

from contextlib import AbstractContextManager
from dataclasses import dataclass
from decimal import Decimal
import hashlib
import os
from pathlib import Path
from typing import Any, Callable, Literal, Protocol, Sequence

from psycopg.errors import ForeignKeyViolation
from psycopg.rows import dict_row

from backtest.models import Bar
from backtest.publication import (
    PostgresDatasetPublisher,
    PreparedDatasetPublication,
    prepare_dataset_publication,
)

from .codec import DatasetSyncError, decode_dataset
from .contracts import BatchManifest, DatasetKey, DatasetManifest


@dataclass(frozen=True, slots=True)
class ImportPublication:
    dataset_version_id: str
    row_count: int
    quality_status: str


@dataclass(frozen=True, slots=True)
class DatasetImportOutcome:
    key: DatasetKey
    status: Literal["would_import", "already_present", "imported", "failed"]
    dataset_version_id: str | None
    row_count: int
    pruned_versions: int
    retained_versions: int
    prune_status: Literal["not_applicable", "pruned", "retained_due_to_reference"]
    error_code: str | None


@dataclass(frozen=True, slots=True)
class BatchImportReport:
    batch_id: str
    mode: Literal["dry_run", "apply", "verify"]
    outcomes: tuple[DatasetImportOutcome, ...]

    @property
    def counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for outcome in self.outcomes:
            counts[outcome.status] = counts.get(outcome.status, 0) + 1
            if outcome.prune_status == "retained_due_to_reference":
                counts["retained_due_to_reference"] = counts.get("retained_due_to_reference", 0) + 1
        return counts


class DatasetImportRepository(Protocol):
    def resolve_symbol(self, manifest: DatasetManifest) -> str: ...

    def current_checksum(self, manifest: DatasetManifest, symbol: str) -> str | None: ...

    def publish(self, prepared: PreparedDatasetPublication) -> ImportPublication: ...

    def prune_superseded(
        self, manifest: DatasetManifest, symbol: str, active_version_id: str
    ) -> tuple[int, int]: ...

    def transaction(self) -> AbstractContextManager[object]: ...


class DatasetStore(Protocol):
    def download_dataset(self, manifest: DatasetManifest, destination: Path) -> Path: ...


class DatasetImportCoordinator:
    def __init__(
        self,
        repository: DatasetImportRepository,
        *,
        decoder: Callable[[Path, DatasetManifest], tuple[Bar, ...]] = decode_dataset,
    ) -> None:
        self._repository = repository
        self._decoder = decoder

    def _preflight(self, manifest: DatasetManifest) -> tuple[str, str | None]:
        symbol = self._repository.resolve_symbol(manifest)
        return symbol, self._repository.current_checksum(manifest, symbol)

    @staticmethod
    def _outcome(
        manifest: DatasetManifest,
        status: Literal["would_import", "already_present", "imported", "failed"],
        *,
        dataset_version_id: str | None = None,
        row_count: int = 0,
        pruned_versions: int = 0,
        retained_versions: int = 0,
        error_code: str | None = None,
    ) -> DatasetImportOutcome:
        return DatasetImportOutcome(
            key=manifest.key,
            status=status,
            dataset_version_id=dataset_version_id,
            row_count=row_count,
            pruned_versions=pruned_versions,
            retained_versions=retained_versions,
            prune_status=(
                "retained_due_to_reference"
                if retained_versions
                else "pruned"
                if pruned_versions
                else "not_applicable"
            ),
            error_code=error_code,
        )

    def dry_run(self, manifest: BatchManifest, _: DatasetStore) -> BatchImportReport:
        outcomes: list[DatasetImportOutcome] = []
        for dataset in manifest.datasets:
            try:
                _, checksum = self._preflight(dataset)
                status: Literal["would_import", "already_present"] = (
                    "already_present" if checksum == dataset.dataset_checksum else "would_import"
                )
                outcomes.append(self._outcome(dataset, status, row_count=dataset.row_count))
            except Exception:
                outcomes.append(self._outcome(dataset, "failed", error_code="preflight_failed"))
        return BatchImportReport(manifest.batch_id, "dry_run", tuple(outcomes))

    @staticmethod
    def _spool_path(root: Path, manifest: DatasetManifest) -> Path:
        digest = hashlib.sha256(manifest.key.canonical_key.encode("utf-8")).hexdigest()[:16]
        return root / f"{digest}-{manifest.dataset_checksum[:12]}.csv.gz"

    @staticmethod
    def _prepared(
        manifest: DatasetManifest, rows: Sequence[Bar], symbol: str
    ) -> PreparedDatasetPublication:
        normalized_rows = [
            Bar(
                asset=symbol,
                timestamp=row.timestamp,
                timeframe=row.timeframe,
                open=row.open,
                high=row.high,
                low=row.low,
                close=row.close,
                volume=row.volume,
                source=row.source,
            )
            for row in rows
        ]
        prepared = prepare_dataset_publication(
            normalized_rows,
            market=manifest.market,
            provider_code=manifest.key.provider_code,
            provider_name=manifest.provider_name,
            provider_symbol=manifest.provider_symbol,
            canonical_key=manifest.key.canonical_key,
            asset_name=manifest.asset_name,
            currency=manifest.currency,
            venue=manifest.venue,
            timezone_name=manifest.timezone_name,
            maximum_leverage=Decimal(manifest.maximum_leverage),
            terms_url=manifest.terms_url,
            source_metadata=manifest.source_metadata,
            adjustment_policy="raw",
        )
        if (
            prepared.checksum != manifest.dataset_checksum
            or prepared.row_count != manifest.row_count
            or prepared.coverage_start != manifest.coverage_start
            or prepared.coverage_end != manifest.coverage_end
            or prepared.missing_bar_count != manifest.missing_bar_count
            or prepared.quality_status != manifest.quality_status
        ):
            raise DatasetSyncError("Dataset validation does not match the manifest.")
        return prepared

    def apply(self, manifest: BatchManifest, store: DatasetStore, spool_root: Path) -> BatchImportReport:
        spool_root.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(spool_root, 0o700)
        except OSError:
            pass
        outcomes: list[DatasetImportOutcome] = []
        for dataset in manifest.datasets:
            path: Path | None = None
            try:
                symbol, checksum = self._preflight(dataset)
                if checksum == dataset.dataset_checksum:
                    outcomes.append(self._outcome(dataset, "already_present", row_count=dataset.row_count))
                    continue
                path = self._spool_path(spool_root, dataset)
                store.download_dataset(dataset, path)
                prepared = self._prepared(dataset, self._decoder(path, dataset), symbol)
                with self._repository.transaction():
                    publication = self._repository.publish(prepared)
                    pruned, retained = self._repository.prune_superseded(
                        dataset, symbol, publication.dataset_version_id
                    )
                outcomes.append(
                    self._outcome(
                        dataset,
                        "imported",
                        dataset_version_id=publication.dataset_version_id,
                        row_count=publication.row_count,
                        pruned_versions=pruned,
                        retained_versions=retained,
                    )
                )
            except Exception:
                outcomes.append(self._outcome(dataset, "failed", error_code="import_failed"))
            finally:
                if path is not None:
                    path.unlink(missing_ok=True)
        return BatchImportReport(manifest.batch_id, "apply", tuple(outcomes))


class PostgresDatasetImportRepository:
    def __init__(self, connection: Any, *, publisher: Any | None = None) -> None:
        self._connection = connection
        self._publisher = publisher or PostgresDatasetPublisher(connection)

    def transaction(self) -> AbstractContextManager[object]:
        return self._connection.transaction()

    def resolve_symbol(self, manifest: DatasetManifest) -> str:
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT symbol, market
                FROM assets
                WHERE canonical_key = %s
                """,
                (manifest.key.canonical_key,),
            )
            canonical = cursor.fetchone()
            if canonical is not None:
                if str(canonical["market"]) != manifest.market:
                    raise DatasetSyncError("Canonical asset market does not match the manifest.")
                if str(canonical["symbol"]) != manifest.symbol:
                    raise DatasetSyncError("Canonical asset symbol does not match the manifest.")
                return str(canonical["symbol"])
            cursor.execute(
                "SELECT canonical_key FROM assets WHERE symbol = %s",
                (manifest.symbol,),
            )
            symbol = cursor.fetchone()
            if symbol is not None and str(symbol["canonical_key"] or "") != manifest.key.canonical_key:
                raise DatasetSyncError("Dataset symbol is owned by another canonical asset.")
        return manifest.symbol

    def current_checksum(self, manifest: DatasetManifest, symbol: str) -> str | None:
        active = self._publisher.load_active(symbol, manifest.key.timeframe, manifest.key.adjustment_policy)
        return None if active is None else str(active.checksum)

    def publish(self, prepared: PreparedDatasetPublication) -> ImportPublication:
        result = self._publisher.publish_if_changed(prepared, enqueue_evaluations=False)
        return ImportPublication(
            dataset_version_id=str(result.dataset_version_id),
            row_count=int(result.row_count),
            quality_status=str(result.quality_status),
        )

    def prune_superseded(
        self, manifest: DatasetManifest, symbol: str, active_version_id: str
    ) -> tuple[int, int]:
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT version.id
                FROM dataset_versions AS version
                JOIN datasets AS dataset ON dataset.id = version.dataset_id
                JOIN assets AS asset ON asset.id = dataset.asset_id
                WHERE asset.symbol = %s
                  AND dataset.timeframe = %s
                  AND dataset.adjustment_policy = %s
                  AND version.is_active = false
                  AND version.id <> %s
                ORDER BY version.published_at
                """,
                (symbol, manifest.key.timeframe, manifest.key.adjustment_policy, active_version_id),
            )
            inactive_ids = [str(row["id"]) for row in cursor.fetchall()]
        pruned = 0
        retained = 0
        for version_id in inactive_ids:
            try:
                with self._connection.transaction():
                    with self._connection.cursor() as cursor:
                        cursor.execute("DELETE FROM dataset_versions WHERE id = %s", (version_id,))
                        if cursor.rowcount != 1:
                            raise DatasetSyncError("Superseded dataset version disappeared during prune.")
                pruned += 1
            except ForeignKeyViolation:
                retained += 1
        return pruned, retained
