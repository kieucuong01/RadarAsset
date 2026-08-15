# Altcoin Factor Opinions Design

Date: 2026-08-15

Status: approved concept, pending implementation plan

## Context

Asset Opinion currently applies the full crypto factor model reliably only to BTC. Portfolio and
watchlist assets are assigned a market from ranked signals; an asset without a matching signal falls
back to `other`. This prevents ETH and other catalogued crypto assets from consuming the existing
Farside, Alternative.me, BlockchainCenter, and macro observations even when those observations are
fresh.

The BlockchainCenter collector and `crypto.cycle.altcoin_season.index` metric already exist. The
database contains point-in-time observations for the 90-day, monthly, and yearly horizons, but Asset
Opinion deliberately excludes the metric today. The implementation must consume only the explicit
`season_90d` observation. It must never choose a monthly or yearly row merely because the rows share
the same metric code.

## Goals

- Keep the existing BTC opinion model unchanged.
- Give non-stablecoin altcoins a transparent factor model based on their own trend, BTC trend,
  Altcoin Season, macro conditions, and Fear & Greed.
- Give ETH and SOL an additional ETF-flow pillar sourced from their own Farside series.
- Resolve asset market from the asset catalog instead of depending on signal availability.
- Let a useful partial opinion remain available when optional macro or ETF data is unavailable,
  while lowering coverage and confidence and exposing the missing confirmation.
- Preserve the 80/20 evidence boundary: at most 12 decision inputs, five supporting facts, and three
  contradicting facts.

## Non-goals

- No per-token hand-tuned model or machine-learned weight optimization.
- No opinion for stablecoins such as USDT, USDC, DAI, FDUSD, or TUSD.
- No synthetic macro, ETF, or Altcoin Season values when a provider is stale or unavailable.
- No change to the existing Crypto Market Pulse tabs or BTC Kronos shadow evaluation.
- No new narrative-news scraper. Macro news enters the model only through quantified releases,
  event risk, rates, inflation, liquidity, money-supply, and USD metrics.

## Chosen approach

Use two deterministic altcoin profiles. This avoids the underfitting of one generic crypto model and
the overfitting and maintenance cost of per-asset weights.

### Standard altcoin profile

| Pillar | Weight | Inputs |
|---|---:|---|
| Asset trend | 30% | Existing 20-day/60-day return, MA50/MA200 position, drawdown |
| BTC trend | 25% | BTC 20-day and 60-day return from the shared benchmark-bar batch |
| Altcoin rotation | 20% | BlockchainCenter `season_90d` only |
| Macro | 15% | At most two strongest fresh macro inputs |
| Broad sentiment | 10% | Alternative.me Fear & Greed |

### ETH and SOL profile

| Pillar | Weight | Inputs |
|---|---:|---|
| Asset trend | 25% | Existing trend inputs for ETH or SOL |
| BTC trend | 20% | BTC 20-day and 60-day return |
| Altcoin rotation | 15% | BlockchainCenter `season_90d` only |
| ETF flow | 25% | Asset-specific Farside daily net flow |
| Macro | 10% | At most two strongest fresh macro inputs |
| Broad sentiment | 5% | Alternative.me Fear & Greed |

BNB, XRP, ADA, LINK, LTC, AVAX, TRX and other non-stablecoin crypto assets use the standard profile.
ETH and SOL use the ETF profile. BTC continues to use the existing BTC profile.

## Market and asset classification

The briefing repository will load `symbol`, `market`, and `asset_class` for all portfolio and
watchlist symbols in the existing personalization batch. A single canonical mapping will convert:

- `crypto_spot` or crypto asset class to `crypto`;
- `vn_equity` to `stock_vn`;
- `metal_spot` and XAU to `gold`;
- known index/equity markets to `equity`.

Signal market is supporting metadata only and cannot override a catalogued asset into an unknown
taxonomy. The representative fallbacks remain BTC, XAU, and VNINDEX. A stablecoin allowlist blocks
opinion creation before market-data loading so stablecoins do not consume the 25-asset limit.

## Factor construction and normalization

### Asset trend

Reuse the current trend facts and normalizations. No extra price series is introduced.

### BTC trend

BTC bars are already part of the benchmark batch for crypto assets. Compute two explainable context
facts once per briefing and reuse them for every altcoin:

- `crypto.btc.return_20d`: raw BTC 20-day return, normalized with the existing bounded
  `return * 400` rule;
- `crypto.btc.return_60d`: raw BTC 60-day return, normalized with the same rule.

Both facts retain the BTC bar identifiers and timestamps used in the calculation. They do not add a
database query per asset.

### Altcoin Season

The repository accepts only the global observation with
`metric_code = crypto.cycle.altcoin_season.index` and `dimensions.horizon = season_90d`. Normalize it
as:

`altcoin_rotation_score = clamp((index - 50) * 2, -100, 100)`

This maps the provider's Bitcoin Season boundary of 25 to -50 and Altcoin Season boundary of 75 to
+50 without turning the classification thresholds into a binary trading signal. The method name is
`altcoin_season_centered_v1`.

### ETF flow

ETH and SOL accept only their own Farside asset row. The preferred observation is `fund = TOTAL` and
uses the existing rolling 90-day empirical percentile normalization. If the provider exposes only
fund-level SOL rows, the collector must publish a deterministic per-day `TOTAL` equal to the sum of
validated fund rows before the metric can enter the opinion.

### Macro

Use the latest fresh normalized macro observations already supported by the platform. The eligible
groups are rates/real yields, inflation surprise, central-bank and money-supply liquidity, Treasury
liquidity, and USD pressure. Select at most two macro decision inputs by absolute contribution so
macro cannot crowd price, BTC, or rotation evidence out of the 12-input ledger. Missing macro data
remains missing; it reduces coverage and confidence rather than becoming zero.

Money supply is added through the existing FRED collector boundary: ingest `M2SL`, derive
`macro.m2_change_4w`, and treat a positive four-week change as supportive of risk liquidity. Its
normalization uses the same rolling empirical-percentile family as other macro series, with the raw
four-week percentage change retained in the evidence ledger. The collector remains fail-closed when
FRED credentials or a fresh observation are unavailable; the design does not add a synthetic or
unkeyed replacement.

### Fear & Greed

Reuse `fear_greed_centered_v1`. It remains a distinct broad-sentiment pillar and never receives the
weight reserved for BlockchainCenter rotation.

## Coverage, gates, and opinion status

Keep the common minimums of 60 fresh daily bars, three numeric decision inputs, two source families,
and 60% weighted pillar coverage.

Coverage is the sum of populated profile pillar weights. Consequently:

- a standard altcoin with asset trend, BTC trend, Altcoin Season, and Fear & Greed has 85% coverage
  even when macro is unavailable;
- ETH or SOL with those inputs and ETF flow has 90% coverage without macro;
- ETH or SOL without ETF can still publish a lower-confidence 65% opinion if the other required
  evidence is fresh;
- an asset with price data alone has at most 30% coverage and remains `INSUFFICIENT_DATA`.

Unavailable optional pillars appear as missing confirmations in the calculation detail. They do not
become supporting or contradicting numerical evidence. DeepSeek receives only the bounded decision
ledger and may be labelled `AI đã phân tích` only after the existing grounding gates accept its
response.

## Opinion explanation and invalidation

The existing conclusion-first UI remains. Add Vietnamese and English labels for BTC trend and
Altcoin Season. The calculation table continues to show raw value, normalization method, weights,
contribution, source, and effective time.

Profile-specific deterministic change conditions may include:

- BTC 20-day or 60-day trend crossing from positive to negative;
- Altcoin Season crossing 75 upward or 25 downward;
- ETH/SOL ETF flow percentile changing sign or becoming stale;
- the overall asset score crossing its current stance boundary.

Only conditions backed by a decision input are displayed.

## Failure handling

- Stale BlockchainCenter, Farside, or macro observations are omitted, never zero-filled.
- Duplicate Altcoin Season horizons are rejected by dimension filtering before latest-row
  selection.
- Missing BTC benchmark bars remove the BTC-trend pillar for every altcoin in that briefing without
  causing per-asset retries.
- Unknown market taxonomy fails closed as `INSUFFICIENT_DATA`; it cannot silently use the generic
  100% trend profile.
- A malformed stored opinion falls back independently under the existing API contract.

## Performance boundaries

- Market identity is loaded in the existing personalization query.
- BTC benchmark bars and global facts are loaded once for the batch.
- Query count remains constant from one through 25 assets.
- Decision inputs remain capped at 12 and briefing evidence remains capped at 12 per opinion.
- No new frontend dependency or chart library is added.

## Verification

Implementation tests must prove:

1. ETH, SOL, and standard altcoins resolve to `crypto` from catalog metadata without a signal.
2. Stablecoins are excluded from the opinion universe.
3. Only `season_90d` enters the ledger when all three BlockchainCenter horizons exist.
4. The centered Altcoin Season normalization produces -50 at 25, 0 at 50, and +50 at 75.
5. Standard-alt and ETH/SOL pillar weights match this specification and sum to 1.00.
6. ETH and SOL consume only their own ETF flows; other altcoins do not receive ETF evidence.
7. SOL fund-level rows produce one validated daily `TOTAL` without double counting.
8. BTC trend facts are reused from the batch and do not create N+1 queries.
9. Macro absence lowers coverage but does not make otherwise sufficient altcoin evidence unavailable.
10. FRED `M2SL` produces a directional four-week money-supply fact when configured and remains
    missing rather than simulated when unavailable.
11. Price-only altcoins remain insufficient.
12. DeepSeek receives only the bounded decision inputs and the AI label remains gated.
13. Unit, integration, contract, build, and production desktop/mobile E2E suites pass within the
    existing payload and latency budgets.
