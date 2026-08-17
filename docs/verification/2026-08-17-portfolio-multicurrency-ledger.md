# Multi-currency portfolio ledger verification — 2026-08-17

## Automated gates

| Check | Result |
| --- | --- |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS — 128 files, 688 tests |
| `npm run test:python` | PASS — 743 passed, 29 skipped, 5 dependency warnings |
| `node --test scripts/run-market-ingestion.node-test.mjs` | PASS — 1 test |
| `npm run build` | PASS — Next.js production build and `/api/portfolio/transactions/[id]` route |
| `git diff --check` | PASS |

## Database and provider evidence

- `npx prisma migrate deploy`: applied `202608170001_portfolio_fx_rates` and
  `202608170002_normalize_vn_equity_portfolio_prices` locally.
- Vietcombank historical live-smoke for `2026-08-15`: parsed successfully as source
  `vietcombank`. Its public endpoint returned an empty series for 2016 and later returned HTTP 403
  after the rejected historical request burst, so no fabricated Vietcombank history was stored.
- Yahoo Finance `USDVND=X` ten-year live-smoke: PASS.
- Idempotent backfill summary: `requested=2609`, `stored=2603`, `failed=0`, coverage
  `2016-08-17` through `2026-08-17`, source `yahoo_finance`. The six missing business dates are
  handled by latest-on-or-before lookup.
- Database truth: `2603` Yahoo observations, zero duplicate `(effective_date, source)` rows, and
  zero portfolio transactions left on the explicit `26,000` fallback after snapshot repair.
- Daily failover smoke: Vietcombank was attempted first; Yahoo covered `2026-08-10` through
  `2026-08-17`, `failed=0`, with `fallbackFrom=vietcombank` recorded.
- `verify_daily_pipeline.py`: PASS for `2026-08-17`; 17/17 briefings, successful market run, FX
  effective date `2026-08-17`, source `yahoo_finance`.

## Local runtime and browser QA

- `http://localhost:3100`: HTTP 200.
- `http://127.0.0.1:8100/healthz`: HTTP 200,
  `{"status":"ok","engine":"quant-engine-v1"}`.
- Authenticated Chrome, desktop:
  - Vietnamese portfolio renders all primary money in VND.
  - English switch reloads all primary money in USD while the transaction audit line retains raw
    VND/USD values.
  - Cash-flow-matched VNINDEX cards show portfolio value, counterfactual benchmark value, money
    excess, and return excess.
  - Edit action opens the prefilled transaction modal with VND/USD selector.
  - Delete action opens an explicit replay/rollback warning; deletion was not confirmed during QA.
  - Vietnam equity quote normalization verified: FPT `68,300 VND`, legacy execution
    `70,800 VND`, position value `3,415,000 VND`, and edit preview `3,540,000 VND`.
- Mobile viewport `390x844`: total card renders without horizontal clipping; DOM confirms benchmark
  and transaction actions remain present.
- Browser console: no application-owned runtime error found. Chrome extensions injected attributes
  before hydration and emitted extension-owned `chrome-extension://.../executors/200.js` errors;
  these are classified separately from application behavior.

## Remaining runtime limitation

The actual destructive delete click was intentionally not confirmed in browser QA. Repository and
route tests cover atomic replay, 409 conflicts, tenant scoping, and the DELETE response contract.
