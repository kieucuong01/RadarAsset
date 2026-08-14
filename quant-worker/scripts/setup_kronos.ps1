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
$lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json

New-Item -ItemType Directory -Force -Path $runtimeRoot, $modelRoot | Out-Null

if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot ".git"))) {
  git clone --filter=blob:none $lock.source.url $sourceRoot
}
git -C $sourceRoot fetch --depth 1 origin $lock.source.revision
git -C $sourceRoot checkout --detach $lock.source.revision
$resolvedSource = (git -C $sourceRoot rev-parse HEAD).Trim()
if ($resolvedSource -ne $lock.source.revision) {
  throw "Source revision mismatch: expected $($lock.source.revision), got $resolvedSource"
}

if (-not $SkipDependencies) {
  & $Python -m pip install -r (Join-Path $workerRoot "requirements-kronos.txt")
}

$downloadScript = @'
import json
import sys
from pathlib import Path
from huggingface_hub import snapshot_download

lock_path, model_root = Path(sys.argv[1]), Path(sys.argv[2])
lock = json.loads(lock_path.read_text(encoding="utf-8"))
for name in ("model", "tokenizer"):
    item = lock[name]
    local_dir = model_root / "resolved-revisions"
    local_dir.mkdir(parents=True, exist_ok=True)
    resolved = Path(snapshot_download(
        repo_id=item["id"],
        revision=item["revision"],
        cache_dir=model_root,
    ))
    if resolved.name != item["revision"]:
        raise RuntimeError(f"Resolved revision mismatch for {name}: {resolved.name}")
    revision_file = local_dir / f"{name}.txt"
    revision_file.write_text(item["revision"], encoding="utf-8")
    if revision_file.read_text(encoding="utf-8").strip() != item["revision"]:
        raise RuntimeError(f"Resolved revision mismatch for {name}: {resolved}")
'@
& $Python -c $downloadScript $lockPath $modelRoot

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
