ALTER TABLE "economic_events"
  ADD COLUMN "source_code" TEXT,
  ADD COLUMN "source_event_key" TEXT,
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "actual" TEXT,
  ADD COLUMN "event_date" DATE,
  ADD COLUMN "time_status" TEXT,
  ADD COLUMN "source_timezone" TEXT,
  ADD COLUMN "detail_url" TEXT,
  ADD COLUMN "raw_snapshot_id" UUID,
  ADD COLUMN "published_at" TIMESTAMPTZ(3),
  ADD COLUMN "observed_at" TIMESTAMPTZ(3),
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "quality_status" TEXT NOT NULL DEFAULT 'passed',
  ADD COLUMN "quality_flags" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "economic_events"
  ALTER COLUMN "event_at" TYPE TIMESTAMPTZ(3)
  USING "event_at" AT TIME ZONE 'UTC';

UPDATE "economic_events"
SET
  "source_code" = 'seed',
  "source_event_key" = 'seed:' || "id"::text,
  "currency" = CASE "country"
    WHEN 'US' THEN 'USD'
    WHEN 'EU' THEN 'EUR'
    WHEN 'VN' THEN 'VND'
    ELSE "country"
  END,
  "impact" = CASE WHEN "impact" = 'mid' THEN 'medium' ELSE "impact" END,
  "event_date" = ("event_at" AT TIME ZONE 'UTC')::date,
  "time_status" = 'timed',
  "source_timezone" = 'UTC',
  "observed_at" = "created_at" AT TIME ZONE 'UTC',
  "quality_status" = 'sample';

ALTER TABLE "economic_events"
  ALTER COLUMN "source_code" SET NOT NULL,
  ALTER COLUMN "source_event_key" SET NOT NULL,
  ALTER COLUMN "currency" SET NOT NULL,
  ALTER COLUMN "event_date" SET NOT NULL,
  ALTER COLUMN "event_at" DROP NOT NULL,
  ALTER COLUMN "time_status" SET NOT NULL,
  ALTER COLUMN "source_timezone" SET NOT NULL,
  ALTER COLUMN "observed_at" SET NOT NULL;

DROP INDEX "economic_events_event_at_idx";

CREATE UNIQUE INDEX "economic_events_source_code_source_event_key_revision_key"
  ON "economic_events"("source_code", "source_event_key", "revision");
CREATE INDEX "economic_events_event_date_impact_idx"
  ON "economic_events"("event_date", "impact");
CREATE INDEX "economic_events_event_at_impact_idx"
  ON "economic_events"("event_at", "impact");
CREATE INDEX "economic_events_source_code_source_event_key_revision_idx"
  ON "economic_events"("source_code", "source_event_key", "revision" DESC);
CREATE INDEX "economic_events_raw_snapshot_id_idx"
  ON "economic_events"("raw_snapshot_id");

ALTER TABLE "economic_events"
  ADD CONSTRAINT "economic_events_raw_snapshot_id_fkey"
    FOREIGN KEY ("raw_snapshot_id") REFERENCES "insight_raw_snapshots"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "economic_events_impact_check"
    CHECK ("impact" IN ('high', 'medium', 'low')),
  ADD CONSTRAINT "economic_events_revision_check"
    CHECK ("revision" > 0),
  ADD CONSTRAINT "economic_events_quality_check"
    CHECK ("quality_status" IN ('passed', 'warning', 'conflicting', 'sample')),
  ADD CONSTRAINT "economic_events_time_status_check"
    CHECK (
      ("time_status" = 'timed' AND "event_at" IS NOT NULL)
      OR ("time_status" IN ('all_day', 'tentative') AND "event_at" IS NULL)
    );
