# UTF-8 with BOM — Windows PowerShell 5.1 otherwise misreads non-ASCII text and here-strings.
# Convert ministry situational media: JPG→WebP, WMV→MP4 (Windows, no Python).
# Same job as scripts/convert-media.sh.
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
        if (-not (Test-Path -LiteralPath $explicit)) { throw "ffmpeg not found: $explicit" }
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
    throw "Source directory not found: $SourceDir (run scripts/download-gov.ps1 first)."
}

$ffmpeg = Resolve-ConvertFfmpegExe $FfmpegExe
if (-not $ffmpeg) {
    throw "FFmpeg is not available. Install ffmpeg or run Install_Prawko.windows.ps1 -InstallGov (it drops a portable copy)."
}
Write-Host "[OK] FFmpeg: $ffmpeg" -ForegroundColor Green
Write-Host "Source (situational): $SourceDir" -ForegroundColor Gray
Write-Host "Output: $ImgOut  /  $VidOut" -ForegroundColor Gray
Write-Host "gov-data\pjm is not converted." -ForegroundColor Gray

New-Item -ItemType Directory -Path $ImgOut -Force | Out-Null
New-Item -ItemType Directory -Path $VidOut -Force | Out-Null

$images = @(Get-ChildItem -Path $SourceDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -match '^\.(jpe?g)$' })
$videos = @(Get-ChildItem -Path $SourceDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -match '^\.wmv$' -and $_.Name -notmatch '(?i)^pjm' })

Write-Host "-> Converting images JPG → WebP ($($images.Count) files)..." -ForegroundColor Cyan
$i = 0
foreach ($img in $images) {
    $i++
    $dest = Join-Path $ImgOut ($img.BaseName + ".webp")
    if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) { continue }
    & $ffmpeg -y -hide_banner -loglevel error -i $img.FullName -c:v libwebp -quality 80 $dest
    if ($i % 50 -eq 0) {
        Write-Host "   images $i / $($images.Count)" -ForegroundColor DarkGray
    }
}

Write-Host "-> Converting videos WMV → MP4 ($($videos.Count) files, this may take a while)..." -ForegroundColor Cyan
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
        Write-Host "   skipped (ffmpeg error): $($vid.Name)" -ForegroundColor DarkYellow
    }
    if ($i % 10 -eq 0) {
        Write-Host "   videos $i / $($videos.Count)" -ForegroundColor DarkGray
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
Write-Host "-> App media ready: $webpCount WebP, $mp4Count MP4" -ForegroundColor Green
