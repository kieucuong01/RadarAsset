[CmdletBinding()]
param(
  [string]$Python = "python",
  [switch]$SkipDependencies
)

$ErrorActionPreference = "Stop"
$workerRoot = Split-Path -Parent $PSScriptRoot
$lockPath = Join-Path $workerRoot "third_party\kronos.lock.json"
$runtimeRoot = Join-Path $workerRoot ".runtime"
$sourceRoot = Join-Path $runtimeRoot "kronos-source"
$modelRoot = Join-Path $runtimeRoot "models"
$manifestPath = Join-Path $runtimeRoot "sha256-manifest.json"
$downloadHelper = Join-Path $PSScriptRoot "download_kronos_runtime.py"
$lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json

New-Item -ItemType Directory -Force -Path $runtimeRoot, $modelRoot | Out-Null
if (Test-Path -LiteralPath $manifestPath) {
  Remove-Item -LiteralPath $manifestPath
}

if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot ".git"))) {
  git clone --filter=blob:none $lock.source.url $sourceRoot
  if ($LASTEXITCODE -ne 0) { throw "Kronos source clone failed." }
}
git -C $sourceRoot fetch --depth 1 origin $lock.source.revision
if ($LASTEXITCODE -ne 0) { throw "Kronos source fetch failed." }
git -C $sourceRoot checkout --detach $lock.source.revision
if ($LASTEXITCODE -ne 0) { throw "Kronos source checkout failed." }
$resolvedSource = (git -C $sourceRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw "Kronos source revision check failed." }
if ($resolvedSource -ne $lock.source.revision) {
  throw "Source revision mismatch: expected $($lock.source.revision), got $resolvedSource"
}

if (-not $SkipDependencies) {
  & $Python -m pip install -r (Join-Path $workerRoot "requirements-kronos.txt")
  if ($LASTEXITCODE -ne 0) { throw "Kronos dependency installation failed." }
}

& $Python $downloadHelper $lockPath $modelRoot
if ($LASTEXITCODE -ne 0) { throw "Pinned Kronos model download or verification failed." }

$entries = @()
Get-ChildItem -LiteralPath $runtimeRoot -Recurse -File |
  Where-Object { $_.FullName -ne $manifestPath -and $_.FullName -notmatch '\\.git\\' } |
  Sort-Object FullName |
  ForEach-Object {
    $entries += [ordered]@{
      path = $_.FullName.Substring($runtimeRoot.Length + 1).Replace("\", "/")
      sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
    }
  }
[ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceRevision = $resolvedSource
  files = $entries
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -LiteralPath $manifestPath

Write-Host "Kronos runtime verified at $runtimeRoot"
