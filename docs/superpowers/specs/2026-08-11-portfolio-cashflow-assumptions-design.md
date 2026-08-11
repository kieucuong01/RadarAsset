# Portfolio Cash-Flow and Rebalancing Assumptions

**Status:** Approved for implementation
**Date:** 2026-08-11
**Product:** RadarAsset / Financial Platform
**Scope:** Portfolio backtest contracts, worker accounting, and Quant Lab builder/results

## Purpose

Extend the approved Portfolio Backtest Builder with explicit cash allocation,
periodic contributions, scheduled rebalancing, dividend treatment, FX policy,
and market-specific execution costs without presenting normalized research
capital as a broker cash ledger.

## Decisions

1. Asset allocations plus `cashAllocationBps` must equal exactly `10_000`.
2. Cash is held in the reporting base currency and earns zero interest in the
   MVP. It is not represented by a synthetic market-price dataset.
3. Rebalancing frequency is `none`, `monthly`, `quarterly`, or `yearly`.
   A rebalance occurs on the first completed aggregate timestamp in the new
   period, after any scheduled contribution at that timestamp.
4. Monthly contributions are non-negative, occur on the first completed
   aggregate timestamp of a UTC month, and are distributed using target asset
   and cash weights.
5. Portfolio aggregation uses completed sleeve valuations only. It may carry a
   completed sleeve valuation forward for accounting but never invents a price
   bar or executable fill.
6. Rebalancing is a normalized-capital transfer between sleeves. The result
   records turnover and applies the configured market cost to transferred
   asset notional. It does not claim to reproduce board lots, settlement, or a
   broker order ledger.
7. Dividend mode is `exclude` or `adjusted_prices`. `adjusted_prices` is allowed
   only when every selected asset resolves an immutable active dataset whose
   adjustment policy includes total return. The system never invents dividend
   cash flows.
8. FX policy is `normalized_returns` in the MVP. Each sleeve starts from base
   reporting capital and contributes percentage performance. The manifest
   states that no historical FX settlement occurred. A future `versioned_fx`
   mode remains unavailable until immutable FX datasets exist.
9. Cost inputs are allow-listed by market. Commission, sell tax, slippage, and
   annual financing basis points are bounded and persisted in normalized run
   parameters and the portfolio hash.
10. Cash-flow, rebalance, and contribution artifacts are schema-versioned and
    tenant-scoped like the existing run artifacts.

## Contract

The canonical submission adds:

```ts
type PortfolioAssumptions = {
  cashAllocationBps: number;
  rebalanceFrequency: "none" | "monthly" | "quarterly" | "yearly";
  monthlyContribution: number;
  dividendMode: "exclude" | "adjusted_prices";
  fxPolicy: "normalized_returns";
  baseCurrency: "USD" | "VND";
  marketCosts: Record<
    "vn_equity" | "crypto_spot" | "metal_spot",
    {
      commissionBps: number;
      sellTaxBps: number;
      slippageBps: number;
      financingBpsAnnual: number;
    }
  >;
};
```

Legacy submissions normalize to zero cash, no rebalancing, no contribution,
excluded dividends, normalized-return FX, USD reporting, and cost values
derived from their existing fee/slippage fields.

## Worker Semantics

Each strategy sleeve is still evaluated causally with signal-at-close and
next-bar-open execution. The portfolio layer scales completed sleeve returns
to target capital, applies scheduled contributions and rebalancing transfers,
and emits:

- aggregate equity and drawdown;
- per-asset and cash contribution series;
- cash-flow and rebalance events with pre/post weights and costs;
- a manifest containing every assumption and warning.

If adjusted-price data is requested but unavailable, the server rejects the
run before writing. If a dataset or sleeve fails, no partial successful
portfolio artifact set is published.

## Security and Limits

- All numeric inputs are validated with strict Zod schemas at the API boundary.
- Market names and currencies are enums; callers cannot inject dataset IDs,
  providers, URLs, SQL, or executable formulas.
- Monthly contribution is capped at `100_000_000_000` and basis-point cost
  inputs are capped at conservative technical limits.
- Tenant context and `backtest:create` capability remain mandatory.
- The server resolves assets, datasets, strategy versions, adjustment policy,
  and leverage from storage.

## Acceptance Criteria

1. The builder can reserve cash while asset plus cash weights remain 100%.
2. Equal/custom/optimized allocation preserves the selected cash target.
3. Monthly contributions and scheduled rebalances change aggregate capital
   deterministically and emit auditable events.
4. Market-specific costs reduce the affected sleeve contribution.
5. Dividend mode never substitutes synthetic data.
6. Results include a contribution chart with a separate cash series.
7. Hashing the same inputs is deterministic and any assumption change changes
   the run hash.

