# UTF-8 with BOM — Windows PowerShell 5.1 otherwise misreads Polish text and here-strings.
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
    # Proces bywa już odpalony z -ExecutionPolicy Bypass.
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
Install_Prawko.ps1 — instalator Prawko (egzamin na prawo jazdy) na Windows.

SKŁADNIA
  powershell -ExecutionPolicy Bypass -File Install_Prawko.ps1 [opcje]
  Ściągnij ten plik z GitHuba i zapisz gdzie chcesz — nie musi leżeć w repo.

PRZEŁĄCZNIKI
  (brak)            Tryb domyślny: ZIP z GitHub AnabelMaz/prawko (gałąź $repoBranch),
                    usługa http://localhost:$listenPort. Bez Gita. Pytania z repo,
                    media z CDN prawko-maz. Gdy serwer już stoi, nic nie nadpisuje.
                    Lokalny contrib: -Patch. Pytania MI na dysk: -InstallGov.
                    Od zera: -Uninstall.

  -InstallGov       Excel + ZIP multimediów sytuacyjnych z gov.pl: staging w
                    %LOCALAPPDATA%\prawko\gov-data (ZIP, surowe JPG/WMV).
                    Konwersja (WebP/MP4) i JSON idą na serwer
                    C:\ProgramData\prawko — jedna kopia do oglądania.
                    Nie dubluje mediów w git/contrib. Mało miejsca na C:
                    ZIP/raw mogą spaść na gov-data w checkoutcie (inny dysk).
                    Tłumaczeń migowych (PJM) nie pobiera. Nie rusza src\data
                    w gicie. Gdy serwer stoi, przełącza MEDIA_BASE na lokalne
                    pliki. -Patch pomija data\ i media\. Po -Uninstall i
                    instalacji bez tego przełącznika znowu AnabelMaz/prawko
                    + CDN. Bez administratora, bez reinstalu usługi.

  -DropMissingMedia Tylko z -InstallGov: parser wykreśla z JSON media, których
                    pliku nie ma w lokalnym raw. Domyślnie NIE — nazwa z
                    Excela zostaje (CDN / Pobierz offline).

  -GovQuestions     Tylko katalog pytań z ministerstwa na żywy serwer.
                    Excel → %LOCALAPPDATA%\prawko\gov-data, JSON na
                    C:\ProgramData\prawko\src\data. Nie rusza src\data w gicie.
                    Nie rusza src\media ani CDN. Offline: „Pobierz offline”.
                    Bez administratora, bez reinstalu usługi.

  -Patch            Nakłada kod z lokalnego checkoutu (-Dev, obok skryptu,
                    ..\prawko-contrib, ..\contrib). Pomija data\ i media\.
                    Bez contrib nic nie nakłada — serwer i tak ma AnabelMaz
                    z instalacji. Na już stojącym serwerze: tylko overlay,
                    bez admina, bez git checkout, bez reinstalu usługi.
                    Przy pierwszej instalacji: ZIP AnabelMaz + usługa + overlay.

  -Export <ścieżka> Kopiuje paczkę do wskazanego katalogu (robocopy), bez
                    instalacji i bez ruszania serwera:
                      <ścieżka>\prawko\Install_Prawko.ps1
                      <ścieżka>\prawko-contrib\
                    Contrib szuka: obok skryptu, ..\prawko-contrib, ..\contrib.
                    Z wyeksportowanej paczki działa instalacja, -Patch,
                    -InstallGov i kolejne -Export na inny folder.
                    Pomija node_modules i .git. Bez administratora.

  -Dev <ścieżka>    Tylko klon gita do prac (kod, commit, push). Folder pusty
                    albo jeszcze nie istnieje. Nie ProgramData. Nie instaluje
                    Node, NSSM ani usługi — nawet gdy serwer jeszcze nie stoi.
                    Git doinstaluje się tylko tu. Żeby mieć localhost: najpierw
                    instalator bez przełączników, potem -Dev.
                    Nie klonuje do C:\ProgramData\prawko. Pomija Git LFS.

  -Merge            Na już stojącym serwerze: dopisuje z Excel MI tylko braki.
                    Nie stawia usługi, nie instaluje Node/Git. Brak serwera =
                    najpierw instalacja bez przełączników.

  -Uninstall        Usuwa usługę PrawkoWORDService i katalog
                    C:\ProgramData\prawko (w tym FFmpeg ściągnięty tam
                    przez -InstallGov). Git/Node/NSSM zostają w systemie.

  -NonInteractive   Bez pauzy Enter na końcu (skrypty, zadanie).

  -Help             Ta pomoc (nie wymaga administratora).

JEDEN PLIK / PACZKA
  Z GitHuba wystarczy sam Install_Prawko.ps1. Odpalasz go z Pobrań, Pulpitu
  albo dowolnego folderu: doinstaluje Node/NSSM, ściągnie ZIP AnabelMaz/prawko
  do C:\ProgramData\prawko i stawia http://localhost:5173. Bez Gita.
  Git tylko gdy podasz -Dev.

DWA TYPY UŻYTKOWNIKA
  Zwykły: tylko instalator bez przełączników. ZIP + Node + usługa. Bez Gita.
  Deweloper: tylko kod, bez serwera:
    powershell -ExecutionPolicy Bypass -File Install_Prawko.ps1 -Dev D:\prawko
  Oba (localhost + git): najpierw bez przełączników, potem -Dev.

  Każdy przełącznik doinstalowuje tylko to, czego używa:
    (brak)           Node, NSSM, ZIP aplikacji, usługa
    -Dev             Git + klon (bez Node, bez serwera)
    -Patch           nic nowego (nakłada contrib na stojący serwer)
    -InstallGov      FFmpeg gdy brak; Excel+ZIP z gov.pl
    -GovQuestions    tylko Excel z gov.pl
    -Merge           Excel z gov.pl, zapis do stojącego serwera
    -Export          nic (kopia plików)
    -Uninstall       nic nowego

CZEGO WYMAGA APLIKACJA
  Serwer (bez przełączników): Node.js + usługa 'serve'. Git NIE. Python NIE.
  -Dev: tylko Git. FFmpeg przy -InstallGov (JPG/WMV) i -Merge (klatki); gdy brak,
  skrypt kładzie wersję przenośną do C:\ProgramData\prawko\tools (znika z -Uninstall).
  ZIP-y rozpakowuje wbudowany tar Windows. Aplikacja oczekuje WebP/MP4, nie JPG/WMV.
"@
    exit 0
}

function Set-LocalMediaBase ($root) {
    $dataJs = Join-Path $root "src\js\data.js"
    if (-not (Test-Path $dataJs)) { throw "Brak $dataJs" }
    $content = [IO.File]::ReadAllText($dataJs)
    $updated = [regex]::Replace(
        $content,
        "export const MEDIA_BASE = [^;\r\n]+",
        "export const MEDIA_BASE = 'media'"
    )
    if ($updated -eq $content -and $content -notmatch "export const MEDIA_BASE = 'media'") {
        throw "Nie udało się ustawić lokalnego MEDIA_BASE w data.js"
    }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText($dataJs, $updated, $utf8)
    Write-Host "-> Aplikacja będzie brać multimedia z src\media (nie z CDN)." -ForegroundColor Green
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
        throw "Brak lokalnego checkoutu do zmian. Odpal Install_Prawko.ps1 -Dev <ścieżka> albo trzymaj repo obok instalatora. Do zwykłej instalacji -Dev nie jest potrzebny."
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
    if (Get-Command Get-PrawkoRepoRoot -ErrorAction SilentlyContinue) { return }
    $lib = Resolve-PrawkoPipelineScript "download-gov.ps1"
    if (-not $lib) {
        throw "Brak scripts\download-gov.ps1. Odpal Install_Prawko.ps1 bez przełączników (ściągnie aplikację ze skryptami do $targetDir) albo odpal instalator z katalogu głównego sklonowanego repo."
    }
    . $lib -LibraryOnly
}

function Invoke-PrawkoScript {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string[]]$ArgumentList = @()
    )
    $path = Resolve-PrawkoPipelineScript $Name
    if (-not $path) {
        throw "Brak skryptu $Name (szukano w scripts\ obok instalatora, w contrib i w $targetDir\scripts)."
    }
    Write-Host "-> $Name $($ArgumentList -join ' ')" -ForegroundColor Cyan
    & $path @ArgumentList
}

function Assert-GovDataParsed ([string]$govDir, [string]$excelPath) {
    $metaFile = Join-Path $govDir "meta.json"
    if (-not (Test-Path -LiteralPath $metaFile)) { throw "Brak meta.json po parsowaniu Excela." }
    $meta = Get-Content $metaFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $qTotal = ($meta.categories | Measure-Object -Property questionCount -Sum).Sum
    if ($qTotal -lt 100) {
        throw "Parser Excela zapisał za mało pytań ($qTotal). Sprawdź układ kolumn w $excelPath."
    }
    Write-Host "-> W gov-data: $qTotal przypisań pytań. Oryginały w contrib\src\data zostają." -ForegroundColor Green
}

function Remove-LegacyServerRawMediaDir {
    $legacy = Join-Path $targetDir $rawMediaFolderName
    if (-not (Test-Path -LiteralPath $legacy)) { return }
    Write-Host "Usuwam zbędny katalog surowych mediów z serwera: $legacy" -ForegroundColor Yellow
    Remove-Item -LiteralPath $legacy -Recurse -Force
    if (Test-Path -LiteralPath $legacy) {
        throw "Nie udało się usunąć $legacy. Zamknij programy, które trzymają ten folder, i spróbuj ponownie."
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

function Invoke-SafeRobocopy {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList
    )
    & robocopy.exe $Source $Destination @ArgumentList | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "robocopy nie powiodło się (kod $LASTEXITCODE): $Source -> $Destination"
    }
}

function Set-ServerCacheVersion {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Prefix
    )
    $swPath = Join-Path $Root "src\sw.js"
    if (-not (Test-Path -LiteralPath $swPath)) {
        throw "Brak $swPath"
    }
    $swRaw = [IO.File]::ReadAllText($swPath)
    $stamp = Get-Date -Format "yyyyMMddHHmmss"
    $swNew = [regex]::Replace($swRaw, "const CACHE_VERSION = '[^']+';", "const CACHE_VERSION = '$Prefix-$stamp';", 1)
    if ($swNew -eq $swRaw) {
        throw "Nie udało się ustawić CACHE_VERSION w $swPath"
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
        throw "Brak $srcIndex"
    }
    if (-not (Test-Path -LiteralPath $dstIndex)) {
        throw "Serwer nie jest zainstalowany (brak $dstIndex). Najpierw Install_Prawko.ps1 bez przełączników (albo z -Patch)."
    }
    Write-Host "-> Nakładanie $srcApp -> $dstApp (pomijam data\ i media\)" -ForegroundColor Cyan
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
        Write-Host "-> Brak lokalnego contrib. Zostawiam kod z GitHub $repoUrl ($repoBranch)." -ForegroundColor Yellow
        return
    }
    $patchSrc = Join-Path $localContrib "src"
    Write-Host "-> Nakładanie kodu z lokalnego contrib: $localContrib" -ForegroundColor Yellow
    if (-not (Test-Path (Join-Path $patchSrc "index.html"))) {
        throw "Źródło poprawek nie zawiera src\index.html."
    }
    Publish-AppSrcOverlay -SourceSrc $patchSrc -DestRoot $root -CachePrefix "prawko-patch"
    Write-Host "-> Nałożono kod z lokalnego contrib." -ForegroundColor Green
}

function Export-PrawkoPack ([string]$Destination) {
    if ([string]::IsNullOrWhiteSpace($Destination)) {
        throw "-Export wymaga ścieżki, np. -Export D:\kopia\prawko-pack"
    }
    $destRoot = $Destination
    if (-not [IO.Path]::IsPathRooted($destRoot)) {
        $destRoot = Join-Path (Get-Location).Path $destRoot
    }
    $destRoot = [IO.Path]::GetFullPath($destRoot)
    if (Test-Path -LiteralPath $destRoot -PathType Leaf) {
        throw "-Export: '$destRoot' to plik, podaj katalog."
    }
    if (Test-PathIsInside $destRoot $targetDir) {
        throw "-Export nie kopiuje do zainstalowanego serwera ($targetDir)."
    }

    $contribSrc = Get-ContribRoot
    if (Test-PathIsInside $destRoot $contribSrc) {
        throw "-Export: katalog docelowy nie może leżeć wewnątrz contrib ($contribSrc)."
    }

    $destInstall = Join-Path $destRoot "prawko"
    $destContrib = Join-Path $destRoot "prawko-contrib"
    $scriptDst = Join-Path $destInstall "Install_Prawko.ps1"

    Write-Host "Export -> $destRoot" -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $destInstall -Force | Out-Null
    $stub = @"
# Launcher. Real installer: ..\prawko-contrib\Install_Prawko.ps1
`$ErrorActionPreference = "Stop"
`$real = Join-Path `$PSScriptRoot "..\prawko-contrib\Install_Prawko.ps1"
if (-not (Test-Path -LiteralPath `$real)) {
    throw "Nie znaleziono `$real"
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
        Write-Host "-> Contrib już jest w $destContrib (pomijam kopię)." -ForegroundColor Gray
    } else {
        New-Item -ItemType Directory -Path $destContrib -Force | Out-Null
        Write-Host "-> robocopy contrib: $contribSrc -> $destContrib (bez node_modules/.git, bez /MIR)" -ForegroundColor Cyan
        Write-Host "   Duże src\media mogą chwilę zająć. Istniejące pliki w celu są aktualizowane, nic nie kasuję." -ForegroundColor Gray
        Invoke-SafeRobocopy -Source $contribSrc -Destination $destContrib -ArgumentList @(
            "/E", "/XD", "node_modules", ".git", "test-results", "playwright-report", "blob-report", "coverage", ".cursor",
            "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"
        )
        $idx = Join-Path $destContrib "src\index.html"
        if (-not (Test-Path -LiteralPath $idx)) {
            throw "Po eksporcie brak $idx"
        }
        Write-Host "-> Contrib: $destContrib" -ForegroundColor Green
    }

    Write-Host "Gotowe. Z paczki:" -ForegroundColor Green
    Write-Host "  powershell -ExecutionPolicy Bypass -File `"$scriptDst`""
    Write-Host "  ... -Patch  /  -InstallGov  /  -Export <inny folder>"
}

if ($PSBoundParameters.ContainsKey("Export")) {
    Export-PrawkoPack -Destination $Export
    exit 0
}

if ($Patch -and -not $Merge -and -not $Uninstall -and -not $PSBoundParameters.ContainsKey("Dev") -and (Test-PrawkoServerInstalled)) {
    Remove-LegacyServerRawMediaDir
    Apply-PrawkoAppFixes -root $targetDir
    Write-Host "Gotowe. W otwartej aplikacji baner: Dostępna aktualizacja / Odśwież." -ForegroundColor Green
    exit 0
}

if (-not $Uninstall -and -not $Merge -and -not $GovQuestions -and -not $InstallGov -and -not $Patch -and -not $PSBoundParameters.ContainsKey("Dev") -and (Test-PrawkoServerInstalled)) {
    Remove-LegacyServerRawMediaDir
    Write-Host "Serwer już stoi w $targetDir — nie nadpisuję plików (żadnego git checkout / pull)." -ForegroundColor Yellow
    Write-Host "  Kod z lokalnego contrib: Install_Prawko.ps1 -Patch" -ForegroundColor Gray
    Write-Host "  Pytania MI:        Install_Prawko.ps1 -InstallGov   albo   -GovQuestions" -ForegroundColor Gray
    Write-Host "  Git do zmian:      Install_Prawko.ps1 -Dev D:\prawko" -ForegroundColor Gray
    Write-Host "  Paczka na USB:     Install_Prawko.ps1 -Export D:\kopia" -ForegroundColor Gray
    Write-Host "  Instalacja od zera: Install_Prawko.ps1 -Uninstall   potem bez przełączników" -ForegroundColor Gray
    exit 0
}

function Test-IsAdmin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Admin tylko: pierwsza instalacja serwera albo -Uninstall.
# -Dev / -Patch / -Merge / -InstallGov / -GovQuestions / -Export: bez elewacji.
$installingServer = -not $Uninstall -and -not $Merge -and -not $GovQuestions -and -not $InstallGov -and -not $PSBoundParameters.ContainsKey("Dev") -and -not $PSBoundParameters.ContainsKey("Export") -and -not (Test-PrawkoServerInstalled)
if (($Uninstall -or $installingServer) -and -not (Test-IsAdmin)) {
    Write-Host "Wymagane uprawnienia administratora. Ponawiam z elewacją..." -ForegroundColor Yellow
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
            throw "Git $($Arguments -join ' ') nie powiodło się (kod $exitCode). $($diagnostic -join ' ')"
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
        throw "-Dev wymaga ścieżki, np. -Dev D:\prawko"
    }
    $dest = $Destination
    if (-not [IO.Path]::IsPathRooted($dest)) {
        $dest = Join-Path (Get-Location).Path $dest
    }
    $dest = [IO.Path]::GetFullPath($dest)
    if (Test-SamePath $dest $targetDir) {
        throw "-Dev nie klonuje do serwera ($targetDir). Podaj osobny folder na kod i git."
    }
    if (Test-PathIsInside $dest $targetDir) {
        throw "-Dev: folder nie może leżeć wewnątrz $targetDir."
    }
    if (Test-LooksLikePrawkoRepo $dest) {
        Write-Host "-> Git do zmian już jest: $dest (pomijam clone)." -ForegroundColor Yellow
        $script:devWorkRoot = $dest
        return
    }
    if (Test-Path -LiteralPath $dest) {
        $leftovers = @(Get-ChildItem -LiteralPath $dest -Force)
        if ($leftovers.Count -gt 0) {
            throw "Katalog $dest już istnieje i nie jest checkoutem Prawko. Podaj pusty folder albo inną ścieżkę."
        }
    }
    Write-Host "Klonowanie $repoUrl ($repoBranch) → $dest (kod, bez Git LFS / mediów)..." -ForegroundColor Yellow
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
        throw "Po -Dev brak src\index.html w $dest"
    }
    $script:devWorkRoot = $dest
    Write-Host "Git do zmian: $dest" -ForegroundColor Green
    Write-Host "Podgląd zostaje w $targetDir. Tu commitujesz i pushujesz. Na serwer: Install_Prawko.ps1 -Patch (albo -Dev ta-sama-ścieżka -Patch)." -ForegroundColor Gray
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

# Tylko bieżąca sesja ($env:Path). Nie zapisuje Machine/User PATH.
# Po winget instalator dopisuje katalogi do PATH w rejestrze — tu wczytujemy
# aktualny Machine+User i dopisujemy na końcu sesji to, czego jeszcze nie ma.
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
        throw "winget install $id zakończył się kodem $LASTEXITCODE"
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

# Hash pierwszego 1 MB zdalnego pliku — tak jak w oryginale.
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

# true = trzeba ściągnąć całość. Hash 1 MB porównujemy z poprzednim pobraniem.
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
        Write-Host "-> Nie sprawdzę serwera; zostawiam lokalny plik." -ForegroundColor Gray
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

function Install-PrawkoFromGithubArchive ([string]$Destination) {
    $zipUrl = "https://github.com/AnabelMaz/prawko/archive/refs/heads/$repoBranch.zip"
    $stageRoot = Join-Path ([IO.Path]::GetTempPath()) ("prawko-zip-" + [guid]::NewGuid().ToString("N"))
    $zipPath = Join-Path $stageRoot "prawko.zip"
    New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
    try {
        Write-Host "Pobieram AnabelMaz/prawko ($repoBranch) jako ZIP — bez Gita..." -ForegroundColor Yellow
        Invoke-CurlDownload -url $zipUrl -outFile $zipPath
        $unpack = Join-Path $stageRoot "unpack"
        Expand-ZipToDirectory -zipPath $zipPath -destination $unpack
        $inner = Get-ChildItem -LiteralPath $unpack -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $inner) {
            throw "ZIP z GitHuba nie zawiera katalogu (oczekiwano prawko-$repoBranch)."
        }
        $index = Join-Path $inner.FullName "src\index.html"
        if (-not (Test-Path -LiteralPath $index)) {
            throw "ZIP z GitHuba nie wygląda na Prawko (brak src\index.html w $($inner.FullName))."
        }
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
        Invoke-SafeRobocopy -Source $inner.FullName -Destination $Destination -ArgumentList @(
            "/E", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"
        )
        if (-not (Test-Path -LiteralPath (Join-Path $Destination "src\index.html"))) {
            throw "Po rozpakowaniu brak src\index.html w $Destination"
        }
        Write-Host "Aplikacja z ZIP: $Destination" -ForegroundColor Green
    } finally {
        if (Test-Path -LiteralPath $stageRoot) {
            Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
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
    Write-Host "-> Pobieram FFmpeg (przenośny) do $ffmpegRoot ..." -ForegroundColor Yellow
    Invoke-CurlDownload -url "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -outFile $zipPath
    Expand-ZipToDirectory -zipPath $zipPath -destination $ffmpegRoot
    $exe = Get-ChildItem $ffmpegRoot -Filter "ffmpeg.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $exe) { throw "Po rozpakowaniu nie ma ffmpeg.exe w $ffmpegRoot" }
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    Write-Host "-> FFmpeg lokalny: $($exe.FullName) (zniknie z -Uninstall)." -ForegroundColor Green
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
        throw "Nie udało się zaaplikować poprawki w $path"
    }
    Set-TextFileLf $path ($lf.Replace($findLf, $replaceLf)) $nl
    return $true
}

function Apply-LegacyPrawkoAppFixes ($root) {
    $learnJs = Join-Path $root "src\js\learn.js"
    $offlineJs = Join-Path $root "src\js\offline.js"
    $swJs = Join-Path $root "src\sw.js"
    foreach ($f in @($learnJs, $offlineJs, $swJs)) {
        if (-not (Test-Path $f)) { throw "Brak $f" }
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
        Write-Host "-> Nałożono poprawki: nauka (ponowna odpowiedź) i media offline." -ForegroundColor Green
    } else {
        Write-Host "-> Poprawki nauki i offline już są nałożone." -ForegroundColor Gray
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
    throw "Brak kolumny $label w Excelu. Naglowki: $($header -join ' | ')"
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
        if (-not $sheetEntry) { throw "Brak xl/worksheets/sheet1.xml w $xlsxPath" }
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

function Get-QuestionIdKey ($id) {
    return ([string]$id).Trim()
}

function Get-QuestionTextKey ($text) {
    if ([string]::IsNullOrWhiteSpace([string]$text)) { return "" }
    $t = ([string]$text).Trim() -replace '\s+', ' '
    return $t.ToLowerInvariant()
}

function Get-QuestionMediaStem ($media) {
    $name = [IO.Path]::GetFileName(([string]$media).Trim())
    if ([string]::IsNullOrWhiteSpace($name)) { return "" }
    return [IO.Path]::GetFileNameWithoutExtension($name).ToLowerInvariant()
}

function Get-UniqueQuestionId ([string]$desired, $existingIds) {
    $base = Get-QuestionIdKey $desired
    if ([string]::IsNullOrWhiteSpace($base)) { $base = "mi" }
    if (-not $existingIds.Contains($base)) { return $base }
    $n = 1
    do {
        $id = if ($n -eq 1) { "$base-mi" } else { "$base-mi$n" }
        $n++
    } while ($existingIds.Contains($id))
    return $id
}

function Get-QuestionDuplicateReason ($q, $candidates, $ffmpegExe, $ffprobeExe, $mediaIndex) {
    if ($null -eq $candidates -or $candidates.Count -eq 0) { return $null }
    $newStem = Get-QuestionMediaStem $q.media
    foreach ($old in $candidates) {
        $oldStem = Get-QuestionMediaStem $old.media
        if ($newStem -and $oldStem -and ($newStem -eq $oldStem)) { return "filename" }
        if (-not $newStem -and -not $oldStem) { return "text-only" }
        if ($ffmpegExe -and (Test-QuestionMediaVisuallySame $ffmpegExe $ffprobeExe $mediaIndex $q $old)) {
            return "visual"
        }
    }
    return $null
}

$script:MediaVisualCache = @{}
$script:MediaVisualSize = 96
$script:MediaVisualThreshold = 0.95

function Get-FfprobeExe ([string]$ffmpegExe) {
    if (-not $ffmpegExe) { return $null }
    $probe = Join-Path (Split-Path $ffmpegExe -Parent) "ffprobe.exe"
    if (Test-Path -LiteralPath $probe) { return $probe }
    return $null
}

function Test-MediaPathIsVideo ([string]$path, $question) {
    $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
    if ($ext -in @(".mp4", ".wmv", ".webm", ".avi", ".mov")) { return $true }
    return ([string]$question.mediaType -eq "video")
}

function Get-FfmpegRawFrame ([string]$ffmpegExe, [string]$path, [double]$startAt, [int]$size) {
    $ss = ""
    if ($startAt -gt 0) {
        $ss = "-ss " + $startAt.ToString("0.###", [Globalization.CultureInfo]::InvariantCulture) + " "
    }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ffmpegExe
    $vf = "scale=${size}:${size}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:black"
    $psi.Arguments = "-hide_banner -loglevel error -nostdin $ss-i `"$path`" -an -vf `"$vf`" -frames:v 1 -f rawvideo -pix_fmt rgb24 pipe:1"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $outMs = New-Object System.IO.MemoryStream
    $errMs = New-Object System.IO.MemoryStream
    $errTask = $proc.StandardError.BaseStream.CopyToAsync($errMs)
    $proc.StandardOutput.BaseStream.CopyTo($outMs)
    [void]$errTask.Wait()
    $proc.WaitForExit()
    $bytes = $outMs.ToArray()
    $outMs.Dispose()
    $errMs.Dispose()
    $expected = $size * $size * 3
    if ($proc.ExitCode -ne 0 -or $bytes.Length -lt $expected) { return $null }
    if ($bytes.Length -eq $expected) { return $bytes }
    $trim = New-Object byte[] $expected
    [Array]::Copy($bytes, $trim, $expected)
    return $trim
}

function Get-MediaDurationSeconds ([string]$ffprobeExe, [string]$path) {
    if (-not $ffprobeExe) { return 0.0 }
    $raw = & $ffprobeExe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $path 2>$null
    $text = (($raw | Out-String) -replace '\s+', '').Trim()
    $dur = 0.0
    if ([double]::TryParse($text, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$dur)) {
        return $dur
    }
    return 0.0
}

function Get-MediaVisualSignature ([string]$ffmpegExe, [string]$ffprobeExe, [string]$path, $question) {
    if ($script:MediaVisualCache.ContainsKey($path)) {
        return $script:MediaVisualCache[$path]
    }
    $size = $script:MediaVisualSize
    $sig = $null
    if (Test-MediaPathIsVideo $path $question) {
        $dur = Get-MediaDurationSeconds $ffprobeExe $path
        $tMid = if ($dur -gt 0.4) { $dur / 2.0 } else { 0.0 }
        $tLast = if ($dur -gt 0.2) { [Math]::Max(0.0, $dur - 0.08) } else { 0.0 }
        $f0 = Get-FfmpegRawFrame $ffmpegExe $path 0.0 $size
        $f1 = Get-FfmpegRawFrame $ffmpegExe $path $tMid $size
        $f2 = Get-FfmpegRawFrame $ffmpegExe $path $tLast $size
        if ($f0 -and $f1 -and $f2) {
            $sig = New-Object byte[] ($f0.Length + $f1.Length + $f2.Length)
            [Array]::Copy($f0, 0, $sig, 0, $f0.Length)
            [Array]::Copy($f1, 0, $sig, $f0.Length, $f1.Length)
            [Array]::Copy($f2, 0, $sig, ($f0.Length + $f1.Length), $f2.Length)
        }
    } else {
        $sig = Get-FfmpegRawFrame $ffmpegExe $path 0.0 $size
    }
    $script:MediaVisualCache[$path] = $sig
    return $sig
}

function Get-RgbSimilarity ([byte[]]$a, [byte[]]$b) {
    if ($null -eq $a -or $null -eq $b -or $a.Length -eq 0 -or $a.Length -ne $b.Length) { return 0.0 }
    $sum = [int64]0
    for ($i = 0; $i -lt $a.Length; $i++) {
        $sum += [Math]::Abs([int]$a[$i] - [int]$b[$i])
    }
    return [double](1.0 - ($sum / ($a.Length * 255.0)))
}

function New-MediaStemIndex ([string[]]$directories) {
    $map = @{}
    foreach ($dir in $directories) {
        if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
        Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | ForEach-Object {
            $stem = $_.BaseName.ToLowerInvariant()
            $ext = $_.Extension.ToLowerInvariant()
            $prefer = $ext -in @(".webp", ".mp4")
            if (-not $map.ContainsKey($stem) -or $prefer) {
                $map[$stem] = $_.FullName
            }
        }
    }
    return $map
}

function Test-QuestionMediaVisuallySame ($ffmpegExe, $ffprobeExe, $mediaIndex, $left, $right) {
    if (-not $ffmpegExe -or $null -eq $mediaIndex) { return $false }
    $stemL = Get-QuestionMediaStem $left.media
    $stemR = Get-QuestionMediaStem $right.media
    if (-not $stemL -or -not $stemR) { return $false }
    if (-not $mediaIndex.ContainsKey($stemL) -or -not $mediaIndex.ContainsKey($stemR)) { return $false }
    $pathL = $mediaIndex[$stemL]
    $pathR = $mediaIndex[$stemR]
    $sigL = Get-MediaVisualSignature $ffmpegExe $ffprobeExe $pathL $left
    $sigR = Get-MediaVisualSignature $ffmpegExe $ffprobeExe $pathR $right
    $sim = Get-RgbSimilarity $sigL $sigR
    return ($sim -ge $script:MediaVisualThreshold)
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

function Import-GovExcelIfMissing ([string]$excelPath) {
    if (Test-Path $excelPath) {
        Write-Host "-> Używam ściągniętego Excela MI: $excelPath" -ForegroundColor Gray
        return
    }
    New-Item -ItemType Directory -Path (Split-Path $excelPath -Parent) -Force | Out-Null
    $item = @(Get-GovPlAssetLinks | Where-Object { Test-GovExcelAsset $_ } | Select-Object -First 1)
    if ($item.Count -eq 0) {
        throw "gov.pl nie ma linku do Excela z bazą pytań."
    }
    Write-Host "-> Brak $excelPath — pobieram Excel z gov.pl (bez ZIP multimediów)..." -ForegroundColor Cyan
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
    Write-Host "-> Parsuję Excel (xlsx/XML, bez Pythona): $excelPath" -ForegroundColor Cyan
    $sheet = Read-XlsxSheetRows $excelPath
    $rows = $sheet.Rows
    if ($rows.Count -lt 2) { throw "Excel nie ma wierszy danych." }

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

    # KeepMediaRefs: nazwy plików z Excela zostają (CDN / Pobierz offline).
    # DropMissingMedia tylko na życzenie — inaczej parser nie zeruje mediów.
    $parsed = if ($DropMissingMedia) {
        Get-GovExcelCategoryQuestions -excelPath $excelPath -mediaDir $mediaDir -DropMissingMedia
    } else {
        Get-GovExcelCategoryQuestions -excelPath $excelPath
    }
    if ($parsed.MissingMedia) {
        Write-Host "  WARNING: $($parsed.MissingMedia) pytań wskazuje na media, których nie ma w katalogu źródłowym." -ForegroundColor DarkYellow
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
    Write-Host "-> Zapisano meta.json ($($uniqueIds.Count) unikalnych pytań, $total przypisań do kategorii)." -ForegroundColor Green
    if ($KeepMediaRefs) {
        Write-Host "-> $mediaRefs odwołań do mediów zostawionych w JSON (CDN / Pobierz offline)." -ForegroundColor Green
    }
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

    Write-Host "GovQuestions: Excel z gov.pl → $govDir (contrib\src\data nietknięty)" -ForegroundColor Cyan
    Write-Host "Bez ZIP multimediów, bez src\media, bez zmiany CDN." -ForegroundColor Gray
    Invoke-PrawkoScript "download-gov.ps1" @("-ExcelOnly")
    Invoke-PrawkoScript "parse-excel.ps1" @("-Excel", $excelPath, "-OutDir", $govDir)
    Assert-GovDataParsed -govDir $govDir -excelPath $excelPath

    Remove-LegacyServerRawMediaDir

    try {
        if (Copy-GovJsonToServer -govDir $govDir -swPrefix "prawko-govq") {
            Write-Host "Done. Serwer czyta JSON z ministerstwa. -Patch tego nie cofnie (pomija data\)." -ForegroundColor Green
            Write-Host "Oryginały nadal w contrib\src\data. Filmy z CDN. Offline: Pobierz offline przy kategorii." -ForegroundColor Gray
        } else {
            Write-Host "Serwer nie zainstalowany — JSON ministerstwa tylko w gov-data. Po instalacji odpal -GovQuestions jeszcze raz." -ForegroundColor DarkYellow
            Write-Host "Done. Oryginały w contrib\src\data; na serwer trafią dopiero po -GovQuestions." -ForegroundColor Green
        }
    } catch {
        Write-Host "JSON ministerstwa jest w gov-data, ale nie udało się zapisać na serwer: $($_.Exception.Message)" -ForegroundColor DarkYellow
        Write-Host "contrib\src\data nietknięty. Odpal jako administrator albo skopiuj gov-data ręcznie." -ForegroundColor DarkYellow
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

    Write-Host "InstallGov: Excel + ZIP multimediów sytuacyjnych z gov.pl → $govDir (nie ProgramData, nie git)." -ForegroundColor Cyan
    Write-Host "download-gov → raw; convert-media → src\media; parse-excel → JSON." -ForegroundColor Gray
    Write-Host "Tłumaczeń migowych (PJM) nie pobieram. Czysta instalacja bez tego przełącznika = AnabelMaz/prawko + CDN." -ForegroundColor Gray

    Update-SessionPath
    if (-not (Resolve-FfmpegExe)) {
        New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
        Write-Host "[Brak FFmpeg] Pobieram wersję przenośną do $toolsDir ..." -ForegroundColor Yellow
        Install-PortableFfmpeg
    }
    $ffmpegExe = Resolve-FfmpegExe
    if (-not $ffmpegExe) { throw "FFmpeg nie jest dostępny (ani w systemie, ani w $toolsDir)." }
    Write-Host "[OK] FFmpeg: $ffmpegExe" -ForegroundColor Green

    Invoke-PrawkoScript "download-gov.ps1"
    if (-not (Test-Path -LiteralPath $excelPath)) {
        throw "Brak $excelPath — baza pytań z gov.pl nie została pobrana."
    }

    Write-Host "`n=== Konwersja mediów sytuacyjnych (JPG→WebP, WMV→MP4) ===" -ForegroundColor Cyan
    Invoke-PrawkoScript "convert-media.ps1" @(
        "-FfmpegExe", $ffmpegExe,
        "-ImgOut", $imgOut,
        "-VidOut", $vidOut
    )

    Write-Host "`n=== JSON z Excela → gov-data ===" -ForegroundColor Cyan
    $parseArgs = @("-Excel", $excelPath, "-OutDir", $govDir)
    if ($DropMissingMedia) {
        $parseArgs += @("-MediaDir", (Get-ContribRawMediaDir), "-DropMissingMedia")
        Write-Host "DropMissingMedia: pytania bez lokalnego pliku w raw tracą odwołanie do mediów." -ForegroundColor DarkYellow
    }
    Invoke-PrawkoScript "parse-excel.ps1" $parseArgs
    Assert-GovDataParsed -govDir $govDir -excelPath $excelPath

    Remove-LegacyServerRawMediaDir

    $dstIndex = Join-Path $targetDir "src\index.html"
    if (-not (Test-Path -LiteralPath $dstIndex)) {
        Write-Host "Serwer nie zainstalowany — Excel/JSON/media w $govDir i $mediaRoot. Po instalacji odpal -InstallGov jeszcze raz." -ForegroundColor DarkYellow
        Write-Host "Done. Czysta instalacja bez -InstallGov = AnabelMaz/prawko + CDN." -ForegroundColor Green
        return
    }

    try {
        Write-Host "Kopiuję JSON MI na serwer (git/ contrib\src\data nietknięty)..." -ForegroundColor Cyan
        if (-not (Copy-GovJsonToServer -govDir $govDir -swPrefix "prawko-govmedia")) {
            throw "Brak src\data na serwerze."
        }
        $dstMedia = Join-Path $targetDir "src\media"
        $dstImg = Join-Path $dstMedia "img"
        $dstVid = Join-Path $dstMedia "vid"
        if (Test-SamePath $imgOut $dstImg) {
            Write-Host "WebP/MP4 już w $dstMedia (konwersja na serwer)." -ForegroundColor Gray
        } else {
            Write-Host "Kopiuję WebP/MP4: $imgOut + $vidOut → $dstMedia" -ForegroundColor Cyan
            New-Item -ItemType Directory -Path $dstImg -Force | Out-Null
            New-Item -ItemType Directory -Path $dstVid -Force | Out-Null
            & robocopy.exe $imgOut $dstImg /E /R:2 /W:1 /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "robocopy img failed (exit $LASTEXITCODE)" }
            & robocopy.exe $vidOut $dstVid /E /R:2 /W:1 /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "robocopy vid failed (exit $LASTEXITCODE)" }
        }
        Set-LocalMediaBase -root $targetDir
        Write-Host "Done. Serwer: JSON + media z gov.pl. -Patch nie nadpisze data\ ani media\." -ForegroundColor Green
        Write-Host "Po -Uninstall i instalacji bez -InstallGov znowu AnabelMaz/prawko + CDN. ZIP/raw zostają w %LOCALAPPDATA%\prawko\gov-data." -ForegroundColor Gray
    } catch {
        Write-Host "JSON/media są w staging, ale nie udało się zapisać na serwer: $($_.Exception.Message)" -ForegroundColor DarkYellow
        Write-Host "Sprawdź uprawnienia do $targetDir." -ForegroundColor DarkYellow
    }
}

function Merge-GovExcelIntoDataFiles ([string]$govDir, [string]$outDir) {
    $categories = Get-PrawkoCategoryIds
    $parsedCategories = @{}
    foreach ($cat in $categories) {
        $src = Join-Path $govDir "$cat.json"
        if (-not (Test-Path -LiteralPath $src)) {
            throw "Brak $src — najpierw scripts/parse-excel.ps1."
        }
        $payload = Get-Content -LiteralPath $src -Raw -Encoding UTF8 | ConvertFrom-Json
        $parsedCategories[$cat] = @($payload.questions)
    }
    $mediaDir = Get-ContribRawMediaDir
    $utf8 = New-Object System.Text.UTF8Encoding $false
    $addedTotal = 0
    $metaCategories = @()
    $script:MediaVisualCache = @{}
    $ffmpegExe = Resolve-FfmpegExe
    $ffprobeExe = Get-FfprobeExe $ffmpegExe
    $indexDirs = New-Object System.Collections.Generic.List[string]
    if ($mediaDir) { [void]$indexDirs.Add($mediaDir) }
    [void]$indexDirs.Add($mediaOutImg)
    [void]$indexDirs.Add($mediaOutVid)
    try {
        $contribRoot = Get-ContribRoot
        [void]$indexDirs.Add((Join-Path $contribRoot "src\media\img"))
        [void]$indexDirs.Add((Join-Path $contribRoot "src\media\vid"))
    } catch {}
    $mediaIndex = New-MediaStemIndex $indexDirs.ToArray()
    if (-not $ffmpegExe) {
        Write-Host "-> Brak FFmpeg — merge bez porównania klatek (tylko nazwa pliku mediów)." -ForegroundColor DarkYellow
    } elseif ($mediaIndex.Count -eq 0) {
        Write-Host "-> Brak lokalnych mediów — merge bez porównania klatek (tylko nazwa pliku)." -ForegroundColor DarkYellow
        $ffmpegExe = $null
    } else {
        Write-Host "-> Porównanie wizualne mediów (FFmpeg $($script:MediaVisualSize)×$($script:MediaVisualSize), próg $([int]($script:MediaVisualThreshold * 100))%, filmy: 1./środkowa/ostatnia klatka)." -ForegroundColor Cyan
    }

    foreach ($cat in $categories) {
        $path = Join-Path $outDir "$cat.json"
        if (-not (Test-Path $path)) {
            throw "Brak $path — merge wymaga bazy z repozytorium."
        }
        $data = Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
        $existingIds = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        $byText = @{}
        $list = New-Object System.Collections.Generic.List[object]
        foreach ($q in @($data.questions)) {
            [void]$existingIds.Add((Get-QuestionIdKey $q.id))
            $tk = Get-QuestionTextKey $q.q
            if ($tk) {
                if (-not $byText.ContainsKey($tk)) {
                    $byText[$tk] = New-Object System.Collections.Generic.List[object]
                }
                $byText[$tk].Add($q)
            }
            $list.Add($q)
        }

        $added = 0
        $skippedSame = 0
        $skippedVisual = 0
        $idRewritten = 0
        foreach ($q in $parsedCategories[$cat]) {
            $tk = Get-QuestionTextKey $q.q
            if (-not $tk) { continue }
            $candidates = $null
            if ($byText.ContainsKey($tk)) { $candidates = $byText[$tk] }
            $why = Get-QuestionDuplicateReason $q $candidates $ffmpegExe $ffprobeExe $mediaIndex
            if ($why -eq "filename" -or $why -eq "text-only") {
                $skippedSame++
                continue
            }
            if ($why -eq "visual") {
                $skippedVisual++
                continue
            }
            $newId = Get-UniqueQuestionId ([string]$q.id) $existingIds
            $toAdd = $q
            if ((Get-QuestionIdKey $newId) -ne (Get-QuestionIdKey $q.id)) {
                $toAdd = $q.PSObject.Copy()
                $toAdd.id = $newId
                $idRewritten++
            }
            [void]$existingIds.Add((Get-QuestionIdKey $toAdd.id))
            if (-not $byText.ContainsKey($tk)) {
                $byText[$tk] = New-Object System.Collections.Generic.List[object]
            }
            $byText[$tk].Add($toAdd)
            $list.Add($toAdd)
            $added++
        }

        $questions = $list.ToArray()
        $basic = @($questions | Where-Object { $_.type -eq "basic" }).Count
        $specialist = @($questions | Where-Object { $_.type -eq "specialist" }).Count
        $payload = [ordered]@{ category = $cat; questions = $questions }
        [IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $payload -Depth 8), $utf8)
        $metaCategories += [ordered]@{
            id              = $cat
            name            = "Kategoria $cat"
            questionCount   = $questions.Length
            basicCount      = $basic
            specialistCount = $specialist
        }
        $addedTotal += $added
        $skipBits = @()
        if ($skippedSame) { $skipBits += "ta sama treść+media: $skippedSame" }
        if ($skippedVisual) { $skipBits += "ta sama treść+klatki ≥95%: $skippedVisual" }
        if ($idRewritten) { $skipBits += "nowe id (numer zajęty): $idRewritten" }
        $skipNote = if ($skipBits.Count) { ", pominięto $($skipBits -join ', ')" } else { "" }
        Write-Host ("  {0,3}: +{1,4} z MI (razem {2}{3})" -f $cat, $added, $questions.Length, $skipNote)
    }

    $metaPath = Join-Path $outDir "meta.json"
    $exam = $null
    if (Test-Path $metaPath) {
        $oldMeta = Get-Content $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $exam = $oldMeta.exam
        for ($i = 0; $i -lt $metaCategories.Count; $i++) {
            $id = $metaCategories[$i].id
            $prev = @($oldMeta.categories | Where-Object { $_.id -eq $id } | Select-Object -First 1)
            if ($prev.Count -gt 0 -and $prev[0].name) {
                $metaCategories[$i].name = [string]$prev[0].name
            }
        }
    }
    if (-not $exam) {
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
    }
    $meta = [ordered]@{ categories = $metaCategories; exam = $exam }
    [IO.File]::WriteAllText($metaPath, (ConvertTo-Json -InputObject $meta -Depth 8), $utf8)
    Write-Host "-> Merge: dopisano $addedTotal pytań z bazy MI, których nie było w repo." -ForegroundColor Green
}

function Convert-GovMedia ($ffmpegExe, $sourceDir, $imgOut, $vidOut) {
    New-Item -ItemType Directory -Path $imgOut -Force | Out-Null
    New-Item -ItemType Directory -Path $vidOut -Force | Out-Null

    $images = @(Get-ChildItem -Path $sourceDir -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -match '^\.(jpe?g)$' })
    $videos = @(Get-ChildItem -Path $sourceDir -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -match '^\.wmv$' -and $_.Name -notmatch '(?i)^pjm' })

    Write-Host "-> Konwersja obrazów JPG → WebP ($($images.Count) plików)..." -ForegroundColor Cyan
    $i = 0
    foreach ($img in $images) {
        $i++
        $dest = Join-Path $imgOut ($img.BaseName + ".webp")
        if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) { continue }
        & $ffmpegExe -y -hide_banner -loglevel error -i $img.FullName -c:v libwebp -quality 80 $dest
        if ($i % 50 -eq 0) {
            Write-Host "   obrazy $i / $($images.Count)" -ForegroundColor DarkGray
        }
    }

    Write-Host "-> Konwersja filmów WMV → MP4 ($($videos.Count) plików, to może potrwać)..." -ForegroundColor Cyan
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
            Write-Host "   pominięto (błąd ffmpeg): $($vid.Name)" -ForegroundColor DarkYellow
        }
        if ($i % 10 -eq 0) {
            Write-Host "   filmy $i / $($videos.Count)" -ForegroundColor DarkGray
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
    Write-Host "-> Gotowe multimedia dla aplikacji: $webpCount WebP, $mp4Count MP4" -ForegroundColor Green
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
    Read-Host "Naciśnij Enter, aby zamknąć"
}

function Invoke-Uninstall {
    Write-Host "=== UNINSTALL: usuwanie usługi i katalogu Prawko ===" -ForegroundColor Cyan
    $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($svc) {
        Write-Host "Zatrzymywanie usługi $serviceName..." -ForegroundColor Yellow
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
        Write-Host "Usuwam $targetDir ..." -ForegroundColor Yellow
        Remove-Item -LiteralPath $targetDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $targetDir) {
        & cmd.exe /c "rmdir /s /q `"$targetDir`""
    }
    if (Test-Path $targetDir) {
        throw "Nie udało się usunąć $targetDir. Zamknij Cursor/przeglądarkę jeśli ten folder jest otwarty i spróbuj ponownie."
    }

    Write-Host "Usunięto usługę $serviceName i katalog aplikacji." -ForegroundColor Green
    Write-Host "Git, Node i NSSM zostają (były w systemie albo instalowane globalnie)." -ForegroundColor Gray
    Write-Host "FFmpeg z tools\ w katalogu Prawko został usunięty razem z folderem." -ForegroundColor Gray
}

if ($PSBoundParameters.ContainsKey("Dev") -and -not $Uninstall) {
    Write-Host "=== Git do zmian (-Dev) — bez Node, bez serwera ===" -ForegroundColor Cyan
    Update-SessionPath
    if (-not (Test-CommandExists "git")) {
        Write-Host "[Brak Git] Instaluję Git (tylko -Dev)..." -ForegroundColor Yellow
        Install-WingetPackage -id "Git.Git"
        Update-SessionPath
    }
    if (-not (Test-CommandExists "git")) {
        throw "Brak Git. -Dev potrzebuje Gita (nie Node i nie serwera). Zainstaluj Git albo odpal -Dev jako administrator (winget)."
    }
    Install-DevWorkClone -Destination $Dev
    if ($Patch) {
        if (Test-PrawkoServerInstalled) {
            Apply-PrawkoAppFixes -root $targetDir
            Write-Host "Gotowe. W otwartej aplikacji baner: Dostępna aktualizacja / Odśwież." -ForegroundColor Green
        } else {
            Write-Host "Serwer nie stoi — -Patch pominięty. Najpierw Install_Prawko.ps1 bez przełączników, potem -Patch." -ForegroundColor DarkYellow
        }
    } else {
        Write-Host "To nie stawia localhost. Aplikacja: Install_Prawko.ps1 bez przełączników." -ForegroundColor Gray
    }
    Complete-IfInteractive
    exit 0
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
        throw "-Merge wymaga stojącego serwera. Najpierw Install_Prawko.ps1 bez przełączników."
    }
    Write-Host "=== MERGE: braki z Excel MI (bez reinstalu usługi) ===" -ForegroundColor Cyan
    Remove-LegacyServerRawMediaDir
    Import-PrawkoGovLibrary
    Invoke-PrawkoScript "download-gov.ps1" @("-ExcelOnly")
    $govDir = Get-GovDataDir
    $excelPath = Join-Path $govDir "baza_pytan.xlsx"
    if (-not (Test-Path -LiteralPath $excelPath)) {
        throw "Brak $excelPath — nie ma ściągniętej bazy ministerstwa do merge."
    }
    Invoke-PrawkoScript "parse-excel.ps1" @("-Excel", $excelPath, "-OutDir", $govDir)
    Merge-GovExcelIntoDataFiles -govDir $govDir -outDir (Join-Path $targetDir "src\data")
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

Write-Host "=== 1. SPRAWDZANIE I INSTALACJA NARZĘDZI ===" -ForegroundColor Cyan
Update-SessionPath

if (-not (Resolve-NodeExe)) {
    Write-Host "[Brak Node.js] Instaluję Node.js..." -ForegroundColor Yellow
    Install-WingetPackage -id "OpenJS.NodeJS.LTS"
    if (-not (Resolve-NodeExe)) { throw "Node.js nie jest dostępny po instalacji." }
} else { Write-Host "[OK] Node.js" -ForegroundColor Green }

if (-not (Resolve-NssmExe)) {
    Write-Host "[Brak NSSM] Instaluję NSSM..." -ForegroundColor Yellow
    Install-WingetPackage -id "NSSM.NSSM"
    if (-not (Resolve-NssmExe)) { throw "NSSM nie jest dostępny po instalacji." }
} else { Write-Host "[OK] NSSM" -ForegroundColor Green }

Write-Host "-> Git pominięty (serwer ze ZIP). Do kodu: -Dev." -ForegroundColor Gray

$ffmpegExe = $null
Write-Host "-> Tryb domyślny: ZIP AnabelMaz/prawko ($repoBranch) + CDN prawko-maz." -ForegroundColor Gray

$nssmExe = Resolve-NssmExe
$nodeExe = Resolve-NodeExe


Write-Host "`n=== 2. ZATRZYMYWANIE USŁUGI WINDOWS (JEŚLI DZIAŁA) ===" -ForegroundColor Cyan
$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Zatrzymywanie i usuwanie poprzedniej usługi $serviceName..." -ForegroundColor Yellow
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
    cmd.exe /c "`"$nssmExe`" stop $serviceName >nul 2>&1"
    cmd.exe /c "`"$nssmExe`" remove $serviceName confirm >nul 2>&1"
}


Write-Host "`n=== 3. PRZYGOTOWANIE KATALOGU APLIKACJI ===" -ForegroundColor Cyan
$repoGit = Join-Path $targetDir ".git"
if (Test-PrawkoServerInstalled) {
    Write-Host "Serwer już ma src w $targetDir — pomijam pobieranie / clone." -ForegroundColor Yellow
    Write-Host "src\data, src\media i nałożony kod zostają. Od zera: -Uninstall." -ForegroundColor Gray
} elseif (Test-Path $repoGit) {
    throw "Katalog $targetDir ma .git, ale brak src\index.html. Użyj -Uninstall i zainstaluj ponownie."
} else {
    if (Test-Path $targetDir) {
        $leftovers = @(Get-ChildItem -Path $targetDir -Force)
        if ($leftovers.Count -gt 0) {
            throw "Katalog $targetDir już istnieje i nie jest pusty. Usuń go albo opróżnij przed instalacją."
        }
    } else {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    Install-PrawkoFromGithubArchive -Destination $targetDir
}

Write-Host "Katalog aplikacji gotowy: $targetDir" -ForegroundColor Green
Remove-LegacyServerRawMediaDir

Write-Host "`n=== 4–5. POMINIĘTE (baza z ZIP AnabelMaz/prawko) ===" -ForegroundColor Cyan
Write-Host "-> Pytania: src\data z paczki. Media: CDN prawko-maz." -ForegroundColor Gray
Write-Host "-> Excel+ZIP MI: Install_Prawko.ps1 -InstallGov" -ForegroundColor Gray
Write-Host "-> Katalog pytań MI: Install_Prawko.ps1 -GovQuestions" -ForegroundColor Gray
Write-Host "-> Braki z MI:    Install_Prawko.ps1 -Merge" -ForegroundColor Gray
Write-Host "-> Lokalny contrib: Install_Prawko.ps1 -Patch" -ForegroundColor Gray
Write-Host "-> Git do zmian:    Install_Prawko.ps1 -Dev D:\prawko (bez serwera)" -ForegroundColor Gray

if ($Patch) {
    Write-Host "`n=== 5b. KOD Z LOKALNEGO CONTRIB (-Patch) ===" -ForegroundColor Cyan
    Apply-PrawkoAppFixes -root $targetDir
} else {
    Write-Host "`n=== 5b. POMINIĘTE (bez -Patch) ===" -ForegroundColor Cyan
    Write-Host "-> Kod aplikacji zostaje jak w AnabelMaz/prawko. Lokalny contrib: Install_Prawko.ps1 -Patch" -ForegroundColor Gray
}


Write-Host "`n=== 6. INSTALACJA NPM I REJESTRACJA USŁUGI WINDOWS ===" -ForegroundColor Cyan
Set-Location $targetDir

$npmCmd = Join-Path (Split-Path $nodeExe -Parent) "npm.cmd"
if (-not (Test-Path $npmCmd)) { $npmCmd = "npm.cmd" }

if (-not (Test-Path (Join-Path $targetDir "package.json"))) {
    throw "Brak package.json w $targetDir — pobranie ZIP z GitHuba nie powiodło się."
}

Write-Host "Instalacja 'serve'..." -ForegroundColor Yellow
& $npmCmd install --omit=dev --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { throw "npm install --omit=dev nie powiodło się." }
& $npmCmd install serve --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { throw "npm install serve nie powiodło się." }

$serveEntry = Resolve-ServeEntry $targetDir
if (-not $serveEntry) { throw "Nie znaleziono pakietu 'serve' w node_modules." }

$srcDir = Join-Path $targetDir "src"
if (-not (Test-Path (Join-Path $srcDir "index.html"))) {
    throw "Brak src\index.html."
}

icacls $targetDir /grant "*S-1-1-0:(OI)(CI)F" /T | Out-Null

Write-Host "Rejestrowanie usługi $serviceName..." -ForegroundColor Yellow
& $nssmExe install $serviceName $nodeExe
& $nssmExe set $serviceName AppParameters "`"$serveEntry`" -s . -l $listenPort"
& $nssmExe set $serviceName AppDirectory $srcDir
& $nssmExe set $serviceName AppEnvironmentExtra "PATH=$(Split-Path $nodeExe -Parent)"
& $nssmExe set $serviceName Start SERVICE_AUTO_START
& $nssmExe set $serviceName AppStdout (Join-Path $targetDir "service_output.log")
& $nssmExe set $serviceName AppStderr (Join-Path $targetDir "service_error.log")
& $nssmExe set $serviceName AppRotateFiles 1

Write-Host "Uruchamianie usługi Windows..." -ForegroundColor Green
& $nssmExe start $serviceName
Start-Sleep -Seconds 4

$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host "`n==================================================" -ForegroundColor Green
    Write-Host " USŁUGA WYSTARTOWAŁA POPRAWNIE! " -ForegroundColor Green
    Write-Host " Aplikacja: http://localhost:$listenPort " -ForegroundColor Yellow
    Write-Host " Pytania:   baza z AnabelMaz/prawko (src\data) " -ForegroundColor Yellow
        Write-Host " Media:     CDN prawko-maz (Backblaze) " -ForegroundColor Yellow
        Write-Host " Excel+ZIP MI:   Install_Prawko.ps1 -InstallGov " -ForegroundColor DarkGray
        Write-Host " Katalog pytań MI: Install_Prawko.ps1 -GovQuestions " -ForegroundColor DarkGray
        Write-Host " Braki z MI:    Install_Prawko.ps1 -Merge " -ForegroundColor DarkGray
        Write-Host " Lokalny contrib: Install_Prawko.ps1 -Patch " -ForegroundColor DarkGray
        Write-Host " Git do zmian:    Install_Prawko.ps1 -Dev D:\prawko " -ForegroundColor DarkGray
    Write-Host "==================================================" -ForegroundColor Green
} else {
    Write-Host "`n[BŁĄD] Usługa nie wystartowała." -ForegroundColor Red
    $errLog = Join-Path $targetDir "service_error.log"
    if (Test-Path $errLog) { Get-Content $errLog -Tail 20 }
    Restore-InitialLocation
    exit 1
}

Complete-IfInteractive
