# UTF-8 with BOM — Windows PowerShell 5.1 otherwise misreads non-ASCII text and here-strings.
# Upload zip packs + manifest (few objects) to B2 as an archive copy.
# The app’s public “Download offline” host is Cloudflare R2 (PACKS_BASE in
# src/js/data.js), not this B2 prefix. Do not point github.io at B2 zips —
# Backblaze throttles large downloads. Prefer the R2 dashboard Upload.
# Individual img/vid for online play stay on the media prefix (upload-media.ps1).
#
# 1. scripts/build-media-packs.ps1   (zips in %LOCALAPPDATA%\prawko\packs)
# 2. powershell -ExecutionPolicy Bypass -File scripts/upload-packs.ps1
#
# Uses the same .b2env as upload-media.ps1 (B2_APPLICATION_KEY_ID / KEY / BUCKET).

param(
    [string]$PacksDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".b2env"
if (-not $PacksDir) { $PacksDir = Join-Path $env:LOCALAPPDATA "prawko\packs" }

function Read-DotEnv ([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        $eq = $line.IndexOf("=")
        if ($eq -lt 1) { return }
        $name = $line.Substring(0, $eq).Trim()
        $value = $line.Substring($eq + 1).Trim().Trim("'").Trim('"')
        Set-Item -Path "Env:$name" $value
    }
}

Read-DotEnv $envFile
$keyId = $env:B2_APPLICATION_KEY_ID
if (-not $keyId) { $keyId = $env:B2_KEY_ID }
$appKey = $env:B2_APPLICATION_KEY
if (-not $appKey) { $appKey = $env:B2_APP_KEY }
$bucket = $env:B2_BUCKET

$manifest = Join-Path $PacksDir "manifest.json"
if (-not (Test-Path -LiteralPath $manifest)) {
    throw "Missing $manifest. Run scripts/build-media-packs.ps1 first."
}
$zips = @(Get-ChildItem -LiteralPath $PacksDir -Filter "*.zip" -File -ErrorAction SilentlyContinue)
if ($zips.Count -eq 0) {
    throw "No .zip files in $PacksDir (run build-media-packs without -NoZip, with an img/vid folder)."
}
if (-not $keyId -or -not $appKey -or -not $bucket) {
    throw @"
Missing B2 credentials. Create $envFile (template: scripts/b2env.example) or set:
  B2_APPLICATION_KEY_ID
  B2_APPLICATION_KEY
  B2_BUCKET
"@
}

$b2 = Get-Command b2 -ErrorAction SilentlyContinue
if (-not $b2) {
    Write-Host "Installing b2 CLI (pip)..." -ForegroundColor Yellow
    python -m pip install --user b2
    $b2 = Get-Command b2 -ErrorAction SilentlyContinue
}
if (-not $b2) { throw "b2 command not found." }

Write-Host "Signing in to B2..." -ForegroundColor Cyan
& b2 account authorize $keyId $appKey
if ($LASTEXITCODE -ne 0) {
    & b2 authorize-account $keyId $appKey
    if ($LASTEXITCODE -ne 0) { throw "b2 authorize failed." }
}

Write-Host "Uploading packs -> b2://$bucket/packs/  ($($zips.Count) zip + manifest)..." -ForegroundColor Cyan
& b2 sync --allowEmptySource --skipNewer $PacksDir "b2://$bucket/packs/"
if ($LASTEXITCODE -ne 0) { throw "b2 sync packs failed ($LASTEXITCODE)" }

$corsFile = Join-Path $PSScriptRoot "b2-cors.json"
if (Test-Path -LiteralPath $corsFile) {
    Write-Host "Setting CORS..." -ForegroundColor Cyan
    & b2 bucket update --cors-rules (Get-Content -LiteralPath $corsFile -Raw) $bucket allPublic
    if ($LASTEXITCODE -ne 0) {
        & b2 update-bucket --corsRules (Get-Content -LiteralPath $corsFile -Raw) $bucket allPublic
    }
}

Write-Host ""
Write-Host "Done. Pack prefix (offline zip, not individual videos):" -ForegroundColor Green
Write-Host "  https://fXXX.backblazeb2.com/file/$bucket/packs/manifest.json"
Write-Host "Online play still uses .../img/ and .../vid/ (upload-media.ps1)."
