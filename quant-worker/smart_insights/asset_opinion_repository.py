from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from psycopg.rows import dict_row

from .asset_opinion_contracts import AssetOpinionMarketData, MarketBar, QuantFact
from .asset_opinion_quant import canonical_symbol


BAR_QUERY = """
WITH candidate_versions AS (
  SELECT version.id AS dataset_version_id,
         asset.symbol AS asset_symbol,
         version.published_at,
         ROW_NUMBER() OVER (
           PARTITION BY asset.id
           ORDER BY
             CASE
               WHEN asset.market = 'vn_equity' AND dataset.adjustment_policy = 'total_return' THEN 0
               WHEN dataset.adjustment_policy = 'raw' THEN 1
               ELSE 2
             END,
             version.published_at DESC,
             version.version DESC,
             version.id
         ) AS dataset_rank
  FROM dataset_versions version
  JOIN datasets dataset ON dataset.id = version.dataset_id
  JOIN assets asset ON asset.id = dataset.asset_id
  WHERE asset.symbol = ANY(%s)
    AND dataset.timeframe = '1d'
    AND dataset.adjustment_policy IN ('raw', 'total_return')
    AND version.is_active = true
    AND version.quality_status IN ('passed', 'warning')
    AND version.published_at <= (%s AT TIME ZONE current_setting('TIMEZONE'))
), ranked AS (
  SELECT bar.id,
         selected.asset_symbol,
         bar.ts,
         bar.close,
         selected.published_at AT TIME ZONE current_setting('TIMEZONE') AS observed_at,
         ROW_NUMBER() OVER (
           PARTITION BY selected.asset_symbol
           ORDER BY bar.ts DESC, bar.ingested_at DESC, bar.id
         ) AS row_number
  FROM candidate_versions selected
  JOIN dataset_bars bar ON bar.dataset_version_id = selected.dataset_version_id
  WHERE selected.dataset_rank = 1
    AND bar.ts <= %s
    AND bar.ingested_at <= (%s AT TIME ZONE current_setting('TIMEZONE'))
)
SELECT id, asset_symbol, ts, close, observed_at
FROM ranked
WHERE row_number <= 260
ORDER BY asset_symbol, ts, id
"""


FACT_QUERY = """
WITH ranked AS (
  SELECT observation.id,
         asset.symbol AS asset_symbol,
         metric.code AS metric_code,
         observation.value,
         metric.unit,
         metric.direction,
         metric.methodology_version,
         metric.freshness_sla_minutes,
         observation.effective_at,
         observation.observed_at,
         observation.quality_status,
         provider.code AS provider_code,
         snapshot.source_url,
         COALESCE((metric.metadata ->> 'critical')::boolean, false) AS critical,
         ROW_NUMBER() OVER (
           PARTITION BY observation.natural_key
           ORDER BY observation.revision DESC
         ) AS revision_rank
  FROM metric_observations observation
  JOIN metric_definitions metric ON metric.id = observation.metric_definition_id
  JOIN data_providers provider ON provider.id = observation.provider_id
  JOIN insight_raw_snapshots snapshot ON snapshot.id = observation.raw_snapshot_id
  LEFT JOIN assets asset ON asset.id = observation.asset_id
  WHERE (asset.symbol = ANY(%s) OR observation.asset_id IS NULL)
    AND observation.effective_at <= %s
    AND observation.observed_at <= %s
    AND observation.quality_status IN ('passed', 'warning')
    AND snapshot.status = 'validated'
), scored AS (
  SELECT ranked.*,
         matched.signal_score
  FROM ranked
  LEFT JOIN LATERAL (
    SELECT (input ->> 'score')::numeric AS signal_score
    FROM signal_snapshots signal
    CROSS JOIN LATERAL jsonb_array_elements(signal.inputs) input
    WHERE signal.effective_at <= %s
      AND input -> 'sourceObservationIds' ? ranked.id::text
    ORDER BY signal.effective_at DESC, signal.created_at DESC
    LIMIT 1
  ) matched ON true
  WHERE ranked.revision_rank = 1
)
SELECT id, asset_symbol, metric_code, value, unit, direction,
       methodology_version, freshness_sla_minutes, effective_at, observed_at,
       quality_status, provider_code, source_url, critical, signal_score
FROM scored
ORDER BY asset_symbol NULLS FIRST, metric_code, effective_at, id
LIMIT 2000
"""


UNIT_MAP = {
    "%": "PERCENT",
    "percent": "PERCENT",
    "index": "INDEX",
    "basis points": "BASIS_POINTS",
    "usd million": "USD_MILLION",
    "tonnes": "TONNES",
    "count": "COUNT",
    "ratio": "RATIO",
    "score": "SCORE",
    "days": "DAYS",
}


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _score(value: object) -> Decimal | None:
    if value is None:
        return None
    parsed = Decimal(str(value))
    return max(Decimal("-100"), min(Decimal("100"), parsed))


def _unit(value: object) -> str:
    normalized = " ".join(str(value).strip().casefold().split())
    return UNIT_MAP.get(normalized, "RATIO")


def load_asset_opinion_market_data(
    connection: Any,
    symbols: tuple[str, ...],
    benchmark_symbols: tuple[str, ...],
    as_of: datetime,
) -> AssetOpinionMarketData:
    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("as_of must be timezone-aware.")
    canonical_assets = tuple(dict.fromkeys(canonical_symbol(value) for value in symbols))
    if len(canonical_assets) > 25:
        raise ValueError("Asset opinion loader accepts at most 25 opinion assets.")
    requested = tuple(
        dict.fromkeys(
            (*canonical_assets, *(canonical_symbol(value) for value in benchmark_symbols))
        )
    )
    if not canonical_assets:
        return AssetOpinionMarketData((), ())

    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(BAR_QUERY, (list(requested), as_of, as_of, as_of))
        raw_bars = tuple(cursor.fetchall())
        cursor.execute(FACT_QUERY, (list(canonical_assets), as_of, as_of, as_of))
        raw_facts = tuple(cursor.fetchall())

    bars_by_symbol: dict[str, dict[datetime, MarketBar]] = defaultdict(dict)
    for row in raw_bars:
        ts = _aware(row["ts"])
        observed_at = _aware(row["observed_at"])
        symbol = canonical_symbol(str(row["asset_symbol"]))
        if symbol not in requested or ts > as_of or observed_at > as_of:
            continue
        candidate = MarketBar(
            id=str(row["id"]),
            symbol=symbol,
            ts=ts,
            close=Decimal(str(row["close"])),
            observed_at=observed_at,
        )
        current = bars_by_symbol[symbol].get(ts)
        if current is None or (candidate.observed_at, candidate.id) > (
            current.observed_at,
            current.id,
        ):
            bars_by_symbol[symbol][ts] = candidate

    direct_facts: dict[str, list[QuantFact]] = defaultdict(list)
    global_facts: list[QuantFact] = []
    for row in raw_facts:
        metric_code = str(row["metric_code"])
        methodology = str(row["methodology_version"])
        if "kronos" in metric_code.casefold() or "kronos" in methodology.casefold():
            continue
        effective_at = _aware(row["effective_at"])
        observed_at = _aware(row["observed_at"])
        if effective_at > as_of or observed_at > as_of:
            continue
        age_minutes = Decimal(str((as_of - observed_at).total_seconds() / 60))
        fresh = (
            str(row["quality_status"]) in {"passed", "warning"}
            and Decimal("0") <= age_minutes <= Decimal(str(row["freshness_sla_minutes"]))
        )
        fact = QuantFact(
            id=str(row["id"]),
            metric_code=metric_code,
            value=Decimal(str(row["value"])),
            unit=_unit(row["unit"]),
            effective_at=effective_at,
            observed_at=observed_at,
            source_family=str(row["provider_code"]),
            source_code=str(row["provider_code"]),
            source_url=str(row["source_url"]),
            signed_score=_score(row.get("signal_score")),
            confidence=Decimal("100") if fresh else Decimal("0"),
            fresh=fresh,
            critical=bool(row.get("critical", False)),
            methodology_version=methodology,
        )
        symbol = row.get("asset_symbol")
        if symbol is None:
            global_facts.append(fact)
        else:
            direct_facts[canonical_symbol(str(symbol))].append(fact)

    bars_output = tuple(
        (
            symbol,
            tuple(sorted(bars_by_symbol.get(symbol, {}).values(), key=lambda row: (row.ts, row.id))),
        )
        for symbol in requested
    )
    facts_output = tuple(
        (
            symbol,
            tuple(
                sorted(
                    (*direct_facts.get(symbol, ()), *global_facts),
                    key=lambda row: (row.metric_code, row.effective_at, row.id),
                )
            ),
        )
        for symbol in canonical_assets
    )
    return AssetOpinionMarketData(bars_output, facts_output)
