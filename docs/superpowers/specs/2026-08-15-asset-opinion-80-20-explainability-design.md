# Asset Opinion 80/20 Explainability Design

Date: 2026-08-15

Status: Approved

## Objective

Make every asset opinion auditable without overwhelming a personal investor. The decision surface
must show the conclusion, the small set of numbers that produced it, each normalization and weight,
the strongest contradictions, and the conditions that would change the conclusion. DeepSeek remains
an interpretation layer and is labelled as AI only after its output passes grounding verification.

The feature uses an 80/20 rule: a source enters the deterministic score only when it is materially
useful, reliably obtainable, fresh, and explainable. Difficult, duplicated, weak, or unrelated data
is excluded instead of being used merely to increase apparent coverage.

## Decision Universe

The existing priority remains unchanged: active portfolio positions, the user's favorite/watchlist
assets, then `VNINDEX`, `XAU`, and `BTC`, de-duplicated and capped at 25 assets.

## Market-Specific Core Models

### BTC and supported crypto

| Pillar | Weight | Core inputs |
|---|---:|---|
| Trend | 40% | 20-day and 60-day return, MA50/MA200 position, current drawdown |
| Fund flow | 30% | Farside daily BTC ETF flow and five-day total; CoinShares weekly BTC flow as confirmation |
| Macro | 15% | Verified macro-event BTC impact and supported liquidity/rate inputs |
| Sentiment/on-chain | 15% | Fear & Greed plus one reliable non-duplicative on-chain/cycle input |

Farside is the primary flow input. CoinShares receives at most 25% of the fund-flow pillar so the
same institutional flow theme is not counted twice. Fear & Greed is retained because it is stable,
easy to explain, and directly useful as market-regime context. On-chain inputs are optional and do
not block an opinion when the source is unavailable.

### XAU

| Pillar | Weight | Core inputs |
|---|---:|---|
| Trend | 55% | 20-day and 60-day return, MA50/MA200 position, current drawdown |
| Macro | 30% | USD pressure, US real-yield/rate pressure, and verified macro-event XAU impact |
| Positioning | 15% | Gold positioning or fund-flow input only when a stable live source passes freshness gates |

Trend plus macro provides 85% possible coverage, so unreliable positioning data is never fabricated
or required. WGC/OCR data and unstable sources are not used in the decision model.

### VNINDEX and Vietnamese equities

| Pillar | Weight | Core inputs |
|---|---:|---|
| Trend | 50% | 20-day and 60-day return, MA50/MA200 position, current drawdown |
| Relative strength/liquidity | 30% | Relative strength versus VNINDEX and validated liquidity inputs |
| Foreign flow | 20% | Foreign flow only when a stable live source is present |

Crypto-wide facts never enter an equity or XAU fact sheet. Missing optional inputs reduce coverage;
they do not receive seed values or cross-market substitutes.

## Source Exclusion Policy

The following are excluded from deterministic decisions unless a future reviewed methodology
explicitly promotes them:

- Altcoin Season as a BTC, XAU, VNINDEX, or stock decision input;
- DeFi chain TVL for an individual BTC/XAU/equity opinion;
- duplicated CBBI components when a composite is already used;
- short-period margin-borrow rates that add noise without independent decision value;
- scraped whale/address data when exchange exclusions, freshness, or collection stability cannot be
  verified;
- WGC/OCR and other difficult sources that cannot pass a stable live gate;
- Kronos outputs, which remain shadow-only;
- any observation with no supported normalization rule.

Excluded context is not sent to DeepSeek and is not shown as decision evidence.

## Latest-Fact and History Rules

The decision fact sheet keeps exactly one latest eligible observation for each canonical
`asset + metric + dimensions` key at the briefing's `as_of` time. Revision selection occurs before
latest-effective-time selection. Facts are market-scoped: asset-specific facts go only to that asset;
global facts are admitted only through an explicit market/pillar mapping.

Historical observations are loaded separately for normalization and charts. They are bounded to the
declared lookback and never serialized as current evidence. Chart series are capped at 30 points.
The decision ledger is capped at 12 scored inputs per asset; because every serialized decision input
must participate in the score, the cap does not hide a used input.

## Normalization and Calculation

All scores are bounded to `[-100, 100]`. Direction is declared by the versioned metric rule.

For a rolling empirical percentile `p` in `[0, 1]`:

```text
normalized_score = clamp((2 * p - 1) * 100, -100, 100) * direction
```

For Fear & Greed index `x` in `[0, 100]`:

```text
normalized_score = clamp((x - 50) * 2, -100, 100)
```

Values above 80 or below 20 also create a crowding/extreme-regime contradiction record without
inventing another numeric input.

Farside flow uses the five-day BTC ETF net-flow total ranked against the latest 90 eligible daily
observations. CoinShares flow uses the latest weekly BTC flow ranked against up to 52 eligible weekly
observations. When both are available:

```text
fund_flow_score = 0.75 * farside_score + 0.25 * coinshares_score
```

When only one is available, the pillar uses that input and records reduced input coverage; its
configured 30% pillar weight does not increase.

For each pillar:

```text
pillar_score = sum(input_score * input_weight) / sum(available_input_weight)
pillar_contribution = pillar_score * configured_pillar_weight
```

For the asset:

```text
data_coverage = sum(configured weights of pillars with eligible scored inputs)
asset_score = sum(pillar_contribution) / data_coverage
```

The existing stance bands remain: `NEGATIVE <= -40`, `CAUTIOUS <= -15`, `NEUTRAL < 15`,
`CONSTRUCTIVE < 40`, and `POSITIVE >= 40`. An actionable stance requires at least 60 daily bars,
three numeric inputs, two independent source families, no stale critical input, and at least 60%
market-specific pillar coverage.

## Explainability Contract

Each scored input exposes:

- raw value and unit;
- effective and observed times;
- source code and URL;
- normalization method, lookback, percentile when applicable, and signed normalized score;
- pillar code, input weight, and weighted contribution;
- freshness and methodology version;
- supporting or contradicting role.

Each pillar exposes configured weight, available-input weight, score, contribution, confidence, and
the IDs of inputs used. The opinion exposes the full formula string, total contribution, coverage,
stance thresholds, failed gates, and deterministic action.

The API sends, per asset:

- all scored decision inputs, capped at 12;
- the three to five largest supporting inputs by absolute weighted contribution;
- the one to three largest contradictions by absolute weighted contribution;
- deterministic invalidation conditions derived from the same metrics and thresholds;
- at most 30 chart points per displayed series.

Historical observations and unscored context are not included in the evidence array.

## UI Information Hierarchy

The existing Smart Insights visual language, tokens, cards, typography, and responsive behavior are
preserved. The selected asset detail uses progressive disclosure:

1. `Kết luận`: stance, bounded action, horizon, confidence, coverage, and status label.
2. `Vì sao có kết luận này`: three to five supporting metric cards showing value, score, weight, and
   point contribution.
3. `Yếu tố phản biện`: one to three contradiction cards, or an explicit no-qualified-contradiction
   state.
4. `Điều kiện đổi quan điểm`: deterministic invalidation conditions; accepted DeepSeek text may
   explain but may not replace them.
5. `Xem cách tính`: collapsed by default. Expanding it shows the asset formula, pillar subtotal
   table, and every scored input in the bounded decision ledger.
6. `Nguồn`: compact source/freshness links for the same scored inputs only.

Desktop uses tables for exact comparison; mobile uses stacked cards with 44-pixel targets and no
horizontal scrolling. Color is accompanied by signed values and text. Charts render only for the
selected asset and preserve fixed height to avoid layout shift.

## AI Labelling and Failure States

The badge `AI đã phân tích` is rendered only when `explanationStatus == "accepted"` and the grounded
DeepSeek output is present. Otherwise the labels are:

- `Phân tích định lượng` for a passed quant view without accepted AI prose;
- `Chưa đủ dữ liệu` when a quant gate fails;
- `Dữ liệu chưa khả dụng` when calculation fails.

The UI never displays stale AI prose under a newer fact sheet. DeepSeek receives only the bounded,
market-scoped decision ledger and deterministic action. Existing grounding rules continue to reject
unsupported numbers, evidence IDs, assets, confidence, and action changes.

## Performance and Acceptance Budgets

- No asset serializes more than 12 scored inputs, eight highlighted inputs, or 30 points per chart
  series.
- A 25-asset briefing remains under 250 KB raw and 75 KB gzip.
- Market data is batch-loaded with constant query count; no per-asset web request is added.
- The page renders charts only for the selected asset.
- Tests prove crypto facts cannot reach XAU/VNINDEX/equities, latest-fact selection, exact formulas,
  contribution totals, top evidence selection, AI badge gating, and payload limits.
- Browser verification covers desktop and 390x844 mobile layouts, light/dark contrast, no horizontal
  overflow, and no new console/API errors.

## Delivery Sequence

1. Add failing repository tests for market scoping and latest eligible facts.
2. Add failing quant tests for metric normalization, market-specific weights, formula trace, and
   deterministic top evidence/contradiction selection.
3. Implement the bounded decision ledger and update persistence/API/Zod contracts.
4. Add failing UI tests for information hierarchy, calculation disclosure, and AI badge gating.
5. Implement the progressive-disclosure UI with existing components and styles.
6. Regenerate affected briefings, compare before/after payload size, run focused and full tests, and
   perform authenticated desktop/mobile browser QA.

