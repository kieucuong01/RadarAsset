# Documentation

Use this index for current documentation. Completed delivery plans and superseded designs are kept
in Git history, not in the active tree.

## Current system

- [Architecture map](architecture.md): runtime topology, domain ownership, data flows, persistence,
  security boundaries, verification layers, and change guide.
- [Repository README](../README.md): local setup, commands, ingestion setup, and product-specific
  operating notes.
- [Quant worker README](../quant-worker/README.md): Python worker, ingestion, engine, and Smart
  Insights commands.

## Operations

- [Smart Insights runbook](operations/smart-insights-runbook.md): provider activation, scheduler,
  live smoke, replay, AI fallback, and rollback.
- [`deploy/windows`](../deploy/windows): versioned Windows Task Scheduler artifacts for market
  ingestion.

## QA and evidence

- [`qa`](qa): focused manual and forward-testing QA records.
- [`verification`](verification): dated Quant ingestion, data quality, historical correctness,
  capacity, and performance evidence.
- [`smart-insights`](smart-insights): dated source-smoke and experimental evaluation evidence.

Dated verification documents prove conditions at their recorded time; they are not a guarantee of
current provider availability or dataset freshness.

## Active delivery documents

| Status  | Document                                                                         | Why it remains                                                                                       |
| ------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Planned | [BTC and XAU Event Impact](superpowers/plans/2026-08-14-btc-xau-event-impact.md) | The event-impact storage, calculation, API, and UI described by this plan are not present on `main`. |

Remove a plan/spec from this table and the active tree once its implementation is merged or a newer
document supersedes it. Git history is the archive.
