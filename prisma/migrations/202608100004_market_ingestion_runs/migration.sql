CREATE TABLE "market_ingestion_runs" (
    "id" UUID NOT NULL,
    "provider_code" TEXT NOT NULL,
    "asset_symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "fetched_row_count" INTEGER NOT NULL DEFAULT 0,
    "dataset_version_id" UUID,
    "error_code" TEXT,
    "error_message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT "market_ingestion_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "market_ingestion_runs_asset_symbol_timeframe_started_at_idx"
    ON "market_ingestion_runs"("asset_symbol", "timeframe", "started_at" DESC);

CREATE INDEX "market_ingestion_runs_status_started_at_idx"
    ON "market_ingestion_runs"("status", "started_at");

CREATE INDEX "market_ingestion_runs_dataset_version_id_idx"
    ON "market_ingestion_runs"("dataset_version_id");

ALTER TABLE "market_ingestion_runs"
ADD CONSTRAINT "market_ingestion_runs_dataset_version_id_fkey"
FOREIGN KEY ("dataset_version_id") REFERENCES "dataset_versions"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
