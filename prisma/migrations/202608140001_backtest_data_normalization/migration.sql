ALTER TABLE "assets"
ADD COLUMN "listing_status" TEXT NOT NULL DEFAULT 'active';

ALTER TABLE "provider_instruments"
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "provider_instruments_provider_id_is_active_idx"
  ON "provider_instruments"("provider_id", "is_active");

CREATE TABLE "corporate_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asset_id" UUID NOT NULL,
  "provider_instrument_id" UUID NOT NULL,
  "provider_event_id" TEXT NOT NULL,
  "action_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'unverified',
  "public_date" DATE,
  "ex_right_date" DATE,
  "record_date" DATE,
  "payment_date" DATE,
  "cash_per_share" DECIMAL(20,8),
  "distribution_ratio" DECIMAL(20,10),
  "subscription_ratio" DECIMAL(20,10),
  "subscription_price" DECIMAL(20,8),
  "old_symbol" TEXT,
  "new_symbol" TEXT,
  "checksum" TEXT NOT NULL,
  "source_payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "observed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "corporate_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "corporate_actions_action_type_check" CHECK (
    "action_type" IN ('cash_dividend', 'stock_dividend', 'split', 'rights_issue', 'symbol_change')
  ),
  CONSTRAINT "corporate_actions_status_check" CHECK (
    "status" IN ('verified', 'unverified', 'rejected')
  ),
  CONSTRAINT "corporate_actions_asset_id_fkey" FOREIGN KEY ("asset_id")
    REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "corporate_actions_provider_instrument_id_fkey" FOREIGN KEY ("provider_instrument_id")
    REFERENCES "provider_instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "corporate_actions_provider_instrument_id_provider_event_id_key"
  ON "corporate_actions"("provider_instrument_id", "provider_event_id");
CREATE INDEX "corporate_actions_asset_id_ex_right_date_idx"
  ON "corporate_actions"("asset_id", "ex_right_date");
CREATE INDEX "corporate_actions_status_action_type_idx"
  ON "corporate_actions"("status", "action_type");

CREATE TABLE "instrument_catalog_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider_code" TEXT NOT NULL,
  "asset_id" UUID NOT NULL,
  "provider_symbol" TEXT NOT NULL,
  "venue" TEXT,
  "listing_status" TEXT NOT NULL,
  "observed_at" TIMESTAMPTZ(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "instrument_catalog_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "instrument_catalog_snapshots_listing_status_check" CHECK (
    "listing_status" IN ('active', 'inactive', 'delisted', 'unknown')
  ),
  CONSTRAINT "instrument_catalog_snapshots_asset_id_fkey" FOREIGN KEY ("asset_id")
    REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "instrument_catalog_snapshots_provider_code_asset_id_observed_at_key"
  ON "instrument_catalog_snapshots"("provider_code", "asset_id", "observed_at");
CREATE INDEX "instrument_catalog_snapshots_asset_id_observed_at_idx"
  ON "instrument_catalog_snapshots"("asset_id", "observed_at" DESC);
CREATE INDEX "instrument_catalog_snapshots_provider_code_listing_status_observed_at_idx"
  ON "instrument_catalog_snapshots"("provider_code", "listing_status", "observed_at" DESC);

CREATE TABLE "market_calendar_versions" (
  "id" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "session_rules" JSONB NOT NULL,
  "closure_dates" JSONB NOT NULL,
  "checksum" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "market_calendar_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "market_calendar_versions_venue_version_key"
  ON "market_calendar_versions"("venue", "version");
CREATE INDEX "market_calendar_versions_venue_effective_from_idx"
  ON "market_calendar_versions"("venue", "effective_from");
