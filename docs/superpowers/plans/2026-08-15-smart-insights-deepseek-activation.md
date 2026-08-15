# Smart Insights DeepSeek Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the duplicate Smart Insights watchlist and reliably publish evidence-grounded DeepSeek asset opinions for portfolio positions, favorites, BTC, XAU, and VNINDEX.

**Architecture:** Keep deterministic quant scoring, evidence grounding, and immutable briefing publication unchanged. Replace the OpenAI Responses wire contract with DeepSeek Chat Completions, add a tenant-scoped deduplicated refresh queue processed by a Python worker, and expose refresh state through the existing briefing request without running AI in the web path.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma/PostgreSQL, Python 3.11+, psycopg 3, Vitest, pytest, Recharts, DeepSeek OpenAI-compatible Chat Completions.

## Global Constraints

- DeepSeek is interpretation-only; deterministic quant owns score, stance, confidence ceiling, and bounded action.
- Use `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, and `DEEPSEEK_TIMEOUT_SECONDS`; never expose them to the browser.
- Default model is `deepseek-v4-flash`; `deepseek-v4-pro` remains an environment override.
- Provider, schema, grounding, or configuration failure publishes `quant_only`, never sample prose.
- Smart Insights makes one briefing read request and no favorite-assets request.
- AI and quant generation run outside the web request path.
- Refresh requests deduplicate by organization and user and preserve mutations arriving during a running job.
- Keep at most 25 assets, batch database access, and selected-asset-only chart rendering.
- Do not add a second chart library or an AI SDK dependency.

---

### Task 1: DeepSeek Chat Completions Transport

**Files:**
- Modify: `quant-worker/smart_insights/openai_responses.py`
- Modify: `quant-worker/smart_insights/briefing_pipeline.py`
- Modify: `quant-worker/smart_insights/asset_opinion_pipeline.py`
- Modify: `.env.example`
- Test: `quant-worker/tests/test_asset_opinion_ai.py`
- Test: `quant-worker/tests/test_smart_insights_briefing_pipeline_integration.py`

**Interfaces:**
- Consumes: existing `JsonTransport.post_json(...)`, strict parsers, and grounding verifiers.
- Produces: `synthesize(...)` and `synthesize_asset_opinion(...)` using DeepSeek `/chat/completions` while retaining their current result unions.

- [ ] **Step 1: Write failing DeepSeek transport tests**

Add a fake response shaped like:

```python
{"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(valid_payload())}}]}
```

Assert the request uses `messages`, `response_format={"type": "json_object"}`, non-streaming output, disabled thinking, no `store`, and the stable DeepSeek endpoint. Add separate tests proving empty content and `finish_reason="length"` return typed schema failures and a 429 is retried once.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
\.venv\Scripts\python.exe -m pytest quant-worker/tests/test_asset_opinion_ai.py -q
```

Expected: the existing OpenAI Responses body/extractor fails the DeepSeek assertions.

- [ ] **Step 3: Implement the minimal DeepSeek wire contract**

Update the request body to:

```python
{
    "model": model,
    "messages": [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_payload},
    ],
    "response_format": {"type": "json_object"},
    "stream": False,
    "max_tokens": 1800,
    "thinking": {"type": "disabled"},
}
```

Parse exactly one non-empty `choices[0].message.content`, require `finish_reason == "stop"`, cap content at 20,000 characters, JSON-decode it, and keep the existing strict parser and retry budget.

- [ ] **Step 4: Switch worker configuration to DeepSeek**

Pass:

```python
model=os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
api_key=os.getenv("DEEPSEEK_API_KEY")
endpoint=f"{os.getenv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').rstrip('/')}/chat/completions"
timeout_seconds=int(os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "30"))
```

Add the four variables to `.env.example` without a real key.

- [ ] **Step 5: Verify GREEN and regression coverage**

Run the focused AI and briefing-pipeline tests. Expected: all pass with no live provider call.

- [ ] **Step 6: Commit**

Commit message: `feat: use DeepSeek for grounded insight synthesis`.

### Task 2: Deduplicated Briefing Refresh Queue

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260815113000_add_smart_insight_refresh_requests/migration.sql`
- Create: `src/lib/backend/smart-insights-refresh.ts`
- Create: `src/lib/backend/smart-insights-refresh.test.ts`
- Create: `quant-worker/smart_insights/refresh_repository.py`
- Create: `quant-worker/process_smart_insight_refreshes.py`
- Create: `quant-worker/tests/test_smart_insight_refresh_worker.py`
- Modify: `scripts/dev-local.mjs`
- Modify: `scripts/dev-local.test.mjs`

**Interfaces:**
- Produces TypeScript `enqueueBriefingRefresh(context, reason)` and `loadBriefingRefreshState(context)`.
- Produces Python `process_next_refresh(repository, now)` and a `--watch --poll-seconds 5` CLI.

- [ ] **Step 1: Write failing TypeScript queue tests**

Cover: first enqueue creates version 1; a second queued enqueue increments the version without a second row; enqueue during `running` increments `requestVersion` but preserves `running`; state mapping returns `generating`, `failed`, or `idle` without exposing worker IDs.

- [ ] **Step 2: Verify TypeScript RED**

Run:

```powershell
npx vitest run src/lib/backend/smart-insights-refresh.test.ts
```

Expected: module/model does not exist.

- [ ] **Step 3: Add the Prisma model and migration**

Create one row per `(organization_id, user_id)` with `status`, `reason`, `request_version`, `processing_version`, `available_at`, `started_at`, `finished_at`, `worker_id`, `attempt_count`, `error_code`, and timestamps. Add tenant/status indexes and cascading organization/user relations.

- [ ] **Step 4: Implement the tenant-scoped enqueue transaction**

Use a PostgreSQL advisory transaction lock, then create or update the single tenant/user row. Preserve `running` on concurrent mutation; otherwise reset the row to `queued`. Increment `requestVersion` on every accepted refresh request.

- [ ] **Step 5: Write failing Python worker tests**

Use a real fake repository and assert: idle does nothing; claimed version publishes one briefing; a newer request version requeues after completion; transient failure retries up to three attempts; terminal failure records a stable error code and never deletes the last valid briefing.

- [ ] **Step 6: Verify Python RED**

Run:

```powershell
\.venv\Scripts\python.exe -m pytest quant-worker/tests/test_smart_insight_refresh_worker.py -q
```

Expected: refresh worker module does not exist.

- [ ] **Step 7: Implement repository and worker**

Claim with `FOR UPDATE SKIP LOCKED`, set `processing_version=request_version`, generate via `PostgresBriefingRepository` and `generate_briefing`, then set `succeeded` only when versions still match; otherwise set `queued`. Bound polling, attempts, error codes, and worker identity.

- [ ] **Step 8: Add the refresh watcher to local development**

Add one child spec invoking `process_smart_insight_refreshes.py --watch --poll-seconds 5`. Extend the existing child-spec test so an accidental missing watcher fails.

- [ ] **Step 9: Verify GREEN and commit**

Run focused TypeScript/Python/dev-script tests, Prisma validate, and migration status against the test/local database. Commit message: `feat: queue Smart Insights briefing refreshes`.

### Task 3: Enqueue Refreshes and Expose Briefing State

**Files:**
- Modify: `src/app/api/watchlist/route.ts`
- Modify: `src/app/api/watchlist/[id]/route.ts`
- Modify: `src/app/api/portfolio/transactions/route.ts`
- Create: `src/app/api/smart-insights/briefing/refresh/route.ts`
- Modify: `src/app/api/smart-insights/briefing/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`
- Modify: `src/app/api/portfolio/transactions/route.test.ts`
- Modify: `src/lib/smart-insights-client.ts`
- Modify: `src/lib/smart-insights-client.test.ts`

**Interfaces:**
- Produces `POST /api/smart-insights/briefing/refresh` returning `202` and the sanitized refresh state.
- Produces `fetchBriefing(...) -> { briefing: BriefingModel | null; state: BriefingGenerationState }` from the existing GET endpoint.

- [ ] **Step 1: Write failing route and client tests**

Assert successful watchlist add/remove and portfolio transaction call the real enqueue boundary and return `X-Smart-Insights-Refresh: queued`; queue failure leaves the successful mutation response intact with header `failed`. Assert briefing GET returns 202 generating, 404 not-generated, 503 failed, or 200 latest briefing plus a generation-state header. Assert the custom client parses each state.

- [ ] **Step 2: Verify RED**

Run focused Vitest route/client files. Expected: queue imports, refresh route, headers, and typed client are absent.

- [ ] **Step 3: Implement non-destructive mutation enqueueing**

Await the bounded queue write after the successful domain mutation. Never roll back or misreport an already committed portfolio/watchlist mutation if enqueueing fails; return the saved domain payload with `X-Smart-Insights-Refresh: failed`.

- [ ] **Step 4: Implement one-request briefing state**

Load the immutable briefing and refresh state in parallel. Keep the current successful briefing JSON contract; communicate current generation state in `X-Smart-Insights-Briefing-State`. When no briefing exists, return the typed status body and status code without a sample briefing.

- [ ] **Step 5: Implement the explicit refresh endpoint**

Require tenant context and research-write capability, enqueue reason `manual`, and return 202 without running Python or DeepSeek in the route.

- [ ] **Step 6: Verify GREEN and commit**

Run focused tests and TypeScript checking. Commit message: `feat: refresh asset opinions after investor changes`.

### Task 4: Remove Duplicate Watchlist and Clarify Opinion States

**Files:**
- Modify: `src/components/SmartInsights.tsx`
- Modify: `src/components/smart-insights/AssetOpinions.tsx`
- Modify: `src/components/smart-insights/AssetOpinions.test.tsx`
- Modify: `src/components/smart-insights/source-guard.test.ts`

**Interfaces:**
- Consumes: `fetchBriefing(...)` and `BriefingGenerationState` from Task 3.
- Produces: no Smart Insights watchlist render/request; full-width Economic Calendar; explicit opinion generation states and a manual refresh button.

- [ ] **Step 1: Write failing UI behavior tests**

Render `AssetOpinions` with `not_generated`, `generating`, `failed`, `quant_only`, and `accepted`. Assert each has distinct Vietnamese copy, no sample opinion, and only not-generated/failed exposes the refresh action. Add a Smart Insights source guard that fails if `LegacyWatchlist` is imported or rendered.

- [ ] **Step 2: Verify RED**

Run the two component test files. Expected: state props/copy and duplicate-watchlist guard fail.

- [ ] **Step 3: Implement the minimal UI change**

Remove `LegacyWatchlist`, render Economic Calendar full-width, use the specialized briefing fetcher, and pass generation state to `AssetOpinions`. The refresh button calls the queue endpoint, changes immediately to `Đang tạo phân tích`, and does not block Market Pulse.

- [ ] **Step 4: Preserve performance behavior**

Keep independent initial requests parallel, keep existing selected-asset-only charts, and do not add memoization or dynamic imports without a measured regression.

- [ ] **Step 5: Verify GREEN and commit**

Run focused UI/client tests. Commit message: `feat: clarify Smart Insights opinion readiness`.

### Task 5: Apply, Activate, and Verify End to End

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/smart-insights-runbook.md`
- Modify: `docs/superpowers/plans/2026-08-15-smart-insights-deepseek-activation.md` only to check completed steps.

**Interfaces:**
- Consumes all prior tasks.
- Produces an applied local migration, a real quant-only or DeepSeek-backed briefing revision, and verified local UI.

- [ ] **Step 1: Record pre-change performance evidence**

Measure current homepage response time, briefing endpoint behavior, Smart Insights request count, and production bundle route chunks with the existing scripts/browser. Record exact values in the runbook verification note.

- [ ] **Step 2: Run complete automated verification**

Run `npm test`, focused/full worker pytest with a writable `--basetemp`, TypeScript, ESLint, Prisma validate, migration status, `git diff --check`, production build, and the Smart Insights benchmark budget.

- [ ] **Step 3: Apply the migration locally**

Use the project migration command against `.env.local`, verify the refresh table/indexes, and keep historical briefing/provider data intact.

- [ ] **Step 4: Start the updated local stack and publish existing users**

Restart `npm run dev`, verify ports 3100 and 8100, enqueue or run one all-memberships briefing publication, and confirm PostgreSQL has at least one new briefing with non-empty `assetOpinions`.

- [ ] **Step 5: DeepSeek live smoke when configured**

If `DEEPSEEK_API_KEY` is present, run one scoped briefing refresh and verify accepted prose records the configured model and passes grounding. If absent, verify quant-only publication and report live AI smoke as not run rather than passing.

- [ ] **Step 6: Browser QA and post-change measurement**

Verify desktop and mobile: page identity, no framework overlay, console health, duplicate watchlist absent, calendar full-width, explicit briefing state, asset selection, selected charts, evidence drill-down, and no horizontal overflow. Compare response time/request count/bundle results with the baseline and fail on a material regression.

- [ ] **Step 7: Update operations documentation and commit**

Document DeepSeek variables, refresh worker, daily all-memberships schedule, activation command, quant-only fallback, and live-smoke evidence. Commit message: `docs: operate DeepSeek Smart Insights briefings`.

- [ ] **Step 8: Finish the branch**

Use the finishing-development workflow, present verified merge options, and do not push or merge without the user's requested final action.

