from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
import json
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


def _datetime_to_json(value: datetime) -> str:
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _datetime_from_json(value: object, *, field: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError(f"Manifest {field} must be a UTC timestamp.")
    try:
        parsed = datetime.fromisoformat(value.removesuffix("Z") + "+00:00")
    except ValueError as error:
        raise ValueError(f"Manifest {field} is invalid.") from error
    if parsed.tzinfo is None:
        raise ValueError(f"Manifest {field} must be timezone-aware.")
    return parsed


def _dataset_to_json(dataset: DatasetManifest) -> dict[str, Any]:
    return {
        "key": {
            "provider_code": dataset.key.provider_code,
            "canonical_key": dataset.key.canonical_key,
            "timeframe": dataset.key.timeframe,
            "adjustment_policy": dataset.key.adjustment_policy,
        },
        "symbol": dataset.symbol,
        "asset_name": dataset.asset_name,
        "market": dataset.market,
        "venue": dataset.venue,
        "currency": dataset.currency,
        "timezone_name": dataset.timezone_name,
        "maximum_leverage": dataset.maximum_leverage,
        "provider_name": dataset.provider_name,
        "provider_symbol": dataset.provider_symbol,
        "terms_url": dataset.terms_url,
        "coverage_start": _datetime_to_json(dataset.coverage_start),
        "coverage_end": _datetime_to_json(dataset.coverage_end),
        "row_count": dataset.row_count,
        "missing_bar_count": dataset.missing_bar_count,
        "quality_status": dataset.quality_status,
        "quality_summary": dataset.quality_summary,
        "quality_issues": list(dataset.quality_issues),
        "source_metadata": dataset.source_metadata,
        "dataset_checksum": dataset.dataset_checksum,
        "object_key": dataset.object_key,
        "compressed_bytes": dataset.compressed_bytes,
        "compressed_sha256": dataset.compressed_sha256,
    }


def serialize_manifest(manifest: BatchManifest) -> bytes:
    payload = {
        "schema_version": manifest.schema_version,
        "batch_id": manifest.batch_id,
        "exported_at": _datetime_to_json(manifest.exported_at),
        "status": manifest.status,
        "datasets": [_dataset_to_json(dataset) for dataset in manifest.datasets],
    }
    return json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _require_keys(value: object, expected: set[str], *, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"Manifest {field} must be an object.")
    keys = set(value)
    unknown = keys - expected
    missing = expected - keys
    if unknown:
        raise ValueError(f"Manifest {field} contains unknown fields.")
    if missing:
        raise ValueError(f"Manifest {field} is missing required fields.")
    return value


def _dataset_from_json(value: object) -> DatasetManifest:
    fields = {
        "key", "symbol", "asset_name", "market", "venue", "currency", "timezone_name",
        "maximum_leverage", "provider_name", "provider_symbol", "terms_url", "coverage_start",
        "coverage_end", "row_count", "missing_bar_count", "quality_status", "quality_summary",
        "quality_issues", "source_metadata", "dataset_checksum", "object_key", "compressed_bytes",
        "compressed_sha256",
    }
    item = _require_keys(value, fields, field="dataset")
    key = _require_keys(
        item["key"],
        {"provider_code", "canonical_key", "timeframe", "adjustment_policy"},
        field="dataset key",
    )
    if not isinstance(item["quality_summary"], dict) or not isinstance(item["source_metadata"], dict):
        raise ValueError("Manifest dataset metadata must be an object.")
    if not isinstance(item["quality_issues"], list):
        raise ValueError("Manifest dataset quality issues must be a list.")
    return DatasetManifest(
        key=DatasetKey(**key),
        symbol=str(item["symbol"]),
        asset_name=str(item["asset_name"]),
        market=str(item["market"]),
        venue=str(item["venue"]),
        currency=str(item["currency"]),
        timezone_name=str(item["timezone_name"]),
        maximum_leverage=str(item["maximum_leverage"]),
        provider_name=str(item["provider_name"]),
        provider_symbol=str(item["provider_symbol"]),
        terms_url=None if item["terms_url"] is None else str(item["terms_url"]),
        coverage_start=_datetime_from_json(item["coverage_start"], field="coverage_start"),
        coverage_end=_datetime_from_json(item["coverage_end"], field="coverage_end"),
        row_count=int(item["row_count"]),
        missing_bar_count=int(item["missing_bar_count"]),
        quality_status=str(item["quality_status"]),
        quality_summary=item["quality_summary"],
        quality_issues=tuple(item["quality_issues"]),
        source_metadata=item["source_metadata"],
        dataset_checksum=str(item["dataset_checksum"]),
        object_key=str(item["object_key"]),
        compressed_bytes=int(item["compressed_bytes"]),
        compressed_sha256=str(item["compressed_sha256"]),
    )


def parse_manifest(payload: bytes) -> BatchManifest:
    try:
        parsed = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Manifest JSON is invalid.") from error
    value = _require_keys(
        parsed,
        {"schema_version", "batch_id", "exported_at", "status", "datasets"},
        field="root",
    )
    if not isinstance(value["datasets"], list):
        raise ValueError("Manifest datasets must be a list.")
    return BatchManifest(
        schema_version=int(value["schema_version"]),
        batch_id=str(value["batch_id"]),
        exported_at=_datetime_from_json(value["exported_at"], field="exported_at"),
        status=str(value["status"]),
        datasets=tuple(_dataset_from_json(dataset) for dataset in value["datasets"]),
    )
