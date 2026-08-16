CREATE TABLE "asset_opinion_evaluations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "signal_snapshot_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "benchmark_asset_id" UUID NOT NULL,
  "asset_dataset_version_id" UUID NOT NULL,
  "benchmark_dataset_version_id" UUID NOT NULL,
  "horizon_sessions" SMALLINT NOT NULL,
  "direction" SMALLINT NOT NULL,
  "entry_at" TIMESTAMPTZ(3) NOT NULL,
  "entry_close" DECIMAL(20,8) NOT NULL,
  "target_at" TIMESTAMPTZ(3) NOT NULL,
  "target_close" DECIMAL(20,8) NOT NULL,
  "benchmark_entry_close" DECIMAL(20,8) NOT NULL,
  "benchmark_target_close" DECIMAL(20,8) NOT NULL,
  "asset_return" DECIMAL(18,10) NOT NULL,
  "benchmark_return" DECIMAL(18,10) NOT NULL,
  "excess_return" DECIMAL(18,10) NOT NULL,
  "correct" BOOLEAN NOT NULL,
  "adjustment_policy" TEXT NOT NULL,
  "evaluated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "asset_opinion_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "asset_opinion_evaluations_horizon_check"
    CHECK ("horizon_sessions" IN (1, 5, 20)),
  CONSTRAINT "asset_opinion_evaluations_direction_check"
    CHECK ("direction" IN (-1, 1)),
  CONSTRAINT "asset_opinion_evaluations_signal_snapshot_id_fkey"
    FOREIGN KEY ("signal_snapshot_id") REFERENCES "signal_snapshots"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "asset_opinion_evaluations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "asset_opinion_evaluations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "asset_opinion_evaluations_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "assets"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "asset_opinion_evaluations_benchmark_asset_id_fkey"
    FOREIGN KEY ("benchmark_asset_id") REFERENCES "assets"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "asset_opinion_evaluations_asset_dataset_version_id_fkey"
    FOREIGN KEY ("asset_dataset_version_id") REFERENCES "dataset_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "asset_opinion_evaluations_benchmark_dataset_version_id_fkey"
    FOREIGN KEY ("benchmark_dataset_version_id") REFERENCES "dataset_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "asset_opinion_evaluations_signal_snapshot_id_horizon_sessions_key"
  ON "asset_opinion_evaluations"("signal_snapshot_id", "horizon_sessions");
CREATE INDEX "asset_opinion_evaluations_org_user_asset_horizon_idx"
  ON "asset_opinion_evaluations"("organization_id", "user_id", "asset_id", "horizon_sessions");
CREATE INDEX "asset_opinion_evaluations_target_at_idx"
  ON "asset_opinion_evaluations"("target_at");
