CREATE TABLE "smart_insight_refresh_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "reason" TEXT NOT NULL,
    "request_version" INTEGER NOT NULL DEFAULT 1,
    "processing_version" INTEGER,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "worker_id" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "smart_insight_refresh_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "smart_insight_refresh_requests_organization_id_user_id_key"
ON "smart_insight_refresh_requests"("organization_id", "user_id");

CREATE INDEX "smart_insight_refresh_requests_organization_id_status_idx"
ON "smart_insight_refresh_requests"("organization_id", "status");

CREATE INDEX "smart_insight_refresh_requests_user_id_status_idx"
ON "smart_insight_refresh_requests"("user_id", "status");

CREATE INDEX "smart_insight_refresh_requests_status_available_at_idx"
ON "smart_insight_refresh_requests"("status", "available_at");

ALTER TABLE "smart_insight_refresh_requests"
ADD CONSTRAINT "smart_insight_refresh_requests_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "smart_insight_refresh_requests"
ADD CONSTRAINT "smart_insight_refresh_requests_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "smart_insight_refresh_requests" (
    "id", "organization_id", "user_id", "status", "reason",
    "request_version", "requested_at", "available_at", "created_at", "updated_at"
)
SELECT
    membership."id", membership."organization_id", membership."user_id", 'queued', 'activation',
    1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "memberships" AS membership
ON CONFLICT ("organization_id", "user_id") DO NOTHING;
