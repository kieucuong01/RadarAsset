CREATE TABLE "asset_listing_periods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asset_id" UUID NOT NULL,
  "provider_instrument_id" UUID NOT NULL,
  "provider_code" TEXT NOT NULL,
  "provider_symbol" TEXT NOT NULL,
  "venue" TEXT,
  "status" TEXT NOT NULL,
  "valid_from" TIMESTAMPTZ(3) NOT NULL,
  "valid_to" TIMESTAMPTZ(3),
  "confirmation_count" INTEGER NOT NULL DEFAULT 1,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "asset_listing_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "asset_listing_periods_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "asset_listing_periods_provider_instrument_id_fkey" FOREIGN KEY ("provider_instrument_id") REFERENCES "provider_instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "asset_listing_periods_range_check" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from"),
  CONSTRAINT "asset_listing_periods_confirmation_check" CHECK ("confirmation_count" >= 1)
);

CREATE UNIQUE INDEX "asset_listing_periods_provider_instrument_id_valid_from_key"
  ON "asset_listing_periods"("provider_instrument_id", "valid_from");
CREATE INDEX "asset_listing_periods_asset_id_valid_from_valid_to_idx"
  ON "asset_listing_periods"("asset_id", "valid_from", "valid_to");
CREATE INDEX "asset_listing_periods_provider_code_status_valid_to_idx"
  ON "asset_listing_periods"("provider_code", "status", "valid_to");
