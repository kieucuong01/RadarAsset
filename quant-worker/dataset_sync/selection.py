from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
import json
import re
from typing import Any, Literal

from psycopg.rows import dict_row

from backtest.daily_scope import APPROVED_DAILY_PROVIDER_CODES


ALLOWED_MARKETS = frozenset({"vn_equity", "crypto_spot", "metal_spot"})
ALLOWED_QUALITY = frozenset({"passed", "warning"})
UNTRUSTED_MARKERS = frozenset(
    {"fixture", "research_fixture", "demo", "seed", "seeded", "simulated", "synthetic"}
)
MAX_STALENESS = timedelta(days=3)
_TOKENS = re.compile(r"[a-z0-9_]+")


@dataclass(frozen=True, slots=True)
class EligibilityCandidate:
    dataset_version_id: str
    provider_code: str
    provider_active: bool
    instrument_active: bool
    canonical_key: str
    symbol: str
    market: str
    timeframe: str
    adjustment_policy: str
    coverage_end: datetime
    declared_row_count: int
    actual_row_count: int
    quality_status: str
    source_metadata: dict[str, Any]
    row_sources: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class EligibilityDecision:
    candidate: EligibilityCandidate
    status: Literal[
        "eligible",
        "skipped_stale",
        "skipped_quality",
        "skipped_untrusted",
        "skipped_invalid",
    ]


@dataclass(frozen=True, slots=True)
class EligibilityReport:
    decisions: tuple[EligibilityDecision, ...]

    @property
    def counts(self) -> dict[str, int]:
        result: dict[str, int] = {}
        for decision in self.decisions:
            result[decision.status] = result.get(decision.status, 0) + 1
        return result


def _contains_untrusted_marker(value: object) -> bool:
    if isinstance(value, dict):
        return any(_contains_untrusted_marker(item) for item in value.values())
    if isinstance(value, (list, tuple, set, frozenset)):
        return any(_contains_untrusted_marker(item) for item in value)
    if not isinstance(value, str):
        return False
    return bool(set(_TOKENS.findall(value.lower())) & UNTRUSTED_MARKERS)


def classify_candidate(candidate: EligibilityCandidate, *, now: datetime) -> EligibilityDecision:
    if (
        candidate.timeframe != "1d"
        or candidate.adjustment_policy != "raw"
        or candidate.market not in ALLOWED_MARKETS
        or candidate.declared_row_count < 1
        or candidate.actual_row_count != candidate.declared_row_count
        or candidate.coverage_end.tzinfo is None
    ):
        return EligibilityDecision(candidate, "skipped_invalid")
    if (
        not candidate.provider_active
        or not candidate.instrument_active
        or candidate.provider_code not in APPROVED_DAILY_PROVIDER_CODES
        or _contains_untrusted_marker(candidate.source_metadata)
        or _contains_untrusted_marker(candidate.row_sources)
    ):
        return EligibilityDecision(candidate, "skipped_untrusted")
    if candidate.quality_status not in ALLOWED_QUALITY:
        return EligibilityDecision(candidate, "skipped_quality")
    if candidate.coverage_end < now - MAX_STALENESS:
        return EligibilityDecision(candidate, "skipped_stale")
    return EligibilityDecision(candidate, "eligible")


def _metadata(value: object) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _as_utc_datetime(value: object) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            # Historical dataset columns are stored as PostgreSQL timestamps
            # without timezone. Their contract is UTC, matching dataset bars.
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, date):
        return datetime.combine(value, time.min, tzinfo=timezone.utc)
    raise ValueError("Dataset coverage timestamp is invalid.")


def scan_datasets(connection: Any, *, now: datetime) -> EligibilityReport:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT version.id AS dataset_version_id,
                   provider.code AS provider_code,
                   provider.status = 'active' AS provider_active,
                   EXISTS (
                       SELECT 1
                       FROM provider_instruments AS instrument
                       WHERE instrument.asset_id = asset.id
                         AND instrument.provider_id = provider.id
                         AND instrument.is_active = true
                   ) AS instrument_active,
                   asset.canonical_key,
                   asset.symbol,
                   asset.market,
                   dataset.timeframe,
                   dataset.adjustment_policy,
                   version.coverage_end,
                   version.row_count AS declared_row_count,
                   COUNT(bar.id)::int AS actual_row_count,
                   version.quality_status,
                   version.source_metadata,
                   ARRAY_AGG(DISTINCT bar.source) FILTER (WHERE bar.source IS NOT NULL) AS row_sources
            FROM dataset_versions AS version
            JOIN datasets AS dataset ON dataset.id = version.dataset_id
            JOIN assets AS asset ON asset.id = dataset.asset_id
            JOIN data_providers AS provider ON provider.id = version.provider_id
            LEFT JOIN dataset_bars AS bar ON bar.dataset_version_id = version.id
            WHERE version.is_active = true
            GROUP BY version.id, provider.id, asset.id, dataset.id
            ORDER BY asset.market, asset.symbol
            """
        )
        rows = cursor.fetchall()
    decisions = tuple(
        classify_candidate(
            EligibilityCandidate(
                dataset_version_id=str(row["dataset_version_id"]),
                provider_code=str(row["provider_code"]),
                provider_active=bool(row["provider_active"]),
                instrument_active=bool(row["instrument_active"]),
                canonical_key=str(row["canonical_key"] or ""),
                symbol=str(row["symbol"]),
                market=str(row["market"]),
                timeframe=str(row["timeframe"]),
                adjustment_policy=str(row["adjustment_policy"]),
                coverage_end=_as_utc_datetime(row["coverage_end"]),
                declared_row_count=int(row["declared_row_count"]),
                actual_row_count=int(row["actual_row_count"]),
                quality_status=str(row["quality_status"]),
                source_metadata=_metadata(row["source_metadata"]),
                row_sources=tuple(str(source) for source in row["row_sources"] or ()),
            ),
            now=now,
        )
        for row in rows
    )
    return EligibilityReport(decisions)
