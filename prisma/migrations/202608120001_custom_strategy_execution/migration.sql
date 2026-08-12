-- Tenant-owned executable strategies and durable forward-testing state.

CREATE TABLE "custom_strategies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "family" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "custom_strategies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "custom_strategies_family_check" CHECK ("family" IN ('technical', 'systematic')),
    CONSTRAINT "custom_strategies_status_check" CHECK ("status" IN ('active', 'archived'))
);

CREATE TABLE "custom_strategy_versions" (
    "id" UUID NOT NULL,
    "custom_strategy_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rule_definition" JSONB NOT NULL,
    "implementation_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "custom_strategy_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "custom_strategy_versions_kind_check" CHECK ("kind" IN ('price_threshold', 'scheduled_dca')),
    CONSTRAINT "custom_strategy_versions_status_check" CHECK ("status" IN ('active', 'retired'))
);

ALTER TABLE "strategy_versions"
  ADD COLUMN "organization_id" UUID,
  ADD COLUMN "custom_strategy_version_id" UUID;

ALTER TABLE "strategy_assignments"
  ADD COLUMN "activated_at" TIMESTAMP(3),
  ADD COLUMN "last_evaluated_at" TIMESTAMP(3),
  ADD COLUMN "last_evaluated_dataset_version_id" UUID,
  ADD COLUMN "last_evaluated_bar_at" TIMESTAMPTZ(3),
  ADD COLUMN "state" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "source_quant_run_id" UUID,
  ADD COLUMN "source_quant_run_leg_id" UUID;

ALTER TABLE "strategy_signals"
  ADD COLUMN "dataset_version_id" UUID,
  ADD COLUMN "event_type" TEXT NOT NULL DEFAULT 'signal';

ALTER TABLE "portfolio_transactions"
  ADD COLUMN "source_signal_id" UUID;

CREATE TABLE "strategy_evaluation_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "dataset_version_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "worker_id" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    CONSTRAINT "strategy_evaluation_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "strategy_forward_snapshots" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "dataset_version_id" UUID NOT NULL,
    "bar_at" TIMESTAMPTZ(3) NOT NULL,
    "simulated_cash" DECIMAL(24,8) NOT NULL,
    "simulated_quantity" DECIMAL(28,10) NOT NULL,
    "market_value" DECIMAL(24,8) NOT NULL,
    "equity" DECIMAL(24,8) NOT NULL,
    "cumulative_contributions" DECIMAL(24,8) NOT NULL,
    "cumulative_fees" DECIMAL(24,8) NOT NULL,
    "pnl_excluding_contributions" DECIMAL(24,8) NOT NULL,
    "benchmark_equity" DECIMAL(24,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "strategy_forward_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "signal_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_type_check" CHECK ("type" IN ('strategy_buy', 'strategy_sell'))
);

UPDATE "strategy_assignments"
SET "activated_at" = "created_at"
WHERE "activated_at" IS NULL;

DROP INDEX "strategy_signals_assignment_id_signal_type_signal_at_key";

CREATE UNIQUE INDEX "strategy_signals_forward_event_idempotency"
  ON "strategy_signals"("assignment_id", "dataset_version_id", "signal_at", "event_type")
  WHERE "dataset_version_id" IS NOT NULL;
CREATE UNIQUE INDEX "strategy_versions_custom_strategy_version_id_key"
  ON "strategy_versions"("custom_strategy_version_id");
CREATE UNIQUE INDEX "portfolio_transactions_source_signal_id_key"
  ON "portfolio_transactions"("source_signal_id");
CREATE UNIQUE INDEX "custom_strategy_versions_custom_strategy_id_version_key"
  ON "custom_strategy_versions"("custom_strategy_id", "version");
CREATE UNIQUE INDEX "custom_strategy_versions_custom_strategy_id_implementation_hash_key"
  ON "custom_strategy_versions"("custom_strategy_id", "implementation_hash");
CREATE UNIQUE INDEX "strategy_evaluation_jobs_assignment_id_dataset_version_id_key"
  ON "strategy_evaluation_jobs"("assignment_id", "dataset_version_id");
CREATE UNIQUE INDEX "strategy_forward_snapshots_assignment_id_dataset_version_id_bar_at_key"
  ON "strategy_forward_snapshots"("assignment_id", "dataset_version_id", "bar_at");
CREATE UNIQUE INDEX "notifications_user_id_signal_id_key"
  ON "notifications"("user_id", "signal_id");
CREATE INDEX "custom_strategies_organization_id_status_updated_at_idx"
  ON "custom_strategies"("organization_id", "status", "updated_at" DESC);
CREATE INDEX "strategy_versions_organization_id_status_idx"
  ON "strategy_versions"("organization_id", "status");
CREATE INDEX "strategy_signals_dataset_version_id_idx"
  ON "strategy_signals"("dataset_version_id");
CREATE INDEX "strategy_evaluation_jobs_status_created_at_idx"
  ON "strategy_evaluation_jobs"("status", "created_at");
CREATE INDEX "strategy_forward_snapshots_organization_id_assignment_id_bar_at_idx"
  ON "strategy_forward_snapshots"("organization_id", "assignment_id", "bar_at");
CREATE INDEX "notifications_organization_id_user_id_created_at_idx"
  ON "notifications"("organization_id", "user_id", "created_at" DESC);

ALTER TABLE "custom_strategies"
  ADD CONSTRAINT "custom_strategies_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "custom_strategies_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "custom_strategy_versions"
  ADD CONSTRAINT "custom_strategy_versions_custom_strategy_id_fkey"
  FOREIGN KEY ("custom_strategy_id") REFERENCES "custom_strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "strategy_versions"
  ADD CONSTRAINT "strategy_versions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "strategy_versions_custom_strategy_version_id_fkey"
  FOREIGN KEY ("custom_strategy_version_id") REFERENCES "custom_strategy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "strategy_signals"
  ADD CONSTRAINT "strategy_signals_dataset_version_id_fkey"
  FOREIGN KEY ("dataset_version_id") REFERENCES "dataset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "portfolio_transactions"
  ADD CONSTRAINT "portfolio_transactions_source_signal_id_fkey"
  FOREIGN KEY ("source_signal_id") REFERENCES "strategy_signals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "strategy_evaluation_jobs"
  ADD CONSTRAINT "strategy_evaluation_jobs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "strategy_evaluation_jobs_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "strategy_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "strategy_evaluation_jobs_dataset_version_id_fkey"
  FOREIGN KEY ("dataset_version_id") REFERENCES "dataset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "strategy_forward_snapshots"
  ADD CONSTRAINT "strategy_forward_snapshots_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "strategy_forward_snapshots_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "strategy_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "strategy_forward_snapshots_dataset_version_id_fkey"
  FOREIGN KEY ("dataset_version_id") REFERENCES "dataset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "notifications_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "strategy_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "notifications_signal_id_fkey"
  FOREIGN KEY ("signal_id") REFERENCES "strategy_signals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
