ALTER TABLE "provider_runs"
  ADD COLUMN "duration_ms" INTEGER,
  ADD COLUMN "error_code" TEXT,
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "insight_raw_snapshots" (
  "id" UUID NOT NULL,
  "provider_id" UUID NOT NULL,
  "source_url" TEXT NOT NULL,
  "effective_at" TIMESTAMPTZ(3),
  "published_at" TIMESTAMPTZ(3),
  "observed_at" TIMESTAMPTZ(3) NOT NULL,
  "content_hash" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "storage_locator" TEXT NOT NULL,
  "parser_version" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error_code" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "insight_raw_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "metric_definitions" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "frequency" TEXT NOT NULL,
  "direction" INTEGER NOT NULL DEFAULT 1,
  "methodology_version" TEXT NOT NULL,
  "freshness_sla_minutes" INTEGER NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "metric_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "metric_observations" (
  "id" UUID NOT NULL,
  "metric_definition_id" UUID NOT NULL,
  "provider_id" UUID NOT NULL,
  "asset_id" UUID,
  "raw_snapshot_id" UUID NOT NULL,
  "effective_at" TIMESTAMPTZ(3) NOT NULL,
  "effective_start" TIMESTAMPTZ(3),
  "effective_end" TIMESTAMPTZ(3),
  "published_at" TIMESTAMPTZ(3),
  "observed_at" TIMESTAMPTZ(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "value" DECIMAL(30,10) NOT NULL,
  "natural_key" TEXT NOT NULL,
  "dimension_key" TEXT NOT NULL,
  "dimensions" JSONB NOT NULL DEFAULT '{}',
  "quality_status" TEXT NOT NULL,
  "quality_flags" JSONB NOT NULL DEFAULT '[]',
  CONSTRAINT "metric_observations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "signal_snapshots" (
  "id" UUID NOT NULL,
  "market" TEXT NOT NULL,
  "asset_id" UUID,
  "effective_at" TIMESTAMPTZ(3) NOT NULL,
  "methodology_version" TEXT NOT NULL,
  "signal_type" TEXT NOT NULL,
  "score" DECIMAL(8,4),
  "label" TEXT NOT NULL,
  "data_confidence" DECIMAL(5,2) NOT NULL,
  "coverage" DECIMAL(5,4) NOT NULL,
  "inputs" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "signal_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_insight_preferences" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "markets" JSONB NOT NULL DEFAULT '[]',
  "assets" JSONB NOT NULL DEFAULT '[]',
  "locale" TEXT NOT NULL DEFAULT 'vi',
  "base_currency" TEXT NOT NULL DEFAULT 'USD',
  "investment_horizon" TEXT NOT NULL,
  "risk_tolerance" TEXT NOT NULL,
  "alert_preferences" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_insight_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_briefings" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "research_run_id" UUID NOT NULL,
  "effective_date" DATE NOT NULL,
  "effective_at" TIMESTAMPTZ(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "model_name" TEXT,
  "prompt_version" TEXT NOT NULL,
  "methodology_version" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "market_summary" JSONB NOT NULL DEFAULT '{}',
  "data_confidence" DECIMAL(5,2) NOT NULL,
  "portfolio_snapshot" JSONB NOT NULL DEFAULT '{}',
  "preference_snapshot" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_briefings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_briefing_items" (
  "id" UUID NOT NULL,
  "daily_briefing_id" UUID NOT NULL,
  "signal_snapshot_id" UUID NOT NULL,
  "ai_insight_id" UUID,
  "rank" INTEGER NOT NULL,
  "section" TEXT NOT NULL,
  "relevance_score" DECIMAL(5,2) NOT NULL,
  "relevance_components" JSONB NOT NULL DEFAULT '{}',
  "supporting_evidence_ids" JSONB NOT NULL DEFAULT '[]',
  "contradicting_evidence_ids" JSONB NOT NULL DEFAULT '[]',
  "affected_assets" JSONB NOT NULL DEFAULT '[]',
  "time_horizon" TEXT NOT NULL,
  "risk_scenarios" JSONB NOT NULL DEFAULT '[]',
  "suggested_check_template" TEXT NOT NULL,
  "explanation_status" TEXT NOT NULL,
  "confidence" DECIMAL(5,2) NOT NULL,
  "outcomes" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_briefing_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "insight_raw_snapshots_provider_id_observed_at_idx"
  ON "insight_raw_snapshots"("provider_id", "observed_at" DESC);
CREATE INDEX "insight_raw_snapshots_status_observed_at_idx"
  ON "insight_raw_snapshots"("status", "observed_at");
CREATE UNIQUE INDEX "insight_raw_snapshots_provider_id_source_url_content_hash_key"
  ON "insight_raw_snapshots"("provider_id", "source_url", "content_hash");
CREATE UNIQUE INDEX "metric_definitions_code_key" ON "metric_definitions"("code");
CREATE INDEX "metric_definitions_market_code_idx" ON "metric_definitions"("market", "code");
CREATE INDEX "metric_observations_metric_definition_id_asset_id_effective_idx"
  ON "metric_observations"("metric_definition_id", "asset_id", "effective_at" DESC);
CREATE INDEX "metric_observations_raw_snapshot_id_idx" ON "metric_observations"("raw_snapshot_id");
CREATE UNIQUE INDEX "metric_observations_natural_key_revision_key"
  ON "metric_observations"("natural_key", "revision");
CREATE UNIQUE INDEX "signal_snapshots_idempotency_key_key" ON "signal_snapshots"("idempotency_key");
CREATE INDEX "signal_snapshots_market_asset_id_effective_at_idx"
  ON "signal_snapshots"("market", "asset_id", "effective_at" DESC);
CREATE INDEX "signal_snapshots_status_effective_at_idx"
  ON "signal_snapshots"("status", "effective_at" DESC);
CREATE INDEX "user_insight_preferences_user_id_idx" ON "user_insight_preferences"("user_id");
CREATE UNIQUE INDEX "user_insight_preferences_organization_id_user_id_key"
  ON "user_insight_preferences"("organization_id", "user_id");
CREATE UNIQUE INDEX "daily_briefings_research_run_id_key" ON "daily_briefings"("research_run_id");
CREATE INDEX "daily_briefings_organization_id_user_id_effective_date_revi_idx"
  ON "daily_briefings"("organization_id", "user_id", "effective_date", "revision" DESC);
CREATE UNIQUE INDEX "daily_briefings_organization_id_user_id_effective_date_revi_key"
  ON "daily_briefings"("organization_id", "user_id", "effective_date", "revision");
CREATE INDEX "daily_briefing_items_signal_snapshot_id_idx" ON "daily_briefing_items"("signal_snapshot_id");
CREATE INDEX "daily_briefing_items_ai_insight_id_idx" ON "daily_briefing_items"("ai_insight_id");
CREATE UNIQUE INDEX "daily_briefing_items_daily_briefing_id_rank_key"
  ON "daily_briefing_items"("daily_briefing_id", "rank");
CREATE INDEX "metric_observations_latest_lookup"
  ON "metric_observations"("metric_definition_id", "asset_id", "effective_at" DESC, "revision" DESC)
  WHERE "quality_status" IN ('passed', 'warning');

ALTER TABLE "insight_raw_snapshots"
  ADD CONSTRAINT "insight_raw_snapshots_provider_id_fkey"
  FOREIGN KEY ("provider_id") REFERENCES "data_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "metric_observations"
  ADD CONSTRAINT "metric_observations_metric_definition_id_fkey"
  FOREIGN KEY ("metric_definition_id") REFERENCES "metric_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "metric_observations"
  ADD CONSTRAINT "metric_observations_provider_id_fkey"
  FOREIGN KEY ("provider_id") REFERENCES "data_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "metric_observations"
  ADD CONSTRAINT "metric_observations_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "metric_observations"
  ADD CONSTRAINT "metric_observations_raw_snapshot_id_fkey"
  FOREIGN KEY ("raw_snapshot_id") REFERENCES "insight_raw_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "signal_snapshots"
  ADD CONSTRAINT "signal_snapshots_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_insight_preferences"
  ADD CONSTRAINT "user_insight_preferences_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_insight_preferences"
  ADD CONSTRAINT "user_insight_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_briefings"
  ADD CONSTRAINT "daily_briefings_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_briefings"
  ADD CONSTRAINT "daily_briefings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_briefings"
  ADD CONSTRAINT "daily_briefings_research_run_id_fkey"
  FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_briefing_items"
  ADD CONSTRAINT "daily_briefing_items_daily_briefing_id_fkey"
  FOREIGN KEY ("daily_briefing_id") REFERENCES "daily_briefings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_briefing_items"
  ADD CONSTRAINT "daily_briefing_items_signal_snapshot_id_fkey"
  FOREIGN KEY ("signal_snapshot_id") REFERENCES "signal_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_briefing_items"
  ADD CONSTRAINT "daily_briefing_items_ai_insight_id_fkey"
  FOREIGN KEY ("ai_insight_id") REFERENCES "ai_insights"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "insight_raw_snapshots"
  ADD CONSTRAINT "insight_raw_snapshot_status_check"
  CHECK ("status" IN ('fetched', 'validated', 'quarantined'));
ALTER TABLE "metric_definitions"
  ADD CONSTRAINT "metric_definition_market_check" CHECK ("market" IN ('crypto', 'macro', 'gold')),
  ADD CONSTRAINT "metric_definition_direction_check" CHECK ("direction" IN (-1, 0, 1)),
  ADD CONSTRAINT "metric_definition_freshness_check" CHECK ("freshness_sla_minutes" > 0);
ALTER TABLE "metric_observations"
  ADD CONSTRAINT "metric_observation_quality_check"
    CHECK ("quality_status" IN ('passed', 'warning', 'conflicting')),
  ADD CONSTRAINT "metric_observation_revision_check" CHECK ("revision" > 0),
  ADD CONSTRAINT "metric_observation_period_check" CHECK (
    ("effective_start" IS NULL AND "effective_end" IS NULL)
    OR ("effective_start" IS NOT NULL AND "effective_end" IS NOT NULL
      AND "effective_start" <= "effective_at" AND "effective_at" = "effective_end")
  );
ALTER TABLE "provider_runs"
  ADD CONSTRAINT "provider_run_status_check"
    CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'quarantined')),
  ADD CONSTRAINT "provider_run_retry_count_check" CHECK ("retry_count" >= 0),
  ADD CONSTRAINT "provider_run_duration_check" CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0);
ALTER TABLE "signal_snapshots"
  ADD CONSTRAINT "signal_snapshot_market_check" CHECK ("market" IN ('crypto', 'macro', 'gold')),
  ADD CONSTRAINT "signal_snapshot_confidence_check" CHECK ("data_confidence" BETWEEN 0 AND 100),
  ADD CONSTRAINT "signal_snapshot_coverage_check" CHECK ("coverage" BETWEEN 0 AND 1),
  ADD CONSTRAINT "signal_snapshot_status_check"
    CHECK ("status" IN ('active', 'stale', 'conflicting', 'unavailable'));
ALTER TABLE "user_insight_preferences"
  ADD CONSTRAINT "user_insight_preference_locale_check" CHECK ("locale" IN ('vi', 'en'));
ALTER TABLE "daily_briefings"
  ADD CONSTRAINT "daily_briefing_revision_check" CHECK ("revision" > 0),
  ADD CONSTRAINT "daily_briefing_confidence_check" CHECK ("data_confidence" BETWEEN 0 AND 100),
  ADD CONSTRAINT "daily_briefing_status_check" CHECK ("status" IN ('complete', 'partial', 'quant_only'));
ALTER TABLE "daily_briefing_items"
  ADD CONSTRAINT "daily_briefing_item_section_check"
    CHECK ("section" IN ('primary_change', 'risk_alert')),
  ADD CONSTRAINT "daily_briefing_item_rank_check" CHECK ("rank" BETWEEN 1 AND 5),
  ADD CONSTRAINT "daily_briefing_item_confidence_check" CHECK ("confidence" BETWEEN 0 AND 100),
  ADD CONSTRAINT "daily_briefing_item_explanation_check"
    CHECK ("explanation_status" IN ('accepted', 'unavailable', 'rejected'));
