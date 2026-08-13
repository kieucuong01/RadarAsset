param(
    [ValidateSet("daily", "weekly", "monthly", "calendar-current", "calendar-next", "calendar-event")]
    [string]$Schedule = "daily",
    [string]$PythonExecutable = "python",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".env.local"
$projectPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
if ($PythonExecutable -eq "python" -and (Test-Path -LiteralPath $projectPython)) {
    $PythonExecutable = $projectPython
}

$runtimeRoot = Join-Path ([System.IO.Path]::GetTempPath()) "quant-insight-radar-smart-insights"
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$env:TEMP = $runtimeRoot
$env:TMP = $runtimeRoot
$env:PYTHONPATH = Join-Path $repoRoot "quant-worker"

$arguments = @(
    "-X", "utf8",
    (Join-Path $repoRoot "quant-worker\collect_smart_insights.py"),
    $Schedule,
    "--env-file", $envFile
)
if ($DryRun) {
    $arguments += "--dry-run"
}

& $PythonExecutable @arguments
exit $LASTEXITCODE
