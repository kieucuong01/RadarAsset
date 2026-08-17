from __future__ import annotations

import csv
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import gzip
import hashlib
from io import StringIO
from pathlib import Path
from typing import Iterable

from backtest.models import Bar
from backtest.quality import canonical_bar_checksum, normalize_bars

from .contracts import DatasetManifest, PackageDigest


CSV_FIELDS = ("timestamp", "open", "high", "low", "close", "volume", "source")
MAX_DATASET_ROWS = 250_000


class DatasetSyncError(RuntimeError):
    pass


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _timestamp(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value):
        raise DatasetSyncError("Dataset timestamps must be UTC.")
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _decimal(value: Decimal | None, *, scale: int) -> str:
    if value is None:
        return ""
    return f"{value:.{scale}f}"


def _csv_line(values: tuple[str, ...]) -> bytes:
    buffer = StringIO(newline="")
    csv.writer(buffer, lineterminator="\n").writerow(values)
    return buffer.getvalue().encode("utf-8")


def encode_dataset(rows: Iterable[Bar], destination: Path) -> PackageDigest:
    normalized = tuple(normalize_bars(list(rows)))
    if not normalized:
        raise DatasetSyncError("Dataset package requires at least one bar.")
    if len(normalized) > MAX_DATASET_ROWS:
        raise DatasetSyncError("Dataset package exceeds the row limit.")
    if any(row.timeframe != "1d" for row in normalized):
        raise DatasetSyncError("Dataset package supports daily rows only.")
    if any(row.asset != normalized[0].asset for row in normalized):
        raise DatasetSyncError("Dataset package must contain one asset.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, filename="") as archive:
            archive.write(_csv_line(CSV_FIELDS))
            for row in normalized:
                archive.write(
                    _csv_line(
                        (
                            _timestamp(row.timestamp),
                            _decimal(row.open, scale=8),
                            _decimal(row.high, scale=8),
                            _decimal(row.low, scale=8),
                            _decimal(row.close, scale=8),
                            _decimal(row.volume, scale=4),
                            row.source,
                        )
                    )
                )
    return PackageDigest(
        row_count=len(normalized),
        coverage_start=normalized[0].timestamp,
        coverage_end=normalized[-1].timestamp,
        dataset_checksum=canonical_bar_checksum(list(normalized)),
        compressed_bytes=destination.stat().st_size,
        compressed_sha256=_sha256_file(destination),
    )


def _parse_timestamp(raw: str) -> datetime:
    if not raw.endswith("Z"):
        raise DatasetSyncError("Dataset timestamp must use UTC Z notation.")
    try:
        timestamp = datetime.fromisoformat(raw.removesuffix("Z") + "+00:00")
    except ValueError as error:
        raise DatasetSyncError("Dataset timestamp is invalid.") from error
    return timestamp.astimezone(timezone.utc)


def _parse_decimal(raw: str, *, field: str, allow_empty: bool = False) -> Decimal | None:
    if not raw and allow_empty:
        return None
    try:
        value = Decimal(raw)
    except InvalidOperation as error:
        raise DatasetSyncError(f"Dataset {field} is invalid.") from error
    if not value.is_finite():
        raise DatasetSyncError(f"Dataset {field} is invalid.")
    return value


def decode_dataset(
    path: Path,
    manifest: DatasetManifest,
    *,
    max_rows: int = MAX_DATASET_ROWS,
) -> tuple[Bar, ...]:
    if path.stat().st_size != manifest.compressed_bytes:
        raise DatasetSyncError("Compressed byte length does not match the manifest.")
    if _sha256_file(path) != manifest.compressed_sha256:
        raise DatasetSyncError("Compressed SHA-256 does not match the manifest.")
    rows: list[Bar] = []
    previous: datetime | None = None
    try:
        with gzip.open(path, "rt", encoding="utf-8", newline="") as archive:
            reader = csv.DictReader(archive)
            if tuple(reader.fieldnames or ()) != CSV_FIELDS:
                raise DatasetSyncError("Dataset CSV header is invalid.")
            for record in reader:
                if len(rows) >= max_rows:
                    raise DatasetSyncError("Dataset exceeds the configured row limit.")
                timestamp = _parse_timestamp(str(record["timestamp"]))
                if previous is not None and timestamp <= previous:
                    raise DatasetSyncError("Dataset timestamps must be strictly increasing.")
                open_price = _parse_decimal(str(record["open"]), field="open")
                high = _parse_decimal(str(record["high"]), field="high")
                low = _parse_decimal(str(record["low"]), field="low")
                close = _parse_decimal(str(record["close"]), field="close")
                volume = _parse_decimal(str(record["volume"]), field="volume", allow_empty=True)
                source = str(record["source"]).strip()
                if not source or volume is not None and volume < 0:
                    raise DatasetSyncError("Dataset source or volume is invalid.")
                assert open_price is not None and high is not None and low is not None and close is not None
                if low > min(open_price, close) or high < max(open_price, close) or low > high:
                    raise DatasetSyncError("Dataset OHLC values are invalid.")
                rows.append(
                    Bar(
                        asset=manifest.symbol,
                        timestamp=timestamp,
                        timeframe="1d",
                        open=open_price,
                        high=high,
                        low=low,
                        close=close,
                        volume=volume,
                        source=source,
                    )
                )
                previous = timestamp
    except OSError as error:
        raise DatasetSyncError("Compressed dataset cannot be decoded.") from error
    if len(rows) != manifest.row_count:
        raise DatasetSyncError("Dataset row count does not match the manifest.")
    if not rows or rows[0].timestamp != manifest.coverage_start or rows[-1].timestamp != manifest.coverage_end:
        raise DatasetSyncError("Dataset coverage does not match the manifest.")
    if canonical_bar_checksum(rows) != manifest.dataset_checksum:
        raise DatasetSyncError("Dataset checksum does not match the manifest.")
    return tuple(rows)
