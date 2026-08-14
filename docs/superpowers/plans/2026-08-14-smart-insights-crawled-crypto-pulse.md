# Smart Insights Crawled Crypto Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a six-tab Crypto Quant Pulse that adds public CoinGlass derivatives pressure, BlockchainCenter Altcoin Season, and CBBI cycle history through bounded crawlers without fabricating unavailable data.

**Architecture:** Register four research-only sources in the existing point-in-time Smart Insights pipeline. Static sources use Scrapling; CoinGlass uses a shared bounded Nodriver renderer because its quantitative tables appear only after JavaScript. The existing Crypto Market Pulse endpoint gains structured derivatives and cycle sections, and a single client request feeds all six nested tabs.

**Tech Stack:** Python 3.12.13, Scrapling 0.4.14, Nodriver 0.50.1, PostgreSQL/Prisma, TypeScript 5.8.3, React 19.2.4, Next.js 16.2.9 App Router, Zod 4.4.3, Recharts 2.15.4, Radix/shadcn tabs, Vitest 4.1.8, pytest, and Playwright/Browser plugin.

## Global Constraints

- The separate ticker plan `docs/superpowers/plans/2026-08-14-smart-insights-curated-ticker.md` remains independent and is not duplicated here.
- Crypto nested tabs are exactly `Tổng quan`, `Dòng tiền`, `Tâm lý & Phái sinh`, `Chu kỳ`, `On-chain`, and `Cá voi BTC`; `Tổng quan` is the default.
- Keep `LegacyMarketPulse` as the owner of the only `/api/smart-insights/crypto-market-pulse` request.
- Use only public, allow-listed pages. Do not log in, retain cookies, bypass a paywall, or depend on CoinGlass's undocumented internal JSON endpoints.
- CoinGlass collection is every four hours. BlockchainCenter and CBBI collection is daily.
- The confirmed CoinGlass scope is Binance USDT margin history and the public 24-hour liquidation max-pain table.
- BlockchainCenter horizons remain separate: season/90-day, month, and year.
- CBBI publishes Confidence plus exactly nine components: PiCycle, RUPL, RHODL, Puell, 2YMA, Trolololo, MVRV, ReserveRisk, and Woobull. Provider values are validated on their native 0..1 scale and explicitly converted to percent by multiplying by 100.
- CBBI Price is evidence only and never replaces the canonical BTC price dataset.
- Missing, blocked, stale, or schema-drifted sources render `Unavailable`. Never substitute zero, interpolate gaps, or relabel sample data as live.
- Preserve source URL, provider/effective/observed times, unit, freshness, parser version, quality flags, and immutable raw evidence.
- Keep all four new sources disabled until their fixture parser, bounded live smoke, and database publication pass independently.
- Preserve unrelated `next-env.d.ts` work and stage only files named by each task.

---

## File structure

- `quant-worker/smart_insights/sources.py`: four source definitions, exact allowlists, schedules, and enablement gates.
- `quant-worker/smart_insights/metrics/crypto.py`: raw metric definitions; no new regime weight or signal methodology.
- `quant-worker/smart_insights/rendered_page_client.py`: reusable bounded Nodriver renderer with UTC timezone override and guaranteed cleanup.
- `quant-worker/smart_insights/bitinfocharts_acquisition.py`: reuse the shared renderer without changing BitInfoCharts parsing.
- `quant-worker/smart_insights/collectors/coinglass.py`: CoinGlass margin and liquidation HTML parsers/collectors.
- `quant-worker/smart_insights/collectors/blockchaincenter.py`: Altcoin Season SSR parser/collector.
- `quant-worker/smart_insights/collectors/cbbi.py`: CBBI page discovery, JSON validation, and bounded incremental publication.
- `quant-worker/smart_insights/scrapling_client.py`: allow-listed bounded JSON companion-asset download.
- `quant-worker/collect_smart_insights.py` and `scripts/run-smart-insights.ps1`: collector wiring and `four-hourly` schedule.
- `src/lib/backend/crypto-market-pulse.ts`: structured read model for margin, liquidation, and cycle observations.
- `src/lib/crypto-market-pulse-client.ts`: matching Zod contract.
- `src/lib/crypto-quant-pulse.ts`: unit-safe chart-series and overview builders.
- `src/components/smart-insights/CryptoMetricTrendPanel.tsx`: generic metric trend/snapshot panel.
- `src/components/smart-insights/CryptoDerivativesPressurePanel.tsx`: CoinGlass margin and max-pain presentation.
- `src/components/smart-insights/CryptoCyclePanel.tsx`: Altcoin Season and CBBI presentation.
- `src/components/smart-insights/CryptoQuantPulseTabs.tsx`: six-tab composition without fetching.
- `src/components/smart-insights/LegacyMarketPulse.tsx`: delegates Crypto rendering while retaining request ownership.
- `docs/operations/smart-insights-runbook.md`: source matrix, schedule, live-smoke, and verified publication evidence.

### Task 1: Register schedules, sources, and metric contracts

**Files:**
- Modify: `quant-worker/smart_insights/sources.py`
- Modify: `quant-worker/smart_insights/metrics/crypto.py`
- Modify: `quant-worker/collect_smart_insights.py`
- Modify: `scripts/run-smart-insights.ps1`
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`
- Modify: `quant-worker/tests/test_smart_insights_crypto_pipeline.py`

**Interfaces:**
- Consumes: `SourceDefinition`, `MetricDefinitionInput`, `sources_for_schedule(schedule)`.
- Produces: source codes `coinglass-margin-borrow`, `coinglass-liquidation-maxpain`, `blockchaincenter-altcoin-season`, `cbbi-public` and `four-hourly` schedule support.

- [ ] **Step 1: Write failing registry and schedule tests**

```python
def test_cycle_and_coinglass_sources_are_registered_fail_closed() -> None:
    expected = {
        "coinglass-margin-borrow": ("four-hourly", 480),
        "coinglass-liquidation-maxpain": ("four-hourly", 480),
        "blockchaincenter-altcoin-season": ("daily", 2880),
        "cbbi-public": ("daily", 2880),
    }
    for code, (schedule, sla) in expected.items():
        source = source_for_code(code)
        assert source.collection_mode is CollectionMode.SCRAPLING
        assert source.license_scope is LicenseScope.RESEARCH_ONLY
        assert source.schedule == schedule
        assert source.freshness_sla_minutes == sla
        assert source.enabled is False


def test_four_hourly_is_a_cli_and_wrapper_schedule() -> None:
    assert "four-hourly" in SCHEDULES
    assert _SOURCE_SCHEDULE["four-hourly"] == "four-hourly"
    wrapper = Path("../scripts/run-smart-insights.ps1").read_text(encoding="utf-8")
    assert '"four-hourly"' in wrapper
```

Also assert exact URLs:

```python
assert source_for_code("coinglass-margin-borrow").urls == (
    "https://www.coinglass.com/pro/i/MarginFeeChart",
)
assert source_for_code("coinglass-liquidation-maxpain").urls == (
    "https://www.coinglass.com/liquidation-maxpain",
)
assert source_for_code("blockchaincenter-altcoin-season").urls == (
    "https://www.blockchaincenter.net/altcoin-season-index/",
)
assert source_for_code("cbbi-public").urls == (
    "https://colintalkscrypto.com/cbbi/",
    "https://colintalkscrypto.com/cbbi/data/latest.json",
)
```

- [ ] **Step 2: Run the registry tests to verify RED**

Run from `quant-worker`:

```powershell
..\.venv\Scripts\python.exe -m pytest tests/test_smart_insights_foundation.py tests/test_smart_insights_crypto_pipeline.py -q
```

Expected: FAIL because the source codes, schedule, and metrics are absent.

- [ ] **Step 3: Add exact source rows and URL rules**

Add all four rows with `CollectionMode.SCRAPLING`, `research_only`, quality label `scrapling_table`, parser versions `coinglass-margin-v1`, `coinglass-maxpain-v1`, `blockchaincenter-altseason-v1`, and `cbbi-v1`. Keep them out of `ENABLED_SOURCE_CODES`.

Extend `is_source_url_allowed` only for the CBBI companion JSON:

```python
if source.code == "cbbi-public":
    return (
        parsed.hostname == "colintalkscrypto.com"
        and parsed.path in {"/cbbi/", "/cbbi/data/latest.json"}
        and not parsed.query
    )
```

All other new sources accept only exact `source.urls` through the existing first branch.

- [ ] **Step 4: Add metric definitions without regime weights**

Add these exact raw definitions to `_RAW_DEFINITIONS`:

```python
_definition("crypto.derivatives.margin_borrow.annualized_rate", "Margin borrow annualized rate", "percent", "hourly", 0, 480, source="coinglass-margin-borrow", evidence_only=True),
_definition("crypto.derivatives.margin_borrow.daily_rate", "Margin borrow daily rate", "percent", "hourly", 0, 480, source="coinglass-margin-borrow", evidence_only=True),
_definition("crypto.derivatives.margin_borrow.hourly_rate", "Margin borrow hourly rate", "percent", "hourly", 0, 480, source="coinglass-margin-borrow", evidence_only=True),
_definition("crypto.derivatives.liquidation.current_price_usd", "Liquidation max-pain current price", "USD", "observed_4h", 0, 480, source="coinglass-liquidation-maxpain", evidence_only=True),
_definition("crypto.derivatives.liquidation.long_max_pain_price_usd", "Long liquidation max-pain price", "USD", "observed_4h", 0, 480, source="coinglass-liquidation-maxpain", evidence_only=True),
_definition("crypto.derivatives.liquidation.short_max_pain_price_usd", "Short liquidation max-pain price", "USD", "observed_4h", 0, 480, source="coinglass-liquidation-maxpain", evidence_only=True),
_definition("crypto.derivatives.liquidation.long_max_pain_level_usd", "Long liquidation max-pain level", "USD", "observed_4h", 0, 480, source="coinglass-liquidation-maxpain", evidence_only=True),
_definition("crypto.derivatives.liquidation.short_max_pain_level_usd", "Short liquidation max-pain level", "USD", "observed_4h", 0, 480, source="coinglass-liquidation-maxpain", evidence_only=True),
_definition("crypto.derivatives.liquidation.long_distance_ratio", "Long liquidation max-pain distance", "ratio", "observed_4h", 0, 480, source="coinglass-liquidation-maxpain", evidence_only=True),
_definition("crypto.derivatives.liquidation.short_distance_ratio", "Short liquidation max-pain distance", "ratio", "observed_4h", 0, 480, source="coinglass-liquidation-maxpain", evidence_only=True),
_definition("crypto.cycle.altcoin_season.index", "Altcoin Season Index", "index", "daily", 0, 2880, source="blockchaincenter-altcoin-season", evidence_only=True),
_definition("crypto.cycle.cbbi.confidence", "CBBI Confidence", "percent", "daily", 0, 2880, source="cbbi-public", evidence_only=True),
```

Generate the nine CBBI component definitions from this immutable mapping:

```python
CBBI_COMPONENTS = {
    "PiCycle": "pi_cycle",
    "RUPL": "rupl_nupl",
    "RHODL": "rhodl",
    "Puell": "puell",
    "2YMA": "two_year_ma",
    "Trolololo": "trolololo",
    "MVRV": "mvrv",
    "ReserveRisk": "reserve_risk",
    "Woobull": "woobull",
}
```

Each code is `crypto.cycle.cbbi.component.<slug>`, unit `percent`, daily, direction `0`, SLA `2880`, source `cbbi-public`, and `evidence_only=True`. Do not add any new code to `CRYPTO_GROUP_COMPONENTS` or `COMPONENT_WEIGHTS`.

- [ ] **Step 5: Add `four-hourly` CLI/wrapper support**

Add `four-hourly` to `SCHEDULES`, `_SOURCE_SCHEDULE`, the argparse schedule branches that currently accept daily/weekly, and the PowerShell `ValidateSet`. Do not run `run_crypto_pipeline` for this schedule because the new metrics are evidence-only and do not change regime methodology.

- [ ] **Step 6: Run tests and verify GREEN**

Run:

```powershell
..\.venv\Scripts\python.exe -m pytest tests/test_smart_insights_foundation.py tests/test_smart_insights_crypto_pipeline.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit registry contracts**

```powershell
git add -- quant-worker/smart_insights/sources.py quant-worker/smart_insights/metrics/crypto.py quant-worker/collect_smart_insights.py scripts/run-smart-insights.ps1 quant-worker/tests/test_smart_insights_foundation.py quant-worker/tests/test_smart_insights_crypto_pipeline.py
git commit -m "feat: register crawled crypto pulse sources"
```

### Task 2: Extract a reusable bounded rendered-page client

**Files:**
- Create: `quant-worker/smart_insights/rendered_page_client.py`
- Modify: `quant-worker/smart_insights/bitinfocharts_acquisition.py`
- Create: `quant-worker/tests/test_rendered_page_client.py`
- Modify: `quant-worker/tests/test_bitinfocharts_acquisition.py`

**Interfaces:**
- Consumes: `SourceDefinition`, `is_source_url_allowed`, Nodriver CDP.
- Produces: `BrowserHtmlResult`, `RenderedPageReady`, and `NodriverRenderedPageClient.scrape(source, url, ready) -> RawSnapshot`.

- [ ] **Step 1: Write failing cleanup, readiness, and timezone tests**

```python
def test_rendered_client_rejects_placeholder_only_html() -> None:
    client = NodriverRenderedPageClient(
        browser_fetch=lambda *_args, **_kwargs: BrowserHtmlResult(
            html="<table><tr><td>&nbsp;</td></tr></table>",
            final_url=COINGLASS_URL,
        )
    )
    with pytest.raises(SourceFetchError, match="SCHEMA_DRIFT"):
        client.scrape(source_for_code("coinglass-margin-borrow"), COINGLASS_URL, ready=lambda html: "4.05%" in html)
```

Use the fake browser/process style already present in `test_bitinfocharts_acquisition.py` to assert the first CDP command is `Emulation.setTimezoneOverride` with `timezoneId=UTC`, and that browser stop/process wait run after success, navigation failure, readiness timeout, and cleanup failure.

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
..\.venv\Scripts\python.exe -m pytest tests/test_rendered_page_client.py tests/test_bitinfocharts_acquisition.py -q
```

Expected: FAIL because `rendered_page_client.py` does not exist.

- [ ] **Step 3: Implement the shared contracts**

Use these public types:

```python
@dataclass(frozen=True, slots=True)
class BrowserHtmlResult:
    html: str
    final_url: str


RenderedPageReady = Callable[[str], bool]


class NodriverRenderedPageClient:
    def __init__(
        self,
        *,
        browser_fetch: Callable[[str, RenderedPageReady], BrowserHtmlResult] | None = None,
        clock: Callable[[], datetime] | None = None,
        timeout_seconds: float = 60,
        poll_timeout_seconds: float = 45,
        poll_interval_seconds: float = 1,
        max_html_bytes: int = 20_000_000,
        timezone_id: str = "UTC",
    ) -> None:
        if min(timeout_seconds, poll_timeout_seconds, poll_interval_seconds, max_html_bytes) <= 0:
            raise ValueError("Rendered-page limits must be positive.")
        self._browser_fetch = browser_fetch
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._timeout_seconds = timeout_seconds
        self._poll_timeout_seconds = poll_timeout_seconds
        self._poll_interval_seconds = poll_interval_seconds
        self._max_html_bytes = max_html_bytes
        self._timezone_id = timezone_id

    def scrape(
        self,
        source: SourceDefinition,
        url: str,
        *,
        ready: RenderedPageReady,
    ) -> RawSnapshot:
        if source.collection_mode is not CollectionMode.SCRAPLING:
            raise ValueError("Source is not configured for rendered crawling.")
        if not is_source_url_allowed(source, url):
            raise ValueError("URL is not allow-listed for this source.")
        fetch = self._browser_fetch or self._default_browser_fetch
        result = fetch(url, ready)
        if result.final_url != url:
            raise SourceFetchError("REDIRECT_REJECTED")
        if not result.html.strip() or not ready(result.html):
            raise SourceFetchError("SCHEMA_DRIFT")
        encoded = result.html.encode("utf-8")
        if len(encoded) > self._max_html_bytes:
            raise SourceFetchError("RESPONSE_TOO_LARGE")
        return RawSnapshot(
            content=json.dumps(
                {"rawHtml": result.html, "metadata": {"sourceURL": url}},
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8"),
            content_type="application/json",
            source_url=url,
            effective_at=None,
            published_at=None,
            observed_at=self._clock(),
            metadata={
                "collector": "nodriver",
                "parser_version": source.parser_version,
                "timezone": self._timezone_id,
            },
        )
```

Implement the private `_default_browser_fetch(url, ready)` with a fresh `TemporaryDirectory` profile, off-screen browser launch, UTC CDP override, `page.get_content()` polling, outer `asyncio.wait_for`, stable `TIMEOUT`/`SCHEMA_DRIFT` errors, and unconditional process cleanup.

- [ ] **Step 4: Rewire BitInfoCharts to the shared renderer**

Keep `poll_bitinfocharts_html` and every BitInfoCharts-specific marker/parser in `bitinfocharts_acquisition.py`. Replace only duplicated browser start, timezone, and cleanup code with `NodriverRenderedPageClient`. Preserve the existing rule that Nodriver fallback occurs only after a Scrapling HTTP 403.

- [ ] **Step 5: Run focused regression tests**

Run:

```powershell
..\.venv\Scripts\python.exe -m pytest tests/test_rendered_page_client.py tests/test_bitinfocharts_acquisition.py tests/test_smart_insights_crypto_collectors.py -q
```

Expected: PASS, including process termination tests.

- [ ] **Step 6: Commit the renderer**

```powershell
git add -- quant-worker/smart_insights/rendered_page_client.py quant-worker/smart_insights/bitinfocharts_acquisition.py quant-worker/tests/test_rendered_page_client.py quant-worker/tests/test_bitinfocharts_acquisition.py
git commit -m "refactor: share bounded rendered page client"
```

### Task 3: Collect CoinGlass public margin and liquidation tables

**Files:**
- Create: `quant-worker/smart_insights/collectors/coinglass.py`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/coinglass-margin.html`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/coinglass-maxpain.html`
- Create: `quant-worker/tests/test_coinglass_collectors.py`

**Interfaces:**
- Consumes: `NodriverRenderedPageClient.scrape` and UTC-rendered HTML.
- Produces: `parse_margin_table(html, observed_at)`, `parse_maxpain_table(html, observed_at, symbols)`, `CoinGlassMarginCollector.collect(as_of)`, and `CoinGlassMaxPainCollector.collect(as_of)`.

- [ ] **Step 1: Add minimal provider fixtures**

The margin fixture contains two real rows and one placeholder row:

```html
<h1>Binance USDT Margin Borrow Interest Rate Historical Chart</h1>
<table>
  <thead><tr><th>Time</th><th>Annualized Interest Rate</th><th>Daily Interest Rate</th><th>Hourly Interest Rate</th></tr></thead>
  <tbody>
    <tr><td>2026-08-14 22:00</td><td>4.05%</td><td>0.0113%</td><td>0.000469%</td></tr>
    <tr><td>2026-08-14 21:00</td><td>4.10%</td><td>0.0114%</td><td>0.000474%</td></tr>
    <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  </tbody>
</table>
```

The max-pain fixture contains BTC, ETH, SOL, one unrelated stock symbol, and exact current/short/long values in the visible column order.

- [ ] **Step 2: Write failing parser tests**

```python
def test_margin_parser_preserves_reported_rates_and_utc_hours() -> None:
    rows = parse_margin_table(fixture_text("coinglass-margin.html"), NOW)
    assert rows[0].effective_at == datetime(2026, 8, 14, 22, tzinfo=timezone.utc)
    assert [(row.metric_code, row.value) for row in rows[:3]] == [
        ("crypto.derivatives.margin_borrow.annualized_rate", Decimal("4.05")),
        ("crypto.derivatives.margin_borrow.daily_rate", Decimal("0.0113")),
        ("crypto.derivatives.margin_borrow.hourly_rate", Decimal("0.000469")),
    ]
    assert all(row.asset_symbol == "USDT" for row in rows)
    assert all(row.dimensions["exchange"] == "Binance" for row in rows)


def test_maxpain_parser_keeps_sides_and_filters_symbols() -> None:
    rows = parse_maxpain_table(
        fixture_text("coinglass-maxpain.html"),
        NOW,
        symbols=frozenset({"BTC", "ETH", "SOL"}),
    )
    assert {row.asset_symbol for row in rows} == {"BTC", "ETH", "SOL"}
    assert all(row.dimensions["range"] == "24h" for row in rows)
```

Add rejection tests for duplicate symbols, malformed percent/currency suffixes, non-finite or negative price/level, future margin timestamps, missing headers, placeholder-only rows, and zero recognized crypto rows.

- [ ] **Step 3: Run parser tests to verify RED**

Run:

```powershell
..\.venv\Scripts\python.exe -m pytest tests/test_coinglass_collectors.py -q
```

Expected: FAIL because the collector module is absent.

- [ ] **Step 4: Implement strict table parsers**

Use `html.parser.HTMLParser` to collect row/cell text, collapse whitespace, and select exactly one table matching required normalized headers.

```python
def parse_percent(text: str) -> Decimal:
    if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?%", text):
        raise ValueError("INVALID_VALUE")
    return Decimal(text[:-1])


def parse_compact_usd(text: str) -> Decimal:
    match = re.fullmatch(r"\$?([+-]?\d+(?:\.\d+)?)([KMB])?", text.replace(",", ""))
    if not match:
        raise ValueError("INVALID_VALUE")
    multiplier = {"K": Decimal("1000"), "M": Decimal("1000000"), "B": Decimal("1000000000"), None: Decimal("1")}[match.group(2)]
    return Decimal(match.group(1)) * multiplier
```

Margin timestamps are UTC because Task 2 forces browser UTC. Require exact whole-hour timestamps, no duplicates, and `effective_at <= observed_at + 5 minutes`.

Max-pain uses collector `observed_at` as `effective_at`. Store `range=24h` and `side=long|short` dimensions. Publish the provider-displayed distance ratio only after validating it against `(max_pain_price-current_price)/current_price` within 0.0002.

- [ ] **Step 5: Implement collectors and readiness markers**

```python
class CoinGlassMarginCollector:
    source_code = "coinglass-margin-borrow"

    def __init__(self, *, crawler: NodriverRenderedPageClient) -> None:
        self.source = source_for_code(self.source_code)
        self._crawler = crawler

    def collect(self, as_of: datetime) -> CollectionBatch:
        snapshot = self._crawler.scrape(
            self.source,
            self.source.urls[0],
            ready=lambda html: (
                "Annualized Interest Rate" in html
                and re.search(r"\d+\.\d+%", html) is not None
            ),
        )
        try:
            payload = json.loads(snapshot.content)
            html = payload["rawHtml"]
            if not isinstance(html, str):
                raise ValueError("SCHEMA_DRIFT")
            observations = parse_margin_table(html, snapshot.observed_at)
        except (KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
            return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")
        except ValueError as error:
            return CollectionBatch(self.source, snapshot, (), str(error))
        return CollectionBatch(self.source, snapshot, tuple(observations))
```

`CoinGlassMaxPainCollector` uses the same snapshot-decoding pattern with readiness markers `Short Max Pain`, `Long Max Pain`, and a BTC data row. Parser failures after a valid snapshot return zero observations with the stable error code.

- [ ] **Step 6: Run tests and verify GREEN**

Run:

```powershell
..\.venv\Scripts\python.exe -m pytest tests/test_coinglass_collectors.py tests/test_rendered_page_client.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit CoinGlass collectors**

```powershell
git add -- quant-worker/smart_insights/collectors/coinglass.py quant-worker/tests/fixtures/smart_insights/crypto/coinglass-margin.html quant-worker/tests/fixtures/smart_insights/crypto/coinglass-maxpain.html quant-worker/tests/test_coinglass_collectors.py
git commit -m "feat: collect public CoinGlass pressure tables"
```

### Task 4: Collect BlockchainCenter and CBBI cycle indicators

**Files:**
- Modify: `quant-worker/smart_insights/scrapling_client.py`
- Create: `quant-worker/smart_insights/collectors/blockchaincenter.py`
- Create: `quant-worker/smart_insights/collectors/cbbi.py`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/blockchaincenter-altseason.html`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/cbbi-page.html`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/cbbi-latest.json`
- Create: `quant-worker/tests/test_cycle_collectors.py`
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`

**Interfaces:**
- Consumes: `ScraplingClient.scrape` and new `ScraplingClient.download_json(source, url)`.
- Produces: `BlockchainCenterAltcoinSeasonCollector.collect(as_of)` and `CbbiCollector.collect(as_of)`.

- [ ] **Step 1: Write failing bounded JSON-download tests**

```python
def test_scrapling_download_json_is_allowlisted_and_bounded() -> None:
    response = _scrapling_response(
        url="https://colintalkscrypto.com/cbbi/data/latest.json",
        headers={"content-type": "application/json"},
        body=b'{"Confidence":{"1723593600":0.615}}',
    )
    client = ScraplingClient(fetcher=lambda _url: response, max_json_bytes=1024)
    asset = client.download_json(
        source_for_code("cbbi-public"),
        "https://colintalkscrypto.com/cbbi/data/latest.json",
    )
    assert asset.content_type == "application/json"
```

Also test wrong content type, redirect, outside URL, invalid UTF-8/JSON, and byte overflow.

- [ ] **Step 2: Write failing Altcoin Season tests**

```python
def test_altseason_parser_keeps_three_horizons_and_boundaries() -> None:
    observations = parse_altcoin_season(fixture_text("blockchaincenter-altseason.html"), NOW)
    assert [(row.dimensions["horizon"], row.value) for row in observations] == [
        ("season_90d", Decimal("61")),
        ("month", Decimal("43")),
        ("year", Decimal("37")),
    ]
    assert classify_altcoin_season(25) == "bitcoin_season"
    assert classify_altcoin_season(26) == "neutral"
    assert classify_altcoin_season(74) == "neutral"
    assert classify_altcoin_season(75) == "altcoin_season"
```

Reject missing/duplicate horizons, values outside 0..100, and provider wording that contradicts the 90-day thresholds.

- [ ] **Step 3: Write failing CBBI tests**

```python
def test_cbbi_parser_publishes_confidence_and_nine_components() -> None:
    observations = parse_cbbi_json(fixture_bytes("cbbi-latest.json"), as_of=NOW)
    latest = [row for row in observations if row.effective_at == datetime(2026, 8, 14, tzinfo=timezone.utc)]
    assert len(latest) == 10
    assert {row.metric_code for row in latest} == {
        "crypto.cycle.cbbi.confidence",
        *{f"crypto.cycle.cbbi.component.{slug}" for slug in CBBI_COMPONENTS.values()},
    }
    assert all(Decimal("0") <= row.value <= Decimal("100") for row in latest)
    assert next(row for row in latest if row.metric_code.endswith("confidence")).value == Decimal("31.34")
```

Add tests for unsorted timestamp keys, invalid epoch, future points, a missing required component series, non-null provider values outside 0..1, ignored `Price` observations, allowed historical nulls, and exact public JSON-link discovery.

- [ ] **Step 4: Run cycle tests to verify RED**

Run:

```powershell
..\.venv\Scripts\python.exe -m pytest tests/test_cycle_collectors.py tests/test_smart_insights_foundation.py -q
```

Expected: FAIL because the collectors and JSON downloader are absent.

- [ ] **Step 5: Implement bounded JSON acquisition**

Add `max_json_bytes` and `download_json` to `ScraplingClient`. The method uses `_request`, requires `application/json`, strict UTF-8, valid JSON, an exact final URL, and returns `DownloadedAsset` with collector/parser metadata.

- [ ] **Step 6: Implement the two cycle collectors**

`BlockchainCenterAltcoinSeasonCollector` parses server-rendered HTML, publishes exactly three horizon observations, and uses collection day at 00:00 UTC as effective time.

`CbbiCollector` verifies the exact JSON link, validates every required series before publishing any row, accepts historical nulls but emits observations only for numeric values, multiplies native 0..1 values by 100, and stores `provider_scale=0_to_1` in dimensions. It limits normal runs to the last seven provider days and accepts `backfill=True` within `source.max_rows`. Combine page and JSON hashes/URLs in composite snapshot metadata. Do not publish `Price`.

- [ ] **Step 7: Run tests and verify GREEN**

Run:

```powershell
..\.venv\Scripts\python.exe -m pytest tests/test_cycle_collectors.py tests/test_smart_insights_foundation.py -q
```

Expected: PASS.

- [ ] **Step 8: Commit cycle collectors**

```powershell
git add -- quant-worker/smart_insights/scrapling_client.py quant-worker/smart_insights/collectors/blockchaincenter.py quant-worker/smart_insights/collectors/cbbi.py quant-worker/tests/fixtures/smart_insights/crypto/blockchaincenter-altseason.html quant-worker/tests/fixtures/smart_insights/crypto/cbbi-page.html quant-worker/tests/fixtures/smart_insights/crypto/cbbi-latest.json quant-worker/tests/test_cycle_collectors.py quant-worker/tests/test_smart_insights_foundation.py
git commit -m "feat: collect public crypto cycle indicators"
```

### Task 5: Wire collectors and prove point-in-time publication

**Files:**
- Modify: `quant-worker/collect_smart_insights.py`
- Modify: `quant-worker/tests/test_smart_insights_crypto_collectors.py`
- Modify: `quant-worker/tests/test_smart_insights_repository_integration.py`
- Modify: `docs/operations/smart-insights-runbook.md`

**Interfaces:**
- Consumes: four collector classes and `build_production_collectors`.
- Produces: registered batch collectors and database-backed observations queryable by the web read model.

- [ ] **Step 1: Write failing collector-wiring tests**

Change the factory signature and inject fake clients:

```python
def build_batch_collectors(
    *,
    scrapling_client: ScraplingClient | None = None,
    rendered_client: NodriverRenderedPageClient | None = None,
    bitinfocharts_crawler: Any | None = None,
    cbbi_backfill: bool = False,
) -> Mapping[str, BatchCollector]:
```

Assert all four keys exist and each produced batch's source code matches the registry key.

- [ ] **Step 2: Write failing repository publication test**

Publish one batch per new source twice, with the second CBBI batch revising one natural key. Assert four `ProviderRun` lifecycles, latest-revision selection, immutable raw snapshots, source/metric IDs, and no mutation of first revisions. Use only `TEST_DATABASE_URL` ending in `_test`.

- [ ] **Step 3: Run tests to verify RED**

Run:

```powershell
..\.venv\Scripts\python.exe -m pytest tests/test_smart_insights_crypto_collectors.py tests/test_smart_insights_repository_integration.py -q
```

Expected: unit FAIL; integration either FAIL against isolated DB or SKIP when absent.

- [ ] **Step 4: Wire production collectors**

Register:

```python
"coinglass-margin-borrow": lambda as_of: CoinGlassMarginCollector(crawler=rendered).collect(as_of),
"coinglass-liquidation-maxpain": lambda as_of: CoinGlassMaxPainCollector(crawler=rendered).collect(as_of),
"blockchaincenter-altcoin-season": lambda as_of: BlockchainCenterAltcoinSeasonCollector(crawler=scrapling).collect(as_of),
"cbbi-public": lambda as_of: CbbiCollector(crawler=scrapling, backfill=cbbi_backfill).collect(as_of),
```

Add CLI `--cbbi-backfill` and reject it unless `--source cbbi-public` is supplied.

- [ ] **Step 5: Run focused/integration tests**

Run the Step 3 command again. Expected: PASS; report isolated-DB skip separately.

- [ ] **Step 6: Document exact live-smoke commands**

```powershell
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 -Schedule four-hourly -Source coinglass-margin-borrow -LiveSmoke
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 -Schedule four-hourly -Source coinglass-liquidation-maxpain -LiveSmoke
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 -Schedule daily -Source blockchaincenter-altcoin-season -LiveSmoke
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 -Schedule daily -Source cbbi-public -LiveSmoke
```

Keep sources disabled until Task 9.

- [ ] **Step 7: Commit wiring**

```powershell
git add -- quant-worker/collect_smart_insights.py quant-worker/tests/test_smart_insights_crypto_collectors.py quant-worker/tests/test_smart_insights_repository_integration.py docs/operations/smart-insights-runbook.md
git commit -m "feat: wire crawled crypto pulse publication"
```

### Task 6: Extend the Crypto Market Pulse read model and client contract

**Files:**
- Modify: `src/lib/backend/crypto-market-pulse.ts`
- Modify: `src/lib/backend/crypto-market-pulse.test.ts`
- Modify: `src/lib/crypto-market-pulse-client.ts`
- Modify: `src/lib/crypto-market-pulse-client.test.ts`

**Interfaces:**
- Consumes: accepted latest-revision `MetricObservation` rows and dimensions.
- Produces: `marginBorrow`, `liquidationMaxPain`, and `cycleIndicators` response sections.

- [ ] **Step 1: Add failing backend contract tests**

```typescript
expect(result.marginBorrow.series[0]).toEqual({
  effectiveAt: "2026-08-14T22:00:00.000Z",
  annualizedRate: 4.05,
  dailyRate: 0.0113,
  hourlyRate: 0.000469,
});
expect(result.liquidationMaxPain.rows[0]).toMatchObject({
  asset: "BTC",
  range: "24h",
  currentPriceUsd: 62609.4,
});
expect(result.cycleIndicators.altcoinSeason.latest).toMatchObject({
  season90d: 61,
  month: 43,
  year: 37,
  classification: "neutral",
});
expect(result.cycleIndicators.cbbi.latest?.components).toHaveLength(9);
```

Add unavailable tests.

- [ ] **Step 2: Run backend tests to verify RED**

Run `npm test -- src/lib/backend/crypto-market-pulse.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement structured read shapes**

```typescript
type MarginBorrowPoint = {
  effectiveAt: string;
  annualizedRate: number | null;
  dailyRate: number | null;
  hourlyRate: number | null;
};

type LiquidationSide = {
  priceUsd: number;
  levelUsd: number;
  distanceRatio: number;
};

type CbbiPoint = {
  effectiveAt: string;
  confidence: number;
  components: Array<{ code: string; value: number }>;
};
```

Query 31 days for margin/liquidation and 730 days for cycle data. Deduplicate revisions before grouping. `partial` means a group has at least one but not all required fields. Never replace null with zero.

```typescript
export function classifyAltcoinSeason(value: number) {
  if (value <= 25) return "bitcoin_season" as const;
  if (value >= 75) return "altcoin_season" as const;
  return "neutral" as const;
}
```

- [ ] **Step 4: Add matching Zod schemas**

Require all three top-level fields. Validate 0..100 indices, finite ratios, nonnegative prices/levels, exact `24h`, unique assets, exactly nine unique CBBI components, and nonempty timestamps. Keep only existing `largeAddressActivity` backward-compatible/optional.

- [ ] **Step 5: Run backend/client/route tests**

```powershell
npm test -- src/lib/backend/crypto-market-pulse.test.ts src/lib/crypto-market-pulse-client.test.ts src/app/api/smart-insights/crypto-market-pulse/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit read contracts**

```powershell
git add -- src/lib/backend/crypto-market-pulse.ts src/lib/backend/crypto-market-pulse.test.ts src/lib/crypto-market-pulse-client.ts src/lib/crypto-market-pulse-client.test.ts
git commit -m "feat: expose derivatives and cycle pulse data"
```

### Task 7: Build unit-safe Crypto chart helpers

**Files:**
- Create: `src/lib/crypto-quant-pulse.ts`
- Create: `src/lib/crypto-quant-pulse.test.ts`
- Create: `src/components/smart-insights/CryptoMetricTrendPanel.tsx`
- Modify: `src/components/smart-insights/source-guard.test.ts`

**Interfaces:**
- Consumes: `MetricModel[]` and `CryptoMarketPulseModel`.
- Produces: `buildCryptoMetricSeries`, `buildCryptoOverviewObservations`, and `CryptoMetricTrendPanel`.

- [ ] **Step 1: Write failing unit-safe series tests**

Test grouping key `metricCode:asset:unit:sourceCode`, chronological sorting, single-point snapshot behavior, and null gaps without zero insertion.

```typescript
expect(series[0].points.map((point) => point.value)).toEqual([18, 20]);
expect(single.trendPoints).toEqual([]);
expect(merged[0]).not.toHaveProperty(missingSeries.key);
```

- [ ] **Step 2: Run tests to verify RED**

Run `npm test -- src/lib/crypto-quant-pulse.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement pure metric builders**

Use:

```typescript
export const DERIVATIVE_METRIC_CODES = new Set([
  "crypto.derivatives.btc_dvol",
  "crypto.derivatives.eth_dvol",
  "crypto.derivatives.funding_rate",
  "crypto.derivatives.open_interest",
]);
export const ONCHAIN_METRIC_CODES = new Set([
  "crypto.onchain.active_addresses",
  "crypto.onchain.adjusted_transfer_usd",
  "crypto.onchain.mvrv",
  "crypto.onchain.nvt",
  "crypto.stablecoin.supply_usd",
]);
```

Overview priority is CBBI Confidence, Altcoin Season 90-day, BTC 24h liquidation distances, Fear & Greed, then aggregate ETF total. Return at most three available observations, all sourced/effective-dated and without buy/sell wording.

- [ ] **Step 4: Implement generic trend panel**

The source guard requires `ResponsiveContainer`, `LineChart`, `connectNulls={false}`, `FreshnessBadge`, source links, units, and `Unavailable`. Render incompatible units separately and one-point series as numeric snapshots.

- [ ] **Step 5: Run focused tests**

```powershell
npm test -- src/lib/crypto-quant-pulse.test.ts src/components/smart-insights/source-guard.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit helpers**

```powershell
git add -- src/lib/crypto-quant-pulse.ts src/lib/crypto-quant-pulse.test.ts src/components/smart-insights/CryptoMetricTrendPanel.tsx src/components/smart-insights/source-guard.test.ts
git commit -m "feat: build Crypto Pulse chart helpers"
```

### Task 8: Compose the six-tab Crypto workspace

**Files:**
- Create: `src/components/smart-insights/CryptoDerivativesPressurePanel.tsx`
- Create: `src/components/smart-insights/CryptoCyclePanel.tsx`
- Create: `src/components/smart-insights/CryptoQuantPulseTabs.tsx`
- Modify: `src/components/smart-insights/LegacyMarketPulse.tsx`
- Modify: `src/components/smart-insights/source-guard.test.ts`

**Interfaces:**
- Consumes: `CryptoMarketPulseModel`, `MetricModel[]`, `RegimeModel | undefined`, `CryptoPanelMode`, locale.
- Produces: six tabs with no fetch.

- [ ] **Step 1: Write failing six-tab tests**

```typescript
for (const value of ["overview", "flows", "sentiment", "cycle", "onchain", "whales"])
  expect(source).toContain('value="' + value + '"');
for (const label of ["Tổng quan", "Dòng tiền", "Tâm lý & Phái sinh", "Chu kỳ", "On-chain", "Cá voi BTC"])
  expect(source).toContain(label);
expect(source).toContain('defaultValue="overview"');
expect(read("CryptoQuantPulseTabs.tsx")).not.toContain("fetch(");
```

Also assert `LegacyMarketPulse` has exactly one `fetchCryptoMarketPulse` and no old Crypto `MetricGrid`/`onchain.map` block.

- [ ] **Step 2: Run source tests to verify RED**

Run `npm test -- src/components/smart-insights/source-guard.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement derivatives pressure panel**

Render Binance USDT annualized history, separately labelled daily/hourly values, and max-pain rows ordered BTC/ETH/SOL then the approved Crypto ticker universe. Show current/long/short price, signed distance, liquidation level, source/effective/freshness. Never put percent and USD on one axis.

- [ ] **Step 4: Implement cycle panel**

Render three Altcoin horizon cards, a text-labelled 0..100 gauge with 25/75 boundaries, CBBI Confidence history, nine latest component values, independent attribution, and the explicit no-target/no-recommendation copy. Never average components client-side.

- [ ] **Step 5: Implement six-tab composition**

```typescript
<Tabs defaultValue="overview" className="min-w-0">
  <div className="overflow-x-auto pb-1">
    <TabsList className="w-max min-w-full justify-start">
      <TabsTrigger value="overview">Tổng quan</TabsTrigger>
      <TabsTrigger value="flows">Dòng tiền</TabsTrigger>
      <TabsTrigger value="sentiment">Tâm lý &amp; Phái sinh</TabsTrigger>
      <TabsTrigger value="cycle">Chu kỳ</TabsTrigger>
      <TabsTrigger value="onchain">On-chain</TabsTrigger>
      <TabsTrigger value="whales">Cá voi BTC</TabsTrigger>
    </TabsList>
  </div>
</Tabs>
```

Fill contents exactly: overview regime/observations/Fear & Greed/ETF; flows ETF/CoinShares; sentiment Fear & Greed/CoinGlass/Deribit; cycle `CryptoCyclePanel`; on-chain metric panel; whales large-address panel.

- [ ] **Step 6: Delegate from LegacyMarketPulse**

```typescript
<CryptoQuantPulseTabs
  pulse={cryptoPulse}
  metrics={cryptoMetrics}
  regime={regimes.find((item) => item.market === "crypto")}
  mode={requestMode}
  locale={locale}
/>
```

- [ ] **Step 7: Run component and contract tests**

```powershell
npm test -- src/components/smart-insights/source-guard.test.ts src/lib/crypto-quant-pulse.test.ts src/lib/crypto-market-pulse-client.test.ts src/lib/backend/crypto-market-pulse.test.ts
```

Expected: PASS with no duplicate fetch.

- [ ] **Step 8: Commit UI**

```powershell
git add -- src/components/smart-insights/CryptoDerivativesPressurePanel.tsx src/components/smart-insights/CryptoCyclePanel.tsx src/components/smart-insights/CryptoQuantPulseTabs.tsx src/components/smart-insights/LegacyMarketPulse.tsx src/components/smart-insights/source-guard.test.ts
git commit -m "feat: add crypto derivatives and cycle tabs"
```

### Task 9: Live-smoke, database, browser, and regression verification

**Files:**
- Modify: `quant-worker/smart_insights/sources.py` only for independently passing sources.
- Modify: `docs/operations/smart-insights-runbook.md` with exact evidence.

**Interfaces:**
- Consumes: complete collection, publication, API, and UI paths.
- Produces: evidenced enable/disable state and verified local behavior.

- [ ] **Step 1: Run all automated checks**

```powershell
Set-Location quant-worker
..\.venv\Scripts\python.exe -m pytest tests/test_rendered_page_client.py tests/test_bitinfocharts_acquisition.py tests/test_coinglass_collectors.py tests/test_cycle_collectors.py tests/test_smart_insights_crypto_collectors.py tests/test_smart_insights_foundation.py tests/test_smart_insights_crypto_pipeline.py tests/test_smart_insights_repository_integration.py -q
Set-Location ..
npm test -- src/lib/backend/crypto-market-pulse.test.ts src/lib/crypto-market-pulse-client.test.ts src/lib/crypto-quant-pulse.test.ts src/components/smart-insights/source-guard.test.ts src/app/api/smart-insights/crypto-market-pulse/route.test.ts
npm run lint
npm run build
```

Expected: PASS. Report database skips separately.

- [ ] **Step 2: Run four independent live smokes**

Run the four Task 5 commands. Record final URL/status, parser version, artifact SHA-256, records/effective range, stable error code, and CoinGlass cleanup confirmation. One passing source does not enable another.

- [ ] **Step 3: Enable and publish only passing sources**

Add only passing codes to `ENABLED_SOURCE_CODES` and run each configured schedule without `-LiveSmoke`. Verify latest `provider_runs` and accepted observations by provider/metric. Confirm no sample provider or zero-filled row.

- [ ] **Step 4: Verify authenticated API and local UI**

With web `3100` and quant health `8100` verified, validate `/api/smart-insights/crypto-market-pulse` with the Zod schema and compare statuses/counts/timestamps to DB truth. In the signed-in browser, switch all six tabs, confirm no extra pulse request, verify truthful unavailable states, 390x844 overflow, source/freshness labels, keyboard tabs, console/overlay state, and unchanged Macro/Gold/Watchlist/CryptoCraft.

- [ ] **Step 5: Record evidence and commit**

Document exact test counts, skips, enablement, live errors, provider runs, observation ranges, API state, browser state, and local SHA. Do not claim deployment.

```powershell
git add -- quant-worker/smart_insights/sources.py docs/operations/smart-insights-runbook.md
git commit -m "docs: verify crawled Crypto Market Pulse"
```

## Completion criteria

- All six tabs use one Crypto Market Pulse request.
- Each provider is live, disabled with an exact blocker, or shown `Unavailable`; none is simulated.
- CoinGlass uses bounded public rendered pages with fresh temporary profiles.
- BlockchainCenter and CBBI use allow-listed Scrapling acquisition and immutable point-in-time publication.
- No new observation enters regime scoring or buy/sell logic.
- Python, TypeScript, route, lint, build, database, and authenticated browser evidence are reported separately.
