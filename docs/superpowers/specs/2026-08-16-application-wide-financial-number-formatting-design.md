# Application-Wide Financial Number Formatting Design

## Goal

Make every user-facing financial value easy to scan and consistent across Smart Insights,
Portfolio, Quant Lab, Strategy Lab, ticker surfaces, tables, cards, charts, and tooltips. The
display layer must add missing units where the value contract identifies one, shorten unnecessary
decimal precision, and use VND as the default currency for Vietnamese UI without relabelling or
converting values that explicitly belong to USD, USDT, BTC, or another unit.

## Display Convention

- Both Vietnamese and English UI use `en-US` numeric punctuation: `1,000.25`.
- Language still controls translated labels and fallback currency; it does not control separators.
- Vietnamese UI defaults an otherwise unspecified monetary value to `VND`.
- English UI defaults an otherwise unspecified monetary value to `USD`.
- Explicit source currency or unit always wins over the locale fallback.
- Formatting never performs currency conversion and never changes the stored numeric value.
- Missing, non-finite, or invalid values display as `—`, never as zero.

## Formatting Rules

| Value kind | Display rule | Example |
| --- | --- | --- |
| Count or integer | Group thousands, no decimals | `12,450` |
| VND money | Group thousands, no decimals, append unit | `1,250,000 VND` |
| USD/USDT money | Group thousands, up to 2 decimals | `56,200,000 USD` |
| Standard asset price | Up to 2 meaningful decimals | `3,456.78 USD` |
| Small crypto price | Expand to at most 8 decimals and trim trailing zeroes | `0.00001234 USDT` |
| Percent | Up to 2 decimals and append `%` | `82.74%` |
| Quant score | Up to 2 decimals, no fake unit | `−29.56` |
| General ratio | Up to 4 decimals and trim trailing zeroes | `0.3439` |
| Large chart/card value | Compact only where space is constrained | `1.25B USD` |
| Detailed table/tooltip | Preserve the full grouped value within its precision rule | `1,250,000,000 USD` |

Negative values use a real minus sign where the existing UI permits it. Very small non-zero values
must not round to a misleading zero; the formatter may show additional significant decimals or a
bounded scientific notation only for technical metrics where that notation is already meaningful.

## Unit Normalization

The presentation layer maps known backend units to concise display labels. Initial mappings include:

- `PERCENT` and percent-like metrics to `%`.
- `INDEX` to `điểm` in Vietnamese and `points` in English.
- `USD_MILLION` to `triệu USD` in Vietnamese and `USD million` in English.
- `USD/barrel` to `USD/thùng` in Vietnamese and `USD/barrel` in English.
- `contracts` to `hợp đồng` in Vietnamese and `contracts` in English.
- Asset-native quantities such as `BTC`, `ETH`, and `XAU` remain unchanged.
- Explicit currencies such as `USD`, `USDT`, and `VND` remain unchanged.

Unknown units are displayed as their original safe text. An unknown unit is never silently dropped.

## Architecture

Create one framework-independent formatting module under `src/lib` with typed functions for number,
money, price, percent, score, ratio, compact value, and metric-with-unit display. It accepts raw
numbers or validated decimal strings and returns display strings. React components remain responsible
only for choosing the semantic value kind and passing explicit metadata such as currency, unit,
locale, and whether compact output is appropriate.

The module caches `Intl.NumberFormat` instances by stable option key at module scope. Components do
not construct a formatter per row or render. The module contains no React state, hooks, network calls,
or domain calculations, so it can be reused by server and client code without adding a client bundle
boundary.

Backend APIs continue returning raw numeric contracts and explicit units. Existing `displayValue`
strings are normalized at the final presentation boundary when enough metric metadata exists; no API
response is changed into a locale-specific formatted string solely for this work.

## Migration Scope

The implementation inventories and replaces ad hoc `toLocaleString`, `Intl.NumberFormat`, raw decimal
string rendering, and hard-coded USD formatting on these user-facing surfaces:

1. Smart Insights asset opinions, evidence drawer, Crypto Quant Pulse, derivatives, whale activity,
   Kronos, Gold, Macro/Energy, calendar, and legacy blocks still visible in the current layout.
2. Portfolio overview, holdings, transactions, risk metrics, favorite assets, and strategy forward
   tests.
3. Quant Lab and backtest builders/results, optimizer, dataset health, and strategy descriptions.
4. Global ticker, charts, chart tooltips, and shared numeric table cells.

The migration does not alter finance formulas, stored values, provider payloads, or historical data.
It does not infer that every unitless number is money. Locale fallback currency is used only when the
caller declares a monetary value and the data contract lacks currency.

## VND Defaults

New user-facing monetary controls and presentation helpers resolve their default currency from the
active UI language: `VND` for Vietnamese and `USD` for English. Existing portfolio, dataset, asset,
transaction, backtest, and provider records with an explicit currency retain that currency. Changing
language changes only the fallback for unspecified monetary fields; it does not mutate stored account
or portfolio settings.

## Error Handling

- `null`, `undefined`, empty decimal strings, `NaN`, and infinity return `—`.
- Malformed decimal strings fail closed to `—` rather than partially parsing.
- Unsupported currency codes are shown as explicit unit text using number formatting without the
  `currency` style, avoiding runtime `RangeError`.
- Unit labels are escaped by React as ordinary text.
- Compact formatting is opt-in, so tables do not lose decision-relevant precision.

## Performance

- Cache formatter instances rather than recreating them inside mapped lists.
- Keep all formatting synchronous and local; no additional requests or client state are introduced.
- Avoid formatting hidden historical arrays before the chart or tab is rendered.
- Preserve numeric values for chart series and format only visible axes, labels, and tooltips.
- Do not add a third-party formatting dependency; use the platform `Intl` implementation.

## Testing and Acceptance

The shared formatter is developed test-first. Unit tests cover separators, trimmed decimals, VND and
USD defaults, explicit-currency precedence, small crypto prices, percent, score, ratios, compact versus
full output, unit translation, invalid values, and unknown units.

Component tests cover representative high-value surfaces:

- Asset Opinion list/detail/calculation and evidence values.
- Portfolio holdings and transaction summaries.
- Quant/backtest money and percent outputs.
- Ticker and chart tooltip values.

Acceptance criteria:

- No visible raw value such as `1000`, `61.250000`, or `0.3438893455` remains where semantic metadata
  is available.
- Monetary values show an explicit currency; Vietnamese unspecified money uses VND.
- Explicit USD/USDT/BTC/XAU source units are never relabelled as VND.
- Tables use grouped full values; constrained cards/charts may use labelled compact values.
- Null or invalid values render `—`.
- Full Vitest, lint, production build, and targeted browser QA pass without a material bundle or
  rendering regression.

## Out of Scope

- Currency conversion and exchange-rate ingestion.
- Changing portfolio base currency already stored in the database.
- Rewriting backend numeric types or database columns.
- Redesigning card, table, or chart layouts beyond spacing adjustments needed to fit units cleanly.
