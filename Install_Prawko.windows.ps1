# UTF-8 with BOM — Windows PowerShell 5.1 otherwise misreads non-ASCII text and here-strings.
param(
    [switch]$Help,
    [switch]$NonInteractive,
    [switch]$Uninstall,
    [switch]$InstallGov,
    [switch]$GovQuestions,
    [switch]$Merge,
    [switch]$Patch,
    [switch]$DropMissingMedia,
    [string]$Export,
    [string]$Dev
)

try {
    Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
} catch {
    # Process may already have been started with -ExecutionPolicy Bypass.
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:initialLocationPath = (Get-Location).Path
$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$serviceName = "PrawkoWORDService"
$targetDir = "C:\ProgramData\prawko"
$rawMediaFolderName = "Pytania egzaminacyjne na prawo jazdy 2025"
$mediaOutImg = Join-Path $targetDir "src\media\img"
$mediaOutVid = Join-Path $targetDir "src\media\vid"
$cacheDir = Join-Path $targetDir "cache"
$toolsDir = Join-Path $targetDir "tools"
$repoUrl = "https://github.com/AnabelMaz/prawko.git"
$repoBranch = "main"
$mainUrl = "https://www.gov.pl/web/infrastruktura/prawo-jazdy"
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
$listenPort = 5173
$script:devWorkRoot = $null

if ($Help) {
    Write-Host @"
Install_Prawko.windows.ps1 — Prawko installer (driving-license exam) for Windows.

SYNTAX
  powershell -ExecutionPolicy Bypass -File Install_Prawko.windows.ps1 [options]
  Download this file from GitHub and save it anywhere — it does not have to live in the repo.

SWITCHES
  (none)            Default mode: ZIP from GitHub AnabelMaz/prawko (branch $repoBranch),
                    service at http://localhost:$listenPort. No Git. Questions from the repo,
                    media from the prawko-maz CDN. If the server is already running, nothing is overwritten.
                    Local contrib: -Patch. Ministry questions on disk: -InstallGov.
                    Start over: -Uninstall.

  -InstallGov       Excel + situational media ZIP from gov.pl: staging in
                    %LOCALAPPDATA%\prawko\gov-data (ZIP, raw JPG/WMV).
                    Conversion (WebP/MP4) and JSON go to the server
                    C:\ProgramData\prawko — one copy for viewing.
                    Does not duplicate media in git/contrib. Little space on C:
                    ZIP/raw may land in gov-data in the checkout (another drive).
                    Does not download Polish Sign Language (PJM) translations. Does not touch src\data
                    in git. When the server is running, writes mediaBase=media in
                    src/local.json so the app uses local files. -Patch skips data\ and media\. After -Uninstall and
                    an install without this switch, you get AnabelMaz/prawko
                    + CDN again. No administrator, no service reinstall.

  -DropMissingMedia Only with -InstallGov: the parser strips from JSON media whose
                    file is missing in the local raw folder. Default is NOT to — the name from
                    Excel stays (CDN / Download offline).

  -GovQuestions     Ministry question catalog only, onto the live server.
                    Excel → %LOCALAPPDATA%\prawko\gov-data, JSON onto
                    C:\ProgramData\prawko\src\data. Does not touch src\data in git.
                    Does not touch src\media or the CDN. Offline: "Download offline".
                    No administrator, no service reinstall.

  -Patch            Overlays code from the local checkout (-Dev, next to the script,
                    ..\prawko-contrib, ..\contrib). Skips data\ and media\.
                    Without contrib it overlays nothing — the server still has AnabelMaz
                    from install. On an already running server: overlay only,
                    no admin, no git checkout, no service reinstall.
                    On first install: AnabelMaz ZIP + service + overlay.

  -Export <path>    Copies a pack to the given directory (robocopy), without
                    installing and without touching the server. Prints file
                    count, size, and copy progress (same idea as media convert):
                      <path>\prawko\Install_Prawko.windows.ps1
                      <path>\prawko-contrib\
                    Contrib is looked up: next to the script, ..\prawko-contrib, ..\contrib.
                    From the exported pack you can install, -Patch,
                    -InstallGov and another -Export to a different folder.
                    Skips node_modules and .git. No administrator.

  -Dev <path>       Git clone only, for work (code, commit, push). Folder empty
                    or not yet existing. Not ProgramData. Does not install
                    Node, NSSM or the service — even if the server is not running yet.
                    Git is installed only here. To have localhost: first
                    run the installer with no switches, then -Dev.
                    Does not clone into C:\ProgramData\prawko. Media are not in git.

  -Merge            On an already running server: appends from the ministry Excel only the gaps.
                    Does not start the service, does not install Node/Git. No server =
                    install with no switches first.

  -Uninstall        Removes the PrawkoWORDService service and the
                    C:\ProgramData\prawko directory (including FFmpeg downloaded there
                    by -InstallGov). Git/Node/NSSM stay on the system.

  -NonInteractive   No Enter pause at the end (scripts, scheduled task).

  -Help             This help (does not require administrator).

ONE FILE / PACK
  From GitHub, Install_Prawko.windows.ps1 alone is enough. Run it from Downloads, Desktop
  or any folder: it will install Node/NSSM, download the AnabelMaz/prawko ZIP
  into C:\ProgramData\prawko and start http://localhost:5173. No Git.
  Git only when you pass -Dev.

TWO USER TYPES
  Regular: installer with no switches only. ZIP + Node + service. No Git.
  Developer: code only, no server:
    powershell -ExecutionPolicy Bypass -File Install_Prawko.windows.ps1 -Dev D:\prawko
  Both (localhost + git): no switches first, then -Dev.

  Each switch installs only what it uses:
    (none)           Node, NSSM, app ZIP, service
    -Dev             Git + clone (no Node, no server)
    -Patch           nothing when the server is running; without server: Node + service + overlay
    -InstallGov      FFmpeg if missing; Excel+ZIP from gov.pl
    -GovQuestions    Excel from gov.pl only
    -Merge           Excel from gov.pl, write to the running server
    -Export          nothing (file copy)
    -Uninstall       nothing new

WHAT THE APP NEEDS
  Server (no switches): Node.js + the 'serve' service. Git NO. Python NO.
  -Dev: Git only. FFmpeg with -InstallGov (JPG/WMV) and -Merge (frames); if missing,
  the script places a portable build in C:\ProgramData\prawko\tools (gone with -Uninstall).
  ZIPs are unpacked with Windows built-in tar. The app expects WebP/MP4, not JPG/WMV.
"@
    exit 0
}

function Set-LocalMediaBase ($root) {
    $path = Join-Path $root "src\local.json"
    $obj = [pscustomobject]@{}
    if (Test-Path -LiteralPath $path) {
        try {
            $parsed = ConvertFrom-Json ([IO.File]::ReadAllText($path))
            if ($parsed -is [System.Management.Automation.PSCustomObject]) { $obj = $parsed }
        } catch { $obj = [pscustomobject]@{} }
    }
    $obj | Add-Member -NotePropertyName mediaBase -NotePropertyValue 'media' -Force
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText($path, (($obj | ConvertTo-Json -Compress) + "`n"), $utf8)
    Write-Host "-> src/local.json mediaBase=media (local files, not the CDN)." -ForegroundColor Green
}

function Test-LooksLikePrawkoRepo ([string]$root) {
    if ([string]::IsNullOrWhiteSpace($root)) { return $false }
    if (-not (Test-Path -LiteralPath (Join-Path $root "src\index.html"))) { return $false }
    return (Test-Path -LiteralPath (Join-Path $root "scripts\download-gov.ps1"))
}

function Find-LocalContribRoot {
    $parent = Split-Path $PSScriptRoot -Parent
    $server = ([IO.Path]::GetFullPath($targetDir)).TrimEnd('\', '/')
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($script:devWorkRoot) {
        [void]$candidates.Add($script:devWorkRoot)
    }
    if ($PSBoundParameters.ContainsKey("Dev") -and -not [string]::IsNullOrWhiteSpace($Dev)) {
        $devPath = $Dev
        if (-not [IO.Path]::IsPathRooted($devPath)) {
            $devPath = Join-Path (Get-Location).Path $devPath
        }
        [void]$candidates.Add($devPath)
    }
    [void]$candidates.Add($PSScriptRoot)
    [void]$candidates.Add((Join-Path $PSScriptRoot "prawko-contrib"))
    [void]$candidates.Add((Join-Path $parent "prawko-contrib"))
    [void]$candidates.Add((Join-Path $parent "contrib"))
    foreach ($c in $candidates) {
        if (-not (Test-LooksLikePrawkoRepo $c)) { continue }
        $full = ([IO.Path]::GetFullPath($c)).TrimEnd('\', '/')
        if ([string]::Equals($full, $server, [StringComparison]::OrdinalIgnoreCase)) { continue }
        return [IO.Path]::GetFullPath($c)
    }
    return $null
}

function Get-ContribRoot {
    $found = Find-LocalContribRoot
    if (-not $found) {
        throw "No local checkout for changes. Run Install_Prawko.windows.ps1 -Dev <path> or keep the repo next to the installer. For a regular install, -Dev is not needed."
    }
    return $found
}

function Resolve-PrawkoPipelineScript {
    param([Parameter(Mandatory = $true)][string]$Name)
    $candidates = New-Object System.Collections.Generic.List[string]
    [void]$candidates.Add((Join-Path $PSScriptRoot "scripts\$Name"))
    $contrib = Find-LocalContribRoot
    if ($contrib) {
        [void]$candidates.Add((Join-Path $contrib "scripts\$Name"))
    }
    [void]$candidates.Add((Join-Path $targetDir "scripts\$Name"))
    foreach ($p in $candidates) {
        if ($p -and (Test-Path -LiteralPath $p)) {
            return [IO.Path]::GetFullPath($p)
        }
    }
    return $null
}

function Import-PrawkoGovLibrary {
    # download-gov.ps1 -LibraryOnly must be dotted at *script* scope. Doing it
    # inside this function hides Get-GovDataDir after return (Windows PowerShell 5.1).
    if (Get-Command Get-GovDataDir -ErrorAction SilentlyContinue) { return }
    throw "Missing Get-GovDataDir. First dot-source scripts\download-gov.ps1 -LibraryOnly at installer script scope."
}

function Invoke-PrawkoScript {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string[]]$ArgumentList = @()
    )
    $path = Resolve-PrawkoPipelineScript $Name
    if (-not $path) {
        throw "Missing script $Name (looked in scripts\ next to the installer, in contrib, and in $targetDir\scripts)."
    }
    Write-Host "-> $Name $($ArgumentList -join ' ')" -ForegroundColor Cyan
    # Array splat (& $path @("-FfmpegExe", $x)) is positional in Windows PowerShell 5.1.
    # convert-media.ps1 then binds SourceDir="-FfmpegExe". Named params need a hashtable.
    $splat = @{}
    for ($i = 0; $i -lt $ArgumentList.Count; $i++) {
        $token = $ArgumentList[$i]
        if ($token -notmatch '^-{1,2}(.+)$') {
            throw "Invoke-PrawkoScript ${Name}: expected -Name, got: $token"
        }
        $key = $Matches[1]
        $hasValue = ($i + 1) -lt $ArgumentList.Count -and $ArgumentList[$i + 1] -notmatch '^-'
        if ($hasValue) {
            $splat[$key] = $ArgumentList[$i + 1]
            $i++
        } else {
            $splat[$key] = $true
        }
    }
    & $path @splat
}

function Assert-GovDataParsed ([string]$govDir, [string]$excelPath) {
    $metaFile = Join-Path $govDir "meta.json"
    if (-not (Test-Path -LiteralPath $metaFile)) { throw "Missing meta.json after parsing Excel." }
    $meta = Get-Content $metaFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $qTotal = ($meta.categories | Measure-Object -Property questionCount -Sum).Sum
    if ($qTotal -lt 100) {
        throw "Excel parser wrote too few questions ($qTotal). Check the column layout in $excelPath."
    }
    Write-Host "-> In gov-data: $qTotal question assignments. Originals in contrib\src\data are left as-is." -ForegroundColor Green
}

function Remove-LegacyServerRawMediaDir {
    $legacy = Join-Path $targetDir $rawMediaFolderName
    if (-not (Test-Path -LiteralPath $legacy)) { return }
    Write-Host "Removing leftover raw-media folder from the server: $legacy" -ForegroundColor Yellow
    Remove-Item -LiteralPath $legacy -Recurse -Force
    if (Test-Path -LiteralPath $legacy) {
        throw "Could not remove $legacy. Close programs that have this folder open and try again."
    }
}

function Test-PrawkoServerInstalled {
    return (Test-Path -LiteralPath (Join-Path $targetDir "src\index.html"))
}

function Test-LocalMediaFiles ([string]$Root) {
    $img = Join-Path $Root "src\media\img"
    $vid = Join-Path $Root "src\media\vid"
    $hasImg = (Test-Path -LiteralPath $img) -and @((Get-ChildItem -LiteralPath $img -File -ErrorAction SilentlyContinue | Select-Object -First 1)).Count
    $hasVid = (Test-Path -LiteralPath $vid) -and @((Get-ChildItem -LiteralPath $vid -File -ErrorAction SilentlyContinue | Select-Object -First 1)).Count
    return [bool]($hasImg -or $hasVid)
}

function Restore-LocalMediaBaseIfNeeded ([string]$Root) {
    if (Test-LocalMediaFiles $Root) {
        Set-LocalMediaBase -root $Root
    }
}

function Test-SamePath ([string]$Left, [string]$Right) {
    $a = ([IO.Path]::GetFullPath($Left)).TrimEnd('\', '/')
    $b = ([IO.Path]::GetFullPath($Right)).TrimEnd('\', '/')
    return [string]::Equals($a, $b, [StringComparison]::OrdinalIgnoreCase)
}

function Test-PathIsInside ([string]$Inner, [string]$Outer) {
    $a = ([IO.Path]::GetFullPath($Inner)).TrimEnd('\', '/')
    $b = ([IO.Path]::GetFullPath($Outer)).TrimEnd('\', '/')
    if ([string]::Equals($a, $b, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    return $a.StartsWith(($b + '\'), [StringComparison]::OrdinalIgnoreCase)
}

function Format-CopySize ([int64]$Bytes) {
    if ($Bytes -ge 1GB) { return ("{0:N1} GB" -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ("{0:N1} MB" -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ("{0:N0} KB" -f ($Bytes / 1KB)) }
    return ("{0} B" -f $Bytes)
}

function Get-CopyTreeStats {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [string[]]$ExcludeDirNames = @()
    )
    $skip = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($name in $ExcludeDirNames) {
        if ($name) { [void]$skip.Add($name) }
    }
    $files = [int64]0
    $bytes = [int64]0
    if (-not (Test-Path -LiteralPath $Root)) {
        return @{ Files = $files; Bytes = $bytes }
    }
    $stack = New-Object 'System.Collections.Generic.Stack[string]'
    $stack.Push((Get-Item -LiteralPath $Root).FullName)
    while ($stack.Count -gt 0) {
        $dir = $stack.Pop()
        try {
            foreach ($child in [IO.Directory]::EnumerateDirectories($dir)) {
                if ($skip.Contains([IO.Path]::GetFileName($child))) { continue }
                $stack.Push($child)
            }
            foreach ($file in [IO.Directory]::EnumerateFiles($dir)) {
                $files++
                try { $bytes += (New-Object IO.FileInfo $file).Length } catch { }
            }
        } catch { }
    }
    return @{ Files = $files; Bytes = $bytes }
}

function Invoke-SafeRobocopy {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [switch]$ShowProgress,
        [int64]$ProgressTotalBytes = 0,
        [string[]]$ProgressExcludeDirNames = @()
    )
    if (-not $ShowProgress) {
        & robocopy.exe $Source $Destination @ArgumentList | Out-Null
        if ($LASTEXITCODE -ge 8) {
            throw "robocopy failed (code $LASTEXITCODE): $Source -> $Destination"
        }
        return
    }

    Write-Host "   copying..." -ForegroundColor DarkGray
    $job = Start-Job -ScriptBlock {
        param($Source, $Destination, $ArgumentList)
        $p = Start-Process -FilePath "robocopy.exe" -ArgumentList (@($Source, $Destination) + $ArgumentList) -Wait -PassThru -WindowStyle Hidden
        return $p.ExitCode
    } -ArgumentList $Source, $Destination, $ArgumentList
    $activity = "Export copy"
    try {
        while ($job.State -eq 'Running') {
            Start-Sleep -Seconds 8
            if ($job.State -ne 'Running') { break }
            $now = Get-CopyTreeStats -Root $Destination -ExcludeDirNames $ProgressExcludeDirNames
            $status = "{0} / {1}  ({2} files)" -f (Format-CopySize $now.Bytes), (Format-CopySize $ProgressTotalBytes), $now.Files
            $pct = 0
            if ($ProgressTotalBytes -gt 0) {
                $pct = [int][Math]::Min(99, [Math]::Floor(100.0 * $now.Bytes / $ProgressTotalBytes))
            }
            Write-Progress -Activity $activity -Status $status -PercentComplete $pct
            Write-Host ("   {0}" -f $status) -ForegroundColor DarkGray
        }
        $raw = Receive-Job -Job $job -Wait
        if ($job.State -eq 'Failed') {
            throw "robocopy job failed: $Source -> $Destination : $raw"
        }
        $code = 0
        if ($null -ne $raw) {
            $code = [int](@($raw) | Select-Object -Last 1)
        }
        if ($code -ge 8) {
            throw "robocopy failed (code $code): $Source -> $Destination"
        }
    } finally {
        Write-Progress -Activity $activity -Completed
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
}

function Set-ServerCacheVersion {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Prefix
    )
    $swPath = Join-Path $Root "src\sw.js"
    if (-not (Test-Path -LiteralPath $swPath)) {
        throw "Missing $swPath"
    }
    $swRaw = [IO.File]::ReadAllText($swPath)
    $stamp = Get-Date -Format "yyyyMMddHHmmss"
    $swNew = [regex]::Replace($swRaw, "const CACHE_VERSION = '[^']+';", "const CACHE_VERSION = '$Prefix-$stamp';", 1)
    if ($swNew -eq $swRaw) {
        throw "Could not set CACHE_VERSION in $swPath"
    }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText($swPath, $swNew, $utf8)
    Write-Host "Service worker: $Prefix-$stamp" -ForegroundColor Cyan
}

function Publish-AppSrcOverlay {
    param(
        [Parameter(Mandatory = $true)][string]$SourceSrc,
        [Parameter(Mandatory = $true)][string]$DestRoot,
        [Parameter(Mandatory = $true)][string]$CachePrefix
    )
    $srcApp = $SourceSrc
    $dstApp = Join-Path $DestRoot "src"
    $srcIndex = Join-Path $srcApp "index.html"
    $dstIndex = Join-Path $dstApp "index.html"
    if (-not (Test-Path -LiteralPath $srcIndex)) {
        throw "Missing $srcIndex"
    }
    if (-not (Test-Path -LiteralPath $dstIndex)) {
        throw "Server is not installed (missing $dstIndex). Run Install_Prawko.windows.ps1 with no switches first (or with -Patch)."
    }
    Write-Host "-> Overlaying $srcApp -> $dstApp (skipping data\ and media\)" -ForegroundColor Cyan
    Invoke-SafeRobocopy -Source $srcApp -Destination $dstApp -ArgumentList @("/E", "/XD", "data", "media", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np")
    $trSrc = Join-Path $srcApp "data\translations_en.json"
    $trDstDir = Join-Path $dstApp "data"
    if ((Test-Path -LiteralPath $trSrc) -and (Test-Path -LiteralPath $trDstDir)) {
        Copy-Item -LiteralPath $trSrc -Destination (Join-Path $trDstDir "translations_en.json") -Force
    }
    Set-ServerCacheVersion -Root $DestRoot -Prefix $CachePrefix
    Restore-LocalMediaBaseIfNeeded -Root $DestRoot
}

function Apply-PrawkoAppFixes ($root) {
    $localContrib = Find-LocalContribRoot
    if (-not $localContrib) {
        Write-Host "-> No local contrib. Leaving the GitHub $repoUrl ($repoBranch) code as-is." -ForegroundColor Yellow
        return
    }
    $patchSrc = Join-Path $localContrib "src"
    Write-Host "-> Overlaying code from local contrib: $localContrib" -ForegroundColor Yellow
    if (-not (Test-Path (Join-Path $patchSrc "index.html"))) {
        throw "Patch source does not contain src\index.html."
    }
    Publish-AppSrcOverlay -SourceSrc $patchSrc -DestRoot $root -CachePrefix "prawko-patch"
    Write-Host "-> Overlaid code from local contrib." -ForegroundColor Green
}

function Export-PrawkoPack ([string]$Destination) {
    if ([string]::IsNullOrWhiteSpace($Destination)) {
        throw "-Export requires a path, e.g. -Export D:\backup\prawko-pack"
    }
    $destRoot = $Destination
    if (-not [IO.Path]::IsPathRooted($destRoot)) {
        $destRoot = Join-Path (Get-Location).Path $destRoot
    }
    $destRoot = [IO.Path]::GetFullPath($destRoot)
    if (Test-Path -LiteralPath $destRoot -PathType Leaf) {
        throw "-Export: '$destRoot' is a file, pass a directory."
    }
    if (Test-PathIsInside $destRoot $targetDir) {
        throw "-Export does not copy into the installed server ($targetDir)."
    }

    $contribSrc = Get-ContribRoot
    if (Test-PathIsInside $destRoot $contribSrc) {
        throw "-Export: destination directory cannot sit inside contrib ($contribSrc)."
    }

    $destInstall = Join-Path $destRoot "prawko"
    $destContrib = Join-Path $destRoot "prawko-contrib"
    $scriptDst = Join-Path $destInstall "Install_Prawko.windows.ps1"

    Write-Host "Export -> $destRoot" -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $destInstall -Force | Out-Null
    $stub = @"
# Launcher. Real installer: ..\prawko-contrib\Install_Prawko.windows.ps1
`$ErrorActionPreference = "Stop"
`$real = Join-Path `$PSScriptRoot "..\prawko-contrib\Install_Prawko.windows.ps1"
if (-not (Test-Path -LiteralPath `$real)) {
    throw "Not found: `$real"
}
& `$real @args
exit `$LASTEXITCODE
"@
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText($scriptDst, $stub.Replace("`n", "`r`n"), $utf8)
    Write-Host "-> Launcher: $scriptDst" -ForegroundColor Green

    $contribFull = [IO.Path]::GetFullPath($contribSrc)
    $destContribFull = [IO.Path]::GetFullPath($destContrib)
    if (Test-SamePath $contribFull $destContribFull) {
        Write-Host "-> Contrib is already at $destContrib (skipping copy)." -ForegroundColor Gray
    } else {
        New-Item -ItemType Directory -Path $destContrib -Force | Out-Null
        $xdNames = @("node_modules", ".git", "test-results", "playwright-report", "blob-report", "coverage", ".cursor")
        Write-Host "-> robocopy contrib: $contribSrc -> $destContrib (no node_modules/.git, no /MIR)" -ForegroundColor Cyan
        Write-Host "   Large src\media may take a while. Existing files at the destination are updated; nothing is deleted." -ForegroundColor Gray
        Write-Host "   counting files..." -ForegroundColor DarkGray
        $srcStats = Get-CopyTreeStats -Root $contribSrc -ExcludeDirNames $xdNames
        Write-Host ("   {0} files, {1}" -f $srcStats.Files, (Format-CopySize $srcStats.Bytes)) -ForegroundColor DarkCyan
        Invoke-SafeRobocopy -ShowProgress -ProgressTotalBytes $srcStats.Bytes -ProgressExcludeDirNames $xdNames -Source $contribSrc -Destination $destContrib -ArgumentList @(
            "/E", "/XD", "node_modules", ".git", "test-results", "playwright-report", "blob-report", "coverage", ".cursor",
            "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"
        )
        $idx = Join-Path $destContrib "src\index.html"
        if (-not (Test-Path -LiteralPath $idx)) {
            throw "After export, missing $idx"
        }
        Write-Host "-> Contrib: $destContrib" -ForegroundColor Green
    }

    Write-Host "Done. From the pack:" -ForegroundColor Green
    Write-Host "  powershell -ExecutionPolicy Bypass -File `"$scriptDst`""
    Write-Host "  ... -Patch  /  -InstallGov  /  -Export <another folder>"
}

if ($PSBoundParameters.ContainsKey("Export")) {
    Export-PrawkoPack -Destination $Export
    exit 0
}

if ($Patch -and -not $Merge -and -not $Uninstall -and -not $PSBoundParameters.ContainsKey("Dev") -and (Test-PrawkoServerInstalled)) {
    Remove-LegacyServerRawMediaDir
    Apply-PrawkoAppFixes -root $targetDir
    Write-Host "Done. In the open app, banner: Update available / Refresh." -ForegroundColor Green
    exit 0
}

if (-not $Uninstall -and -not $Merge -and -not $GovQuestions -and -not $InstallGov -and -not $Patch -and -not $PSBoundParameters.ContainsKey("Dev") -and (Test-PrawkoServerInstalled)) {
    Remove-LegacyServerRawMediaDir
    Write-Host "Server already running in $targetDir — not overwriting files (no git checkout / pull)." -ForegroundColor Yellow
    Write-Host "  Code from local contrib: Install_Prawko.windows.ps1 -Patch" -ForegroundColor Gray
    Write-Host "  Ministry questions: Install_Prawko.windows.ps1 -InstallGov   or   -GovQuestions" -ForegroundColor Gray
    Write-Host "  Git for changes:    Install_Prawko.windows.ps1 -Dev D:\prawko" -ForegroundColor Gray
    Write-Host "  Pack to USB:        Install_Prawko.windows.ps1 -Export D:\backup" -ForegroundColor Gray
    Write-Host "  Install from scratch: Install_Prawko.windows.ps1 -Uninstall   then no switches" -ForegroundColor Gray
    exit 0
}

function Test-IsAdmin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Admin only: first server install or -Uninstall.
# -Dev / -Patch / -Merge / -InstallGov / -GovQuestions / -Export: no elevation.
$installingServer = -not $Uninstall -and -not $Merge -and -not $GovQuestions -and -not $InstallGov -and -not $PSBoundParameters.ContainsKey("Dev") -and -not $PSBoundParameters.ContainsKey("Export") -and -not (Test-PrawkoServerInstalled)
if (($Uninstall -or $installingServer) -and -not (Test-IsAdmin)) {
    Write-Host "Administrator rights required. Retrying with elevation..." -ForegroundColor Yellow
    $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
    if ($NonInteractive) { $argList += "-NonInteractive" }
    if ($Uninstall) { $argList += "-Uninstall" }
    if ($InstallGov) { $argList += "-InstallGov" }
    if ($DropMissingMedia) { $argList += "-DropMissingMedia" }
    if ($GovQuestions) { $argList += "-GovQuestions" }
    if ($Merge) { $argList += "-Merge" }
    if ($Patch) { $argList += "-Patch" }
    if ($PSBoundParameters.ContainsKey("Export") -and $Export) { $argList += "-Export"; $argList += "`"$Export`"" }
    if ($PSBoundParameters.ContainsKey("Dev") -and $Dev) { $argList += "-Dev"; $argList += "`"$Dev`"" }
    if ($Help) { $argList += "-Help" }
    Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -ArgumentList $argList
    exit $LASTEXITCODE
}

function Test-CommandExists ($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Invoke-GitCommand {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$WorkingDirectory
    )

    $token = [guid]::NewGuid().ToString("N")
    $errorLog = Join-Path ([IO.Path]::GetTempPath()) ("prawko-git-" + $token + ".err.log")
    $outputLog = Join-Path ([IO.Path]::GetTempPath()) ("prawko-git-" + $token + ".out.log")
    try {
        $start = @{
            FilePath = "git.exe"
            ArgumentList = $Arguments
            Wait = $true
            PassThru = $true
            NoNewWindow = $true
            RedirectStandardError = $errorLog
            RedirectStandardOutput = $outputLog
        }
        if ($WorkingDirectory) { $start.WorkingDirectory = $WorkingDirectory }
        $process = Start-Process @start
        $exitCode = $process.ExitCode
        $normalOutput = ""
        if (Test-Path $outputLog) {
            $rawOutput = Get-Content -LiteralPath $outputLog -Raw
            if ($null -ne $rawOutput) { $normalOutput = $rawOutput.Trim() }
        }
        if ($normalOutput) { Write-Host $normalOutput }
        if ($exitCode -ne 0) {
            $diagnostic = @()
            if (Test-Path $errorLog) {
                $rawError = Get-Content -LiteralPath $errorLog -Raw
                if ($null -ne $rawError) { $diagnostic += $rawError.Trim() }
            }
            if ($normalOutput) { $diagnostic += $normalOutput }
            throw "Git $($Arguments -join ' ') failed (code $exitCode). $($diagnostic -join ' ')"
        }
    } finally {
        foreach ($log in @($errorLog, $outputLog)) {
            if (Test-Path $log) { Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue }
        }
    }
}

function Install-DevWorkClone {
    param([string]$Destination)
    if ([string]::IsNullOrWhiteSpace($Destination)) {
        throw "-Dev requires a path, e.g. -Dev D:\prawko"
    }
    $dest = $Destination
    if (-not [IO.Path]::IsPathRooted($dest)) {
        $dest = Join-Path (Get-Location).Path $dest
    }
    $dest = [IO.Path]::GetFullPath($dest)
    if (Test-SamePath $dest $targetDir) {
        throw "-Dev does not clone into the server ($targetDir). Pass a separate folder for code and git."
    }
    if (Test-PathIsInside $dest $targetDir) {
        throw "-Dev: folder cannot sit inside $targetDir."
    }
    if (Test-LooksLikePrawkoRepo $dest) {
        Write-Host "-> Git for changes is already at $dest (skipping clone)." -ForegroundColor Yellow
        $script:devWorkRoot = $dest
        return
    }
    if (Test-Path -LiteralPath $dest) {
        $leftovers = @(Get-ChildItem -LiteralPath $dest -Force)
        if ($leftovers.Count -gt 0) {
            throw "Directory $dest already exists and is not a Prawko checkout. Pass an empty folder or another path."
        }
    }
    Write-Host "Cloning $repoUrl ($repoBranch) → $dest (code, no media folder in git)..." -ForegroundColor Yellow
    $prevLfs = $env:GIT_LFS_SKIP_SMUDGE
    $env:GIT_LFS_SKIP_SMUDGE = "1"
    try {
        Invoke-GitCommand -Arguments @("clone", "--branch", $repoBranch, $repoUrl, $dest)
    } finally {
        if ($null -eq $prevLfs) {
            Remove-Item Env:\GIT_LFS_SKIP_SMUDGE -ErrorAction SilentlyContinue
        } else {
            $env:GIT_LFS_SKIP_SMUDGE = $prevLfs
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $dest "src\index.html"))) {
        throw "After -Dev, missing src\index.html in $dest"
    }
    $script:devWorkRoot = $dest
    Write-Host "Git for changes: $dest" -ForegroundColor Green
    Write-Host "Preview stays in $targetDir. You commit and push here. Onto the server: Install_Prawko.windows.ps1 -Patch (or -Dev same-path -Patch)." -ForegroundColor Gray
}

function Split-PathEntries ([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) { return @() }
    return @(
        $value -split ';' |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
}

function Get-PathEntryKey ([string]$entry) {
    return $entry.TrimEnd('\').ToLowerInvariant()
}

# Current session only ($env:Path). Does not write Machine/User PATH.
# After winget, the installer adds directories to PATH in the registry — here we read
# the current Machine+User values and append to the session whatever is not there yet.
function Update-SessionPath {
    $sessionEntries = @(Split-PathEntries $env:Path)
    $systemEntries = @(Split-PathEntries ([Environment]::GetEnvironmentVariable("Path", "Machine")))
    $userEntries = @(Split-PathEntries ([Environment]::GetEnvironmentVariable("Path", "User")))

    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $merged = New-Object System.Collections.Generic.List[string]

    foreach ($entry in $sessionEntries) {
        if ($seen.Add((Get-PathEntryKey $entry))) {
            $merged.Add($entry)
        }
    }

    foreach ($entry in ($systemEntries + $userEntries)) {
        if ($seen.Add((Get-PathEntryKey $entry))) {
            $merged.Add($entry)
        }
    }

    $env:Path = ($merged -join ';')
}

function Install-WingetPackage ($id, $Override) {
    $wingetArgs = @(
        "install", "--id", $id, "-e", "--source", "winget",
        "--accept-source-agreements", "--accept-package-agreements",
        "--disable-interactivity", "--silent"
    )
    if ($Override) {
        $wingetArgs += @("--override", $Override)
    }
    & winget @wingetArgs
    if ($LASTEXITCODE -notin 0, -1978335189, -1978335135) {
        throw "winget install $id exited with code $LASTEXITCODE"
    }
    Update-SessionPath
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

# Hash of the first 1 MB of the remote file — same as the original.
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
        Write-Host "-> Could not download 1 MB for the hash ($($_.Exception.Message))." -ForegroundColor DarkYellow
        return $null
    }
}

# true = need to download the whole file. Compare the 1 MB hash with the previous download.
function Test-RemoteFileNeedsDownload ($url, $hashFilePath, $localFilePath) {
    $currentHash = Get-RemotePrefixHash -url $url
    $savedHash = $null
    if (Test-Path $hashFilePath) {
        $savedHash = (Get-Content $hashFilePath -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($savedHash) { $savedHash = $savedHash.Trim() }
    }

    if ($currentHash -and $savedHash -and ($currentHash -eq $savedHash) -and (Test-Path $localFilePath)) {
        return $false
    }

    if (-not $currentHash -and (Test-Path $localFilePath) -and $savedHash) {
        Write-Host "-> Cannot check the server; keeping the local file." -ForegroundColor Gray
        return $false
    }

    return $true
}

function Save-PrefixHash ($hashFilePath, $url) {
    $currentHash = Get-RemotePrefixHash -url $url
    if ($currentHash) {
        Set-Content -Path $hashFilePath -Value $currentHash -Force
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
        Write-Host "-> tar did not unpack the archive, trying Expand-Archive..." -ForegroundColor DarkYellow
    }
    Expand-Archive -Path $zipPath -DestinationPath $destination -Force
}

function Install-PrawkoFromGithubArchive ([string]$Destination) {
    $zipUrl = "https://github.com/AnabelMaz/prawko/archive/refs/heads/$repoBranch.zip"
    $stageRoot = Join-Path ([IO.Path]::GetTempPath()) ("prawko-zip-" + [guid]::NewGuid().ToString("N"))
    $zipPath = Join-Path $stageRoot "prawko.zip"
    New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
    try {
        Write-Host "Downloading AnabelMaz/prawko ($repoBranch) as ZIP — no Git..." -ForegroundColor Yellow
        Invoke-CurlDownload -url $zipUrl -outFile $zipPath
        $unpack = Join-Path $stageRoot "unpack"
        Expand-ZipToDirectory -zipPath $zipPath -destination $unpack
        $inner = Get-ChildItem -LiteralPath $unpack -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $inner) {
            throw "GitHub ZIP does not contain a directory (expected prawko-$repoBranch)."
        }
        $index = Join-Path $inner.FullName "src\index.html"
        if (-not (Test-Path -LiteralPath $index)) {
            throw "GitHub ZIP does not look like Prawko (missing src\index.html in $($inner.FullName))."
        }
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
        Invoke-SafeRobocopy -Source $inner.FullName -Destination $Destination -ArgumentList @(
            "/E", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"
        )
        if (-not (Test-Path -LiteralPath (Join-Path $Destination "src\index.html"))) {
            throw "After unpacking, missing src\index.html in $Destination"
        }
        Write-Host "App from ZIP: $Destination" -ForegroundColor Green
    } finally {
        if (Test-Path -LiteralPath $stageRoot) {
            Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
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

function Resolve-NodeExe {
    Update-SessionPath
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notmatch 'WindowsApps') { return $cmd.Source }
    $fallback = "C:\Program Files\nodejs\node.exe"
    if (Test-Path $fallback) { return $fallback }
    return $null
}

function Resolve-NssmExe {
    Update-SessionPath
    $cmd = Get-Command nssm -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($c in @(
            "$env:ProgramFiles\NSSM\nssm.exe",
            "$env:ProgramFiles\nssm\win64\nssm.exe",
            "${env:ProgramFiles(x86)}\NSSM\nssm.exe"
        )) {
        if (Test-Path $c) { return $c }
    }
    $wingetPkg = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter "nssm.exe" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($wingetPkg) { return $wingetPkg.FullName }
    return $null
}

function Resolve-FfmpegExe {
    Update-SessionPath
    $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notmatch 'WindowsApps') { return $cmd.Source }
    $bundled = Get-ChildItem (Join-Path $toolsDir "ffmpeg") -Filter "ffmpeg.exe" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($bundled) { return $bundled.FullName }
    $hit = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter "ffmpeg.exe" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($hit) { return $hit.FullName }
    foreach ($c in @("$env:ProgramFiles\ffmpeg\bin\ffmpeg.exe", "C:\ffmpeg\bin\ffmpeg.exe")) {
        if (Test-Path $c) { return $c }
    }
    return $null
}

function Install-PortableFfmpeg {
    $ffmpegRoot = Join-Path $toolsDir "ffmpeg"
    New-Item -ItemType Directory -Path $ffmpegRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    $zipPath = Join-Path $cacheDir "ffmpeg-essentials.zip"
    Write-Host "-> Downloading FFmpeg (portable) to $ffmpegRoot ..." -ForegroundColor Yellow
    Invoke-CurlDownload -url "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -outFile $zipPath
    Expand-ZipToDirectory -zipPath $zipPath -destination $ffmpegRoot
    $exe = Get-ChildItem $ffmpegRoot -Filter "ffmpeg.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $exe) { throw "After unpacking, ffmpeg.exe is not in $ffmpegRoot" }
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    Write-Host "-> Local FFmpeg: $($exe.FullName) (gone with -Uninstall)." -ForegroundColor Green
}

function Resolve-ServeEntry ($root) {
    foreach ($c in @(
            (Join-Path $root "node_modules\serve\build\main.js"),
            (Join-Path $root "node_modules\serve\src\index.js"),
            (Join-Path $root "node_modules\serve\bin\serve.js")
        )) {
        if (Test-Path $c) { return $c }
    }
    return $null
}

function ConvertTo-UnixNewlines ([string]$text) {
    return (($text -replace "`r`n", "`n") -replace "`r", "`n")
}

function Get-TextFileLf ($path, [ref]$newline) {
    $raw = [IO.File]::ReadAllText($path)
    $newline.Value = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
    return ConvertTo-UnixNewlines $raw
}

function Set-TextFileLf ($path, [string]$lfText, [string]$newline) {
    $out = if ($newline -eq "`r`n") { $lfText -replace "`n", "`r`n" } else { $lfText }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText($path, $out, $utf8)
}

function Set-FileSnippet ($path, [string]$find, [string]$replace, [string]$alreadyPatched) {
    $nl = "`n"
    $lf = Get-TextFileLf $path ([ref]$nl)
    if ($alreadyPatched -and $lf.Contains($alreadyPatched)) { return $false }
    $findLf = ConvertTo-UnixNewlines $find
    $replaceLf = ConvertTo-UnixNewlines $replace
    if (-not $lf.Contains($findLf)) {
        throw "Could not apply patch in $path"
    }
    Set-TextFileLf $path ($lf.Replace($findLf, $replaceLf)) $nl
    return $true
}

function Apply-LegacyPrawkoAppFixes ($root) {
    $learnJs = Join-Path $root "src\js\learn.js"
    $offlineJs = Join-Path $root "src\js\offline.js"
    $swJs = Join-Path $root "src\sw.js"
    foreach ($f in @($learnJs, $offlineJs, $swJs)) {
        if (-not (Test-Path $f)) { throw "Missing $f" }
    }

    $learnChanged = Set-FileSnippet $learnJs @'
  // Check for previously answered
  const prevAnswer = getLearnAnswerForQuestion(state.category, q.id);
  if (prevAnswer) {
    state.answered = true;
    state.givenAnswer = prevAnswer;
    highlightAnswer(document.querySelector('.answers'), prevAnswer, q.correct);
  }
'@ @'
  // Lock only previously *correct* answers. Wrong ones stay at the front of
  // the queue so they can be answered again instead of forcing Next-only.
  const prevAnswer = getLearnAnswerForQuestion(state.category, q.id);
  if (prevAnswer && prevAnswer === q.correct) {
    state.answered = true;
    state.givenAnswer = prevAnswer;
    highlightAnswer(document.querySelector('.answers'), prevAnswer, q.correct);
  }
'@ 'prevAnswer && prevAnswer === q.correct'

    $offlineChanged = $false
    if ((Get-Content $offlineJs -Raw) -notmatch 'function toAbsoluteMediaUrl') {
        Set-FileSnippet $offlineJs @'
function getMediaRequest(url) {
  return new Request(url, { mode: 'no-cors', cache: 'no-store' });
}
'@ @'
function toAbsoluteMediaUrl(url) {
  return new URL(url, document.baseURI).href;
}

function getMediaRequest(url, { noCors = false } = {}) {
  const abs = toAbsoluteMediaUrl(url);
  const sameOrigin = new URL(abs).origin === location.origin;
  if (noCors) return new Request(abs, { mode: 'no-cors', cache: 'reload' });
  if (sameOrigin) return new Request(abs, { mode: 'same-origin', cache: 'reload' });
  return new Request(abs, { mode: 'cors', cache: 'reload' });
}
'@ $null | Out-Null

        Set-FileSnippet $offlineJs @'
    mediaUrls.push(`${MEDIA_BASE}/${prefix}/${encodeURIComponent(q.media)}`);
'@ @'
    mediaUrls.push(toAbsoluteMediaUrl(`${MEDIA_BASE}/${prefix}/${encodeURIComponent(q.media)}`));
'@ $null | Out-Null

        Set-FileSnippet $offlineJs @'
    const results = await Promise.allSettled(batch.map(async (url) => {
      const request = getMediaRequest(url);
      const response = await fetch(request, { signal: controller.signal });
      if (cache) await cache.put(request, response.clone());
    }));
'@ @'
    const results = await Promise.allSettled(batch.map(async (url) => {
      let request = getMediaRequest(url);
      let response;
      try {
        response = await fetch(request, { signal: controller.signal });
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        request = getMediaRequest(url, { noCors: true });
        response = await fetch(request, { signal: controller.signal });
      }
      if (cache && (response.ok || response.type === 'opaque')) {
        await cache.put(new Request(toAbsoluteMediaUrl(url)), response.clone());
      } else if (!response.ok && response.type !== 'opaque') {
        throw new Error(`Media fetch failed: ${response.status}`);
      }
    }));
'@ $null | Out-Null

        Set-FileSnippet $offlineJs @'
    for (const url of urls) {
      const cached = await cache.match(getMediaRequest(url));
      if (!cached) {
        isComplete = false;
        break;
      }
    }
'@ @'
    for (const url of urls) {
      const abs = toAbsoluteMediaUrl(url);
      const cached = (await cache.match(getMediaRequest(url)))
        || (await cache.match(abs))
        || (await cache.match(getMediaRequest(url, { noCors: true })));
      if (!cached) {
        isComplete = false;
        break;
      }
    }
'@ $null | Out-Null
        $offlineChanged = $true
    }

    $swChanged = $false
    $swRaw = Get-Content $swJs -Raw
    if ($swRaw -notmatch 'OFFLINE_MEDIA_CACHE') {
        Set-FileSnippet $swJs @'
const CACHE_VERSION = 'prawko-v8';
const APP_SHELL_CACHE = CACHE_VERSION + '-shell';
const DATA_CACHE = CACHE_VERSION + '-data';
const MEDIA_CACHE = CACHE_VERSION + '-media';
const MEDIA_CACHE_LIMIT = 500;
'@ @'
const CACHE_VERSION = 'prawko-v9';
const APP_SHELL_CACHE = CACHE_VERSION + '-shell';
const DATA_CACHE = CACHE_VERSION + '-data';
const MEDIA_CACHE = CACHE_VERSION + '-media';
const OFFLINE_MEDIA_CACHE = 'prawko-offline-media-v1';
const MEDIA_CACHE_LIMIT = 500;
'@ $null | Out-Null

        Set-FileSnippet $swJs @'
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
});
'@ @'
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
});
'@ $null | Out-Null

        Set-FileSnippet $swJs @'
self.addEventListener('activate', (event) => {
  const currentCaches = [APP_SHELL_CACHE, DATA_CACHE, MEDIA_CACHE];
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith('prawko-') && !currentCaches.includes(name))
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});
'@ @'
self.addEventListener('activate', (event) => {
  const currentCaches = [APP_SHELL_CACHE, DATA_CACHE, MEDIA_CACHE, OFFLINE_MEDIA_CACHE];
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith('prawko-') && !currentCaches.includes(name))
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

async function matchOfflineMedia(request) {
  const cache = await caches.open(OFFLINE_MEDIA_CACHE);
  const url = typeof request === 'string' ? request : request.url;
  return (await cache.match(request))
    || (await cache.match(url))
    || (await cache.match(new Request(url, { mode: 'cors' })))
    || (await cache.match(new Request(url, { mode: 'no-cors' })))
    || (await cache.match(new Request(url, { mode: 'same-origin' })));
}
'@ $null | Out-Null

        Set-FileSnippet $swJs @'
  if (url.origin !== self.location.origin) return;
'@ @'
  if (url.origin !== self.location.origin) {
    event.respondWith(
      matchOfflineMedia(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }
'@ $null | Out-Null

        Set-FileSnippet $swJs @'
  // Local media files — cache-first, cached on demand, LRU eviction
  if (url.pathname.match(/\/media\//)) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok || response.type === 'opaque') {
              safeCachePut(cache, event.request, response.clone()).then(() =>
                cache.keys().then((keys) => {
                  if (keys.length > MEDIA_CACHE_LIMIT) {
                    const toDelete = keys.slice(0, keys.length - MEDIA_CACHE_LIMIT);
                    toDelete.forEach((key) => cache.delete(key));
                  }
                })
              );
            }
            return response;
          }).catch(() =>
            new Response('', { status: 503, statusText: 'Offline' })
          );
        })
      )
    );
    return;
  }
'@ @'
  // Local media files — cache-first, then the offline download cache
  if (url.pathname.match(/\/media\//)) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then((cache) =>
        cache.match(event.request).then(async (cached) => {
          if (cached) return cached;
          const offlineHit = await matchOfflineMedia(event.request);
          if (offlineHit) return offlineHit;
          return fetch(event.request).then((response) => {
            if (response.ok || response.type === 'opaque') {
              safeCachePut(cache, event.request, response.clone()).then(() =>
                cache.keys().then((keys) => {
                  if (keys.length > MEDIA_CACHE_LIMIT) {
                    const toDelete = keys.slice(0, keys.length - MEDIA_CACHE_LIMIT);
                    toDelete.forEach((key) => cache.delete(key));
                  }
                })
              );
            }
            return response;
          }).catch(() =>
            matchOfflineMedia(event.request).then((hit) =>
              hit || new Response('', { status: 503, statusText: 'Offline' })
            )
          );
        })
      )
    );
    return;
  }
'@ $null | Out-Null
        $swChanged = $true
    }

    if ($learnChanged -or $offlineChanged -or $swChanged) {
        Write-Host "-> Applied patches: learn (retry wrong answers) and offline media." -ForegroundColor Green
    } else {
        Write-Host "-> Learn and offline patches already applied." -ForegroundColor Gray
    }
}

function Get-ExcelColumnIndex ([string]$cellRef) {
    if ($cellRef -notmatch '^([A-Za-z]+)') { return -1 }
    $n = 0
    foreach ($ch in $Matches[1].ToUpperInvariant().ToCharArray()) {
        $n = $n * 26 + ([int][char]$ch - [int][char]'A' + 1)
    }
    return $n - 1
}

function Find-ExcelHeaderIndexOptional ($header, [string]$regex) {
    for ($i = 0; $i -lt $header.Count; $i++) {
        $h = ([string]$header[$i]).Trim()
        if ($regex -and $h -match $regex) { return $i }
    }
    return -1
}

function Find-ExcelHeaderIndex ($header, [string]$label, [string[]]$exact, [string]$regex) {
    for ($i = 0; $i -lt $header.Count; $i++) {
        $h = ([string]$header[$i]).Trim()
        foreach ($n in @($exact)) {
            if ($n -and $h -eq $n) { return $i }
        }
        if ($regex -and $h -match $regex) { return $i }
    }
    throw "Missing column $label in Excel. Headers: $($header -join ' | ')"
}

function Read-XlsxSheetRows ([string]$xlsxPath) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $fs = $null
    $zip = $null
    $tempCopy = Join-Path ([IO.Path]::GetTempPath()) ("prawko-xlsx-" + [guid]::NewGuid().ToString("n") + ".xlsx")
    try {
        [IO.File]::Copy($xlsxPath, $tempCopy, $true)
        $fs = [IO.File]::Open($tempCopy, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        $zip = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Read, $true)
        $nsUri = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

        $shared = New-Object System.Collections.Generic.List[string]
        $ssEntry = $zip.GetEntry("xl/sharedStrings.xml")
        if ($ssEntry) {
            $ssStream = $ssEntry.Open()
            try {
                $ssXml = New-Object Xml.XmlDocument
                $ssXml.XmlResolver = $null
                $ssXml.Load($ssStream)
            } finally { $ssStream.Close() }
            $nsm = New-Object Xml.XmlNamespaceManager($ssXml.NameTable)
            $nsm.AddNamespace("x", $nsUri)
            foreach ($si in $ssXml.SelectNodes("//x:si", $nsm)) {
                $sb = New-Object Text.StringBuilder
                foreach ($t in $si.SelectNodes(".//x:t", $nsm)) {
                    [void]$sb.Append($t.InnerText)
                }
                $shared.Add($sb.ToString())
            }
        }

        $sheetEntry = $zip.GetEntry("xl/worksheets/sheet1.xml")
        if (-not $sheetEntry) { throw "Missing xl/worksheets/sheet1.xml in $xlsxPath" }
        $sheetStream = $sheetEntry.Open()
        try {
            $sheetXml = New-Object Xml.XmlDocument
            $sheetXml.XmlResolver = $null
            $sheetXml.Load($sheetStream)
        } finally { $sheetStream.Close() }

        $nsm2 = New-Object Xml.XmlNamespaceManager($sheetXml.NameTable)
        $nsm2.AddNamespace("x", $nsUri)
        $rowsOut = New-Object System.Collections.Generic.List[object]
        foreach ($row in $sheetXml.SelectNodes("//x:sheetData/x:row", $nsm2)) {
            $cells = @{}
            $maxIdx = -1
            foreach ($c in $row.SelectNodes("x:c", $nsm2)) {
                $idx = Get-ExcelColumnIndex ($c.GetAttribute("r"))
                if ($idx -lt 0) { continue }
                $t = $c.GetAttribute("t")
                $text = ""
                if ($t -eq "s") {
                    $v = $c.SelectSingleNode("x:v", $nsm2)
                    if ($v -and $v.InnerText -match '^\d+$') {
                        $si = [int]$v.InnerText
                        if ($si -ge 0 -and $si -lt $shared.Count) { $text = $shared[$si] }
                    }
                } elseif ($t -eq "inlineStr") {
                    $is = $c.SelectSingleNode(".//x:t", $nsm2)
                    if ($is) { $text = $is.InnerText }
                } else {
                    $v = $c.SelectSingleNode("x:v", $nsm2)
                    if ($v) { $text = $v.InnerText }
                }
                $cells[$idx] = $text
                if ($idx -gt $maxIdx) { $maxIdx = $idx }
            }
            $arr = New-Object string[] ([Math]::Max(0, $maxIdx + 1))
            foreach ($k in $cells.Keys) { $arr[$k] = $cells[$k] }
            $rowsOut.Add($arr)
        }
        return [pscustomobject]@{ Rows = $rowsOut }
    } finally {
        if ($zip) { $zip.Dispose() }
        if ($fs) { $fs.Dispose() }
        if ($tempCopy -and (Test-Path -LiteralPath $tempCopy)) {
            Remove-Item -LiteralPath $tempCopy -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-PrawkoCategoryIds {
    return @("A", "A1", "A2", "AM", "B", "B1", "C", "C1", "D", "D1", "PT", "T")
}

function Test-GovExcelAsset ($item) {
    if (-not $item) { return $false }
    return ($item.Url -match "\.xlsx$") -or ($item.Opis -match "KATALOG") -or ($item.Opis -match "Baza pytań")
}

function Test-GovPjmAsset ($item) {
    if (-not $item) { return $false }
    return ($item.Opis -match "migow") -or ($item.Url -match "migowe")
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
        throw "gov.pl page parser found no links to the question bank or media."
    }
    Write-Host "Found government files: $($znalezione.Count)" -ForegroundColor Green
    return $znalezione
}

function Import-GovExcelIfMissing ([string]$excelPath) {
    if (Test-Path $excelPath) {
        Write-Host "-> Using already downloaded ministry Excel: $excelPath" -ForegroundColor Gray
        return
    }
    New-Item -ItemType Directory -Path (Split-Path $excelPath -Parent) -Force | Out-Null
    $item = @(Get-GovPlAssetLinks | Where-Object { Test-GovExcelAsset $_ } | Select-Object -First 1)
    if ($item.Count -eq 0) {
        throw "gov.pl has no link to the question-bank Excel."
    }
    Write-Host "-> Missing $excelPath — downloading Excel from gov.pl (no media ZIP)..." -ForegroundColor Cyan
    $hashFile = Join-Path $targetDir ".baza_pytan.hash"
    Invoke-CurlDownload -url $item[0].Url -outFile $excelPath
    Save-PrefixHash -hashFilePath $hashFile -url $item[0].Url
}

function Get-GovExcelCategoryQuestions {
    param(
        [string]$excelPath,
        [string]$mediaDir,
        [switch]$DropMissingMedia
    )
    $categories = Get-PrawkoCategoryIds
    Write-Host "-> Parsing Excel (xlsx/XML, no Python): $excelPath" -ForegroundColor Cyan
    $sheet = Read-XlsxSheetRows $excelPath
    $rows = $sheet.Rows
    if ($rows.Count -lt 2) { throw "Excel has no data rows." }

    $header = $rows[0]
    $colNum = Find-ExcelHeaderIndex $header "Numer pytania" -exact @("Numer pytania")
    $colQ = Find-ExcelHeaderIndex $header "Pytanie" -exact @("Pytanie")
    $colA = Find-ExcelHeaderIndex $header "Odpowiedz A" -regex '^Odpowied.+ A$'
    $colB = Find-ExcelHeaderIndex $header "Odpowiedz B" -regex '^Odpowied.+ B$'
    $colC = Find-ExcelHeaderIndex $header "Odpowiedz C" -regex '^Odpowied.+ C$'
    $colCorrect = Find-ExcelHeaderIndex $header "Poprawna odp" -exact @("Poprawna odp")
    $colMedia = Find-ExcelHeaderIndex $header "Media" -exact @("Media")
    $colStructure = Find-ExcelHeaderIndex $header "Zakres struktury" -exact @("Zakres struktury")
    $colPoints = Find-ExcelHeaderIndexOptional $header '^Liczba punkt'
    $colCats = Find-ExcelHeaderIndex $header "Kategorie" -exact @("Kategorie")

    $mediaLookup = $null
    if ($DropMissingMedia -and $mediaDir -and (Test-Path $mediaDir)) {
        $mediaLookup = @{}
        Get-ChildItem -Path $mediaDir -File -ErrorAction SilentlyContinue | ForEach-Object {
            $mediaLookup[$_.Name.ToLowerInvariant()] = $true
        }
    }

    $catQuestions = @{}
    foreach ($cat in $categories) { $catQuestions[$cat] = New-Object System.Collections.Generic.List[object] }
    $missingMedia = 0

    for ($r = 1; $r -lt $rows.Count; $r++) {
        $row = $rows[$r]
        $rowLen = $row.Length
        $qnum = if ($colNum -lt $rowLen -and $row[$colNum]) { ([string]$row[$colNum]).Trim() } else { "" }
        $qtext = if ($colQ -lt $rowLen -and $row[$colQ]) { ([string]$row[$colQ]).Trim() } else { "" }
        $correct = if ($colCorrect -lt $rowLen -and $row[$colCorrect]) { ([string]$row[$colCorrect]).Trim() } else { "" }
        $structure = if ($colStructure -lt $rowLen -and $row[$colStructure]) { ([string]$row[$colStructure]).Trim() } else { "" }
        $rawCats = if ($colCats -lt $rowLen -and $row[$colCats]) { ([string]$row[$colCats]).Trim() } else { "" }
        $rawMedia = if ($colMedia -lt $rowLen -and $row[$colMedia]) { ([string]$row[$colMedia]).Trim() } else { "" }
        $ansA = if ($colA -lt $rowLen -and $row[$colA]) { ([string]$row[$colA]).Trim() } else { "" }
        $ansB = if ($colB -lt $rowLen -and $row[$colB]) { ([string]$row[$colB]).Trim() } else { "" }
        $ansC = if ($colC -lt $rowLen -and $row[$colC]) { ([string]$row[$colC]).Trim() } else { "" }
        $rawPoints = if ($colPoints -ge 0 -and $colPoints -lt $rowLen -and $row[$colPoints]) { ([string]$row[$colPoints]).Trim() } else { "" }

        $qType = if ($correct -in @('A', 'B', 'C')) {
            "specialist"
        } elseif ($correct -in @('T', 'N')) {
            "basic"
        } elseif ($ansA -and $ansB -and $ansC) {
            "specialist"
        } elseif ($structure -eq "PODSTAWOWY") {
            "basic"
        } else {
            "specialist"
        }
        $points = 0
        if ($rawPoints -match '^\d+') { $points = [int]$Matches[0] }
        if ($points -lt 1 -or $points -gt 3) {
            $points = if ($qType -eq "basic") { 1 } else { 2 }
        }
        $mediaName = $null
        $mediaType = $null
        if ($rawMedia) {
            $ext = [IO.Path]::GetExtension($rawMedia).ToLowerInvariant()
            $base = [IO.Path]::GetFileNameWithoutExtension($rawMedia)
            switch ($ext) {
                ".wmv" { $mediaName = "$base.mp4"; $mediaType = "video" }
                ".jpg" { $mediaName = "$base.webp"; $mediaType = "image" }
                ".jpeg" { $mediaName = "$base.webp"; $mediaType = "image" }
                default { $mediaName = $rawMedia; $mediaType = "unknown" }
            }
            if ($mediaLookup -and -not $mediaLookup.ContainsKey($rawMedia.ToLowerInvariant())) {
                $missingMedia++
                $mediaName = $null
                $mediaType = $null
            }
        }

        $qObj = [ordered]@{
            id        = if ($qnum -match '^\d+$') { [int]$qnum } else { $qnum }
            q         = $qtext
            type      = $qType
            correct   = $correct
            points    = $points
            media     = $mediaName
            mediaType = $mediaType
        }
        if ($qType -eq "specialist") {
            $qObj["a"] = $ansA
            $qObj["b"] = $ansB
            $qObj["c"] = $ansC
        }

        foreach ($cat in ($rawCats -split ',')) {
            $cat = $cat.Trim()
            if ($catQuestions.ContainsKey($cat)) {
                $catQuestions[$cat].Add([pscustomobject]$qObj)
            }
        }
    }

    return [pscustomobject]@{
        Categories   = $catQuestions
        MissingMedia = $missingMedia
    }
}

function Convert-GovExcelToDataFiles {
    param(
        [string]$excelPath,
        [string]$mediaDir,
        [string]$outDir,
        [switch]$KeepMediaRefs,
        [switch]$DropMissingMedia
    )
    $categories = Get-PrawkoCategoryIds
    $exam = [ordered]@{
        totalQuestions        = 32
        basicQuestions        = 20
        specialistQuestions   = 12
        maxPoints             = 74
        passThreshold         = 68
        totalTimeSeconds      = 1500
        basicTimeSeconds      = 20
        specialistTimeSeconds = 50
        basicPoints           = @(3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1)
        specialistPoints      = @(3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1)
    }

    # KeepMediaRefs: file names from Excel stay (CDN / Download offline).
    # DropMissingMedia only on request — otherwise the parser does not clear media.
    $parsed = if ($DropMissingMedia) {
        Get-GovExcelCategoryQuestions -excelPath $excelPath -mediaDir $mediaDir -DropMissingMedia
    } else {
        Get-GovExcelCategoryQuestions -excelPath $excelPath
    }
    if ($parsed.MissingMedia) {
        Write-Host "  WARNING: $($parsed.MissingMedia) questions point to media that are not in the source folder." -ForegroundColor DarkYellow
    }

    if (-not (Test-Path $outDir)) {
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    }

    $utf8 = New-Object System.Text.UTF8Encoding $false
    $metaCategories = @()
    $total = 0
    $uniqueIds = New-Object 'System.Collections.Generic.HashSet[string]'
    $mediaRefs = 0
    foreach ($cat in $categories) {
        $questions = $parsed.Categories[$cat].ToArray()
        foreach ($q in $questions) {
            if ($null -ne $q.id -and [string]$q.id -ne '') {
                [void]$uniqueIds.Add([string]$q.id)
            }
        }
        $basic = @($questions | Where-Object { $_.type -eq "basic" }).Count
        $specialist = @($questions | Where-Object { $_.type -eq "specialist" }).Count
        $mediaRefs += @($questions | Where-Object { $_.media }).Count
        $payload = [ordered]@{ category = $cat; questions = $questions }
        $json = ConvertTo-Json -InputObject $payload -Depth 8
        [IO.File]::WriteAllText((Join-Path $outDir "$cat.json"), $json, $utf8)
        $metaCategories += [ordered]@{
            id              = $cat
            name            = "Kategoria $cat"
            questionCount   = $questions.Length
            basicCount      = $basic
            specialistCount = $specialist
        }
        $total += $questions.Length
        Write-Host ("  {0,3}: {1,4} questions ({2} basic + {3} specialist) → {0}.json" -f $cat, $questions.Length, $basic, $specialist)
    }

    $meta = [ordered]@{ uniqueQuestionCount = $uniqueIds.Count; categories = $metaCategories; exam = $exam }
    [IO.File]::WriteAllText((Join-Path $outDir "meta.json"), (ConvertTo-Json -InputObject $meta -Depth 8), $utf8)
    Write-Host "-> Wrote meta.json ($($uniqueIds.Count) unique questions, $total category assignments)." -ForegroundColor Green
    if ($KeepMediaRefs) {
        Write-Host "-> $mediaRefs media references left in JSON (CDN / Download offline)." -ForegroundColor Green
    }
}

function Sync-GovExcelFile ([string]$excelPath, [string]$hashFile) {
    $parent = Split-Path $excelPath -Parent
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $item = @(Get-GovPlAssetLinks | Where-Object { Test-GovExcelAsset $_ } | Select-Object -First 1)
    if ($item.Count -eq 0) {
        throw "gov.pl has no link to the question-bank Excel."
    }
    Write-Host "-> 1 MB hash of the Excel from the server (re-download if it changed since last time)..." -ForegroundColor Cyan
    if (-not (Test-RemoteFileNeedsDownload -url $item[0].Url -hashFilePath $hashFile -localFilePath $excelPath)) {
        Write-Host "-> Excel unchanged. Parsing local file: $excelPath" -ForegroundColor Gray
        return
    }
    Write-Host "-> Downloading Excel from gov.pl (no media ZIP) to $excelPath..." -ForegroundColor Cyan
    Invoke-CurlDownload -url $item[0].Url -outFile $excelPath
    Save-PrefixHash -hashFilePath $hashFile -url $item[0].Url
}

function Copy-GovJsonToServer ([string]$govDir, [string]$swPrefix) {
    $dstData = Join-Path $targetDir "src\data"
    $dstIndex = Join-Path $targetDir "src\index.html"
    if (-not (Test-Path -LiteralPath $dstIndex) -or -not (Test-Path -LiteralPath $dstData)) {
        return $false
    }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    Copy-Item -LiteralPath (Join-Path $govDir "meta.json") -Destination (Join-Path $dstData "meta.json") -Force
    foreach ($cat in (Get-PrawkoCategoryIds)) {
        $srcJson = Join-Path $govDir "$cat.json"
        if (Test-Path -LiteralPath $srcJson) {
            Copy-Item -LiteralPath $srcJson -Destination (Join-Path $dstData "$cat.json") -Force
        }
    }
    foreach ($tr in @("translations_en.json", "translations_de.json", "translations_uk.json")) {
        $srcTr = Join-Path $govDir $tr
        if (Test-Path -LiteralPath $srcTr) {
            Copy-Item -LiteralPath $srcTr -Destination (Join-Path $dstData $tr) -Force
        }
    }
    $swPath = Join-Path $targetDir "src\sw.js"
    if (Test-Path -LiteralPath $swPath) {
        $swRaw = [IO.File]::ReadAllText($swPath)
        $stamp = Get-Date -Format "yyyyMMddHHmmss"
        $swNew = [regex]::Replace($swRaw, "const CACHE_VERSION = '[^']+';", "const CACHE_VERSION = '$swPrefix-$stamp';", 1)
        if ($swNew -eq $swRaw) {
            throw "Could not stamp CACHE_VERSION in $swPath"
        }
        [IO.File]::WriteAllText($swPath, $swNew, $utf8)
        Write-Host "Service worker: $swPrefix-$stamp" -ForegroundColor Cyan
    }
    return $true
}

function Publish-GovQuestions {
    Import-PrawkoGovLibrary
    $govDir = Get-GovDataDir
    $excelPath = Join-Path $govDir "baza_pytan.xlsx"

    Write-Host "GovQuestions: Excel from gov.pl → $govDir (contrib\src\data left untouched)" -ForegroundColor Cyan
    Write-Host "No media ZIP, no src\media, no CDN change." -ForegroundColor Gray
    Invoke-PrawkoScript "download-gov.ps1" @("-ExcelOnly")
    Invoke-PrawkoScript "parse-excel.ps1" @("-Excel", $excelPath, "-OutDir", $govDir)
    Assert-GovDataParsed -govDir $govDir -excelPath $excelPath

    Remove-LegacyServerRawMediaDir

    try {
        if (Copy-GovJsonToServer -govDir $govDir -swPrefix "prawko-govq") {
            Write-Host "Done. Server reads JSON from the ministry. -Patch will not undo this (it skips data\)." -ForegroundColor Green
            Write-Host "Originals remain in contrib\src\data. Videos from CDN. Offline: Download offline on the category." -ForegroundColor Gray
        } else {
            Write-Host "Server is not installed — ministry JSON only in gov-data. After install, run -GovQuestions again." -ForegroundColor DarkYellow
            Write-Host "Done. Originals in contrib\src\data; they reach the server only after -GovQuestions." -ForegroundColor Green
        }
    } catch {
        Write-Host "Ministry JSON is in gov-data, but could not write it to the server: $($_.Exception.Message)" -ForegroundColor DarkYellow
        Write-Host "contrib\src\data left untouched. Run as administrator or copy gov-data by hand." -ForegroundColor DarkYellow
    }
}

function Publish-GovInstall {
    Import-PrawkoGovLibrary
    $govDir = Get-GovDataDir
    $excelPath = Join-Path $govDir "baza_pytan.xlsx"
    $serverReady = Test-PrawkoServerInstalled
    $mediaRoot = if ($serverReady) { $targetDir } else { Join-Path $env:LOCALAPPDATA "prawko" }
    $imgOut = Join-Path $mediaRoot $(if ($serverReady) { "src\media\img" } else { "media\img" })
    $vidOut = Join-Path $mediaRoot $(if ($serverReady) { "src\media\vid" } else { "media\vid" })

    Write-Host "InstallGov: Excel + situational media ZIP from gov.pl → $govDir (not ProgramData, not git)." -ForegroundColor Cyan
    Write-Host "download-gov → raw; convert-media → src\media; parse-excel → JSON." -ForegroundColor Gray
    Write-Host "Not downloading Polish Sign Language (PJM) translations. A clean install without this switch = AnabelMaz/prawko + CDN." -ForegroundColor Gray

    Update-SessionPath
    if (-not (Resolve-FfmpegExe)) {
        New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
        Write-Host "[No FFmpeg] Downloading a portable build to $toolsDir ..." -ForegroundColor Yellow
        Install-PortableFfmpeg
    }
    $ffmpegExe = Resolve-FfmpegExe
    if (-not $ffmpegExe) { throw "FFmpeg is not available (neither on the system nor in $toolsDir)." }
    Write-Host "[OK] FFmpeg: $ffmpegExe" -ForegroundColor Green

    Invoke-PrawkoScript "download-gov.ps1"
    if (-not (Test-Path -LiteralPath $excelPath)) {
        throw "Missing $excelPath — the question bank from gov.pl was not downloaded."
    }

    Write-Host "`n=== Converting situational media (JPG→WebP, WMV→MP4) ===" -ForegroundColor Cyan
    Invoke-PrawkoScript "convert-media.ps1" @(
        "-SourceDir", (Get-ContribRawMediaDir),
        "-FfmpegExe", $ffmpegExe,
        "-ImgOut", $imgOut,
        "-VidOut", $vidOut
    )

    Write-Host "`n=== JSON from Excel → gov-data ===" -ForegroundColor Cyan
    $parseArgs = @("-Excel", $excelPath, "-OutDir", $govDir)
    if ($DropMissingMedia) {
        $parseArgs += @("-MediaDir", (Get-ContribRawMediaDir), "-DropMissingMedia")
        Write-Host "DropMissingMedia: questions without a local file in raw lose their media reference." -ForegroundColor DarkYellow
    }
    Invoke-PrawkoScript "parse-excel.ps1" $parseArgs
    Assert-GovDataParsed -govDir $govDir -excelPath $excelPath

    Remove-LegacyServerRawMediaDir

    $dstIndex = Join-Path $targetDir "src\index.html"
    if (-not (Test-Path -LiteralPath $dstIndex)) {
        Write-Host "Server is not installed — Excel/JSON/media in $govDir and $mediaRoot. After install, run -InstallGov again." -ForegroundColor DarkYellow
        Write-Host "Done. A clean install without -InstallGov = AnabelMaz/prawko + CDN." -ForegroundColor Green
        return
    }

    try {
        Write-Host "Copying ministry JSON to the server (git / contrib\src\data left untouched)..." -ForegroundColor Cyan
        if (-not (Copy-GovJsonToServer -govDir $govDir -swPrefix "prawko-govmedia")) {
            throw "Missing src\data on the server."
        }
        $dstMedia = Join-Path $targetDir "src\media"
        $dstImg = Join-Path $dstMedia "img"
        $dstVid = Join-Path $dstMedia "vid"
        if (Test-SamePath $imgOut $dstImg) {
            Write-Host "WebP/MP4 already in $dstMedia (conversion on the server)." -ForegroundColor Gray
        } else {
            Write-Host "Copying WebP/MP4: $imgOut + $vidOut → $dstMedia" -ForegroundColor Cyan
            New-Item -ItemType Directory -Path $dstImg -Force | Out-Null
            New-Item -ItemType Directory -Path $dstVid -Force | Out-Null
            & robocopy.exe $imgOut $dstImg /E /R:2 /W:1 /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "robocopy img failed (exit $LASTEXITCODE)" }
            & robocopy.exe $vidOut $dstVid /E /R:2 /W:1 /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "robocopy vid failed (exit $LASTEXITCODE)" }
        }
        Set-LocalMediaBase -root $targetDir
        Write-Host "Done. Server: JSON + media from gov.pl. -Patch will not overwrite data\ or media\." -ForegroundColor Green
        Write-Host "After -Uninstall and an install without -InstallGov you get AnabelMaz/prawko + CDN again. ZIP/raw stay in %LOCALAPPDATA%\prawko\gov-data." -ForegroundColor Gray
    } catch {
        Write-Host "JSON/media are in staging, but could not write them to the server: $($_.Exception.Message)" -ForegroundColor DarkYellow
        Write-Host "Check permissions on $targetDir." -ForegroundColor DarkYellow
    }
}

function Convert-GovMedia ($ffmpegExe, $sourceDir, $imgOut, $vidOut) {
    New-Item -ItemType Directory -Path $imgOut -Force | Out-Null
    New-Item -ItemType Directory -Path $vidOut -Force | Out-Null

    $images = @(Get-ChildItem -Path $sourceDir -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -match '^\.(jpe?g)$' })
    $videos = @(Get-ChildItem -Path $sourceDir -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -match '^\.wmv$' -and $_.Name -notmatch '(?i)^pjm' })

    Write-Host "-> Converting JPG images → WebP ($($images.Count) files)..." -ForegroundColor Cyan
    $i = 0
    foreach ($img in $images) {
        $i++
        $dest = Join-Path $imgOut ($img.BaseName + ".webp")
        if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) { continue }
        & $ffmpegExe -y -hide_banner -loglevel error -i $img.FullName -c:v libwebp -quality 80 $dest
        if ($i % 50 -eq 0) {
            Write-Host "   images $i / $($images.Count)" -ForegroundColor DarkGray
        }
    }

    Write-Host "-> Converting WMV videos → MP4 ($($videos.Count) files, this may take a while)..." -ForegroundColor Cyan
    $i = 0
    foreach ($vid in $videos) {
        $i++
        $dest = Join-Path $vidOut ($vid.BaseName + ".mp4")
        if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) { continue }
        & $ffmpegExe -y -hide_banner -loglevel error -i $vid.FullName `
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

    $webpCount = @(Get-ChildItem $imgOut -Filter *.webp -ErrorAction SilentlyContinue).Count
    $mp4Count = @(Get-ChildItem $vidOut -Filter *.mp4 -ErrorAction SilentlyContinue).Count
    foreach ($ready in @(Get-ChildItem -Path $sourceDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.webp$' })) {
        $dest = Join-Path $imgOut $ready.Name
        if (-not (Test-Path $dest)) { Copy-Item -LiteralPath $ready.FullName -Destination $dest }
    }
    foreach ($ready in @(Get-ChildItem -Path $sourceDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.mp4$' })) {
        $dest = Join-Path $vidOut $ready.Name
        if (-not (Test-Path $dest)) { Copy-Item -LiteralPath $ready.FullName -Destination $dest }
    }
    $webpCount = @(Get-ChildItem $imgOut -Filter *.webp -ErrorAction SilentlyContinue).Count
    $mp4Count = @(Get-ChildItem $vidOut -Filter *.mp4 -ErrorAction SilentlyContinue).Count
    Write-Host "-> Media ready for the app: $webpCount WebP, $mp4Count MP4" -ForegroundColor Green
}

function Restore-InitialLocation {
    if ($script:initialLocationPath -and (Test-Path -LiteralPath $script:initialLocationPath)) {
        Set-Location -LiteralPath $script:initialLocationPath
    }
}
function Complete-IfInteractive {
    Restore-InitialLocation
    if ($NonInteractive) { return }
    if (-not [Environment]::UserInteractive) { return }
    try { if ([Console]::IsInputRedirected) { return } } catch { }
    Read-Host "Press Enter to close"
}

function Invoke-Uninstall {
    Write-Host "=== UNINSTALL: removing the Prawko service and directory ===" -ForegroundColor Cyan
    $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($svc) {
        Write-Host "Stopping service $serviceName..." -ForegroundColor Yellow
        Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
    }

    $nssmLocal = Resolve-NssmExe
    if ($nssmLocal) {
        cmd.exe /c "`"$nssmLocal`" stop $serviceName >nul 2>&1"
        cmd.exe /c "`"$nssmLocal`" remove $serviceName confirm >nul 2>&1"
    } else {
        cmd.exe /c "sc.exe stop $serviceName >nul 2>&1"
        cmd.exe /c "sc.exe delete $serviceName >nul 2>&1"
    }

    Start-Sleep -Seconds 2

    if (Test-Path $targetDir) {
        Write-Host "Removing $targetDir ..." -ForegroundColor Yellow
        Remove-Item -LiteralPath $targetDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $targetDir) {
        & cmd.exe /c "rmdir /s /q `"$targetDir`""
    }
    if (Test-Path $targetDir) {
        throw "Could not remove $targetDir. Close Cursor/the browser if that folder is open and try again."
    }

    Write-Host "Removed service $serviceName and the application directory." -ForegroundColor Green
    Write-Host "Git, Node and NSSM stay (they were on the system or installed globally)." -ForegroundColor Gray
    Write-Host "FFmpeg from tools\ in the Prawko directory was removed with the folder." -ForegroundColor Gray
}

if ($PSBoundParameters.ContainsKey("Dev") -and -not $Uninstall) {
    Write-Host "=== Git for changes (-Dev) — no Node, no server ===" -ForegroundColor Cyan
    Update-SessionPath
    if (-not (Test-CommandExists "git")) {
        Write-Host "[No Git] Installing Git (-Dev only)..." -ForegroundColor Yellow
        Install-WingetPackage -id "Git.Git"
        Update-SessionPath
    }
    if (-not (Test-CommandExists "git")) {
        throw "Git is missing. -Dev needs Git (not Node and not the server). Install Git or run -Dev as administrator (winget)."
    }
    Install-DevWorkClone -Destination $Dev
    if ($Patch) {
        if (Test-PrawkoServerInstalled) {
            Apply-PrawkoAppFixes -root $targetDir
            Write-Host "Done. In the open app, banner: Update available / Refresh." -ForegroundColor Green
        } else {
            Write-Host "Server is not running — -Patch skipped. First Install_Prawko.windows.ps1 with no switches, then -Patch." -ForegroundColor DarkYellow
        }
    } else {
        Write-Host "This does not start localhost. App: Install_Prawko.windows.ps1 with no switches." -ForegroundColor Gray
    }
    Complete-IfInteractive
    exit 0
}

if ($GovQuestions -or $InstallGov -or $Merge) {
    $prawkoGovLib = Resolve-PrawkoPipelineScript "download-gov.ps1"
    if (-not $prawkoGovLib) {
        throw "Missing scripts\download-gov.ps1. Run Install_Prawko.windows.ps1 with no switches (it will download the app with scripts into $targetDir) or run the installer from the root of a cloned repo."
    }
    . $prawkoGovLib -LibraryOnly
    if (-not (Get-Command Get-GovDataDir -ErrorAction SilentlyContinue)) {
        throw "Did not load Get-GovDataDir from $prawkoGovLib."
    }
}

if ($GovQuestions) {
    Publish-GovQuestions
    Complete-IfInteractive
    exit 0
}

if ($InstallGov) {
    Publish-GovInstall
    Complete-IfInteractive
    exit 0
}

if ($Merge) {
    if (-not (Test-PrawkoServerInstalled)) {
        throw "-Merge needs a running server. First Install_Prawko.windows.ps1 with no switches."
    }
    Write-Host "=== MERGE: gaps from ministry Excel (no service reinstall) ===" -ForegroundColor Cyan
    Remove-LegacyServerRawMediaDir
    Import-PrawkoGovLibrary
    Invoke-PrawkoScript "download-gov.ps1" @("-ExcelOnly")
    $govDir = Get-GovDataDir
    $excelPath = Join-Path $govDir "baza_pytan.xlsx"
    if (-not (Test-Path -LiteralPath $excelPath)) {
        throw "Missing $excelPath — no downloaded ministry question bank to merge."
    }
    Invoke-PrawkoScript "parse-excel.ps1" @("-Excel", $excelPath, "-OutDir", $govDir)
    $mergeArgs = @(
        "-GovDir", $govDir,
        "-OutDir", (Join-Path $targetDir "src\data")
    )
    $ffmpegMerge = Resolve-FfmpegExe
    if ($ffmpegMerge) { $mergeArgs += @("-FfmpegExe", $ffmpegMerge) }
    $mergeMedia = New-Object System.Collections.Generic.List[string]
    $rawMerge = Get-ContribRawMediaDir
    if ($rawMerge -and (Test-Path -LiteralPath $rawMerge)) { [void]$mergeMedia.Add($rawMerge) }
    if (Test-Path -LiteralPath $mediaOutImg) { [void]$mergeMedia.Add($mediaOutImg) }
    if (Test-Path -LiteralPath $mediaOutVid) { [void]$mergeMedia.Add($mediaOutVid) }
    try {
        $contribRoot = Get-ContribRoot
        foreach ($rel in @("src\media\img", "src\media\vid")) {
            $mp = Join-Path $contribRoot $rel
            if (Test-Path -LiteralPath $mp) { [void]$mergeMedia.Add($mp) }
        }
    } catch {}
    if ($mergeMedia.Count -gt 0) {
        $mergeArgs += @("-MediaDir", ($mergeMedia.ToArray() -join ";"))
    }
    Invoke-PrawkoScript "merge-gov.ps1" $mergeArgs
    Restore-LocalMediaBaseIfNeeded -Root $targetDir
    Complete-IfInteractive
    exit 0
}

if ($Uninstall) {
    Update-SessionPath
    Invoke-Uninstall
    Complete-IfInteractive
    exit 0
}

Write-Host "=== 1. CHECKING AND INSTALLING TOOLS ===" -ForegroundColor Cyan
Update-SessionPath

if (-not (Resolve-NodeExe)) {
    Write-Host "[No Node.js] Installing Node.js..." -ForegroundColor Yellow
    Install-WingetPackage -id "OpenJS.NodeJS.LTS"
    if (-not (Resolve-NodeExe)) { throw "Node.js is not available after install." }
} else { Write-Host "[OK] Node.js" -ForegroundColor Green }

if (-not (Resolve-NssmExe)) {
    Write-Host "[No NSSM] Installing NSSM..." -ForegroundColor Yellow
    Install-WingetPackage -id "NSSM.NSSM"
    if (-not (Resolve-NssmExe)) { throw "NSSM is not available after install." }
} else { Write-Host "[OK] NSSM" -ForegroundColor Green }

Write-Host "-> Git skipped (server from ZIP). For code: -Dev." -ForegroundColor Gray

$ffmpegExe = $null
Write-Host "-> Default mode: ZIP AnabelMaz/prawko ($repoBranch) + prawko-maz CDN." -ForegroundColor Gray

$nssmExe = Resolve-NssmExe
$nodeExe = Resolve-NodeExe


Write-Host "`n=== 2. STOPPING THE WINDOWS SERVICE (IF RUNNING) ===" -ForegroundColor Cyan
$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Stopping and removing previous service $serviceName..." -ForegroundColor Yellow
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
    cmd.exe /c "`"$nssmExe`" stop $serviceName >nul 2>&1"
    cmd.exe /c "`"$nssmExe`" remove $serviceName confirm >nul 2>&1"
}


Write-Host "`n=== 3. PREPARING THE APPLICATION DIRECTORY ===" -ForegroundColor Cyan
$repoGit = Join-Path $targetDir ".git"
if (Test-PrawkoServerInstalled) {
    Write-Host "Server already has src in $targetDir — skipping download / clone." -ForegroundColor Yellow
    Write-Host "src\data, src\media and overlaid code stay. From scratch: -Uninstall." -ForegroundColor Gray
} elseif (Test-Path $repoGit) {
    throw "Directory $targetDir has .git but no src\index.html. Use -Uninstall and install again."
} else {
    if (Test-Path $targetDir) {
        $leftovers = @(Get-ChildItem -Path $targetDir -Force)
        if ($leftovers.Count -gt 0) {
            throw "Directory $targetDir already exists and is not empty. Remove or empty it before install."
        }
    } else {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    Install-PrawkoFromGithubArchive -Destination $targetDir
}

Write-Host "Application directory ready: $targetDir" -ForegroundColor Green
Remove-LegacyServerRawMediaDir

Write-Host "`n=== 4–5. SKIPPED (question bank from AnabelMaz/prawko ZIP) ===" -ForegroundColor Cyan
Write-Host "-> Questions: src\data from the pack. Media: prawko-maz CDN." -ForegroundColor Gray
Write-Host "-> Ministry Excel+ZIP: Install_Prawko.windows.ps1 -InstallGov" -ForegroundColor Gray
Write-Host "-> Ministry question catalog: Install_Prawko.windows.ps1 -GovQuestions" -ForegroundColor Gray
Write-Host "-> Gaps from ministry:    Install_Prawko.windows.ps1 -Merge" -ForegroundColor Gray
Write-Host "-> Local contrib: Install_Prawko.windows.ps1 -Patch" -ForegroundColor Gray
Write-Host "-> Git for changes:    Install_Prawko.windows.ps1 -Dev D:\prawko (no server)" -ForegroundColor Gray

if ($Patch) {
    Write-Host "`n=== 5b. CODE FROM LOCAL CONTRIB (-Patch) ===" -ForegroundColor Cyan
    Apply-PrawkoAppFixes -root $targetDir
} else {
    Write-Host "`n=== 5b. SKIPPED (no -Patch) ===" -ForegroundColor Cyan
    Write-Host "-> App code stays as in AnabelMaz/prawko. Local contrib: Install_Prawko.windows.ps1 -Patch" -ForegroundColor Gray
}


Write-Host "`n=== 6. NPM INSTALL AND WINDOWS SERVICE REGISTRATION ===" -ForegroundColor Cyan
Set-Location $targetDir

$npmCmd = Join-Path (Split-Path $nodeExe -Parent) "npm.cmd"
if (-not (Test-Path $npmCmd)) { $npmCmd = "npm.cmd" }

if (-not (Test-Path (Join-Path $targetDir "package.json"))) {
    throw "Missing package.json in $targetDir — GitHub ZIP download failed."
}

Write-Host "Installing 'serve'..." -ForegroundColor Yellow
& $npmCmd install --omit=dev --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { throw "npm install --omit=dev failed." }
& $npmCmd install serve --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { throw "npm install serve failed." }

$serveEntry = Resolve-ServeEntry $targetDir
if (-not $serveEntry) { throw "Could not find the 'serve' package in node_modules." }

$srcDir = Join-Path $targetDir "src"
if (-not (Test-Path (Join-Path $srcDir "index.html"))) {
    throw "Missing src\index.html."
}

icacls $targetDir /grant "*S-1-1-0:(OI)(CI)F" /T | Out-Null

Write-Host "Registering service $serviceName..." -ForegroundColor Yellow
& $nssmExe install $serviceName $nodeExe
& $nssmExe set $serviceName AppParameters "`"$serveEntry`" -s . -l $listenPort"
& $nssmExe set $serviceName AppDirectory $srcDir
& $nssmExe set $serviceName AppEnvironmentExtra "PATH=$(Split-Path $nodeExe -Parent)"
& $nssmExe set $serviceName Start SERVICE_AUTO_START
& $nssmExe set $serviceName AppStdout (Join-Path $targetDir "service_output.log")
& $nssmExe set $serviceName AppStderr (Join-Path $targetDir "service_error.log")
& $nssmExe set $serviceName AppRotateFiles 1

Write-Host "Starting the Windows service..." -ForegroundColor Green
& $nssmExe start $serviceName
Start-Sleep -Seconds 4

$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host "`n==================================================" -ForegroundColor Green
    Write-Host " SERVICE STARTED SUCCESSFULLY! " -ForegroundColor Green
    Write-Host " Application: http://localhost:$listenPort " -ForegroundColor Yellow
    Write-Host " Questions:   bank from AnabelMaz/prawko (src\data) " -ForegroundColor Yellow
        Write-Host " Media:     prawko-maz CDN (Backblaze) " -ForegroundColor Yellow
        Write-Host " Ministry Excel+ZIP:   Install_Prawko.windows.ps1 -InstallGov " -ForegroundColor DarkGray
        Write-Host " Ministry question catalog: Install_Prawko.windows.ps1 -GovQuestions " -ForegroundColor DarkGray
        Write-Host " Gaps from ministry:    Install_Prawko.windows.ps1 -Merge " -ForegroundColor DarkGray
        Write-Host " Local contrib: Install_Prawko.windows.ps1 -Patch " -ForegroundColor DarkGray
        Write-Host " Git for changes:    Install_Prawko.windows.ps1 -Dev D:\prawko " -ForegroundColor DarkGray
    Write-Host "==================================================" -ForegroundColor Green
} else {
    Write-Host "`n[ERROR] Service did not start." -ForegroundColor Red
    $errLog = Join-Path $targetDir "service_error.log"
    if (Test-Path $errLog) { Get-Content $errLog -Tail 20 }
    Restore-InitialLocation
    exit 1
}

Complete-IfInteractive
