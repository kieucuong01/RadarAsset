from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
import re


_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_BATCH_ID = re.compile(r"^\d{8}T\d{6}Z-[0-9a-f]{12}$")
_ALLOWED_MARKETS = frozenset({"vn_equity", "crypto_spot", "metal_spot"})
_ALLOWED_QUALITY = frozenset({"passed", "warning"})


@dataclass(frozen=True, slots=True)
class DatasetKey:
    provider_code: str
    canonical_key: str
    timeframe: Literal["1d"]
    adjustment_policy: Literal["raw"]

    def __post_init__(self) -> None:
        if not self.provider_code.strip() or not self.canonical_key.strip():
            raise ValueError("Dataset key requires provider and canonical key.")
        if self.timeframe != "1d" or self.adjustment_policy != "raw":
            raise ValueError("Dataset sync supports daily raw datasets only.")


@dataclass(frozen=True, slots=True)
class PackageDigest:
    row_count: int
    coverage_start: datetime
    coverage_end: datetime
    dataset_checksum: str
    compressed_bytes: int
    compressed_sha256: str


@dataclass(frozen=True, slots=True)
class DatasetManifest:
    key: DatasetKey
    symbol: str
    asset_name: str
    market: str
    venue: str
    currency: str
    timezone_name: str
    maximum_leverage: str
    provider_name: str
    provider_symbol: str
    terms_url: str | None
    coverage_start: datetime
    coverage_end: datetime
    row_count: int
    missing_bar_count: int
    quality_status: str
    quality_summary: dict[str, Any]
    quality_issues: tuple[Any, ...]
    source_metadata: dict[str, Any]
    dataset_checksum: str
    object_key: str
    compressed_bytes: int
    compressed_sha256: str

    def __post_init__(self) -> None:
        if not self.symbol.strip() or not self.asset_name.strip():
            raise ValueError("Dataset manifest requires symbol and asset name.")
        if self.market not in _ALLOWED_MARKETS:
            raise ValueError("Dataset market is not eligible for sync.")
        if self.coverage_start.tzinfo is None or self.coverage_end.tzinfo is None:
            raise ValueError("Dataset coverage must be timezone-aware.")
        if self.coverage_start > self.coverage_end:
            raise ValueError("Dataset coverage range is invalid.")
        if self.row_count < 1 or self.missing_bar_count < 0:
            raise ValueError("Dataset row counts are invalid.")
        if self.quality_status not in _ALLOWED_QUALITY:
            raise ValueError("Dataset quality status is not eligible for sync.")
        if not _SHA256.fullmatch(self.dataset_checksum):
            raise ValueError("Dataset checksum is invalid.")
        if not _SHA256.fullmatch(self.compressed_sha256):
            raise ValueError("Compressed dataset checksum is invalid.")
        parts = self.object_key.split("/")
        if (
            not self.object_key.startswith("operations/dataset-sync/")
            or any(part in {"", ".", ".."} for part in parts)
            or not self.object_key.endswith(".csv.gz")
        ):
            raise ValueError("Dataset object key is invalid.")
        if self.compressed_bytes < 1:
            raise ValueError("Compressed dataset byte count is invalid.")


@dataclass(frozen=True, slots=True)
class BatchManifest:
    schema_version: Literal[1]
    batch_id: str
    exported_at: datetime
    status: Literal["complete"]
    datasets: tuple[DatasetManifest, ...]

    def __post_init__(self) -> None:
        if self.schema_version != 1 or self.status != "complete":
            raise ValueError("Dataset sync manifest must be complete schema version 1.")
        if not _BATCH_ID.fullmatch(self.batch_id):
            raise ValueError("Dataset sync batch identifier is invalid.")
        if self.exported_at.tzinfo is None:
            raise ValueError("Dataset sync export timestamp must be timezone-aware.")
        keys = {dataset.key for dataset in self.datasets}
        if len(keys) != len(self.datasets):
            raise ValueError("Dataset sync manifest keys must be unique.")
