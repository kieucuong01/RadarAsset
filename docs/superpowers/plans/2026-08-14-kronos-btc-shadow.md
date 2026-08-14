# Kronos BTC Shadow Evaluation Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run Kronos-small as an isolated, reproducible BTC-only shadow forecaster and compare it with simple baselines over anchored walk-forward out-of-sample history, without allowing forecasts to influence any investor decision output.

**Architecture:** Keep Kronos and Torch outside the base worker environment. A pinned optional runtime checkout provides the MIT-licensed upstream model code; pinned Hugging Face revisions provide model/tokenizer files. An internal adapter converts stored BTC daily OHLCV into forecast distributions. The worker stores runs in existing research/provenance tables, forecasts in `forecast_points`, evaluations in `model_evaluations`, and serves a read-only experimental view after hard isolation checks.

**Tech Stack:** Python 3.12, Torch 2.7.1, NumPy/Pandas, pytest, Prisma/PostgreSQL, Next.js 15, React 19, TypeScript, Vitest, Recharts.

**Pinned upstreams:**

- Kronos source: `https://github.com/shiyu-coder/Kronos.git` at `67b630e67f6a18c9e9be918d9b4337c960db1e9a`.
- Model: `NeoQuasar/Kronos-small` at revision `901c26c1332695a2a8f243eb2f37243a37bea320`.
- Tokenizer: `NeoQuasar/Kronos-Tokenizer-base` at revision `0e0117387f39004a9016484a186a908917e22426`.
- Kronos source license: MIT. Preserve upstream notices in the external runtime checkout.

**Isolation rule:** Kronos remains `SHADOW / EXPERIMENTAL`; its modules may be imported only by the shadow runner, forecast API loader, and forecast UI. It must not be imported by briefing, personalization, alert, portfolio, scoring, action-suggestion, or Market Pulse calculation modules.

---

## File Map

- Modify: `.gitignore`
- Create: `quant-worker/requirements-kronos.txt`
- Create: `quant-worker/third_party/kronos.lock.json`
- Create: `quant-worker/scripts/setup_kronos.ps1`
- Create: `quant-worker/smart_insights/kronos/__init__.py`
- Create: `quant-worker/smart_insights/kronos/contracts.py`
- Create: `quant-worker/smart_insights/kronos/adapter.py`
- Create: `quant-worker/smart_insights/kronos/baselines.py`
- Create: `quant-worker/smart_insights/kronos/evaluation.py`
- Create: `quant-worker/smart_insights/kronos/repository.py`
- Create: `quant-worker/run_kronos_shadow.py`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608140009_kronos_shadow/migration.sql`
- Modify: `src/lib/backend/smart-insights-types.ts`
- Modify: `src/lib/smart-insights-client.ts`
- Create: `src/lib/backend/smart-insights-forecast.ts`
- Create: `src/app/api/smart-insights/forecast/[asset]/route.ts`
- Create: `src/components/smart-insights/KronosShadowPanel.tsx`
- Modify: `src/components/smart-insights/CryptoQuantPulseTabs.tsx`
- Test: `quant-worker/tests/test_kronos_*.py`
- Test: `src/app/api/smart-insights/forecast/[asset]/route.test.ts`
- Test: `src/components/smart-insights/KronosShadowPanel.test.tsx`

### Task 1: Add a pinned optional Kronos runtime without bloating the base worker

**Files:**

- Modify: `.gitignore`
- Create: `quant-worker/requirements-kronos.txt`
- Create: `quant-worker/third_party/kronos.lock.json`
- Create: `quant-worker/scripts/setup_kronos.ps1`
- Create: `quant-worker/tests/test_kronos_runtime_lock.py`

- [ ] **Step 1: Write a failing lock/setup contract test**

Assert exact source/model/tokenizer revisions, MIT license metadata, pinned Python dependencies, runtime directory ignored by Git, and rejection of a checkout on a different commit.

```python
lock = json.loads(Path("quant-worker/third_party/kronos.lock.json").read_text())
assert lock["source"]["revision"] == "67b630e67f6a18c9e9be918d9b4337c960db1e9a"
assert lock["model"]["revision"] == "901c26c1332695a2a8f243eb2f37243a37bea320"
assert lock["tokenizer"]["revision"] == "0e0117387f39004a9016484a186a908917e22426"
```

- [ ] **Step 2: Run and confirm failure**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_kronos_runtime_lock.py -q`

- [ ] **Step 3: Add the lock manifest and optional requirements**

```json
{
  "source": {
    "url": "https://github.com/shiyu-coder/Kronos.git",
    "revision": "67b630e67f6a18c9e9be918d9b4337c960db1e9a",
    "license": "MIT"
  },
  "model": {
    "id": "NeoQuasar/Kronos-small",
    "revision": "901c26c1332695a2a8f243eb2f37243a37bea320"
  },
  "tokenizer": {
    "id": "NeoQuasar/Kronos-Tokenizer-base",
    "revision": "0e0117387f39004a9016484a186a908917e22426"
  }
}
```

`requirements-kronos.txt` pins `torch==2.7.1`, `einops==0.8.1`, `huggingface-hub==0.33.1`, and `safetensors==0.6.2`. Do not add them to `quant-worker/requirements.txt`.

- [ ] **Step 4: Implement an idempotent setup script**

The script clones into ignored `quant-worker/.runtime/kronos-source`, checks out the exact source revision in detached-head mode, installs the optional requirements into the selected environment, downloads exact Hugging Face revisions, writes a SHA-256 manifest for every downloaded file, and fails if any resolved revision differs from the lock.

Do not commit the checkout or model weights.

- [ ] **Step 5: Re-run and commit**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_kronos_runtime_lock.py -q`

```powershell
git add .gitignore quant-worker/requirements-kronos.txt quant-worker/third_party/kronos.lock.json quant-worker/scripts/setup_kronos.ps1 quant-worker/tests/test_kronos_runtime_lock.py
git commit -m "build: add pinned optional Kronos runtime"
```

### Task 2: Extend generic forecast provenance without creating a competing data model

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608140009_kronos_shadow/migration.sql`
- Create: `src/lib/backend/kronos-schema.test.ts`

- [ ] **Step 1: Write a failing schema contract test**

Test that forecast points can record target timestamp, status, methodology/model revision, input fingerprint, realized price, and evaluation time; model evaluations can link to the originating research run.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/lib/backend/kronos-schema.test.ts`

- [ ] **Step 3: Add backward-compatible fields**

```prisma
model ForecastPoint {
  // existing fields remain
  forecastFor        DateTime? @map("forecast_for") @db.Timestamptz(6)
  status             String    @default("published")
  methodologyVersion String?   @map("methodology_version")
  modelRevision      String?   @map("model_revision")
  inputFingerprint   String?   @map("input_fingerprint")
  realizedPrice      Decimal?  @map("realized_price") @db.Decimal(20, 8)
  evaluatedAt        DateTime? @map("evaluated_at") @db.Timestamptz(6)

  @@index([assetId, model, generatedAt(sort: Desc)])
}

model ModelEvaluation {
  // existing fields remain
  researchRunId      String? @map("research_run_id") @db.Uuid
  status             String  @default("shadow")
  methodologyVersion String? @map("methodology_version")
  dataFingerprint    String? @map("data_fingerprint")
  researchRun        ResearchRun? @relation(fields: [researchRunId], references: [id], onDelete: Cascade)

  @@index([researchRunId])
}
```

Add `evaluations ModelEvaluation[]` to `ResearchRun`. Preserve all existing nullable/default behavior so old forecast rows remain valid.

- [ ] **Step 4: Validate, test, and commit**

Run: `npx prisma format`
Run: `npx prisma validate`
Run: `npm test -- src/lib/backend/kronos-schema.test.ts`

```powershell
git add prisma/schema.prisma prisma/migrations/202608140009_kronos_shadow/migration.sql src/lib/backend/kronos-schema.test.ts
git commit -m "feat: add shadow forecast provenance"
```

### Task 3: Build a lazy Kronos adapter with no-lookahead inputs

**Files:**

- Create: `quant-worker/smart_insights/kronos/__init__.py`
- Create: `quant-worker/smart_insights/kronos/contracts.py`
- Create: `quant-worker/smart_insights/kronos/adapter.py`
- Create: `quant-worker/tests/test_kronos_adapter.py`

- [ ] **Step 1: Write failing adapter tests with a fake predictor**

Cover BTC-only enforcement, daily timeframe, UTC monotonic bars, no duplicates, finite positive OHLCV, input cutoff, lookback <=512, horizons 1/3/7, deterministic seed propagation, quantile ordering, and clean failure when the optional runtime is unavailable.

```python
request = build_request(bars, as_of=cutoff, horizons=(1, 3, 7), max_context=512)
assert max(point.ts for point in request.history) <= cutoff
assert len(request.history) <= 512
assert result.lower <= result.median <= result.upper
```

- [ ] **Step 2: Run and confirm failure**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_kronos_adapter.py -q`

- [ ] **Step 3: Implement internal contracts and lazy import boundary**

```python
class KronosAdapter(Protocol):
    def forecast(self, request: ForecastRequest) -> ForecastDistribution:
        raise NotImplementedError

def load_upstream_predictor(runtime: RuntimeLock, device: str) -> KronosAdapter:
    verify_source_revision(runtime)
    verify_model_file_checksums(runtime)
    # Add the verified external checkout to sys.path only inside this function.
    from model import Kronos, KronosPredictor, KronosTokenizer
    tokenizer = KronosTokenizer.from_pretrained(
        runtime.tokenizer_id, revision=runtime.tokenizer_revision, local_files_only=True
    )
    model = Kronos.from_pretrained(
        runtime.model_id, revision=runtime.model_revision, local_files_only=True
    )
    return UpstreamKronosAdapter(KronosPredictor(model, tokenizer, max_context=512))
```

Call `from_pretrained` with the exact locked revisions. Use `local_files_only=True` in the scheduled runner so production never silently downloads a changed model.

- [ ] **Step 4: Generate probabilistic paths deterministically**

Use fixed seed `20260814`, explicit temperature/top-p/sample count recorded in run parameters, and derive median/10th/90th percentiles from sampled close paths. Reject NaN, inverted intervals, and forecast timestamps inconsistent with daily UTC bars.

- [ ] **Step 5: Re-run and commit**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_kronos_adapter.py -q`

```powershell
git add quant-worker/smart_insights/kronos quant-worker/tests/test_kronos_adapter.py
git commit -m "feat: add isolated Kronos forecast adapter"
```

### Task 4: Implement point-in-time baseline forecasts

**Files:**

- Create: `quant-worker/smart_insights/kronos/baselines.py`
- Create: `quant-worker/tests/test_kronos_baselines.py`

- [ ] **Step 1: Write failing tests for four baselines**

Cover random walk, expanding historical drift, 20-day momentum, and 20-day EMA trend. Prove every baseline receives bars only through its cutoff and returns the same 1/3/7-day contract as Kronos.

- [ ] **Step 2: Run and confirm failure**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_kronos_baselines.py -q`

- [ ] **Step 3: Implement deterministic baselines**

```python
def random_walk(history: Sequence[Bar], horizon: int) -> float:
    return history[-1].close

def historical_drift(history: Sequence[Bar], horizon: int) -> float:
    mean_log_return = np.mean(np.diff(np.log([bar.close for bar in history])))
    return history[-1].close * math.exp(mean_log_return * horizon)
```

Momentum uses the mean log return of the last 20 available bars. EMA trend extrapolates the point-in-time slope of a 20-period EMA in log-price space. Never optimize parameters on the evaluation period.

- [ ] **Step 4: Re-run and commit**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_kronos_baselines.py -q`

```powershell
git add quant-worker/smart_insights/kronos/baselines.py quant-worker/tests/test_kronos_baselines.py
git commit -m "feat: add BTC forecast baselines"
```

### Task 5: Implement anchored walk-forward evaluation and hard publication gates

**Files:**

- Create: `quant-worker/smart_insights/kronos/evaluation.py`
- Create: `quant-worker/tests/test_kronos_evaluation.py`
- Create: `quant-worker/tests/test_kronos_isolation.py`

- [ ] **Step 1: Write failing no-lookahead and metric tests**

Cover anchored cutoffs, final seven-day label availability, MAE, MASE, directional accuracy, Spearman IC across forecast dates, 80% interval coverage, calibration error, point-in-time volatility regime, and minimum 180 out-of-sample forecasts.

```python
result = evaluate(history, fake_models, minimum_oos=180)
assert all(run.max_input_ts <= run.forecast_generated_at for run in result.runs)
assert result.status == "ACCUMULATING" when result.completed_forecasts < 180 else "READY_SHADOW"
```

- [ ] **Step 2: Run and confirm failure**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_kronos_evaluation.py quant-worker/tests/test_kronos_isolation.py -q`

- [ ] **Step 3: Implement evaluation v1**

Use methodology `kronos-btc-shadow-v1`. For each cutoff, the evaluator may inspect all earlier bars but passes at most the last 512 bars to Kronos. Regime classification uses only trailing 30-day realized volatility and point-in-time expanding quantiles. The public view remains `ACCUMULATING` before 180 completed forecast dates and `READY_SHADOW` afterward; neither state means production signal approval.

- [ ] **Step 4: Add a static isolation test**

Scan application imports and fail if `smart_insights.kronos` appears outside the runner/evaluation repository or if the frontend Kronos loader is imported by briefing, personalization, portfolio, signal, regime, alert, or recommendation modules.

- [ ] **Step 5: Re-run and commit**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_kronos_evaluation.py quant-worker/tests/test_kronos_isolation.py -q`

```powershell
git add quant-worker/smart_insights/kronos/evaluation.py quant-worker/tests/test_kronos_evaluation.py quant-worker/tests/test_kronos_isolation.py
git commit -m "feat: evaluate Kronos in shadow mode"
```

### Task 6: Persist reproducible runs, forecasts, failures, and evaluations

**Files:**

- Create: `quant-worker/smart_insights/kronos/repository.py`
- Create: `quant-worker/run_kronos_shadow.py`
- Create: `quant-worker/tests/test_kronos_repository.py`
- Create: `quant-worker/tests/test_kronos_runner.py`

- [ ] **Step 1: Write failing persistence/runner tests**

Test BTC-only allowlist, exact model name, one research run per cutoff/config fingerprint, idempotent forecast upsert, failed `ProviderRun` on runtime/checksum/inference errors, no forecast rows after failure, dry-run, CPU/GPU metadata, seeds, parameters, revisions, checksums, and input fingerprint.

- [ ] **Step 2: Run and confirm failure**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_kronos_repository.py quant-worker/tests/test_kronos_runner.py -q`

- [ ] **Step 3: Implement the bounded runner**

```python
parser.add_argument("--asset", choices=("BTC",), default="BTC")
parser.add_argument("--as-of", required=True)
parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
parser.add_argument("--evaluation-points", type=int, default=180)
parser.add_argument("--dry-run", action="store_true")
```

Store runtime metadata under `ResearchRun.parameters`, inference status under `ProviderRun`, each horizon distribution under `ForecastPoint`, and aggregate/rolling benchmark metrics under `ModelEvaluation.metrics`. Use one database transaction for completed outputs. Failure writes only failure provenance.

- [ ] **Step 4: Re-run and commit**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_kronos_repository.py quant-worker/tests/test_kronos_runner.py -q`

```powershell
git add quant-worker/smart_insights/kronos/repository.py quant-worker/run_kronos_shadow.py quant-worker/tests/test_kronos_repository.py quant-worker/tests/test_kronos_runner.py
git commit -m "feat: persist Kronos shadow evaluations"
```

### Task 7: Add the read-only BTC shadow forecast API

**Files:**

- Modify: `src/lib/backend/smart-insights-types.ts`
- Modify: `src/lib/smart-insights-client.ts`
- Create: `src/lib/backend/smart-insights-forecast.ts`
- Create: `src/app/api/smart-insights/forecast/[asset]/route.ts`
- Create: `src/app/api/smart-insights/forecast/[asset]/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Test authentication/capability, BTC-only asset and `kronos-small` model validation, `ACCUMULATING`/`READY_SHADOW`/`FAILED`/`UNAVAILABLE` states, methodology/model revisions, benchmark metrics, forecast interval ordering, and absence of provider paths/checksums/raw payloads.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- "src/app/api/smart-insights/forecast/[asset]/route.test.ts"`

- [ ] **Step 3: Add explicit view types**

```ts
export interface KronosShadowView {
  asset: "BTC"
  model: "kronos-small"
  state: "ACCUMULATING" | "READY_SHADOW" | "FAILED" | "UNAVAILABLE"
  decisionUse: "NONE"
  completedOos: number
  minimumOos: 180
  generatedAt: string | null
  forecasts: Array<{ days: 1 | 3 | 7; median: number; lower: number; upper: number; forecastFor: string }>
  metrics: Array<{ model: string; mae: number; mase: number; directionalAccuracy: number; intervalCoverage: number | null }>
  rollingErrors: Array<{ ts: string; model: string; absoluteError: number; directionCorrect: boolean }>
  methodology: "kronos-btc-shadow-v1"
}
```

- [ ] **Step 4: Implement route and loader**

Use `requireTenantContext`, research-read capability, Zod validation, and organization scoping through the originating research run. Return no current forecast if checksum/runtime provenance is missing.

- [ ] **Step 5: Re-run and commit**

Run: `npm test -- "src/app/api/smart-insights/forecast/[asset]/route.test.ts"`

```powershell
git add src/lib/backend/smart-insights-types.ts src/lib/smart-insights-client.ts src/lib/backend/smart-insights-forecast.ts "src/app/api/smart-insights/forecast/[asset]"
git commit -m "feat: expose BTC shadow forecast evaluation"
```

### Task 8: Add a visibly experimental chart-first BTC view

**Files:**

- Create: `src/components/smart-insights/KronosShadowPanel.tsx`
- Modify: `src/components/smart-insights/CryptoQuantPulseTabs.tsx`
- Create: `src/components/smart-insights/KronosShadowPanel.test.tsx`

- [ ] **Step 1: Write failing component tests**

Assert the persistent `SHADOW / NOT USED IN DECISIONS` label, fan chart, benchmark table, rolling error chart, forecast history, OOS progress, status text independent of color, unavailable/failure states, mobile stacked rows, no recommendation wording, and no animation that impairs reading.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/components/smart-insights/KronosShadowPanel.test.tsx`

- [ ] **Step 3: Implement the view**

Add `BTC Forecast` to the existing Crypto tab strip. Render at most four cards: evaluation state, completed OOS count, Kronos MASE, and directional accuracy. Use a median/10th/90th fan chart as the primary visualization; use rolling error as the secondary chart; keep the benchmark and history tables compact. Hide no caveats behind tooltips.

Use existing card, tab, badge, typography, spacing, tooltip, and responsive-table patterns. Set chart animation off.

- [ ] **Step 4: Re-run, lint, and build**

Run: `npm test -- src/components/smart-insights/KronosShadowPanel.test.tsx`
Run: `npm run lint`
Run: `npm run build`

- [ ] **Step 5: Commit**

```powershell
git add src/components/smart-insights/KronosShadowPanel.tsx src/components/smart-insights/CryptoQuantPulseTabs.tsx src/components/smart-insights/KronosShadowPanel.test.tsx
git commit -m "feat: add BTC experimental forecast view"
```

### Task 9: Set up runtime, migrate, build evaluation history, and verify isolation

**Files:**

- Create: `docs/smart-insights/kronos-shadow-evaluation-2026-08-14.md`
- Modify only if a verified defect is found.

- [ ] **Step 1: Verify migration target and apply migration**

Run: `npx prisma migrate status`
Run: `npx prisma migrate deploy`

- [ ] **Step 2: Install the isolated optional runtime**

Run: `powershell -ExecutionPolicy Bypass -File quant-worker/scripts/setup_kronos.ps1`

Verify source revision, model revision, tokenizer revision, and SHA-256 manifest before inference. This step requires network/storage approval and may take significant time; do not run it during the base worker install.

- [ ] **Step 3: Verify BTC daily input history**

Check min/max timestamps, unique daily bars, missing/duplicate periods, OHLC validity, source, and freshness. Stop if fewer than 512 input bars plus 187 realized output bars are available for a 180-cutoff evaluation with seven-day labels.

- [ ] **Step 4: Run dry-run then the anchored shadow evaluation**

Run the CLI first with `--dry-run`, then execute the 180-point CPU evaluation. Record runtime/device, data cutoff, revisions, file-manifest digest, data fingerprint, completed forecasts, skipped cutoffs, elapsed time, and status.

- [ ] **Step 5: Run focused and regression gates**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_kronos_*.py -q`
Run: `npm test -- "src/app/api/smart-insights/forecast/[asset]/route.test.ts" src/components/smart-insights/KronosShadowPanel.test.tsx`
Run: `npm run lint`
Run: `npm run build`

- [ ] **Step 6: Verify isolation statically and in the browser**

Confirm no Kronos import enters decision modules. Browser-check fan chart, benchmark table, error chart, history, mobile layout, and persistent shadow disclaimer. Confirm Market Pulse, briefings, portfolio impact, alerts, and action suggestions are byte-for-byte or snapshot-equivalent with Kronos enabled versus unavailable.

- [ ] **Step 7: Record evidence and inspect final state**

Run: `git diff --check`
Run: `git status --short`

Document whether the state is `ACCUMULATING`, `READY_SHADOW`, `FAILED`, or `UNAVAILABLE`; never relabel it production-ready based on a single backfill.

- [ ] **Step 8: Commit evidence**

```powershell
git add docs/smart-insights/kronos-shadow-evaluation-2026-08-14.md
git commit -m "docs: record Kronos shadow evaluation evidence"
```
