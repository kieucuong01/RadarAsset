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

    def to_record(self, briefing_id: str, revision: int) -> "BriefingRecord":
        return BriefingRecord(
            briefing_id, revision, self.local_date, self.timezone, self.as_of, self.status,
            self.data_confidence, self.portfolio_state, self.items, self.fingerprint,
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

    @property
    def primary_signal_ids(self) -> tuple[str, ...]:
        return tuple(row.signal_id for row in self.items if row.section == "primary")

    @property
    def ai_insight_count(self) -> int:
        return sum(row.ai_output is not None for row in self.items)


class BriefingRepository(Protocol):
    def load_briefing_signals(
        self, organization_id: str, user_id: str, *, as_of: datetime
    ) -> tuple[BriefingSignal, ...]: ...

    def load_personalization(
        self, organization_id: str, user_id: str, *, as_of: datetime
    ) -> tuple[tuple[PortfolioPosition, ...], tuple[str, ...], UserInsightPreference]: ...

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
                SELECT a.symbol, SUM(ABS(pp.quantity * pp.average_cost)) AS value
                FROM portfolio_positions pp
                JOIN portfolios p ON p.id = pp.portfolio_id
                JOIN assets a ON a.id = pp.asset_id
                WHERE p.organization_id = %s AND p.user_id = %s
                GROUP BY a.symbol
                """,
                (organization_id, user_id),
            )
            raw_positions = tuple((str(row["symbol"]), Decimal(str(row["value"]))) for row in cursor.fetchall())
            total = sum((row[1] for row in raw_positions), Decimal("0"))
            positions = tuple(
                PortfolioPosition(symbol, value / total)
                for symbol, value in raw_positions if total > 0
            )
            cursor.execute(
                """SELECT a.symbol FROM watchlist_items w JOIN assets a ON a.id = w.asset_id
                   WHERE w.organization_id = %s AND w.user_id = %s ORDER BY a.symbol""",
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
                     os.getenv("SMART_INSIGHTS_AI_MODEL"), draft.status,
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
                               VALUES (%s,NULL,%s,'openai-responses',%s,%s,'neutral',%s,%s,%s,%s,NOW())""",
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
                        (str(uuid4()), briefing_id, item.signal_id, insight_id, item.rank, item.section,
                         item.relevance, _canonical(item.relevance_components), _canonical(evidence_ids),
                         _canonical([]), _canonical(item.evidence_bundle.affected_assets),
                         item.ai_output.time_horizon if item.ai_output else draft.preferences.investment_horizon,
                         _canonical(item.ai_output.risk_scenarios if item.ai_output else ()),
                         item.suggested_check_template, item.explanation_status, item.confidence),
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
            model=os.getenv("SMART_INSIGHTS_AI_MODEL"),
            api_key=os.getenv("OPENAI_API_KEY"),
            timeout_seconds=int(os.getenv("SMART_INSIGHTS_AI_TIMEOUT_SECONDS", "30")),
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
    status = "complete" if items and all(row.ai_output is not None for row in items) else "quant_only"
    confidence = (
        sum((row.confidence for row in items), Decimal("0")) / Decimal(len(items))
        if items else Decimal("0")
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
    }
    draft = BriefingDraft(
        organization_id, user_id, local_date, timezone_name, as_of, status,
        confidence, selection.portfolio_state, portfolio, preferences, tuple(items),
        _fingerprint(fingerprint_payload),
    )
    return repository.publish_briefing(draft)


def replay_briefing(repository: BriefingRepository, briefing_id: str) -> BriefingRecord:
    return repository.load_briefing(briefing_id)
