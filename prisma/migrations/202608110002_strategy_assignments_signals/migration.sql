-- Persist a tenant-scoped strategy assignment for each portfolio asset and its reviewable signals.
CREATE TABLE "strategy_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "portfolio_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "strategy_version_id" UUID NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "strategy_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "strategy_signals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "strategy_version_id" UUID NOT NULL,
    "signal_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "signal_at" TIMESTAMP(3) NOT NULL,
    "execution_at" TIMESTAMP(3),
    "signal_price" DECIMAL(20,8),
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "strategy_signals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "strategy_assignments_portfolio_id_asset_id_key"
    ON "strategy_assignments"("portfolio_id", "asset_id");
CREATE INDEX "strategy_assignments_organization_id_status_idx"
    ON "strategy_assignments"("organization_id", "status");
CREATE INDEX "strategy_assignments_strategy_version_id_idx"
    ON "strategy_assignments"("strategy_version_id");
CREATE UNIQUE INDEX "strategy_signals_assignment_id_signal_type_signal_at_key"
    ON "strategy_signals"("assignment_id", "signal_type", "signal_at");
CREATE INDEX "strategy_signals_organization_id_status_signal_at_idx"
    ON "strategy_signals"("organization_id", "status", "signal_at" DESC);
CREATE INDEX "strategy_signals_asset_id_signal_at_idx"
    ON "strategy_signals"("asset_id", "signal_at" DESC);

ALTER TABLE "strategy_assignments"
  ADD CONSTRAINT "strategy_assignments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "strategy_assignments_portfolio_id_fkey"
  FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "strategy_assignments_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "strategy_assignments_strategy_version_id_fkey"
  FOREIGN KEY ("strategy_version_id") REFERENCES "strategy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "strategy_signals"
  ADD CONSTRAINT "strategy_signals_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "strategy_signals_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "strategy_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "strategy_signals_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "strategy_signals_strategy_version_id_fkey"
  FOREIGN KEY ("strategy_version_id") REFERENCES "strategy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
