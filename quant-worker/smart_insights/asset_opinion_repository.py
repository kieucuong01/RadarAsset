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
         observation.dimensions,
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
    AND observation.effective_at >= %s - CASE
      WHEN metric.code = 'crypto.etf.net_flow_usd' THEN INTERVAL '90 days'
      WHEN metric.code = 'crypto.coinshares.net_flow_usd' THEN INTERVAL '364 days'
      ELSE INTERVAL '365 days'
    END
    AND observation.quality_status IN ('passed', 'warning')
    AND snapshot.status = 'validated'
    AND (
      metric.code <> 'crypto.etf.net_flow_usd'
      OR observation.dimensions ->> 'fund' = 'TOTAL'
    )
    AND (
      metric.code <> 'crypto.coinshares.net_flow_usd'
      OR LOWER(COALESCE(observation.dimensions ->> 'asset', 'total'))
         IN ('total', 'bitcoin', 'btc')
    )
), current_observations AS (
  SELECT ranked.*,
         ROW_NUMBER() OVER (
           PARTITION BY asset_symbol, metric_code
           ORDER BY effective_at DESC, observed_at DESC, id
         ) AS metric_rank
       , PERCENT_RANK() OVER (
           PARTITION BY asset_symbol, metric_code
           ORDER BY value
         ) AS raw_percentile
       , COUNT(*) OVER (
           PARTITION BY asset_symbol, metric_code
         ) AS raw_history_count
  FROM ranked
  WHERE revision_rank = 1
), signal_scores AS (
  SELECT source_observation_id,
         signal.market AS signal_market,
         input ->> 'metricCode' AS signal_metric_code,
         (input ->> 'score')::numeric AS signal_score,
         NULLIF(input ->> 'percentile', '')::numeric AS signal_percentile,
         NULLIF(input ->> 'configuredWeight', '')::numeric AS signal_configured_weight,
         ROW_NUMBER() OVER (
           PARTITION BY source_observation_id, signal.market
           ORDER BY signal.effective_at DESC, signal.created_at DESC
         ) AS score_rank
  FROM signal_snapshots signal
  CROSS JOIN jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(signal.inputs) = 'array' THEN signal.inputs
      ELSE '[]'::jsonb
    END
  ) input
  CROSS JOIN jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(input -> 'sourceObservationIds') = 'array'
        THEN input -> 'sourceObservationIds'
      ELSE '[]'::jsonb
    END
  ) source_observation_id
  WHERE signal.effective_at <= %s
), scored AS (
  SELECT current_observations.*,
         signal_scores.signal_market,
         signal_scores.signal_metric_code,
         signal_scores.signal_score,
         signal_scores.signal_percentile,
         signal_scores.signal_configured_weight
  FROM current_observations
  LEFT JOIN signal_scores
    ON signal_scores.source_observation_id = current_observations.id::text
   AND signal_scores.score_rank = 1
  WHERE current_observations.metric_rank <= 100
)
SELECT id, asset_symbol, metric_code, value, unit, direction,
       methodology_version, freshness_sla_minutes, effective_at, observed_at,
       quality_status, dimensions, provider_code, source_url, critical,
       signal_market, signal_metric_code, signal_score, signal_percentile,
       signal_configured_weight, raw_percentile, raw_history_count
FROM scored
ORDER BY asset_symbol NULLS FIRST, metric_code, effective_at DESC, id
LIMIT 1000
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

CRYPTO_DECISION_METRICS = frozenset(
    {
        "crypto.etf.net_flow_usd",
        "crypto.coinshares.net_flow_usd",
        "crypto.fear_greed.index",
        "crypto.onchain.adjusted_transfer_usd",
        "crypto.onchain.active_addresses",
        "crypto.onchain.nvt",
        "crypto.network.hashrate_hs",
        "crypto.large_address.exchange_flow_pressure_btc",
        "crypto.cycle.altcoin_season.index",
    }
)

MACRO_DECISION_METRICS = frozenset(
    {
        "macro.real_yield.10y_pct",
        "macro.usd_broad_index",
        "macro.fed_balance_sheet_change_4w",
        "macro.reverse_repo_change_4w",
        "macro.tga_change_4w",
        "macro.growth_surprise",
        "macro.inflation_surprise",
        "macro.regime.score",
        "macro.event_risk",
    }
)

GOLD_DECISION_METRICS = frozenset({"gold.cftc.managed_money_net_oi", "gold.regime.score"})


def fact_allowed_for_market(metric_code: str, market: str) -> bool:
    if metric_code in MACRO_DECISION_METRICS:
        return market in {"crypto", "gold"}
    if metric_code in CRYPTO_DECISION_METRICS:
        return market == "crypto"
    if metric_code in GOLD_DECISION_METRICS:
        return market == "gold"
    if metric_code.startswith(("equity.liquidity.", "equity.foreign_flow.", "equity.valuation.")):
        return market in {"equity", "stock_vn"}
    return False


def _preferred_signal_market(metric_code: str, market: str) -> str:
    if market == "gold":
        return "gold"
    if metric_code.startswith("macro."):
        return "macro"
    return market


def _dimensions(value: object) -> tuple[tuple[str, str], ...]:
    if not isinstance(value, dict):
        return ()
    return tuple(sorted((str(key), str(item)) for key, item in value.items()))


def latest_decision_facts(
    rows: tuple[QuantFact, ...], *, limit: int = 12
) -> tuple[QuantFact, ...]:
    latest: dict[str, QuantFact] = {}
    for row in rows:
        key = row.metric_code
        current = latest.get(key)
        if current is None or (row.effective_at, row.observed_at, row.id) > (
            current.effective_at,
            current.observed_at,
            current.id,
        ):
            latest[key] = row
    ordered = sorted(
        latest.values(),
        key=lambda row: (
            row.signed_score is None,
            not row.fresh,
            -(abs(row.signed_score) if row.signed_score is not None else Decimal("0")),
            row.metric_code,
            row.dimensions,
        ),
    )
    return tuple(ordered[:limit])


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


def _optional_decimal(value: object) -> Decimal | None:
    if value is None or value == "":
        return None
    return Decimal(str(value))


def _fact_dimensions_allowed(
    metric_code: str, dimensions: tuple[tuple[str, str], ...], *, symbol: str
) -> bool:
    values = {key: value for key, value in dimensions}
    if metric_code == "crypto.etf.net_flow_usd":
        return (
            values.get("fund", "").upper() == "TOTAL"
            and values.get("asset", "").upper() == symbol
        )
    if metric_code == "crypto.coinshares.net_flow_usd":
        return values.get("asset", "total").casefold() in {"total", "bitcoin", "btc"}
    if metric_code == "crypto.cycle.altcoin_season.index":
        return values.get("horizon") == "season_90d"
    return True


def _raw_normalization_spec(metric_code: str) -> tuple[int, str] | None:
    if metric_code == "crypto.fear_greed.index":
        return None
    if metric_code == "crypto.etf.net_flow_usd":
        return (10, "empirical_percentile_90d")
    if metric_code in {
        "crypto.coinshares.net_flow_usd",
        "gold.cftc.managed_money_net_oi",
    }:
        return (10, "empirical_percentile_52w")
    if metric_code.startswith(("crypto.onchain.", "macro.")):
        return (20, "empirical_percentile_365d")
    return None


def _fact_for_asset(
    candidate_rows: list[dict[str, object]],
    *,
    symbol: str,
    market: str,
    as_of: datetime,
) -> QuantFact | None:
    if not candidate_rows:
        return None
    base = candidate_rows[0]
    direct_symbol = base.get("asset_symbol")
    if direct_symbol is not None and canonical_symbol(str(direct_symbol)) != symbol:
        return None
    metric_code = str(base["metric_code"])
    if not fact_allowed_for_market(metric_code, market):
        return None
    dimensions = _dimensions(base.get("dimensions"))
    if not _fact_dimensions_allowed(metric_code, dimensions, symbol=symbol):
        return None

    preferred_market = _preferred_signal_market(metric_code, market)
    scored = tuple(
        row for row in candidate_rows if str(row.get("signal_market") or "") == preferred_market
    )
    score_row = max(
        scored,
        key=lambda row: (
            row.get("signal_score") is not None,
            _aware(row["effective_at"]),
            str(row["id"]),
        ),
        default=None,
    )
    effective_at = _aware(base["effective_at"])
    observed_at = _aware(base["observed_at"])
    observed_age_minutes = Decimal(str((as_of - observed_at).total_seconds() / 60))
    effective_age_minutes = Decimal(str((as_of - effective_at).total_seconds() / 60))
    freshness_sla = Decimal(str(base["freshness_sla_minutes"]))
    fresh = (
        str(base["quality_status"]) in {"passed", "warning"}
        and Decimal("0") <= observed_age_minutes <= freshness_sla
        and Decimal("0") <= effective_age_minutes <= freshness_sla
    )
    percentile = _optional_decimal(
        score_row.get("signal_percentile") if score_row is not None else None
    )
    input_weight = _optional_decimal(
        score_row.get("signal_configured_weight") if score_row is not None else None
    )
    signed_score = _score(
        score_row.get("signal_score") if score_row is not None else None
    )
    normalization_method = (
        "empirical_percentile" if percentile is not None else "source_signal"
    )
    raw_spec = _raw_normalization_spec(metric_code)
    raw_percentile = _optional_decimal(base.get("raw_percentile"))
    raw_history_count = int(base.get("raw_history_count") or 0)
    if (
        signed_score is None
        and fresh
        and raw_spec is not None
        and raw_percentile is not None
        and raw_history_count >= raw_spec[0]
    ):
        percentile = raw_percentile
        signed_score = _score(
            (Decimal("2") * raw_percentile - Decimal("1"))
            * Decimal("100")
            * Decimal(str(base["direction"]))
        )
        normalization_method = raw_spec[1]
    return QuantFact(
        id=str(base["id"]),
        metric_code=metric_code,
        value=Decimal(str(base["value"])),
        unit=_unit(base["unit"]),
        effective_at=effective_at,
        observed_at=observed_at,
        source_family=str(base["provider_code"]),
        source_code=str(base["provider_code"]),
        source_url=str(base["source_url"]),
        signed_score=signed_score,
        confidence=Decimal("100") if fresh else Decimal("0"),
        fresh=fresh,
        critical=bool(base.get("critical", False)),
        methodology_version=str(base["methodology_version"]),
        dimensions=dimensions,
        percentile=percentile,
        source_input_weight=input_weight,
        normalization_method=normalization_method,
        signal_metric_code=(
            str(score_row.get("signal_metric_code"))
            if score_row is not None and score_row.get("signal_metric_code")
            else None
        ),
        signal_market=preferred_market if signed_score is not None else None,
    )


def load_asset_opinion_market_data(
    connection: Any,
    assets: tuple[tuple[str, str], ...],
    benchmark_symbols: tuple[str, ...],
    as_of: datetime,
) -> AssetOpinionMarketData:
    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("as_of must be timezone-aware.")
    canonical_pairs = tuple(
        dict.fromkeys((canonical_symbol(symbol), market) for symbol, market in assets)
    )
    canonical_assets = tuple(symbol for symbol, _market in canonical_pairs)
    asset_markets = dict(canonical_pairs)
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
        cursor.execute(
            FACT_QUERY, (list(canonical_assets), as_of, as_of, as_of, as_of)
        )
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

    grouped_fact_rows: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in raw_facts:
        metric_code = str(row["metric_code"])
        methodology = str(row["methodology_version"])
        if "kronos" in metric_code.casefold() or "kronos" in methodology.casefold():
            continue
        effective_at = _aware(row["effective_at"])
        observed_at = _aware(row["observed_at"])
        if effective_at > as_of or observed_at > as_of:
            continue
        grouped_fact_rows[str(row["id"])].append(row)

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
            latest_decision_facts(
                tuple(
                    fact
                    for candidate_rows in grouped_fact_rows.values()
                    if (
                        fact := _fact_for_asset(
                            candidate_rows,
                            symbol=symbol,
                            market=asset_markets[symbol],
                            as_of=as_of,
                        )
                    )
                    is not None
                )
            ),
        )
        for symbol in canonical_assets
    )
    return AssetOpinionMarketData(bars_output, facts_output)
