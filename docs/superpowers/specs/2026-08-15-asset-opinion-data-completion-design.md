# Asset Opinion Data Completion Design

## Goal

Complete the evidence path behind asset opinions for Crypto, Vietnamese equities, and Gold without inventing values or requiring DeepSeek. The UI must explain both the factors used and the exact reason an opinion cannot be produced.

## Product policy

- Crypto keeps the strict full-quant gate: at least 60 fresh daily bars, three decision inputs, two source families, 60% pillar coverage, and no stale critical input.
- Vietnamese equities and Gold may publish a clearly labelled technical-quant opinion when only audited market bars are available.
- Technical-quant opinions require at least 60 fresh daily bars and three price-derived decision inputs. Vietnamese equities also use 20-day relative strength against VNINDEX when available.
- Confidence is capped at 70% for Vietnamese equities and 65% for Gold until independent flow, positioning, or macro inputs qualify.
- Seed or fixture data never qualifies for a live opinion.

## Data flow

1. Scope the fact query to decision metrics and retain bounded history per asset and metric. Remove the global 1,000-row truncation that can starve ETH and SOL ETF rows.
2. Add VNINDEX as a first-class daily Vnstock index feed. Route it through `Market.index()` while equities continue through `Market.equity()`.
3. Keep the existing daily XAU Dukascopy feed and refresh it through the same ingestion workflow.
4. Provide one daily orchestration command that queues/drains market ingestion, runs Smart Insights daily collectors and pipelines, and regenerates all member briefings only after the preceding stages succeed.
5. Render localized gate diagnostics in the asset list and detail view. Technical-only opinions must say which independent inputs are still absent.

## Failure handling

- Provider failure preserves the last known-good active dataset.
- A stale critical bar produces no action.
- The daily orchestration stops before briefing generation when market ingestion or Smart Insights collection fails.
- Missing DeepSeek leaves the existing `quant_only` explanation status; it does not block a valid quant score.

## Performance boundaries

- Two database round trips remain sufficient for market bars and decision facts.
- Bars remain capped at 260 per requested symbol.
- Fact history is capped per asset/metric partition and filtered to the decision allow-list before ranking.
- The UI receives only the latest evidence selected by the existing 12-input/5-support/3-counter-evidence limits.
