param(
    [string]$PythonExecutable = "python"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
Set-StrictMode -Version Latest

$taskRepositoryRoot = Split-Path -Parent $PSScriptRoot
$taskMarketIngestion = Join-Path $PSScriptRoot "run-market-ingestion.ps1"
$taskEnvFile = Join-Path $taskRepositoryRoot ".env.local"
$taskSmartInsights = Join-Path $PSScriptRoot "run-smart-insights.ps1"
& $taskMarketIngestion -Command "daily" -PythonExecutable $PythonExecutable -DrainRequests -MaxRequestTotal 1000
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $taskSmartInsights -Schedule "daily" -PythonExecutable $PythonExecutable
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $taskSmartInsights -Schedule "calendar-current" -PythonExecutable $PythonExecutable
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $taskSmartInsights -Schedule "briefing" -PythonExecutable $PythonExecutable -AllMemberships
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

exit 0
