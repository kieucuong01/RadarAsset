# Architecture Documentation Cleanup Design

**Status:** Approved

## Goal

Create one current architecture map that explains how the product runs and where each domain is
owned, then remove completed or superseded implementation plans and specifications from the active
documentation tree. Git history remains the archive.

## Canonical documentation set

`docs/architecture.md` becomes the sole architecture source of truth. It must describe the current
repository rather than intended future work and include:

- system context and runtime topology;
- frontend, API, persistence, worker, and scheduler boundaries;
- domain ownership for authentication and tenancy, market data, portfolio, quant/backtesting,
  strategies and forward testing, and Smart Insights;
- the main data flows from provider ingestion through immutable dataset publication and from user
  configuration through optimizer/backtest execution and portfolio monitoring;
- database model groups and tenant-boundary rules;
- deployment/runtime processes, environment boundaries, and verification commands;
- a path-oriented change guide that points maintainers to the correct modules.

Diagrams use Mermaid in Markdown. The document links to source directories and operational docs but
does not duplicate detailed runbooks, command catalogs, or historical delivery narratives.

`docs/README.md` becomes the documentation index. It identifies the architecture map, live runbooks,
QA evidence, verification reports, and any implementation plan that remains active.

## Retention policy

Files under `docs/superpowers/plans` and `docs/superpowers/specs` are temporary delivery artifacts,
not permanent product documentation.

Delete a plan or specification when all of the following are true:

1. Its feature is present in the current source tree or a newer document supersedes it.
2. It contains no operational procedure that is absent from README or a retained runbook.
3. It contains no open requirement that is still intentionally scheduled.

Retain a plan or specification when at least one of the following is true:

- its implementation is not present on `main`;
- an associated unmerged worktree or branch still represents active work;
- it defines an approved but unfinished product or data milestone;
- deleting it would remove the only current statement of a required behavior.

Retained plans/specifications must be listed in `docs/README.md` with a short reason and one of:
`Active`, `Blocked`, or `Planned`. Do not retain completed files merely for history.

Operational runbooks, QA records, provider smoke evidence, and verification reports are outside the
cleanup target and remain in place unless a link audit proves them invalid.

## Audit method

Classify every plan/spec using current source paths, migrations, tests, Git history, and registered
worktrees. Filename date alone is not evidence. For each retained file, record the reason in the
documentation index. For each deleted file, rely on Git history rather than creating an archive
folder.

Before deletion, extract any durable architectural rule into `docs/architecture.md` and any durable
operator instruction into the appropriate runbook or README. This prevents deletion from removing
the only useful description of a current boundary.

## Safety and scope

- Do not change runtime code, database schema, dependencies, or generated Graphify output.
- Preserve unrelated dirty files in the main worktree.
- Remove files only from `docs/superpowers/plans` and `docs/superpowers/specs` after classification.
- Do not remove `docs/operations`, `docs/qa`, `docs/verification`, or `docs/smart-insights` evidence.
- Validate all relative Markdown links in retained documentation.

## Verification

The documentation batch is complete when:

- `docs/architecture.md` maps every current runtime and domain boundary to real source paths;
- `docs/README.md` lists every retained document and no deleted document;
- every remaining plan/spec has an explicit non-completed status and retention reason;
- no retained Markdown link points to a missing local file;
- `git diff --check` is clean;
- runtime source and dependency manifests are unchanged.
