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
