# Download ministry catalogue + media ZIPs from gov.pl (Windows, no Python).
# Excel → gov-data\baza_pytan.xlsx
# Multimedia (JPG/WMV) → gov-data\raw
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

if (-not $mainUrl) { $mainUrl = $script:PrawkoGovMainUrl }
if (-not $ua) { $ua = $script:PrawkoGovUa }

function Get-PrawkoRepoRoot {
    $root = Split-Path -Parent $PSScriptRoot
    $index = Join-Path $root "src\index.html"
    if (-not (Test-Path -LiteralPath $index)) {
        throw "Nie znaleziono katalogu repo (src\index.html) nad $PSScriptRoot."
    }
    return [IO.Path]::GetFullPath($root)
}

function Get-GovDataDir {
    return Get-LocalAppGovDataDir
}

function Get-GovDataOverflowRoot {
    $local = Get-LocalAppGovDataDir
    $repo = Get-PrawkoRepoRoot
    $server = "C:\ProgramData\prawko"
    $a = ([IO.Path]::GetFullPath($repo)).TrimEnd('\', '/')
    $b = ([IO.Path]::GetFullPath($server)).TrimEnd('\', '/')
    if ([string]::Equals($a, $b, [StringComparison]::OrdinalIgnoreCase)) {
        return $local
    }
    return (Join-Path $repo "gov-data")
}

function Get-LocalAppGovDataDir {
    return (Join-Path $env:LOCALAPPDATA "prawko\gov-data")
}

function Get-ContribRawMediaDir {
    return (Join-Path (Get-GovDataDir) "raw")
}

function Get-GovPjmDir {
    return (Join-Path (Get-GovDataDir) "pjm")
}

function Get-GovZipCacheDir {
    return (Join-Path (Get-GovDataDir) "cache")
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

function Get-PathDriveId ([string]$path) {
    return [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($path)).Substring(0, 1).ToUpperInvariant()
}

function Resolve-GovStagingDir {
    param(
        [string]$Preferred,
        [string]$Overflow,
        [int64]$MinFreeBytes,
        [string]$What
    )
    if (Test-Path -LiteralPath $Preferred) {
        $existing = Get-ChildItem -LiteralPath $Preferred -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($existing) { return $Preferred }
    }
    $prefFree = Get-DriveFreeBytes $Preferred
    if ($prefFree -ge $MinFreeBytes) { return $Preferred }
    if ((Get-PathDriveId $Preferred) -eq (Get-PathDriveId $Overflow)) { return $Preferred }
    $overFree = Get-DriveFreeBytes $Overflow
    if ($overFree -ge $MinFreeBytes) {
        Write-Host ("-> Mało miejsca na {0}: ({1} GB). {2} → {3}" -f (Get-PathDriveId $Preferred), [math]::Round($prefFree / 1GB, 1), $What, $Overflow) -ForegroundColor DarkYellow
        return $Overflow
    }
    return $Preferred
}

function New-GovDataJunction ([string]$linkPath, [string]$targetPath) {
    $linkFull = [IO.Path]::GetFullPath($linkPath)
    $targetFull = [IO.Path]::GetFullPath($targetPath)
    if ($linkFull -eq $targetFull) { return }
    if (Test-Path -LiteralPath $linkPath) { return }
    New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
    New-Item -ItemType Junction -Path $linkPath -Target $targetFull | Out-Null
}

function Move-LegacyContribRawMediaDir {
    $legacy = Join-Path (Get-PrawkoRepoRoot) $script:PrawkoRawMediaLegacyName
    if (-not (Test-Path -LiteralPath $legacy)) { return }
    $raw = Get-ContribRawMediaDir
    $legacyFull = [IO.Path]::GetFullPath($legacy)
    $rawFull = [IO.Path]::GetFullPath($raw)
    if ($legacyFull -eq $rawFull) { return }
    New-Item -ItemType Directory -Path (Get-GovDataDir) -Force | Out-Null
    if (-not (Test-Path -LiteralPath $raw)) {
        Write-Host "Przenoszę stary folder surowych mediów → gov-data\raw" -ForegroundColor Yellow
        Move-Item -LiteralPath $legacy -Destination $raw
        return
    }
    Write-Host "Scalam stary folder surowych mediów do gov-data\raw, potem usuwam stary." -ForegroundColor Yellow
    & robocopy.exe $legacy $raw /E /XO /R:2 /W:1 /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy legacy raw → gov-data\raw failed (exit $LASTEXITCODE)" }
    Remove-Item -LiteralPath $legacy -Recurse -Force
    if (Test-Path -LiteralPath $legacy) {
        throw "Nie udało się usunąć $legacy po scaleniu do gov-data\raw."
    }
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
        Write-Host "-> Nie udało się pobrać 1 MB do hasha ($($_.Exception.Message))." -ForegroundColor DarkYellow
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
        Write-Host "-> Rozmiar: $sizeMb MB" -ForegroundColor DarkCyan
    }

    & curl.exe -L -C - --retry 5 --retry-all-errors -A $ua -e $mainUrl --output $outFile $url
    if ($LASTEXITCODE -eq 33) {
        Write-Host "-> Serwer nie obsługuje wznawiania, pobieram od zera..." -ForegroundColor DarkYellow
        Remove-Item $outFile -Force -ErrorAction SilentlyContinue
        & curl.exe -L --retry 5 --retry-all-errors -A $ua -e $mainUrl --output $outFile $url
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Pobieranie nie powiodło się (curl exit $LASTEXITCODE): $url"
    }
    if ($expected -and (Test-Path $outFile) -and ((Get-Item $outFile).Length -lt $expected)) {
        throw "Niekompletne pobieranie $($outFile): $((Get-Item $outFile).Length) / $expected bajtów"
    }
}

function Expand-ZipToDirectory ($zipPath, $destination) {
    if (-not (Test-Path $destination)) {
        New-Item -ItemType Directory -Path $destination -Force | Out-Null
    }
    if (Test-CommandExists "tar") {
        & tar.exe -xf $zipPath -C $destination
        if ($LASTEXITCODE -eq 0) { return }
        Write-Host "-> tar nie rozpakował archiwum, próbuję Expand-Archive..." -ForegroundColor DarkYellow
    }
    Expand-Archive -Path $zipPath -DestinationPath $destination -Force
}

function Flatten-MediaDirectory ($directory) {
    if (-not (Test-Path $directory)) { return }
    Write-Host "-> Spłaszczanie podfolderów w $directory..." -ForegroundColor Yellow
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
    $overflowRoot = Get-GovDataOverflowRoot
    $pjmPreferred = Get-GovPjmDir
    $pjmDir = Resolve-GovStagingDir -Preferred $pjmPreferred -Overflow (Join-Path $overflowRoot "pjm") -MinFreeBytes 22GB -What "PJM WMV"
    New-GovDataJunction -linkPath $pjmPreferred -targetPath $pjmDir
    New-Item -ItemType Directory -Path $pjmDir -Force | Out-Null
    $zipPreferred = Get-GovZipCacheDir
    $zipCache = Resolve-GovStagingDir -Preferred $zipPreferred -Overflow (Join-Path $overflowRoot "cache") -MinFreeBytes 12GB -What "ZIP-y MI"
    New-Item -ItemType Directory -Path $zipCache -Force | Out-Null

    $urlHash = Get-UrlFingerprint $item.Url
    $pjmMarkerPath = Join-Path $pjmDir ".downloaded_$urlHash"
    $hashFile = Join-Path $govDir ".pjm_$urlHash.hash"
    $zipPath = Join-Path $zipCache "pjm_$urlHash.zip"

    Write-Host "-> Hash 1 MB paczki tłumaczeń migowych (PJM)..." -ForegroundColor Cyan
    if (-not (Test-RemoteFileNeedsDownload -url $item.Url -hashFilePath $hashFile -localFilePath $pjmMarkerPath)) {
        Write-Host "-> Paczka PJM bez zmian. Pomijam pobieranie." -ForegroundColor Gray
    } else {
        Write-Host "-> Pobieram tłumaczenia migowe (PJM) z gov.pl (wznawiane, jeśli przerwane)..." -ForegroundColor Yellow
        Invoke-CurlDownload -url $item.Url -outFile $zipPath
        Write-Host "-> Rozpakowuję PJM do $pjmDir (osobno od gov-data\raw, bez konwersji)..." -ForegroundColor Green
        Expand-ZipToDirectory -zipPath $zipPath -destination $pjmDir
        Flatten-MediaDirectory -directory $pjmDir
        New-Item -ItemType File -Path $pjmMarkerPath -Force | Out-Null
        Save-PrefixHash -hashFilePath $hashFile -url $item.Url
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    }
    $wmvCount = @(Get-ChildItem -LiteralPath $pjmDir -File -Filter "*.wmv" -ErrorAction SilentlyContinue).Count
    Write-Host "-> PJM WMV w $pjmDir : $wmvCount (na razie tylko źródło; convert-media.ps1 tego nie rusza)." -ForegroundColor Green
}

function Get-GovPlAssetLinks {
    Write-Host "-> Parsuję $mainUrl ..." -ForegroundColor Cyan
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
        throw "Parser strony gov.pl nie znalazł linków do bazy pytań ani multimediów."
    }
    Write-Host "Znalezione pliki rządowe: $($znalezione.Count)" -ForegroundColor Green
    return $znalezione
}

function Sync-GovExcelFile ([string]$excelPath, [string]$hashFile) {
    $parent = Split-Path $excelPath -Parent
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $item = @(Get-GovPlAssetLinks | Where-Object { Test-GovExcelAsset $_ } | Select-Object -First 1)
    if ($item.Count -eq 0) {
        throw "gov.pl nie ma linku do Excela z bazą pytań."
    }
    Write-Host "-> Hash 1 MB Excela z serwera (ponowne pobranie, gdy zmienił się od ostatniego razu)..." -ForegroundColor Cyan
    if (-not (Test-RemoteFileNeedsDownload -url $item[0].Url -hashFilePath $hashFile -localFilePath $excelPath)) {
        Write-Host "-> Excel bez zmian. Parsuję lokalny plik: $excelPath" -ForegroundColor Gray
        return
    }
    Write-Host "-> Pobieram Excel z gov.pl (bez ZIP multimediów) do $excelPath..." -ForegroundColor Cyan
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
$overflowRoot = Get-GovDataOverflowRoot

New-Item -ItemType Directory -Path $govDir -Force | Out-Null

if ($ExcelOnly) {
    Write-Host "download-gov: tylko Excel → $excelPath" -ForegroundColor Cyan
    Sync-GovExcelFile -excelPath $excelPath -hashFile $excelHash
    if (-not (Test-Path -LiteralPath $excelPath)) {
        throw "Brak $excelPath — baza pytań z gov.pl nie została pobrana."
    }
    Write-Host "Done. Excel: $excelPath" -ForegroundColor Green
    return
}

Move-LegacyContribRawMediaDir

$rawPreferred = Get-ContribRawMediaDir
$rawMediaDir = Resolve-GovStagingDir -Preferred $rawPreferred -Overflow (Join-Path $overflowRoot "raw") -MinFreeBytes 8GB -What "surowe JPG/WMV"
New-GovDataJunction -linkPath $rawPreferred -targetPath $rawMediaDir

$zipPreferred = Get-GovZipCacheDir
$zipCache = Resolve-GovStagingDir -Preferred $zipPreferred -Overflow (Join-Path $overflowRoot "cache") -MinFreeBytes 12GB -What "ZIP-y MI"

New-Item -ItemType Directory -Path $rawMediaDir -Force | Out-Null
New-Item -ItemType Directory -Path $zipCache -Force | Out-Null

Write-Host "download-gov: Excel + ZIP multimediów sytuacyjnych z gov.pl → gov-data (gitignore)." -ForegroundColor Cyan
Write-Host "ZIP: $zipCache" -ForegroundColor Gray
Write-Host "Sytuacyjne JPG/WMV: $rawMediaDir" -ForegroundColor Gray

$znalezione = Get-GovPlAssetLinks
foreach ($item in $znalezione) {
    Write-Host "OPIS: $($item.Opis)" -ForegroundColor Green
    Write-Host "LINK: $($item.Url)" -ForegroundColor DarkCyan

    $isExcel = Test-GovExcelAsset $item
    $isPjm = (-not $isExcel) -and (Test-GovPjmAsset $item)
    $isMedia = (-not $isExcel) -and (-not $isPjm) -and (($item.Url -match "\.zip$") -or ($item.Opis -match "Multimedia"))

    if ($isExcel) {
        $hashFile = Join-Path $govDir ".baza_pytan.hash"
        Write-Host "-> Hash 1 MB Excela..." -ForegroundColor Cyan
        if (-not (Test-RemoteFileNeedsDownload -url $item.Url -hashFilePath $hashFile -localFilePath $excelPath)) {
            Write-Host "-> Excel bez zmian: $excelPath" -ForegroundColor Gray
        } else {
            Write-Host "-> Pobieram Excel z gov.pl do $excelPath..." -ForegroundColor Cyan
            Invoke-CurlDownload -url $item.Url -outFile $excelPath
            Save-PrefixHash -hashFilePath $hashFile -url $item.Url
        }
    }
    elseif ($isPjm) {
        Write-Host "-> Tłumaczenia migowe (PJM): znalezione, nie pobieram." -ForegroundColor DarkGray
    }
    elseif ($isMedia) {
        if ($SkipMedia) {
            Write-Host "-> Pomijam multimedia sytuacyjne (-SkipMedia)." -ForegroundColor DarkGray
        } else {
            $urlHash = Get-UrlFingerprint $item.Url
            $mediaMarkerPath = Join-Path $rawMediaDir ".downloaded_$urlHash"
            $hashFile = Join-Path $govDir ".media_$urlHash.hash"
            $zipPath = Join-Path $zipCache "media_$urlHash.zip"

            Write-Host "-> Hash 1 MB paczki multimediów..." -ForegroundColor Cyan
            if (-not (Test-RemoteFileNeedsDownload -url $item.Url -hashFilePath $hashFile -localFilePath $mediaMarkerPath)) {
                Write-Host "-> Paczka multimediów bez zmian. Pomijam pobieranie." -ForegroundColor Gray
            } else {
                Write-Host "-> Pobieram paczkę multimediów z gov.pl (wznawiane, jeśli przerwane)..." -ForegroundColor Yellow
                Invoke-CurlDownload -url $item.Url -outFile $zipPath
                Write-Host "-> Rozpakowuję do $rawMediaDir..." -ForegroundColor Green
                Expand-ZipToDirectory -zipPath $zipPath -destination $rawMediaDir
                Flatten-MediaDirectory -directory $rawMediaDir
                New-Item -ItemType File -Path $mediaMarkerPath -Force | Out-Null
                Save-PrefixHash -hashFilePath $hashFile -url $item.Url
                Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
            }
        }
    }
    else {
        Write-Host "-> Pomijam (to nie Excel ani multimedia)." -ForegroundColor DarkGray
    }
    Write-Host "--------------------------------------------------"
}

if (-not (Test-Path -LiteralPath $excelPath)) {
    throw "Brak $excelPath — baza pytań z gov.pl nie została pobrana."
}
Write-Host "Done. Excel: $excelPath" -ForegroundColor Green
Write-Host "Sytuacyjne: $rawMediaDir" -ForegroundColor Gray
