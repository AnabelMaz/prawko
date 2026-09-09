# UTF-8 with BOM — Windows PowerShell 5.1 otherwise misreads non-ASCII text and here-strings.
# Upload src/media to a public Backblaze B2 bucket (Windows).
# JSON questions stay in git; photos/films do not.
#
# 1. Free account: https://www.backblaze.com/b2/sign-up.html
# 2. B2 Cloud Storage -> Create a Bucket -> Files public, name e.g. prawko-maz
# 3. App Keys -> Add a New Application Key (this bucket, read+write)
# 4. Copy scripts/b2env.example to .b2env in the repo root and fill it in
# 5. powershell -ExecutionPolicy Bypass -File scripts/upload-media.ps1
#
# Syncs local img/ + vid/ to B2 (online play). Cloudflare zip packs are a separate
# step (build-media-packs + R2 dashboard). --skipNewer: files already on B2 are
# skipped; an empty bucket still gets a full upload.
# Default media folder matches convert-media.ps1 (ProgramData, then LocalAppData,
# then repo src\media). Override: -MediaDir.
#
# After the first upload, set MEDIA_CDN in src/js/data.js to the URL this script prints.
# CORS for GitHub Pages / localhost: scripts/b2-cors.json (applied at the end of this script).

param(
    [string]$MediaDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".b2env"

function Get-DefaultUploadMediaDir {
    $server = "C:\ProgramData\prawko\src\media"
    if ((Test-Path (Join-Path $server "img")) -or (Test-Path (Join-Path $server "vid"))) { return $server }
    $local = Join-Path $env:LOCALAPPDATA "prawko\media"
    if ((Test-Path (Join-Path $local "img")) -or (Test-Path (Join-Path $local "vid"))) { return $local }
    return (Join-Path $repoRoot "src\media")
}

if (-not $MediaDir) { $MediaDir = Get-DefaultUploadMediaDir }
$mediaDir = $MediaDir

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
$appKey = $env:B2_APPLICATION_KEY
$bucket = $env:B2_BUCKET
if (-not $keyId) { $keyId = $env:B2_KEY_ID }
if (-not $appKey) { $appKey = $env:B2_APP_KEY }

$img = Join-Path $mediaDir "img"
$vid = Join-Path $mediaDir "vid"
if (-not (Test-Path -LiteralPath $img) -or -not (Test-Path -LiteralPath $vid)) {
    throw "Missing $img or $vid. Convert a local pack from gov.pl first."
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
if (-not $b2) {
    throw "b2 command not found. Add Python's Scripts directory to PATH and try again."
}

Write-Host "Media: $mediaDir" -ForegroundColor Gray
Write-Host "Signing in to B2..." -ForegroundColor Cyan
& b2 account authorize $keyId $appKey
if ($LASTEXITCODE -ne 0) {
    & b2 authorize-account $keyId $appKey
    if ($LASTEXITCODE -ne 0) { throw "b2 authorize failed." }
}

Write-Host "Uploading images -> b2://$bucket/img/ ..." -ForegroundColor Cyan
& b2 sync --allowEmptySource --skipNewer $img "b2://$bucket/img/"
if ($LASTEXITCODE -ne 0) { throw "b2 sync img failed ($LASTEXITCODE)" }

Write-Host "Uploading videos -> b2://$bucket/vid/ (~3 GB, may take a while)..." -ForegroundColor Cyan
& b2 sync --allowEmptySource --skipNewer $vid "b2://$bucket/vid/"
if ($LASTEXITCODE -ne 0) { throw "b2 sync vid failed ($LASTEXITCODE)" }

$probe = Get-ChildItem -LiteralPath $img -File | Select-Object -First 1
$publicUrl = $null
if ($probe) {
    $info = & b2 file url "$bucket" "img/$($probe.Name)" 2>$null
    if (-not $info) { $info = & b2 get-url "b2://$bucket/img/$($probe.Name)" 2>$null }
    if ($info -match '^(https://f\d+\.backblazeb2\.com/file/[^/]+)/') {
        $publicUrl = $Matches[1]
    }
}

$corsFile = Join-Path $PSScriptRoot "b2-cors.json"
if (Test-Path -LiteralPath $corsFile) {
    Write-Host "Setting CORS (videos from GitHub Pages and localhost)..." -ForegroundColor Cyan
    & b2 bucket update --cors-rules (Get-Content -LiteralPath $corsFile -Raw) $bucket allPublic
    if ($LASTEXITCODE -ne 0) {
        & b2 update-bucket --corsRules (Get-Content -LiteralPath $corsFile -Raw) $bucket allPublic
    }
    if ($LASTEXITCODE -ne 0) { throw "b2 CORS update failed ($LASTEXITCODE)" }
}

Write-Host ""
Write-Host "Done. Public media prefix (set as MEDIA_CDN in src/js/data.js):" -ForegroundColor Green
if ($publicUrl) {
    Write-Host "  $publicUrl"
} else {
    Write-Host "  https://fXXX.backblazeb2.com/file/$bucket"
    Write-Host "  (fXXX appears in the file URL in the B2 panel -> Browse Files -> iOS/Android/Web URL)"
}
Write-Host "Example: $publicUrl/img/<name.webp>"
