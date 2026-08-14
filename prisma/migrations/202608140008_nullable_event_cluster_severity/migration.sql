ALTER TABLE "global_event_clusters"
  ALTER COLUMN "normalized_severity" DROP NOT NULL;

ALTER TABLE "global_event_clusters"
  DROP CONSTRAINT "global_event_clusters_severity_check",
  ADD CONSTRAINT "global_event_clusters_severity_check"
  CHECK ("normalized_severity" IS NULL OR "normalized_severity" BETWEEN 0 AND 100);
