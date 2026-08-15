param(
    [string]$PythonExecutable = "python"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
Set-StrictMode -Version Latest

$taskRepositoryRoot = Split-Path -Parent $PSScriptRoot
$taskMarketIngestion = Join-Path $taskRepositoryRoot "quant-worker\ingest_market_data.py"
$taskEnvFile = Join-Path $taskRepositoryRoot ".env.local"
$taskSmartInsights = Join-Path $PSScriptRoot "run-smart-insights.ps1"
$taskScopeVerification = Join-Path $taskRepositoryRoot "quant-worker\verify_market_ingestion.py"
$taskAssets = @(
    "VNINDEX", "VN30", "FPT",
    "BTC", "ETH", "XRP", "SOL", "BNB", "ADA", "LINK", "LTC",
    "AVAX", "TRX", "ZEC", "XLM",
    "XAU"
)

& $PythonExecutable $taskScopeVerification "--retire-out-of-scope" "--env-file" $taskEnvFile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

foreach ($taskAsset in $taskAssets) {
    & $PythonExecutable $taskMarketIngestion "all" "--asset" $taskAsset "--timeframe" "1d" "--env-file" $taskEnvFile
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

& $taskSmartInsights -Schedule "daily" -PythonExecutable $PythonExecutable
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $taskSmartInsights -Schedule "calendar-current" -PythonExecutable $PythonExecutable
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $taskSmartInsights -Schedule "briefing" -PythonExecutable $PythonExecutable -AllMemberships
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

exit 0
