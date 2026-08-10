from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Protocol

import psycopg
from psycopg.rows import dict_row

from .models import Bar, QualityIssue
from .quality import canonical_bar_checksum, normalize_bars, validate_bars


PRICE_STORAGE_QUANTUM = Decimal("0.00000001")
VOLUME_STORAGE_QUANTUM = Decimal("0.0001")


def _quantize_for_storage(row: Bar) -> Bar:
    return Bar(
        asset=row.asset,
        timestamp=row.timestamp,
        timeframe=row.timeframe,
        open=row.open.quantize(PRICE_STORAGE_QUANTUM, rounding=ROUND_HALF_UP),
        high=row.high.quantize(PRICE_STORAGE_QUANTUM, rounding=ROUND_HALF_UP),
        low=row.low.quantize(PRICE_STORAGE_QUANTUM, rounding=ROUND_HALF_UP),
        close=row.close.quantize(PRICE_STORAGE_QUANTUM, rounding=ROUND_HALF_UP),
        volume=(
            None
            if row.volume is None
            else row.volume.quantize(VOLUME_STORAGE_QUANTUM, rounding=ROUND_HALF_UP)
        ),
        source=row.source,
    )


@dataclass(frozen=True)
class PreparedDatasetPublication:
    asset: str
    market: str
    timeframe: str
    provider_code: str
    provider_name: str
    provider_symbol: str
    canonical_key: str
    asset_name: str
    currency: str
    venue: str
    timezone_name: str
    maximum_leverage: Decimal
    terms_url: str | None
    source_metadata: dict[str, Any]
    rows: tuple[Bar, ...]
    issues: tuple[QualityIssue, ...]
    checksum: str
    row_count: int
    missing_bar_count: int
    quality_status: str
    coverage_start: datetime
    coverage_end: datetime


class DatasetPublisher(Protocol):
    def publish(self, prepared: PreparedDatasetPublication) -> dict[str, Any]: ...


def prepare_dataset_publication(
    rows: list[Bar],
    *,
    market: str,
    provider_code: str,
    provider_name: str,
    provider_symbol: str,
    canonical_key: str,
    asset_name: str,
    currency: str,
    venue: str,
    timezone_name: str,
    maximum_leverage: Decimal,
    terms_url: str | None,
    source_metadata: dict[str, Any],
) -> PreparedDatasetPublication:
    normalized = [_quantize_for_storage(row) for row in normalize_bars(rows)]
    if not normalized:
        raise ValueError("Dataset publication requires at least one bar.")
    assets = {row.asset for row in normalized}
    timeframes = {row.timeframe for row in normalized}
    if len(assets) != 1 or len(timeframes) != 1:
        raise ValueError("A dataset version must contain one asset and one timeframe.")
    report = validate_bars(normalized, market=market)
    if report.status == "failed":
        raise ValueError("Dataset quality validation failed.")
    return PreparedDatasetPublication(
        asset=normalized[0].asset,
        market=market,
        timeframe=normalized[0].timeframe,
        provider_code=provider_code,
        provider_name=provider_name,
        provider_symbol=provider_symbol,
        canonical_key=canonical_key,
        asset_name=asset_name,
        currency=currency,
        venue=venue,
        timezone_name=timezone_name,
        maximum_leverage=maximum_leverage,
        terms_url=terms_url,
        source_metadata=dict(source_metadata),
        rows=tuple(normalized),
        issues=report.issues,
        checksum=canonical_bar_checksum(normalized),
        row_count=len(normalized),
        missing_bar_count=report.missing_bar_count,
        quality_status=report.status,
        coverage_start=normalized[0].timestamp,
        coverage_end=normalized[-1].timestamp,
    )


def publish_dataset(
    publisher: DatasetPublisher,
    prepared: PreparedDatasetPublication,
) -> dict[str, Any]:
    return publisher.publish(prepared)


class PostgresDatasetPublisher:
    def __init__(self, connection: psycopg.Connection[Any]) -> None:
        self.connection = connection

    def publish(self, prepared: PreparedDatasetPublication) -> dict[str, Any]:
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                INSERT INTO data_providers (
                    id, code, name, terms_url, license_scope, status, created_at, updated_at
                ) VALUES (
                    gen_random_uuid(), %s, %s, %s, 'research_only', 'active', NOW(), NOW()
                )
                ON CONFLICT (code) DO UPDATE
                SET name = EXCLUDED.name,
                    terms_url = EXCLUDED.terms_url,
                    license_scope = 'research_only',
                    status = 'active',
                    updated_at = NOW()
                RETURNING id
                """,
                (prepared.provider_code, prepared.provider_name, prepared.terms_url),
            )
            provider_id = str(cursor.fetchone()["id"])
            asset_class = (
                "equity"
                if prepared.market == "vn_equity"
                else "crypto"
                if prepared.market == "crypto_spot"
                else "commodity"
            )
            cursor.execute(
                """
                INSERT INTO assets (
                    id, symbol, canonical_key, name, asset_class, market, venue, timezone,
                    max_leverage, currency, provider, provider_symbol, created_at, updated_at
                ) VALUES (
                    gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, NOW(), NOW()
                )
                ON CONFLICT (symbol) DO UPDATE
                SET canonical_key = EXCLUDED.canonical_key,
                    name = EXCLUDED.name,
                    asset_class = EXCLUDED.asset_class,
                    market = EXCLUDED.market,
                    venue = EXCLUDED.venue,
                    timezone = EXCLUDED.timezone,
                    max_leverage = EXCLUDED.max_leverage,
                    currency = EXCLUDED.currency,
                    provider = EXCLUDED.provider,
                    provider_symbol = EXCLUDED.provider_symbol,
                    updated_at = NOW()
                RETURNING id
                """,
                (
                    prepared.asset,
                    prepared.canonical_key,
                    prepared.asset_name,
                    asset_class,
                    prepared.market,
                    prepared.venue,
                    prepared.timezone_name,
                    prepared.maximum_leverage,
                    prepared.currency,
                    prepared.provider_code,
                    prepared.provider_symbol,
                ),
            )
            asset_id = str(cursor.fetchone()["id"])
            cursor.execute(
                """
                INSERT INTO provider_instruments (
                    id, provider_id, asset_id, provider_symbol, metadata, created_at
                ) VALUES (gen_random_uuid(), %s, %s, %s, %s::jsonb, NOW())
                ON CONFLICT (provider_id, asset_id) DO UPDATE
                SET provider_symbol = EXCLUDED.provider_symbol,
                    metadata = EXCLUDED.metadata
                """,
                (
                    provider_id,
                    asset_id,
                    prepared.provider_symbol,
                    json.dumps(prepared.source_metadata, separators=(",", ":")),
                ),
            )
            cursor.execute(
                """
                INSERT INTO datasets (id, asset_id, timeframe, adjustment_policy, created_at)
                VALUES (gen_random_uuid(), %s, %s, 'raw', NOW())
                ON CONFLICT (asset_id, timeframe, adjustment_policy) DO UPDATE
                SET timeframe = EXCLUDED.timeframe
                RETURNING id
                """,
                (asset_id, prepared.timeframe),
            )
            dataset_id = str(cursor.fetchone()["id"])
            cursor.execute("SELECT id FROM datasets WHERE id = %s FOR UPDATE", (dataset_id,))
            cursor.fetchone()
            cursor.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM dataset_versions WHERE dataset_id = %s",
                (dataset_id,),
            )
            version_number = int(cursor.fetchone()["next_version"])
            quality_summary = {
                "status": prepared.quality_status,
                "missingBarCount": prepared.missing_bar_count,
                "issueCount": len(prepared.issues),
            }
            cursor.execute(
                """
                INSERT INTO dataset_versions (
                    id, dataset_id, provider_id, version, checksum, coverage_start,
                    coverage_end, row_count, missing_bar_count, quality_status,
                    quality_summary, source_metadata, is_active, published_at
                ) VALUES (
                    gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s::jsonb, %s::jsonb, false, NOW()
                )
                RETURNING id
                """,
                (
                    dataset_id,
                    provider_id,
                    version_number,
                    prepared.checksum,
                    prepared.coverage_start,
                    prepared.coverage_end,
                    prepared.row_count,
                    prepared.missing_bar_count,
                    prepared.quality_status,
                    json.dumps(quality_summary, separators=(",", ":")),
                    json.dumps(prepared.source_metadata, separators=(",", ":")),
                ),
            )
            version_id = str(cursor.fetchone()["id"])
            cursor.executemany(
                """
                INSERT INTO dataset_bars (
                    id, dataset_version_id, ts, open, high, low, close, volume,
                    source, quality_flags, ingested_at
                ) VALUES (
                    gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, '[]'::jsonb, NOW()
                )
                """,
                [
                    (
                        version_id,
                        row.timestamp,
                        row.open,
                        row.high,
                        row.low,
                        row.close,
                        row.volume,
                        row.source,
                    )
                    for row in prepared.rows
                ],
            )
            if prepared.issues:
                cursor.executemany(
                    """
                    INSERT INTO data_quality_issues (
                        id, dataset_version_id, code, severity, ts, details, created_at
                    ) VALUES (gen_random_uuid(), %s, %s, %s, %s, %s::jsonb, NOW())
                    """,
                    [
                        (
                            version_id,
                            issue.code,
                            issue.severity,
                            issue.timestamp,
                            json.dumps(issue.details, separators=(",", ":")),
                        )
                        for issue in prepared.issues
                    ],
                )
            cursor.execute(
                "SELECT COUNT(*) AS row_count FROM dataset_bars WHERE dataset_version_id = %s",
                (version_id,),
            )
            stored_count = int(cursor.fetchone()["row_count"])
            if stored_count != prepared.row_count:
                raise RuntimeError("Stored dataset row count does not match the manifest.")
            cursor.execute(
                "UPDATE dataset_versions SET is_active = false WHERE dataset_id = %s AND is_active = true",
                (dataset_id,),
            )
            cursor.execute(
                "UPDATE dataset_versions SET is_active = true WHERE id = %s",
                (version_id,),
            )
        return {
            "datasetVersionId": version_id,
            "version": version_number,
            "active": True,
            "checksum": prepared.checksum,
            "rowCount": prepared.row_count,
            "missingBarCount": prepared.missing_bar_count,
            "qualityStatus": prepared.quality_status,
        }
