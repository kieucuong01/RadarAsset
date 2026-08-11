-- Add immutable per-asset sleeves while preserving existing aggregate artifacts.
CREATE TABLE "quant_run_legs" (
    "id" UUID NOT NULL,
    "quant_run_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "dataset_version_id" UUID NOT NULL,
    "strategy_version_id" UUID NOT NULL,
    "symbol_snapshot" TEXT NOT NULL,
    "market_snapshot" TEXT NOT NULL,
    "currency_snapshot" TEXT NOT NULL,
    "allocation_bps" INTEGER NOT NULL,
    "initial_notional" DECIMAL(24,8) NOT NULL,
    "leverage" DECIMAL(5,2) NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "implementation_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quant_run_legs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quant_run_legs_allocation_bps_check"
      CHECK ("allocation_bps" BETWEEN 0 AND 10000),
    CONSTRAINT "quant_run_legs_initial_notional_check" CHECK ("initial_notional" > 0),
    CONSTRAINT "quant_run_legs_leverage_check" CHECK ("leverage" BETWEEN 1 AND 2),
    CONSTRAINT "quant_run_legs_progress_check" CHECK ("progress" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX "quant_run_legs_quant_run_id_asset_id_key"
    ON "quant_run_legs"("quant_run_id", "asset_id");
CREATE INDEX "quant_run_legs_asset_id_idx" ON "quant_run_legs"("asset_id");
CREATE INDEX "quant_run_legs_dataset_version_id_idx"
    ON "quant_run_legs"("dataset_version_id");
CREATE INDEX "quant_run_legs_strategy_version_id_idx"
    ON "quant_run_legs"("strategy_version_id");

ALTER TABLE "quant_run_legs"
  ADD CONSTRAINT "quant_run_legs_quant_run_id_fkey"
  FOREIGN KEY ("quant_run_id") REFERENCES "quant_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "quant_run_legs_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "quant_run_legs_dataset_version_id_fkey"
  FOREIGN KEY ("dataset_version_id") REFERENCES "dataset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "quant_run_legs_strategy_version_id_fkey"
  FOREIGN KEY ("strategy_version_id") REFERENCES "strategy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quant_run_artifacts"
  ADD COLUMN "quant_run_leg_id" UUID,
  ADD COLUMN "scope_key" TEXT;

UPDATE "quant_run_artifacts" SET "scope_key" = 'aggregate' WHERE "scope_key" IS NULL;

ALTER TABLE "quant_run_artifacts"
  ALTER COLUMN "scope_key" SET DEFAULT 'aggregate',
  ALTER COLUMN "scope_key" SET NOT NULL;

DROP INDEX "quant_run_artifacts_quant_run_id_kind_key";
CREATE UNIQUE INDEX "quant_run_artifacts_quant_run_id_scope_key_kind_key"
    ON "quant_run_artifacts"("quant_run_id", "scope_key", "kind");
CREATE INDEX "quant_run_artifacts_quant_run_leg_id_idx"
    ON "quant_run_artifacts"("quant_run_leg_id");

ALTER TABLE "quant_run_artifacts"
  ADD CONSTRAINT "quant_run_artifacts_quant_run_leg_id_fkey"
  FOREIGN KEY ("quant_run_leg_id") REFERENCES "quant_run_legs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
