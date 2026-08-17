# Smart Insights Analysis Date and Refresh Worker

## Goal

Let an authenticated investor select a date and read the AI briefing and per-asset quantitative opinions published for that date, without making current market data look historical. Make manual Smart Insight refresh requests run promptly in production instead of remaining queued with no consumer.

## Product Decisions

- The selected analysis date applies only to the daily AI briefing, portfolio-change digest, and AI asset opinions.
- Market Pulse, macro/energy pulse, current portfolio holdings, watchlist state, quotes, and Economic Calendar remain current. Their sections must be labeled as current/live data where the surrounding page could otherwise imply that they belong to the selected historical date.
- The date selector offers `Today` plus only dates for which the current tenant and user actually have a published briefing. It does not offer arbitrary empty calendar dates.
- `Today` is the default. The UI never silently substitutes the most recent older briefing for today.
- Historical briefings are read-only. Manual refresh and generate actions are available only for `Today`.
- An absent briefing is represented once at the briefing/opinions section level. Individual asset rows do not repeat `No opinion today` when the entire briefing is absent.
- A published briefing can legitimately omit an asset because it did not pass evidence gates. For that case, the asset row says `No opinion for the selected date` and retains its current portfolio/watchlist actions.

## User Experience

### Date control

Add a compact `Analysis date` control near the daily briefing heading, before the AI asset-opinion content. It contains:

- a prominent `Today` shortcut;
- a select/popover listing available dates in descending order;
- a human-readable Vietnamese label such as `17/08/2026`, while the underlying value remains ISO `YYYY-MM-DD`;
- a visible historical indicator when the selected value is not today.

The control is keyboard accessible, has an explicit accessible name, and preserves focus after selection. Changing the date cancels the previous briefing request, loads only the newly selected briefing, closes stale evidence detail, and leaves current Market Pulse/calendar requests untouched.

### Today states

- `ready`: show today's briefing and opinions, with the existing refresh action.
- `generating`: show one page-level `Đang tạo bản phân tích hôm nay` state and poll today's briefing.
- `idle`: show `Chưa có bản phân tích hôm nay` with a `Tạo phân tích AI` action for authorized users.
- `failed`: show the bounded failure state and a retry action. Existing successfully published older dates remain selectable.

### Historical states

- A selected published date shows its briefing, portfolio-change digest, and opinions with the date clearly visible.
- Refresh/generate controls are hidden for historical dates.
- A historical request that races with deletion or is no longer available shows `Không có bản phân tích cho ngày đã chọn`, refreshes the available-date list, and offers `Về hôm nay`.
- Polling never runs for a historical selection.

### Current-data labeling

Market Pulse and Economic Calendar retain their present behavior and receive concise `Dữ liệu hiện tại` / `Current data` labeling. Portfolio and watchlist action eligibility also continues to use current state, even while a historical opinion is open.

## API and Data Contracts

### Available dates

Add `GET /api/smart-insights/briefing/dates` for authenticated tenant members with `research:read` capability.

Response:

```json
{
  "today": "2026-08-17",
  "dates": ["2026-08-16", "2026-08-15"]
}
```

Contract rules:

- `today` is calculated in the Smart Insights business timezone, currently `Asia/Bangkok`, matching the briefing generator.
- `dates` contains at most the latest 90 distinct published effective dates, sorted descending.
- Results are scoped by both `organizationId` and `userId`; another tenant or member's dates must never be exposed.
- The response is private and not shared-cacheable.

This separate, small endpoint preserves the existing briefing payload and allows the date list to refresh independently after generation. It is fetched concurrently with the existing initial page requests, not per asset.

### Briefing read

Keep `GET /api/smart-insights/briefing?date=YYYY-MM-DD` as the exact-date read boundary.

- Validate `date` strictly as an ISO calendar date. Invalid or impossible dates return `400`.
- When `date` is supplied, load exactly that effective date; never fall back to the latest briefing.
- When today's exact briefing is absent, the authenticated request may return the existing `idle`, `generating`, or `failed` lifecycle derived from the refresh queue.
- When a historical exact briefing is absent, return `404` with `state: "idle"` and `errorCode: "BRIEFING_NOT_GENERATED_FOR_DATE"`. A current queued refresh must not make a historical date appear to be generating.
- Preserve tenant capability checks and private caching headers for successful responses. The existing internal briefing fingerprint remains unchanged.

The client API becomes `fetchBriefing(date, signal)` and always sends the selected ISO date from Smart Insights. Other callers may retain the existing no-date behavior only where they intentionally request the latest published briefing.

### Refresh write

Keep `POST /api/smart-insights/briefing` as a today-only operation. The UI never attaches a historical date to this request. Server-side generation continues to derive the effective date in the worker timezone, so a client cannot request regeneration of arbitrary history.

## Client State and Data Flow

Smart Insights adds these independent states:

- `today`: server-provided ISO business date;
- `availableDates`: published dates for the signed-in tenant member;
- `selectedDate`: initialized to `today`;
- current briefing lifecycle and payload for `selectedDate`.

Initial load fetches dates, today's briefing, regimes, and preferences concurrently. Briefing-date failure is isolated from current market sections. Selecting a historical date only replaces the briefing-bound payload. Refresh success triggers a fresh today read and a refresh of available dates so the newly published date becomes selectable.

The generation poll captures the selected date and stops when selection changes, the component unmounts, or the state leaves `generating`. This prevents a late today response from overwriting a historical selection.

## Production Refresh Worker

The repository already contains `quant-worker/process_smart_insight_refreshes.py --watch`, but production does not run it continuously. Add a dedicated systemd service rather than combining it with the market-ingestion worker:

- unit name: `datavest-smart-insights-refresh.service`;
- run as the existing `datavest` user/group;
- use `/opt/datavest/current/quant-worker` as the working directory;
- load the shared production and release environment files;
- execute the shared Python virtualenv with `process_smart_insight_refreshes.py --watch` and a bounded poll interval;
- restart on failure with the same hardening posture as the existing worker;
- depend on network, PostgreSQL, and the quant engine as required by the generator;
- grant write access only to paths actually needed by the process.

Provisioning installs and enables the unit. Deployment restarts it after the release symlink changes, includes it in rollback stop/start handling, and verifies that it is active. The existing daily briefing timer remains responsible for scheduled generation across all memberships; the new service consumes user-triggered refresh requests promptly.

On the first deployment, the already queued valid request should be claimed by this worker. Verification must confirm a terminal refresh-request status and a corresponding `daily_briefings` row rather than assuming service activity proves generation succeeded.

## Security, Privacy, and Performance

- Every date-list and briefing query is tenant- and user-scoped and capability-protected.
- Date input is parsed before reaching Prisma; no free-form values are accepted.
- Historical data remains read-only through this feature.
- Date discovery is one bounded indexed query, never a full history scan and never one query per asset.
- The UI aborts stale requests and performs no historical polling.
- No briefing payload or available-date list is stored in public cache or S3; PostgreSQL remains the live serving source. S3 continues to be reserved for appropriate bulk artifacts/backups, not interactive tenant briefing reads.

## Testing

Implementation follows test-driven development.

- Backend unit tests for strict date validation, tenant/user scope, descending distinct dates, the 90-date bound, and business-timezone `today`.
- Route tests for available-date authorization and cache headers.
- Route tests proving today's missing briefing uses refresh lifecycle while a missing historical date returns `BRIEFING_NOT_GENERATED_FOR_DATE` regardless of a queued current refresh.
- Client tests for the encoded exact-date URL, request cancellation, and lifecycle parsing.
- Component tests for defaulting to today, selecting a published date, historical read-only behavior, stale-response protection, current-data labels, and the two distinct missing-opinion states.
- Deployment contract tests proving the new service is installed, enabled, restarted, included in rollback handling, and invokes the intended refresh processor.
- Existing Python refresh-worker/repository tests remain green; add only coverage needed for service arguments or lifecycle gaps.
- Run formatting, TypeScript, lint, focused Vitest/Pytest, full test suites, and production build before release.
- After deployment, verify the pushed SHA, systemd status, refresh queue transition, `daily_briefings` persistence, public HTTP health, and the authenticated Today/historical browser flows separately.

## Acceptance Criteria

- An authenticated investor can switch among today and every published briefing date available to them.
- Selecting a date changes only briefing-bound analysis; Market Pulse and calendar remain explicitly current.
- The UI never labels a historical absence as `today` and never silently shows an older briefing as today's.
- Refresh controls and polling operate only for today.
- A manual refresh request is consumed automatically in production without waiting for the next daily timer.
- Missing evidence is never replaced with fabricated or placeholder investment opinions.
- Available dates and briefing data cannot cross organization or user boundaries.

## Non-goals

- No full-page historical snapshot of quotes, portfolio holdings, regimes, Market Pulse, or calendar.
- No arbitrary backfill or regeneration of historical briefings from the browser.
- No migration of interactive briefing reads from PostgreSQL to S3.
- No change to quantitative scoring, evidence gates, AI prompt content, or investment recommendation logic.
- No silent fallback from today to the latest older result.
