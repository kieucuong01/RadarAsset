CREATE TABLE "ingestion_worker_heartbeats" (
    "worker_id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeat_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_request_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ingestion_worker_heartbeats_pkey" PRIMARY KEY ("worker_id")
);

CREATE INDEX "ingestion_worker_heartbeats_heartbeat_at_idx"
ON "ingestion_worker_heartbeats"("heartbeat_at" DESC);
