param(
    [ValidateSet("all", "hourly", "daily")]
    [string]$Command = "all",
    [string]$PythonExecutable = "python",
    [switch]$DryRun,
    [switch]$DrainRequests,
    [ValidateRange(1, 10000)]
    [int]$MaxRequestTotal = 10000,
    [ValidateRange(1, 10000)]
    [int]$RetryLimit = 500,
    [string]$OrganizationSlug = $env:QUANT_WORKER_ORGANIZATION_SLUG,
    [string]$UserEmail = $env:QUANT_WORKER_USER_EMAIL
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$taskRepositoryRoot = Split-Path -Parent $PSScriptRoot
$taskCliPath = Join-Path $taskRepositoryRoot "quant-worker\ingest_market_data.py"
$taskCatalogSyncPath = Join-Path $taskRepositoryRoot "quant-worker\sync_provider_instruments.py"
$taskRequestCliPath = Join-Path $taskRepositoryRoot "quant-worker\process_ingestion_requests.py"
$taskCorporateActionPath = Join-Path $taskRepositoryRoot "quant-worker\sync_corporate_actions.py"
$taskAdjustedDatasetPath = Join-Path $taskRepositoryRoot "quant-worker\publish_adjusted_datasets.py"
$taskVerificationPath = Join-Path $taskRepositoryRoot "scripts\verify-market-ingestion.ps1"
$taskOperationsCliPath = Join-Path $taskRepositoryRoot "quant-worker\verify_market_ingestion.py"
$taskEnvPath = Join-Path $taskRepositoryRoot ".env.local"
$taskPython = (Get-Command -Name $PythonExecutable -ErrorAction Stop).Source
$taskRuntimeDirectory = Join-Path ([IO.Path]::GetTempPath()) "radarasset-market-ingestion"
New-Item -ItemType Directory -Path $taskRuntimeDirectory -Force | Out-Null
$taskArguments = @($taskCliPath, $Command, "--env-file", $taskEnvPath)
if ($DryRun) {
    $taskArguments += "--dry-run"
}

$taskExitCode = 0
$env:QUANT_WORKER_ORGANIZATION_SLUG = $OrganizationSlug
$env:QUANT_WORKER_USER_EMAIL = $UserEmail
$schedulerRunId = $null
if (-not $DryRun) {
    $schedulerRun = & $taskPython $taskOperationsCliPath "--env-file" $taskEnvPath "--start-command" $Command
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $schedulerRunId = ($schedulerRun | ConvertFrom-Json).runId
}
Push-Location $taskRuntimeDirectory
try {
    & $taskPython @taskArguments
    if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        $taskExitCode = $LASTEXITCODE
    }
}
finally {
    Pop-Location
}

if (-not $DryRun) {
    Push-Location $taskRuntimeDirectory
    try {
        & $taskPython $taskCatalogSyncPath "--queue-ingestion" $Command "--env-file" $taskEnvPath
        if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
            if ($taskExitCode -eq 0) { $taskExitCode = $LASTEXITCODE }
        }
    }
    finally {
        Pop-Location
    }
}

if (-not $DryRun) {
    Push-Location $taskRuntimeDirectory
    try {
        $taskRequestArguments = @(
            $taskRequestCliPath,
            "--retry-failed", "--retry-limit", [string]$RetryLimit,
            "--limit", "20", "--drain", "--max-total", [string]$MaxRequestTotal,
            "--env-file", $taskEnvPath
        )
        & $taskPython @taskRequestArguments
        if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0 -and $taskExitCode -eq 0) {
            $taskExitCode = $LASTEXITCODE
        }
    }
    finally {
        Pop-Location
    }
}

if (-not $DryRun -and $Command -in @("daily", "all")) {
    Push-Location $taskRuntimeDirectory
    try {
        & $taskPython $taskCorporateActionPath "--env-file" $taskEnvPath
        if ($LASTEXITCODE -ne 0 -and $taskExitCode -eq 0) { $taskExitCode = $LASTEXITCODE }
        & $taskPython $taskAdjustedDatasetPath "--env-file" $taskEnvPath
        if ($LASTEXITCODE -ne 0 -and $taskExitCode -eq 0) { $taskExitCode = $LASTEXITCODE }
    }
    finally {
        Pop-Location
    }
}

if (-not $DryRun) {
    & $taskVerificationPath -PythonExecutable $taskPython -EnvFile $taskEnvPath
    if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0 -and $taskExitCode -eq 0) {
        $taskExitCode = $LASTEXITCODE
    }
    $schedulerStatus = if ($taskExitCode -eq 0) { "succeeded" } else { "failed" }
    & $taskPython $taskOperationsCliPath "--env-file" $taskEnvPath "--finish-run" $schedulerRunId "--finish-status" $schedulerStatus
    if ($LASTEXITCODE -ne 0 -and $taskExitCode -eq 0) { $taskExitCode = $LASTEXITCODE }
}

exit $taskExitCode
