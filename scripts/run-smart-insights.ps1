param(
    [ValidateSet("daily", "four-hourly", "weekly", "calendar-current", "calendar-next", "calendar-event", "briefing", "briefing-refresh", "replay")]
    [string]$Schedule = "daily",
    [string]$PythonExecutable = "python",
    [string]$Source,
    [switch]$LiveSmoke,
    [switch]$DryRun,
    [string]$OrganizationId,
    [string]$UserId,
    [switch]$AllMemberships,
    [string]$LocalDate,
    [string]$Timezone = "Asia/Bangkok",
    [string]$BriefingId,
    [switch]$CbbiBackfill
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
if ($Source) {
    $arguments += @("--source", $Source)
}
if ($LiveSmoke) {
    if (-not $Source) {
        throw "LiveSmoke requires a registered Source code."
    }
    $arguments += "--live-smoke"
}
if ($OrganizationId) { $arguments += @("--organization-id", $OrganizationId) }
if ($UserId) { $arguments += @("--user-id", $UserId) }
if ($AllMemberships) { $arguments += "--all-memberships" }
if ($LocalDate) { $arguments += @("--local-date", $LocalDate) }
if ($Timezone) { $arguments += @("--timezone", $Timezone) }
if ($BriefingId) { $arguments += @("--briefing-id", $BriefingId) }
if ($CbbiBackfill) { $arguments += "--cbbi-backfill" }

& $PythonExecutable @arguments
exit $LASTEXITCODE
