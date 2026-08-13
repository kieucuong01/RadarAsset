# Scrapling Farside and CoinShares OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship live daily Farside BTC/ETH/SOL ETF flows and weekly CoinShares OCR fund flows, while removing WGC from the active product without deleting its historical database evidence.

**Architecture:** Add a bounded `ScraplingClient` behind the existing `scrape(source, url) -> RawSnapshot` collector boundary. Farside receives deterministic HTML-table normalization; CoinShares receives deterministic article/image discovery plus injected local RapidOCR token extraction and cross-table reconciliation. CryptoCraft stays on Crawl4AI, and WGC disappears from active registries, schedules, Data Health, and Gold scoring while database history is left untouched.

**Tech Stack:** Python 3.12, Scrapling 0.4.14 HTTP Fetcher, RapidOCR, ONNX Runtime CPU, standard-library HTML parsing, Decimal, pytest, PostgreSQL/Prisma, TypeScript, Vitest, PowerShell, Git.

## Global Constraints

- Do not use paid crawl APIs, proxies, CAPTCHA solvers, LLM numeric extraction, or manual data entry.
- Accept only code-owned HTTPS URLs and allow-listed redirects, hosts, paths, content types, and bounded payloads.
- CoinShares remains weekly and Farside remains daily; never interpolate provider periods.
- Reject an entire CoinShares report on low OCR confidence, layout drift, invalid units, or reconciliation failure.
- Preserve existing WGC providers, runs, snapshots, observations, evidence, and derived historical snapshots in PostgreSQL.
- Start every Farside and CoinShares source disabled and enable it only after its own live parser and database publication pass.
- Keep CryptoCraft on Crawl4AI and BitInfoCharts disabled.
- Use TDD, stage only files in this plan, and commit each independently testable task.

---

### Task 1: Add the bounded Scrapling acquisition boundary

**Files:**
- Create: `quant-worker/smart_insights/scrapling_client.py`
- Modify: `quant-worker/smart_insights/contracts.py`
- Modify: `quant-worker/smart_insights/sources.py`
- Modify: `quant-worker/requirements.txt`
- Test: `quant-worker/tests/test_smart_insights_foundation.py`

**Interfaces:**
- Consumes: `SourceDefinition`, `RawSnapshot`, `is_source_url_allowed`, and `SourceFetchError`.
- Produces: `CollectionMode.SCRAPLING`; `ScraplingClient(fetcher=None, clock=None, max_html_bytes=20_000_000, max_image_bytes=10_000_000)`; `scrape(source, url) -> RawSnapshot`; `download(source, url, *, content_types) -> DownloadedAsset`.
- Produces: `DownloadedAsset(content: bytes, content_type: str, source_url: str, observed_at: datetime, metadata: Mapping[str, object])`.

- [ ] **Step 1: Write failing registry and adapter tests**

Add tests that define a fake Scrapling response and prove the exact contract:

```python
response = SimpleNamespace(
    status=200,
    url="https://farside.co.uk/btc/",
    body=b"<html><table><tr><td>flow</td></tr></table></html>",
    headers={"content-type": "text/html; charset=utf-8"},
)
client = ScraplingClient(fetcher=lambda _url: response, clock=lambda: NOW)
snapshot = client.scrape(source_for_code("farside-btc-etf"), response.url)
payload = json.loads(snapshot.content)
assert payload["rawHtml"].startswith("<html>")
assert snapshot.metadata["collector"] == "scrapling"
assert source_for_code("farside-btc-etf").collection_mode is CollectionMode.SCRAPLING
```

Also assert rejection before the fetcher runs for an outside URL, cross-host redirects, non-2xx status, non-HTML pages, an oversized HTML response, an oversized image response, and an image content type outside `image/png`, `image/jpeg`, and `image/webp`.

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_foundation.py -q --basetemp=.pytest-tmp-scrapling-red
```

Expected: failure because `CollectionMode.SCRAPLING` and `smart_insights.scrapling_client` do not exist.

- [ ] **Step 3: Implement the minimum adapter**

Create a lazy default fetcher so importing unit tests does not initialize network state:

```python
def _fetch(url: str) -> Any:
    from scrapling.fetchers import Fetcher
    return Fetcher.get(url, impersonate="chrome", stealthy_headers=True)

@dataclass(frozen=True, slots=True)
class DownloadedAsset:
    content: bytes
    content_type: str
    source_url: str
    observed_at: datetime
    metadata: Mapping[str, object]
```

Normalize response URL, status, headers, and bytes without relying on provider text. Build the JSON snapshot as:

```python
payload = {
    "rawHtml": body.decode(charset, errors="strict"),
    "metadata": {"sourceURL": final_url, "statusCode": status},
}
```

Add `SCRAPLING = "scrapling"`, change only Farside and CoinShares registry rows to this mode, and add a `scrapling_table` quality label equal to the existing browser-table tier. Pin these worker dependencies:

```text
scrapling[fetchers]==0.4.14
rapidocr>=3.9,<4
onnxruntime>=1.22,<2
```

- [ ] **Step 4: Run adapter and registry tests**

Run the command from Step 2. Expected: PASS, with CryptoCraft still `CollectionMode.CRAWL4AI` and BitInfoCharts unchanged.

- [ ] **Step 5: Commit the acquisition boundary**

```powershell
git add -- quant-worker/smart_insights/scrapling_client.py quant-worker/smart_insights/contracts.py quant-worker/smart_insights/sources.py quant-worker/requirements.txt quant-worker/tests/test_smart_insights_foundation.py
git commit -m "feat: add bounded Scrapling acquisition"
```

### Task 2: Parse live-shaped Farside HTML and wire per-source clients

**Files:**
- Create: `quant-worker/smart_insights/parsers/html_table.py`
- Modify: `quant-worker/smart_insights/collectors/farside.py`
- Modify: `quant-worker/collect_smart_insights.py`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/farside-live.html`
- Test: `quant-worker/tests/test_smart_insights_crypto_collectors.py`
- Test: `quant-worker/tests/test_smart_insights_foundation.py`

**Interfaces:**
- Consumes: `ScraplingClient.scrape(source, url) -> RawSnapshot` and the existing Farside numeric/date rules.
- Produces: `parse_html_tables(html: str) -> tuple[tuple[tuple[str, ...], ...], ...]` and `normalize_farside_table(html: str) -> MarkdownTable`.
- Produces: `build_batch_collectors(..., scrapling_client=None)` routing Farside/CoinShares to Scrapling while CryptoCraft/BitInfoCharts remain on `browser_client`/Crawl4AI.

- [ ] **Step 1: Record a bounded live-shaped Farside fixture and write failing tests**

The fixture contains only the relevant table structure: blank/`Total` first header row, ticker second header row, fee row, dated rows, dash values, parentheses negatives, commas, and footer text. Add assertions:

```python
batch = FarsideEtfCollector(
    "BTC", crawler=FakeCrawlerHtml(fixture_bytes("farside-live.html"))
).collect(NOW)
assert batch.error_code is None
assert {row.dimensions["fund"] for row in batch.observations} >= {"IBIT", "TOTAL"}
assert all(row.effective_at < datetime(2026, 8, 14, tzinfo=timezone.utc) for row in batch.observations)
```

Add separate tests for a duplicate date, absent fund headers, current-day row, and a changed `Total` whose row must be quarantined with `RECONCILIATION_FAILED`.

- [ ] **Step 2: Run Farside tests and confirm they fail on raw HTML**

```powershell
.\.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_crypto_collectors.py -k "farside" -q --basetemp=.pytest-tmp-farside-red
```

Expected: failure because the collector still requires pre-normalized Markdown.

- [ ] **Step 3: Implement deterministic HTML-table normalization**

Use `html.parser.HTMLParser` to collect table rows/cells, collapse whitespace, and preserve empty cells. Choose the single table containing a ticker row plus dated rows. Normalize it as:

```python
headers = ("Date", *ticker_cells[1:-1], "Total")
rows = tuple(
    dict(zip(headers, cells, strict=True))
    for cells in table_rows
    if parse_provider_date(cells[0]) is not None
)
```

Reject multiple matching tables, mismatched widths, duplicate headers, missing `Total`, and tables without any closed date. Let the existing `Decimal` reconciliation remain authoritative.

- [ ] **Step 4: Split acquisition clients in CLI wiring**

Change the factory to construct both engines explicitly:

```python
crawl4ai = browser_client or Crawl4AIClient()
scrapling = scrapling_client or ScraplingClient()
```

Route CryptoCraft and BitInfoCharts to `crawl4ai`; route Farside and CoinShares to `scrapling`. Add a construction test proving Farside never invokes the Crawl4AI fake and CryptoCraft never invokes the Scrapling fake.

- [ ] **Step 5: Run Farside, foundation, and CryptoCraft regressions**

```powershell
.\.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_crypto_collectors.py quant-worker\tests\test_smart_insights_foundation.py quant-worker\tests\test_smart_insights_cryptocraft.py -q --basetemp=.pytest-tmp-farside-green
```

Expected: PASS.

- [ ] **Step 6: Commit Farside support**

```powershell
git add -- quant-worker/smart_insights/parsers/html_table.py quant-worker/smart_insights/collectors/farside.py quant-worker/collect_smart_insights.py quant-worker/tests/fixtures/smart_insights/crypto/farside-live.html quant-worker/tests/test_smart_insights_crypto_collectors.py quant-worker/tests/test_smart_insights_foundation.py
git commit -m "feat: collect Farside ETF flows with Scrapling"
```

### Task 3: Build fail-closed CoinShares image discovery and OCR reconstruction

**Files:**
- Create: `quant-worker/smart_insights/coinshares_ocr.py`
- Modify: `quant-worker/smart_insights/collectors/coinshares.py`
- Modify: `quant-worker/collect_smart_insights.py`
- Modify: `quant-worker/smart_insights/sources.py`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/coinshares-article.html`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/coinshares-asset-ocr.json`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/coinshares-region-ocr.json`
- Test: `quant-worker/tests/test_smart_insights_crypto_collectors.py`
- Test: `quant-worker/tests/test_smart_insights_foundation.py`

**Interfaces:**
- Consumes: `ScraplingClient.scrape`, `ScraplingClient.download`, and allow-listed CoinShares article/CDN URLs.
- Produces: `OcrToken(text: str, confidence: Decimal, box: tuple[int, int, int, int])`; `OcrEngine.recognize(image: bytes) -> tuple[OcrToken, ...]`; `RapidOcrEngine`; `CoinSharesTable(dimension: str, rows: tuple[CoinSharesRow, ...], global_flow_usd: Decimal, global_aum_usd: Decimal | None)`.
- Produces: `discover_coinshares_report(html: str) -> str`, `discover_coinshares_images(html: str, report_url: str) -> Mapping[str, str]`, and `reconstruct_coinshares_table(tokens, *, dimension, minimum_confidence=Decimal("0.90")) -> CoinSharesTable`.

- [ ] **Step 1: Write failing article/image discovery tests**

Assert that the latest valid two- or four-digit-year report wins, only one asset and one region image are selected by caption/alt context, relative URLs are resolved, and an outside host/path is rejected:

```python
images = discover_coinshares_images(article_html, REPORT_URL)
assert images == {
    "asset": "https://a.storyblok.com/f/coinshares/asset-flow.png",
    "region": "https://a.storyblok.com/f/coinshares/region-flow.png",
}
```

The exact accepted Storyblok prefix must be copied from the live article smoke and represented in `is_source_url_allowed`; no general `storyblok.com` wildcard is permitted.

- [ ] **Step 2: Write failing OCR geometry and validation tests**

Load token JSON fixtures through a fake OCR engine and assert exact values, dimensions, units, and period timestamps. Add one test per stable failure code:

```python
assert collect(tokens_with_confidence_089).error_code == "OCR_LOW_CONFIDENCE"
assert collect(tokens_without_aum_header).error_code == "OCR_LAYOUT_DRIFT"
assert collect(tokens_with_unknown_unit).error_code == "INVALID_UNIT"
assert collect(tokens_with_asset_region_total_mismatch).error_code == "RECONCILIATION_FAILED"
```

Also test duplicate labels, ambiguous `O/0`, missing decimal separators, future publication dates, and missing one of the two tables. Every failure must return zero observations.

- [ ] **Step 3: Run CoinShares tests and confirm the red state**

```powershell
.\.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_crypto_collectors.py -k "coinshares" -q --basetemp=.pytest-tmp-coinshares-red
```

Expected: failure because OCR interfaces and image discovery do not exist.

- [ ] **Step 4: Implement the injected RapidOCR adapter**

Initialize the model once and return normalized boxes/confidence:

```python
class RapidOcrEngine:
    def __init__(self) -> None:
        from rapidocr import RapidOCR
        self._engine = RapidOCR()

    def recognize(self, image: bytes) -> tuple[OcrToken, ...]:
        result = self._engine(image)
        if result.boxes is None or result.txts is None or result.scores is None:
            return ()
        return tuple(
            OcrToken(
                text=text,
                confidence=Decimal(str(score)),
                box=axis_aligned_box(box),
            )
            for box, text, score in zip(
                result.boxes, result.txts, result.scores, strict=True
            )
        )
```

`axis_aligned_box` converts the documented `(4, 2)` polygon to `(min_x, min_y, max_x, max_y)`. Cover `boxes`, `txts`, and `scores` normalization with a fake `RapidOCROutput`-shaped result so library-shaped changes fail visibly.

- [ ] **Step 5: Implement table reconstruction and reconciliation**

Cluster tokens into rows by vertical overlap, locate known header anchors, derive fixed x-ranges from header boxes, and require exactly one label/flow/AUM value per data row. Parse only explicit characters:

```python
_NUMBER = re.compile(r"^\(?-?\$?\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?$")
```

Convert reported US$m values with `Decimal("1000000")`. Require matching asset and region global weekly totals within USD 100,000 and, when both publish global AUM, the same tolerance. Store OCR engine/model version, image URL, SHA-256, confidence minimum, and canonical table in the composite snapshot metadata/content.

- [ ] **Step 6: Replace Markdown CoinShares parsing with article plus OCR collection**

Change `CoinSharesCollector` to accept `crawler`, `report_url`, and `ocr_engine`. Obtain dates from article HTML, download both images, reconstruct both tables, then reuse `ObservationInput` creation with weekly `effective_start = effective_at - timedelta(days=6)`. Keep the public metric codes unchanged.

- [ ] **Step 7: Run CoinShares and full Crypto collector tests**

```powershell
.\.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_crypto_collectors.py quant-worker\tests\test_smart_insights_crypto_pipeline_integration.py -q --basetemp=.pytest-tmp-coinshares-green
```

Expected: PASS.

- [ ] **Step 8: Commit CoinShares OCR**

```powershell
git add -- quant-worker/smart_insights/coinshares_ocr.py quant-worker/smart_insights/collectors/coinshares.py quant-worker/collect_smart_insights.py quant-worker/smart_insights/sources.py quant-worker/tests/fixtures/smart_insights/crypto/coinshares-article.html quant-worker/tests/fixtures/smart_insights/crypto/coinshares-asset-ocr.json quant-worker/tests/fixtures/smart_insights/crypto/coinshares-region-ocr.json quant-worker/tests/test_smart_insights_crypto_collectors.py quant-worker/tests/test_smart_insights_foundation.py
git commit -m "feat: extract CoinShares fund flows with local OCR"
```

### Task 4: Remove WGC from active collection and Gold methodology

**Files:**
- Delete: `quant-worker/smart_insights/collectors/world_gold_council.py`
- Delete: `quant-worker/tests/test_smart_insights_gold_collectors.py`
- Delete: `quant-worker/tests/fixtures/smart_insights/gold/wgc_etf_landing.md`
- Delete: `quant-worker/tests/fixtures/smart_insights/gold/wgc_central_bank_landing.md`
- Modify: `quant-worker/smart_insights/sources.py`
- Modify: `quant-worker/collect_smart_insights.py`
- Modify: `quant-worker/smart_insights/gold_registry.py`
- Modify: `quant-worker/smart_insights/metrics/gold.py`
- Modify: `quant-worker/smart_insights/gold_pipeline.py`
- Modify: `quant-worker/tests/test_smart_insights_registry.py`
- Modify: `quant-worker/tests/test_smart_insights_gold_metrics.py`
- Modify: `quant-worker/tests/test_smart_insights_gold_pipeline_integration.py`

**Interfaces:**
- Consumes: active XAU price, FRED real-yield/USD inputs, and CFTC Gold positioning.
- Produces: a four-group Gold methodology with no WGC source or metric lookup; `GOLD_SOURCE_CODES == ("cftc-disaggregated", "fred")`.

- [ ] **Step 1: Write failing active-surface tests**

Assert:

```python
assert "wgc-gold-etf" not in SOURCE_CODES
assert "wgc-central-bank" not in SOURCE_CODES
assert GOLD_SOURCE_CODES == ("cftc-disaggregated", "fred")
assert set(GOLD_GROUP_WEIGHTS) == {
    "momentum", "real_yields", "usd_pressure", "cftc_positioning"
}
assert sum(GOLD_GROUP_WEIGHTS.values(), Decimal("0")) == Decimal("1.00")
```

Use weights `momentum=0.25`, `real_yields=0.30`, `usd_pressure=0.25`, and `cftc_positioning=0.20`. Update coverage tests so three available groups exceed 60% and two lower-weight groups do not.

- [ ] **Step 2: Run Gold and registry tests and confirm the red state**

```powershell
.\.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_registry.py quant-worker\tests\test_smart_insights_gold_metrics.py quant-worker\tests\test_smart_insights_gold_pipeline_integration.py -q --basetemp=.pytest-tmp-wgc-red
```

Expected: failures showing WGC is still registered and scored.

- [ ] **Step 3: Remove WGC code paths and rebalance active methodology**

Delete the two source rows and WGC URL exception, collector imports/factories, WGC metric definitions, raw-series reads, and two score groups. Keep XAU/FRED/CFTC behavior unchanged. Do not add a SQL delete or Prisma migration.

- [ ] **Step 4: Prove history-preserving behavior**

Add a repository integration assertion that inserts a historical provider with code `wgc-gold-etf`, calls the current metric/source upsert paths, and verifies the provider, snapshot, and observation counts remain unchanged. The test must use transaction rollback and must not call a cleanup helper that deletes provider evidence.

- [ ] **Step 5: Run Gold, foundation, and repository integration tests**

```powershell
.\.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_foundation.py quant-worker\tests\test_smart_insights_registry.py quant-worker\tests\test_smart_insights_gold_metrics.py quant-worker\tests\test_smart_insights_gold_pipeline_integration.py quant-worker\tests\test_smart_insights_repository_integration.py -q --basetemp=.pytest-tmp-wgc-green
```

Expected: PASS; integration tests skip only when their documented database variable is absent.

- [ ] **Step 6: Commit WGC removal**

```powershell
git add -A -- quant-worker/smart_insights/collectors/world_gold_council.py quant-worker/tests/test_smart_insights_gold_collectors.py quant-worker/tests/fixtures/smart_insights/gold quant-worker/smart_insights/sources.py quant-worker/collect_smart_insights.py quant-worker/smart_insights/gold_registry.py quant-worker/smart_insights/metrics/gold.py quant-worker/smart_insights/gold_pipeline.py quant-worker/tests/test_smart_insights_foundation.py quant-worker/tests/test_smart_insights_registry.py quant-worker/tests/test_smart_insights_gold_metrics.py quant-worker/tests/test_smart_insights_gold_pipeline_integration.py quant-worker/tests/test_smart_insights_repository_integration.py
git commit -m "refactor: retire WGC from active Smart Insights"
```

### Task 5: Align Data Health, schedules, and operations

**Files:**
- Modify: `src/lib/backend/smart-insights-types.ts`
- Modify: `src/lib/backend/smart-insights-data-health.ts`
- Modify: `src/lib/backend/smart-insights-data-health.test.ts`
- Modify: `quant-worker/collect_smart_insights.py`
- Modify: `scripts/run-smart-insights.ps1`
- Modify: `quant-worker/README.md`
- Modify: `docs/operations/smart-insights-runbook.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: source codes/modes and public stable OCR failures.
- Produces: Data Health policies for Scrapling; no WGC rows; no Smart Insights `monthly` dispatch; runbook commands for Farside/CoinShares smoke and OCR runtime verification.

- [ ] **Step 1: Write failing TypeScript Data Health tests**

Assert that the policy response includes all three Farside sources and CoinShares with `collectionMode: "scrapling"`, excludes both WGC codes, and exposes only these new stable errors: `OCR_LOW_CONFIDENCE`, `OCR_LAYOUT_DRIFT`, and `MISSING_TABLE`.

- [ ] **Step 2: Run Data Health tests and confirm the red state**

```powershell
npm test -- --run src/lib/backend/smart-insights-data-health.test.ts
```

Expected: failure because the union/policies still describe Crawl4AI and WGC.

- [ ] **Step 3: Update active policies and schedule surface**

Extend the union to:

```typescript
collectionMode: "api" | "crawl4ai" | "scrapling" | "manual" | "disabled";
```

Change four fund-flow policies to `scrapling`, remove WGC policies, remove Smart Insights `monthly` from Python/PowerShell choices, and retain all unrelated application uses of the word monthly.

- [ ] **Step 4: Update runbooks and attribution**

Document `pip install -r quant-worker/requirements.txt`, `rapidocr check`, daily Farside and weekly CoinShares commands, model cache, byte/confidence/reconciliation failures, and the independent enablement gate. Remove WGC scheduler/current-source claims. Add Scrapling BSD-3-Clause and RapidOCR Apache-2.0 project links alongside Crawl4AI attribution.

- [ ] **Step 5: Run TypeScript, CLI, and documentation regressions**

```powershell
npm test -- --run src/lib/backend/smart-insights-data-health.test.ts src/app/api/tenant-routes.test.ts
.\.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_foundation.py quant-worker\tests\test_smart_insights_crypto_collectors.py -q --basetemp=.pytest-tmp-ops-green
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit product and operations alignment**

```powershell
git add -- src/lib/backend/smart-insights-types.ts src/lib/backend/smart-insights-data-health.ts src/lib/backend/smart-insights-data-health.test.ts quant-worker/collect_smart_insights.py scripts/run-smart-insights.ps1 quant-worker/README.md docs/operations/smart-insights-runbook.md README.md
git commit -m "docs: operate Scrapling fund flow sources"
```

### Task 6: Install, verify, migrate, live-smoke, publish, and enable independently

**Files:**
- Modify after evidence: `quant-worker/smart_insights/sources.py`
- Modify after evidence: `docs/operations/smart-insights-runbook.md`

**Interfaces:**
- Consumes: configured `.env.local`, Prisma migrations, live provider pages, artifact root, and PostgreSQL.
- Produces: dependency checks, full regression results, migration status, one live-smoke/publication evidence row per source, and an enabled set containing only proven sources.

- [ ] **Step 1: Install and verify pinned local runtimes**

```powershell
.\.venv\Scripts\python.exe -m pip install -r quant-worker\requirements.txt
.\.venv\Scripts\rapidocr.exe check
.\.venv\Scripts\python.exe -c "from scrapling.fetchers import Fetcher; from rapidocr import RapidOCR; print('scrapling+ocr ok')"
```

Expected: zero exit codes and ONNX Runtime CPU reported by RapidOCR.

- [ ] **Step 2: Run the complete relevant regression suite**

```powershell
.\.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_foundation.py quant-worker\tests\test_smart_insights_registry.py quant-worker\tests\test_smart_insights_crypto_collectors.py quant-worker\tests\test_smart_insights_crypto_metrics.py quant-worker\tests\test_smart_insights_crypto_pipeline_integration.py quant-worker\tests\test_smart_insights_cryptocraft.py quant-worker\tests\test_smart_insights_gold_metrics.py quant-worker\tests\test_smart_insights_gold_pipeline_integration.py quant-worker\tests\test_smart_insights_repository_integration.py -q --basetemp=.pytest-tmp-fundflows-final
npm test -- --run src/lib/backend/smart-insights-data-health.test.ts src/app/api/tenant-routes.test.ts
npm run lint
npm run build
```

Expected: all local checks pass; database-only skips are reported separately.

- [ ] **Step 3: Apply existing Prisma migrations**

```powershell
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate status
```

Expected: schema is up to date. No migration deletes or updates WGC history.

- [ ] **Step 4: Live-smoke all four disabled sources without publication**

```powershell
scripts\run-smart-insights.ps1 -Schedule daily -Source farside-btc-etf -LiveSmoke
scripts\run-smart-insights.ps1 -Schedule daily -Source farside-eth-etf -LiveSmoke
scripts\run-smart-insights.ps1 -Schedule daily -Source farside-sol-etf -LiveSmoke
scripts\run-smart-insights.ps1 -Schedule weekly -Source coinshares-weekly -LiveSmoke
```

Expected per source: exit `0`, `status=succeeded`, non-zero records, latest closed effective date, no provider body in output.

- [ ] **Step 5: Enable and publish each live-smoke success independently**

Add one successful code to `ENABLED_SOURCE_CODES`, run its schedule with `-Source`, and verify `provider_runs.status = 'succeeded'`, snapshot status `validated`, accepted observations greater than zero, source URL, latest effective date, and source-specific metric/dimensions. If publication fails, remove that code again before proceeding. A failed source remains disabled and is not represented by fixture data.

- [ ] **Step 6: Confirm the final enabled set and rerun real schedules**

After all four independent attempts, run daily collection for the enabled Farside subset and weekly collection for enabled CoinShares without `-LiveSmoke`. Record BTC, ETH, SOL, and CoinShares evidence independently in the runbook, including the stable error code for any source left disabled.

- [ ] **Step 7: Verify Data Health from database-backed application code**

Run the authenticated/local Data Health test path and confirm each enabled source reports its real acquisition mode, last effective/observed timestamps, and `validated`; confirm WGC does not appear. If an HTTP server is already part of the verified local workflow, also require HTTP 200 from `/api/smart-insights/data-health` under an authenticated session.

- [ ] **Step 8: Commit only proven enablement evidence**

```powershell
git add -- quant-worker/smart_insights/sources.py docs/operations/smart-insights-runbook.md
git commit -m "feat: enable verified fund flow sources"
```

If none pass, do not create this commit.

### Task 7: Final review, merge to main, and push

**Files:**
- Review: every file changed by Tasks 1-6.

**Interfaces:**
- Consumes: clean implementation branch, passing verification, live evidence, and current local `main`.
- Produces: merged local `main`, exact pushed SHA, and separate evidence for local tests, database publication, and remote Git state.

- [ ] **Step 1: Run verification-before-completion checks**

```powershell
git status --short
git diff --check main...HEAD
git log --oneline --decorate main..HEAD
```

Expected: only intentional commits, clean worktree, no whitespace errors.

- [ ] **Step 2: Review source enablement against live evidence**

For each enabled code, compare the runbook evidence to the current parser version, latest provider run, validated snapshot, and accepted observation count. Remove any enablement lacking all four facts before integration.

- [ ] **Step 3: Merge the implementation branch into current main**

Fetch the current main state, confirm unrelated changes, and use a normal non-destructive merge. Resolve only conflicts overlapping this plan; preserve unrelated user work. Rerun the focused Python and TypeScript tests after merge.

- [ ] **Step 4: Push and prove remote state**

```powershell
git push origin main
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Expected: local `HEAD` equals remote `refs/heads/main`. Report a rejected or policy-blocked push as incomplete rather than success.

## Self-review results

- Spec coverage: acquisition, Farside normalization, CoinShares OCR, quality gates, WGC active removal/history preservation, Data Health, schedules, dependencies, migration, live publication, enablement, merge, and push each have a task.
- Placeholder scan: no deferred implementation markers remain.
- Type consistency: Tasks 2-3 consume the Task 1 `ScraplingClient`; CoinShares OCR interfaces are defined before collector wiring; Data Health uses the same `scrapling` collection-mode value as Python.
