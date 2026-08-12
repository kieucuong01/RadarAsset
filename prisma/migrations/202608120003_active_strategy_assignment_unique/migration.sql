DROP INDEX IF EXISTS "strategy_assignments_portfolio_id_asset_id_key";

CREATE INDEX IF NOT EXISTS "strategy_assignments_portfolio_id_asset_id_idx"
  ON "strategy_assignments"("portfolio_id", "asset_id");

CREATE UNIQUE INDEX "strategy_assignments_one_active_per_asset"
  ON "strategy_assignments"("portfolio_id", "asset_id")
  WHERE "status" = 'active';
