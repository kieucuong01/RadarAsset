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
$taskQueuedCount = 0
$taskRetriedCount = 0
$taskProcessedCount = 0
$taskFailedCount = 0
$taskErrorCode = $null
$env:QUANT_WORKER_ORGANIZATION_SLUG = $OrganizationSlug
$env:QUANT_WORKER_USER_EMAIL = $UserEmail
$schedulerRunId = $null
$schedulerFinished = $false
if (-not $DryRun) {
    $schedulerRun = & $taskPython $taskOperationsCliPath "--env-file" $taskEnvPath "--start-command" $Command
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $schedulerRunId = ($schedulerRun | ConvertFrom-Json).runId
}
try {
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
        $taskCatalogOutput = & $taskPython $taskCatalogSyncPath "--queue-ingestion" $Command "--env-file" $taskEnvPath
        $taskCatalogOutput | Write-Output
        try {
            $taskCatalogSummary = $taskCatalogOutput[-1] | ConvertFrom-Json
            if ($null -ne $taskCatalogSummary.queued) { $taskQueuedCount = [int]$taskCatalogSummary.queued }
        }
        catch { if ($taskExitCode -eq 0) { $taskExitCode = 1 }; $taskErrorCode = "catalog_summary_invalid" }
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
        $taskRequestOutput = & $taskPython @taskRequestArguments
        $taskRequestOutput | Write-Output
        try {
            $taskRequeueSummary = $taskRequestOutput | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object { $_.status -eq "requeued" } | Select-Object -Last 1
            $taskWorkerSummary = $taskRequestOutput[-1] | ConvertFrom-Json
            if ($null -ne $taskRequeueSummary) { $taskRetriedCount = [int]$taskRequeueSummary.count }
            if ($null -ne $taskWorkerSummary.processed) { $taskProcessedCount = [int]$taskWorkerSummary.processed }
            if ($null -ne $taskWorkerSummary.failed) { $taskFailedCount = [int]$taskWorkerSummary.failed }
        }
        catch { if ($taskExitCode -eq 0) { $taskExitCode = 1 }; $taskErrorCode = "worker_summary_invalid" }
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
        $taskCorporateActionExitCode = $LASTEXITCODE
        if ($taskCorporateActionExitCode -ne 0) {
            if ($taskExitCode -eq 0) { $taskExitCode = $taskCorporateActionExitCode }
            $taskErrorCode = "corporate_action_sync_failed"
        }
        else {
            & $taskPython $taskAdjustedDatasetPath "--env-file" $taskEnvPath
            if ($LASTEXITCODE -ne 0) {
                if ($taskExitCode -eq 0) { $taskExitCode = $LASTEXITCODE }
                $taskErrorCode = "adjusted_publication_failed"
            }
        }
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
}
}
catch {
    if ($taskExitCode -eq 0) { $taskExitCode = 1 }
}
finally {
    if (-not $DryRun -and $null -ne $schedulerRunId -and -not $schedulerFinished) {
        $schedulerStatus = if ($taskExitCode -eq 0) { "succeeded" } else { "failed" }
        $taskFinishArguments = @(
            $taskOperationsCliPath, "--env-file", $taskEnvPath,
            "--finish-run", $schedulerRunId, "--finish-status", $schedulerStatus,
            "--queued-count", [string]$taskQueuedCount,
            "--retried-count", [string]$taskRetriedCount,
            "--processed-count", [string]$taskProcessedCount,
            "--failed-count", [string]$taskFailedCount
        )
        if ($null -ne $taskErrorCode) { $taskFinishArguments += @("--error-code", $taskErrorCode) }
        & $taskPython @taskFinishArguments
        $schedulerFinished = $LASTEXITCODE -eq 0
        if (-not $schedulerFinished -and $taskExitCode -eq 0) { $taskExitCode = $LASTEXITCODE }
    }
}
exit $taskExitCode
