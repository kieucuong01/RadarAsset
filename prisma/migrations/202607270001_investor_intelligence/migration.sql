ALTER TABLE "ai_insights"
ADD COLUMN "research_run_id" UUID,
ADD COLUMN "confidence" INTEGER,
ADD COLUMN "catalyst" TEXT,
ADD COLUMN "risk" TEXT;

CREATE TABLE "research_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "asset_id" UUID,
  "source" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "parameters" JSONB NOT NULL DEFAULT '{}',
  "summary" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "research_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evidence_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "research_run_id" UUID,
  "asset_id" UUID,
  "insight_id" UUID,
  "source_type" TEXT NOT NULL,
  "source_name" TEXT NOT NULL,
  "url" TEXT,
  "title" TEXT NOT NULL,
  "excerpt" TEXT NOT NULL,
  "engagement" INTEGER NOT NULL DEFAULT 0,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "evidence_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "investment_theses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asset_id" UUID NOT NULL,
  "research_run_id" UUID,
  "source" TEXT NOT NULL,
  "stance" TEXT NOT NULL,
  "conviction" INTEGER NOT NULL,
  "thesis" TEXT NOT NULL,
  "bull_case" TEXT NOT NULL,
  "bear_case" TEXT NOT NULL,
  "action_items" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "investment_theses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forecast_points" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asset_id" UUID NOT NULL,
  "research_run_id" UUID,
  "horizon" TEXT NOT NULL,
  "target_price" DECIMAL(20,8) NOT NULL,
  "lower_bound" DECIMAL(20,8) NOT NULL,
  "upper_bound" DECIMAL(20,8) NOT NULL,
  "confidence" INTEGER NOT NULL,
  "model" TEXT NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forecast_points_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "model_evaluations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asset_id" UUID,
  "model" TEXT NOT NULL,
  "task" TEXT NOT NULL,
  "window_start" TIMESTAMP(3) NOT NULL,
  "window_end" TIMESTAMP(3) NOT NULL,
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_evaluations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "research_run_id" UUID,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "records_fetched" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_insights_research_run_id_idx" ON "ai_insights"("research_run_id");
CREATE INDEX "research_runs_user_id_created_at_idx" ON "research_runs"("user_id", "created_at" DESC);
CREATE INDEX "research_runs_asset_id_created_at_idx" ON "research_runs"("asset_id", "created_at" DESC);
CREATE INDEX "research_runs_source_kind_status_idx" ON "research_runs"("source", "kind", "status");
CREATE INDEX "evidence_items_asset_id_observed_at_idx" ON "evidence_items"("asset_id", "observed_at" DESC);
CREATE INDEX "evidence_items_insight_id_idx" ON "evidence_items"("insight_id");
CREATE INDEX "evidence_items_research_run_id_idx" ON "evidence_items"("research_run_id");
CREATE INDEX "investment_theses_asset_id_updated_at_idx" ON "investment_theses"("asset_id", "updated_at" DESC);
CREATE INDEX "investment_theses_research_run_id_idx" ON "investment_theses"("research_run_id");
CREATE INDEX "forecast_points_asset_id_generated_at_idx" ON "forecast_points"("asset_id", "generated_at" DESC);
CREATE INDEX "forecast_points_research_run_id_idx" ON "forecast_points"("research_run_id");
CREATE INDEX "model_evaluations_asset_id_model_created_at_idx" ON "model_evaluations"("asset_id", "model", "created_at" DESC);
CREATE INDEX "provider_runs_provider_status_created_at_idx" ON "provider_runs"("provider", "status", "created_at" DESC);
CREATE INDEX "provider_runs_research_run_id_idx" ON "provider_runs"("research_run_id");

ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_research_run_id_fkey" FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_research_run_id_fkey" FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_insight_id_fkey" FOREIGN KEY ("insight_id") REFERENCES "ai_insights"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "investment_theses" ADD CONSTRAINT "investment_theses_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "investment_theses" ADD CONSTRAINT "investment_theses_research_run_id_fkey" FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "forecast_points" ADD CONSTRAINT "forecast_points_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forecast_points" ADD CONSTRAINT "forecast_points_research_run_id_fkey" FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "model_evaluations" ADD CONSTRAINT "model_evaluations_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_research_run_id_fkey" FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
