UPDATE "portfolio_transactions" AS transaction
SET "price" = transaction."price" * 1000
FROM "assets" AS asset
WHERE asset."id" = transaction."asset_id"
  AND asset."market" = 'vn_equity'
  AND asset."asset_class" = 'equity'
  AND transaction."currency" = 'VND'
  AND transaction."price" < 1000;

UPDATE "portfolio_positions" AS position
SET "average_cost" = position."average_cost" * 1000
FROM "assets" AS asset
WHERE asset."id" = position."asset_id"
  AND asset."market" = 'vn_equity'
  AND asset."asset_class" = 'equity'
  AND position."average_cost" < 1000;
