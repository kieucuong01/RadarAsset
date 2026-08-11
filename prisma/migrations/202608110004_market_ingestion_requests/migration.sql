CREATE TABLE "market_ingestion_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "provider_instrument_id" UUID NOT NULL,
  "timeframe" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "worker_id" TEXT,
  "lease_expires_at" TIMESTAMPTZ(3),
  "dataset_version_id" UUID,
  "error_code" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "market_ingestion_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "market_ingestion_requests_timeframe_check" CHECK ("timeframe" IN ('1d', '1h')),
  CONSTRAINT "market_ingestion_requests_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed')),
  CONSTRAINT "market_ingestion_requests_attempt_count_check" CHECK ("attempt_count" BETWEEN 0 AND 3),
  CONSTRAINT "market_ingestion_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "market_ingestion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "market_ingestion_requests_provider_instrument_id_fkey" FOREIGN KEY ("provider_instrument_id") REFERENCES "provider_instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "market_ingestion_requests_dataset_version_id_fkey" FOREIGN KEY ("dataset_version_id") REFERENCES "dataset_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "market_ingestion_requests_organization_id_status_created_at_idx"
  ON "market_ingestion_requests"("organization_id", "status", "created_at");
CREATE INDEX "market_ingestion_requests_user_id_status_idx"
  ON "market_ingestion_requests"("user_id", "status");
CREATE INDEX "market_ingestion_requests_provider_instrument_id_idx"
  ON "market_ingestion_requests"("provider_instrument_id");
CREATE INDEX "market_ingestion_requests_dataset_version_id_idx"
  ON "market_ingestion_requests"("dataset_version_id");
CREATE INDEX "market_ingestion_requests_status_available_at_idx"
  ON "market_ingestion_requests"("status", "available_at");
CREATE UNIQUE INDEX "market_ingestion_requests_active_unique"
  ON "market_ingestion_requests"("organization_id", "user_id", "provider_instrument_id", "timeframe")
  WHERE "status" IN ('queued', 'running');
