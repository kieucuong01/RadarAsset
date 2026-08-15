# Codebase Simplification Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove proven-dead UI code and exclusive dependencies, then make lint, formatting, TypeScript, Vitest, and Python tests reliably runnable from the repository root.

**Architecture:** Keep the current Next.js, Prisma, PostgreSQL, and Python-worker boundaries unchanged. This phase deletes only source files with no production consumer and replaces custom tooling with thin wrappers around the framework's native configurations. Backend, worker, UI-screen, and localization modularization are separate follow-up plans created after this baseline is green.

**Tech Stack:** Next.js 16.2.9, React 19, TypeScript 5.8, ESLint 9 flat config, Prettier 3, Vitest 4, Python/pytest, npm/package-lock.

## Global Constraints

- Preserve all API contracts, database behavior, tenant isolation, backtest results, and visible UI.
- Do not add a framework, component library, package manager, task runner, or Python environment manager.
- Do not change Prisma schema, migrations, financial calculations, ingestion, strategies, or Smart Insights behavior.
- Do not delete a file until source search proves it has no production consumer.
- Keep formatting separate from linting.
- All verification commands must run from the repository root.
- Commit each task separately; do not combine deletion, dependency, and tooling changes.
- Generated Graphify, Next.js, pytest, cache, local-data, and virtual-environment artifacts remain untracked.

---

## File map

**Delete in Tasks 1-2:**

- `src/components/smart-insights/LegacyWatchlist.tsx`
- `src/components/smart-insights/LegacyInvestorIntelligence.tsx`
- `src/components/smart-insights/LegacyExpertSignals.tsx`
- `src/components/smart-insights/LegacyAIDigest.tsx`
- the 21 unreferenced files listed in Task 2 under `src/components/ui/`

**Modify in Tasks 3-5:**

- `package.json`: remove unused packages and expose canonical root commands
- `package-lock.json`: npm-generated dependency lock changes
- `eslint.config.js`: use the official Next.js flat configuration
- `.prettierignore`: exclude local and generated artifacts
- `pyproject.toml`: declare pytest import path and test discovery
- `scripts/run-python-tests.mjs`: choose the existing project Python and execute pytest
- `scripts/run-python-tests.test.mjs`: verify command construction without launching pytest
- `quant-worker/tests/test_smart_insights_foundation.py`: resolve repository files independently of cwd
- `README.md`: document the one-command verification entry point

## Interfaces

- `resolvePythonExecutable(repoRoot, env, exists)` remains owned by `scripts/dev-local.mjs`.
- `runPythonTests({ repoRoot, args, env, spawn }) -> number` is introduced in Task 5 and returns the child exit code.
- `npm run check` is the final developer-facing interface and runs every non-database local gate.

---

### Task 1: Remove obsolete Smart Insights prototype components

**Files:**

- Delete: `src/components/smart-insights/LegacyWatchlist.tsx`
- Delete: `src/components/smart-insights/LegacyInvestorIntelligence.tsx`
- Delete: `src/components/smart-insights/LegacyExpertSignals.tsx`
- Delete: `src/components/smart-insights/LegacyAIDigest.tsx`
- Test: `src/components/smart-insights/source-guard.test.ts`

**Interfaces:**

- Consumes: current `SmartInsights.tsx` production imports.
- Produces: no new interface; removes four unreferenced prototype modules and their hard-coded samples.

- [ ] **Step 1: Prove the four files have no production consumer**

Run:

```powershell
rg -n "LegacyWatchlist|LegacyInvestorIntelligence|LegacyExpertSignals|LegacyAIDigest" src --glob "!src/components/smart-insights/Legacy*.tsx" --glob "!**/*.test.*"
```

Expected: no imports or rendered JSX. If a production hit exists, stop and remove that file from this task rather than changing the consumer.

- [ ] **Step 2: Run the existing source guard before deletion**

Run:

```powershell
npx vitest run src/components/smart-insights/source-guard.test.ts
```

Expected: PASS, confirming the production Smart Insights screen does not render the obsolete panels.

- [ ] **Step 3: Delete the four files**

Run:

```powershell
git rm -- src/components/smart-insights/LegacyWatchlist.tsx src/components/smart-insights/LegacyInvestorIntelligence.tsx src/components/smart-insights/LegacyExpertSignals.tsx src/components/smart-insights/LegacyAIDigest.tsx
```

- [ ] **Step 4: Verify no production reference remains**

Run:

```powershell
rg -n "LegacyWatchlist|LegacyInvestorIntelligence|LegacyExpertSignals|LegacyAIDigest" src --glob "!**/*.test.*"
npx vitest run src/components/smart-insights/source-guard.test.ts
npx tsc --noEmit
```

Expected: the source search has no result and both commands pass.

- [ ] **Step 5: Commit**

```powershell
git add -- src/components/smart-insights
git commit -m "refactor: remove obsolete smart insights prototypes"
```

---

### Task 2: Remove unreferenced shadcn component modules

**Files:**

- Delete: `src/components/ui/aspect-ratio.tsx`
- Delete: `src/components/ui/breadcrumb.tsx`
- Delete: `src/components/ui/calendar.tsx`
- Delete: `src/components/ui/carousel.tsx`
- Delete: `src/components/ui/chart.tsx`
- Delete: `src/components/ui/checkbox.tsx`
- Delete: `src/components/ui/collapsible.tsx`
- Delete: `src/components/ui/context-menu.tsx`
- Delete: `src/components/ui/drawer.tsx`
- Delete: `src/components/ui/form.tsx`
- Delete: `src/components/ui/hover-card.tsx`
- Delete: `src/components/ui/input-otp.tsx`
- Delete: `src/components/ui/menubar.tsx`
- Delete: `src/components/ui/navigation-menu.tsx`
- Delete: `src/components/ui/pagination.tsx`
- Delete: `src/components/ui/radio-group.tsx`
- Delete: `src/components/ui/resizable.tsx`
- Delete: `src/components/ui/sidebar.tsx`
- Delete: `src/components/ui/switch.tsx`
- Delete: `src/components/ui/textarea.tsx`
- Delete: `src/components/ui/tooltip.tsx`

**Interfaces:**

- Consumes: direct imports under `@/components/ui/*`.
- Produces: no new interface; retains every UI primitive with at least one non-UI consumer.

- [ ] **Step 1: Recompute the zero-consumer list**

Run from PowerShell:

```powershell
$ui = Get-ChildItem src\components\ui -Filter *.tsx | ForEach-Object BaseName
foreach ($name in $ui) {
  $count = (rg -l -F "components/ui/$name" src --glob '!src/components/ui/**' 2>$null | Measure-Object).Count
  if ($count -eq 0) { $name }
}
```

Expected: the output contains every file listed in this task. Remove any file with a non-zero consumer from the deletion set.

- [ ] **Step 2: Delete only the verified files**

Run:

```powershell
git rm -- src/components/ui/aspect-ratio.tsx src/components/ui/breadcrumb.tsx src/components/ui/calendar.tsx src/components/ui/carousel.tsx src/components/ui/chart.tsx src/components/ui/checkbox.tsx src/components/ui/collapsible.tsx src/components/ui/context-menu.tsx src/components/ui/drawer.tsx src/components/ui/form.tsx src/components/ui/hover-card.tsx src/components/ui/input-otp.tsx src/components/ui/menubar.tsx src/components/ui/navigation-menu.tsx src/components/ui/pagination.tsx src/components/ui/radio-group.tsx src/components/ui/resizable.tsx src/components/ui/sidebar.tsx src/components/ui/switch.tsx src/components/ui/textarea.tsx src/components/ui/tooltip.tsx
```

- [ ] **Step 3: Verify TypeScript and component tests**

Run:

```powershell
npx tsc --noEmit
npx vitest run src/components
```

Expected: both commands pass with no missing-module error.

- [ ] **Step 4: Verify the surviving primitive set still has consumers**

Run the Step 1 script again.

Expected: no newly unreferenced file appears because of transitive imports from deleted UI modules. If one appears, verify it has no production consumer and include it before commit.

- [ ] **Step 5: Commit**

```powershell
git add -- src/components/ui
git commit -m "refactor: remove unused ui primitives"
```

---

### Task 3: Remove dependencies exclusive to deleted code

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: the surviving source import graph after Tasks 1-2.
- Produces: a smaller direct dependency set with an npm lock generated by the installed npm version.

- [ ] **Step 1: Prove candidate packages have no source import**

Run:

```powershell
$packages = @(
  '@hookform/resolvers', '@radix-ui/react-aspect-ratio', '@radix-ui/react-checkbox',
  '@radix-ui/react-collapsible', '@radix-ui/react-context-menu', '@radix-ui/react-hover-card',
  '@radix-ui/react-menubar', '@radix-ui/react-navigation-menu', '@radix-ui/react-radio-group',
  '@radix-ui/react-switch', '@radix-ui/react-tooltip', 'date-fns', 'echarts',
  'echarts-for-react', 'embla-carousel-react', 'input-otp', 'react-day-picker',
  'react-hook-form', 'react-resizable-panels', 'vaul'
)
foreach ($package in $packages) {
  $hits = rg -l -F $package src scripts e2e prisma 2>$null
  if ($hits) { "$package -> $($hits -join ', ')" }
}
```

Expected: no output. Keep any package that still has a source hit.

- [ ] **Step 2: Remove the verified packages with npm**

Run:

```powershell
npm uninstall @hookform/resolvers @radix-ui/react-aspect-ratio @radix-ui/react-checkbox @radix-ui/react-collapsible @radix-ui/react-context-menu @radix-ui/react-hover-card @radix-ui/react-menubar @radix-ui/react-navigation-menu @radix-ui/react-radio-group @radix-ui/react-switch @radix-ui/react-tooltip date-fns echarts echarts-for-react embla-carousel-react input-otp react-day-picker react-hook-form react-resizable-panels vaul
```

Expected: `package.json` and `package-lock.json` change; source files do not.

- [ ] **Step 3: Verify the dependency lock and compilation**

Run:

```powershell
npm ls --depth=0
npx tsc --noEmit
npm test
```

Expected: dependency tree is valid, TypeScript passes, and 443 or more Vitest tests pass.

- [ ] **Step 4: Verify the lockfile diff is scoped**

Run:

```powershell
git diff --stat -- package.json package-lock.json
git diff --check
```

Expected: package removals and their orphaned transitive lock entries only; no unrelated source change.

- [ ] **Step 5: Commit**

```powershell
git add -- package.json package-lock.json
git commit -m "chore: remove unused frontend dependencies"
```

---

### Task 4: Replace custom lint composition and separate formatting

**Files:**

- Modify: `eslint.config.js`
- Modify: `.prettierignore`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: only files reported by the new `format:check`

**Interfaces:**

- Consumes: `eslint-config-next/core-web-vitals` and `eslint-config-prettier/flat`.
- Produces: `npm run lint`, `npm run format`, `npm run format:check`, and `npm run typecheck`.

- [ ] **Step 1: Record the current lint failure**

Run:

```powershell
npx eslint src scripts e2e eslint.config.js next.config.ts playwright.config.ts prisma.config.ts vitest.config.ts vitest.integration.config.ts
```

Expected: FAIL with Prettier line-ending errors and/or `react-refresh/only-export-components` warnings. Save the counts in the commit notes.

- [ ] **Step 2: Replace `eslint.config.js` with the framework-native flat config**

Use this complete content:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextVitals,
  prettier,
  globalIgnores([
    ".next/**",
    ".npm-cache/**",
    ".venv/**",
    ".worktrees/**",
    ".local-data/**",
    ".pytest-*/**",
    "graphify-out/**",
    "node_modules/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);
```

- [ ] **Step 3: Extend `.prettierignore` for generated and local artifacts**

Keep the existing entries and add:

```text
.venv
.worktrees
.local-data
.pytest-*
graphify-out
test-results
playwright-report
quant-worker/.runtime
```

- [ ] **Step 4: Add canonical lint, format, and typecheck scripts**

Set these `package.json` script values:

```json
{
  "lint": "eslint src scripts e2e *.config.*",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 5: Remove direct lint packages no longer imported**

Run:

```powershell
npm uninstall --save-dev @eslint/js eslint-plugin-prettier eslint-plugin-react-hooks eslint-plugin-react-refresh globals typescript-eslint
```

Keep `eslint`, `eslint-config-next`, `eslint-config-prettier`, and `prettier` as direct development dependencies.

- [ ] **Step 6: Format the six files in the verified baseline drift**

Run:

```powershell
npm run format:check
npx prettier --write src/components/PortfolioBacktestBuilder.tsx src/components/StrategyLab.tsx src/lib/backend/market-data-health.test.ts src/lib/backtest/builder-state.ts src/lib/strategy-lab/legacy-migration.test.ts src/lib/strategy-lab/legacy-migration.ts
npm run format:check
```

Expected initially: FAIL on the six listed tracked files. After the targeted write, the second check passes. If a concurrent commit changes the reported set, format only the tracked files named by the first check. Do not format generated, ignored, migration, or unrelated data files.

- [ ] **Step 7: Verify lint, formatting, and TypeScript independently**

Run:

```powershell
npm run lint
npm run format:check
npm run typecheck
```

Expected: all three commands exit 0 and Next.js route metadata produces no Fast Refresh warning.

- [ ] **Step 8: Commit**

```powershell
git add -- eslint.config.js .prettierignore package.json package-lock.json
git add --update
git commit -m "chore: standardize lint and formatting checks"
```

Before committing, inspect `git diff --cached --stat` and unstage any file not reported by the formatting check or listed in this task.

---

### Task 5: Make Python tests location-independent from the repository root

**Files:**

- Create: `pyproject.toml`
- Create: `scripts/run-python-tests.mjs`
- Create: `scripts/run-python-tests.test.mjs`
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`
- Modify: `package.json`

**Interfaces:**

- Consumes: `resolvePythonExecutable(repoRoot, env, exists)` from `scripts/dev-local.mjs`.
- Produces: `runPythonTests({ repoRoot, args, env, spawn }) -> number`, `npm run test:python`, and `npm run check`.

- [ ] **Step 1: Write the Node wrapper unit test**

Create `scripts/run-python-tests.test.mjs`:

```js
import { strict as assert } from "node:assert";
import test from "node:test";
import path from "node:path";
import { runPythonTests } from "./run-python-tests.mjs";

test("runs pytest from the repository root with the resolved Python", () => {
  const calls = [];
  const exitCode = runPythonTests({
    repoRoot: "C:\\repo",
    args: ["-q"],
    env: { PYTHON_EXECUTABLE: "C:\\python\\python.exe" },
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls[0].command, "C:\\python\\python.exe");
  assert.deepEqual(calls[0].args, ["-m", "pytest", "-q"]);
  assert.equal(calls[0].options.cwd, path.resolve("C:\\repo"));
});
```

- [ ] **Step 2: Run the wrapper test to verify it fails**

Run:

```powershell
node --test scripts/run-python-tests.test.mjs
```

Expected: FAIL because `scripts/run-python-tests.mjs` does not exist.

- [ ] **Step 3: Implement the minimal Python test wrapper**

Create `scripts/run-python-tests.mjs`:

```js
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolvePythonExecutable } from "./dev-local.mjs";

export function runPythonTests({ repoRoot, args = [], env = process.env, spawn = spawnSync }) {
  const root = path.resolve(repoRoot);
  const python = resolvePythonExecutable(root, env);
  const result = spawn(python, ["-m", "pytest", ...args], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.exitCode = runPythonTests({ repoRoot, args: process.argv.slice(2) });
}
```

- [ ] **Step 4: Run the wrapper unit test**

Run:

```powershell
node --test scripts/run-python-tests.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Declare pytest discovery and import paths**

Create root `pyproject.toml`:

```toml
[tool.pytest.ini_options]
pythonpath = ["quant-worker"]
testpaths = ["quant-worker/tests"]
```

- [ ] **Step 6: Reproduce the cwd-dependent test failure from the root**

Run:

```powershell
node scripts/run-python-tests.mjs -q quant-worker/tests/test_smart_insights_foundation.py::test_four_hourly_is_a_cli_and_wrapper_schedule
```

Expected: FAIL with `FileNotFoundError` for `../scripts/run-smart-insights.ps1`.

- [ ] **Step 7: Make the test resolve the repository root from `__file__`**

In `quant-worker/tests/test_smart_insights_foundation.py`, define next to `NOW`:

```python
REPO_ROOT = Path(__file__).resolve().parents[2]
```

Replace:

```python
wrapper = Path("../scripts/run-smart-insights.ps1").read_text(encoding="utf-8")
```

with:

```python
wrapper = (REPO_ROOT / "scripts" / "run-smart-insights.ps1").read_text(
    encoding="utf-8"
)
```

- [ ] **Step 8: Add canonical Python and aggregate check scripts**

Add these `package.json` scripts:

```json
{
  "test:python": "node scripts/run-python-tests.mjs -q",
  "check": "npm run lint && npm run format:check && npm run typecheck && npm test && npm run test:python"
}
```

- [ ] **Step 9: Verify targeted and full root execution**

Run:

```powershell
node --test scripts/run-python-tests.test.mjs
node scripts/run-python-tests.mjs -q quant-worker/tests/test_smart_insights_foundation.py::test_four_hourly_is_a_cli_and_wrapper_schedule
npm run test:python
```

Expected: wrapper test passes, targeted Python test passes, and the full suite reports at least 616 passed with only intentional skips.

- [ ] **Step 10: Commit**

```powershell
git add -- pyproject.toml scripts/run-python-tests.mjs scripts/run-python-tests.test.mjs quant-worker/tests/test_smart_insights_foundation.py package.json
git commit -m "chore: run python tests from repository root"
```

---

### Task 6: Document and verify the Phase 1 developer contract

**Files:**

- Modify: `README.md`

**Interfaces:**

- Consumes: `npm run check` and `npm run build` from Tasks 4-5.
- Produces: one documented local verification workflow for future contributors.

- [ ] **Step 1: Add the verification commands to Local Setup**

Add this section after the local setup commands in `README.md`:

````markdown
### Local verification

Run every non-database code-quality gate from the repository root:

```powershell
npm run check
npm run build
```

`npm run check` runs ESLint, Prettier verification, TypeScript, Vitest, and the Python test suite.
The Python wrapper uses `PYTHON_EXECUTABLE` when set, otherwise the project `.venv` on Windows,
then falls back to `python`.
````

- [ ] **Step 2: Verify a clean install contract**

Run:

```powershell
npm ci
npm run check
npm run build
```

Expected: all commands exit 0. Record exact Vitest and Python pass/skip totals in the commit message body.

- [ ] **Step 3: Commit documentation**

Run:

```powershell
git add -- README.md
git commit -m "docs: document repository verification workflow"
```

- [ ] **Step 4: Verify deletion and dependency totals**

Run after the sixth task commit:

```powershell
git diff HEAD~6..HEAD --stat
git diff HEAD~6..HEAD -- package.json
git status --short --branch
```

Expected: at least 3,300 source lines removed, all candidate packages that had no surviving import removed, and no generated artifact tracked.

- [ ] **Step 5: Final Phase 1 review**

Inspect:

```powershell
git log --oneline -6
git status --short --branch
```

Expected: six scoped commits, a clean worktree, and no changes to Prisma schema, migrations, financial calculations, API routes, or rendered screens.

After this checkpoint, create separate implementation plans for backend/worker modularization,
frontend/i18n modularization, and documentation consolidation against the new clean baseline.
