# Asset Opinion Performance Baseline

Date: 2026-08-15

Baseline commit: `b96c600`

Environment:

- Windows, local development services
- Node.js `v24.19.0`
- npm `11.17.0`
- Python `3.12.13` from the repository `.venv`
- Smart Insights listener checked at `http://localhost:3120`

## Reproducible commands

```powershell
npm test -- src/lib/backend/smart-insights.test.ts src/components/smart-insights/source-guard.test.ts
```

Result: 17 tests passed in 2 files.

```powershell
& "C:\Users\ASUS\Documents\Claude\Projects\Financial Platform\quant-insight-radar\.venv\Scripts\python.exe" -m pytest tests/test_smart_insights_briefing_pipeline_integration.py tests/test_smart_insights_grounding.py tests/test_kronos_isolation.py -q
```

Result: 8 tests passed.

```powershell
Invoke-WebRequest -Uri "http://localhost:3120/api/smart-insights/briefing" -SkipHttpErrorCheck
```

Result: HTTP 401 with `{"error":"Authentication required."}`. The running local service did not
provide an authenticated session to the shell, so endpoint latency and payload values were not
captured at baseline. No synthetic success response was substituted.

## Baseline evidence

| Metric | Baseline | Evidence quality |
|---|---:|---|
| Briefing endpoint p50 | Not captured | Authenticated request unavailable |
| Briefing endpoint p95 | Not captured | Authenticated request unavailable |
| Briefing response bytes | Not captured | Authenticated request unavailable |
| Briefing gzip bytes | Not captured | Authenticated request unavailable |
| Briefing read query shape | 1 Prisma `findFirst` with nested item relations | Source inspection |
| Smart Insights initial request graph | Briefing, regimes, preferences, data health, metrics, calendar plus legacy intelligence/run/insight requests | Source inspection, not browser timing |
| Initial JavaScript transfer | Not captured | Build/browser measurement required |
| Mobile LCP | Not captured | Authenticated browser measurement required |
| Mobile INP | Not captured | Authenticated browser measurement required |
| Mobile CLS | Not captured | Authenticated browser measurement required |

## Budgets for final verification

- 25-asset briefing p95: at most 200 ms in the controlled warm local benchmark.
- Raw briefing JSON: at most 250,000 bytes.
- Gzip briefing JSON: at most 75,000 bytes.
- Asset data queries: constant from 1 through 25 assets and no more than two additional batch queries.
- New initial JavaScript chunk: no more than 30 KB gzip.
- Mobile LCP: at most 2.5 seconds.
- Mobile INP: at most 200 ms.
- Mobile CLS: at most 0.1.

Final verification must use an authenticated maximum-universe briefing. When a baseline measurement
was unavailable, the final result is evaluated against the absolute budget and the reason for the
missing baseline remains visible rather than being backfilled with an estimate.

## Final verification

Final branch: `feat/asset-opinion-80-20`

Measurement mode:

- Optimized Next.js production build served locally with the isolated test database.
- Authenticated browser session created through the real sign-up and workspace flow.
- The briefing contains a deterministic 25-asset E2E fixture. These figures prove the application
  path and performance budget; they are not evidence of live market-provider freshness.
- The endpoint benchmark performs one excluded warm-up followed by 20 measured requests.

```powershell
$env:E2E_PRODUCTION='1'
npm run test:e2e -- e2e/smart-insights-asset-opinions.spec.ts
```

Result: 2 tests passed (desktop and mobile).

| Metric | Baseline | Final | Budget | Result |
|---|---:|---:|---:|---|
| Briefing assets | Not captured | 25 | At most 25 | Pass |
| Briefing endpoint p50 | Not captured | 18 ms | Informational | Recorded |
| Briefing endpoint p95 | Not captured | 35 ms | At most 200 ms | Pass |
| Briefing response bytes | Not captured | 47,489 B | At most 250,000 B | Pass |
| Briefing gzip bytes | Not captured | 4,064 B | At most 75,000 B | Pass |
| Decision inputs per opinion | Not captured | 1 in deterministic E2E fixture; hard cap 12 | At most 12 | Pass |
| Evidence per opinion | Not captured | 1 in deterministic E2E fixture; hard cap 12 | At most 12 | Pass |
| Supporting / contradicting evidence | Not captured | 1 / 0 in deterministic E2E fixture | At most 5 / 3 | Pass |
| Briefing read query shape | 1 Prisma query with nested legacy items | 1 Prisma query; opinions embedded in `market_summary` | Constant | Pass |
| Additional opinion evidence query | Not applicable | 0 | 0 | Pass |
| Desktop LCP | Not captured | 540 ms | At most 2,500 ms | Pass |
| Desktop INP | Not captured | 72 ms | At most 200 ms | Pass |
| Desktop CLS | Not captured | 0 | At most 0.1 | Pass |
| Mobile LCP | Not captured | 388 ms | At most 2,500 ms | Pass |
| Mobile INP | Not captured | 48 ms | At most 200 ms | Pass |
| Mobile CLS | Not captured | 0 | At most 0.1 | Pass |
| Initial page JavaScript | Not captured | 472,050 encoded B across 20 resources | Delta at most 30 KB | Delta unavailable |

The initial-JavaScript delta cannot be calculated because Task 1 did not capture a baseline build.
The final total is recorded without relabeling it as a feature delta. Runtime budgets are enforced in
the production E2E test; development-mode Web Vitals are recorded but not enforced because Next.js
compilation and Fast Refresh distort those values.

## Functional and data-boundary evidence

- The desktop renders the table and one selected detail region; mobile renders stacked cards.
- BTC and XAU selection updates the same detail region and only the selected asset renders charts.
- Every decision input exposes raw value, normalization method, normalized score, input weight,
  pillar weight, contribution, source, and effective timestamp behind a progressive-disclosure row.
- The rendered conclusion is followed by at most five supporting facts, at most three contradicting
  facts, and deterministic conditions that would change the view.
- Only the newest observation per metric survives repository selection. Both observed and effective
  age must satisfy the source SLA, so a recently backfilled historical row cannot be marked fresh.
- Farside uses a rolling 90-day empirical percentile, CoinShares and gold positioning use a rolling
  52-week percentile, and on-chain/macro use a rolling 365-day percentile when enough history exists.
- Fear & Greed keeps its bounded centered score/pipeline score rather than being duplicated by label.
- No horizontal overflow is present at the tested desktop or 390 x 844 mobile viewport.
- The page does not request legacy research-run, intelligence, or generic-insights endpoints.
- `Research run`, `Investor Intelligence`, and `Tài sản nổi bật` are absent from the rendered page.
- Each malformed stored asset falls back independently instead of invalidating the whole briefing.
- Signal, evidence, and AI provenance remain in normalized tables. The bounded read snapshot is stored
  in the existing briefing JSON, avoiding a migration and the former N+1 evidence read.

## Final command results

```text
npm run lint
0 errors; 13 Fast Refresh warnings in files outside the feature diff

npm test
82 files passed; 435 tests passed

quant-worker pytest --basetemp .pytest-tmp
588 passed; 28 skipped

production next build
compiled, type-checked, and generated all pages successfully

production Playwright E2E
2 tests passed (desktop and mobile)
```

## Live-source boundary check

The live refresh is recorded separately from the deterministic E2E fixture:

- Alternative.me succeeded with 3,113 Fear & Greed observations.
- Farside BTC, ETH, and SOL succeeded with 195, 165, and 105 rows respectively.
- CoinShares failed closed with `MISSING_PERIOD`; the OCR result was not enabled or substituted.
- FRED remained disabled because its API key is not configured.
- CFTC disaggregated remained disabled after an upstream HTTP error.
- The latest BTC briefing used seven bounded decision inputs/evidence rows, not the historical
  observations returned by collectors. Gold and VNINDEX remain `insufficient_data` when required
  source families are unavailable.
