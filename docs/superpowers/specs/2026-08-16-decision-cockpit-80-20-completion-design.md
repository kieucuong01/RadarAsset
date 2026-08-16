# Decision Cockpit 80/20 Completion Design

## Goal

Complete the smallest trustworthy daily decision loop for a personal quantitative investor:

1. publish fresh daily prices for the assets that matter;
2. run the full daily pipeline automatically and fail closed;
3. measure realized outcomes of every eligible asset opinion;
4. show the three most important changes affecting the user's portfolio.

## Hard scope boundaries

- Keep historical intraday data, but do not queue, refresh, or gate readiness on `1h` datasets.
- Do not pre-ingest the full HOSE catalog. Daily scope is the existing curated universe plus assets present in a user's holdings or watchlist.
- Do not add U.S. equities, providers, crawlers, news sources, chat, or longer AI prose.
- Do not add WorldMonitor/disaster inputs to the decision score.
- Keep Kronos `decisionUse = NONE` until its existing 180-cutoff shadow gate passes.
- Keep operational health out of end-user Smart Insights UI.

## Architecture

### Daily price scope

One shared Python scope resolver returns the union of the repository's existing curated symbols and active assets referenced by `portfolio_positions` or `watchlist_items`. It accepts only `vn_equity`, `crypto_spot`, and `metal_spot`, and only active approved provider instruments. Queueing, readiness, and out-of-scope retirement consume the same resolver so they cannot disagree.

Only raw `1d` datasets are required by the market-data gate. VN adjusted publications remain a downstream daily step; historical `1h` rows remain immutable but do not enter queueing or readiness.

### Daily orchestration

The Windows daily scheduled task runs one fail-closed wrapper:

`daily market data -> corporate actions/adjusted data -> daily Smart Insights -> CryptoCraft current calendar -> all-member briefing`.

The wrapper stops before briefing when a prerequisite fails. Task installation and verification remain deployment operations, not an end-user dashboard.

### Opinion outcome measurement

Each eligible `asset_opinion` signal creates immutable evaluation rows for horizons 1, 5, and 20 daily sessions. Entry is the first eligible close strictly after signal publication; target is the Nth later close. Directional opinions are `POSITIVE/CONSTRUCTIVE = +1` and `CAUTIOUS/NEGATIVE = -1`; neutral or insufficient opinions do not claim directional accuracy.

VN equities use an eligible adjusted daily dataset; crypto and XAU use raw daily data. Each result records forward return, benchmark return (`VNINDEX`, `BTC`, or `XAU`), excess return, and direction correctness. The UI receives only bounded aggregate scorecards, never thousands of evaluation rows.

### Portfolio change digest

The briefing read model compares the current published asset opinions with the latest earlier briefing for the same tenant and user. A deterministic rank favors held assets, stance/action changes, and large score changes. The API returns at most three changes. DeepSeek does not generate or rank this section.

## Success gates

- Core daily readiness excludes all `1h` data and full-catalog HOSE noise.
- The daily runner is idempotent, stops on failed prerequisites, and records scheduler success/failure.
- Every mature eligible opinion has one evaluation per 1/5/20-session horizon.
- Smart Insights shows bounded sample size, hit rate, average return, and benchmark excess return.
- The daily portfolio digest contains at most three deterministic, evidence-linked changes.
- Existing unit, integration, E2E, type, lint, format, migration, and build gates pass.
