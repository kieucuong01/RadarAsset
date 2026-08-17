from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest

from backtest.models import Bar
from backtest.quality import canonical_bar_checksum
from dataset_sync.exporter import DatasetExportRecord, build_exported_batch
from dataset_sync.selection import EligibilityCandidate
from dataset_sync.storage import DatasetSyncS3Store


UTC = timezone.utc


class _S3:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], tuple[bytes, dict[str, str]]] = {}
        self.put_keys: list[str] = []
        self.head_keys: list[str] = []

    def put_object(self, **kwargs: Any) -> None:
        body = kwargs["Body"]
        payload = body if isinstance(body, bytes) else body.read()
        self.objects[(kwargs["Bucket"], kwargs["Key"])] = (payload, kwargs.get("Metadata", {}))
        self.put_keys.append(kwargs["Key"])

    def head_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        self.head_keys.append(Key)
        payload, metadata = self.objects[(Bucket, Key)]
        return {"ContentLength": len(payload), "Metadata": metadata}

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        payload, metadata = self.objects[(Bucket, Key)]
        return {"Body": BytesIO(payload), "ContentLength": len(payload), "Metadata": metadata}


def _batch(tmp_path: Path):
    candidate = EligibilityCandidate(
        dataset_version_id="00000000-0000-0000-0000-000000000001",
        provider_code="binance-public",
        provider_active=True,
        instrument_active=True,
        canonical_key="CRYPTO:BTC",
        symbol="BTC",
        market="crypto_spot",
        timeframe="1d",
        adjustment_policy="raw",
        coverage_end=datetime(2024, 1, 3, tzinfo=UTC),
        declared_row_count=3,
        actual_row_count=3,
        quality_status="passed",
        source_metadata={"mode": "live"},
        row_sources=("binance-public",),
    )
    rows = tuple(
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
    return build_exported_batch(
        (
            DatasetExportRecord(
                candidate=candidate,
                declared_dataset_checksum=canonical_bar_checksum(list(rows)),
                provider_name="Binance public",
                provider_symbol="BTCUSDT",
                terms_url=None,
                asset_name="Bitcoin",
                venue="BINANCE",
                currency="USDT",
                timezone_name="UTC",
                maximum_leverage=Decimal("1"),
                coverage_start=rows[0].timestamp,
                missing_bar_count=0,
                quality_summary={"status": "passed"},
                quality_issues=(),
                rows=rows,
            ),
        ),
        tmp_path,
        now=datetime(2026, 8, 17, 1, 2, 3, tzinfo=UTC),
    )


def test_storage_verifies_dataset_objects_before_publishing_manifest(tmp_path: Path) -> None:
    client = _S3()
    batch = _batch(tmp_path)

    stored = DatasetSyncS3Store(client, "datavest").upload_batch(batch)

    assert client.put_keys[-1].endswith("/manifest.json")
    assert client.head_keys[-1] == client.put_keys[-1]
    assert len(client.head_keys) >= len(client.put_keys)
    assert stored.manifest_locator == (
        "s3://datavest/operations/dataset-sync/20260817T010203Z-7ac1b8d7010b/manifest.json"
    )


def test_storage_rejects_manifest_outside_the_private_dataset_prefix() -> None:
    with pytest.raises(ValueError, match="configured dataset sync prefix"):
        DatasetSyncS3Store(_S3(), "datavest").read_manifest(
            "s3://datavest/operations/dataset-sync/../other/manifest.json"
        )
