ALTER TABLE "quant_runs"
  ADD COLUMN "last_heartbeat_at" TIMESTAMPTZ(3),
  ADD COLUMN "cancel_requested_at" TIMESTAMPTZ(3),
  ADD COLUMN "deadline_at" TIMESTAMPTZ(3);

UPDATE "quant_runs"
SET "deadline_at" = "created_at" AT TIME ZONE 'UTC' + INTERVAL '15 minutes'
WHERE "status" IN ('queued', 'running') AND "deadline_at" IS NULL;

ALTER TABLE "quant_runs"
  ADD CONSTRAINT "quant_runs_status_check"
    CHECK ("status" IN (
      'queued', 'running', 'succeeded', 'failed',
      'cancel_requested', 'cancelled', 'timed_out'
    )),
  ADD CONSTRAINT "quant_runs_progress_check" CHECK ("progress" BETWEEN 0 AND 100),
  ADD CONSTRAINT "quant_runs_attempt_count_check" CHECK ("attempt_count" >= 0);

CREATE INDEX "quant_runs_status_lease_expires_at_created_at_idx"
  ON "quant_runs"("status", "lease_expires_at", "created_at");

CREATE INDEX "quant_runs_organization_id_strategy_hash_engine_version_status_idx"
  ON "quant_runs"("organization_id", "strategy_hash", "engine_version", "status");
