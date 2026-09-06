# Convert ministry situational media: JPG→WebP, WMV→MP4 (Windows, no Python).
# Same job as scripts/convert-videos.sh + scripts/optimize-images.sh.
# Reads gov-data\raw only. Does not touch gov-data\pjm (sign-language source stays WMV).
#
# powershell -ExecutionPolicy Bypass -File scripts/convert-media.ps1
# powershell -ExecutionPolicy Bypass -File scripts/convert-media.ps1 -FfmpegExe C:\ffmpeg\bin\ffmpeg.exe

param(
    [string]$SourceDir,
    [string]$ImgOut,
    [string]$VidOut,
    [string]$FfmpegExe
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

. (Join-Path $PSScriptRoot "download-gov.ps1") -LibraryOnly

$repoRoot = Get-PrawkoRepoRoot
$serverRoot = "C:\ProgramData\prawko"
$serverReady = Test-Path -LiteralPath (Join-Path $serverRoot "src\index.html")
if (-not $SourceDir) { $SourceDir = Get-ContribRawMediaDir }
if (-not $ImgOut) {
    if ($serverReady) { $ImgOut = Join-Path $serverRoot "src\media\img" }
    else { $ImgOut = Join-Path $env:LOCALAPPDATA "prawko\media\img" }
}
if (-not $VidOut) {
    if ($serverReady) { $VidOut = Join-Path $serverRoot "src\media\vid" }
    else { $VidOut = Join-Path $env:LOCALAPPDATA "prawko\media\vid" }
}
if (-not [IO.Path]::IsPathRooted($SourceDir)) { $SourceDir = Join-Path $repoRoot $SourceDir }
if (-not [IO.Path]::IsPathRooted($ImgOut)) { $ImgOut = Join-Path $repoRoot $ImgOut }
if (-not [IO.Path]::IsPathRooted($VidOut)) { $VidOut = Join-Path $repoRoot $VidOut }

function Resolve-ConvertFfmpegExe ([string]$explicit) {
    if ($explicit) {
        if (-not (Test-Path -LiteralPath $explicit)) { throw "Brak ffmpeg: $explicit" }
        return (Get-Item -LiteralPath $explicit).FullName
    }
    $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notmatch 'WindowsApps') { return $cmd.Source }
    $tools = "C:\ProgramData\prawko\tools\ffmpeg"
    if (Test-Path -LiteralPath $tools) {
        $bundled = Get-ChildItem -LiteralPath $tools -Filter "ffmpeg.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($bundled) { return $bundled.FullName }
    }
    $hit = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter "ffmpeg.exe" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($hit) { return $hit.FullName }
    foreach ($c in @("$env:ProgramFiles\ffmpeg\bin\ffmpeg.exe", "C:\ffmpeg\bin\ffmpeg.exe")) {
        if (Test-Path $c) { return $c }
    }
    return $null
}

if (-not (Test-Path -LiteralPath $SourceDir)) {
    throw "Brak katalogu źródłowego: $SourceDir (najpierw scripts/download-gov.ps1)."
}

$ffmpeg = Resolve-ConvertFfmpegExe $FfmpegExe
if (-not $ffmpeg) {
    throw "FFmpeg nie jest dostępny. Zainstaluj ffmpeg albo odpal Install_Prawko.ps1 -InstallGov (kładzie wersję przenośną)."
}
Write-Host "[OK] FFmpeg: $ffmpeg" -ForegroundColor Green
Write-Host "Źródło (sytuacyjne): $SourceDir" -ForegroundColor Gray
Write-Host "Wyjście: $ImgOut  /  $VidOut" -ForegroundColor Gray
Write-Host "gov-data\pjm nie jest konwertowane." -ForegroundColor Gray

New-Item -ItemType Directory -Path $ImgOut -Force | Out-Null
New-Item -ItemType Directory -Path $VidOut -Force | Out-Null

$images = @(Get-ChildItem -Path $SourceDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -match '^\.(jpe?g)$' })
$videos = @(Get-ChildItem -Path $SourceDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -match '^\.wmv$' -and $_.Name -notmatch '(?i)^pjm' })

Write-Host "-> Konwersja obrazów JPG → WebP ($($images.Count) plików)..." -ForegroundColor Cyan
$i = 0
foreach ($img in $images) {
    $i++
    $dest = Join-Path $ImgOut ($img.BaseName + ".webp")
    if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) { continue }
    & $ffmpeg -y -hide_banner -loglevel error -i $img.FullName -c:v libwebp -quality 80 $dest
    if ($i % 50 -eq 0) {
        Write-Host "   obrazy $i / $($images.Count)" -ForegroundColor DarkGray
    }
}

Write-Host "-> Konwersja filmów WMV → MP4 ($($videos.Count) plików, to może potrwać)..." -ForegroundColor Cyan
$i = 0
foreach ($vid in $videos) {
    $i++
    $dest = Join-Path $VidOut ($vid.BaseName + ".mp4")
    if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) { continue }
    & $ffmpeg -y -hide_banner -loglevel error -i $vid.FullName `
        -c:v libx264 -preset veryfast -crf 23 `
        -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" `
        -movflags +faststart -an $dest
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   pominięto (błąd ffmpeg): $($vid.Name)" -ForegroundColor DarkYellow
    }
    if ($i % 10 -eq 0) {
        Write-Host "   filmy $i / $($videos.Count)" -ForegroundColor DarkGray
    }
}

foreach ($ready in @(Get-ChildItem -Path $SourceDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.webp$' })) {
    $dest = Join-Path $ImgOut $ready.Name
    if (-not (Test-Path $dest)) { Copy-Item -LiteralPath $ready.FullName -Destination $dest }
}
foreach ($ready in @(Get-ChildItem -Path $SourceDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.mp4$' })) {
    $dest = Join-Path $VidOut $ready.Name
    if (-not (Test-Path $dest)) { Copy-Item -LiteralPath $ready.FullName -Destination $dest }
}

$webpCount = @(Get-ChildItem $ImgOut -Filter *.webp -ErrorAction SilentlyContinue).Count
$mp4Count = @(Get-ChildItem $VidOut -Filter *.mp4 -ErrorAction SilentlyContinue).Count
Write-Host "-> Gotowe multimedia dla aplikacji: $webpCount WebP, $mp4Count MP4" -ForegroundColor Green
