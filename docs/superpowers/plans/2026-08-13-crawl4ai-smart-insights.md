# Crawl4AI Smart Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Firecrawl with local Crawl4AI acquisition, prove every browser-backed parser against its live source, enable only successful sources, and deliver the verified result to `main`.

**Architecture:** A synchronous `Crawl4AIClient.scrape(source, url) -> RawSnapshot` adapter wraps Crawl4AI's asynchronous Chromium runner. Existing collectors depend only on that boundary, so parsing, validation, artifacts, publication, and data-health behavior remain unchanged.

**Tech Stack:** Python 3.12, `crawl4ai==0.8.9`, Playwright/Chromium, pytest, PostgreSQL/Prisma, Next.js 16, Git.

## Global Constraints

- Do not run a Crawl4AI HTTP server, Docker stack, cloud API, proxy, CAPTCHA solver, or LLM extraction.
- Crawl only registered HTTPS URLs and verify the final URL before accepting content.
- Use a fresh headless browser context, robots.txt checking, cache bypass, a 30-second page timeout, and a 20 MB serialized response cap.
- Preserve deterministic parsers, immutable raw artifacts, sanitized error codes, and existing database contracts.
- A source enters `ENABLED_SOURCE_CODES` only after its live production parser and database publication succeed.
- Pin `crawl4ai==0.8.9` and include its required public attribution.
- Preserve unrelated work and integrate through the existing `codex/smart-insights-cockpit` worktree.

---

### Task 1: Add the local Crawl4AI acquisition boundary

**Files:**
- Create: `quant-worker/smart_insights/crawl4ai_client.py`
- Delete: `quant-worker/smart_insights/firecrawl.py`
- Modify: `quant-worker/smart_insights/contracts.py`
- Modify: `quant-worker/smart_insights/sources.py`
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`
- Modify: `quant-worker/tests/test_smart_insights_registry.py`

**Interfaces:**
- Consumes: `SourceDefinition`, `RawSnapshot`, `is_source_url_allowed`, and `SourceFetchError`.
- Produces: `CollectionMode.CRAWL4AI`, `Crawl4AIClient(runner=None, clock=None, max_bytes=20_000_000)`, and `Crawl4AIClient.scrape(source, url) -> RawSnapshot`.

- [ ] **Step 1: Write failing adapter and registry tests**

Replace the Firecrawl tests with tests whose fake runner returns a complete Crawl4AI-shaped result:

```python
result = SimpleNamespace(
    success=True,
    url="https://farside.co.uk/btc/",
    status_code=200,
    markdown="| Date | Flow |\n|---|---:|\n| 13 Aug | 10 |",
    html="<table><tr><td>13 Aug</td><td>10</td></tr></table>",
    error_message="",
)
client = Crawl4AIClient(runner=lambda _url: result, clock=lambda: NOW)
snapshot = client.scrape(source_for_code("farside-btc-etf"), result.url)
assert json.loads(snapshot.content)["metadata"] == {
    "sourceURL": result.url,
    "statusCode": 200,
}
```

Add separate behavior tests proving that an outside URL is rejected before the runner executes, a changed final URL raises `REDIRECT_REJECTED`, empty output raises `INVALID_RESPONSE`, and a payload over `max_bytes` raises `RESPONSE_TOO_LARGE`. Change registry expectations to `CollectionMode.CRAWL4AI` and quality label `crawl4ai_table`.

- [ ] **Step 2: Run the tests and verify the intended red state**

Run:

```powershell
$env:PYTHONPATH='quant-worker'
.\.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_foundation.py quant-worker\tests\test_smart_insights_registry.py -q --basetemp=.pytest-tmp-crawl4ai-red
```

Expected: collection/import assertions fail because `crawl4ai_client.py` and `CollectionMode.CRAWL4AI` do not exist.

- [ ] **Step 3: Implement the minimal adapter and registry migration**

Implement a runner-injected adapter. The default runner imports Crawl4AI lazily, uses `BrowserConfig(headless=True, verbose=False)`, and calls `AsyncWebCrawler.arun` with:

```python
CrawlerRunConfig(
    cache_mode=CacheMode.BYPASS,
    check_robots_txt=True,
    page_timeout=30_000,
    process_iframes=False,
    remove_overlay_elements=True,
)
```

Normalize output to the existing parser envelope:

```python
data = {
    "markdown": markdown,
    "rawHtml": html,
    "metadata": {"sourceURL": final_url, "statusCode": status_code},
}
```

Map browser exceptions to `SourceFetchError("NETWORK_ERROR")` without exposing the upstream exception text. Replace `FIRECRAWL` with `CRAWL4AI` and `firecrawl_table` with `crawl4ai_table` in the active source registry.

- [ ] **Step 4: Run focused tests and verify green**

Run the Step 2 command again. Expected: all selected tests pass.

- [ ] **Step 5: Commit the acquisition boundary**

```powershell
git add quant-worker/smart_insights/crawl4ai_client.py quant-worker/smart_insights/firecrawl.py quant-worker/smart_insights/contracts.py quant-worker/smart_insights/sources.py quant-worker/tests/test_smart_insights_foundation.py quant-worker/tests/test_smart_insights_registry.py
git commit -m "feat: replace Firecrawl with Crawl4AI"
```

### Task 2: Wire collectors, CLI, dependency, and operations to Crawl4AI

**Files:**
- Modify: `quant-worker/collect_smart_insights.py`
- Modify: `quant-worker/smart_insights/collectors/farside.py`
- Modify: `quant-worker/smart_insights/collectors/coinshares.py`
- Modify: `quant-worker/smart_insights/collectors/bitinfocharts.py`
- Modify: `quant-worker/smart_insights/collectors/cryptocraft.py`
- Modify: `quant-worker/smart_insights/collectors/world_gold_council.py`
- Modify: `quant-worker/tests/test_smart_insights_crypto_collectors.py`
- Modify: `quant-worker/tests/test_smart_insights_cryptocraft.py`
- Modify: `quant-worker/tests/test_smart_insights_gold_collectors.py`
- Modify: `quant-worker/requirements.txt`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `quant-worker/README.md`
- Modify: `docs/operations/smart-insights-runbook.md`

**Interfaces:**
- Consumes: `Crawl4AIClient.scrape(source, url) -> RawSnapshot` from Task 1.
- Produces: collectors accepting `crawler=...`, CLI construction with no crawl API environment variables, pinned local dependency, and operator setup commands.

- [ ] **Step 1: Change tests to the generic crawler boundary**

Rename `FakeFirecrawl` to `FakeCrawler`, collector keyword arguments from `firecrawl=` to `crawler=`, and fixture metadata from `collector: firecrawl` to `collector: crawl4ai`. Add a CLI construction test that injects `Crawl4AIClient` and demonstrates browser-backed collectors do not read `FIRECRAWL_API_URL` or `FIRECRAWL_API_KEY`.

- [ ] **Step 2: Run focused collector tests and verify red**

```powershell
$env:PYTHONPATH='quant-worker'
.\.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_crypto_collectors.py quant-worker\tests\test_smart_insights_cryptocraft.py quant-worker\tests\test_smart_insights_gold_collectors.py quant-worker\tests\test_smart_insights_foundation.py -q --basetemp=.pytest-tmp-crawler-wiring-red
```

Expected: collector constructors reject `crawler=` and the CLI still references `FirecrawlClient`.

- [ ] **Step 3: Migrate production wiring and documentation**

Rename collector fields and constructor keywords to `crawler`, import and construct `Crawl4AIClient()` in the CLI, and remove all active `FIRECRAWL_*` environment configuration. Pin `crawl4ai==0.8.9`. Document:

```powershell
.\.venv\Scripts\python.exe -m pip install -r quant-worker\requirements.txt
.\.venv\Scripts\crawl4ai-setup.exe
.\.venv\Scripts\crawl4ai-doctor.exe
```

Add Crawl4AI attribution with a link to `https://github.com/unclecode/crawl4ai` in the root README.

- [ ] **Step 4: Run focused tests and verify green**

Run the Step 2 command again. Expected: all selected tests pass.

- [ ] **Step 5: Commit production wiring**

```powershell
git add quant-worker/collect_smart_insights.py quant-worker/smart_insights/collectors quant-worker/tests .env.example README.md quant-worker/README.md docs/operations/smart-insights-runbook.md quant-worker/requirements.txt
git commit -m "feat: run browser sources with Crawl4AI"
```

### Task 3: Install Crawl4AI and qualify live sources

**Files:**
- Modify after successful smoke: `quant-worker/smart_insights/sources.py`
- Modify after successful smoke: `quant-worker/tests/test_smart_insights_foundation.py`
- Modify after successful smoke: `docs/operations/smart-insights-runbook.md`

**Interfaces:**
- Consumes: the pinned dependency and all live-smoke CLI paths.
- Produces: a browser runtime verified by `crawl4ai-doctor`, an evidence table for every browser source, and an enabled set containing only sources with successful parse and publication.

- [ ] **Step 1: Review and install the pinned dependency**

Run `pip install --dry-run crawl4ai==0.8.9`, inspect dependency changes, then install `quant-worker/requirements.txt`. Run `crawl4ai-setup` and `crawl4ai-doctor`. Stop if the install introduces an unresolved dependency conflict or the doctor cannot launch Chromium.

- [ ] **Step 2: Live-smoke every browser-backed source without DB writes**

Run each source separately with the configured `.env.local`:

```powershell
.\.venv\Scripts\python.exe quant-worker\collect_smart_insights.py calendar-current --source cryptocraft --live-smoke --env-file '..\..\.env.local'
.\.venv\Scripts\python.exe quant-worker\collect_smart_insights.py daily --source farside-btc-etf --live-smoke --env-file '..\..\.env.local'
.\.venv\Scripts\python.exe quant-worker\collect_smart_insights.py daily --source farside-eth-etf --live-smoke --env-file '..\..\.env.local'
.\.venv\Scripts\python.exe quant-worker\collect_smart_insights.py daily --source farside-sol-etf --live-smoke --env-file '..\..\.env.local'
.\.venv\Scripts\python.exe quant-worker\collect_smart_insights.py weekly --source coinshares-weekly --live-smoke --env-file '..\..\.env.local'
.\.venv\Scripts\python.exe quant-worker\collect_smart_insights.py daily --source bitinfocharts-top-addresses --live-smoke --env-file '..\..\.env.local'
.\.venv\Scripts\python.exe quant-worker\collect_smart_insights.py monthly --source wgc-gold-etf --live-smoke --env-file '..\..\.env.local'
.\.venv\Scripts\python.exe quant-worker\collect_smart_insights.py monthly --source wgc-central-bank --live-smoke --env-file '..\..\.env.local'
```

Record `status`, `recordsFetched`, `effectiveAt`, and `errorCode` for every source. Do not modify the enabled set for failures.

- [ ] **Step 3: Write the enabled-set expectation for successful sources and verify red**

Update the literal expected `ENABLED_SOURCE_CODES` in `test_registry_is_code_owned_live_smoked_and_quality_weighted` with only the sources that passed Step 2. Run that test and verify it fails because production has not enabled them.

- [ ] **Step 4: Enable only successful sources and verify green**

Add exactly the successful codes to `ENABLED_SOURCE_CODES`, update the runbook status table, and rerun the registry and relevant collector tests.

- [ ] **Step 5: Publish each newly enabled source to PostgreSQL**

Run the matching non-smoke schedule command for each newly enabled source. For CryptoCraft run `calendar-current`; for source-period WGC sources run `monthly`. A publication must end in `succeeded`, `unchanged`, or `not_due`; otherwise remove that source from the enabled set and document its failure.

- [ ] **Step 6: Commit the qualified source set**

```powershell
git add quant-worker/smart_insights/sources.py quant-worker/tests/test_smart_insights_foundation.py docs/operations/smart-insights-runbook.md
git commit -m "feat: enable verified browser data sources"
```

### Task 4: Full verification, merge, and push

**Files:**
- Verify: all files changed since `main`

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: green feature and merged trees, a pushed `main` SHA, and explicit remote verification.

- [ ] **Step 1: Run the full verification matrix**

Run Smart Insights pytest with `TEST_DATABASE_URL`, all web tests, `npx tsc --noEmit`, ESLint on changed JavaScript/TypeScript files, `npm run build -- --webpack` with build-only auth/database variables, `npx prisma migrate status`, and `git diff --check`.

- [ ] **Step 2: Verify branch state and fetch remote**

Confirm the worktree is clean and named, fetch `origin`, inspect the main checkout for unrelated dirt, and compare the feature merge base with `origin/main`. Never force-push.

- [ ] **Step 3: Merge through a clean integration checkout**

If the main checkout is dirty, create a clean integration worktree from `origin/main`, merge `codex/smart-insights-cockpit`, and rerun the full verification matrix on the merged tree. If the main checkout is clean, merge there and run the same checks.

- [ ] **Step 4: Push and prove the remote SHA**

Push the verified merged commit to `origin/main`. Fetch again and compare `git ls-remote origin refs/heads/main` with the local merged SHA. Report local branch SHA, remote main SHA, migration state, live source status, and any browser source left disabled.
