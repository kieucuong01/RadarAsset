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
$taskDailyVerifier = Join-Path $taskRepositoryRoot "quant-worker\verify_daily_pipeline.py"
$taskProjectPython = Join-Path $taskRepositoryRoot ".venv\Scripts\python.exe"
$taskPython = if ($PythonExecutable -eq "python" -and (Test-Path -LiteralPath $taskProjectPython -PathType Leaf)) {
    $taskProjectPython
}
else {
    (Get-Command -Name $PythonExecutable -ErrorAction Stop).Source
}
& $taskMarketIngestion -Command "daily" -PythonExecutable $taskPython -DrainRequests -MaxRequestTotal 1000
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $taskSmartInsights -Schedule "daily" -PythonExecutable $taskPython
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $taskSmartInsights -Schedule "calendar-current" -PythonExecutable $taskPython
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $taskSmartInsights -Schedule "briefing" -PythonExecutable $taskPython -AllMemberships
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $taskPython $taskDailyVerifier "--env-file" $taskEnvFile "--timezone" "Asia/Bangkok"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

exit 0
