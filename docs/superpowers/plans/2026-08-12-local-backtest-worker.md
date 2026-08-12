# Local Backtest Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make locally submitted backtests progress automatically instead of remaining queued when only the Next.js development server is running.

**Architecture:** Keep backtest execution in the existing Python worker. Add a small polling loop with an explicit one-shot mode, and make the local development command supervise both Next.js on port 3100 and the worker without moving compute into the web process.

**Tech Stack:** Python 3.12, psycopg, pytest, Node.js 24, Next.js 16, PowerShell.

## Global Constraints

- Keep the web server on `http://localhost:3100`.
- Preserve the existing `run_once()` boundary for deterministic tests and manual use.
- Do not change the database schema or backtest engine behavior.
- Do not stage unrelated dirty files.

---

### Task 1: Continuous worker mode

**Files:**

- Modify: `quant-worker/worker.py`
- Test: `quant-worker/tests/test_worker.py`

**Interfaces:**

- Consumes: existing `run_once() -> dict[str, Any]`.
- Produces: `run_forever(poll_seconds: float = 2.0) -> None` and CLI flag `--once`.

- [ ] **Step 1: Write failing polling-loop tests**

Add tests proving that idle cycles wait before polling again and `--once` invokes exactly one run.

- [ ] **Step 2: Run focused pytest and verify RED**

Run: `python -m pytest tests/test_worker.py -q` from `quant-worker`.

- [ ] **Step 3: Implement the minimal loop and CLI parsing**

Default execution polls continuously. `--once` retains the old one-run behavior. Handle `KeyboardInterrupt` cleanly and reject non-positive poll intervals.

- [ ] **Step 4: Run focused pytest and verify GREEN**

Run: `python -m pytest tests/test_worker.py -q` from `quant-worker`.

### Task 2: One-command local startup

**Files:**

- Create: `scripts/dev-local.mjs`
- Modify: `package.json`
- Test: `scripts/dev-local.test.mjs`

**Interfaces:**

- Consumes: Node executable, Next CLI, `.venv/Scripts/python.exe` or configured `PYTHON_EXECUTABLE`.
- Produces: `npm run dev` supervising web and `quant-worker/worker.py`; `npm run dev:web` for web-only diagnostics.

- [ ] **Step 1: Write failing command-construction tests**

Test exact port 3100, worker path, environment inheritance, and shutdown propagation without spawning long-lived child processes.

- [ ] **Step 2: Run Node test and verify RED**

Run: `node --test scripts/dev-local.test.mjs`.

- [ ] **Step 3: Implement the minimal supervisor**

Start both children, forward output, terminate the sibling when either child exits unexpectedly, and return a non-zero exit code for failures.

- [ ] **Step 4: Run Node test and verify GREEN**

Run: `node --test scripts/dev-local.test.mjs`.

### Task 3: Runtime verification

**Files:**

- Modify: `quant-worker/README.md`

- [ ] **Step 1: Document continuous and one-shot commands**

Document `npm run dev`, `python quant-worker/worker.py`, and `python quant-worker/worker.py --once`.

- [ ] **Step 2: Run focused Python and Node tests**

Run both commands from Tasks 1 and 2 and confirm zero failures.

- [ ] **Step 3: Restart local runtime**

Stop only the current listeners/processes belonging to this worktree, then start the combined local command on port 3100.

- [ ] **Step 4: Verify the reported run and a fresh queue item**

Confirm run `a34d95e5-5ed3-4971-a123-4f49ba4a6a15` is `succeeded`, has aggregate and leg artifacts, and the UI/API can load the completed response.
