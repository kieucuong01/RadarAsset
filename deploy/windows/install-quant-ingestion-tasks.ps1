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
    $legacyTaskNames = @(
        "RadarAsset Market Ingestion Hourly",
        "RadarAsset Smart Insights Four Hourly"
    )
    foreach ($legacyTaskName in $legacyTaskNames) {
        $legacyTask = Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
        if ($null -ne $legacyTask -and $legacyTask.State -ne "Disabled") {
            throw "Legacy intraday task '$legacyTaskName' is still enabled."
        }
    }
    $expectedTasks = @(
        @{ Name = "RadarAsset Intelligence Daily"; Argument = "refresh-asset-opinions.ps1"; Schedule = $null },
        @{ Name = "RadarAsset Intelligence Weekly"; Argument = "run-smart-insights.ps1"; Schedule = "weekly" }
    )
    foreach ($expected in $expectedTasks) {
        $task = Get-ScheduledTask -TaskName $expected.Name -ErrorAction Stop
        $taskInfo = Get-ScheduledTaskInfo -TaskName $expected.Name -ErrorAction Stop
        $action = @($task.Actions)[0]
        if ($null -eq $action -or $action.Execute -notlike "*powershell.exe") {
            throw "Scheduled task '$($expected.Name)' has an invalid executable."
        }
        if ($action.Arguments -notlike "*$($expected.Argument)*") {
            throw "Scheduled task '$($expected.Name)' has an invalid action path."
        }
        if ($null -ne $expected.Schedule -and $action.Arguments -notlike "*$($expected.Schedule)*") {
            throw "Scheduled task '$($expected.Name)' has an invalid schedule action."
        }
        if ($task.State -notin @("Ready", "Running")) {
            throw "Scheduled task '$($expected.Name)' is not ready."
        }
        if ($taskInfo.LastTaskResult -notin @(0, 267011)) {
            throw "Scheduled task '$($expected.Name)' last run failed with $($taskInfo.LastTaskResult)."
        }
        [pscustomobject]@{
            TaskName = $expected.Name
            State = $task.State
            LastTaskResult = $taskInfo.LastTaskResult
            Action = $action.Arguments
        }
    }
    return
}

$legacyTaskNames = @(
    "RadarAsset Market Ingestion Hourly",
    "RadarAsset Market Ingestion Daily",
    "RadarAsset Smart Insights Four Hourly"
)
foreach ($legacyTaskName in $legacyTaskNames) {
    $legacyTask = Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
    if ($null -ne $legacyTask -and $legacyTask.State -ne "Disabled") {
        Disable-ScheduledTask -TaskName $legacyTaskName | Out-Null
    }
}

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $TaskUser -LogonType S4U -RunLevel Limited
$dailyAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument (
    "-NoProfile -ExecutionPolicy Bypass -File `"$dailyWrapper`""
)
$weeklyAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument (
    "-NoProfile -ExecutionPolicy Bypass -File `"$smartInsightsWrapper`" -Schedule weekly"
)

$dailyUtc = [DateTimeOffset]::new(
    [DateTimeOffset]::UtcNow.Year, [DateTimeOffset]::UtcNow.Month,
    [DateTimeOffset]::UtcNow.Day, 1, 15, 0, [TimeSpan]::Zero
)
if ($dailyUtc -le [DateTimeOffset]::UtcNow) { $dailyUtc = $dailyUtc.AddDays(1) }
$dailyStart = $dailyUtc.ToLocalTime().DateTime

$dailyTrigger = New-ScheduledTaskTrigger -Daily -At $dailyStart
$weeklyTrigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday -At $dailyStart

Register-ScheduledTask -TaskName "RadarAsset Intelligence Daily" -Action $dailyAction -Trigger $dailyTrigger -Settings $settings -Principal $principal -Force | Out-Null
Register-ScheduledTask -TaskName "RadarAsset Intelligence Weekly" -Action $weeklyAction -Trigger $weeklyTrigger -Settings $settings -Principal $principal -Force | Out-Null

Get-ScheduledTask -TaskName "RadarAsset Intelligence Daily", "RadarAsset Intelligence Weekly" |
    Select-Object TaskName, State
