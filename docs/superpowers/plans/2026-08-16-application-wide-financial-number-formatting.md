# Application-Wide Financial Number Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize every user-facing financial value so it is grouped, rounded, unit-labelled, locale-aware, and safe, with VND as the fallback currency in Vietnamese UI.

**Architecture:** Add one framework-independent formatter in `src/lib/financial-format.ts` and keep API/database contracts numeric. Each React surface chooses a semantic formatter (money, price, percent, score, ratio, count, or metric-with-unit), while the formatter owns parsing, precision, unit normalization, fallback currency, invalid-value handling, and cached `Intl.NumberFormat` instances.

**Tech Stack:** TypeScript 5.8, React 19, Next.js 16, Vitest 4, Testing Library, platform `Intl.NumberFormat`; no new runtime dependency.

## Global Constraints

- Both Vietnamese and English UI use `en-US` numeric punctuation: `1,000.25`.
- Vietnamese UI defaults an otherwise unspecified monetary value to `VND`; English defaults it to `USD`.
- Explicit source currency or unit always wins; formatting never performs currency conversion.
- Missing, non-finite, empty, or malformed values display as `—`, never zero.
- VND money has 0 decimals; USD/USDT money has at most 2; small crypto prices may use up to 8 trimmed decimals.
- Percent and quant score have at most 2 decimals; general ratios have at most 4 trimmed decimals.
- Compact notation is opt-in and limited to constrained cards/charts; tables and tooltips retain grouped full values.
- Preserve raw numeric chart series and format only visible axes, labels, and tooltips.
- APIs, database columns, finance formulas, provider payloads, and historical data remain unchanged.
- Do not infer that every unitless number is money; fallback currency applies only to callers declaring a monetary value.
- Do not add a third-party formatting dependency.

---

## File Structure

- Create `src/lib/financial-format.ts`: numeric coercion, formatter cache, semantic formatters, known-unit normalization.
- Create `src/lib/financial-format.test.ts`: exhaustive unit contract for separators, precision, currencies, small values, invalid values, units, and compact output.
- Modify Smart Insights components: replace local financial formatting and use raw evidence metadata when available.
- Modify portfolio and ticker components: use explicit record currencies and locale fallback only for unspecified money.
- Modify Quant Lab, backtest, strategy, and data-health components: replace per-render formatters and raw number interpolation.
- Modify shared chart tooltip rendering: format numeric tooltip values without altering chart series.
- Modify existing component and presentation tests; create focused component tests only where an existing test cannot observe the display contract.

### Task 1: Build the Shared Financial Formatter

**Files:**
- Create: `src/lib/financial-format.ts`
- Create: `src/lib/financial-format.test.ts`

**Interfaces:**
- Consumes: `Locale` from `src/lib/i18n/dictionary.ts`.
- Produces: `NumericInput`, `defaultCurrency`, `formatNumber`, `formatCount`, `formatMoney`, `formatPrice`, `formatPercent`, `formatScore`, `formatRatio`, and `formatMetricValue`.

- [ ] **Step 1: Write the failing formatter contract tests**

```ts
import { describe, expect, it } from "vitest";
import {
  defaultCurrency,
  formatCount,
  formatMetricValue,
  formatMoney,
  formatNumber,
  formatPercent,
  formatPrice,
  formatRatio,
  formatScore,
} from "@/lib/financial-format";

describe("financial formatting", () => {
  it("uses en-US punctuation and trims unnecessary decimals", () => {
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber("61.250000")).toBe("61.25");
    expect(formatCount(12450.8)).toBe("12,451");
  });

  it("uses locale fallback currency without overriding explicit currency", () => {
    expect(defaultCurrency("vi")).toBe("VND");
    expect(defaultCurrency("en")).toBe("USD");
    expect(formatMoney(1250000, { locale: "vi" })).toBe("1,250,000 VND");
    expect(formatMoney(1250000.55, { locale: "vi", currency: "USD" })).toBe("1,250,000.55 USD");
    expect(formatMoney(1250000.55, { locale: "en", currency: "USDT" })).toBe("1,250,000.55 USDT");
  });

  it("preserves useful precision for small crypto prices", () => {
    expect(formatPrice(56200000, { locale: "vi", currency: "USD" })).toBe("56,200,000 USD");
    expect(formatPrice(0.00001234, { locale: "vi", currency: "USDT" })).toBe("0.00001234 USDT");
    expect(formatPrice(0.0000000012, { locale: "en", currency: "USDT" })).toBe("1.2e-9 USDT");
  });

  it("formats percentages, scores, ratios, and compact values", () => {
    expect(formatPercent("82.7400")).toBe("82.74%");
    expect(formatPercent(0.1234, { multiplier: 100, sign: true })).toBe("+12.34%");
    expect(formatScore("-29.5600")).toBe("−29.56");
    expect(formatRatio("0.3438893455")).toBe("0.3439");
    expect(formatMoney(1_250_000_000, { locale: "vi", currency: "USD", compact: true })).toBe("1.25B USD");
  });

  it("normalizes known units and preserves unknown units", () => {
    expect(formatMetricValue(52.4, { locale: "vi", unit: "INDEX" })).toBe("52.4 điểm");
    expect(formatMetricValue(120.25, { locale: "vi", unit: "USD_MILLION" })).toBe("120.25 triệu USD");
    expect(formatMetricValue(83.456, { locale: "vi", unit: "USD/barrel" })).toBe("83.46 USD/thùng");
    expect(formatMetricValue(12000, { locale: "vi", unit: "contracts" })).toBe("12,000 hợp đồng");
    expect(formatMetricValue(4.125, { locale: "en", unit: "BTC" })).toBe("4.125 BTC");
    expect(formatMetricValue(7.25, { locale: "vi", unit: "custom-unit" })).toBe("7.25 custom-unit");
  });

  it("fails closed for invalid values", () => {
    for (const value of [null, undefined, "", "12x", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatNumber(value)).toBe("—");
    }
  });
});
```

- [ ] **Step 2: Run the formatter test and verify RED**

Run: `npm test -- src/lib/financial-format.test.ts`

Expected: FAIL because `@/lib/financial-format` does not exist.

- [ ] **Step 3: Implement numeric parsing, cached formatters, semantic precision, and unit normalization**

```ts
import type { Locale } from "@/lib/i18n/dictionary";

export type NumericInput = number | string | null | undefined;

type NumberOptions = {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  signDisplay?: Intl.NumberFormatOptions["signDisplay"];
  compact?: boolean;
};

const MISSING = "—";
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const formatterCache = new Map<string, Intl.NumberFormat>();

function numeric(value: NumericInput): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !DECIMAL.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatter(options: Intl.NumberFormatOptions) {
  const key = JSON.stringify(options);
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat("en-US", options);
  formatterCache.set(key, created);
  return created;
}

function minus(value: string) {
  return value.replace(/^-/, "−");
}

export function defaultCurrency(locale: Locale): "VND" | "USD" {
  return locale === "vi" ? "VND" : "USD";
}

export function formatNumber(value: NumericInput, options: NumberOptions = {}): string {
  const parsed = numeric(value);
  if (parsed == null) return MISSING;
  return minus(formatter({
    notation: options.compact ? "compact" : "standard",
    compactDisplay: options.compact ? "short" : undefined,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    maximumFractionDigits: options.maximumFractionDigits ?? 4,
    signDisplay: options.signDisplay,
  }).format(parsed));
}

export function formatCount(value: NumericInput): string {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

export function formatMoney(value: NumericInput, options: { locale: Locale; currency?: string | null; compact?: boolean }): string {
  const currency = options.currency?.trim() || defaultCurrency(options.locale);
  const maximumFractionDigits = currency === "VND" ? 0 : 2;
  const amount = formatNumber(value, { maximumFractionDigits, compact: options.compact });
  return amount === MISSING ? MISSING : `${amount} ${currency}`;
}

export function formatPrice(value: NumericInput, options: { locale: Locale; currency?: string | null; compact?: boolean }): string {
  const parsed = numeric(value);
  if (parsed == null) return MISSING;
  const currency = options.currency?.trim() || defaultCurrency(options.locale);
  if (!options.compact && parsed !== 0 && Math.abs(parsed) < 0.00000001) {
    return `${parsed.toExponential(2).replace(/\.0+e/, "e").replace(/0+e/, "e")} ${currency}`;
  }
  const maximumFractionDigits = currency === "VND" ? 0 : Math.abs(parsed) < 0.01 ? 8 : 2;
  const amount = formatNumber(parsed, { maximumFractionDigits, compact: options.compact });
  return `${amount} ${currency}`;
}

export function formatPercent(value: NumericInput, options: { multiplier?: number; sign?: boolean } = {}): string {
  const parsed = numeric(value);
  if (parsed == null) return MISSING;
  const number = formatNumber(parsed * (options.multiplier ?? 1), {
    maximumFractionDigits: 2,
    signDisplay: options.sign ? "exceptZero" : "auto",
  });
  return `${number}%`;
}

export function formatScore(value: NumericInput): string {
  return formatNumber(value, { maximumFractionDigits: 2 });
}

export function formatRatio(value: NumericInput): string {
  return formatNumber(value, { maximumFractionDigits: 4 });
}

export function formatMetricValue(value: NumericInput, options: { locale: Locale; unit?: string | null; compact?: boolean }): string {
  const unit = options.unit?.trim();
  if (!unit) return formatRatio(value);
  if (unit === "PERCENT" || unit === "%") return formatPercent(value);
  if (unit === "INDEX") {
    const result = formatNumber(value, { maximumFractionDigits: 2, compact: options.compact });
    return result === MISSING ? MISSING : `${result} ${options.locale === "vi" ? "điểm" : "points"}`;
  }
  if (unit === "USD_MILLION") {
    const result = formatNumber(value, { maximumFractionDigits: 2, compact: options.compact });
    return result === MISSING ? MISSING : `${result} ${options.locale === "vi" ? "triệu USD" : "USD million"}`;
  }
  if (unit === "USD/barrel") {
    const result = formatNumber(value, { maximumFractionDigits: 2, compact: options.compact });
    return result === MISSING ? MISSING : `${result} ${options.locale === "vi" ? "USD/thùng" : "USD/barrel"}`;
  }
  if (unit === "contracts") {
    const result = formatCount(value);
    return result === MISSING ? MISSING : `${result} ${options.locale === "vi" ? "hợp đồng" : "contracts"}`;
  }
  if (["USD", "USDT", "VND"].includes(unit)) {
    return formatMoney(value, { locale: options.locale, currency: unit, compact: options.compact });
  }
  const result = formatNumber(value, { maximumFractionDigits: 8, compact: options.compact });
  return result === MISSING ? MISSING : `${result} ${unit}`;
}
```

- [ ] **Step 4: Run the formatter tests and adjust the scientific-notation trimming to the asserted output**

Run: `npm test -- src/lib/financial-format.test.ts`

Expected: PASS; every assertion above is green and no `RangeError` is thrown for `custom-unit`.

- [ ] **Step 5: Run lint for the two new files**

Run: `npx eslint src/lib/financial-format.ts src/lib/financial-format.test.ts`

Expected: PASS with zero errors.

- [ ] **Step 6: Commit the formatter contract**

```powershell
git add src/lib/financial-format.ts src/lib/financial-format.test.ts
git commit -m "feat: add shared financial number formatter"
```

### Task 2: Migrate Smart Insights Asset Opinions and Evidence

**Files:**
- Modify: `src/components/smart-insights/AssetOpinionCalculation.tsx`
- Modify: `src/components/smart-insights/AssetOpinionDetail.tsx`
- Modify: `src/components/smart-insights/AssetOpinionList.tsx`
- Modify: `src/components/smart-insights/EvidenceDrawer.tsx`
- Modify: `src/components/smart-insights/AssetOpinions.test.tsx`

**Interfaces:**
- Consumes: `formatMetricValue`, `formatPercent`, `formatScore` from Task 1; `decisionInputs[].rawValue`, `decisionInputs[].unit`, `decisionInputs[].evidenceId` from the existing Smart Insights contract.
- Produces: evidence and calculation rows with grouped numeric values, explicit units, and no per-render `Intl.NumberFormat` creation.

- [ ] **Step 1: Add failing assertions for score, portfolio percentage, and evidence-unit output**

Add representative raw inputs to the existing fixture and assert:

```ts
expect(screen.getByText("−16.77")).toBeInTheDocument();
expect(screen.getByText("39.2%")).toBeInTheDocument();
expect(screen.getByText("120.25 triệu USD")).toBeInTheDocument();
expect(screen.queryByText("120.250000")).not.toBeInTheDocument();
```

For an evidence row without a matching `decisionInput`, retain its provider-supplied decorated `displayValue` and assert it is not reparsed or relabelled:

```ts
expect(screen.getByText("$95.4m")).toBeInTheDocument();
```

- [ ] **Step 2: Run the Smart Insights component test and verify RED**

Run: `npm test -- src/components/smart-insights/AssetOpinions.test.tsx`

Expected: FAIL because the components still use local formatters or raw `displayValue` strings.

- [ ] **Step 3: Replace local helpers and build the evidence lookup once per opinion**

Use these imports and value selections:

```ts
import { formatMetricValue, formatPercent, formatScore } from "@/lib/financial-format";

const inputByEvidenceId = new Map(
  opinion.decisionInputs
    .filter((input) => input.evidenceId)
    .map((input) => [input.evidenceId as string, input]),
);

const input = inputByEvidenceId.get(evidence.id);
const evidenceValue = input
  ? formatMetricValue(input.rawValue, { locale, unit: input.unit })
  : evidence.displayValue;
```

Replace calculations exactly by semantic kind:

```tsx
{formatScore(input.contribution)}
{formatScore(input.normalizedScore)}
{formatPercent(Number(input.inputWeight) * 100)}
{formatPercent(Number(input.pillarWeight) * 100)}
{formatScore(opinion.totalContribution)}
{formatPercent(opinion.portfolioWeightPct)}
{formatPercent(opinion.unrealizedReturn, { multiplier: 100 })}
```

In `EvidenceDrawer.tsx`, render `formatMetricValue(evidence.rawValue, { locale, unit: evidence.unit })`; if either field is absent, render the existing `evidence.displayValue` unchanged. Do not parse strings containing `$`, `%`, `m`, commas, or translated unit text.

- [ ] **Step 4: Run the Smart Insights test and verify GREEN**

Run: `npm test -- src/components/smart-insights/AssetOpinions.test.tsx`

Expected: PASS; all new formatting assertions succeed.

- [ ] **Step 5: Run focused lint and commit**

Run: `npx eslint src/components/smart-insights/AssetOpinionCalculation.tsx src/components/smart-insights/AssetOpinionDetail.tsx src/components/smart-insights/AssetOpinionList.tsx src/components/smart-insights/EvidenceDrawer.tsx src/components/smart-insights/AssetOpinions.test.tsx`

Expected: PASS.

```powershell
git add src/components/smart-insights/AssetOpinionCalculation.tsx src/components/smart-insights/AssetOpinionDetail.tsx src/components/smart-insights/AssetOpinionList.tsx src/components/smart-insights/EvidenceDrawer.tsx src/components/smart-insights/AssetOpinions.test.tsx
git commit -m "feat: format Smart Insights decision evidence"
```

### Task 3: Migrate Crypto, Macro, Gold, Calendar, and Legacy Smart Insights Values

**Files:**
- Modify: `src/components/smart-insights/CryptoDerivativesPressurePanel.tsx`
- Modify: `src/components/smart-insights/CryptoLargeAddressPanel.tsx`
- Modify: `src/components/smart-insights/CryptoMetricTrendPanel.tsx`
- Modify: `src/components/smart-insights/CryptoQuantPulseTabs.tsx`
- Modify: `src/components/smart-insights/EconomicCalendar.tsx`
- Modify: `src/components/smart-insights/KronosShadowPanel.tsx`
- Modify: `src/components/smart-insights/LegacyInvestorIntelligence.tsx`
- Modify: `src/components/smart-insights/LegacyWatchlist.tsx`
- Modify: `src/components/smart-insights/KronosShadowPanel.test.tsx`
- Create: `src/components/smart-insights/SmartInsightsNumberFormatting.test.tsx`

**Interfaces:**
- Consumes: all shared formatters from Task 1 and each component's existing explicit unit/currency metadata.
- Produces: consistent values across Fear & Greed, ETF flows, fund flows, on-chain, whale, derivatives, Kronos, gold, oil, and calendar displays.

- [ ] **Step 1: Add failing representative display tests**

Render the smallest data-bearing panel for each semantic kind and assert:

```ts
expect(screen.getByText("12,345 BTC")).toBeInTheDocument();
expect(screen.getByText("−4.25%")).toBeInTheDocument();
expect(screen.getByText("120.5 triệu USD")).toBeInTheDocument();
expect(screen.getByText("83.46 USD/thùng")).toBeInTheDocument();
expect(screen.getByText("56,200,000 USD")).toBeInTheDocument();
```

Extend the Kronos test with:

```ts
expect(screen.getByText("61.25%")).toBeInTheDocument();
expect(screen.queryByText("61.250000%")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run both Smart Insights formatting tests and verify RED**

Run: `npm test -- src/components/smart-insights/SmartInsightsNumberFormatting.test.tsx src/components/smart-insights/KronosShadowPanel.test.tsx`

Expected: FAIL on current ungrouped, over-precise, or untranslated output.

- [ ] **Step 3: Replace each local formatter by semantic mapping**

Apply this mapping without changing series data or business calculations:

```ts
// Derivatives rates and trend percentages
formatPercent(value)

// Whale quantities
formatMetricValue(value, { locale, unit: "BTC" })

// Fear & Greed or Altcoin Season indices
formatMetricValue(value, { locale, unit: "INDEX" })

// Farside and CoinShares flow values
formatMetricValue(value, { locale, unit: "USD_MILLION" })

// Gold/BTC/ETH/SOL prices with known currency
formatPrice(value, { locale, currency })

// WTI/Brent oil values
formatMetricValue(value, { locale, unit: "USD/barrel" })

// Open interest
formatMetricValue(value, { locale, unit: "contracts" })

// Kronos probability/confidence
formatPercent(value)
```

For charts, keep `value: number` in ECharts/Recharts datasets and format only the visible callback:

```ts
axisLabel: { formatter: (value: number) => formatNumber(value, { maximumFractionDigits: 2 }) },
tooltip: { valueFormatter: (value: number) => formatMetricValue(value, { locale, unit }) },
```

Keep `EconomicCalendar` date/time formatting separate; only impact/forecast/actual numeric values pass through `formatMetricValue` when the event contract provides a unit. Preserve provider text when the contract is textual.

- [ ] **Step 4: Run focused tests and lint**

Run: `npm test -- src/components/smart-insights/SmartInsightsNumberFormatting.test.tsx src/components/smart-insights/KronosShadowPanel.test.tsx src/components/smart-insights/AssetOpinions.test.tsx`

Expected: PASS.

Run: `npx eslint src/components/smart-insights`

Expected: PASS with no new errors.

- [ ] **Step 5: Commit the Smart Insights market migration**

```powershell
git add src/components/smart-insights
git commit -m "feat: standardize Smart Insights market values"
```

### Task 4: Migrate Portfolio, Favorites, Strategies, and Ticker Values

**Files:**
- Modify: `src/components/MockPortfolio.tsx`
- Modify: `src/components/PortfolioTransactionDialog.tsx`
- Modify: `src/components/FavoriteAssetsPanel.tsx`
- Modify: `src/components/PortfolioStrategyForwardTests.tsx`
- Modify: `src/components/StrategyAssignmentPanel.tsx`
- Modify: `src/components/TickerTape.tsx`
- Modify: `src/lib/ticker-presentation.ts`
- Modify: `src/lib/backend/portfolio.ts`
- Modify: `src/lib/portfolio-client.test.ts`
- Modify: `src/components/TickerTape.test.ts`
- Create: `src/components/PortfolioNumberFormatting.test.tsx`

**Interfaces:**
- Consumes: `formatCount`, `formatMoney`, `formatPercent`, `formatPrice`, and `formatRatio` from Task 1; explicit holding/transaction/portfolio currency when present.
- Produces: grouped holdings, prices, totals, P&L, quantities, risk values, and ticker prices; Vietnamese unspecified money displays as VND.

- [ ] **Step 1: Add failing portfolio and ticker assertions**

```ts
expect(screen.getByText("1,250,000 VND")).toBeInTheDocument();
expect(screen.getByText("12,345.6789 BTC")).toBeInTheDocument();
expect(screen.getByText("56,200,000 USD")).toBeInTheDocument();
expect(screen.getByText("+12.34%")).toBeInTheDocument();
expect(screen.queryByText("$1,250,000.00")).not.toBeInTheDocument();
```

Update `TickerTape.test.ts` to verify the deterministic quote-currency mapping used by the fixed ticker universe:

```ts
expect(tickerQuoteCurrency(row("VIC", "equity"))).toBe("VND");
expect(tickerQuoteCurrency(row("BTC", "crypto"))).toBe("USDT");
expect(tickerQuoteCurrency(row("XAU", "commodity"))).toBe("USD");
```

- [ ] **Step 2: Run portfolio and ticker tests and verify RED**

Run: `npm test -- src/components/PortfolioNumberFormatting.test.tsx src/components/TickerTape.test.ts src/lib/portfolio-client.test.ts`

Expected: FAIL because current code hard-codes USD, uses browser locale, or omits units.

- [ ] **Step 3: Replace local money, quantity, percentage, and price formatting**

Use the active `locale` and explicit record currency first:

```tsx
{formatMetricValue(holding.qty, { locale, unit: holding.symbol })}
{formatPrice(holding.price, { locale, currency: holding.currency ?? portfolio.currency })}
{formatMoney(holding.marketValue, { locale, currency: holding.currency ?? portfolio.currency })}
{formatMoney(preview.total, { locale, currency: selectedHolding?.currency ?? portfolio.currency })}
{formatPercent(returnValue, { multiplier: 100, sign: true })}
```

For transaction quantities that are not asset-native, use:

```tsx
{formatNumber(tx.qty, { maximumFractionDigits: 8 })}
```

The ticker API has no currency field, so centralize the fixed-universe quote convention in `src/lib/ticker-presentation.ts` rather than guessing inside JSX:

```ts
export function tickerQuoteCurrency(tick: Pick<MarketTickerResponse, "assetClass">) {
  if (tick.assetClass === "equity") return "VND" as const;
  if (tick.assetClass === "crypto") return "USDT" as const;
  return "USD" as const;
}
```

Import `useI18n()` in `TickerTape.tsx`, then render:

```tsx
{formatPrice(tick.price, { locale, currency: tickerQuoteCurrency(tick) })}
```

Remove backend `toLocaleString` from the VaR label. Return the raw decimal string and currency metadata already present in the portfolio read model, then format it at the React boundary. If the current read model has only `value: string`, add `rawValue` and `unit` while retaining `value` during this migration so existing API consumers remain compatible.

- [ ] **Step 4: Make new monetary controls resolve an unspecified currency by locale**

At form initialization only, use:

```ts
const initialCurrency = existingRecord.currency ?? defaultCurrency(locale);
```

Do not overwrite an existing portfolio, holding, transaction, or strategy currency when locale changes.

- [ ] **Step 5: Run focused tests and lint**

Run: `npm test -- src/components/PortfolioNumberFormatting.test.tsx src/components/TickerTape.test.ts src/lib/portfolio-client.test.ts src/lib/backend/portfolio.test.ts`

Expected: PASS.

Run: `npx eslint src/components/MockPortfolio.tsx src/components/PortfolioTransactionDialog.tsx src/components/FavoriteAssetsPanel.tsx src/components/PortfolioStrategyForwardTests.tsx src/components/StrategyAssignmentPanel.tsx src/components/TickerTape.tsx src/lib/backend/portfolio.ts`

Expected: PASS.

- [ ] **Step 6: Commit the portfolio and ticker migration**

```powershell
git add src/components/MockPortfolio.tsx src/components/PortfolioTransactionDialog.tsx src/components/FavoriteAssetsPanel.tsx src/components/PortfolioStrategyForwardTests.tsx src/components/StrategyAssignmentPanel.tsx src/components/TickerTape.tsx src/lib/ticker-presentation.ts src/lib/backend/portfolio.ts src/lib/portfolio-client.test.ts src/lib/backend/portfolio.test.ts src/components/TickerTape.test.ts src/components/PortfolioNumberFormatting.test.tsx
git commit -m "feat: standardize portfolio and ticker values"
```

### Task 5: Migrate Quant Lab, Backtests, Optimizer, Strategy Copy, and Data Health

**Files:**
- Modify: `src/components/BacktestLegCard.tsx`
- Modify: `src/components/backtest-results/ActiveBacktestPortfolio.tsx`
- Modify: `src/components/backtest-results/BacktestAdvancedAnalysis.tsx`
- Modify: `src/components/backtest-results/BacktestTradeList.tsx`
- Modify: `src/components/backtest-results/EquityDrawdownChart.tsx`
- Modify: `src/components/PortfolioOptimizerWorkbench.tsx`
- Modify: `src/components/MarketDataHealthPanel.tsx`
- Modify: `src/lib/backtest/asset-client.ts`
- Modify: `src/lib/backtest/data-readiness-client.ts`
- Modify: `src/lib/strategy-lab/custom-strategy.ts`
- Modify: `src/components/BacktestWorkbench.test.tsx`
- Modify: `src/components/StrategyLab.test.tsx`
- Modify: `src/lib/backtest/asset-client.test.ts`
- Modify: `src/lib/backtest/data-readiness-client.test.ts`
- Modify: `src/lib/strategy-lab/custom-strategy.test.ts`

**Interfaces:**
- Consumes: shared formatters from Task 1; existing explicit backtest base currency and asset currency.
- Produces: consistent capital, notional, equity, drawdown, trade, optimizer, row-count, and strategy-description values.

- [ ] **Step 1: Add failing Quant Lab and strategy assertions**

```ts
expect(screen.getByText("1,250,000 VND")).toBeInTheDocument();
expect(screen.getByText("56,200.25 USD")).toBeInTheDocument();
expect(screen.getByText("−12.35%")).toBeInTheDocument();
expect(screen.getByText(/12,450 bars/)).toBeInTheDocument();
expect(strategyDescription).toContain("1,000,000 VND");
```

- [ ] **Step 2: Run the targeted Quant Lab tests and verify RED**

Run: `npm test -- src/components/BacktestWorkbench.test.tsx src/components/StrategyLab.test.tsx src/lib/backtest/asset-client.test.ts src/lib/backtest/data-readiness-client.test.ts src/lib/strategy-lab/custom-strategy.test.ts`

Expected: FAIL because current code uses locale-specific separators, creates formatters per component, or formats strategy values ad hoc.

- [ ] **Step 3: Replace backtest and optimizer formatters without touching calculations**

Use these display calls:

```ts
formatMoney(notional, { locale, currency: baseCurrency })
formatMoney(equity, { locale, currency })
formatPercent(drawdownPct, { sign: true })
formatNumber(quantity, { maximumFractionDigits: 8 })
formatRatio(sharpeRatio)
formatCount(rowCount)
```

In `EquityDrawdownChart.tsx`, preserve numeric points and update only callbacks:

```ts
const moneyLabel = (value: number) => formatMoney(value, { locale, currency });
const percentLabel = (value: number) => formatPercent(value);
```

In `PortfolioOptimizerWorkbench.tsx` and `MarketDataHealthPanel.tsx`, delete component-local `new Intl.NumberFormat(...)` instances and call `formatNumber`/`formatCount` directly.

- [ ] **Step 4: Make strategy descriptions accept locale and use explicit currency**

Change the existing `describeCustomStrategy` signature and rendering while keeping Vietnamese as the compatibility default for non-React callers:

```ts
export function describeCustomStrategy(
  input: CustomStrategyInput | CustomStrategy,
  locale: Locale = "vi",
): string {
  const rule = normalizeCustomStrategy(input);
  if (rule.kind === "catalog_preset") {
    const name = strategyDefinition(rule.strategyCode, rule.strategyVersion).name;
    return locale === "vi"
      ? `${rule.symbol}: ${name} với tham số đã lưu.`
      : `${rule.symbol}: ${name} with saved parameters.`;
  }
  if (rule.kind === "scheduled_dca") {
    return `${locale === "vi" ? "Mua" : "Buy"} ${rule.symbol} ${locale === "vi" ? "trị giá" : "worth"} ${formatMoney(rule.amount, { locale, currency: rule.currency })} ${locale === "vi" ? "vào ngày" : "on day"} ${formatCount(rule.dayOfMonth)} ${locale === "vi" ? "hàng tháng" : "monthly"}.`;
  }
  if (rule.kind === "price_threshold") {
    const threshold = formatPrice(rule.value, { locale, currency: rule.currency });
    return `${rule.action === "buy" ? (locale === "vi" ? "Mua" : "Buy") : (locale === "vi" ? "Bán" : "Sell")} ${formatPercent(rule.sizePct)} ${rule.symbol} ${locale === "vi" ? "khi giá" : "when price"} ${OPERATOR_LABELS[rule.operator]} ${threshold}.`;
  }
  return `${rule.action === "buy" ? (locale === "vi" ? "Mua" : "Buy") : (locale === "vi" ? "Bán" : "Sell")} ${rule.symbol} ${locale === "vi" ? "khi" : "when"} ${rule.metric.toUpperCase()} ${OPERATOR_LABELS[rule.operator]} ${formatRatio(rule.value)}.`;
}
```

Update every call site in `StrategyLab` tests/components to pass the active locale; explicit `rule.currency` always wins.

- [ ] **Step 5: Run focused tests and lint**

Run: `npm test -- src/components/BacktestWorkbench.test.tsx src/components/StrategyLab.test.tsx src/lib/backtest/asset-client.test.ts src/lib/backtest/data-readiness-client.test.ts src/lib/strategy-lab/custom-strategy.test.ts`

Expected: PASS.

Run: `npx eslint src/components/BacktestLegCard.tsx src/components/backtest-results src/components/PortfolioOptimizerWorkbench.tsx src/components/MarketDataHealthPanel.tsx src/lib/backtest src/lib/strategy-lab/custom-strategy.ts`

Expected: PASS.

- [ ] **Step 6: Commit the Quant Lab migration**

```powershell
git add src/components/BacktestLegCard.tsx src/components/backtest-results src/components/PortfolioOptimizerWorkbench.tsx src/components/MarketDataHealthPanel.tsx src/lib/backtest src/lib/strategy-lab/custom-strategy.ts src/components/BacktestWorkbench.test.tsx src/components/StrategyLab.test.tsx src/lib/strategy-lab/custom-strategy.test.ts
git commit -m "feat: standardize Quant Lab financial values"
```

### Task 6: Migrate Shared Chart Tooltips and Add an Adoption Guard

**Files:**
- Modify: `src/components/ui/chart.tsx`
- Create: `src/lib/financial-format-adoption.test.ts`
- Modify: `src/lib/ticker-presentation.test.ts`

**Interfaces:**
- Consumes: `formatNumber` from Task 1 and optional formatter callbacks already supported by the shared chart component.
- Produces: grouped default numeric chart tooltips and a static regression guard against new ad hoc financial formatting.

- [ ] **Step 1: Add failing chart fallback and source-adoption tests**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migratedFiles = [
  "src/components/MockPortfolio.tsx",
  "src/components/PortfolioTransactionDialog.tsx",
  "src/components/TickerTape.tsx",
  "src/components/smart-insights/AssetOpinionCalculation.tsx",
  "src/components/smart-insights/CryptoQuantPulseTabs.tsx",
  "src/components/backtest-results/BacktestTradeList.tsx",
];

describe("financial formatter adoption", () => {
  it.each(migratedFiles)("does not format financial numbers ad hoc in %s", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/new Intl\.NumberFormat/);
    expect(source).not.toMatch(/\.toLocaleString\(/);
  });
});
```

Add a shared-tooltip assertion in the closest chart test or a focused test harness:

```ts
expect(screen.getByText("12,345.68")).toBeInTheDocument();
```

- [ ] **Step 2: Run adoption and chart tests and verify RED**

Run: `npm test -- src/lib/financial-format-adoption.test.ts src/lib/ticker-presentation.test.ts`

Expected: FAIL until all enumerated files use the shared module and the chart fallback groups values.

- [ ] **Step 3: Format only the shared chart tooltip fallback**

In `src/components/ui/chart.tsx`, keep a consumer-supplied formatter authoritative and change only the numeric fallback:

```tsx
{formatter && item?.value !== undefined && item.name ? (
  formatter(item.value, item.name, item, index, item.payload)
) : typeof item.value === "number" ? (
  formatNumber(item.value, { maximumFractionDigits: 4 })
) : (
  item.value
)}
```

Dates and category labels remain untouched.

- [ ] **Step 4: Run adoption test, targeted UI tests, and source scan**

Run: `npm test -- src/lib/financial-format-adoption.test.ts src/lib/ticker-presentation.test.ts src/components/TickerTape.test.ts src/components/smart-insights/AssetOpinions.test.tsx src/components/BacktestWorkbench.test.tsx`

Expected: PASS.

Run: `rg -n "new Intl\.NumberFormat|\.toLocaleString\(" src/components src/lib --glob "!src/components/ui/calendar.tsx"`

Expected: only date/time formatting and intentionally non-financial compatibility code remain; every financial occurrence is migrated or added to the guard before commit.

- [ ] **Step 5: Commit the shared chart and adoption guard**

```powershell
git add src/components/ui/chart.tsx src/lib/financial-format-adoption.test.ts src/lib/ticker-presentation.test.ts
git commit -m "test: guard shared financial formatting adoption"
```

### Task 7: Verify the Entire Application and Perform Browser QA

**Files:**
- Modify only files needed to fix failures directly caused by Tasks 1–6.

**Interfaces:**
- Consumes: all outputs from Tasks 1–6.
- Produces: buildable, lint-clean application with verified Smart Insights, Portfolio, Quant Lab, Strategy Lab, and ticker rendering.

- [ ] **Step 1: Run the complete Vitest suite**

Run: `npm test`

Expected: all test files pass; no snapshot or contract failure remains.

- [ ] **Step 2: Run full lint**

Run: `npm run lint`

Expected: exit code 0. If Windows reports the known `.local-data` or `.pytest_cache` permission warning, distinguish that environmental warning from source lint errors and rerun the scoped source lint if needed.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: Next.js production build completes with exit code 0 and no TypeScript error.

- [ ] **Step 4: Start or restart the local stack and verify listeners**

Run: `npm run dev`

Verify separately:

```powershell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3100,8100 }
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3100 | Select-Object StatusCode
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8100/health | Select-Object StatusCode
```

Expected: ports 3100 and 8100 listen; both HTTP checks return `200`.

- [ ] **Step 5: Perform browser QA on the high-value surfaces**

Verify in Vietnamese:

- Smart Insights: BTC/ETH/SOL flows, Fear & Greed, whale BTC, macro oil/gold, asset opinions, and evidence drawer show grouped values and explicit units.
- Portfolio: holding price/value/P&L and transaction preview show existing currencies; an unspecified monetary test fixture falls back to VND.
- Quant Lab: capital, backtest equity, drawdown, trade list, optimizer metrics, and dataset counts use the shared precision rules.
- Strategy Lab: rule descriptions show grouped money and explicit rule currency.
- Ticker/chart tooltips: price values are readable, grouped, and unit-labelled where metadata exists.
- No visible `NaN`, `Infinity`, `undefined`, over-precise decimal tails, or misleading zero from a tiny non-zero value appears.

Switch to English and verify an unspecified monetary value falls back to USD while explicit VND/USD/USDT/BTC/XAU values remain unchanged.

- [ ] **Step 6: Inspect the final diff and commit verification-only fixes**

Run:

```powershell
git status --short
git diff --check
git log --oneline -7
```

Expected: no whitespace errors; only intended formatting files and tests are modified. If browser/build verification required a source fix, stage only those files and commit:

```powershell
git commit -m "fix: complete financial formatting migration"
```

Do not commit unrelated user changes.
