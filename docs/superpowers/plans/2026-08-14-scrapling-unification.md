# Scrapling Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every active Crawl4AI path with Scrapling while preserving enabled Smart Insights data contracts and keeping BitInfoCharts disabled unless live production parsing succeeds.

**Architecture:** Reuse `ScraplingClient.scrape` as the single browser-backed boundary. Teach it standards-based charset decoding and allow the fixed CryptoCraft URLs in `scrapling_fetch.py`, then route all browser collectors through one injected client and delete Crawl4AI. Collapse the environments only after a clean dependency resolution check.

**Tech Stack:** Python 3.12, Scrapling 0.4.14, pytest, Next.js 16, TypeScript, Vitest

## Global Constraints

- No user-supplied crawl URLs, proxies, paid CAPTCHA services, fabricated observations, or silent fixture fallback.
- CryptoCraft remains enabled only after both live weekly pages pass the production parser.
- BitInfoCharts remains disabled unless a live page contains the real address table and the existing parser returns non-empty observations.
- Preserve fixed HTTPS allowlists, redirect rejection, byte limits, stable error codes, and private raw artifacts.
- Historical design and plan documents remain unchanged.

---

### Task 1: Scrapling transport supports CryptoCraft safely

**Files:**
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`
- Modify: `quant-worker/smart_insights/scrapling_client.py`
- Modify: `quant-worker/scrapling_fetch.py`

**Interfaces:**
- Consumes: `ScraplingClient.scrape(source: SourceDefinition, url: str) -> RawSnapshot`
- Produces: charset-aware HTML snapshots and an exact CryptoCraft runner allowlist

- [ ] **Step 1: Write failing tests**

Add behavioral tests proving an `ISO-8859-1` HTML response is decoded into UTF-8 JSON, unknown charsets fail with `INVALID_RESPONSE`, the two week URLs and `/calendar/<slug>` detail URLs pass the runner allowlist, and unrelated CryptoCraft paths/queries fail.

- [ ] **Step 2: Verify RED**

Run:

```powershell
..\..\..\.venv\Scripts\python.exe -m pytest tests\test_smart_insights_foundation.py -q
```

Expected: charset and CryptoCraft runner allowlist assertions fail against the current UTF-8-only implementation.

- [ ] **Step 3: Implement the minimum transport change**

Parse the optional `charset` parameter with `email.message.Message`, resolve it through `codecs.lookup`, decode strictly, and map invalid/unknown encodings to `SourceFetchError("INVALID_RESPONSE")`. Add only the fixed CryptoCraft week query values and the `/calendar/<safe-slug>` path to `is_runner_url_allowed`.

- [ ] **Step 4: Verify GREEN**

Run the Task 1 command and expect all tests to pass.

### Task 2: Route sources and remove Crawl4AI

**Files:**
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`
- Modify: `quant-worker/tests/test_smart_insights_registry.py`
- Modify: `quant-worker/tests/test_smart_insights_crypto_collectors.py`
- Modify: `quant-worker/smart_insights/contracts.py`
- Modify: `quant-worker/smart_insights/sources.py`
- Modify: `quant-worker/collect_smart_insights.py`
- Delete: `quant-worker/smart_insights/crawl4ai_client.py`
- Modify: `src/lib/backend/smart-insights-data-health.test.ts`
- Modify: `src/lib/backend/smart-insights-data-health.ts`
- Modify: `src/lib/backend/smart-insights-types.ts`

**Interfaces:**
- Consumes: the Task 1 Scrapling boundary
- Produces: a registry, CLI, scheduler, and Data Health model with no `crawl4ai` mode

- [ ] **Step 1: Write failing routing and registry tests**

Assert CryptoCraft and BitInfoCharts are `CollectionMode.SCRAPLING`, all browser collectors use the injected `scrapling_client`, Data Health reports `scrapling`, and the collection-mode type no longer includes `crawl4ai`.

- [ ] **Step 2: Verify RED**

Run the focused Python and Vitest files; expect mode/routing assertions to fail.

- [ ] **Step 3: Implement minimal routing and deletion**

Remove `CollectionMode.CRAWL4AI` and the Crawl4AI import/construction. Use one `ScraplingClient` for CryptoCraft calendar smoke/schedules plus Farside, CoinShares, and BitInfoCharts. Delete only Crawl4AI-specific adapter tests and the adapter file; preserve collector/parser tests by updating neutral fake metadata names.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
..\..\..\.venv\Scripts\python.exe -m pytest tests\test_smart_insights_foundation.py tests\test_smart_insights_registry.py tests\test_smart_insights_cryptocraft.py tests\test_smart_insights_crypto_collectors.py -q
npm test -- --run src/lib/backend/smart-insights-data-health.test.ts
```

Expected: both commands exit 0.

### Task 3: Simplify dependencies and operations

**Files:**
- Modify: `quant-worker/requirements.txt`
- Delete: `quant-worker/requirements-scrapling.txt`
- Modify: `README.md`
- Modify: `quant-worker/README.md`
- Modify: `docs/operations/smart-insights-runbook.md`

**Interfaces:**
- Consumes: a codebase with no Crawl4AI import
- Produces: one documented Python installation path

- [ ] **Step 1: Prove dependency resolution before editing**

Create a disposable virtual environment outside the repository and install the proposed complete `quant-worker/requirements.txt` with `scrapling[fetchers]==0.4.14` replacing `crawl4ai==0.8.9`. Stop environment collapsing if pip reports a conflict.

- [ ] **Step 2: Update dependency and setup docs**

On successful resolution, replace the Crawl4AI pin, delete the separate Scrapling requirements file, and remove `.scrapling-venv`, Crawl4AI setup/doctor, cache-directory, and attribution instructions. Document `scrapling install` only if a browser fetcher is retained by production code.

- [ ] **Step 3: Verify imports and stale references**

Run `pip check`, import `ScraplingClient`, and search active code/docs for `crawl4ai`, `Crawl4AI`, and `requirements-scrapling`; historical `docs/superpowers` matches are allowed.

### Task 4: Live qualification and release gates

**Files:**
- No production files unless a BitInfoCharts live parser success requires an already-tested fetcher selection change in `quant-worker/scrapling_fetch.py`.

**Interfaces:**
- Consumes: completed Tasks 1-3
- Produces: live evidence and a release-ready branch

- [ ] **Step 1: Live-smoke CryptoCraft**

Run both current and next week pages through the real Scrapling runner and `CryptoCraftCollector`; require HTTP success, `error_code is None`, and non-empty events.

- [ ] **Step 2: Qualify BitInfoCharts**

Try `Fetcher`, then one bounded `StealthyFetcher` attempt using official Scrapling behavior. Enable the source only if the final HTML contains the address table and `BitInfoChartsCollector` returns non-empty observations. Otherwise retain disabled state and report the external block.

- [ ] **Step 3: Run complete gates**

Run full pytest, targeted Vitest, lint, Next.js build, `git diff --check`, and a scoped diff review. If `DATABASE_URL` is configured, run live-smoke and publication for enabled sources without exposing credentials.

- [ ] **Step 4: Commit, merge, and push**

Commit scoped changes, fast-forward or merge the clean branch into current `main`, push non-force, and verify local `main`, `origin/main`, and pushed SHA separately.
