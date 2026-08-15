# Smart Insights Asset Opinion Activation with DeepSeek

Date: 2026-08-15

Status: Approved direction, pending written-spec review

## 1. Objective

Activate the existing evidence-backed asset-opinion pipeline so Smart Insights reliably shows
quantitative and AI-supported views for each user's portfolio positions, favorite assets, and the
representatives `BTC`, `XAU`, and `VNINDEX`.

This slice also removes the duplicate `Danh sách theo dõi` surface from Smart Insights. Favorites
remain managed in Mock Portfolio and remain an input to the briefing worker; only the duplicate
Smart Insights UI is removed.

## 2. Current Verified State

- The asset-opinion quant pipeline, evidence grounding, API contract, comparison table, selected
  asset charts, scenarios, and evidence table already exist.
- PostgreSQL currently contains zero `daily_briefings` for every local membership, so the page has
  no asset opinions to render.
- The primary user already has favorite assets and a portfolio position, so personalization input
  exists.
- `OPENAI_API_KEY` and `SMART_INSIGHTS_AI_MODEL` are not configured locally. The implementation
  will replace the OpenAI-specific transport with DeepSeek configuration.
- Active daily datasets exist for `BTC` and `XAU`. `VNINDEX` does not yet have an active qualified
  daily dataset and must remain `INSUFFICIENT_DATA` until ingestion qualifies it.

## 3. Product Behavior

### 3.1 One source of tracked assets

Mock Portfolio owns favorite-asset management. Smart Insights does not render an add, remove,
alert, or duplicate favorite list.

The briefing universe still uses this deterministic priority:

1. active portfolio positions;
2. favorite assets not already present;
3. `BTC`, `XAU`, and `VNINDEX` when not already present;
4. maximum 25 canonical assets.

Removing the UI must not remove favorite assets from the worker's personalization query.

### 3.2 Smart Insights layout

- Remove `LegacyWatchlist` and its client-side favorite-assets request from Smart Insights.
- Let Economic Calendar use the full available width in the same visual style.
- Keep `Quan điểm AI theo tài sản` above Market Pulse.
- Preserve the existing comparison table/mobile cards, selected-asset charts, scenarios, evidence
  table, freshness labels, and portfolio-aware action panel.

### 3.3 Explicit states

The asset-opinion block must distinguish:

- `generating`: a briefing refresh is queued or running;
- `quant_only`: verified quant output exists but DeepSeek is unavailable, rejected, or disabled;
- `accepted`: DeepSeek prose passed schema and evidence grounding;
- `insufficient_data`: the asset stays visible with its failed gates;
- `not_generated`: no briefing has been published yet, with an explicit refresh action or queued
  state rather than a vague empty card;
- `failed`: generation failed, with retry guidance and no sample content.

No seed opinion or invented market value is allowed.

## 4. DeepSeek Transport

### 4.1 Configuration

Use provider-specific environment variables:

```text
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_TIMEOUT_SECONDS=30
```

`deepseek-v4-flash` in non-thinking mode is the default because the deterministic quant layer has
already selected the stance, confidence ceiling, evidence, and bounded action. Operators may select
`deepseek-v4-pro` without changing code.

Do not use the retired `deepseek-chat` or `deepseek-reasoner` aliases. Do not use beta endpoints or
strict tool-calling for this slice.

### 4.2 Request contract

Call the stable OpenAI-compatible `POST /chat/completions` endpoint with:

- one system message containing the evidence-only and safety constraints;
- one user message containing a single asset's locked fact sheet;
- `response_format: {"type": "json_object"}`;
- an explicit JSON example and the word `json` in the prompt;
- non-streaming output;
- thinking disabled;
- bounded `max_tokens`, request time, response size, and concurrency.

The request contains only the active asset's permitted fact sheet, portfolio snapshot fields needed
for the bounded action explanation, and non-secret identifiers. It contains no provider credential,
raw private artifact, unrelated portfolio asset, or tenant metadata.

### 4.3 Validation and failure behavior

The existing strict parser and grounding verifier remain authoritative. DeepSeek never calculates
the quant score, stance, confidence ceiling, or personalized action.

Treat empty content, invalid JSON, truncation, timeout, rate limit, provider failure, unsupported
number, changed action, or grounding rejection as a typed AI failure. A bounded retry is allowed
only for an empty or transient provider response. The published result must then remain
`quant_only`; older AI prose is never attached to newer evidence.

Do not log the API key, full private prompt, or raw provider response. Store only accepted prose,
model name, prompt version, token usage when available, stable failure code, latency, and the
content-addressed evidence fingerprint.

### 4.4 Provider abstraction

Introduce a small synthesis-client boundary used by both general briefing synthesis and asset
opinion synthesis. Production wiring uses DeepSeek. Tests inject a fake transport and never call a
live provider.

The provider boundary owns HTTP request/response mapping only. Schema parsing, evidence grounding,
quant fallback, and publication remain provider-independent.

## 5. Briefing Lifecycle

### 5.1 Daily publication

Run the existing all-memberships briefing job after upstream daily collectors and market-data
ingestion complete:

```powershell
scripts/run-smart-insights.ps1 -Schedule briefing -AllMemberships
```

The job is immutable and idempotent by tenant, user, product date, revision, and input fingerprint.
AI and quant generation never run in the page request path.

### 5.2 Refresh after user changes

After a successful portfolio transaction or favorite-asset mutation, enqueue one deduplicated
`briefing-refresh` request for that organization and user. The UI may continue showing the previous
briefing with an `Đang cập nhật` label until the new revision is published.

Rapid edits must coalesce into one pending refresh. A failed refresh must not invalidate the last
valid briefing.

### 5.3 Existing-account activation

After deployment, run one all-memberships briefing publication to populate existing users. This is
an explicit operational step, not a seed-data fallback.

## 6. Data Readiness

- `BTC` and `XAU` may become actionable only when their current bars and specialized evidence pass
  the existing gates.
- Add or qualify a real `VNINDEX` daily dataset before expecting an actionable VNINDEX opinion.
- Favorite or held assets without sufficient history remain visible as `Chưa đủ bằng chứng` with
  exact missing/stale gates.
- Smart Insights providers such as ETF flows, Fear & Greed, on-chain, large-address activity, and
  derivatives remain evidence inputs only when their live source and freshness gates pass.

## 7. API and UI Contract Changes

The existing tenant-scoped briefing endpoint remains the single read request for opinions. Extend
its no-briefing response or add a bounded status field so the client can distinguish
`not_generated`, `generating`, and `failed` without polling provider systems.

The web page must not call favorite-assets APIs after `LegacyWatchlist` is removed. It must not call
DeepSeek directly. A user-triggered refresh, if exposed, enqueues work and returns immediately.

## 8. Performance and Security

- Preserve one briefing read request and batch loading for at most 25 assets.
- Render charts only for the selected asset.
- Limit concurrent DeepSeek requests in the worker and reuse the existing per-asset failure
  isolation.
- Add no new charting or AI SDK dependency unless the existing HTTP/OpenAI-compatible client cannot
  express the stable Chat Completions request safely.
- Keep personalized caching private and keyed by organization, user, product date, revision, and
  fingerprint.
- Never expose DeepSeek credentials to the browser or Next.js public environment variables.

## 9. Verification

### Unit and contract tests

- DeepSeek request uses the stable base URL, current configurable model, JSON Output, non-thinking
  mode, bounded time/token settings, and no secret logging.
- Empty content, malformed JSON, timeout, rate limit, and grounding failure produce `quant_only`.
- Accepted output cannot change a quant action or introduce an unsupported number.
- Removing `LegacyWatchlist` removes its request while favorite assets remain in the worker universe.
- Briefing status distinguishes not generated, generating, failed, quant-only, and accepted.

### Integration and runtime checks

- Run a fake-provider briefing integration test in CI.
- With a configured local `DEEPSEEK_API_KEY`, run one scoped live smoke that publishes a new briefing
  revision and verify it through the authenticated API. Do not require a live key for normal tests.
- Verify PostgreSQL contains asset opinions and the model/prompt/fingerprint audit fields.
- Verify BTC/XAU render real numerical evidence and VNINDEX fails closed until its dataset is ready.
- Verify desktop and mobile selection, charts, evidence drill-down, explicit states, and absence of
  the duplicate watchlist.
- Re-run the existing Smart Insights response-size, query-count, bundle, and browser performance
  checks with no regression over the accepted budgets.

## 10. Acceptance Criteria

- Smart Insights no longer shows `Danh sách theo dõi` or requests favorite assets independently.
- Mock Portfolio remains the only user-facing favorite-management surface.
- Favorites and portfolio positions still feed the asset-opinion universe.
- Existing users receive a real published briefing after the activation run.
- DeepSeek is the only production AI synthesis provider for this feature.
- Missing DeepSeek configuration or provider failure still produces a useful quant-only view.
- Every accepted AI number and claim resolves to the active evidence bundle.
- BTC, XAU, and qualified user assets show tables/charts; unqualified VNINDEX or favorites show exact
  insufficiency gates, never sample opinions.
- Daily and mutation-triggered refreshes run outside the web request path and remain deduplicated.
- Targeted worker, API, UI, build, browser, and performance verification passes before merge or
  push.

## 11. Official DeepSeek References

- API changelog and current models: https://api-docs.deepseek.com/updates/
- Chat Completions API: https://api-docs.deepseek.com/api/create-chat-completion
- JSON Output guide: https://api-docs.deepseek.com/guides/json_mode

