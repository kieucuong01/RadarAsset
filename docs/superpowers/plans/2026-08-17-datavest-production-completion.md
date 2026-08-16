# DataVest Production Completion Implementation Plan

> **For Codex:** Execute this plan inline with red-green tests and production verification checkpoints.

**Goal:** Close the remaining DataVest production gaps by restoring S3-backed Smart Insights publication, preventing anonymous visitors from calling tenant-only APIs, proving the configured DeepSeek path, and enabling only schedules that pass live production smoke tests.

**Architecture:** Keep immutable raw evidence in the private S3 bucket and validate both local and S3 locator shapes at the repository boundary. Treat the public homepage as a guest-safe sample surface until authentication exists, while preserving the authenticated quantitative workspace. Keep external collectors fail-closed: a provider that no longer exposes usable public values stays unavailable and its dedicated timer stays disabled.

**Tech Stack:** Python 3.12, pytest, Next.js 16, React 19, Better Auth, Vitest, Playwright, PostgreSQL, S3-compatible object storage, systemd, GitHub Actions.

---

## Task 1: Accept integrity-checked S3 artifact locators

**Files:**
- Modify: `quant-worker/smart_insights/repository.py`
- Test: `quant-worker/tests/test_smart_insights_repository_artifacts.py`

- [ ] Add failing tests for a valid local locator, a valid `s3://bucket/prefix/...` locator, and mismatched source/date/hash locators.
- [ ] Run the focused pytest file and confirm the S3 case fails for the current implementation.
- [ ] Implement strict locator-tail validation without weakening content hash or byte-count checks.
- [ ] Re-run focused repository, artifact-store, and event-repository tests.

## Task 2: Stop anonymous tenant-only API traffic

**Files:**
- Modify: `src/components/AccountMenu.tsx`
- Modify: `src/components/NotificationCenter.tsx`
- Modify: `src/components/SmartInsights.tsx`
- Modify: `src/components/smart-insights/LegacyMarketPulse.tsx`
- Test: `e2e/smart-insights-guest.spec.ts`

- [ ] Add an anonymous-browser regression test that records API responses and requires zero tenant-only requests and zero 4xx/5xx responses from the homepage.
- [ ] Run the test against the current implementation and confirm it fails with the existing 401/409 traffic.
- [ ] Mount organization and notification data hooks only after an authenticated session exists.
- [ ] Gate tenant-only Smart Insights effects and mutation callbacks on authentication; retain clearly labelled illustrative guest content.
- [ ] Re-run the guest test on desktop and mobile.

## Task 3: Prove AI and collector behavior on production inputs

**Files:**
- Modify only if needed after a failing contract test: `quant-worker/smart_insights/openai_responses.py`
- Test only if needed: `quant-worker/tests/test_smart_insights_openai_responses.py`
- Update: `docs/verification/2026-08-17-datavest-production-release.md`

- [ ] Run a bounded, non-persisting DeepSeek synthesis smoke through the production configuration without printing secrets.
- [ ] Run live collector smokes for BIS, CoinShares, CFTC, CryptoCraft, and the configured daily group.
- [ ] Record successful sources separately from external unavailable/schema-drift sources; do not fabricate values or bypass access gates.

## Task 4: Verify, release, and schedule

**Files:**
- Update: `docs/verification/2026-08-17-datavest-production-release.md`

- [ ] Run formatting, lint, typecheck, focused tests, the complete test suites, and the production build.
- [ ] Commit only the intended files, push `main`, and verify the GitHub build artifact for the pushed SHA.
- [ ] Deploy the exact pushed artifact through the restricted deploy account.
- [ ] Verify active SHA, three services, readiness, canonical/robots/sitemap/www redirect, anonymous desktop/mobile browser behavior, S3 artifact publication, and disk retention.
- [ ] Enable only timers whose live jobs exit successfully; leave dedicated failing-provider timers disabled with evidence.
- [ ] Remove exact temporary diagnostic files from local ignored output and VPS spool/incoming locations.

## Task 5: Complete GitHub automated deployment setup

**Files:**
- No repository changes expected unless live workflow evidence reveals a contract issue.

- [ ] Confirm GitHub authentication and the protected `production` environment state.
- [ ] Immediately before entering the SSH private key, request explicit confirmation for that sensitive external transmission.
- [ ] Configure the five deployment connection secrets and run a manual `workflow_dispatch` deployment.
- [ ] Verify the workflow-deployed SHA independently on the VPS and over public HTTPS.
