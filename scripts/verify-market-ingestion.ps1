param(
    [string]$PythonExecutable = "python",
    [string]$EnvFile = ".env.local",
    [ValidateRange(1, 168)]
    [int]$MaximumBacklogAgeHours = 6,
    [ValidateRange(0, 10000)]
    [int]$MaximumRecentFailures = 0
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$taskRepositoryRoot = Split-Path -Parent $PSScriptRoot
$taskVerifier = Join-Path $taskRepositoryRoot "quant-worker\verify_market_ingestion.py"
$taskPython = (Get-Command -Name $PythonExecutable -ErrorAction Stop).Source

& $taskPython $taskVerifier "--env-file" $EnvFile "--maximum-backlog-age-hours" $MaximumBacklogAgeHours "--maximum-recent-failures" $MaximumRecentFailures
if ($null -eq $LASTEXITCODE -or $LASTEXITCODE -ne 0) {
    Exit 1
}
Exit 0
