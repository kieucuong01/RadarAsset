# Architecture Documentation Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one source-backed architecture map and remove completed or superseded delivery plans/specifications from the active documentation tree.

**Architecture:** `docs/architecture.md` owns current system boundaries and flows; `docs/README.md` indexes all retained documentation. Git history replaces a documentation archive. Only the BTC/XAU event-impact plan and the currently active Smart Insights asset-opinion modal plan/spec remain under `docs/superpowers` after this batch.

**Tech Stack:** Markdown, Mermaid, Git, PowerShell, current Next.js/Prisma/Python source tree.

## Global Constraints

- Do not change runtime code, schema, dependencies, generated Graphify output, runbooks, QA evidence, or verification evidence.
- Preserve unrelated dirty Smart Insights work in the main worktree.
- Every architectural statement must point to a current source path.
- Delete obsolete delivery documents instead of creating an archive directory.
- Retain `docs/superpowers/plans/2026-08-14-btc-xau-event-impact.md` as `Planned`.
- Retain the Smart Insights asset-opinion modal plan/spec as `Active` until its dirty main-worktree implementation is committed.
- Delete this cleanup plan/spec from the final tree after they have served their purpose; their commits remain in Git history.

---

### Task 1: Build the canonical architecture map

**Files:**

- Create: `docs/architecture.md`

**Interfaces:**

- Consumes: current `src/app`, `src/lib/backend`, `src/lib/backtest`, `prisma/schema.prisma`, `quant-worker`, `scripts`, and `deploy` boundaries.
- Produces: one current architecture source for maintainers.

- [ ] **Step 1: Map runtime processes and trust boundaries**

Document the browser/Next.js process, PostgreSQL/Prisma persistence, Python quant service/worker, ingestion schedulers, and Smart Insights collectors. Include a Mermaid system-context diagram.

- [ ] **Step 2: Map domain ownership**

Create a table for Auth/Tenant, Market Data, Portfolio, Quant/Backtest, Strategy/Forward Testing, and Smart Insights. Each row names UI, API, backend/repository, worker, and persistence paths.

- [ ] **Step 3: Map critical data flows**

Add Mermaid flows for market ingestion/publication, optimizer/backtest execution, forward testing/transaction review, and Smart Insights evidence/scoring.

- [ ] **Step 4: Add operational and change guides**

Document runtime commands, environment boundaries, verification layers, and a “where to change” table without duplicating runbook details.

- [ ] **Step 5: Verify every referenced local path exists**

Run a PowerShell path extraction/check over Markdown links and inline repository paths. Expected: zero missing current-source paths.

- [ ] **Step 6: Commit**

```powershell
git add docs/architecture.md
git commit -m "docs: add canonical architecture map"
```

### Task 2: Create the documentation index and mark retained delivery docs

**Files:**

- Create: `docs/README.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-14-btc-xau-event-impact.md`
- Modify: `docs/superpowers/plans/2026-08-16-smart-insights-asset-opinion-modal-consumer-ui.md`
- Modify: `docs/superpowers/specs/2026-08-16-smart-insights-asset-opinion-modal-consumer-ui-design.md`

**Interfaces:**

- Consumes: the canonical architecture map and retained operations/evidence documents.
- Produces: a short entry point and explicit `Planned`/`Active` retention reasons.

- [ ] **Step 1: Add the docs index**

List architecture, operations, QA, verification, Smart Insights evidence, and the three retained delivery artifacts. State that completed plans/specs live only in Git history.

- [ ] **Step 2: Add explicit statuses**

Mark BTC/XAU event impact `Status: Planned`. Mark both asset-opinion modal documents `Status: Active` and explain that the main worktree implementation is currently uncommitted.

- [ ] **Step 3: Link the root README to the docs index and architecture map**

Add a compact Documentation section; do not duplicate architecture content.

- [ ] **Step 4: Verify formatting and links**

Run Prettier on the five Markdown files and validate every relative link from `README.md` and `docs/README.md`.

- [ ] **Step 5: Commit**

```powershell
git add README.md docs/README.md docs/superpowers/plans/2026-08-14-btc-xau-event-impact.md docs/superpowers/plans/2026-08-16-smart-insights-asset-opinion-modal-consumer-ui.md docs/superpowers/specs/2026-08-16-smart-insights-asset-opinion-modal-consumer-ui-design.md
git commit -m "docs: define active documentation index"
```

### Task 3: Remove obsolete delivery artifacts

**Files:**

- Delete: every `docs/superpowers/plans/*.md` except the two retained plans.
- Delete: every `docs/superpowers/specs/*.md` except the retained asset-opinion modal spec.

**Interfaces:**

- Consumes: the explicit retention allowlist in Task 2.
- Produces: an active documentation tree without completed delivery narratives.

- [ ] **Step 1: Resolve and preview exact deletion targets**

Require every target to resolve under `docs/superpowers/plans` or `docs/superpowers/specs`; print the count and names before deletion.

- [ ] **Step 2: Delete only the previewed files with `apply_patch`**

Do not remove either directory and do not touch the three retained files.

- [ ] **Step 3: Verify the allowlist**

Expected final files under `docs/superpowers`:

```text
plans/2026-08-14-btc-xau-event-impact.md
plans/2026-08-16-smart-insights-asset-opinion-modal-consumer-ui.md
specs/2026-08-16-smart-insights-asset-opinion-modal-consumer-ui-design.md
```

- [ ] **Step 4: Search retained documentation for deleted links**

Run `rg` across `README.md` and `docs/**/*.md` for every deleted basename. Expected: zero references outside Git history.

- [ ] **Step 5: Commit**

```powershell
git add -A docs/superpowers
git commit -m "docs: remove obsolete delivery plans"
```

### Task 4: Verify and integrate

**Files:**

- No runtime files.

**Interfaces:**

- Consumes: final documentation tree.
- Produces: verified local-main merge and restarted local application.

- [ ] **Step 1: Validate Markdown paths, Mermaid fences, and Git whitespace**

Expected: zero missing links, balanced Mermaid fences, and clean `git diff --check`.

- [ ] **Step 2: Prove runtime manifests and source are unchanged**

Compare the branch against its base and require changes only in `README.md` and `docs/**`.

- [ ] **Step 3: Run repository checks**

Run `npm run check` in the isolated worktree. Expected: lint, formatting, TypeScript, Vitest, and Python success.

- [ ] **Step 4: Merge locally into `main` without overwriting unrelated dirty files**

Merge only if Git can preserve the dirty Smart Insights paths. Abort and report if any overlap appears.

- [ ] **Step 5: Run `npm run build`, restart `npm run dev:web`, and verify `/quant-lab`**

Expected: production build exit `0`, listener on port `3100`, and HTTP page or authenticated redirect.
