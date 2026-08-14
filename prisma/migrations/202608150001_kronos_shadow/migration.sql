ALTER TABLE "forecast_points"
  ADD COLUMN "forecast_for" TIMESTAMPTZ(6),
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN "methodology_version" TEXT,
  ADD COLUMN "model_revision" TEXT,
  ADD COLUMN "input_fingerprint" TEXT,
  ADD COLUMN "realized_price" DECIMAL(20,8),
  ADD COLUMN "evaluated_at" TIMESTAMPTZ(6);

ALTER TABLE "model_evaluations"
  ADD COLUMN "research_run_id" UUID,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'shadow',
  ADD COLUMN "methodology_version" TEXT,
  ADD COLUMN "data_fingerprint" TEXT;

CREATE INDEX "model_evaluations_research_run_id_idx"
  ON "model_evaluations"("research_run_id");

ALTER TABLE "model_evaluations"
  ADD CONSTRAINT "model_evaluations_research_run_id_fkey"
  FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "forecast_points_research_run_id_model_horizon_generated_at_key"
  ON "forecast_points"("research_run_id", "model", "horizon", "generated_at");
