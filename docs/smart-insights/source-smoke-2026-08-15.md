# Smart Insights source gate — 2026-08-15

Environment: local PostgreSQL (`quant_insight_radar`, `public`) and the production
collector/parser code from `feat/smart-insights-crypto-tabs`. No credentials or raw
provider payloads are included in this record.

The enable gate is: bounded live fetch → parser validation → content-addressed raw
artifact → transactional persistence → read-back → successful source health.

| Source                                  |               Live rows | Newest effective data (UTC) | Parser          | Persist/read-back                        | Health           | Decision |
| --------------------------------------- | ----------------------: | --------------------------- | --------------- | ---------------------------------------- | ---------------- | -------- |
| GDACS Events                            |                     100 | 2026-08-14 09:58:43         | pass            | pass                                     | succeeded        | enabled  |
| USGS Earthquakes                        |                       5 | 2026-08-14 09:58:43.693     | pass            | pass                                     | succeeded        | enabled  |
| NASA EONET                              |                      34 | 2026-08-14 06:00:00         | pass            | pass                                     | succeeded        | enabled  |
| BIS Statistics (`WS_LONG_CPI/M.US.771`) |                      65 | 2026-06-30 00:00:00         | pass            | pass                                     | succeeded        | enabled  |
| GDELT Events                            | 75 in parser-only smoke | 2026-08-14 16:00:00         | pass previously | blocked by HTTP 429 on persistence retry | not persisted    | disabled |
| U.S. EIA Energy                         |                       0 | n/a                         | not run         | API key not configured                   | `NOT_CONFIGURED` | disabled |

The global event risk snapshot was also written and read back from the local database:
coverage `0.6500`, three evidence-backed components, score `33.7742`, status `active`.
Missing severity remains `NULL`; it is never converted to a synthetic zero.

Enabled sources are still subject to their configured freshness SLA. A later provider
failure is quarantined and does not replace the last validated observation.
