# Restore Smart Insights UI Design

## Goal

Restore the complete pre-cockpit Smart Insights visual experience while preserving the new Crypto,
Macro, and Gold quantitative data contracts. Every block from the former page remains visible.
Live or database-backed data is preferred; when a block has no accepted data, it may show seed data
only when the block carries the visible `Dữ liệu mẫu` status.

## Approaches considered

1. Restore the old 1,576-line component verbatim. This gives pixel-level fidelity quickly but also
   restores embedded market facts and tightly coupled fetching code.
2. Restore the old visual anatomy with focused components and current APIs. This preserves the
   experience while keeping provenance explicit and is the selected approach.
3. Keep the new cockpit and decorate it with old colors. This is smaller, but it does not satisfy the
   requirement to retain all former blocks.

## Page anatomy

The page keeps the former order and styling:

1. Gradient daily-briefing hero.
2. AI Digest with thesis, drivers, stance, checks, risk watch, and portfolio relevance.
3. Investor Intelligence with asset selection, thesis, catalysts, risks, evidence, forecast, and
   research-run history.
4. Market Pulse. Crypto, Macro, and Gold tabs live here. Crypto retains the Fear & Greed gauge and
   On-chain Pulse; all tabs expose their quantitative metric cards.
5. Trending Assets.
6. My Watchlist and CryptoCraft Economic Calendar in the former two-column layout.
7. Expert Signals with search and market/sentiment filtering.
8. Data Health in the same rounded-card style as an operational appendix.

The Evidence Drawer remains available from evidence-backed briefing items.

## Data provenance contract

- Smart Insights briefing, regimes, metrics, calendar, preferences, source health, ticker,
  watchlist, asset intelligence, and research runs continue to use their existing APIs.
- A successful API response is labelled `Dữ liệu hệ thống` or with the existing freshness badge.
- Empty accepted data stays empty or unavailable; it is not silently replaced.
- Seed fallback is allowed only for feature blocks that otherwise disappear, principally Expert
  Signals and initial unauthenticated/loading presentation.
- Every rendered seed block carries `DataStatusBadge status="SAMPLE"`, whose Vietnamese label is
  `Dữ liệu mẫu`.
- Seed records use neutral, obviously illustrative copy and never claim to be current market facts.

## Component boundaries

- `SmartInsights.tsx` owns parallel data loading, tab/filter state, and page composition.
- `LegacyDailyHero.tsx` renders the old gradient hero from briefing and regime state.
- `LegacyAIDigest.tsx` renders the old two-column digest from briefing and preferences.
- `LegacyInvestorIntelligence.tsx` owns the asset-intelligence and research-run section.
- `LegacyMarketPulse.tsx` owns market tabs, Fear & Greed presentation, metric panels, and ticker row.
- `LegacyWatchlist.tsx` owns the compact watchlist table and its existing add dialog.
- `LegacyExpertSignals.tsx` loads `/api/insights`, provides old filters, and labels fallback seed rows.
- Existing `EconomicCalendar`, `DataHealthPanel`, and `EvidenceDrawer` retain the quantitative
  contracts and are wrapped/reflowed to match the old layout.

## Failure states

- If core Smart Insights APIs all fail, the page keeps its former layout and shows unavailable
  states plus retry; it does not collapse to a different dashboard.
- A failed optional API affects only its block.
- Sample badges remain adjacent to the affected block title, not only in a page-level disclaimer.
- Source health continues to expose stale, unavailable, and disabled sources without substitution.

## Testing

- Add a source-level UI contract covering every former block and the three market tabs.
- Add a provenance guard requiring the sample badge in every seed-backed component.
- Keep the existing guard against the former unlabelled hard-coded market constants.
- Run focused Vitest, TypeScript/build, and rendered desktop/mobile validation.
