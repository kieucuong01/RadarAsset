-- Persist immutable, code-owned strategy catalog versions.
CREATE TABLE "strategy_versions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "parameter_schema" JSONB NOT NULL,
    "default_parameters" JSONB NOT NULL,
    "supported_markets" JSONB NOT NULL,
    "supported_timeframes" JSONB NOT NULL,
    "implementation_hash" TEXT NOT NULL,
    "source_attribution" TEXT,
    "modification_notice" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "strategy_versions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "quant_runs"
ADD COLUMN "strategy_version_id" UUID,
ADD COLUMN "worker_id" TEXT,
ADD COLUMN "lease_expires_at" TIMESTAMP(3),
ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "strategy_versions_code_version_key"
    ON "strategy_versions"("code", "version");
CREATE INDEX "strategy_versions_status_code_idx"
    ON "strategy_versions"("status", "code");
CREATE INDEX "quant_runs_strategy_version_id_idx"
    ON "quant_runs"("strategy_version_id");

ALTER TABLE "quant_runs"
ADD CONSTRAINT "quant_runs_strategy_version_id_fkey"
FOREIGN KEY ("strategy_version_id") REFERENCES "strategy_versions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
