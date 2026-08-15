from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime
from decimal import Decimal
import hashlib
import json
import os
from typing import Callable, Protocol
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row

from smart_insights.evidence import EvidenceBundle, EvidenceObservation, SignalEvidenceInput, build_bundle
from smart_insights.grounding import GroundingAccepted, verify
from smart_insights.asset_opinion_contracts import (
    AssetCandidate,
    AssetOpinionDraft,
    AssetOpinionMarketData,
)
from smart_insights.asset_opinion_pipeline import AssetOpinionBatch, build_asset_opinion_drafts
from smart_insights.asset_opinion_quant import build_asset_universe
from smart_insights.asset_opinion_repository import (
    load_asset_opinion_market_data as load_asset_opinion_market_data_batch,
)
from smart_insights.openai_responses import (
    AiSchemaError,
    AiUnavailable,
    StructuredInsightOutput,
    synthesize,
)
from smart_insights.personalization import (
    CandidateSignal,
    PortfolioPosition,
    RankedSignal,
    UserInsightPreference,
    rank_candidates,
)


@dataclass(frozen=True, slots=True)
class BriefingSignal:
    candidate: CandidateSignal
    observations: tuple[EvidenceObservation, ...]
    supporting_observation_ids: tuple[str, ...]
    contradicting_observation_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class BriefingItem:
    signal_id: str
    section: str
    rank: int
    relevance: Decimal
    relevance_components: dict[str, Decimal]
    evidence_bundle: EvidenceBundle
    explanation_status: str
    ai_output: StructuredInsightOutput | None
    suggested_check_template: str
    confidence: Decimal


@dataclass(frozen=True, slots=True)
class BriefingDraft:
    organization_id: str
    user_id: str
    local_date: date
    timezone: str
    as_of: datetime
    status: str
    data_confidence: Decimal
    portfolio_state: str
    portfolio: tuple[PortfolioPosition, ...]
    preferences: UserInsightPreference
    items: tuple[BriefingItem, ...]
    fingerprint: str
    asset_opinions: tuple[AssetOpinionDraft, ...] = ()

    def to_record(self, briefing_id: str, revision: int) -> "BriefingRecord":
        return BriefingRecord(
            briefing_id, revision, self.local_date, self.timezone, self.as_of, self.status,
            self.data_confidence, self.portfolio_state, self.items, self.fingerprint,
            self.asset_opinions,
        )


@dataclass(frozen=True, slots=True)
class BriefingRecord:
    id: str
    revision: int
    local_date: date
    timezone: str
    generated_at: datetime
    status: str
    data_confidence: Decimal
    portfolio_state: str
    items: tuple[BriefingItem, ...]
    fingerprint: str
    asset_opinions: tuple[AssetOpinionDraft, ...] = ()

    @property
    def primary_signal_ids(self) -> tuple[str, ...]:
        return tuple(row.signal_id for row in self.items if row.section == "primary")

    @property
    def ai_insight_count(self) -> int:
        return sum(row.ai_output is not None for row in self.items)

    @property
    def asset_opinion_count(self) -> int:
        return len(self.asset_opinions)


class BriefingRepository(Protocol):
    def load_briefing_signals(
        self, organization_id: str, user_id: str, *, as_of: datetime
    ) -> tuple[BriefingSignal, ...]: ...

    def load_personalization(
        self, organization_id: str, user_id: str, *, as_of: datetime
    ) -> tuple[tuple[PortfolioPosition, ...], tuple[str, ...], UserInsightPreference]: ...

    def load_asset_opinion_market_data(
        self,
        symbols: tuple[str, ...],
        benchmark_symbols: tuple[str, ...],
        *,
        as_of: datetime,
    ) -> AssetOpinionMarketData: ...

    def publish_briefing(self, draft: BriefingDraft) -> BriefingRecord: ...

    def load_briefing(self, briefing_id: str) -> BriefingRecord: ...


def _portfolio_snapshot(
    portfolio_state: str, portfolio: tuple[PortfolioPosition, ...]
) -> dict[str, object]:
    return {
        "portfolioState": portfolio_state,
        "positions": [asdict(row) for row in portfolio],
    }


def _evidence_unit(unit: str) -> str | None:
    normalized = unit.strip().casefold().replace(" ", "_")
    return {
        "percent": "PERCENT", "pct": "PERCENT", "%": "PERCENT",
        "index": "INDEX", "basis_points": "BASIS_POINTS", "bps": "BASIS_POINTS",
        "usd_million": "USD_MILLION", "usd_millions": "USD_MILLION",
        "tonnes": "TONNES", "tonne": "TONNES", "contracts": "COUNT",
        "count": "COUNT", "score": "SCORE", "ratio": "RATIO", "return": "RATIO",
    }.get(normalized)


def _persist_asset_opinion(
    cursor: object,
    *,
    opinion: AssetOpinionDraft,
    organization_id: str,
    user_id: str,
    run_id: str,
    as_of: datetime,
    risk_tolerance: str,
) -> dict[str, object]:
    cursor.execute("SELECT id FROM assets WHERE symbol = %s", (opinion.symbol,))
    asset_row = cursor.fetchone()
    asset_id = str(asset_row["id"]) if asset_row is not None else None
    signal_id = str(uuid4())
    idempotency_key = hashlib.sha256(
        (
            f"{organization_id}:{user_id}:{opinion.signal_key}:"
            f"{opinion.evidence_bundle.fingerprint}:{opinion.quant.methodology_version}"
        ).encode("utf-8")
    ).hexdigest()
    signal_inputs = {
        "schemaVersion": "asset-opinion-v1",
        "symbol": opinion.symbol,
        "assetName": opinion.quant.asset.name,
        "portfolioWeightPct": opinion.quant.asset.portfolio_weight * Decimal("100"),
        "unrealizedReturn": opinion.quant.unrealized_return,
        "pillars": [asdict(row) for row in opinion.quant.pillars],
        "gate": asdict(opinion.quant.gate),
        "facts": [
            {
                "id": row.id,
                "metricCode": row.metric_code,
                "value": row.value,
                "unit": row.unit,
                "effectiveAt": row.effective_at,
                "observedAt": row.observed_at,
                "sourceCode": row.source_code,
                "sourceUrl": row.source_url,
                "fresh": row.fresh,
                "contradicting": row.contradicting,
                "methodologyVersion": row.methodology_version,
            }
            for row in opinion.quant.facts
        ],
        "freshness": opinion.quant.freshness,
        "rejectionCode": opinion.rejection_code,
    }
    signal_status = "active" if opinion.quant.gate.passed else "unavailable"
    signal_market = opinion.quant.asset.market
    if signal_market not in {"crypto", "macro", "gold"}:
        signal_market = "macro"
    cursor.execute(
        """
        INSERT INTO signal_snapshots (
          id, market, asset_id, effective_at, methodology_version,
          signal_type, score, label, data_confidence, coverage,
          inputs, status, idempotency_key, created_at
        ) VALUES (
          %s,%s,%s,%s,%s,
          'asset_opinion',%s,%s,%s,%s,
          %s::jsonb,%s,%s,NOW()
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        """,
        (
            signal_id,
            signal_market,
            asset_id,
            as_of,
            opinion.quant.methodology_version,
            opinion.quant.quant_score,
            opinion.quant.stance,
            opinion.quant.confidence,
            opinion.quant.data_coverage,
            _canonical(signal_inputs),
            signal_status,
            idempotency_key,
        ),
    )

    evidence_ids: dict[str, str] = {}
    for fact in opinion.evidence_bundle.evidence:
        evidence_id = str(uuid4())
        evidence_ids[fact.evidence_id] = evidence_id
        cursor.execute(
            """
            INSERT INTO evidence_items (
              id, research_run_id, asset_id, insight_id, source_type, source_name,
              url, title, excerpt, engagement, observed_at, created_at
            ) VALUES (%s,%s,%s,NULL,'metric',%s,%s,%s,%s,0,%s,NOW())
            """,
            (
                evidence_id,
                run_id,
                asset_id,
                fact.source_code,
                fact.source_url,
                fact.metric_code,
                _canonical(asdict(fact)),
                datetime.fromisoformat(fact.observed_at),
            ),
        )

    insight_id: str | None = None
    if opinion.ai_output is not None:
        insight_id = str(uuid4())
        risk_payload = {
            "bearCase": opinion.ai_output.bear_case,
            "invalidationConditions": opinion.ai_output.invalidation_conditions,
        }
        cursor.execute(
            """
            INSERT INTO ai_insights (
              id, asset_id, research_run_id, source, title, summary, sentiment,
              confidence, catalyst, risk, published_at, created_at
            ) VALUES (%s,%s,%s,'deepseek-chat-completions',%s,%s,%s,%s,%s,%s,%s,NOW())
            """,
            (
                insight_id,
                asset_id,
                run_id,
                opinion.ai_output.thesis,
                opinion.ai_output.base_case,
                opinion.quant.stance.casefold(),
                opinion.ai_output.confidence,
                opinion.ai_output.bull_case,
                _canonical(risk_payload),
                as_of,
            ),
        )
        if evidence_ids:
            cursor.execute(
                "UPDATE evidence_items SET insight_id = %s WHERE id = ANY(%s::uuid[])",
                (insight_id, list(evidence_ids.values())),
            )

    support_set = set(opinion.evidence_bundle.supporting_evidence_ids)
    contradict_set = set(opinion.evidence_bundle.contradicting_evidence_ids)
    evidence = []
    for fact in opinion.evidence_bundle.evidence:
        impact = (
            "supporting"
            if fact.evidence_id in support_set
            else "contradicting"
            if fact.evidence_id in contradict_set
            else "neutral"
        )
        evidence.append(
            {
                "id": evidence_ids[fact.evidence_id],
                "metricCode": fact.metric_code,
                "displayValue": fact.display_value,
                "delta": None,
                "percentile": None,
                "impact": impact,
                "sourceCode": fact.source_code,
                "sourceUrl": fact.source_url,
                "effectiveAt": fact.effective_end,
                "observedAt": fact.observed_at,
                "freshness": "stale" if "STALE" in fact.warnings else "fresh",
            }
        )
    ai = opinion.ai_output
    return {
        "symbol": opinion.symbol,
        "assetName": opinion.quant.asset.name,
        "stance": opinion.quant.stance,
        "quantScore": opinion.quant.quant_score,
        "confidence": opinion.quant.confidence,
        "horizon": opinion.quant.horizon,
        "portfolioWeightPct": opinion.quant.asset.portfolio_weight * Decimal("100"),
        "unrealizedReturn": opinion.quant.unrealized_return,
        "riskTolerance": risk_tolerance,
        "personalizedAction": opinion.quant.personalized_action,
        "pillars": [
            {
                "code": pillar.code,
                "score": pillar.score,
                "weight": pillar.configured_weight,
                "confidence": pillar.confidence,
                "factIds": list(pillar.fact_ids),
                "series": [
                    {"ts": timestamp, "value": float(value)}
                    for timestamp, value in pillar.series
                ],
            }
            for pillar in opinion.quant.pillars
        ],
        "thesis": ai.thesis if ai else None,
        "bullCase": ai.bull_case if ai else None,
        "baseCase": ai.base_case if ai else None,
        "bearCase": ai.bear_case if ai else None,
        "invalidationConditions": list(ai.invalidation_conditions) if ai else [],
        "evidence": evidence,
        "dataCoverage": opinion.quant.data_coverage,
        "freshness": opinion.quant.freshness,
        "explanationStatus": opinion.explanation_status,
        "failedGates": list(opinion.quant.gate.failed_gates),
    }


class PostgresBriefingRepository:
    """Small SQL adapter that keeps tenant-scoped briefing writes in one transaction."""

    def __init__(self, connection: psycopg.Connection[object]) -> None:
        if not connection.autocommit:
            raise ValueError("Briefing repository requires an autocommit connection.")
        self.connection = connection

    def load_briefing_signals(
        self, organization_id: str, user_id: str, *, as_of: datetime
    ) -> tuple[BriefingSignal, ...]:
        del organization_id, user_id
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT DISTINCT ON (s.market, COALESCE(s.asset_id::text, ''), s.signal_type)
                       s.id, s.market, s.effective_at, s.signal_type, s.score,
                       s.data_confidence, s.inputs, a.symbol
                FROM signal_snapshots s
                LEFT JOIN assets a ON a.id = s.asset_id
                WHERE s.status = 'active' AND s.effective_at <= %s
                  AND s.signal_type <> 'asset_opinion'
                  AND s.effective_at >= %s - INTERVAL '31 days'
                ORDER BY s.market, COALESCE(s.asset_id::text, ''), s.signal_type,
                         s.effective_at DESC, s.created_at DESC
                """,
                (as_of, as_of),
            )
            signals = tuple(dict(row) for row in cursor.fetchall())
            observation_ids = sorted({
                str(source_id)
                for row in signals for item in (row.get("inputs") or [])
                for source_id in item.get("sourceObservationIds", [])
            })
            observations: dict[str, EvidenceObservation] = {}
            if observation_ids:
                cursor.execute(
                    """
                    SELECT o.id, d.code, d.unit, d.methodology_version, o.value,
                           o.effective_at, o.effective_start, o.effective_end,
                           o.observed_at, o.quality_flags, p.code AS source_code,
                           r.source_url, a.symbol
                    FROM metric_observations o
                    JOIN metric_definitions d ON d.id = o.metric_definition_id
                    JOIN data_providers p ON p.id = o.provider_id
                    JOIN insight_raw_snapshots r ON r.id = o.raw_snapshot_id
                    LEFT JOIN assets a ON a.id = o.asset_id
                    WHERE o.id = ANY(%s::uuid[]) AND o.observed_at <= %s
                    """,
                    (observation_ids, as_of),
                )
                for row in cursor.fetchall():
                    unit = _evidence_unit(str(row["unit"]))
                    if unit is None:
                        continue
                    observations[str(row["id"])] = EvidenceObservation(
                        id=str(row["id"]), metric_code=str(row["code"]),
                        asset=str(row["symbol"]) if row["symbol"] else None,
                        value=Decimal(str(row["value"])), unit=unit,
                        effective_start=row["effective_start"] or row["effective_at"],
                        effective_end=row["effective_end"] or row["effective_at"],
                        observed_at=row["observed_at"], source_code=str(row["source_code"]),
                        source_url=str(row["source_url"]), methodology_version=str(row["methodology_version"]),
                        warnings=tuple(str(flag) for flag in (row["quality_flags"] or [])),
                        decimals=2,
                    )
        output: list[BriefingSignal] = []
        for row in signals:
            source_ids = tuple(
                str(source_id)
                for item in (row.get("inputs") or [])
                for source_id in item.get("sourceObservationIds", [])
            )
            assets = (str(row["symbol"]),) if row.get("symbol") else ()
            score = Decimal(str(row["score"])) if row.get("score") is not None else Decimal("0")
            output.append(BriefingSignal(
                CandidateSignal(
                    signal_id=str(row["id"]), market=str(row["market"]), affected_assets=assets,
                    effective_at=row["effective_at"], event_at=None,
                    z_score=(score / Decimal("33.333333")),
                    regime_change=str(row["signal_type"]) == "regime_label_change",
                    source_conflict=str(row["signal_type"]) == "source_conflict",
                    data_confidence=Decimal(str(row["data_confidence"])),
                    risk_severity=2 if str(row["signal_type"]) == "event_risk" and score >= 40 else 0,
                ),
                tuple(observations[source_id] for source_id in source_ids if source_id in observations),
                (), (),
            ))
        return tuple(output)

    def load_personalization(
        self, organization_id: str, user_id: str, *, as_of: datetime
    ) -> tuple[tuple[PortfolioPosition, ...], tuple[str, ...], UserInsightPreference]:
        del as_of
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT a.symbol,
                       SUM(ABS(pp.quantity * pp.average_cost)) AS value,
                       SUM(pp.quantity) AS quantity,
                       CASE
                         WHEN SUM(ABS(pp.quantity)) = 0 THEN NULL
                         ELSE SUM(ABS(pp.quantity) * pp.average_cost) / SUM(ABS(pp.quantity))
                       END AS average_cost
                FROM portfolio_positions pp
                JOIN portfolios p ON p.id = pp.portfolio_id
                JOIN assets a ON a.id = pp.asset_id
                WHERE p.organization_id = %s AND p.user_id = %s
                GROUP BY a.symbol
                """,
                (organization_id, user_id),
            )
            raw_positions = tuple(
                (
                    str(row["symbol"]),
                    Decimal(str(row["value"])),
                    Decimal(str(row.get("quantity") or "0")),
                    (
                        Decimal(str(row["average_cost"]))
                        if row.get("average_cost") is not None
                        else None
                    ),
                )
                for row in cursor.fetchall()
            )
            total = sum((row[1] for row in raw_positions), Decimal("0"))
            positions = tuple(
                PortfolioPosition(symbol, value / total, quantity, average_cost)
                for symbol, value, quantity, average_cost in raw_positions
                if total > 0
            )
            cursor.execute(
                """SELECT a.symbol FROM watchlist_items w JOIN assets a ON a.id = w.asset_id
                   WHERE w.organization_id = %s AND w.user_id = %s
                   ORDER BY w.created_at, w.id""",
                (organization_id, user_id),
            )
            watchlist = tuple(str(row["symbol"]) for row in cursor.fetchall())
            cursor.execute(
                """SELECT markets, assets, locale, base_currency, investment_horizon,
                          risk_tolerance, alert_preferences
                   FROM user_insight_preferences WHERE organization_id = %s AND user_id = %s""",
                (organization_id, user_id),
            )
            row = cursor.fetchone()
        if row is None:
            preferences = UserInsightPreference()
        else:
            alerts = row["alert_preferences"] or {}
            preferences = UserInsightPreference(
                markets=tuple(str(value) for value in row["markets"]),
                assets=tuple(str(value) for value in row["assets"]),
                locale=str(row["locale"]), base_currency=str(row["base_currency"]),
                investment_horizon=str(row["investment_horizon"]),
                risk_tolerance=str(row["risk_tolerance"]),
                high_impact_alerts=bool(alerts.get("highImpact", True)),
            )
        return positions, watchlist, preferences

    def load_asset_opinion_market_data(
        self,
        symbols: tuple[str, ...],
        benchmark_symbols: tuple[str, ...],
        *,
        as_of: datetime,
    ) -> AssetOpinionMarketData:
        return load_asset_opinion_market_data_batch(
            self.connection,
            symbols,
            benchmark_symbols,
            as_of,
        )

    def publish_briefing(self, draft: BriefingDraft) -> BriefingRecord:
        with self.connection.transaction():
            with self.connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (f"smart-insights:briefing:{draft.organization_id}:{draft.user_id}:{draft.local_date}",),
                )
                cursor.execute(
                    """SELECT id, revision FROM daily_briefings
                       WHERE organization_id = %s AND user_id = %s AND effective_date = %s
                         AND fingerprint = %s ORDER BY revision DESC LIMIT 1""",
                    (draft.organization_id, draft.user_id, draft.local_date, draft.fingerprint),
                )
                existing = cursor.fetchone()
                if existing:
                    return draft.to_record(str(existing["id"]), int(existing["revision"]))
                cursor.execute(
                    """SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM daily_briefings
                       WHERE organization_id = %s AND user_id = %s AND effective_date = %s""",
                    (draft.organization_id, draft.user_id, draft.local_date),
                )
                revision = int(cursor.fetchone()["revision"])
                run_id, briefing_id = str(uuid4()), str(uuid4())
                cursor.execute(
                    """INSERT INTO research_runs
                       (id, organization_id, user_id, source, kind, status, parameters, summary,
                        started_at, finished_at, created_at)
                       VALUES (%s,%s,%s,'smart-insights','daily_briefing','succeeded',%s::jsonb,NULL,%s,%s,NOW())""",
                    (run_id, draft.organization_id, draft.user_id,
                     _canonical({"fingerprint": draft.fingerprint, "timezone": draft.timezone}),
                     draft.as_of, draft.as_of),
                )
                cursor.execute(
                    """INSERT INTO daily_briefings
                       (id, organization_id, user_id, research_run_id, effective_date, effective_at,
                        timezone, revision, fingerprint, model_name, prompt_version, methodology_version,
                        status, market_summary, data_confidence, portfolio_snapshot, preference_snapshot, created_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'smart-insights-prompt-v1',
                               'decision-cockpit-v1',%s,%s::jsonb,%s,%s::jsonb,%s::jsonb,NOW())""",
                    (briefing_id, draft.organization_id, draft.user_id, run_id, draft.local_date,
                     draft.as_of, draft.timezone, revision, draft.fingerprint,
                     os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash"), draft.status,
                     _canonical({"portfolioState": draft.portfolio_state}), draft.data_confidence,
                     _canonical(_portfolio_snapshot(draft.portfolio_state, draft.portfolio)),
                     _canonical(asdict(draft.preferences))),
                )
                for item in draft.items:
                    evidence_ids: list[str] = []
                    for fact in item.evidence_bundle.evidence:
                        evidence_id = str(uuid4())
                        evidence_ids.append(evidence_id)
                        cursor.execute(
                            """INSERT INTO evidence_items
                               (id, research_run_id, asset_id, insight_id, source_type, source_name,
                                url, title, excerpt, engagement, observed_at, created_at)
                               VALUES (%s,%s,NULL,NULL,'metric',%s,%s,%s,%s,0,%s,NOW())""",
                            (evidence_id, run_id, fact.source_code, fact.source_url, fact.metric_code,
                             _canonical(asdict(fact)), datetime.fromisoformat(fact.observed_at)),
                        )
                    insight_id: str | None = None
                    if item.ai_output is not None:
                        insight_id = str(uuid4())
                        cursor.execute(
                            """INSERT INTO ai_insights
                               (id, asset_id, research_run_id, source, title, summary, sentiment,
                                confidence, catalyst, risk, published_at, created_at)
                               VALUES (%s,NULL,%s,'deepseek-chat-completions',%s,%s,'neutral',%s,%s,%s,%s,NOW())""",
                            (insight_id, run_id, item.ai_output.headline, item.ai_output.what_changed,
                             item.ai_output.confidence, item.ai_output.why_it_matters,
                             _canonical(item.ai_output.risk_scenarios), draft.as_of),
                        )
                        if evidence_ids:
                            cursor.execute(
                                "UPDATE evidence_items SET insight_id = %s WHERE id = ANY(%s::uuid[])",
                                (insight_id, evidence_ids),
                            )
                    cursor.execute(
                        """INSERT INTO daily_briefing_items
                           (id, daily_briefing_id, signal_snapshot_id, ai_insight_id, rank, section,
                            relevance_score, relevance_components, supporting_evidence_ids,
                            contradicting_evidence_ids, affected_assets, time_horizon, risk_scenarios,
                            suggested_check_template, explanation_status, confidence, outcomes, created_at)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s::jsonb,%s::jsonb,%s,
                                   %s::jsonb,%s,%s,%s,'{}'::jsonb,NOW())""",
                        (str(uuid4()), briefing_id, item.signal_id, insight_id, item.rank,
                         "primary_change" if item.section == "primary" else "risk_alert",
                         item.relevance, _canonical(item.relevance_components), _canonical(evidence_ids),
                         _canonical([]), _canonical(item.evidence_bundle.affected_assets),
                         item.ai_output.time_horizon if item.ai_output else draft.preferences.investment_horizon,
                         _canonical(item.ai_output.risk_scenarios if item.ai_output else ()),
                        item.suggested_check_template, item.explanation_status, item.confidence),
                    )
                asset_opinion_snapshots = []
                for opinion in draft.asset_opinions:
                    asset_opinion_snapshots.append(_persist_asset_opinion(
                        cursor,
                        opinion=opinion,
                        organization_id=draft.organization_id,
                        user_id=draft.user_id,
                        run_id=run_id,
                        as_of=draft.as_of,
                        risk_tolerance=draft.preferences.risk_tolerance,
                    ))
                cursor.execute(
                    "UPDATE daily_briefings SET market_summary = %s::jsonb WHERE id = %s",
                    (
                        _canonical(
                            {
                                "portfolioState": draft.portfolio_state,
                                "assetOpinions": asset_opinion_snapshots,
                            }
                        ),
                        briefing_id,
                    ),
                )
        return draft.to_record(briefing_id, revision)

    def load_briefing(self, briefing_id: str) -> BriefingRecord:
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """SELECT id, revision, effective_date, timezone, effective_at, status,
                          data_confidence, portfolio_snapshot, fingerprint
                   FROM daily_briefings WHERE id = %s""",
                (briefing_id,),
            )
            row = cursor.fetchone()
        if row is None:
            raise KeyError("Briefing not found.")
        state = (row["portfolio_snapshot"] or {}).get("portfolioState", "missing")
        return BriefingRecord(
            str(row["id"]), int(row["revision"]), row["effective_date"], str(row["timezone"]),
            row["effective_at"], str(row["status"]), Decimal(str(row["data_confidence"])),
            str(state), (), str(row["fingerprint"]),
        )


Synthesizer = Callable[..., StructuredInsightOutput | AiUnavailable | AiSchemaError]
AssetSynthesizer = Callable[..., object]


def _canonical(value: object) -> str:
    def default(item: object) -> object:
        if isinstance(item, Decimal):
            return format(item, "f")
        if isinstance(item, (datetime, date)):
            return item.isoformat()
        raise TypeError(type(item).__name__)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=default, ensure_ascii=True)


def _fingerprint(draft: dict[str, object]) -> str:
    return hashlib.sha256(_canonical(draft).encode("utf-8")).hexdigest()


def _selected_rows(
    ranked: tuple[RankedSignal, ...], signals: tuple[BriefingSignal, ...], section: str,
) -> tuple[tuple[RankedSignal, BriefingSignal, str], ...]:
    by_id = {row.candidate.signal_id: row for row in signals}
    return tuple((row, by_id[row.signal_id], section) for row in ranked)


def generate_briefing(
    repository: BriefingRepository, *, organization_id: str, user_id: str,
    local_date: date, timezone_name: str, as_of: datetime,
    synthesizer: Synthesizer = synthesize,
    asset_synthesizer: AssetSynthesizer | None = None,
) -> BriefingRecord:
    signals = repository.load_briefing_signals(organization_id, user_id, as_of=as_of)
    portfolio, watchlist, preferences = repository.load_personalization(
        organization_id, user_id, as_of=as_of
    )
    selection = rank_candidates(
        tuple(row.candidate for row in signals), portfolio=portfolio,
        preferences=preferences, watchlist=watchlist, now=as_of,
    )
    selected = _selected_rows(selection.primary, signals, "primary")
    primary_ids = {row.signal_id for row in selection.primary}
    selected += tuple(
        item for item in _selected_rows(selection.risk_alerts, signals, "risk")
        if item[0].signal_id not in primary_ids
    )
    items: list[BriefingItem] = []
    for rank, (ranked, source, section) in enumerate(selected, start=1):
        bundle = build_bundle(
            signal=SignalEvidenceInput(
                source.candidate.signal_id, source.candidate.market,
                source.candidate.affected_assets, source.candidate.data_confidence,
            ),
            observations=source.observations,
            tenant_id=organization_id,
            as_of=as_of,
        )
        generated = synthesizer(
            bundle,
            locale=preferences.locale,
            model=os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash"),
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            timeout_seconds=int(os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "30")),
            endpoint=(
                os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
                + "/chat/completions"
            ),
        )
        accepted = verify(generated, bundle) if isinstance(generated, StructuredInsightOutput) else generated
        if isinstance(accepted, GroundingAccepted):
            ai_output = accepted.output
            explanation_status = "accepted"
            suggested_check = ai_output.suggested_check_template
            confidence = Decimal(ai_output.confidence)
        else:
            ai_output = None
            explanation_status = "rejected" if isinstance(generated, (StructuredInsightOutput, AiSchemaError)) else "unavailable"
            suggested_check = "NO_ACTION_INSUFFICIENT_DATA"
            confidence = source.candidate.data_confidence
        items.append(BriefingItem(
            ranked.signal_id, section, rank, ranked.relevance, ranked.components,
            bundle, explanation_status, ai_output, suggested_check, confidence,
        ))

    market_by_symbol = {
        asset.upper(): signal.candidate.market
        for signal in signals
        for asset in signal.candidate.affected_assets
    }

    def asset_market(symbol: str) -> str:
        normalized = symbol.upper()
        return market_by_symbol.get(
            normalized,
            {"BTC": "crypto", "XAU": "gold", "VNINDEX": "equity"}.get(
                normalized, "other"
            ),
        )

    portfolio_candidates = tuple(
        AssetCandidate(
            symbol=row.asset,
            name=row.asset,
            market=asset_market(row.asset),
            portfolio_weight=row.weight,
            watchlist_rank=0,
            quantity=row.quantity,
            average_cost=row.average_cost,
        )
        for row in portfolio
    )
    watchlist_candidates = tuple(
        AssetCandidate(
            symbol=symbol,
            name=symbol,
            market=asset_market(symbol),
            portfolio_weight=Decimal("0"),
            watchlist_rank=index,
        )
        for index, symbol in enumerate(watchlist)
    )
    universe = build_asset_universe(
        portfolio_candidates,
        watchlist_candidates,
        ("VNINDEX", "XAU", "BTC"),
        limit=25,
    )
    benchmark_symbols = tuple(
        dict.fromkeys(
            {"crypto": "BTC", "gold": "XAU", "equity": "VNINDEX", "stock_vn": "VNINDEX"}.get(
                row.market, row.symbol
            )
            for row in universe.assets
        )
    )
    market_data = repository.load_asset_opinion_market_data(
        tuple(row.symbol for row in universe.assets),
        benchmark_symbols,
        as_of=as_of,
    )
    asset_kwargs = {}
    if asset_synthesizer is not None:
        asset_kwargs["synthesizer"] = asset_synthesizer
    asset_opinions = build_asset_opinion_drafts(
        AssetOpinionBatch(
            universe=universe,
            market_data=market_data,
            preferences=preferences,
            as_of=as_of,
            organization_id=organization_id,
        ),
        **asset_kwargs,
    )
    all_explanations = [row.ai_output is not None for row in items] + [
        row.explanation_status == "accepted" for row in asset_opinions
    ]
    status = "complete" if all_explanations and all(all_explanations) else "quant_only"
    confidence_values = [row.confidence for row in items] + [
        row.quant.confidence for row in asset_opinions
    ]
    confidence = (
        sum(confidence_values, Decimal("0")) / Decimal(len(confidence_values))
        if confidence_values
        else Decimal("0")
    ).quantize(Decimal("0.01"))
    fingerprint_payload = {
        "organizationId": organization_id,
        "userId": user_id,
        "localDate": local_date,
        "timezone": timezone_name,
        "asOf": as_of,
        "portfolio": [asdict(row) for row in portfolio],
        "preferences": asdict(preferences),
        "items": [
            {
                "signalId": row.signal_id,
                "section": row.section,
                "rank": row.rank,
                "relevance": row.relevance,
                "bundle": row.evidence_bundle.fingerprint,
                "explanationStatus": row.explanation_status,
                "ai": asdict(row.ai_output) if row.ai_output else None,
            }
            for row in items
        ],
        "assetOpinions": [
            {
                "symbol": row.symbol,
                "signalKey": row.signal_key,
                "methodology": row.quant.methodology_version,
                "gate": asdict(row.quant.gate),
                "pillars": [asdict(pillar) for pillar in row.quant.pillars],
                "bundle": row.evidence_bundle.fingerprint,
                "explanationStatus": row.explanation_status,
                "ai": asdict(row.ai_output) if row.ai_output else None,
                "action": row.quant.personalized_action,
            }
            for row in asset_opinions
        ],
    }
    draft = BriefingDraft(
        organization_id=organization_id,
        user_id=user_id,
        local_date=local_date,
        timezone=timezone_name,
        as_of=as_of,
        status=status,
        data_confidence=confidence,
        portfolio_state=selection.portfolio_state,
        portfolio=portfolio,
        preferences=preferences,
        items=tuple(items),
        fingerprint=_fingerprint(fingerprint_payload),
        asset_opinions=asset_opinions,
    )
    return repository.publish_briefing(draft)


def replay_briefing(repository: BriefingRepository, briefing_id: str) -> BriefingRecord:
    return repository.load_briefing(briefing_id)
