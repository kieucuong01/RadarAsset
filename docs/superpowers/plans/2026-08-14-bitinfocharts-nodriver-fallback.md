# BitInfoCharts Nodriver Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retrieve and publish the real BTC richest-address cohort when BitInfoCharts returns a Cloudflare 403 to Scrapling, using a bounded Nodriver fallback without weakening validation or changing any other source transport.

**Architecture:** Keep `ScraplingClient` as the primary crawler. A BitInfoCharts-only coordinator inspects a structured Scrapling 403 and lazily launches a single Nodriver browser with a fresh profile. The browser returns bounded raw HTML; one generic HTML-table normalizer converts the provider table into the existing `MarkdownTable` contract, and the existing `BitInfoChartsCollector._parse_rows` remains the sole authority for addresses, labels, exclusions, balances, cohort identity, and observations. The source stays disabled until deterministic tests, live smoke, PostgreSQL publication, and Data Health verification all pass.

**Tech Stack:** Python 3.12-compatible standard library, Nodriver 0.50.1, locally installed Chrome or Chromium, existing Scrapling 0.4.14 transport, `html.parser`, existing psycopg repository, pytest, Prisma 7, Next.js 16, Vitest.

## Global Constraints

- Scope is only `bitinfocharts-top-addresses`; Scrapling remains unchanged as the selected transport for CryptoCraft, Farside, and CoinShares.
- Nodriver is lazy and fallback-only: it may start only after Scrapling returns `HTTP_ERROR` with HTTP status 403.
- Use one browser and one page with a fresh temporary profile for each fallback attempt; never save or reuse cookies.
- Enforce one 60-second wall-clock deadline across launch, navigation, DOM wait, validation, and cleanup initiation.
- Do not call `cf_verify`, click Turnstile/CAPTCHA, add proxy rotation, or use an external challenge-solving service.
- Reject challenge-only pages, redirects outside the source allow-list, empty HTML, missing tables, oversized HTML, and all parser/quality failures.
- No live provider HTML, addresses, cookies, screenshots, or browser profiles are committed or printed. Live evidence contains only status, row count, minimum accepted balance, cohort hash, timestamps, and stable error codes.
- All accepted addresses remain BTC-only, ranks 1-100, and at least 1,000 BTC. Existing entity exclusions and `HEURISTIC_ADDRESS_COHORT` quality flags remain authoritative.
- `bitinfocharts-top-addresses` remains absent from `ENABLED_SOURCE_CODES` until the final qualification task succeeds. `mempool-btc-large-addresses` is not enabled by this plan.
- Nodriver is AGPL-3.0. Keep the dependency and deployment implications visible in the runbook; request a license review before any distribution or network service use that changes the current non-commercial deployment assumption.
- Reuse the existing database schema and migrations; do not create a Prisma migration.
- If the pre-integration live probe fails, delete the temporary probe file, keep the source disabled, record the sanitized failure, and stop. Do not add Nodriver to `requirements.txt` or commit production fallback code.

## File Structure

- `quant-worker/smart_insights/http.py`: preserve HTTP status on `SourceFetchError` so 403 is distinguishable from other 4xx failures.
- `quant-worker/smart_insights/scrapling_client.py`: attach the non-success response status to structured fetch errors.
- `quant-worker/smart_insights/parsers/html_table.py`: normalize one unambiguous richest-address HTML table into the existing `MarkdownTable` contract.
- `quant-worker/smart_insights/collectors/bitinfocharts.py`: accept normalized `rawHtml` while retaining the existing business parser and observation logic.
- `quant-worker/smart_insights/bitinfocharts_crawler.py`: coordinate Scrapling primary and lazy 403-only browser fallback.
- `quant-worker/smart_insights/nodriver_bitinfocharts.py`: bounded browser launch, navigation, challenge detection, HTML acquisition, snapshot metadata, and cleanup.
- `quant-worker/collect_smart_insights.py`: inject the BitInfoCharts-specific coordinator without affecting other collectors.
- `quant-worker/requirements.txt`: pin Nodriver only after the live probe gate passes.
- `quant-worker/tests/fixtures/smart_insights/bitinfocharts-live.html`: deterministic provider-shaped HTML fixture with synthetic addresses and no captured live body.
- `quant-worker/tests/test_smart_insights_foundation.py`: structured status and Nodriver lifecycle tests.
- `quant-worker/tests/test_smart_insights_crypto_collectors.py`: raw-HTML normalization, coordinator, and builder-wiring tests.
- `docs/operations/smart-insights-runbook.md`: browser runtime, AGPL, failure codes, qualification evidence, and source state.

---

### Task 1: Run the stop/go Nodriver live probe before product integration

**Files:**
- Create temporarily, never commit: `.local-data/bitinfocharts_nodriver_probe.py`
- Create ignored environment: `.local-data/nodriver-probe-venv/`
- Modify only on probe failure: `docs/operations/smart-insights-runbook.md`

**Interfaces:**
- Consumes exactly `https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html`.
- Produces a sanitized JSON line with `status`, `errorCode`, `rowCount`, `minimumBalanceBtc`, `cohortVersion`, and `elapsedSeconds`.
- Exit `0` only when a real table is found and the current `BitInfoChartsCollector._parse_rows` accepts at least one row; exit `1` for all provider/browser failures.

- [ ] **Step 1: Confirm the source is still disabled and the dependency is absent**

Run from the isolated worktree root:

```powershell
rg -n "bitinfocharts-top-addresses|ENABLED_SOURCE_CODES" quant-worker\smart_insights\sources.py
....\.venv\Scripts\python.exe -m pip show nodriver
git status --short --branch
```

Expected: BitInfoCharts is registered but absent from `ENABLED_SOURCE_CODES`; `pip show` reports Nodriver absent; the worktree contains no implementation changes.

- [ ] **Step 2: Create an isolated probe runtime**

```powershell
....\.venv\Scripts\python.exe -m venv .local-data\nodriver-probe-venv
.\.local-data\nodriver-probe-venv\Scripts\python.exe -m pip install nodriver==0.50.1
```

Expected: installation succeeds only inside the ignored probe environment. Do not edit `quant-worker/requirements.txt` yet.

- [ ] **Step 3: Write the one-use probe with no challenge interaction**

Use `apply_patch` to create `.local-data/bitinfocharts_nodriver_probe.py`. The probe must:

1. call `await nodriver.start(headless=False)` with the library-generated fresh profile;
2. navigate once to the allow-listed URL;
3. run the full coroutine through `asyncio.wait_for(..., timeout=60)`;
4. wait for a `table` element, then call `await page.get_content()`;
5. reject final URLs outside `bitinfocharts.com`;
6. reject HTML containing `cf-turnstile`, `challenges.cloudflare.com`, `verify you are human`, or `just a moment` when no valid richest-address table exists;
7. locate exactly one table whose headers include `Address`, `Balance`, `First In`, and `Last In` using `parse_html_tables`;
8. convert that structural table to `MarkdownTable` and call `BitInfoChartsCollector._parse_rows`;
9. print only the sanitized JSON contract above;
10. call `await browser.stop()` in `finally` and allow Nodriver to remove its generated profile.

The probe must never call `page.cf_verify()`, `click()`, cookie save/load methods, or screenshot methods.

- [ ] **Step 4: Run the probe once with explicit browser permission**

```powershell
$env:PYTHONPATH = (Resolve-Path 'quant-worker').Path
.\.local-data\nodriver-probe-venv\Scripts\python.exe -X utf8 .local-data\bitinfocharts_nodriver_probe.py
```

Expected go gate: exit `0`, non-zero `rowCount`, `minimumBalanceBtc >= 1000`, a 64-character `cohortVersion`, and `elapsedSeconds <= 60`. No provider body or address is printed.

- [ ] **Step 5: Apply the conditional stop rule**

If the probe fails, use `apply_patch` to delete the temporary probe, update only the disabled-source row in `docs/operations/smart-insights-runbook.md` with date and stable error code, commit that documentation if changed, and stop this plan. Do not execute Tasks 2-7.

If the probe passes, use `apply_patch` to delete the temporary probe, verify `.local-data/` is ignored, and continue. The ignored probe virtual environment may remain local but must not appear in `git status`.

---

### Task 2: Normalize provider HTML through the existing BitInfoCharts business parser

**Files:**
- Modify: `quant-worker/smart_insights/parsers/html_table.py`
- Modify: `quant-worker/smart_insights/collectors/bitinfocharts.py`
- Create: `quant-worker/tests/fixtures/smart_insights/bitinfocharts-live.html`
- Modify: `quant-worker/tests/test_smart_insights_crypto_collectors.py`

**Interfaces:**
- Add `normalize_bitinfocharts_table(html: str) -> MarkdownTable`.
- `BitInfoChartsCollector.collect()` accepts either a non-empty `rawHtml` or the existing `markdown`, preferring `rawHtml` and falling back to `markdown` only when HTML normalization fails.
- `_parse_rows(headers, rows)` remains the sole address, label, exclusion, rank, balance-floor, and duplicate validator.

- [ ] **Step 1: Write failing HTML-normalization tests**

Create a provider-shaped fixture containing navigation tables plus exactly one synthetic richest-address table. Add tests equivalent to:

```python
batch = BitInfoChartsCollector(
    crawler=FakeCrawlerHtml(fixture_text("bitinfocharts-live.html"))
).collect(NOW)

assert batch.error_code is None
addresses = [
    row for row in batch.observations
    if row.metric_code == "crypto.large_address.address_balance_btc"
]
assert addresses
assert all(row.value >= Decimal("1000") for row in addresses)
assert len({row.dimensions["cohort_version"] for row in addresses}) == 1
```

Add cases for zero matching tables, two matching tables, missing required headers, duplicate address, rank above 100, and a balance below 1,000 BTC. Ambiguous/malformed cases must return `SCHEMA_DRIFT` or the existing specific parser error with no observations.

- [ ] **Step 2: Run the focused tests and observe failure**

Run from `quant-worker`:

```powershell
..\..\..\.venv\Scripts\python.exe -m pytest tests\test_smart_insights_crypto_collectors.py -k "bitinfocharts and html" -q
```

Expected: FAIL because `normalize_bitinfocharts_table` and raw-HTML support do not exist.

- [ ] **Step 3: Implement one structural normalizer**

In `html_table.py`, reuse bounded `parse_html_tables(max_rows=500, max_columns=100)`. Select exactly one table with one header row containing case-insensitive required headers. Preserve an empty leading rank header, map every data row with `dict(zip(..., strict=True))`, and return `MarkdownTable`. Reject missing or ambiguous matches with `ValueError("SCHEMA_DRIFT")`.

In `BitInfoChartsCollector.collect()`, choose the table as follows:

```python
if isinstance(raw_html, str) and raw_html.strip():
    try:
        table = normalize_bitinfocharts_table(raw_html)
    except ValueError:
        if not isinstance(markdown, str) or not markdown.strip():
            raise
        table = parse_markdown_table(markdown, required_headers=required_headers)
elif isinstance(markdown, str) and markdown.strip():
    table = parse_markdown_table(markdown, required_headers=required_headers)
else:
    raise ValueError("SCHEMA_DRIFT")
```

Pass the resulting `table.headers` and `table.rows` to the unchanged `_parse_rows` method.

- [ ] **Step 4: Run focused and collector regression tests**

```powershell
..\..\..\.venv\Scripts\python.exe -m pytest tests\test_smart_insights_crypto_collectors.py -k "bitinfocharts" -q
..\..\..\.venv\Scripts\python.exe -m pytest tests\test_smart_insights_crypto_collectors.py -k "farside or cryptocraft or coinshares" -q
```

Expected: PASS; existing Markdown fixtures remain accepted and other HTML normalizers remain unchanged.

- [ ] **Step 5: Commit the HTML normalization boundary**

```powershell
git add quant-worker/smart_insights/parsers/html_table.py quant-worker/smart_insights/collectors/bitinfocharts.py quant-worker/tests/fixtures/smart_insights/bitinfocharts-live.html quant-worker/tests/test_smart_insights_crypto_collectors.py
git commit -m "feat: normalize BitInfoCharts HTML table"
```

---

### Task 3: Preserve HTTP status and coordinate a 403-only lazy fallback

**Files:**
- Modify: `quant-worker/smart_insights/http.py`
- Modify: `quant-worker/smart_insights/scrapling_client.py`
- Create: `quant-worker/smart_insights/bitinfocharts_crawler.py`
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`
- Modify: `quant-worker/tests/test_smart_insights_crypto_collectors.py`

**Interfaces:**
- Extend `SourceFetchError(code: str, *, status_code: int | None = None)` with read-only `status_code`.
- Add `BitInfoChartsCrawler(primary, fallback_factory)` exposing the existing `scrape(source, url) -> RawSnapshot` crawler contract.
- `fallback_factory` is called once only after `HTTP_ERROR` with `status_code == 403`.

- [ ] **Step 1: Write failing structured-status tests**

Add assertions that Scrapling maps a 403 response to:

```python
with pytest.raises(SourceFetchError) as error:
    client.scrape(source, source.urls[0])
assert error.value.code == "HTTP_ERROR"
assert error.value.status_code == 403
```

Also assert status `404` is `HTTP_ERROR`/404, while 429 and 5xx retain their current stable codes and status metadata.

- [ ] **Step 2: Write failing coordinator tests**

Use fake crawlers/factories and cover all branches:

```python
result = BitInfoChartsCrawler(primary=success, fallback_factory=fail_if_called).scrape(source, url)
assert result is primary_snapshot

result = BitInfoChartsCrawler(
    primary=raises(SourceFetchError("HTTP_ERROR", status_code=403)),
    fallback_factory=fallback_factory,
).scrape(source, url)
assert result is fallback_snapshot
assert fallback_factory.calls == 1
```

Add non-fallback assertions for HTTP 401/404, `TIMEOUT`, `NETWORK_ERROR`, `RATE_LIMITED`, `UPSTREAM_SERVER_ERROR`, `REDIRECT_REJECTED`, and unstructured `HTTP_ERROR` with `status_code is None`. Preserve the exact original exception object for every non-eligible failure.

- [ ] **Step 3: Run the focused tests and observe failure**

```powershell
..\..\..\.venv\Scripts\python.exe -m pytest tests\test_smart_insights_foundation.py -k "scrapling and status" -q
..\..\..\.venv\Scripts\python.exe -m pytest tests\test_smart_insights_crypto_collectors.py -k "bitinfocharts and fallback" -q
```

Expected: FAIL because status metadata and the coordinator do not exist.

- [ ] **Step 4: Implement the minimal structured error and coordinator**

Keep `SourceFetchError.code` backward compatible and add `status_code`. In `ScraplingClient._request`, attach the actual integer status to every status-derived error without changing the stable code selection.

Implement the coordinator with no retries and no browser import:

```python
try:
    return self._primary.scrape(source, url)
except SourceFetchError as error:
    if error.code != "HTTP_ERROR" or error.status_code != 403:
        raise
return self._fallback_factory().scrape(source, url)
```

- [ ] **Step 5: Run focused tests and the foundation suite**

```powershell
..\..\..\.venv\Scripts\python.exe -m pytest tests\test_smart_insights_foundation.py tests\test_smart_insights_crypto_collectors.py -q
```

Expected: PASS with all pre-existing error-code assertions unchanged.

- [ ] **Step 6: Commit the 403-only coordination**

```powershell
git add quant-worker/smart_insights/http.py quant-worker/smart_insights/scrapling_client.py quant-worker/smart_insights/bitinfocharts_crawler.py quant-worker/tests/test_smart_insights_foundation.py quant-worker/tests/test_smart_insights_crypto_collectors.py
git commit -m "feat: gate BitInfoCharts fallback on Scrapling 403"
```

---

### Task 4: Build the bounded Nodriver client with deterministic lifecycle tests

**Files:**
- Modify: `quant-worker/requirements.txt`
- Create: `quant-worker/smart_insights/nodriver_bitinfocharts.py`
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`

**Interfaces:**
- Add `NodriverBitInfoChartsClient.scrape(source, url) -> RawSnapshot`.
- Add internal async `BrowserHtmlResult(html: str, final_url: str)` and an injectable async browser acquisition function for unit tests.
- Stable errors: `BROWSER_LAUNCH_FAILED`, `TIMEOUT`, `CHALLENGE_REQUIRED`, `REDIRECT_REJECTED`, `MISSING_TABLE`, `INVALID_RESPONSE`, and `RESPONSE_TOO_LARGE`.
- Successful snapshot metadata contains `collector: "nodriver"`, `parser_version`, and `browser_profile: "ephemeral"`; it contains no cookie/profile path.

- [ ] **Step 1: Pin the proven dependency**

After Task 1 has passed, add exactly:

```text
nodriver==0.50.1
```

to `quant-worker/requirements.txt`, then install the updated requirements into the project environment using the normal repository workflow.

- [ ] **Step 2: Write failing lifecycle and validation tests**

Use injected async fakes; never start Chrome in pytest. Cover:

- successful HTML and exact snapshot metadata;
- timeout covering the whole coroutine;
- launch exception -> `BROWSER_LAUNCH_FAILED`;
- allow-list violation before launch;
- final URL mismatch -> `REDIRECT_REJECTED`;
- empty/oversized HTML;
- challenge markers with no valid table -> `CHALLENGE_REQUIRED`;
- valid table present despite unrelated challenge text -> accepted;
- missing richest-address table -> `MISSING_TABLE`;
- browser stop called once on success, navigation error, challenge, timeout cancellation, and parser rejection;
- no method named `click`, `cf_verify`, cookie `save`, or cookie `load` is invoked.

- [ ] **Step 3: Run the tests and observe failure**

```powershell
..\..\..\.venv\Scripts\python.exe -m pytest tests\test_smart_insights_foundation.py -k "nodriver or browser" -q
```

Expected: FAIL because the client does not exist.

- [ ] **Step 4: Implement the sync boundary and async acquisition**

The public method validates `CollectionMode.SCRAPLING` and `is_source_url_allowed` before importing or launching Nodriver. It runs one async acquisition under `asyncio.wait_for(..., timeout=60)` and maps only `asyncio.TimeoutError` to `TIMEOUT`.

The production acquisition must follow this lifecycle:

```python
browser = None
try:
    browser = await nodriver.start(headless=False)
    page = await browser.get(url)
    await page.select("table", timeout=45)
    html = await page.get_content()
    return BrowserHtmlResult(html=html, final_url=str(page.url))
finally:
    if browser is not None:
        await browser.stop()
```

If the installed Nodriver version exposes a synchronous `stop()`, call it and await only when the returned value is awaitable; lock that behavior with the fake lifecycle tests. Use the library-generated temporary profile by omitting `user_data_dir`, and do not access its cookie persistence helpers.

After acquisition, validate final URL, byte limit, challenge markers, and `normalize_bitinfocharts_table(html)` before creating the snapshot. Store JSON payload keys `rawHtml` and `metadata`, matching the existing crawler contract.

- [ ] **Step 5: Run focused tests and compile the new modules**

```powershell
..\..\..\.venv\Scripts\python.exe -m pytest tests\test_smart_insights_foundation.py -k "nodriver or browser" -q
..\..\..\.venv\Scripts\python.exe -m py_compile smart_insights\nodriver_bitinfocharts.py smart_insights\bitinfocharts_crawler.py smart_insights\scrapling_client.py
```

Expected: PASS. No Chrome process starts during unit tests.

- [ ] **Step 6: Commit the browser client**

```powershell
git add quant-worker/requirements.txt quant-worker/smart_insights/nodriver_bitinfocharts.py quant-worker/tests/test_smart_insights_foundation.py
git commit -m "feat: add bounded Nodriver BitInfoCharts client"
```

---

### Task 5: Wire the fallback only into the BitInfoCharts production collector

**Files:**
- Modify: `quant-worker/collect_smart_insights.py`
- Modify: `quant-worker/tests/test_smart_insights_crypto_collectors.py`
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`

**Interfaces:**
- Extend `build_batch_collectors(..., bitinfocharts_fallback_factory: Callable[[], Any] | None = None)`.
- Production default lazily creates `NodriverBitInfoChartsClient` only when the coordinator receives an eligible 403.
- Existing `scrapling_client` injection remains the primary crawler and all non-BitInfoCharts collector construction remains byte-for-byte behaviorally unchanged.

- [ ] **Step 1: Write failing builder-wiring tests**

Add tests proving:

1. injected Scrapling success returns BitInfo observations and the fallback factory has zero calls;
2. injected Scrapling 403 invokes exactly one injected fallback and parses its raw HTML through the collector;
3. injected Scrapling 404/timeout never invokes fallback;
4. Farside, CryptoCraft, and CoinShares still receive the original Scrapling instance, not the coordinator;
5. `source_for_code("bitinfocharts-top-addresses").enabled is False` before qualification.

- [ ] **Step 2: Run the builder tests and observe failure**

```powershell
..\..\..\.venv\Scripts\python.exe -m pytest tests\test_smart_insights_crypto_collectors.py -k "bitinfocharts and (injected or fallback or batch)" -q
```

Expected: FAIL because `build_batch_collectors` does not accept the fallback factory.

- [ ] **Step 3: Implement lazy production wiring**

Import `BitInfoChartsCrawler` normally and import `NodriverBitInfoChartsClient` inside the default factory so normal worker startup does not initialize browser code. Build one coordinator for the BitInfoCharts closure only:

```python
def default_bitinfocharts_fallback() -> Any:
    from smart_insights.nodriver_bitinfocharts import NodriverBitInfoChartsClient
    return NodriverBitInfoChartsClient()

bitinfocharts_crawler = BitInfoChartsCrawler(
    primary=scrapling,
    fallback_factory=(
        bitinfocharts_fallback_factory or default_bitinfocharts_fallback
    ),
)
```

Pass `bitinfocharts_crawler` only to `BitInfoChartsCollector`. Do not alter other collector closures or registry state.

- [ ] **Step 4: Run focused collector, live-smoke, and registry tests**

```powershell
..\..\..\.venv\Scripts\python.exe -m pytest tests\test_smart_insights_crypto_collectors.py -q
..\..\..\.venv\Scripts\python.exe -m pytest tests\test_smart_insights_foundation.py -q
```

Expected: PASS, including the assertion that BitInfoCharts remains disabled.

- [ ] **Step 5: Commit production wiring**

```powershell
git add quant-worker/collect_smart_insights.py quant-worker/tests/test_smart_insights_crypto_collectors.py quant-worker/tests/test_smart_insights_foundation.py
git commit -m "feat: wire BitInfoCharts browser fallback"
```

---

### Task 6: Run deterministic regression before source qualification

**Files:**
- No source changes expected.
- Modify owning files only if a test reveals a real regression.

**Interfaces:**
- Produces independent Python, web, build, dependency, and migration evidence while the source remains disabled.

- [ ] **Step 1: Verify the dependency and AGPL identity**

```powershell
..\..\.venv\Scripts\python.exe -m pip show nodriver
..\..\.venv\Scripts\python.exe -m pip check
```

Expected: Nodriver is exactly 0.50.1, its license metadata is AGPL-3.0, and `pip check` reports no broken requirements.

- [ ] **Step 2: Run the complete Python suite**

Run from `quant-worker`:

```powershell
..\..\..\.venv\Scripts\python.exe -m pytest tests -q --basetemp=.pytest-tmp-bitinfocharts-nodriver
```

Expected: all tests PASS. Fix failures at their owning task and rerun the focused test before repeating the full suite.

- [ ] **Step 3: Run the complete web regression and production build**

Run from the worktree root:

```powershell
npm test
npm run lint
npm run build
```

Expected: all commands PASS. Use the existing ignored `.env.local` linkage/workflow for build-time configuration; do not commit secrets.

- [ ] **Step 4: Confirm migration status and disabled registry state**

```powershell
npx prisma migrate status
rg -n "bitinfocharts-top-addresses" quant-worker\smart_insights\sources.py docs\operations\smart-insights-runbook.md
git diff --check
git status --short --branch
```

Expected: all existing migrations are applied, no migration is created, BitInfoCharts is still disabled, and only intended feature files differ from the branch base.

---

### Task 7: Qualify live data, publish to PostgreSQL, verify Data Health, and activate conditionally

**Files:**
- Modify only after every gate passes: `quant-worker/smart_insights/sources.py`
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`
- Modify: `docs/operations/smart-insights-runbook.md`

**Interfaces:**
- Live smoke emits only sanitized `LiveSmokeOutcome` fields.
- A staged local activation enables normal collection for publication verification but is not committed until database and Data Health evidence pass.
- Final enabled registry change is limited to `bitinfocharts-top-addresses`.

- [ ] **Step 1: Run bounded live smoke while the source is disabled**

Run from `quant-worker` with the repository's ignored environment file:

```powershell
..\..\..\.venv\Scripts\python.exe collect_smart_insights.py daily --source bitinfocharts-top-addresses --live-smoke --env-file ..\..\..\.env.local
```

Expected: exit `0`, status `succeeded`, non-zero records, current UTC effective period, and no raw provider body. Inspect the batch in a local diagnostic that prints only minimum accepted balance and distinct cohort-version count; require minimum balance at least 1,000 BTC and exactly one 64-character cohort hash.

If smoke fails, keep the source disabled, update the runbook with the exact sanitized failure, and stop activation. Do not continue using sample data as live evidence.

- [ ] **Step 2: Stage source activation locally and rerun registry tests**

Use `apply_patch` to add only `"bitinfocharts-top-addresses"` to `ENABLED_SOURCE_CODES` and update the exact expected set in `test_source_registry_is_complete_and_typed`.

```powershell
..\..\..\.venv\Scripts\python.exe -m pytest tests\test_smart_insights_foundation.py -k "source_registry" -q
```

Expected: PASS. Do not commit this staged activation yet.

- [ ] **Step 3: Publish one normal daily collection**

```powershell
..\..\..\.venv\Scripts\python.exe collect_smart_insights.py daily --source bitinfocharts-top-addresses --env-file ..\..\..\.env.local
```

Expected: exit `0`, provider run status `succeeded` or `unchanged`, non-zero observations, validated immutable snapshot, and no quarantine.

Read back PostgreSQL using the configured `DATABASE_URL` and verify only aggregates: latest provider-run status/error, raw-snapshot status, observation count, minimum `address_balance_btc`, distinct cohort-version count, and maximum observed timestamp. Do not print addresses, raw HTML, credentials, or artifact content.

If publication or readback fails, use `apply_patch` to remove the staged source and registry-test entry, keep the runbook row disabled with the exact failure, and stop activation.

- [ ] **Step 4: Verify authenticated Data Health**

Start or reuse the verified local stack (`3100` web and `8100/healthz` engine). Through the available authenticated browser session, open Smart Insights and verify that Data Health reports `bitinfocharts-top-addresses` with the just-created successful run, current freshness, and no sample-data badge on live large-address data.

If authentication/browser control is unavailable, report that limitation and do not claim the activation gate complete. Keep the source disabled in the committed result unless the same Data Health contract is proven through an authenticated API request.

- [ ] **Step 5: Rerun full regression with the staged enabled source**

Run the complete Python suite, `npm test`, `npm run lint`, and `npm run build` exactly as in Task 6. All must pass with the new registry expectation.

- [ ] **Step 6: Update the operational truth**

Update `docs/operations/smart-insights-runbook.md` with:

- Nodriver 0.50.1 and Chrome/Chromium runtime requirements;
- BitInfoCharts-only Scrapling-403 fallback behavior;
- the no-CAPTCHA/no-cookie/no-proxy policy;
- the 60-second limit and stable browser error codes;
- AGPL-3.0 notice and license-review requirement;
- actual live-smoke date/status/count and PostgreSQL publication evidence;
- source moved to the enabled table only if every gate passed;
- `mempool-btc-large-addresses` still disabled pending its own qualification.

- [ ] **Step 7: Commit only evidence-backed activation changes**

If every gate passed:

```powershell
git add quant-worker/smart_insights/sources.py quant-worker/tests/test_smart_insights_foundation.py docs/operations/smart-insights-runbook.md
git commit -m "chore: qualify BitInfoCharts large-address source"
```

If any gate failed, commit only truthful runbook evidence and leave both source registry files unchanged. Never create an empty activation commit.

- [ ] **Step 8: Verify branch delivery state without merging or pushing**

```powershell
git status --short --branch
git log --oneline --decorate -10
git diff --check HEAD~1 HEAD
```

Expected: clean worktree, exact local branch/SHA recorded, no unrelated files, and no claim of merge, push, deployment, or production success. Those actions require a separate explicit finishing request.

## Completion Criteria

- The pre-integration probe proves Nodriver can reach and structurally validate the live richest-address table within 60 seconds.
- Scrapling remains the first attempt and every non-403 failure bypasses Nodriver.
- Browser startup is lazy, single-flight, fresh-profile, bounded, and cleaned up on every tested path.
- No challenge interaction, proxy, persistent cookie, or provider body leakage is introduced.
- Raw HTML passes through one structural normalizer and the existing BitInfoCharts business parser.
- All accepted rows are ranks 1-100, valid BTC addresses, at least 1,000 BTC, and share one deterministic cohort hash.
- Python and web suites, lint, build, dependency check, and migration status pass.
- BitInfoCharts is enabled only after live smoke, PostgreSQL publication, and authenticated Data Health evidence succeed.
- Mempool large-address collection remains independently disabled.
