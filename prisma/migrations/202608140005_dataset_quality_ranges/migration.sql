ALTER TABLE "data_quality_issues"
  ADD COLUMN "classification" TEXT,
  ADD COLUMN "range_start" TIMESTAMPTZ(3),
  ADD COLUMN "range_end" TIMESTAMPTZ(3);

CREATE INDEX "data_quality_issues_dataset_version_id_classification_range_start_range_end_idx"
  ON "data_quality_issues"("dataset_version_id", "classification", "range_start", "range_end");

ALTER TABLE "data_quality_issues"
  ADD CONSTRAINT "data_quality_issues_range_order_check"
  CHECK ("range_start" IS NULL OR "range_end" IS NULL OR "range_end" >= "range_start");
