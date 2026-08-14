# Smart Insights curated ticker and Crypto Quant Pulse tabs design

## Goal

Make Smart Insights easier to scan without changing its established visual language. The ticker must move more slowly and show only the approved fixed blue-chip universe. Crypto Quant Pulse must become a decision-oriented, chart-first workspace with related data grouped into tabs instead of one long on-chain column.

This change preserves every existing Smart Insights market area, source attribution, freshness state, sample label, and quantitative validation rule.

## Approved ticker universe

The ticker universe is intentionally fixed and must not be described as a live market-cap ranking.

| Group | Symbols in display order |
| --- | --- |
| Vietnam blue chips | `VIC`, `VCB`, `BID`, `CTG`, `TCB`, `VPB`, `FPT`, `HPG`, `VNM`, `GAS` |
| Crypto blue chips | `BTC`, `ETH`, `BNB`, `XRP`, `SOL`, `ADA`, `TRX`, `LINK`, `LTC`, `AVAX` |
| Gold | `XAU` |

`GOLD` is not displayed because `XAU` is the approved gold instrument. A missing symbol is omitted rather than replaced with a seeded price. The ticker snapshot becomes partial when at least one approved symbol is absent; the existing `DataStatusBadge` remains `SYSTEM` and its detail text names the missing symbols.

The ticker endpoint is requested with exactly these symbols, avoiding transfer and client processing for the hundreds of unrelated instruments currently returned by the unfiltered endpoint. A pure presentation helper restores the approved group and symbol order regardless of API response order. The same helper supplies the Trending Assets strip so both surfaces remain consistent.

The marquee retains the existing `min-w-0 flex-1 overflow-hidden` viewport, duplicate strip technique, hover pause, and reduced-motion behavior. Its animation duration changes from 60 seconds to 160 seconds. The animation continues to use `transform` only.

## Crypto Quant Pulse information architecture

Crypto Quant Pulse keeps the existing outer Market Pulse market tabs and introduces one nested tab set inside Crypto. The default tab is `Tổng quan`.

### Tổng quan

The overview answers three questions: what is the current crypto regime, what is driving it, and what deserves attention now.

- Current regime, coverage, confidence, freshness, and effective time.
- Fear & Greed 30-day trend.
- Aggregate daily ETF flow trend with BTC, ETH, and SOL visible in the legend.
- Up to three deterministic observations derived from available metrics. Each observation includes its source and effective date. No AI-generated narrative or unsupported recommendation is introduced.

### Dòng tiền

- Daily Farside BTC, ETH, and SOL ETF flows, using grouped or stacked bars where units are compatible.
- Weekly CoinShares fund-flow trend.
- Latest net flow, rolling total, and direction are displayed as compact numeric summaries above the charts.
- Daily and weekly facts are not joined into one continuous line.

### Tâm lý & Phái sinh

- Fear & Greed history and current classification.
- Funding-rate series by supported instrument.
- Open-interest series by supported instrument.
- DVOL or equivalent volatility series when present.
- Metrics with incompatible units use separate charts or axes with explicit labels; they are never normalized silently.

### On-chain

- Active-address trend.
- Adjusted transfer-volume trend.
- MVRV and NVT valuation/network-usage views.
- Stablecoin supply or liquidity trend.
- A single point-in-time observation remains a numeric snapshot and is not rendered as a trend line.

The existing long metric-card grid is removed from the Crypto surface. On-chain content is limited to two to four useful visual groups and compact latest-value annotations.

### Cá voi BTC

The existing BTC large-address dataset remains BTC-only and keeps its validated universe, exchange exclusions, and confidence rules.

- Accumulation versus distribution trend.
- Exchange inflow/outflow or exchange-interaction view when confirmed.
- Dormant-wallet activity.
- Cohort balance/activity chart and last universe refresh.

Existing detailed tables remain available inside this tab when they add evidence, but charts lead the reading order.

## Component boundaries

`TickerTape` owns fetching and rendering the global marquee. A small ticker presentation helper owns the approved universe, API query, ordering, missing-symbol state, and shared Trending Assets rows.

`LegacyMarketPulse` continues to own the outer Crypto/Macro/Gold selection and the existing single crypto request. It delegates the Crypto surface to a focused tab workspace instead of rendering every panel sequentially.

The Crypto tab workspace receives the existing `CryptoMarketPulseModel`, crypto `MetricModel[]`, request state, locale, and regime. Pure series builders group observations by metric and asset, sort them by effective time, retain source/freshness metadata, and return chart-ready rows. The presentation layer does not refetch data per nested tab.

Existing panels may be reused inside their matching tab. Large components should remain separately importable so opening Smart Insights does not create new request waterfalls or duplicate provider payloads.

## Data truthfulness and status behavior

- Live charts use only observations returned by the current APIs and accepted by the existing backend validation contracts.
- Seeded fallback remains visibly marked `Dữ liệu mẫu`.
- Missing live data renders `Unavailable`; it does not generate zeroes or interpolate a trend.
- Stale observations remain visible with their original effective date and stale badge.
- A failure in one source or tab does not hide valid data in other tabs.
- Gaps remain gaps. Series do not connect observations across incompatible frequency, unit, asset, or missing periods.
- Every chart exposes source attribution, effective time, unit, and freshness in the visible panel or tooltip.

## CryptoCraft Calendar status and scope

CryptoCraft Calendar acquisition is already implemented through Scrapling and is outside the UI redesign scope. A database verification on 2026-08-14 found:

- latest provider run status `succeeded`;
- 20 records fetched with no error code;
- 44 stored event/revision rows in the current-plus-next-week date window;
- stored events retain `research_only` attribution and point-in-time revisions.

The redesign must not replace CryptoCraft, change its acquisition schedule, or turn sample calendar events into live facts. UI QA confirms that live events display when the API returns them and that the existing sample badge remains when the event result is empty.

## Responsive and accessibility behavior

- Nested tabs remain keyboard accessible through the existing tab component.
- The tab list may scroll horizontally on narrow screens rather than wrapping into ambiguous rows.
- Charts use responsive containers with a stable minimum height and do not increase page width.
- Tooltips remain within the viewport and include text labels rather than relying on color alone.
- Positive and negative values retain the existing bull/bear palette plus signed numeric labels.
- The ticker pauses on hover and renders without animation under `prefers-reduced-motion`.

## Testing

Unit tests prove:

- the exact 10 Vietnam, 10 crypto, and one XAU symbols and their approved order;
- unrelated API symbols and `GOLD` are excluded;
- absent approved symbols are not fabricated and produce a partial state;
- the ticker query contains only the approved symbols;
- the 160-second animation, hover pause, and reduced-motion rule remain present;
- chart-series builders sort by effective time and keep unit, asset, source, and freshness boundaries;
- single-point metrics remain snapshots;
- the five approved nested tabs and default overview are rendered;
- switching tabs does not trigger duplicate crypto requests;
- the old long Crypto metric grid is no longer rendered on the Crypto surface;
- loading, stale, sample, unavailable, and ticker-partial states remain truthful without adding a new global `DataStatus` enum value.

Regression tests cover the existing Fear & Greed, Farside, CoinShares, large-address, Macro, Gold, Calendar, source guard, and API contracts.

Rendered QA uses the local stack at web port 3100 and quant-engine health port 8100. Desktop and mobile checks cover page identity, meaningful content, framework overlays, console errors, tab interaction, ticker overflow, chart clipping, source/freshness labels, and CryptoCraft live-versus-sample state.

## Out of scope

- Live market-cap ranking or automatic changes to the approved ticker universe.
- New provider acquisition, metric definitions, AI recommendations, or signal methodology.
- Changes to CryptoCraft scraping, scheduling, licensing, or raw-data export rules.
- Redesign of Macro, Gold, Watchlist, Briefing, Data Health, or other preserved Smart Insights blocks.
