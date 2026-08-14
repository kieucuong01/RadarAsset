DELETE FROM "investment_theses"
WHERE lower("source") IN ('last30days', 'ai-berkshire', 'daily_stock_analysis');

DELETE FROM "research_runs"
WHERE lower("source") IN ('last30days', 'ai-berkshire', 'daily_stock_analysis')
   OR EXISTS (
     SELECT 1
     FROM jsonb_array_elements_text(
       CASE
         WHEN jsonb_typeof("parameters"->'adapters') = 'array'
           THEN "parameters"->'adapters'
         ELSE '[]'::jsonb
       END
     ) AS adapter(value)
     WHERE lower(adapter.value) IN ('last30days', 'ai-berkshire', 'daily_stock_analysis')
   );

CREATE TABLE "global_event_observations" (
  "id" UUID NOT NULL,
  "provider_id" UUID NOT NULL,
  "raw_snapshot_id" UUID NOT NULL,
  "provider_event_key" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "subcategory" TEXT,
  "title" TEXT NOT NULL,
  "country" TEXT,
  "region" TEXT,
  "latitude" DECIMAL(10, 6),
  "longitude" DECIMAL(10, 6),
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "first_observed_at" TIMESTAMPTZ(3) NOT NULL,
  "last_observed_at" TIMESTAMPTZ(3) NOT NULL,
  "normalized_severity" DECIMAL(8, 4),
  "provider_severity" DECIMAL(12, 4),
  "affected_count" INTEGER,
  "fatalities" INTEGER,
  "source_url" TEXT,
  "content_hash" TEXT NOT NULL,
  "parser_version" TEXT NOT NULL,
  "quality_status" TEXT NOT NULL DEFAULT 'passed',
  "quality_flags" JSONB NOT NULL DEFAULT '[]',
  "dimensions" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "global_event_observations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "global_event_clusters" (
  "id" UUID NOT NULL,
  "cluster_key" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "subcategory" TEXT,
  "title" TEXT NOT NULL,
  "country" TEXT,
  "region" TEXT,
  "latitude" DECIMAL(10, 6),
  "longitude" DECIMAL(10, 6),
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "normalized_severity" DECIMAL(8, 4) NOT NULL,
  "corroboration_count" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'active',
  "quality_flags" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "global_event_clusters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "global_event_cluster_members" (
  "id" UUID NOT NULL,
  "cluster_id" UUID NOT NULL,
  "observation_id" UUID NOT NULL,
  "match_score" DECIMAL(8, 4) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "global_event_cluster_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_baseline_states" (
  "id" UUID NOT NULL,
  "baseline_key" TEXT NOT NULL,
  "event_category" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "mean" DECIMAL(30, 10) NOT NULL DEFAULT 0,
  "m2" DECIMAL(30, 10) NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "event_baseline_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "global_event_observations_provider_id_provider_event_key_key"
  ON "global_event_observations"("provider_id", "provider_event_key");
CREATE INDEX "global_event_observations_raw_snapshot_id_idx"
  ON "global_event_observations"("raw_snapshot_id");
CREATE INDEX "global_event_observations_occurred_at_idx"
  ON "global_event_observations"("occurred_at" DESC);
CREATE INDEX "global_event_observations_category_country_occurred_at_idx"
  ON "global_event_observations"("category", "country", "occurred_at" DESC);
CREATE UNIQUE INDEX "global_event_clusters_cluster_key_key"
  ON "global_event_clusters"("cluster_key");
CREATE INDEX "global_event_clusters_occurred_at_idx"
  ON "global_event_clusters"("occurred_at" DESC);
CREATE INDEX "global_event_clusters_category_occurred_at_idx"
  ON "global_event_clusters"("category", "occurred_at" DESC);
CREATE UNIQUE INDEX "global_event_cluster_members_observation_id_key"
  ON "global_event_cluster_members"("observation_id");
CREATE INDEX "global_event_cluster_members_cluster_id_idx"
  ON "global_event_cluster_members"("cluster_id");
CREATE UNIQUE INDEX "event_baseline_states_baseline_key_key"
  ON "event_baseline_states"("baseline_key");
CREATE INDEX "event_baseline_states_event_category_region_weekday_month_idx"
  ON "event_baseline_states"("event_category", "region", "weekday", "month");

ALTER TABLE "global_event_observations"
  ADD CONSTRAINT "global_event_observations_provider_id_fkey"
  FOREIGN KEY ("provider_id") REFERENCES "data_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "global_event_observations_raw_snapshot_id_fkey"
  FOREIGN KEY ("raw_snapshot_id") REFERENCES "insight_raw_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "global_event_cluster_members"
  ADD CONSTRAINT "global_event_cluster_members_cluster_id_fkey"
  FOREIGN KEY ("cluster_id") REFERENCES "global_event_clusters"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "global_event_cluster_members_observation_id_fkey"
  FOREIGN KEY ("observation_id") REFERENCES "global_event_observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "global_event_observations"
  ADD CONSTRAINT "global_event_observations_severity_check"
  CHECK ("normalized_severity" IS NULL OR "normalized_severity" BETWEEN 0 AND 100),
  ADD CONSTRAINT "global_event_observations_coordinate_check"
  CHECK (("latitude" IS NULL AND "longitude" IS NULL) OR
    ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)),
  ADD CONSTRAINT "global_event_observations_counts_check"
  CHECK (("affected_count" IS NULL OR "affected_count" >= 0) AND
    ("fatalities" IS NULL OR "fatalities" >= 0)),
  ADD CONSTRAINT "global_event_observations_time_check"
  CHECK ("first_observed_at" <= "last_observed_at");
ALTER TABLE "global_event_clusters"
  ADD CONSTRAINT "global_event_clusters_severity_check"
  CHECK ("normalized_severity" BETWEEN 0 AND 100),
  ADD CONSTRAINT "global_event_clusters_corroboration_check"
  CHECK ("corroboration_count" > 0),
  ADD CONSTRAINT "global_event_clusters_coordinate_check"
  CHECK (("latitude" IS NULL AND "longitude" IS NULL) OR
    ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180));
ALTER TABLE "global_event_cluster_members"
  ADD CONSTRAINT "global_event_cluster_members_score_check"
  CHECK ("match_score" BETWEEN 0 AND 1);
ALTER TABLE "event_baseline_states"
  ADD CONSTRAINT "event_baseline_states_segment_check"
  CHECK ("weekday" BETWEEN 0 AND 6 AND "month" BETWEEN 1 AND 12),
  ADD CONSTRAINT "event_baseline_states_count_check"
  CHECK ("count" >= 0 AND "m2" >= 0);
