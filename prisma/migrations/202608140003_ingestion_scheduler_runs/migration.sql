CREATE TABLE "market_ingestion_scheduler_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "command" TEXT NOT NULL,
  "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  "status" TEXT NOT NULL DEFAULT 'running',
  "queued_count" INTEGER NOT NULL DEFAULT 0,
  "retried_count" INTEGER NOT NULL DEFAULT 0,
  "processed_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  CONSTRAINT "market_ingestion_scheduler_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "market_ingestion_scheduler_runs_command_check"
    CHECK ("command" IN ('hourly', 'daily', 'all')),
  CONSTRAINT "market_ingestion_scheduler_runs_status_check"
    CHECK ("status" IN ('running', 'succeeded', 'failed')),
  CONSTRAINT "market_ingestion_scheduler_runs_count_check"
    CHECK (
      "queued_count" >= 0 AND "retried_count" >= 0
      AND "processed_count" >= 0 AND "failed_count" >= 0
    )
);

CREATE INDEX "market_ingestion_scheduler_runs_status_started_at_idx"
  ON "market_ingestion_scheduler_runs"("status", "started_at" DESC);
