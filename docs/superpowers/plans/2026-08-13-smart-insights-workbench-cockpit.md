# Smart Insights Research Workbench and Personal Decision Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn validated Crypto, Macro, and Gold signals into grounded, personalized daily briefings and expose them through tenant-safe APIs and the existing Smart Insights visual language.

**Architecture:** A deterministic worker freezes point-in-time evidence bundles, calculates portfolio relevance, and optionally sends only those bundles to the OpenAI Responses API with strict Structured Outputs. A grounding gate rejects unsupported content before persistence. Next.js server routes expose bounded read models; the Smart Insights page becomes a composition of focused cockpit components with no runtime sample numbers.

**Tech Stack:** Python 3.12-compatible standard library, psycopg 3, OpenAI Responses API over HTTPS, JSON Schema, pytest, Next.js App Router, React 19, TypeScript, Zod, Prisma 7, Vitest, existing CSS/design tokens and Lucide icons.

## Global Constraints

- Requires completed data-foundation, Crypto, Macro/Calendar, and Gold plans.
- The model receives only accepted observations/signals, permitted evidence excerpts, source metadata, and portfolio/preference snapshots; it does not browse the open web.
- Every displayed AI number must resolve exactly to an evidence value after a declared formatting rule.
- AI confidence cannot exceed deterministic Data Confidence.
- AI/model/grounding failure leaves the deterministic cockpit available and never inserts sample prose.
- Suggested checks use the fixed allow-list; no order, exact position size, guaranteed forecast, or ungrounded target is allowed.
- Global public market facts are read-only; preferences, portfolio impact, evidence bundles, research runs, and briefings enforce active tenant/user scope.
- Preserve the current rounded cards, tokens, typography, responsive spacing, theme behavior, green/red/neutral semantics, Lucide icons, and `DataStatusBadge`.
- Remove every runtime hard-coded ticker value, calendar event, thesis, and news item from Smart Insights.
- Preserve unrelated working-tree changes and commit only task files.

---

## File Structure

### Worker

- `quant-worker/smart_insights/evidence.py`: immutable evidence-bundle construction and exact number formatting map.
- `quant-worker/smart_insights/personalization.py`: portfolio/interest relevance scoring and ranking.
- `quant-worker/smart_insights/openai_responses.py`: bounded Responses API client with strict JSON Schema.
- `quant-worker/smart_insights/grounding.py`: tenant/evidence/number/unit/date/confidence/action verification.
- `quant-worker/smart_insights/briefing_pipeline.py`: research run, synthesis, revision, fallback, replay, and outcome orchestration.
- `quant-worker/tests/test_smart_insights_evidence.py`: evidence and number-map contracts.
- `quant-worker/tests/test_smart_insights_personalization.py`: relevance golden tests.
- `quant-worker/tests/test_smart_insights_grounding.py`: accepted/rejected output matrix.
- `quant-worker/tests/test_smart_insights_briefing_pipeline_integration.py`: frozen briefing/revision/replay tests.

### Server and browser

- `src/lib/backend/smart-insights-types.ts`: complete cockpit response and preference types.
- `src/lib/backend/smart-insights.ts`: tenant-aware briefing/evidence/preference queries and global market read models.
- `src/lib/smart-insights-client.ts`: Zod response schemas and query client.
- `src/app/api/smart-insights/briefing/route.ts`: daily briefing endpoint.
- `src/app/api/smart-insights/regimes/route.ts`: latest market regimes endpoint.
- `src/app/api/smart-insights/metrics/route.ts`: bounded metric-history endpoint.
- `src/app/api/smart-insights/calendar/route.ts`: bounded CryptoCraft event endpoint.
- `src/app/api/smart-insights/evidence/[id]/route.ts`: tenant-scoped evidence endpoint.
- `src/app/api/smart-insights/preferences/route.ts`: active-user GET/PUT endpoint.
- `src/components/smart-insights/DecisionBrief.tsx`: daily stance and top changes.
- `src/components/smart-insights/PortfolioImpact.tsx`: exposure-aware impact or no-portfolio prompt.
- `src/components/smart-insights/MarketRegimeStrip.tsx`: Crypto/Macro/Gold overview.
- `src/components/smart-insights/CryptoPanel.tsx`: Crypto metrics.
- `src/components/smart-insights/MacroPanel.tsx`: Macro metrics and event risk.
- `src/components/smart-insights/GoldPanel.tsx`: Gold metrics.
- `src/components/smart-insights/EconomicCalendar.tsx`: next-24-hour/seven-day calendar.
- `src/components/smart-insights/EvidenceDrawer.tsx`: provenance, history, formula, and warnings.
- `src/components/smart-insights/DataHealthPanel.tsx`: source state and typed failures.
- `src/components/smart-insights/FreshnessBadge.tsx`: fresh/stale/conflicting/partial/unavailable state.
- `src/components/SmartInsights.tsx`: query/state composition only.
- `src/lib/i18n/dictionary.ts`: Vietnamese and English cockpit copy.
- `src/app/api/tenant-routes.test.ts`: endpoint permission and leakage tests.
- `src/lib/backend/smart-insights.test.ts`: read-model and bounds tests.
- `src/components/smart-insights/source-guard.test.ts`: no-sample and component-boundary source guard.

---

### Task 1: Freeze evidence bundles and exact formatting maps

**Files:**

- Create: `quant-worker/smart_insights/evidence.py`
- Create: `quant-worker/tests/test_smart_insights_evidence.py`

**Interfaces:**

- Consumes: `SignalSnapshot`, accepted `MetricObservation` rows, source metadata, historical comparisons, and active tenant ID.
- Produces: immutable `EvidenceBundle`, canonical JSON fingerprint, and `DisplayedNumber` map.

- [ ] **Step 1: Write failing evidence-contract tests**

```python
def test_bundle_freezes_only_point_in_time_accessible_evidence() -> None:
    bundle = build_bundle(
        signal=signal(effective_at="2026-08-13T00:00:00Z"),
        observations=(observation("etf_flow", "125.4", observed_at="2026-08-13T01:00:00Z"),
                      observation("etf_flow", "999", observed_at="2026-08-14T01:00:00Z")),
        tenant_id="org-1",
        as_of=parse_time("2026-08-13T08:00:00+07:00"),
    )
    assert [item.raw_value for item in bundle.evidence] == ["125.4"]
    assert bundle.fingerprint == canonical_sha256(bundle.to_json())

def test_displayed_number_map_declares_rounding_and_unit() -> None:
    number = format_evidence_number(value=Decimal("125.40"), unit="USD_MILLION", decimals=1)
    assert number.display == "$125.4m"
    assert number.normalized_tokens == ("125.4", "$125.4m")
    assert number.format_rule == "currency_compact_usd_million_1dp"
```

- [ ] **Step 2: Run the evidence tests and confirm failure**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_evidence.py -q`

Expected: FAIL because `evidence.py` is missing.

- [ ] **Step 3: Implement frozen dataclasses and canonical serialization**

```python
@dataclass(frozen=True)
class EvidenceFact:
    evidence_id: str
    metric_observation_id: str
    metric_code: str
    asset: str | None
    raw_value: str
    display_value: str
    unit: str
    effective_start: str
    effective_end: str
    observed_at: str
    source_code: str
    source_url: str
    methodology_version: str
    warnings: tuple[str, ...]

@dataclass(frozen=True)
class EvidenceBundle:
    signal_id: str
    market: str
    affected_assets: tuple[str, ...]
    evidence: tuple[EvidenceFact, ...]
    supporting_evidence_ids: tuple[str, ...]
    contradicting_evidence_ids: tuple[str, ...]
    historical_comparisons: tuple[dict[str, object], ...]
    data_confidence_ceiling: Decimal
    as_of: str
    tenant_id: str
    fingerprint: str
```

Sort facts by `(metric_code, asset, effective_end, evidence_id)`, reject any fact observed after `as_of`, and serialize with sorted keys and fixed Decimal strings. Define explicit formatters for percent, index, basis points, USD million, tonnes, counts, dates, and durations; unknown units are not eligible for AI synthesis.

- [ ] **Step 4: Run evidence tests**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_evidence.py -q`

Expected: PASS.

- [ ] **Step 5: Commit evidence contracts**

```bash
git add quant-worker/smart_insights/evidence.py quant-worker/tests/test_smart_insights_evidence.py
git commit -m "feat: freeze smart insight evidence bundles"
```

---

### Task 2: Rank signals by portfolio and user relevance

**Files:**

- Create: `quant-worker/smart_insights/personalization.py`
- Create: `quant-worker/tests/test_smart_insights_personalization.py`

**Interfaces:**

- Consumes: candidate signals, active portfolio positions, watchlist, `UserInsightPreference`, event time, and Data Confidence.
- Produces: `RankedSignal` rows, portfolio snapshot, relevance components, three primary changes, and two risk alerts.

- [ ] **Step 1: Write failing golden relevance tests**

```python
def test_relevance_uses_frozen_component_weights() -> None:
    result = relevance_score(
        exposure=Decimal("80"), magnitude=Decimal("70"), proximity=Decimal("100"),
        interest=Decimal("100"), data_confidence=Decimal("60"),
    )
    assert result.total == Decimal("81.50")
    assert result.components == {
        "exposure": Decimal("80"), "magnitude": Decimal("70"),
        "proximity": Decimal("100"), "interest": Decimal("100"),
        "data_confidence": Decimal("60"),
    }

def test_ranking_changes_with_portfolio_but_signal_does_not() -> None:
    btc_heavy = rank_candidates(candidates(), portfolio=portfolio(BTC="0.80", XAU="0.20"), preferences=default_preferences())
    gold_heavy = rank_candidates(candidates(), portfolio=portfolio(BTC="0.10", XAU="0.90"), preferences=default_preferences())
    assert btc_heavy.primary[0].market == "crypto"
    assert gold_heavy.primary[0].market == "gold"
    assert btc_heavy.primary[0].signal_id in {row.signal_id for row in gold_heavy.all_candidates}
```

- [ ] **Step 2: Run the tests and confirm failure**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_personalization.py -q`

Expected: FAIL because personalization is missing.

- [ ] **Step 3: Implement the exact score components**

```python
RELEVANCE_WEIGHTS = {
    "exposure": Decimal("0.35"),
    "magnitude": Decimal("0.25"),
    "proximity": Decimal("0.15"),
    "interest": Decimal("0.15"),
    "data_confidence": Decimal("0.10"),
}

def signal_magnitude(z_score: Decimal | None, *, regime_change: bool, source_conflict: bool) -> Decimal:
    if regime_change or source_conflict:
        return Decimal("100")
    return min(abs(z_score or Decimal("0")) / Decimal("3"), Decimal("1")) * Decimal("100")
```

Exposure equals affected absolute portfolio weight divided by largest current absolute asset weight, capped at 100. Macro exposure uses code-owned asset sensitivities multiplied by absolute weights. Event proximity is 100 within 24 hours, 70 within three days, 40 within seven days, and zero later. Interest is 100 for selected market/asset, 60 for watchlist-only, and zero otherwise. Sort by relevance descending, risk severity descending, effective time descending, then signal ID ascending.

When no preference row exists, use but do not persist this code-owned default: markets `crypto,macro,gold`, no explicit assets, locale `vi`, base currency `USD`, horizon `WEEKS_1_4`, risk tolerance `moderate`, and high-impact alerts enabled. `load_preferences_or_default` is shared by the scheduler and preference GET so the frozen snapshot and UI cannot disagree.

- [ ] **Step 4: Implement selection and no-portfolio behavior**

Select at most three primary non-duplicate market/asset changes and at most two risk alerts. With no active positions, exposure is zero and explicit preferences/watchlist still rank candidates; persist `portfolioState="missing"` for the UI prompt.

- [ ] **Step 5: Run personalization tests**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_personalization.py -q`

Expected: PASS.

- [ ] **Step 6: Commit personalization**

```bash
git add quant-worker/smart_insights/personalization.py quant-worker/tests/test_smart_insights_personalization.py
git commit -m "feat: personalize smart insight priorities"
```

---

### Task 3: Add the strict Responses API synthesis adapter

**Files:**

- Create: `quant-worker/smart_insights/openai_responses.py`
- Create: `quant-worker/tests/test_smart_insights_openai_responses.py`
- Modify: `.env.example`

**Interfaces:**

- Consumes: `EvidenceBundle`, frozen preference locale (`vi` or `en`), `OPENAI_API_KEY`, `SMART_INSIGHTS_AI_MODEL`, timeout, and prompt version.
- Produces: validated `StructuredInsightOutput` or a typed `AiUnavailable`/`AiSchemaError`; no free-form fallback.

- [ ] **Step 1: Write failing HTTP-contract tests with a fake transport**

```python
def test_responses_request_is_strict_and_does_not_store(fake_transport) -> None:
    synthesize(bundle(), locale="vi", transport=fake_transport, model="configured-model", api_key="test")
    body = fake_transport.last_json
    assert body["model"] == "configured-model"
    assert body["store"] is False
    assert body["text"]["format"]["type"] == "json_schema"
    assert body["text"]["format"]["strict"] is True
    assert "tools" not in body
    assert body["input"][1]["content"][0]["text"] == bundle().to_json()

def test_missing_configuration_returns_typed_unavailable() -> None:
    assert synthesize(bundle(), locale="vi", model=None, api_key=None) == AiUnavailable("AI_NOT_CONFIGURED")
```

- [ ] **Step 2: Run the adapter tests and confirm failure**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_openai_responses.py -q`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Define the closed JSON Schema**

```python
OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["headline", "what_changed", "why_it_matters", "supporting_evidence_ids",
                 "contradicting_evidence_ids", "affected_assets", "time_horizon",
                 "risk_scenarios", "suggested_check_template", "confidence"],
    "properties": {
        "headline": {"type": "string", "maxLength": 140},
        "what_changed": {"type": "string", "maxLength": 700},
        "why_it_matters": {"type": "string", "maxLength": 700},
        "supporting_evidence_ids": {"type": "array", "items": {"type": "string"}, "maxItems": 12},
        "contradicting_evidence_ids": {"type": "array", "items": {"type": "string"}, "maxItems": 12},
        "affected_assets": {"type": "array", "items": {"type": "string"}, "maxItems": 20},
        "time_horizon": {"enum": ["INTRADAY", "DAYS_1_7", "WEEKS_1_4", "MONTHS_1_3"]},
        "risk_scenarios": {"type": "array", "items": {"type": "string", "maxLength": 280}, "maxItems": 3},
        "suggested_check_template": {"enum": ["MONITOR", "REVIEW_ALLOCATION", "CHECK_DRAWDOWN_OR_STOP_POLICY", "REDUCE_EVENT_RISK_FOR_REVIEW", "WAIT_FOR_CONFIRMATION", "NO_ACTION_INSUFFICIENT_DATA"]},
        "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
    },
}
```

- [ ] **Step 4: Implement bounded HTTPS and response extraction**

POST to `https://api.openai.com/v1/responses` by default, with a 30-second timeout, two attempts only for 429/5xx/transport errors, `store: false`, and:

```python
body = {
    "model": model,
    "input": [
        {"role": "system", "content": [{"type": "input_text", "text": SYSTEM_PROMPT_V1.format(locale=locale)}]},
        {"role": "user", "content": [{"type": "input_text", "text": bundle.to_json()}]},
    ],
    "text": {"format": {"type": "json_schema", "name": "smart_insight", "strict": True, "schema": OUTPUT_SCHEMA}},
    "store": False,
}
```

Freeze `SYSTEM_PROMPT_V1` with these instructions and hash the exact UTF-8 text into the research run:

```text
You are the interpretation layer of a quantitative personal-investment research cockpit.
Use only facts and evidence IDs in the supplied JSON bundle. Do not browse, use outside knowledge,
calculate a new market number, or guess a missing value. Copy every displayed number exactly from an
evidence fact, preserving its unit, asset, and effective period. Include supplied contradictory evidence
when confidence is above 60. Return prose in {locale}; do not translate evidence IDs, asset codes, units,
enums, or formatted numbers. Choose one allowed suggested-check template. Never create an order, exact
trade size, guaranteed forecast, or price target. If the evidence is insufficient, choose
NO_ACTION_INSUFFICIENT_DATA and lower confidence. Return only the required structured output.
```

Extract exactly one `output_text` item and validate it locally against the closed schema. Never log the API key, full portfolio snapshot, or raw model payload. Add `.env.example` entries `OPENAI_API_KEY=`, `SMART_INSIGHTS_AI_MODEL=`, and `SMART_INSIGHTS_AI_TIMEOUT_SECONDS=30`; AI stays disabled until key and model are explicitly configured.

The system instruction includes the frozen `UserInsightPreference.locale`: `vi` requires Vietnamese prose and `en` requires English prose. Evidence IDs, asset codes, units, structured enums, and formatted numbers are never translated.

- [ ] **Step 5: Run adapter tests**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_openai_responses.py -q`

Expected: PASS.

- [ ] **Step 6: Commit the adapter**

```bash
git add quant-worker/smart_insights/openai_responses.py quant-worker/tests/test_smart_insights_openai_responses.py .env.example
git commit -m "feat: add grounded insight synthesis adapter"
```

---

### Task 4: Reject ungrounded AI output before persistence

**Files:**

- Create: `quant-worker/smart_insights/grounding.py`
- Create: `quant-worker/tests/test_smart_insights_grounding.py`

**Interfaces:**

- Consumes: strict `StructuredInsightOutput`, `EvidenceBundle`, accessible evidence IDs, and Data Confidence ceiling.
- Produces: `GroundingAccepted` or a typed `GroundingRejected` with stable reason codes.

- [ ] **Step 1: Write the rejection matrix first**

```python
@pytest.mark.parametrize("mutation,reason", [
    ("unknown_number", "UNSUPPORTED_NUMBER"),
    ("changed_unit", "UNIT_MISMATCH"),
    ("changed_date", "DATE_MISMATCH"),
    ("unknown_asset", "ASSET_MISMATCH"),
    ("foreign_evidence", "EVIDENCE_SCOPE_VIOLATION"),
    ("omitted_contradiction", "CONTRADICTION_OMITTED"),
    ("confidence_too_high", "CONFIDENCE_EXCEEDS_DATA"),
    ("trade_order", "DISALLOWED_ACTION"),
])
def test_grounding_rejects_invalid_output(mutation, reason) -> None:
    result = verify(mutate(valid_output(), mutation), bundle())
    assert result.reason_code == reason

def test_grounding_accepts_exact_evidence_formatting() -> None:
    assert isinstance(verify(valid_output(), bundle()), GroundingAccepted)
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_grounding.py -q`

Expected: FAIL because the verifier is missing.

- [ ] **Step 3: Implement layered deterministic verification**

Verify in order: schema, evidence-set subset and tenant access, affected-asset subset, time horizon, normalized numeric tokens against the bundle format map, unit/date association in the same sentence, mandatory contradiction inclusion for confidence above 60, integer confidence not exceeding the floor of Data Confidence, and disallowed language. Tokenize numbers conservatively; any unmatched numeric token other than list numbering is rejected. The action-language deny list covers imperative or second-person buy/sell/order/position-size/guarantee/target-price patterns in Vietnamese and English; it must not reject evidence-backed descriptions such as central banks reporting purchases. The allow-list remains the only persisted `suggestedCheckTemplate`.

- [ ] **Step 4: Persist only stable reason codes and hashes**

`GroundingRejected` contains `reason_code`, `field_path`, `output_hash`, and `bundle_fingerprint`; it does not persist rejected prose to `AiInsight`. Provider telemetry may retain the hash and bounded error message.

- [ ] **Step 5: Run the grounding tests**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_grounding.py -q`

Expected: PASS.

- [ ] **Step 6: Commit the grounding gate**

```bash
git add quant-worker/smart_insights/grounding.py quant-worker/tests/test_smart_insights_grounding.py
git commit -m "feat: reject ungrounded smart insights"
```

---

### Task 5: Produce immutable briefing revisions and replay outcomes

**Files:**

- Create: `quant-worker/smart_insights/briefing_pipeline.py`
- Modify: `quant-worker/collect_smart_insights.py`
- Modify: `scripts/run-smart-insights.ps1`
- Create: `quant-worker/tests/test_smart_insights_briefing_pipeline_integration.py`

**Interfaces:**

- Consumes: active tenant/user, date/timezone, validated signals, portfolio/watchlist/preferences, evidence, and optional AI configuration.
- Produces: tenant-scoped `ResearchRun`, `EvidenceItem`, accepted `AiInsight`, immutable `DailyBriefing` revision/items, and append-only outcome JSON.

- [ ] **Step 1: Write frozen revision and fallback tests**

```python
def test_ai_failure_keeps_quant_briefing_without_sample_prose(db) -> None:
    result = generate_briefing(db, tenant="org-1", user="u-1", day="2026-08-13", synthesizer=failing_ai())
    assert result.status == "quant_only"
    assert result.primary_signal_ids
    assert result.ai_insight_ids == ()
    assert "sample" not in json.dumps(result.to_dict()).lower()

def test_late_etf_data_creates_revision_without_mutating_first(db) -> None:
    first = generate_briefing(db, tenant="org-1", user="u-1", day="2026-08-13", as_of="2026-08-13T08:00:00+07:00")
    publish_late_etf(db, observed_at="2026-08-13T12:00:00+07:00")
    second = generate_briefing(db, tenant="org-1", user="u-1", day="2026-08-13", as_of="2026-08-13T12:05:00+07:00")
    assert (first.revision, second.revision) == (1, 2)
    assert reload_briefing(db, first.id).fingerprint == first.fingerprint
```

- [ ] **Step 2: Run integration tests and confirm failure**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_briefing_pipeline_integration.py -q`

Expected: FAIL because the briefing pipeline is absent.

- [ ] **Step 3: Implement the transaction boundary**

Acquire lease `smart-insights:briefing:<tenant>:<user>:<local-date>`, create a tenant-scoped `ResearchRun`, freeze observation/signal/source/portfolio/preference IDs and versions, rank candidates, create permitted `EvidenceItem` rows, synthesize and ground each selected item, then insert the next immutable `DailyBriefing` revision and ordered `DailyBriefingItem` rows. `AiInsight.researchRunId` is mandatory for Workbench output. When synthesis is disabled/rejected, briefing items reference deterministic signals with `aiInsightId=null` and `explanationStatus` equal to `unavailable` or `rejected`.

- [ ] **Step 4: Register daily, late-data, replay, and outcome commands**

```text
python collect_smart_insights.py briefing --all-memberships --local-date YYYY-MM-DD --timezone Asia/Bangkok
python collect_smart_insights.py briefing --organization-id <UUID> --user-id <UUID> --local-date YYYY-MM-DD --timezone Asia/Bangkok
python collect_smart_insights.py briefing-refresh --reason late_etf --local-date YYYY-MM-DD
python collect_smart_insights.py briefing-refresh --reason event_actual --event-id <UUID>
python collect_smart_insights.py replay --briefing-id <UUID>
python collect_smart_insights.py outcomes --briefing-id <UUID> --horizon 1d|7d|30d
```

The scheduler runs `--all-memberships` at 08:00 `SMART_INSIGHTS_PRODUCT_TIMEZONE` (default `Asia/Bangkok`) and enumerates every `Membership` row; all four current roles can read research, and each organization/user pair uses stored or code-owned default preferences. The scoped command validates that the user belongs to the organization and is for operator replay only. Refresh creates a new revision only when the ranked/frozen fingerprint changes. Replay reconstructs from frozen IDs/versions and must match the stored fingerprint. Outcome jobs update only the `outcomes` object and never change ranking, evidence, text, or confidence.

- [ ] **Step 5: Run worker slice tests**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_evidence.py tests/test_smart_insights_personalization.py tests/test_smart_insights_openai_responses.py tests/test_smart_insights_grounding.py tests/test_smart_insights_briefing_pipeline_integration.py -q`

Expected: PASS.

- [ ] **Step 6: Commit briefing orchestration**

```bash
git add quant-worker/smart_insights/briefing_pipeline.py quant-worker/collect_smart_insights.py scripts/run-smart-insights.ps1 quant-worker/tests/test_smart_insights_briefing_pipeline_integration.py
git commit -m "feat: publish replayable daily decision briefs"
```

---

### Task 6: Expose bounded tenant-safe cockpit APIs

**Files:**

- Modify: `src/lib/backend/smart-insights-types.ts`
- Create: `src/lib/backend/smart-insights.ts`
- Create: `src/lib/backend/smart-insights.test.ts`
- Create: `src/app/api/smart-insights/briefing/route.ts`
- Create: `src/app/api/smart-insights/regimes/route.ts`
- Create: `src/app/api/smart-insights/metrics/route.ts`
- Create: `src/app/api/smart-insights/calendar/route.ts`
- Create: `src/app/api/smart-insights/evidence/[id]/route.ts`
- Create: `src/app/api/smart-insights/preferences/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`

**Interfaces:**

- Produces: the seven approved API boundaries and stable JSON read models.

- [ ] **Step 1: Write failing authorization, leakage, and bounds tests**

```typescript
it("never returns another tenant's briefing or evidence", async () => {
  const briefing = await GET_BRIEFING(requestAs("org-b"), { date: "2026-08-13" });
  const evidence = await GET_EVIDENCE(requestAs("org-b"), { params: Promise.resolve({ id: orgAEvidenceId }) });
  expect(briefing.status).toBe(404);
  expect(evidence.status).toBe(404);
});

it("rejects metric or calendar windows over 31 days", async () => {
  expect((await GET_METRICS(requestAs("org-a", "?from=2026-01-01&to=2026-03-01"))).status).toBe(400);
  expect((await GET_CALENDAR(requestAs("org-a", "?from=2026-01-01&to=2026-03-01"))).status).toBe(400);
});
```

- [ ] **Step 2: Run API tests and confirm routes are absent**

Run: `npm test -- src/app/api/tenant-routes.test.ts src/lib/backend/smart-insights.test.ts`

Expected: FAIL on missing routes/read models.

- [ ] **Step 3: Define complete response types**

```typescript
export type FreshnessState = "fresh" | "stale" | "conflicting" | "partial" | "unavailable";
export type RegimeLabel = "strongly_negative" | "negative" | "neutral" | "constructive" | "strongly_positive";

export interface MetricReadModel {
  observationId: string; metricCode: string; market: "crypto" | "macro" | "gold";
  asset: string | null; value: string; unit: string; delta: string | null;
  percentile: string | null; effectiveStart: string; effectiveEnd: string;
  observedAt: string; sourceCode: string; sourceUrl: string; freshness: FreshnessState;
  qualityWarnings: string[]; methodologyVersion: string;
}

export interface BriefingReadModel {
  id: string; localDate: string; revision: number; generatedAt: string; timezone: string;
  status: "complete" | "partial" | "quant_only"; overallDataConfidence: string;
  portfolioState: "available" | "missing"; primary: BriefingItemReadModel[];
  riskAlerts: BriefingItemReadModel[]; sourceRunId: string;
}
```

Add explicit interfaces for briefing item/relevance components, market regime/group inputs, calendar event (`eventDate`, nullable `eventAt`, and `timeStatus`), evidence detail/history/formula, preferences, and Data Health. Numeric values remain decimal strings across JSON.

- [ ] **Step 4: Implement shared query validation and permissions**

Every route calls `requireTenantContext`. GET routes enforce `research/read`; preference PUT enforces `research/write`. Preference GET derives `canWrite` with `hasTenantCapability(context.role, "research", "write")` without weakening its read gate and returns `persisted=false` with the shared defaults when no row exists. `briefing` defaults to latest revision for the requested local date. `metrics` requires allow-listed market/asset and a maximum 31-day inclusive window. `calendar` has the same bound and impact enum `high|medium|low`. `evidence/:id` joins through the active tenant's `ResearchRun`. Global regimes/metrics/events never include raw artifacts or internal storage locators. Preferences always read/write the active user and ignore organization/user IDs from request bodies. Validate locale as `vi|en`, markets as a subset of `crypto|macro|gold`, normalized asset codes, ISO 4217 base currency, code-owned horizon/risk enums, and bounded alert settings.

- [ ] **Step 5: Run route and type checks**

Run: `npm test -- src/app/api/tenant-routes.test.ts src/lib/backend/smart-insights.test.ts`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit the server boundary**

```bash
git add src/lib/backend/smart-insights-types.ts src/lib/backend/smart-insights.ts src/lib/backend/smart-insights.test.ts src/app/api/smart-insights src/app/api/tenant-routes.test.ts
git commit -m "feat: expose smart insights cockpit APIs"
```

---

### Task 7: Replace the Smart Insights monolith with typed cockpit components

**Files:**

- Create: `src/lib/smart-insights-client.ts`
- Create: `src/components/smart-insights/DecisionBrief.tsx`
- Create: `src/components/smart-insights/PortfolioImpact.tsx`
- Create: `src/components/smart-insights/MarketRegimeStrip.tsx`
- Create: `src/components/smart-insights/CryptoPanel.tsx`
- Create: `src/components/smart-insights/MacroPanel.tsx`
- Create: `src/components/smart-insights/GoldPanel.tsx`
- Create: `src/components/smart-insights/EconomicCalendar.tsx`
- Create: `src/components/smart-insights/EvidenceDrawer.tsx`
- Create: `src/components/smart-insights/DataHealthPanel.tsx`
- Create: `src/components/smart-insights/FreshnessBadge.tsx`
- Create: `src/components/smart-insights/source-guard.test.ts`
- Modify: `src/components/SmartInsights.tsx`
- Modify: `src/lib/i18n/dictionary.ts`

**Interfaces:**

- Consumes: typed server responses only.
- Produces: Daily Decision Brief, Portfolio Impact, Market Regime Strip, detail tabs, CryptoCraft Calendar, Evidence Drawer, and Data Health in the approved order.

- [ ] **Step 1: Write source guards before refactoring**

```typescript
it("contains no runtime sample market facts", () => {
  const source = readSmartInsightsSourceTree() + readFileSync("src/lib/i18n/dictionary.ts", "utf8");
  for (const forbidden of ["const tickers", "const NEWS", "const CALENDAR", "76.2", "842M", "67K", "18-22%", "Risk-On"])
    expect(source).not.toContain(forbidden);
});

it("keeps the cockpit split into the approved component boundary", () => {
  const source = readSmartInsightsSourceTree();
  for (const name of ["DecisionBrief", "PortfolioImpact", "MarketRegimeStrip", "CryptoPanel", "MacroPanel", "GoldPanel", "EconomicCalendar", "EvidenceDrawer", "DataHealthPanel"])
    expect(source).toContain(`function ${name}`);
});
```

- [ ] **Step 2: Run the guard and confirm current sample values fail**

Run: `npm test -- src/components/smart-insights/source-guard.test.ts`

Expected: FAIL because the monolith still contains hard-coded runtime facts and components are absent.

- [ ] **Step 3: Implement the typed client and explicit state machine**

Use Zod to parse each response. Query states are `loading`, `ready`, `empty`, and `error`; data state stays separate as `fresh`, `stale`, `conflicting`, `partial`, or `unavailable`. Abort requests on unmount and retain the last parsed read model only during background refresh. Do not replace an error with cached sample values.

- [ ] **Step 4: Build the approved page order with current design tokens**

`SmartInsights.tsx` owns selected market tab, selected evidence ID, impact filters, and query hooks. The preference GET response includes `canWrite`; its locale effect runs only when `canWrite=true`, compares the loaded preference first, and persists only `locale` when the authenticated user's app locale actually differs. That locale is frozen into the next briefing revision. Read-only viewers keep their saved/default briefing locale without a failing PUT. It renders:

```tsx
<DecisionBrief briefing={briefing} onEvidence={setEvidenceId} />
<PortfolioImpact briefing={briefing} preferences={preferences} />
<MarketRegimeStrip regimes={regimes} onSelectMarket={setMarket} />
<MarketDetailTabs active={market} crypto={<CryptoPanel />} macro={<MacroPanel />} gold={<GoldPanel />} />
<EconomicCalendar events={events} impact={impact} onImpactChange={setImpact} />
<EvidenceDrawer evidenceId={evidenceId} onClose={() => setEvidenceId(null)} />
<DataHealthPanel sources={health.sources} />
```

Metric cards show value, delta, percentile, and freshness. Calendar rows show countdown, actual/forecast/previous, surprise, portfolio relevance, source attribution, and `research_only`. Evidence shows source link, effective/observed time, formula/methodology, history, supporting/contradicting IDs, and warnings. When no portfolio exists, `PortfolioImpact` prompts market/asset selection without pretending exposure.

- [ ] **Step 5: Replace sample copy with Vietnamese and English cockpit labels**

Delete the fixed market title, thesis, driver, stance, conviction, allocation action, and risk-watch values under the existing `overview.hero`/`overview.digest` locale blocks; remove their obsolete call sites rather than retaining them as hidden fallback copy. Add keys for all cockpit sections, five regime labels, five freshness states, AI explanation unavailable/rejected, no-portfolio prompt, source attribution, `research_only`, Data Confidence, and all six suggested-check templates. No market fact, asset price, percentage, allocation, target, date, or forecast belongs in the dictionary.

- [ ] **Step 6: Run UI unit and type checks**

Run: `npm test -- src/components/smart-insights/source-guard.test.ts src/lib/backend/smart-insights.test.ts`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit the cockpit refactor**

```bash
git add src/lib/smart-insights-client.ts src/components/smart-insights src/components/SmartInsights.tsx src/lib/i18n/dictionary.ts
git commit -m "feat: build personal decision cockpit"
```

---

### Task 8: Verify deterministic degradation, tenant isolation, and rendered behavior

**Files:**

- Create: `docs/operations/smart-insights-runbook.md`
- Modify: `README.md`

**Interfaces:**

- Produces: repeatable setup, collection, replay, smoke, and incident checks plus browser evidence for the full vertical slice.

- [ ] **Step 1: Run all Smart Insights worker tests**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_*.py -q`

Expected: PASS.

- [ ] **Step 2: Run web tests and production checks**

Run: `npm test -- src/app/api/tenant-routes.test.ts src/lib/backend/smart-insights.test.ts src/components/smart-insights/source-guard.test.ts`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Perform a frozen-day replay**

Generate a briefing for a fixed tenant/user/date, store its fingerprint and ordered signal/evidence IDs, run `replay --briefing-id`, and assert exact identity. Then simulate AI timeout and confirm the same deterministic regimes/metrics/calendar remain available with explanation status `unavailable` and no new `AiInsight`.

- [ ] **Step 4: Test independent source degradation**

Disable one source at a time: Farside, CryptoCraft, FRED, and WGC. For each, confirm its last accepted observation remains visible as stale/unavailable according to SLA, its provider failure appears in Data Health, unrelated market endpoints return 200, and no failed snapshot overwrites the last known-good observation.

- [ ] **Step 5: Verify in a real browser at desktop and mobile widths**

Start the canonical local stack, wait for `/healthz` on port 8100 and the web app on port 3100, then verify authenticated Smart Insights at 1440x900 and 390x844. Exercise market tabs, calendar impact filters, evidence open/close, light/dark theme, no-portfolio state, stale state, quant-only AI failure, and long Vietnamese copy. Confirm no horizontal overflow, console error, uncaught request, sample number, or cross-tenant evidence access.

- [ ] **Step 6: Document exact operations**

The runbook records required environment variables, Firecrawl allow-list and private-network requirement, schedule/frequency matrix, live-smoke enablement gate, CLI examples, lock behavior, typed failures, replay procedure, source attribution, research-only restrictions, and rollback procedure that disables a source without deleting accepted observations.

- [ ] **Step 7: Commit verification documentation**

```bash
git add docs/operations/smart-insights-runbook.md README.md
git commit -m "docs: add smart insights operations runbook"
```

---

## Plan Completion Gate

- [ ] Every visible AI number resolves to a permitted evidence ID, value, unit, and effective period.
- [ ] Grounding rejects unsupported numbers, changed units/dates/assets, inaccessible evidence, omitted contradictions, confidence inflation, and trade-order language.
- [ ] Briefings select at most three primary changes and two risk alerts using exact 35/25/15/15/10 relevance weights.
- [ ] Default briefing runs at 08:00 Asia/Bangkok; late ETF/event actual creates a new immutable revision only when content changes.
- [ ] AI outage/rejection leaves a quant-only cockpit and never renders sample prose.
- [ ] All seven API boundaries enforce permissions, date bounds, and tenant rules.
- [ ] Smart Insights contains no runtime hard-coded market fact, event, news item, or thesis.
- [ ] Desktop/mobile browser verification covers loading, empty, fresh, stale, conflicting, partial, unavailable, no-portfolio, and quant-only states.
- [ ] A frozen briefing replays to the same fingerprint and ordered evidence/signal IDs.
- [ ] `python -m pytest tests/test_smart_insights_*.py -q`, targeted web tests, `npx tsc --noEmit`, `npm run build`, and `git diff --check` pass.
