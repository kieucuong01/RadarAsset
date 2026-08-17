CREATE TABLE "fx_rates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "base_currency" TEXT NOT NULL,
  "quote_currency" TEXT NOT NULL,
  "effective_date" DATE NOT NULL,
  "transfer_buy" DECIMAL(20,8) NOT NULL,
  "sell" DECIMAL(20,8) NOT NULL,
  "mid" DECIMAL(20,8) NOT NULL,
  "source" TEXT NOT NULL,
  "fetched_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fx_rates_positive_values" CHECK (
    "transfer_buy" > 0 AND "sell" > 0 AND "mid" > 0
  )
);

CREATE UNIQUE INDEX "fx_rates_base_currency_quote_currency_effective_date_source_key"
  ON "fx_rates"("base_currency", "quote_currency", "effective_date", "source");
CREATE INDEX "fx_rates_base_currency_quote_currency_effective_date_idx"
  ON "fx_rates"("base_currency", "quote_currency", "effective_date" DESC);

ALTER TABLE "portfolio_transactions"
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN "fx_rate_to_vnd" DECIMAL(20,8) NOT NULL DEFAULT 26000,
  ADD COLUMN "fx_effective_date" DATE,
  ADD COLUMN "fx_source" TEXT,
  ADD COLUMN "fx_fallback" BOOLEAN NOT NULL DEFAULT true;

UPDATE "portfolio_transactions" AS transaction
SET "currency" = CASE
      WHEN UPPER(asset."currency") = 'VND' THEN 'VND'
      ELSE 'USD'
    END,
    "fx_rate_to_vnd" = CASE
      WHEN UPPER(asset."currency") = 'VND' THEN 1
      ELSE 26000
    END,
    "fx_source" = CASE
      WHEN UPPER(asset."currency") = 'VND' THEN 'identity'
      ELSE 'fallback'
    END,
    "fx_fallback" = UPPER(asset."currency") <> 'VND'
FROM "assets" AS asset
WHERE asset."id" = transaction."asset_id";
