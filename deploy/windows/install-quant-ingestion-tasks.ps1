param(
    [switch]$Install,
    [switch]$Verify,
    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$TaskUser = $env:USERNAME
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
Set-StrictMode -Version Latest

if ($Install -eq $Verify) {
    throw "Choose -Install or -Verify for the selected deployment environment."
}

$wrapper = Join-Path $RepositoryRoot "scripts\run-market-ingestion.ps1"
if (-not (Test-Path -LiteralPath $wrapper -PathType Leaf)) {
    throw "Market ingestion wrapper was not found."
}
$dailyWrapper = Join-Path $RepositoryRoot "scripts\refresh-asset-opinions.ps1"
if (-not (Test-Path -LiteralPath $dailyWrapper -PathType Leaf)) {
    throw "Asset opinion refresh wrapper was not found."
}
$smartInsightsWrapper = Join-Path $RepositoryRoot "scripts\run-smart-insights.ps1"
if (-not (Test-Path -LiteralPath $smartInsightsWrapper -PathType Leaf)) {
    throw "Smart Insights wrapper was not found."
}

if ($Verify) {
    $taskNames = @(
        "RadarAsset Smart Insights Four Hourly",
        "RadarAsset Intelligence Daily",
        "RadarAsset Intelligence Weekly"
    )
    foreach ($taskName in $taskNames) {
        & schtasks.exe /Query /TN $taskName /FO LIST
        if ($LASTEXITCODE -ne 0) { throw "Scheduled task '$taskName' is not installed." }
    }
    return
}

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $TaskUser -LogonType S4U -RunLevel Highest
$fourHourlyAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument (
    "-NoProfile -ExecutionPolicy Bypass -File `"$smartInsightsWrapper`" -Schedule four-hourly"
)
$dailyAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument (
    "-NoProfile -ExecutionPolicy Bypass -File `"$dailyWrapper`""
)
$weeklyAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument (
    "-NoProfile -ExecutionPolicy Bypass -File `"$smartInsightsWrapper`" -Schedule weekly"
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

$fourHourlyTrigger = New-ScheduledTaskTrigger -Once -At $hourlyStart -RepetitionInterval (New-TimeSpan -Hours 4)
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At $dailyStart
$weeklyTrigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday -At $dailyStart

Register-ScheduledTask -TaskName "RadarAsset Smart Insights Four Hourly" -Action $fourHourlyAction -Trigger $fourHourlyTrigger -Settings $settings -Principal $principal -Force | Out-Null
Register-ScheduledTask -TaskName "RadarAsset Intelligence Daily" -Action $dailyAction -Trigger $dailyTrigger -Settings $settings -Principal $principal -Force | Out-Null
Register-ScheduledTask -TaskName "RadarAsset Intelligence Weekly" -Action $weeklyAction -Trigger $weeklyTrigger -Settings $settings -Principal $principal -Force | Out-Null

Get-ScheduledTask -TaskName "RadarAsset Smart Insights Four Hourly", "RadarAsset Intelligence Daily", "RadarAsset Intelligence Weekly" |
    Select-Object TaskName, State
