# Crypto Market Pulse Visualization Design

## Goal

Complete the Crypto section of the restored Smart Insights Market Pulse with quantitative,
source-attributed visualizations for:

- Alternative.me Crypto Fear & Greed over 30 days.
- Farside BTC, ETH, and SOL ETF net flows over 30 calendar days.
- CoinShares digital-asset fund flows over 12 reported weeks.

Charts communicate direction and trend first. Tables preserve exact point-in-time values. Accepted
provider observations are labelled as system data. Any seed fallback is visibly labelled
`Dữ liệu mẫu` inside the affected module.

## Approaches considered

### Dedicated Crypto Market Pulse read model — selected

Add one authenticated endpoint that returns the three bounded datasets already shaped for this
surface. It can select only Farside `fund=TOTAL`, query CoinShares over 12 weeks, and keep the
payload substantially below the generic metrics endpoint's 500-row cap.

### Extend the generic metrics API

Add metric-code, JSON-dimension, and longer-window filters to the existing metrics endpoint. This is
more flexible, but it expands a general contract for one page and exposes provider-specific query
details to the client.

### Filter all rows in the browser

Keep the current 31-day generic response and filter it client-side. This is rejected because the
response contains both per-fund and reported-total Farside rows, can hit the 500-row cap, and cannot
provide a reliable 12-week CoinShares series.

## API contract

Add:

```text
GET /api/smart-insights/crypto-market-pulse
```

The route requires the same authenticated `research:read` capability as the other Smart Insights
read APIs. Time windows are fixed by the server: 30 days for Fear & Greed and Farside, 12 reported
weeks for CoinShares. The client cannot supply arbitrary dates or provider URLs.

The response shape is:

```ts
type CryptoMarketPulseResponse = {
  generatedAt: string;
  fearGreed: {
    status: "system" | "unavailable";
    sourceCode: "alternative-fng";
    sourceUrl: string;
    latest: { effectiveAt: string; value: number; classification: string } | null;
    series: Array<{ effectiveAt: string; value: number; classification: string }>;
  };
  etfFlows: {
    status: "system" | "partial" | "unavailable";
    sourceCodes: string[];
    series: Array<{
      effectiveAt: string;
      btc: number | null;
      eth: number | null;
      sol: number | null;
      total: number;
    }>;
    summaries: Array<{
      asset: "BTC" | "ETH" | "SOL";
      latest: number | null;
      fiveDay: number | null;
      thirtyDay: number | null;
      latestEffectiveAt: string | null;
    }>;
  };
  fundFlows: {
    status: "system" | "unavailable";
    sourceCode: "coinshares-weekly";
    sourceUrl: string;
    series: Array<{
      effectiveAt: string;
      total: number;
      assets: Array<{ label: string; value: number }>;
    }>;
    latestBreakdown: Array<{ label: string; value: number }>;
  };
};
```

All monetary values are returned in USD. The UI formats flows in `US$m` or `US$bn` without changing
the stored values.

## Query and aggregation rules

### Fear & Greed

- Query accepted `crypto.fear_greed.index` observations for the latest 30 closed provider dates.
- Select the highest revision per natural observation before returning the series.
- Sort ascending for the chart.
- Classify values deterministically: `0–24 Extreme Fear`, `25–44 Fear`, `45–54 Neutral`, `55–74
Greed`, and `75–100 Extreme Greed`.

### Farside ETF flows

- Query `crypto.etf.net_flow_usd` from `farside-btc-etf`, `farside-eth-etf`, and
  `farside-sol-etf` over 30 calendar days.
- Include only observations whose JSON dimension `fund` equals `TOTAL`.
- Select the highest revision for each asset and effective date.
- Pivot BTC, ETH, and SOL into one daily row. Missing provider dates remain `null`; they are not
  converted to zero. `total` sums only reported asset values for that date.
- The five-day summary uses the latest five reported trading dates per asset, not five calendar
  days. The 30-day summary uses all reported observations inside the window.

### CoinShares fund flows

- Query accepted `crypto.coinshares.net_flow_usd` observations for the latest 12 distinct weekly
  effective dates.
- Use rows whose dimensions contain the `asset` key. Country rows are outside this first chart.
- Keep the provider's asset labels. Select the highest revision per asset and effective date.
- Use the row labelled `Total` when present as the weekly total. Otherwise sum the accepted asset
  rows and mark the dataset unavailable if reconciliation cannot be trusted.
- CoinShares remains unavailable until its live collector passes the existing fail-closed OCR
  gates and publishes accepted observations.

## UI layout

The Crypto tab keeps the restored Smart Insights card language and order.

### Fear & Greed module

- Retain the old semicircle gauge for the latest value.
- Add a 30-day line chart alongside it.
- Use five quiet horizontal background bands for the classification ranges.
- Add a compact seven-row table beneath the chart with date, index, classification, freshness, and
  source link.

### ETF Flow module

- Show three summary chips for BTC, ETH, and SOL with latest, 5D, and 30D net flow.
- Show a grouped daily bar chart. BTC, ETH, and SOL have stable distinct colors; the zero line is
  explicit; positive bars are above and negative bars below zero.
- The legend toggles assets without mutating data.
- Add a scrollable table with `Date | BTC | ETH | SOL | Total`. Positive values use the existing
  bull color and negative values use the bear color.

### CoinShares Fund Flow module

- Show a 12-week stacked bar chart by digital asset when system data exists.
- Add a latest-week breakdown table sorted by absolute flow magnitude.
- While CoinShares has no accepted observations, render a fixed illustrative 12-week dataset with a
  visible `Dữ liệu mẫu` badge and explanatory note. The sample is never returned by the API and
  never contributes to regimes, briefings, or portfolio impact.

## Components

- `src/lib/backend/crypto-market-pulse.ts`: authenticated-agnostic database read model,
  deduplication, pivoting, and summaries.
- `src/app/api/smart-insights/crypto-market-pulse/route.ts`: capability enforcement and JSON
  response.
- `src/lib/crypto-market-pulse-client.ts`: Zod response contract and client types.
- `src/components/smart-insights/CryptoFearGreedPanel.tsx`: gauge, line chart, and table.
- `src/components/smart-insights/CryptoEtfFlowPanel.tsx`: summaries, grouped bars, and table.
- `src/components/smart-insights/CryptoFundFlowPanel.tsx`: system/sample stacked bars and table.
- `src/components/smart-insights/LegacyMarketPulse.tsx`: loads the dedicated endpoint only when the
  Crypto tab is relevant and composes the three panels.

Recharts is already installed and is used through direct imports. No dependency is added.

## Loading, error, and provenance states

- Each module owns its loading skeleton so one source does not block the other modules.
- A route failure leaves all three modules visible and marks their fallback state explicitly.
- Fear & Greed and Farside use seed data only if the endpoint is unavailable, with a module-level
  `Dữ liệu mẫu` badge. A valid empty response stays `Unavailable` and is not silently replaced.
- CoinShares uses its explicit sample fallback while its API status is `unavailable`, matching the
  user's chosen policy for unfinished data sources.
- Every system chart includes effective date and source attribution. Tooltips never imply that a
  missing value is zero.

## Responsive behavior

- Desktop: gauge and Fear & Greed trend form two columns; ETF and CoinShares charts use the full
  card width.
- Mobile: all modules stack; charts retain at least 280 px height; tables scroll horizontally rather
  than compressing dates or numbers.
- Legends wrap and remain keyboard-operable through standard buttons.

## Testing and verification

- Backend unit tests prove Farside includes only `fund=TOTAL`, revisions are deduplicated, missing
  values remain null, and 5D uses reported trading dates.
- Backend tests prove CoinShares uses asset dimensions and the provider total.
- API route tests prove authentication/capability enforcement and response shape.
- Client schema tests reject malformed flow rows and invalid statuses.
- UI contract tests require all three Crypto modules, charts, exact tables, source attribution, and
  the CoinShares sample badge.
- Run focused tests first, then full Vitest, TypeScript, targeted ESLint, production build, and
  rendered desktop/mobile interaction checks for chart legends and horizontal tables.
