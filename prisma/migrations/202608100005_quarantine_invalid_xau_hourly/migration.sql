UPDATE dataset_versions AS version
SET is_active = false
FROM datasets AS dataset,
     assets AS asset,
     data_providers AS provider
WHERE version.dataset_id = dataset.id
  AND dataset.asset_id = asset.id
  AND version.provider_id = provider.id
  AND version.is_active = true
  AND asset.symbol = 'XAU'
  AND dataset.timeframe = '1h'
  AND provider.code = 'dukascopy-via-vnstock';
