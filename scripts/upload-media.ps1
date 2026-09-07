# UTF-8 with BOM — Windows PowerShell 5.1 otherwise misreads Polish text and here-strings.
# Upload src/media to a public Backblaze B2 bucket (Windows).
# JSON questions stay in git; photos/films do not.
#
# 1. Free account: https://www.backblaze.com/b2/sign-up.html
# 2. B2 Cloud Storage -> Create a Bucket -> Files public, name e.g. prawko-maz
# 3. App Keys -> Add a New Application Key (this bucket, read+write)
# 4. Copy scripts/b2env.example to .b2env in the repo root and fill it in
# 5. powershell -ExecutionPolicy Bypass -File scripts/upload-media.ps1
#
# After the first upload, set MEDIA_CDN in src/js/data.js to the URL this script prints.
# CORS for GitHub Pages / localhost: scripts/b2-cors.json (applied at the end of this script).

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$mediaDir = Join-Path $repoRoot "src\media"
$envFile = Join-Path $repoRoot ".b2env"

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
    throw "Brak $img albo $vid. Najpierw lokalna paczka z gov.pl."
}
if (-not $keyId -or -not $appKey -or -not $bucket) {
    throw @"
Brak danych B2. Utworz $envFile (wzor: scripts/b2env.example) albo ustaw:
  B2_APPLICATION_KEY_ID
  B2_APPLICATION_KEY
  B2_BUCKET
"@
}

$b2 = Get-Command b2 -ErrorAction SilentlyContinue
if (-not $b2) {
    Write-Host "Instaluję b2 CLI (pip)..." -ForegroundColor Yellow
    python -m pip install --user b2
    $b2 = Get-Command b2 -ErrorAction SilentlyContinue
}
if (-not $b2) {
    throw "Nie ma polecenia b2. Dopisz katalog Scripts Pythona do PATH i sprobuj ponownie."
}

Write-Host "Logowanie do B2..." -ForegroundColor Cyan
& b2 account authorize $keyId $appKey
if ($LASTEXITCODE -ne 0) {
    & b2 authorize-account $keyId $appKey
    if ($LASTEXITCODE -ne 0) { throw "b2 authorize nie powiodlo sie." }
}

Write-Host "Wgrywam zdjecia -> b2://$bucket/img/ ..." -ForegroundColor Cyan
& b2 sync --allowEmptySource --skipNewer $img "b2://$bucket/img/"
if ($LASTEXITCODE -ne 0) { throw "b2 sync img failed ($LASTEXITCODE)" }

Write-Host "Wgrywam filmy -> b2://$bucket/vid/ (ok. 3 GB, moze potrwac)..." -ForegroundColor Cyan
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
    Write-Host "Ustawiam CORS (filmy z GitHub Pages i localhost)..." -ForegroundColor Cyan
    & b2 bucket update --cors-rules (Get-Content -LiteralPath $corsFile -Raw) $bucket allPublic
    if ($LASTEXITCODE -ne 0) {
        & b2 update-bucket --corsRules (Get-Content -LiteralPath $corsFile -Raw) $bucket allPublic
    }
    if ($LASTEXITCODE -ne 0) { throw "b2 CORS update failed ($LASTEXITCODE)" }
}

Write-Host ""
Write-Host "Gotowe. Publiczny prefix mediow (wstaw jako MEDIA_CDN w src/js/data.js):" -ForegroundColor Green
if ($publicUrl) {
    Write-Host "  $publicUrl"
} else {
    Write-Host "  https://fXXX.backblazeb2.com/file/$bucket"
    Write-Host "  (fXXX zobaczysz w URL pliku w panelu B2 -> Browse Files -> iOS/Android/Web URL)"
}
Write-Host "Przyklad: $publicUrl/img/<nazwa.webp>"
