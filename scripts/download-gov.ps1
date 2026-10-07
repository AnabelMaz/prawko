# UTF-8 with BOM — Windows PowerShell 5.1 otherwise misreads non-ASCII text and here-strings.
# Download ministry catalogue + media ZIPs from gov.pl (Windows, no Python).
# Same job as scripts/download-gov.py.
# Excel + media ZIPs → C:\ProgramData\prawko\gov-cache (survives uninstall).
# Unpack JPG/WMV only into %TEMP%\prawko\raw for convert-media, then delete.
# PJM (sign-language) links are still matched on gov.pl; Sync-GovPjmAsset can
# unpack them later. Default import does not call it (~10 GB, unused in the app).
#
# Helpers (paths, gov.pl, curl, zip) live here. Other scripts load them with:
#   . scripts\download-gov.ps1 -LibraryOnly
#
# powershell -ExecutionPolicy Bypass -File scripts/download-gov.ps1
# powershell -ExecutionPolicy Bypass -File scripts/download-gov.ps1 -ExcelOnly

param(
    [switch]$LibraryOnly,
    [switch]$ExcelOnly,
    [switch]$SkipMedia
)

$script:PrawkoGovMainUrl = "https://www.gov.pl/web/infrastruktura/prawo-jazdy"
$script:PrawkoGovUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
$script:PrawkoRawMediaLegacyName = "Pytania egzaminacyjne na prawo jazdy 2025"

# convert-media.ps1 dotsources this under Set-StrictMode — do not read unset $mainUrl/$ua.
if (-not (Get-Variable -Name mainUrl -ErrorAction SilentlyContinue) -or [string]::IsNullOrWhiteSpace($mainUrl)) {
    $mainUrl = $script:PrawkoGovMainUrl
}
if (-not (Get-Variable -Name ua -ErrorAction SilentlyContinue) -or [string]::IsNullOrWhiteSpace($ua)) {
    $ua = $script:PrawkoGovUa
}

function Get-PrawkoRepoRoot {
    $root = Split-Path -Parent $PSScriptRoot
    $index = Join-Path $root "src\index.html"
    if (-not (Test-Path -LiteralPath $index)) {
        throw "Repo directory not found (src\index.html) above $PSScriptRoot."
    }
    return [IO.Path]::GetFullPath($root)
}

function Get-PrawkoServerRoot {
    return "C:\ProgramData\prawko"
}

function Get-GovDataDir {
    return (Join-Path (Get-PrawkoServerRoot) "gov-cache")
}

function Get-LegacyAppGovDataDir {
    return (Join-Path $env:LOCALAPPDATA "prawko\gov-data")
}

function Get-GovZipCacheDir {
    return (Join-Path (Get-GovDataDir) "zip")
}

function Get-GovRawTempDir {
    return (Join-Path ([IO.Path]::GetTempPath()) "prawko\raw")
}

function Get-ContribRawMediaDir {
    return Get-GovRawTempDir
}

function Get-GovPjmDir {
    return (Join-Path ([IO.Path]::GetTempPath()) "prawko\pjm")
}

function Test-GovCacheHasZips {
    $zipDir = Get-GovZipCacheDir
    if (-not (Test-Path -LiteralPath $zipDir)) { return $false }
    return [bool]@(Get-ChildItem -LiteralPath $zipDir -File -Filter *.zip -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Copy-LegacyAppGovCacheIfNeeded {
    $legacy = Get-LegacyAppGovDataDir
    $dest = Get-GovDataDir
    if (-not (Test-Path -LiteralPath $legacy)) { return }
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    $legacyExcel = Join-Path $legacy "baza_pytan.xlsx"
    $destExcel = Join-Path $dest "baza_pytan.xlsx"
    if ((Test-Path -LiteralPath $legacyExcel) -and -not (Test-Path -LiteralPath $destExcel)) {
        Copy-Item -LiteralPath $legacyExcel -Destination $destExcel -Force
        Write-Host "-> Copied legacy Excel AppData → $destExcel" -ForegroundColor DarkYellow
    }
    Get-ChildItem -LiteralPath $legacy -File -Filter "*.hash" -ErrorAction SilentlyContinue | ForEach-Object {
        $to = Join-Path $dest $_.Name
        if (-not (Test-Path -LiteralPath $to)) {
            Copy-Item -LiteralPath $_.FullName -Destination $to -Force
        }
    }
    $legacyZip = Join-Path $legacy "cache"
    $zipDest = Get-GovZipCacheDir
    if (Test-Path -LiteralPath $legacyZip) {
        New-Item -ItemType Directory -Path $zipDest -Force | Out-Null
        Get-ChildItem -LiteralPath $legacyZip -File -Filter *.zip -ErrorAction SilentlyContinue | ForEach-Object {
            $to = Join-Path $zipDest $_.Name
            if (-not (Test-Path -LiteralPath $to)) {
                Copy-Item -LiteralPath $_.FullName -Destination $to -Force
            }
        }
    }
}

function Expand-GovMediaZipsToTemp {
    $zipDir = Get-GovZipCacheDir
    $raw = Get-GovRawTempDir
    if (-not (Test-GovCacheHasZips)) {
        throw "No ministry media ZIPs in $zipDir. Run download-gov / -SyncGov Full first."
    }
    Assert-GovDiskSpace -Path $raw -MinFreeBytes 8GB -What "temp unpack JPG/WMV"
    if (Test-Path -LiteralPath $raw) {
        Remove-Item -LiteralPath $raw -Recurse -Force
    }
    New-Item -ItemType Directory -Path $raw -Force | Out-Null
    Get-ChildItem -LiteralPath $zipDir -File -Filter *.zip | ForEach-Object {
        Write-Host "-> Unpacking $($_.Name) → $raw" -ForegroundColor Green
        Expand-ZipToDirectory -zipPath $_.FullName -destination $raw
    }
    Flatten-MediaDirectory -directory $raw
    return $raw
}

function Remove-GovRawTempDir {
    $raw = Get-GovRawTempDir
    if (Test-Path -LiteralPath $raw) {
        Remove-Item -LiteralPath $raw -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Test-CommandExists ($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Get-DriveFreeBytes ([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return [int64]0 }
    try {
        $full = [IO.Path]::GetFullPath($path)
        $letter = [IO.Path]::GetPathRoot($full).Substring(0, 1)
        $drive = Get-PSDrive -Name $letter -ErrorAction SilentlyContinue
        if ($drive) { return [int64]$drive.Free }
    } catch { }
    return [int64]0
}

function Assert-GovDiskSpace {
    param(
        [string]$Path,
        [int64]$MinFreeBytes,
        [string]$What
    )
    $free = Get-DriveFreeBytes $Path
    if ($free -ge $MinFreeBytes) { return }
    $haveGb = [math]::Round($free / 1GB, 1)
    $needGb = [math]::Round($MinFreeBytes / 1GB, 1)
    throw ("Not enough disk space for {0}: {1} GB free at {2} (need {3} GB). Free space and retry — files stay in {2}." -f $What, $haveGb, $Path, $needGb)
}

function Move-LegacyContribRawMediaDir {
    $legacy = Join-Path (Get-PrawkoRepoRoot) $script:PrawkoRawMediaLegacyName
    if (-not (Test-Path -LiteralPath $legacy)) { return }
    Write-Host "Ignoring leftover $script:PrawkoRawMediaLegacyName in the checkout. Media ZIPs live in $(Get-GovZipCacheDir)." -ForegroundColor Yellow
}

function Get-UrlFingerprint ($url) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($url)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").Substring(0, 16).ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-RemotePrefixHash ($url) {
    try {
        $req = [Net.HttpWebRequest]::Create($url)
        $req.UserAgent = $ua
        $req.AllowAutoRedirect = $true
        $req.Timeout = 30000
        $req.ReadWriteTimeout = 30000
        $resp = $req.GetResponse()
        try {
            $stream = $resp.GetResponseStream()
            $bufferSize = 1MB
            $buffer = New-Object byte[] $bufferSize
            $total = 0
            while ($total -lt $bufferSize) {
                $read = $stream.Read($buffer, $total, $bufferSize - $total)
                if ($read -eq 0) { break }
                $total += $read
            }
            if ($total -eq 0) { return $null }
            if ($total -lt $bufferSize) {
                [Array]::Resize([ref]$buffer, $total)
            }
            $sha = [Security.Cryptography.SHA256]::Create()
            try {
                return [BitConverter]::ToString($sha.ComputeHash($buffer))
            } finally {
                $sha.Dispose()
            }
        } finally {
            $resp.Close()
        }
    } catch {
        Write-Host "-> Failed to fetch 1 MB for the hash ($($_.Exception.Message))." -ForegroundColor DarkYellow
        return $null
    }
}

function Test-RemoteFileNeedsDownload ($url, $hashFilePath, $localFilePath) {
    $remote = Get-RemotePrefixHash $url
    if (-not $remote) { return $true }
    if (-not (Test-Path -LiteralPath $localFilePath)) { return $true }
    if (-not (Test-Path -LiteralPath $hashFilePath)) { return $true }
    $stored = ([IO.File]::ReadAllText($hashFilePath)).Trim()
    return ($stored -ne $remote)
}

function Save-PrefixHash ($hashFilePath, $url) {
    $parent = Split-Path $hashFilePath -Parent
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $hash = Get-RemotePrefixHash $url
    if ($hash) {
        [IO.File]::WriteAllText($hashFilePath, $hash)
    }
}

function Get-RemoteContentLength ($url) {
    try {
        $lines = & curl.exe -sI -L -A $ua --max-time 20 $url 2>$null
        foreach ($line in $lines) {
            if ($line -match '(?i)^content-length:\s*(\d+)') {
                return [int64]$Matches[1]
            }
        }
    } catch { }
    return $null
}

function Invoke-CurlDownload ($url, $outFile) {
    $dir = Split-Path $outFile -Parent
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $expected = Get-RemoteContentLength $url
    if ($expected) {
        $sizeMb = [math]::Round($expected / 1MB, 1)
        Write-Host "-> Size: $sizeMb MB" -ForegroundColor DarkCyan
    }

    & curl.exe -L -C - --retry 5 --retry-all-errors -A $ua -e $mainUrl --output $outFile $url
    if ($LASTEXITCODE -eq 33) {
        Write-Host "-> Server does not support resume; downloading from scratch..." -ForegroundColor DarkYellow
        Remove-Item $outFile -Force -ErrorAction SilentlyContinue
        & curl.exe -L --retry 5 --retry-all-errors -A $ua -e $mainUrl --output $outFile $url
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Download failed (curl exit $LASTEXITCODE): $url"
    }
    if ($expected -and (Test-Path $outFile) -and ((Get-Item $outFile).Length -lt $expected)) {
        throw "Incomplete download $($outFile): $((Get-Item $outFile).Length) / $expected bytes"
    }
}

function Expand-ZipToDirectory ($zipPath, $destination) {
    if (-not (Test-Path $destination)) {
        New-Item -ItemType Directory -Path $destination -Force | Out-Null
    }
    if (Test-CommandExists "tar") {
        & tar.exe -xf $zipPath -C $destination
        if ($LASTEXITCODE -eq 0) { return }
        Write-Host "-> tar failed to unpack the archive; trying Expand-Archive..." -ForegroundColor DarkYellow
    }
    Expand-Archive -Path $zipPath -DestinationPath $destination -Force
}

function Flatten-MediaDirectory ($directory) {
    if (-not (Test-Path $directory)) { return }
    Write-Host "-> Flattening subfolders in $directory..." -ForegroundColor Yellow
    $subDirs = Get-ChildItem -Path $directory -Directory -ErrorAction SilentlyContinue
    foreach ($dir in $subDirs) {
        Get-ChildItem -Path $dir.FullName -Recurse -File | ForEach-Object {
            $destination = Join-Path $directory $_.Name
            if (-not (Test-Path $destination)) {
                Move-Item -Path $_.FullName -Destination $destination -Force
            } else {
                Remove-Item $_.FullName -Force
            }
        }
        Remove-Item $dir.FullName -Recurse -Force
    }
}

function Test-GovExcelAsset ($item) {
    if (-not $item) { return $false }
    return ($item.Url -match "\.xlsx$") -or ($item.Opis -match "KATALOG") -or ($item.Opis -match "Baza pytań")
}

function Test-GovPjmAsset ($item) {
    if (-not $item) { return $false }
    return ($item.Opis -match "migow") -or ($item.Url -match "migowe")
}

# Not called from the default download/install path. Kept so we can fetch
# ministry sign-language ZIPs later without rewriting gov.pl matching.
function Sync-GovPjmAsset ($item) {
    if (-not $item) { return }
    $govDir = Get-GovDataDir
    $pjmDir = Get-GovPjmDir
    $zipCache = Get-GovZipCacheDir
    Assert-GovDiskSpace -Path $zipCache -MinFreeBytes 12GB -What "ministry ZIPs"
    Assert-GovDiskSpace -Path $pjmDir -MinFreeBytes 22GB -What "temp PJM unpack"
    New-Item -ItemType Directory -Path $pjmDir -Force | Out-Null
    New-Item -ItemType Directory -Path $zipCache -Force | Out-Null

    $urlHash = Get-UrlFingerprint $item.Url
    $pjmMarkerPath = Join-Path $pjmDir ".downloaded_$urlHash"
    $hashFile = Join-Path $govDir ".pjm_$urlHash.hash"
    $zipPath = Join-Path $zipCache "pjm_$urlHash.zip"

    Write-Host "-> Hashing first 1 MB of the sign-language (PJM) pack..." -ForegroundColor Cyan
    if (-not (Test-RemoteFileNeedsDownload -url $item.Url -hashFilePath $hashFile -localFilePath $pjmMarkerPath)) {
        Write-Host "-> PJM pack unchanged. Skipping download." -ForegroundColor Gray
    } else {
        Write-Host "-> Downloading sign-language (PJM) pack from gov.pl (resumable if interrupted)..." -ForegroundColor Yellow
        Invoke-CurlDownload -url $item.Url -outFile $zipPath
        Write-Host "-> Unpacking PJM to $pjmDir (TEMP, separate from situational unpack, no conversion)..." -ForegroundColor Green
        Expand-ZipToDirectory -zipPath $zipPath -destination $pjmDir
        Flatten-MediaDirectory -directory $pjmDir
        New-Item -ItemType File -Path $pjmMarkerPath -Force | Out-Null
        Save-PrefixHash -hashFilePath $hashFile -url $item.Url
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    }
    $wmvCount = @(Get-ChildItem -LiteralPath $pjmDir -File -Filter "*.wmv" -ErrorAction SilentlyContinue).Count
    Write-Host "-> PJM WMV in $pjmDir : $wmvCount (source only for now; convert-media.ps1 does not touch it)." -ForegroundColor Green
}

function Get-GovPlAssetLinks {
    Write-Host "-> Parsing $mainUrl ..." -ForegroundColor Cyan
    $response = Invoke-WebRequest -Uri $mainUrl -UserAgent $ua -UseBasicParsing
    $html = $response.Content

    $szukaneOpisy = @("Baza pytań", "KATALOG", "Multimedia do pytań", "tłumaczenia migowe", "tłumaczenie migowe", "migowe")
    $pattern = '<a\s+[^>]*href=["\x27](?<href>[^"\x27]+)["\x27][^>]*>(?<text>.*?)<\/a>'
    $linkMatches = [regex]::Matches($html, $pattern, "IgnoreCase, Singleline")

    $suroweElementy = @()
    foreach ($m in $linkMatches) {
        $href = $m.Groups["href"].Value
        $text = $m.Groups["text"].Value -replace '<[^>]+>', ''
        $text = [Net.WebUtility]::HtmlDecode($text) -replace '\s+', ' '
        $text = $text.Trim()
        $hrefLooksPjm = ($href -match "migowe")
        if ([string]::IsNullOrWhiteSpace($text) -and -not $hrefLooksPjm) { continue }

        $pasuje = $hrefLooksPjm
        if (-not $pasuje) {
            foreach ($szukany in $szukaneOpisy) {
                if ($text -like "*$szukany*") { $pasuje = $true; break }
            }
        }
        if (-not $pasuje) { continue }

        if ($href -match '^//') { $href = "https:$href" }
        elseif ($href -notmatch '^https?://') { $href = "https://www.gov.pl" + $href }
        if ([string]::IsNullOrWhiteSpace($text)) { $text = $href }
        $suroweElementy += [PSCustomObject]@{ Opis = $text; Url = $href }
    }

    $znalezione = @($suroweElementy | Group-Object Url | ForEach-Object {
            $_.Group | Sort-Object { $_.Opis.Length } -Descending | Select-Object -First 1
        } | Sort-Object { if (Test-GovExcelAsset $_) { 0 } else { 1 } })

    if ($znalezione.Count -eq 0) {
        throw "gov.pl page parser found no question-bank or multimedia links."
    }
    Write-Host "Found government files: $($znalezione.Count)" -ForegroundColor Green
    return $znalezione
}

function Sync-GovExcelFile ([string]$excelPath, [string]$hashFile) {
    $parent = Split-Path $excelPath -Parent
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $item = @(Get-GovPlAssetLinks | Where-Object { Test-GovExcelAsset $_ } | Select-Object -First 1)
    if ($item.Count -eq 0) {
        throw "gov.pl has no Excel link for the question bank."
    }
    Write-Host "-> Hashing first 1 MB of the Excel from the server (re-download if it changed)..." -ForegroundColor Cyan
    if (-not (Test-RemoteFileNeedsDownload -url $item[0].Url -hashFilePath $hashFile -localFilePath $excelPath)) {
        Write-Host "-> Excel unchanged. Parsing local file: $excelPath" -ForegroundColor Gray
        return
    }
    Write-Host "-> Downloading Excel from gov.pl (no media ZIP) to $excelPath..." -ForegroundColor Cyan
    Invoke-CurlDownload -url $item[0].Url -outFile $excelPath
    Save-PrefixHash -hashFilePath $hashFile -url $item[0].Url
}

if ($LibraryOnly) { return }

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$govDir = Get-GovDataDir
$excelPath = Join-Path $govDir "baza_pytan.xlsx"
$excelHash = Join-Path $govDir ".baza_pytan.hash"
Copy-LegacyAppGovCacheIfNeeded
New-Item -ItemType Directory -Path $govDir -Force | Out-Null

if ($ExcelOnly) {
    Write-Host "download-gov: Excel only → $excelPath" -ForegroundColor Cyan
    Assert-GovDiskSpace -Path $govDir -MinFreeBytes 64MB -What "ministry Excel"
    Sync-GovExcelFile -excelPath $excelPath -hashFile $excelHash
    if (-not (Test-Path -LiteralPath $excelPath)) {
        throw "Missing $excelPath — question bank from gov.pl was not downloaded."
    }
    Write-Host "Done. Excel: $excelPath" -ForegroundColor Green
    return
}

Move-LegacyContribRawMediaDir

$zipCache = Get-GovZipCacheDir
if (-not $SkipMedia) {
    Assert-GovDiskSpace -Path $zipCache -MinFreeBytes 12GB -What "ministry ZIPs"
}

New-Item -ItemType Directory -Path $zipCache -Force | Out-Null

Write-Host "download-gov: Excel + situational media ZIP from gov.pl → $govDir" -ForegroundColor Cyan
Write-Host "ZIP: $zipCache (kept; unpack is convert-media into TEMP)" -ForegroundColor Gray

$znalezione = Get-GovPlAssetLinks
foreach ($item in $znalezione) {
    Write-Host "DESC: $($item.Opis)" -ForegroundColor Green
    Write-Host "LINK: $($item.Url)" -ForegroundColor DarkCyan

    $isExcel = Test-GovExcelAsset $item
    $isPjm = (-not $isExcel) -and (Test-GovPjmAsset $item)
    $isMedia = (-not $isExcel) -and (-not $isPjm) -and (($item.Url -match "\.zip$") -or ($item.Opis -match "Multimedia"))

    if ($isExcel) {
        $hashFile = Join-Path $govDir ".baza_pytan.hash"
        Write-Host "-> Hashing first 1 MB of the Excel..." -ForegroundColor Cyan
        if (-not (Test-RemoteFileNeedsDownload -url $item.Url -hashFilePath $hashFile -localFilePath $excelPath)) {
            Write-Host "-> Excel unchanged: $excelPath" -ForegroundColor Gray
        } else {
            Write-Host "-> Downloading Excel from gov.pl to $excelPath..." -ForegroundColor Cyan
            Invoke-CurlDownload -url $item.Url -outFile $excelPath
            Save-PrefixHash -hashFilePath $hashFile -url $item.Url
        }
    }
    elseif ($isPjm) {
        Write-Host "-> Sign-language (PJM) pack found; not downloading." -ForegroundColor DarkGray
    }
    elseif ($isMedia) {
        if ($SkipMedia) {
            Write-Host "-> Skipping situational media (-SkipMedia)." -ForegroundColor DarkGray
        } else {
            $urlHash = Get-UrlFingerprint $item.Url
            $hashFile = Join-Path $govDir ".media_$urlHash.hash"
            $zipPath = Join-Path $zipCache "media_$urlHash.zip"

            Write-Host "-> Hashing first 1 MB of the media pack..." -ForegroundColor Cyan
            if (-not (Test-RemoteFileNeedsDownload -url $item.Url -hashFilePath $hashFile -localFilePath $zipPath)) {
                Write-Host "-> Media pack unchanged: $zipPath" -ForegroundColor Gray
            } else {
                Write-Host "-> Downloading media pack from gov.pl (resumable if interrupted)..." -ForegroundColor Yellow
                Invoke-CurlDownload -url $item.Url -outFile $zipPath
                Save-PrefixHash -hashFilePath $hashFile -url $item.Url
            }
        }
    }
    else {
        Write-Host "-> Skipping (not Excel or media)." -ForegroundColor DarkGray
    }
    Write-Host "--------------------------------------------------"
}

if (-not (Test-Path -LiteralPath $excelPath)) {
    throw "Missing $excelPath — question bank from gov.pl was not downloaded."
}
Write-Host "Done. Excel: $excelPath" -ForegroundColor Green
Write-Host "ZIPs: $zipCache" -ForegroundColor Gray
