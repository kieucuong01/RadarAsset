-- Dataset checksums include UTC timestamps. Preserve the instant when converting
-- legacy timestamp-without-time-zone rows written in the database session zone.
ALTER TABLE "dataset_bars"
ALTER COLUMN "ts" TYPE TIMESTAMPTZ(3)
USING "ts" AT TIME ZONE current_setting('TimeZone');
