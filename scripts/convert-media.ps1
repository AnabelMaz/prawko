# UTF-8 with BOM — Windows PowerShell 5.1 otherwise misreads non-ASCII text and here-strings.
# Convert ministry situational media: JPG→WebP, WMV→MP4 (Windows, no Python).
# Same job as scripts/convert-media.py.
# Unpacks gov-cache ZIPs into %TEMP%\prawko\raw, converts, then deletes the temp tree.
# Does not convert PJM. Requires the installed server for default output.
#
# After MP4s exist, measures a black run glued to the start or the end by
# reading only the first and last 1.5s. Each measured file is written to
# src/data/media-trim.json immediately. A later run skips a file whose size
# and mtime are unchanged. Playback ignores a file that has no "in" or "out".
# An existing WebP/MP4 is not encoded again.
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
$serverRoot = Get-PrawkoServerRoot
$serverReady = Test-Path -LiteralPath (Join-Path $serverRoot "src\index.html")
$script:cleanRawTemp = $false
if (-not $SourceDir) {
    $SourceDir = Expand-GovMediaZipsToTemp
    $script:cleanRawTemp = $true
}
if (-not $ImgOut -or -not $VidOut) {
    if (-not $serverReady) {
        throw "Install the server first (installer with no switches). Converted media go to $serverRoot\src\media."
    }
    if (-not $ImgOut) { $ImgOut = Join-Path $serverRoot "src\media\img" }
    if (-not $VidOut) { $VidOut = Join-Path $serverRoot "src\media\vid" }
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
    if ($script:cleanRawTemp) { Remove-GovRawTempDir }
    throw "Source directory not found: $SourceDir (run scripts/download-gov.ps1 first)."
}

$ffmpeg = Resolve-ConvertFfmpegExe $FfmpegExe
if (-not $ffmpeg) {
    if ($script:cleanRawTemp) { Remove-GovRawTempDir }
    throw "FFmpeg is not available. Install ffmpeg or run Install_Prawko.windows.ps1 -SyncGov (it drops a portable copy)."
}
Write-Host "[OK] FFmpeg: $ffmpeg" -ForegroundColor Green
Write-Host "Source (situational): $SourceDir" -ForegroundColor Gray
Write-Host "Output: $ImgOut  /  $VidOut" -ForegroundColor Gray
Write-Host "Temp unpack is deleted after convert. PJM is not converted." -ForegroundColor Gray

function Convert-InvariantDouble ([string]$text) {
    $n = 0.0
    $style = [Globalization.NumberStyles]::Float
    $culture = [Globalization.CultureInfo]::InvariantCulture
    if ([double]::TryParse($text, $style, $culture, [ref]$n)) { return $n }
    return $null
}

function Invoke-CapturedProcess ([string]$exe, [string]$arguments, [int]$timeoutMs = 20000) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    $psi.Arguments = $arguments
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $outTask = $proc.StandardOutput.ReadToEndAsync()
    $errTask = $proc.StandardError.ReadToEndAsync()
    if (-not $proc.WaitForExit($timeoutMs)) {
        try { $proc.Kill() } catch {}
        try { $proc.WaitForExit(2000) } catch {}
        return @{ out = ''; err = ''; code = -1; timedOut = $true }
    }
    return @{ out = $outTask.Result; err = $errTask.Result; code = $proc.ExitCode; timedOut = $false }
}

function Get-ClipFrameDuration ([string]$rate) {
    $fps = 0.0
    $num = $null
    $den = $null
    if ($rate -match '^(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)$') {
        $num = Convert-InvariantDouble $Matches[1]
        $den = Convert-InvariantDouble $Matches[2]
        if ($null -ne $num -and $null -ne $den -and $den -gt 0) { $fps = $num / $den }
    } elseif ($rate -match '^(\d+(?:\.\d+)?)$') {
        $num = Convert-InvariantDouble $Matches[1]
        if ($null -ne $num) { $fps = $num }
    }
    if ($fps -le 1) { return 0.04 }
    return [math]::Min(0.2, [math]::Max(0.01, 1.0 / $fps))
}

function Get-ClipProbe ([string]$ffprobe, [string]$path) {
    $quoted = '"' + ($path -replace '"', '\"') + '"'
    $run = Invoke-CapturedProcess $ffprobe "-v error -select_streams v:0 -show_entries stream=avg_frame_rate,duration -of csv=p=0 $quoted"
    $line = ($run.out).Trim()
    $parts = @()
    if ($line) { $parts = $line.Split(",") }
    $duration = 0.0
    $rate = ""
    if ($parts.Count -ge 2) {
        $rate = $parts[0].Trim()
        $parsed = Convert-InvariantDouble $parts[1].Trim()
        if ($null -ne $parsed) { $duration = $parsed }
    }
    if ($duration -le 0) {
        $run = Invoke-CapturedProcess $ffprobe "-v error -show_entries format=duration -of csv=p=0 $quoted"
        $parsed = Convert-InvariantDouble ($run.out).Trim()
        if ($null -ne $parsed) { $duration = $parsed }
    }
    if ($duration -le 0) { return $null }
    if ($duration -le 0.2) { return @{ duration = $duration; frame = 0.04; short = $true } }
    return @{ duration = $duration; frame = (Get-ClipFrameDuration $rate); short = $false }
}

function Get-BlackFrameTimes ([string]$ffmpegExe, [string]$path, [double]$seek, [double]$seconds) {
    $quoted = '"' + ($path -replace '"', '\"') + '"'
    $culture = [Globalization.CultureInfo]::InvariantCulture
    $seekText = $seek.ToString('0.###', $culture)
    $secText = $seconds.ToString('0.###', $culture)
    # -ss/-t before -i read only that span, not the whole file.
    $args = "-hide_banner -ss $seekText -t $secText -i $quoted -vf blackframe=amount=90:threshold=32 -an -f null -"
    $run = Invoke-CapturedProcess $ffmpegExe $args
    $times = New-Object System.Collections.Generic.List[double]
    if ($run.timedOut) { return @{ times = $times; timedOut = $true } }
    foreach ($m in [regex]::Matches($run.err, '\bt:([0-9.]+)')) {
        $n = Convert-InvariantDouble $m.Groups[1].Value
        if ($null -ne $n) { $times.Add($n + $seek) }
    }
    return @{ times = $times; timedOut = $false }
}

function Get-EdgeBlackTimes ([string]$ffmpegExe, [string]$path, [double]$duration) {
    $head = Get-BlackFrameTimes $ffmpegExe $path 0 1.5
    if ($head.timedOut) { return $head }
    $seek = [math]::Max(0, $duration - 1.5)
    if ($seek -lt 0.2) { return @{ times = $head.times; timedOut = $false } }
    $tail = Get-BlackFrameTimes $ffmpegExe $path $seek 1.5
    if ($tail.timedOut) { return $tail }
    $times = New-Object System.Collections.Generic.List[double]
    foreach ($t in $head.times) { $times.Add($t) }
    foreach ($t in $tail.times) { $times.Add($t) }
    return @{ times = $times; timedOut = $false }
}

function Get-TrimEdges ($times, [double]$duration, [double]$frameDur) {
    $maxRun = 1.5
    $ordered = @($times | Sort-Object)
    $inn = $null
    $out = $null
    if ($ordered.Count -gt 0 -and [double]$ordered[0] -le ($frameDur * 0.75)) {
        $run = New-Object System.Collections.Generic.List[double]
        $run.Add([double]$ordered[0])
        for ($i = 1; $i -lt $ordered.Count; $i++) {
            $t = [double]$ordered[$i]
            $prev = $run[$run.Count - 1]
            if (($t - $prev) -le ($frameDur * 1.6) -and $t -le ($maxRun + $frameDur)) { $run.Add($t) }
            else { break }
        }
        $start = $run[$run.Count - 1] + $frameDur
        if (($run[$run.Count - 1] - $run[0]) -le $maxRun -and $start -gt 0.04 -and $start -lt ($duration - 0.2)) {
            $inn = [math]::Round($start, 3)
        }
    }
    if ($ordered.Count -gt 0 -and [double]$ordered[$ordered.Count - 1] -ge ($duration - $frameDur * 1.25)) {
        $run = New-Object System.Collections.Generic.List[double]
        $run.Add([double]$ordered[$ordered.Count - 1])
        for ($i = $ordered.Count - 2; $i -ge 0; $i--) {
            $t = [double]$ordered[$i]
            $head = $run[0]
            if (($head - $t) -le ($frameDur * 1.6) -and ($duration - $t) -le ($maxRun + $frameDur)) { $run.Insert(0, $t) }
            else { break }
        }
        $end = $run[0] - $frameDur
        if (($run[$run.Count - 1] - $run[0]) -le $maxRun -and $end -gt 0.2 -and ($duration - $end) -gt 0.04) {
            $out = [math]::Round($end, 3)
        }
    }
    if ($null -ne $inn -and $null -ne $out -and ($out - $inn) -lt 0.4) { return @{ in = $null; out = $null } }
    return @{ in = $inn; out = $out }
}

function Save-MediaTrimFile ([string]$path, $map) {
    $dir = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $json = ([ordered]@{ version = 1; files = $map } | ConvertTo-Json -Depth 6)
    $tmp = "$path.tmp"
    [IO.File]::WriteAllText($tmp, $json + "`n", (New-Object System.Text.UTF8Encoding $false))
    [IO.File]::Copy($tmp, $path, $true)
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}

function Update-BlackEdgeTrim ([string]$vidDir, [string]$ffmpegExe, [string]$repo) {
    $ffprobe = Join-Path (Split-Path -Parent $ffmpegExe) "ffprobe.exe"
    if (-not (Test-Path -LiteralPath $ffprobe)) {
        $cmd = Get-Command ffprobe -ErrorAction SilentlyContinue
        if ($cmd) { $ffprobe = $cmd.Source }
    }
    if (-not $ffprobe -or -not (Test-Path -LiteralPath $ffprobe)) {
        Write-Host "ffprobe missing; black-edge trim skipped." -ForegroundColor DarkYellow
        return
    }
    $dest = Join-Path $repo "src\data\media-trim.json"
    $previous = @{}
    if (Test-Path -LiteralPath $dest) {
        try {
            $doc = [IO.File]::ReadAllText($dest) | ConvertFrom-Json
            if ($doc.files) {
                foreach ($p in $doc.files.PSObject.Properties) { $previous[$p.Name] = $p.Value }
            }
        } catch {
            $previous = @{}
        }
    }
    $videos = @(Get-ChildItem -LiteralPath $vidDir -File -Filter *.mp4 -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notmatch '(?i)^pjm' } | Sort-Object Name)
    $files = [ordered]@{}
    $measured = 0
    $trimmed = 0
    $timedOut = 0
    Write-Host "-> Black edges on MP4 ($($videos.Count) files, first and last 1.5s)..." -ForegroundColor Cyan
    $i = 0
    foreach ($vid in $videos) {
        $i++
        $mtimeS = [int64]([DateTimeOffset]$vid.LastWriteTimeUtc).ToUnixTimeSeconds()
        $prev = $previous[$vid.Name]
        if ($prev -and [int64]$prev.bytes -eq $vid.Length -and [int64]$prev.mtimeS -eq $mtimeS) {
            $files[$vid.Name] = $prev
            if ($prev.PSObject.Properties['in'] -or $prev.PSObject.Properties['out']) { $trimmed++ }
            Write-Host "   edges $i / $($videos.Count) $($vid.Name) cached" -ForegroundColor DarkGray
            continue
        }
        Write-Host "   edges $i / $($videos.Count) $($vid.Name)" -ForegroundColor DarkGray
        [Console]::Out.Flush()
        $entry = [ordered]@{ bytes = [int64]$vid.Length; mtimeS = $mtimeS }
        $probed = Get-ClipProbe $ffprobe $vid.FullName
        if (-not $probed) {
            Write-Host "   probe failed: $($vid.Name)" -ForegroundColor DarkYellow
            continue
        }
        if (-not $probed.short) {
            $found = Get-EdgeBlackTimes $ffmpegExe $vid.FullName $probed.duration
            if ($found.timedOut) {
                $timedOut++
                Write-Host "   timeout: $($vid.Name)" -ForegroundColor DarkYellow
                continue
            }
            $edges = Get-TrimEdges $found.times $probed.duration $probed.frame
            if ($null -ne $edges.in) { $entry.in = $edges.in }
            if ($null -ne $edges.out) { $entry.out = $edges.out }
            $measured++
        }
        if ($entry.Contains('in') -or $entry.Contains('out')) {
            $trimmed++
            $note = @()
            if ($entry.Contains('in')) { $note += "in=$($entry.in)" }
            if ($entry.Contains('out')) { $note += "out=$($entry.out)" }
            Write-Host "   trim $($vid.Name) $($note -join ' ')" -ForegroundColor Green
        }
        $files[$vid.Name] = $entry
        if ($measured % 20 -eq 0) { Save-MediaTrimFile $dest $files }
    }
    Save-MediaTrimFile $dest $files
    Write-Host "-> Black-edge trim: measured $measured, with a cut $trimmed, timeouts $timedOut, wrote $dest" -ForegroundColor Green
}

try {

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
Update-BlackEdgeTrim $VidOut $ffmpeg $repoRoot
} finally {
    if ($script:cleanRawTemp) { Remove-GovRawTempDir }
}
