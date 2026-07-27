CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "app_users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "symbol" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "asset_class" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "provider" TEXT,
  "provider_symbol" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "market_bars" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asset_id" UUID NOT NULL,
  "timeframe" TEXT NOT NULL DEFAULT '1d',
  "ts" TIMESTAMP(3) NOT NULL,
  "open" DECIMAL(20,8) NOT NULL,
  "high" DECIMAL(20,8) NOT NULL,
  "low" DECIMAL(20,8) NOT NULL,
  "close" DECIMAL(20,8) NOT NULL,
  "volume" DECIMAL(24,4),
  "source" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "market_bars_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portfolios" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "base_currency" TEXT NOT NULL DEFAULT 'USD',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portfolio_positions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "portfolio_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "quantity" DECIMAL(28,10) NOT NULL,
  "average_cost" DECIMAL(20,8) NOT NULL,
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "portfolio_positions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portfolio_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "portfolio_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "quantity" DECIMAL(28,10) NOT NULL,
  "price" DECIMAL(20,8) NOT NULL,
  "note" TEXT,
  "executed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portfolio_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "watchlist_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "alert" DECIMAL(20,8),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_insights" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asset_id" UUID,
  "source" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "sentiment" TEXT NOT NULL,
  "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "economic_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "impact" TEXT NOT NULL,
  "forecast" TEXT,
  "previous" TEXT,
  "event_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "economic_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quant_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "strategy_name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "parameters" JSONB NOT NULL DEFAULT '{}',
  "metrics" JSONB,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_users_email_key" ON "app_users"("email");
CREATE UNIQUE INDEX "assets_symbol_key" ON "assets"("symbol");
CREATE INDEX "assets_asset_class_idx" ON "assets"("asset_class");
CREATE UNIQUE INDEX "market_bars_asset_id_timeframe_ts_key" ON "market_bars"("asset_id", "timeframe", "ts");
CREATE INDEX "market_bars_asset_id_timeframe_ts_idx" ON "market_bars"("asset_id", "timeframe", "ts" DESC);
CREATE INDEX "portfolios_user_id_idx" ON "portfolios"("user_id");
CREATE UNIQUE INDEX "portfolio_positions_portfolio_id_asset_id_key" ON "portfolio_positions"("portfolio_id", "asset_id");
CREATE INDEX "portfolio_positions_asset_id_idx" ON "portfolio_positions"("asset_id");
CREATE INDEX "portfolio_transactions_portfolio_id_executed_at_idx" ON "portfolio_transactions"("portfolio_id", "executed_at" DESC);
CREATE INDEX "portfolio_transactions_asset_id_idx" ON "portfolio_transactions"("asset_id");
CREATE UNIQUE INDEX "watchlist_items_user_id_asset_id_key" ON "watchlist_items"("user_id", "asset_id");
CREATE INDEX "watchlist_items_asset_id_idx" ON "watchlist_items"("asset_id");
CREATE INDEX "ai_insights_asset_id_published_at_idx" ON "ai_insights"("asset_id", "published_at" DESC);
CREATE INDEX "economic_events_event_at_idx" ON "economic_events"("event_at");
CREATE INDEX "quant_runs_user_id_created_at_idx" ON "quant_runs"("user_id", "created_at" DESC);
CREATE INDEX "quant_runs_status_created_at_idx" ON "quant_runs"("status", "created_at");

ALTER TABLE "market_bars" ADD CONSTRAINT "market_bars_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_positions" ADD CONSTRAINT "portfolio_positions_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_positions" ADD CONSTRAINT "portfolio_positions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "portfolio_transactions" ADD CONSTRAINT "portfolio_transactions_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_transactions" ADD CONSTRAINT "portfolio_transactions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quant_runs" ADD CONSTRAINT "quant_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
