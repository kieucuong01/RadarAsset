param(
    [ValidateSet("all", "hourly", "daily")]
    [string]$Command = "all",
    [string]$PythonExecutable = "python",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$taskRepositoryRoot = Split-Path -Parent $PSScriptRoot
$taskCliPath = Join-Path $taskRepositoryRoot "quant-worker\ingest_market_data.py"
$taskEnvPath = Join-Path $taskRepositoryRoot ".env.local"
$taskPython = (Get-Command -Name $PythonExecutable -ErrorAction Stop).Source
$taskRuntimeDirectory = Join-Path ([IO.Path]::GetTempPath()) "radarasset-market-ingestion"
New-Item -ItemType Directory -Path $taskRuntimeDirectory -Force | Out-Null
$taskArguments = @($taskCliPath, $Command, "--env-file", $taskEnvPath)
if ($DryRun) {
    $taskArguments += "--dry-run"
}

$taskExitCode = 1
Push-Location $taskRuntimeDirectory
try {
    & $taskPython @taskArguments
    if ($null -ne $LASTEXITCODE) {
        $taskExitCode = $LASTEXITCODE
    }
}
finally {
    Pop-Location
}

exit $taskExitCode
