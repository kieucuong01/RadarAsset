param(
    [switch]$Install,
    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$TaskUser = $env:USERNAME
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $Install) {
    throw "Task installation is explicit. Re-run with -Install in the selected deployment environment."
}

$wrapper = Join-Path $RepositoryRoot "scripts\run-market-ingestion.ps1"
if (-not (Test-Path -LiteralPath $wrapper -PathType Leaf)) {
    throw "Market ingestion wrapper was not found."
}

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $TaskUser -LogonType S4U -RunLevel Highest
$hourlyAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument (
    "-NoProfile -ExecutionPolicy Bypass -File `"$wrapper`" -Command hourly"
)
$dailyAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument (
    "-NoProfile -ExecutionPolicy Bypass -File `"$wrapper`" -Command daily"
)

$nextHourUtc = [DateTimeOffset]::UtcNow.AddHours(1)
$hourlyStart = [DateTimeOffset]::new(
    $nextHourUtc.Year, $nextHourUtc.Month, $nextHourUtc.Day,
    $nextHourUtc.Hour, 10, 0, [TimeSpan]::Zero
).ToLocalTime().DateTime
$dailyUtc = [DateTimeOffset]::new(
    [DateTimeOffset]::UtcNow.Year, [DateTimeOffset]::UtcNow.Month,
    [DateTimeOffset]::UtcNow.Day, 1, 15, 0, [TimeSpan]::Zero
)
if ($dailyUtc -le [DateTimeOffset]::UtcNow) { $dailyUtc = $dailyUtc.AddDays(1) }
$dailyStart = $dailyUtc.ToLocalTime().DateTime

$hourlyTrigger = New-ScheduledTaskTrigger -Once -At $hourlyStart -RepetitionInterval (New-TimeSpan -Hours 1)
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At $dailyStart

Register-ScheduledTask -TaskName "RadarAsset Quant Ingestion Hourly" -Action $hourlyAction -Trigger $hourlyTrigger -Settings $settings -Principal $principal -Force | Out-Null
Register-ScheduledTask -TaskName "RadarAsset Quant Ingestion Daily" -Action $dailyAction -Trigger $dailyTrigger -Settings $settings -Principal $principal -Force | Out-Null

Get-ScheduledTask -TaskName "RadarAsset Quant Ingestion Hourly", "RadarAsset Quant Ingestion Daily" |
    Select-Object TaskName, State
