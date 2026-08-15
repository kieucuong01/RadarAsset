# Asset Opinion Data Completion Implementation Plan

**Goal:** Make ETH/SOL ETF factors, VNINDEX/FPT technical opinions, XAU technical opinions, daily refresh, and missing-data explanations work from real data.

**Architecture:** Preserve the existing two-query opinion loader and immutable dataset publication. Fix fact fairness in SQL, extend the approved Vnstock adapter for VNINDEX, add profile-aware data gates with confidence caps, compose existing operational commands into a fail-closed daily refresh, and map gate codes to localized UI diagnostics.

**Tech stack:** Python, PostgreSQL, Vnstock, Dukascopy, Next.js/React, TypeScript, Vitest, Pytest, PowerShell.

### Task 1: Make the decision-fact query fair and bounded

- Modify `quant-worker/smart_insights/asset_opinion_repository.py`.
- Add a failing repository test proving ETH and SOL ETF history cannot be displaced by unrelated observations.
- Filter before ranking, cap each asset/metric partition, and remove the global truncation.
- Run the focused repository tests.

### Task 2: Add VNINDEX daily ingestion

- Modify the feed catalog and Vnstock adapter.
- Add failing catalog/provider/CLI tests for index routing and daily selection.
- Route VNINDEX to `Market.index()` with the approved KBS-backed Vnstock path.
- Run focused provider and ingestion tests.

### Task 3: Add technical-quant gates and confidence caps

- Modify asset-opinion rules and quant calculation.
- Add failing tests covering strict crypto, FPT relative strength, VNINDEX trend-only, XAU trend-only, stale bars, and confidence caps.
- Keep crypto gates unchanged; apply approved technical profiles only to equity/stock_vn/gold.
- Run focused quant and pipeline tests.

### Task 4: Add fail-closed daily refresh orchestration

- Add a PowerShell runner test and a composed daily refresh script.
- Reuse market ingestion, Smart Insights daily collection, and all-membership briefing generation.
- Stop on any failed stage and preserve structured output from child commands.
- Document the command in the operations runbook.

### Task 5: Explain data sufficiency in the UI

- Add failing component tests for localized gate reasons and technical-quant limitations.
- Add gate/analysis-mode label helpers and render the top reasons in list and detail views.
- Keep the current styling and responsive table/card structure.
- Run focused Vitest tests.

### Task 6: Verify live data and regressions

- Run focused Python and frontend suites, then lint/type/build checks applicable to changed files.
- Run live ingestion for VNINDEX, FPT, XAU and daily Smart Insights collectors.
- Regenerate briefings and inspect the resulting asset-opinion records.
- Verify the local UI in a browser, including desktop and mobile states and performance budgets.
