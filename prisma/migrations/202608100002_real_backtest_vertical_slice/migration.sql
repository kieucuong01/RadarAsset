-- Extend canonical asset metadata without changing existing symbol contracts.
ALTER TABLE "assets"
ADD COLUMN "canonical_key" TEXT,
ADD COLUMN "market" TEXT NOT NULL DEFAULT 'other',
ADD COLUMN "venue" TEXT,
ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN "max_leverage" DECIMAL(5,2) NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "assets_canonical_key_key" ON "assets"("canonical_key");

-- Add reproducibility and progress metadata to the existing queue table.
ALTER TABLE "quant_runs"
ADD COLUMN "timeframe" TEXT NOT NULL DEFAULT '1d',
ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "strategy_hash" TEXT,
ADD COLUMN "dataset_version_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN "engine_version" TEXT NOT NULL DEFAULT 'ma-cross-v1';

CREATE TABLE "data_providers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "terms_url" TEXT,
    "license_scope" TEXT NOT NULL DEFAULT 'research_only',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "data_providers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_instruments" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "provider_symbol" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provider_instruments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "datasets" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "timeframe" TEXT NOT NULL,
    "adjustment_policy" TEXT NOT NULL DEFAULT 'raw',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dataset_versions" (
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "coverage_start" TIMESTAMP(3) NOT NULL,
    "coverage_end" TIMESTAMP(3) NOT NULL,
    "row_count" INTEGER NOT NULL,
    "missing_bar_count" INTEGER NOT NULL DEFAULT 0,
    "quality_status" TEXT NOT NULL DEFAULT 'passed',
    "quality_summary" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "source_metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dataset_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dataset_bars" (
    "id" UUID NOT NULL,
    "dataset_version_id" UUID NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(20,8) NOT NULL,
    "high" DECIMAL(20,8) NOT NULL,
    "low" DECIMAL(20,8) NOT NULL,
    "close" DECIMAL(20,8) NOT NULL,
    "volume" DECIMAL(24,4),
    "source" TEXT NOT NULL,
    "quality_flags" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dataset_bars_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_quality_issues" (
    "id" UUID NOT NULL,
    "dataset_version_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "ts" TIMESTAMP(3),
    "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "data_quality_issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quant_run_artifacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "quant_run_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quant_run_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "data_providers_code_key" ON "data_providers"("code");
CREATE UNIQUE INDEX "provider_instruments_provider_id_provider_symbol_key"
    ON "provider_instruments"("provider_id", "provider_symbol");
CREATE UNIQUE INDEX "provider_instruments_provider_id_asset_id_key"
    ON "provider_instruments"("provider_id", "asset_id");
CREATE INDEX "provider_instruments_asset_id_idx" ON "provider_instruments"("asset_id");
CREATE UNIQUE INDEX "datasets_asset_id_timeframe_adjustment_policy_key"
    ON "datasets"("asset_id", "timeframe", "adjustment_policy");
CREATE INDEX "datasets_asset_id_timeframe_idx" ON "datasets"("asset_id", "timeframe");
CREATE UNIQUE INDEX "dataset_versions_dataset_id_version_key"
    ON "dataset_versions"("dataset_id", "version");
CREATE INDEX "dataset_versions_dataset_id_is_active_idx"
    ON "dataset_versions"("dataset_id", "is_active");
CREATE UNIQUE INDEX "dataset_versions_one_active_per_dataset_key"
    ON "dataset_versions"("dataset_id") WHERE "is_active" = true;
CREATE INDEX "dataset_versions_provider_id_idx" ON "dataset_versions"("provider_id");
CREATE UNIQUE INDEX "dataset_bars_dataset_version_id_ts_key"
    ON "dataset_bars"("dataset_version_id", "ts");
CREATE INDEX "dataset_bars_dataset_version_id_ts_idx"
    ON "dataset_bars"("dataset_version_id", "ts");
CREATE INDEX "data_quality_issues_dataset_version_id_severity_idx"
    ON "data_quality_issues"("dataset_version_id", "severity");
CREATE UNIQUE INDEX "quant_run_artifacts_quant_run_id_kind_key"
    ON "quant_run_artifacts"("quant_run_id", "kind");
CREATE INDEX "quant_run_artifacts_organization_id_created_at_idx"
    ON "quant_run_artifacts"("organization_id", "created_at" DESC);

ALTER TABLE "provider_instruments"
ADD CONSTRAINT "provider_instruments_provider_id_fkey"
FOREIGN KEY ("provider_id") REFERENCES "data_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_instruments"
ADD CONSTRAINT "provider_instruments_asset_id_fkey"
FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "datasets"
ADD CONSTRAINT "datasets_asset_id_fkey"
FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dataset_versions"
ADD CONSTRAINT "dataset_versions_dataset_id_fkey"
FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dataset_versions"
ADD CONSTRAINT "dataset_versions_provider_id_fkey"
FOREIGN KEY ("provider_id") REFERENCES "data_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dataset_bars"
ADD CONSTRAINT "dataset_bars_dataset_version_id_fkey"
FOREIGN KEY ("dataset_version_id") REFERENCES "dataset_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "data_quality_issues"
ADD CONSTRAINT "data_quality_issues_dataset_version_id_fkey"
FOREIGN KEY ("dataset_version_id") REFERENCES "dataset_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quant_run_artifacts"
ADD CONSTRAINT "quant_run_artifacts_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quant_run_artifacts"
ADD CONSTRAINT "quant_run_artifacts_quant_run_id_fkey"
FOREIGN KEY ("quant_run_id") REFERENCES "quant_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
