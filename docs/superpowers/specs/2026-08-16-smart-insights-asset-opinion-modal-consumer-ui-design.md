# Smart Insights Asset Opinion Modal and Consumer UI Design

**Date:** 2026-08-16  
**Status:** Active — approved design for the uncommitted main-worktree implementation.

## Goal

Make Smart Insights easier for an individual investor to scan by moving the long asset-opinion detail below the table into an explicit, accessible modal; hiding operational data-health information; and restoring visible trend lines on the affected Crypto charts.

## Product Decisions

- Clicking anywhere on an asset-opinion desktop row or mobile card opens its analysis.
- The interaction must be visually discoverable before the user clicks it.
- The modal groups the existing explanation into three investor-oriented tabs instead of one long page.
- Source and freshness details are hidden by default behind an explicit source button.
- Smart Insights does not render or fetch data-health/admin pipeline information for the consumer page.
- Data provenance remains available on demand; this change does not weaken evidence validation or alter opinion calculations.

## Asset List Interaction

Each desktop row and mobile card is one keyboard-operable trigger.

The trigger uses the existing table/card style plus these affordances:

- pointer cursor and a visible hover/focus background;
- a trailing arrow icon;
- the text `Xem phân tích` in Vietnamese and `View analysis` in English;
- a screen-reader label containing the asset symbol;
- Enter and Space activation with a visible focus ring.

The list no longer maintains a permanently selected row solely to render a detail card beneath it. Opening a row sets the active opinion and opens the modal. Closing the modal returns focus to the trigger through the existing Radix dialog behavior.

## Modal Structure

The modal uses the existing application dialog primitive and design tokens. It is centered on desktop and nearly full-screen on small devices:

- desktop width up to approximately `72rem`;
- viewport-safe height with internal vertical scrolling;
- compact sticky header so the asset, stance and action remain visible while reading;
- no nested page-level card border around the entire detail.

### Header

The header displays:

- symbol and asset name;
- stance and accepted-analysis status;
- Quant score and confidence;
- the personalized action as the primary visual statement;
- portfolio weight only when portfolio data is available;
- a `Nguồn dữ liệu (n)` / `Data sources (n)` button.

Freshness is not shown as a permanent header badge. It remains available inside the on-demand source section.

### Tab 1: Luận điểm / Thesis

This is the default tab and answers the investor's first questions:

1. What is the conclusion?
2. What action should I review?
3. Which 3–5 numbers support it?
4. Which 1–3 numbers contradict it?

It contains the general quant conclusion, portfolio-aware guidance, technical-data limitation when applicable, and the existing supporting/contradicting evidence presentation. Insufficient-data states remain explicit and do not invent a view.

### Tab 2: Cách tính / Calculation

This tab contains the deterministic material:

- normalized inputs;
- weights and contributions;
- contribution chart;
- formula and detailed calculation explanation.

No score, formula, raw series or API contract changes are part of this UI work.

### Tab 3: Kịch bản & điều kiện / Scenarios & conditions

This tab contains:

- bull, base and bear cases only when the AI explanation is accepted;
- quant and narrative invalidation conditions;
- the conditions that would change the current view.

If a section is not valid for the opinion status, it remains omitted rather than replaced with sample text.

## On-Demand Sources

The current always-visible `Nguồn & độ mới` table/cards are removed from the default modal body.

The source button in the header toggles an in-modal disclosure below the header. The disclosure contains the same qualified evidence rows, values, impact, effective time and freshness. Clicking an individual source continues to open the existing evidence drawer for full provenance.

This is a disclosure inside the modal, not a second modal. The evidence drawer may remain a right-side sheet because it is the existing detailed provenance surface.

## Consumer/Admin Boundary

The Smart Insights consumer page removes `DataHealthPanel` and stops calling the data-health endpoint from this page. This reduces visual noise and avoids an unnecessary request.

Also hidden from the Smart Insights consumer surface:

- registered-source counts;
- accepted-observation counts;
- dataset counts;
- pipeline/collection mode;
- ingestion errors and operational status codes.

The underlying admin components, APIs and validation gates are not deleted. Investor-relevant states such as unavailable data, sample-data labels, evidence freshness and failed evidence gates remain visible where they affect a decision.

## Crypto Chart Repair

The root cause of the missing Fear & Greed and CBBI lines is an invalid SVG color expression. The theme defines `--primary` as a complete `oklch(...)` color, while the charts wrap it in `hsl(var(--primary))`.

The repair uses a complete valid token such as `var(--chart-1)` for the line, active dot and single-point dot. Raw chart data remains numeric and unchanged. Animation is disabled for deterministic rendering. The same invalid `hsl(var(--primary))` usage on active Smart Insights line charts is migrated in the same bounded change so the bug does not persist in another Crypto tab.

When a series contains one point, a visible dot communicates the observation instead of rendering an apparently empty chart. Multi-point series retain a line with an active dot.

## Accessibility and Responsive Behavior

- Dialog has an accessible title and description.
- Every row/card trigger is reachable and operable by keyboard.
- Tabs use the existing Radix tab semantics.
- Source disclosure exposes `aria-expanded` and a stable labelled region.
- Modal content scrolls internally without creating horizontal page overflow.
- Desktop table remains a table; mobile cards remain the compact representation.
- Charts retain sufficient contrast in both light and dark themes.

## Performance

- Keep only the active opinion in modal state; do not render every detail modal in the list.
- Compute evidence lookup maps with memoization where their construction remains non-trivial.
- Remove the Smart Insights data-health fetch and state.
- Do not introduce a new UI dependency.
- Preserve raw Recharts series and format only visible labels/tooltips.

## Verification

Automated tests must prove:

- detail content is absent until a row/card trigger opens the modal;
- row/card exposes discoverable `View analysis` copy and keyboard semantics;
- modal opens the correct asset and closes correctly;
- the three tabs show the correct existing sections;
- sources are absent by default, then appear after pressing the source button;
- evidence drawer callbacks still receive the selected evidence ID;
- Smart Insights no longer imports, renders or fetches data health;
- affected charts use valid theme tokens, preserve numeric series, show a single-point dot, and do not contain `hsl(var(--primary))`;
- desktop and mobile layouts do not overflow.

Browser QA covers the flow:

`Smart Insights -> click an asset row/card -> modal opens -> switch tabs -> open sources -> open one evidence item -> close and return to list`.

It also captures Fear & Greed and CBBI chart evidence in light or current theme at desktop and one mobile viewport, with no relevant console errors or framework overlay.

## Non-Goals

- No changes to DeepSeek prompts or acceptance gates.
- No changes to quant score formulas, thresholds or evidence selection.
- No deletion of admin APIs or source-health persistence.
- No new market data source or crawler work.
- No broad redesign outside Smart Insights.
