# HOSE Core 2016 Production Backfill Implementation Plan

> Superseded on 2026-08-18: Vnstock Community live smoke returned no data
> before 2018-08-20. Follow the implemented `vn-core-2018` boundary instead;
> this historical plan remains as an audit record and must not be executed.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish verified daily raw datasets from `2016-01-01` through the latest closed HOSE session for `VNINDEX`, `VN30`, `FPT`, `VCB`, `HPG`, `VNM`, `MWG`, `SSI`, and `VIC` on production, while leaving one reusable path for later selected-symbol and full-HOSE expansion.

**Architecture:** A code-owned backfill profile supplies an explicit symbol allowlist and historical boundary to the existing immutable ingestion publisher. The HOSE calendar and Vnstock adapter accept the 2016 boundary, while normal daily ingestion keeps its recent overlap behavior after the first full history is active. A production one-shot systemd job runs the reviewed profile under the existing heavy-job lock, then a read-only verifier proves database coverage and application usability.

**Tech Stack:** Python 3.12, psycopg/PostgreSQL, Vnstock VCI/KBS adapters, pytest, Bash/systemd, GitHub Actions, Next.js production health endpoints.

## Global Constraints

- Daily-only: no `1h` timeframe, intraday routes, or intraday provider calls.
- Initial production selection is exactly the nine approved symbols.
- Historical start is exactly `2016-01-01`; no synthetic rows are created before a provider/listing start.
- Raw dataset publication is immutable and source-attributed.
- Existing active data remains active when a provider or quality gate fails.
- `total_return` remains fail-closed until corporate-action coverage contains the full raw range.
- No full-HOSE production run is triggered by this release.
- Future full-HOSE expansion uses the same historical boundary, dynamic provider catalog, bounded request queue, and publisher.
- Production secrets stay on the VPS and are never printed or copied into GitHub Actions.

---

### Task 1: Add a reusable, bounded backfill profile contract

**Files:**

- Create: `quant-worker/backtest/backfill_profiles.py`
- Modify: `quant-worker/ingest_market_data.py`
- Test: `quant-worker/tests/test_backfill_profiles.py`
- Test: `quant-worker/tests/test_ingest_market_data_cli.py`

**Interfaces:**

- Produces: `BackfillProfile(name: str, market: str, timeframe: str, start: date, symbols: tuple[str, ...])`.
- Produces: `resolve_backfill_profile(name: str) -> BackfillProfile`.
- Produces: CLI `python quant-worker/ingest_market_data.py all --profile vn-core-2016 [--dry-run] --env-file <path>`.
- Consumes: existing `FEEDS`, `IngestionSelection`, `run_ingestion`, and the immutable publisher.

- [ ] **Step 1: Write the failing profile behavior tests**

Add literal, independently derived expectations:

```python
from datetime import date

import pytest

from backtest.backfill_profiles import resolve_backfill_profile


def test_vn_core_2016_profile_is_exact_and_daily_only() -> None:
    profile = resolve_backfill_profile("vn-core-2016")

    assert profile.market == "vn_equity"
    assert profile.timeframe == "1d"
    assert profile.start == date(2016, 1, 1)
    assert profile.symbols == (
        "VNINDEX", "VN30", "FPT", "VCB", "HPG", "VNM", "MWG", "SSI", "VIC"
    )


def test_unknown_backfill_profile_is_rejected() -> None:
    with pytest.raises(ValueError, match="Unsupported backfill profile"):
        resolve_backfill_profile("all-hose-now")
```

Extend the CLI test so `--profile vn-core-2016 --dry-run` sends exactly those nine `1d` selections to the real `build_selections` path, and `--profile` combined with `--asset` fails with sanitized `configuration_error`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm run test:python -- quant-worker/tests/test_backfill_profiles.py quant-worker/tests/test_ingest_market_data_cli.py -q
```

Expected: FAIL because `backtest.backfill_profiles` and `--profile` do not exist.

- [ ] **Step 3: Implement the minimal profile registry and CLI selection**

Create:

```python
from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class BackfillProfile:
    name: str
    market: str
    timeframe: str
    start: date
    symbols: tuple[str, ...]


VN_CORE_2016 = BackfillProfile(
    name="vn-core-2016",
    market="vn_equity",
    timeframe="1d",
    start=date(2016, 1, 1),
    symbols=("VNINDEX", "VN30", "FPT", "VCB", "HPG", "VNM", "MWG", "SSI", "VIC"),
)

_PROFILES = {VN_CORE_2016.name: VN_CORE_2016}


def resolve_backfill_profile(name: str) -> BackfillProfile:
    try:
        return _PROFILES[name]
    except KeyError as error:
        raise ValueError("Unsupported backfill profile.") from error
```

Add `profile: str | None` to `build_selections`. Reject `profile` combined with `asset`/`timeframe` or a schedule command other than `all`. Validate every profile symbol against `FEEDS`, market, and timeframe before returning selections. Keep the existing `daily`, `all`, and single-feed behavior unchanged.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit the profile contract**

```powershell
git add -- quant-worker/backtest/backfill_profiles.py quant-worker/ingest_market_data.py quant-worker/tests/test_backfill_profiles.py quant-worker/tests/test_ingest_market_data_cli.py
git commit -m "feat: define reusable HOSE backfill profile"
```

---

### Task 2: Extend the verified HOSE calendar and provider boundary to 2016

**Files:**

- Modify: `quant-worker/backtest/market_calendar.py`
- Modify: `quant-worker/backtest/ingestion.py`
- Modify: `quant-worker/backtest/providers.py`
- Test: `quant-worker/tests/test_market_calendar.py`
- Test: `quant-worker/tests/test_ingestion.py`
- Test: `quant-worker/tests/test_providers.py`

**Interfaces:**

- Produces: `HOSE_VERIFIED_FROM = date(2016, 1, 1)` and `HOSE_CALENDAR_VERSION = "hose-reviewed-closures-2016-2026-v2"`.
- Produces: initial Vietnam `IngestionWindow.fetch_start == 2016-01-01T00:00:00Z`.
- Consumes: profile start from Task 1 only as a stricter override; no request may precede the verified calendar boundary.

- [ ] **Step 1: Write failing calendar, ingestion-window, and provider tests**

Update literal expectations:

```python
def test_hose_calendar_certifies_the_2016_backfill_boundary() -> None:
    hose = MARKET_CALENDARS["vn_equity"]
    assert HOSE_CALENDAR_VERSION == "hose-reviewed-closures-2016-2026-v2"
    assert hose.certified_from == date(2016, 1, 1)
    assert not is_session_day(date(2016, 2, 8), "vn_equity", strict=True)
    assert is_session_day(date(2016, 2, 15), "vn_equity", strict=True)
```

Add representative closure assertions for every newly certified year:

```python
@pytest.mark.parametrize(
    "closed_day",
    [
        date(2016, 2, 8), date(2017, 1, 30), date(2018, 2, 19),
        date(2019, 2, 4), date(2020, 1, 27), date(2021, 2, 15),
        date(2022, 2, 1), date(2023, 1, 23),
    ],
)
def test_hose_historical_weekday_closures_are_not_missing_bars(closed_day: date) -> None:
    assert not is_session_day(closed_day, "vn_equity", strict=True)
```

Update the ingestion test to expect a new or truncated Vietnam dataset to refetch from `2016-01-01`, while a complete dataset still fetches only the existing recent overlap. Update Vnstock tests to prove FPT and VNINDEX requests use `start == "2016-01-01"`; the VNINDEX test must fail while the hidden eight-year clamp remains.

- [ ] **Step 2: Run the focused tests and verify RED**

```powershell
npm run test:python -- quant-worker/tests/test_market_calendar.py quant-worker/tests/test_ingestion.py quant-worker/tests/test_providers.py -q
```

Expected: FAIL on the 2024 boundary, old version, and VNINDEX eight-year clamp.

- [ ] **Step 3: Add the explicit 2016–2023 HOSE weekday closures**

Keep the existing 2024–2026 dates and prepend this exact reviewed set:

```python
_VN_HOLIDAYS_2016_2023 = frozenset(
    date.fromisoformat(value)
    for value in (
        "2016-01-01", "2016-02-08", "2016-02-09", "2016-02-10", "2016-02-11", "2016-02-12",
        "2016-04-18", "2016-05-02", "2016-05-03", "2016-09-02",
        "2017-01-02", "2017-01-26", "2017-01-27", "2017-01-30", "2017-01-31", "2017-02-01",
        "2017-04-06", "2017-05-01", "2017-05-02", "2017-09-04",
        "2018-01-01", "2018-02-14", "2018-02-15", "2018-02-16", "2018-02-19", "2018-02-20",
        "2018-04-25", "2018-04-30", "2018-05-01", "2018-09-03", "2018-12-31",
        "2019-01-01", "2019-02-04", "2019-02-05", "2019-02-06", "2019-02-07", "2019-02-08",
        "2019-04-15", "2019-04-29", "2019-04-30", "2019-05-01", "2019-09-02",
        "2020-01-01", "2020-01-23", "2020-01-24", "2020-01-27", "2020-01-28", "2020-01-29",
        "2020-04-02", "2020-04-30", "2020-05-01", "2020-09-02",
        "2021-01-01", "2021-02-10", "2021-02-11", "2021-02-12", "2021-02-15", "2021-02-16",
        "2021-04-21", "2021-04-30", "2021-05-03", "2021-09-02", "2021-09-03",
        "2022-01-03", "2022-01-31", "2022-02-01", "2022-02-02", "2022-02-03", "2022-02-04",
        "2022-04-11", "2022-05-02", "2022-05-03", "2022-09-01", "2022-09-02",
        "2023-01-02", "2023-01-20", "2023-01-23", "2023-01-24", "2023-01-25", "2023-01-26",
        "2023-05-01", "2023-05-02", "2023-05-03", "2023-09-01", "2023-09-04",
    )
)
```

Set the new version and certified boundary, combine the historical and existing closure sets, and retain the strict future boundary at `2026-12-31`.

- [ ] **Step 4: Remove the historical provider clamps that contradict the verified boundary**

Use `HOSE_VERIFIED_FROM` for all Vietnam equity/index provider starts. Remove the `end - 8 * 365 days` VNINDEX clamp. Keep provider retries, maximum rows, sanitization, source codes, and closed-bar filtering unchanged.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 6: Run a no-write live capability smoke for the first and last core symbols**

```powershell
python quant-worker/ingest_market_data.py all --asset VNINDEX --timeframe 1d --dry-run --env-file .env.local
python quant-worker/ingest_market_data.py all --asset VIC --timeframe 1d --dry-run --env-file .env.local
```

Expected: each exits `0`, returns a nonzero fetched row count, and contains no response body, credential, or fixture marker. If VNINDEX cannot return 2016 from KBS, stop before publication and record `provider_unavailable`; do not shorten the requested range silently.

- [ ] **Step 7: Commit the historical boundary**

```powershell
git add -- quant-worker/backtest/market_calendar.py quant-worker/backtest/ingestion.py quant-worker/backtest/providers.py quant-worker/tests/test_market_calendar.py quant-worker/tests/test_ingestion.py quant-worker/tests/test_providers.py
git commit -m "feat: certify HOSE daily history from 2016"
```

---

### Task 3: Add a read-only profile verifier and production evidence contract

**Files:**

- Create: `quant-worker/verify_market_backfill.py`
- Create: `quant-worker/tests/test_verify_market_backfill.py`
- Modify: `quant-worker/backtest/market_calendar.py`

**Interfaces:**

- Produces: `load_profile_coverage(connection, profile) -> tuple[ProfileCoverageRow, ...]`.
- Produces: `verify_profile_coverage(rows, profile, now) -> tuple[str, ...]` with stable failure codes.
- Produces: CLI `python quant-worker/verify_market_backfill.py --profile vn-core-2016 --env-file <path>`.
- Consumes: `resolve_backfill_profile`, market-date conversion, active `1d/raw` dataset versions, quality status, missing-bar count, and provider lineage.

- [ ] **Step 1: Write failing verifier behavior tests**

Use complete literal rows for all nine symbols and assert a successful summary contains exactly:

```python
{
    "status": "succeeded",
    "profile": "vn-core-2016",
    "selected": 9,
    "ready": 9,
    "failed": 0,
}
```

Add separate cases for:

- a missing symbol -> `DATASET_MISSING`;
- market-date coverage beginning after `2016-01-04` -> `HISTORY_START_INSUFFICIENT`;
- `quality_status` outside `passed`/`warning` -> `QUALITY_BLOCKED`;
- nonzero unclassified missing bars -> `MISSING_BARS_UNCLASSIFIED`;
- stale coverage end relative to the latest closed HOSE session -> `HISTORY_END_STALE`;
- provider outside `vnstock-vci-free`/`vnstock-kbs-free` -> `PROVIDER_NOT_APPROVED`.

The tests assert verifier results, not SQL text or mocks.

- [ ] **Step 2: Run the verifier tests and verify RED**

```powershell
npm run test:python -- quant-worker/tests/test_verify_market_backfill.py -q
```

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement the read-only verifier**

Query active `1d/raw` versions for only the profile symbols, joining `assets`, `datasets`, `dataset_versions`, and `data_providers`. Convert coverage timestamps to Vietnam market dates before comparing boundaries. Emit one sanitized JSON line per symbol and one summary line; never print the database URL, SQL exception body, or provider response.

Return exit `0` only when all nine symbols are ready, exit `2` for bounded coverage/quality failures, and exit `1` for invalid configuration.

- [ ] **Step 4: Run verifier and adjacent quality tests**

```powershell
npm run test:python -- quant-worker/tests/test_verify_market_backfill.py quant-worker/tests/test_market_data_quality_report.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit the verifier**

```powershell
git add -- quant-worker/verify_market_backfill.py quant-worker/tests/test_verify_market_backfill.py quant-worker/backtest/market_calendar.py
git commit -m "feat: verify bounded HOSE backfill coverage"
```

---

### Task 4: Wire a bounded production one-shot without changing the daily timer

**Files:**

- Modify: `deploy/linux/run-scheduled-job.sh`
- Modify: `deploy/linux/deploy-datavest.sh`
- Modify: `.github/workflows/build-production-artifact.yml`
- Modify: `scripts/release/deployment-config-contract.test.mjs`
- Modify: `scripts/release/deploy-contract.test.mjs`
- Modify: `scripts/release/workflow-contract.test.mjs`

**Interfaces:**

- Produces: allowlisted job `market-backfill-core`.
- Produces command 1: `ingest_market_data.py all --profile vn-core-2016 --env-file /opt/datavest/shared/.env`.
- Produces command 2: `verify_market_backfill.py --profile vn-core-2016 --env-file /opt/datavest/shared/.env`.
- Consumes: existing `datavest-job@.service`, `datavest-heavy-jobs.lock`, production Python venv, and post-release deployment path.

- [ ] **Step 1: Write failing executable deployment-contract tests**

Extend the scheduled runner test to execute `--list` and `--print-command market-backfill-core`, expecting the two exact commands above. Extend the deploy fixture to assert the release installs the updated scheduled runner and job template before `systemctl daemon-reload`.

Extend the workflow contract to require a deployment timeout of `60` minutes, because the existing `20` minute limit is shorter than the bounded systemd job's `45` minute timeout.

- [ ] **Step 2: Run deployment contract tests and verify RED**

```powershell
npx vitest run scripts/release/deployment-config-contract.test.mjs scripts/release/deploy-contract.test.mjs scripts/release/workflow-contract.test.mjs
```

Expected: FAIL because the job is absent, runner installation is absent, and timeout remains `20`.

- [ ] **Step 3: Add the allowlisted one-shot command**

Add `market-backfill-core` to `list_jobs`. In its case branch, set `command` to the profile ingestion command and `command_2` to the read-only verifier. It automatically inherits the shared nonblocking `flock` and systemd memory/timeout limits.

- [ ] **Step 4: Install and invoke the one-shot after a healthy release**

During deploy, install the release's `run-scheduled-job.sh` at `/usr/local/libexec/datavest/run-scheduled-job` and the job template at `/etc/systemd/system/datavest-job@.service`, then reload systemd.

After application health succeeds and the release rollback trap has been disabled, start `datavest-job@market-backfill-core.service` synchronously. Capture its exit code. A backfill failure must return nonzero to the workflow while leaving the healthy release and previous active datasets in place; it must not re-enter application rollback.

- [ ] **Step 5: Increase only the manual deploy-job timeout**

Change `jobs.deploy.timeout-minutes` from `20` to `60`. Keep build triggers, permissions, SSH host-key pinning, artifact verification, and production secret boundaries unchanged.

- [ ] **Step 6: Run deployment contracts and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 7: Commit production wiring**

```powershell
git add -- deploy/linux/run-scheduled-job.sh deploy/linux/deploy-datavest.sh .github/workflows/build-production-artifact.yml scripts/release/deployment-config-contract.test.mjs scripts/release/deploy-contract.test.mjs scripts/release/workflow-contract.test.mjs
git commit -m "ops: run bounded HOSE core backfill in production"
```

---

### Task 5: Document future selected-symbol and full-HOSE expansion

**Files:**

- Create: `docs/operations/hose-backfill-runbook.md`
- Modify: `README.md`
- Modify: `quant-worker/README.md`

**Interfaces:**

- Documents the current profile command, production verifier, dynamic catalog queue, retry, batch caps, and stop conditions.
- Reuses: `sync_provider_instruments.py --queue-ingestion all`, `process_ingestion_requests.py --limit 20 --drain --max-total <N>`, and `verify_market_backfill.py`.

- [ ] **Step 1: Write the exact operational runbook**

Document these current core commands:

```powershell
python quant-worker/ingest_market_data.py all --profile vn-core-2016 --dry-run --env-file .env.local
python quant-worker/ingest_market_data.py all --profile vn-core-2016 --env-file .env.local
python quant-worker/verify_market_backfill.py --profile vn-core-2016 --env-file .env.local
```

Document future full-HOSE expansion as bounded, explicit operations:

```powershell
python quant-worker/sync_provider_instruments.py --queue-ingestion all --env-file .env.local
python quant-worker/process_ingestion_requests.py --limit 20 --drain --max-total 100 --env-file .env.local
python quant-worker/process_ingestion_requests.py --retry-failed --retry-limit 100 --limit 20 --drain --max-total 100 --env-file .env.local
```

State that operators increase `--max-total` only after checking provider failures, disk, memory, missing bars, and active dataset coverage. State that full-HOSE runs are not part of this release.

- [ ] **Step 2: Update the README statements to match actual behavior**

Replace the previous contradictory “target ten years” wording with the exact certified start `2016-01-01`, profile command, and incremental-overlap explanation. Retain research-only licensing and provider failure behavior.

- [ ] **Step 3: Run formatting and link/source checks**

```powershell
npx prettier --check README.md
git diff --check
rg -n "2016-01-01|vn-core-2016|all-active|queue-ingestion all" README.md quant-worker/README.md docs/operations/hose-backfill-runbook.md
```

Expected: formatting and diff checks pass; all operational claims point to implemented commands.

- [ ] **Step 4: Commit the runbook**

```powershell
git add -- README.md quant-worker/README.md docs/operations/hose-backfill-runbook.md
git commit -m "docs: record reusable HOSE backfill operations"
```

---

### Task 6: Verify, release, run production backfill, and record database truth

**Files:**

- Create: `docs/verification/2026-08-17-hose-core-2016-production-backfill.md`

**Interfaces:**

- Consumes: all implementation tasks, the production workflow, production PostgreSQL, public health endpoints, and the quant engine.
- Produces: sanitized production coverage evidence for all nine symbols and the final deployed SHA.

- [ ] **Step 1: Run the complete local verification matrix**

```powershell
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:python
npm run build
git diff --check
git status --short
```

Expected: every command exits `0`; only separately identified pre-existing warnings may remain.

- [ ] **Step 2: Review the exact release diff and commit any final verification documentation changes**

```powershell
git diff --stat a0cbce6..HEAD
git log --oneline a0cbce6..HEAD
git status --short
```

Require a clean worktree and no unrelated file changes.

- [ ] **Step 3: Push `main` and dispatch the production workflow for the pushed SHA**

```powershell
git push origin main
git rev-parse HEAD
git rev-parse origin/main
```

Dispatch `.github/workflows/build-production-artifact.yml` on `main`. Require successful build gates, checksum verification, deployment health, and `market-backfill-core` execution. Record build success, deploy success, and backfill success separately.

- [ ] **Step 4: Verify public application and active release independently**

Require HTTP `200` from:

```text
https://datavest.vn/
https://datavest.vn/api/health/ready
```

Verify the readiness release SHA equals pushed `origin/main`; HTTP success alone is not deployment identity proof.

- [ ] **Step 5: Capture production database coverage for all nine symbols**

Run `verify_market_backfill.py --profile vn-core-2016` inside the production job environment and record, for each symbol:

- provider code;
- coverage start/end as HOSE market dates;
- row count;
- missing-bar count and classifications;
- quality status;
- active raw version ID;
- available adjusted policy status.

Require all nine raw datasets ready. If any provider cannot supply the 2016 boundary, stop with the actual stable error code and keep its prior active version; do not report partial coverage as success.

- [ ] **Step 6: Run a representative production backtest through the normal engine**

Run an authenticated/read-only moving-average backtest for `VNINDEX` over a range beginning in 2016. Require a completed run whose dataset version matches the newly verified active raw version. Do not use a fixture or direct Python-only calculation as the product proof.

- [ ] **Step 7: Write and commit sanitized production evidence**

Record exact commands, exit codes, workflow/run identity, pushed and deployed SHA, per-symbol coverage, quality results, backtest run ID/status, service state, HTTP results, and any unavailable adjusted datasets. Do not record credentials, provider bodies, or database connection strings.

```powershell
git add -- docs/verification/2026-08-17-hose-core-2016-production-backfill.md
git commit -m "docs: record HOSE core production backfill evidence"
git push origin main
```

The evidence-only push may build a new artifact. Do not claim the evidence commit is deployed unless the production release SHA is separately advanced and verified.

---

## Plan Self-review

- Spec coverage: exact nine symbols, `2016-01-01`, immutable publication, fail-closed adjustments, production execution, daily increments, and future HOSE expansion each map to a task.
- Placeholder scan: no `TBD`, deferred implementation, or unspecified error-handling step remains.
- Type consistency: `BackfillProfile`, `resolve_backfill_profile`, CLI profile name, verifier profile name, and systemd job name are identical across tasks.
- Scope: no full-HOSE run, intraday data, U.S. equities, admin UI, or new provider is included.
