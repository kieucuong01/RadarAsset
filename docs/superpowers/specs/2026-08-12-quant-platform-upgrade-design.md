# Quant Platform Upgrade Design

## Goal

Replace the browser/server-side portfolio math with a reusable Python quant engine and add reliable calendars, out-of-sample analytics, incremental strategies and live assignment signals for VN equities, crypto and XAU/USD.

## Architecture

- Next.js remains the tenant/auth boundary and resolves immutable `DatasetVersion` rows.
- A private FastAPI quant engine accepts only normalized return matrices and bounded optimizer parameters. It uses `skfolio` and returns a versioned JSON result. `QUANT_ENGINE_URL` and an optional shared token configure the connection.
- The existing PostgreSQL backtest worker imports the same Python calendar, analytics, strategy and signal-evaluation modules. It persists JSON metrics plus a self-contained QuantStats HTML artifact.
- Ingestion keeps Binance as primary for configured crypto feeds and uses CCXT only after a typed provider failure. Both paths publish through the existing immutable dataset pipeline.
- Factor Lab is availability-gated. It appears only when enough eligible VN daily history exists; calculations use point-in-time returns and never synthetic/future data.

## Quant rules

- VN sessions use an explicit Ho Chi Minh calendar with weekends, public-holiday overrides and the lunch break. Crypto is 24/7. XAU is 24/5.
- Annualization is derived from market/timeframe: VN 252 daily or 1,260 hourly; crypto 365 daily or 8,760 hourly; XAU 260 daily or 6,240 hourly. Mixed portfolios use observed timestamps per elapsed year.
- Optimizers: equal weight, inverse volatility, minimum variance, maximum Sharpe, target return, target volatility, maximum utility, risk budgeting, maximum diversification, minimum correlation and minimum CVaR. All are long-only with a hard maximum weight and deterministic basis-point rounding.
- Optimization fits on the first 70% of observations and reports both in-sample and untouched 30% out-of-sample performance.
- New strategies: EMA trend, RSI mean reversion, Bollinger mean reversion, MACD momentum and ATR breakout. Signals are close-confirmed and execute on the next bar, matching the current anti-lookahead engine.
- Active assignments are evaluated only when a newly published eligible dataset advances. Signal uniqueness remains `(assignment, type, signalAt)` and suggestions never auto-trade.

## Safety and errors

- Quant engine payloads are schema validated, size bounded and never include credentials or tenant identifiers.
- Missing engine returns a typed 503; infeasible optimization returns 409 with no fabricated weights.
- Provider fallback records the actual CCXT exchange/source in dataset provenance.
- Reports escape user-controlled labels and are stored as artifacts, not executable app markup.
- Factor Lab fails closed with a clear data-readiness reason.

## Verification

- Python unit tests cover calendars, optimizer constraints/OOS split, report metrics, every strategy, signal deduplication and CCXT fallback.
- Vitest covers API contracts, engine client failures, catalog synchronization and Factor Lab gating.
- Final gates: complete Python suite from `quant-worker`, Vitest, lint, production build, Prisma validation, local browser smoke at port 3100.
