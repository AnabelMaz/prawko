# UTF-8 with BOM — Windows PowerShell 5.1 otherwise misreads non-ASCII text and here-strings.
param(
    [switch]$Help,
    [switch]$NonInteractive,
    [switch]$Uninstall,
    [switch]$SyncGov,
    [ValidateSet('Questions', 'Media', 'Full')]
    [string]$SyncScope = 'Full',
    [switch]$SyncUseCache,
    [switch]$MergeGov,
    [switch]$Patch,
    [switch]$DropMissingMedia,
    [switch]$SkipTranslateGaps,
    [string]$GeminiApiKey,
    [string]$Export,
    [string]$Import,
    [ValidateSet('Auto', 'Code', 'Runtime')]
    [string]$ImportScope = 'Auto',
    [switch]$ImportForce,
    [switch]$ExcludeData,
    [switch]$ExcludeMedia,
    [switch]$ExcludeLocalJson,
    [switch]$IncludeGovCache,
    [string]$Dev,
    [switch]$Https,
    [string]$HttpsCert = '',
    [string]$HttpsKey = '',
    [int]$HttpsPort = 5174
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
$httpsPort = $HttpsPort
$script:devWorkRoot = $null
if ($HttpsCert -or $HttpsKey) { $Https = $true }

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
                    Local contrib: -Patch. Ministry on disk: -SyncGov. Pack: -Export / -Import.
                    Start over: -Uninstall.

  -SyncGov          Ministry data from gov.pl → staging → server. Scope with -SyncScope:
                    Questions = Excel + JSON only (CDN for media).
                    Media = unpack cached ZIPs in TEMP → WebP/MP4 on the server.
                    Full = Excel + ZIP + convert + JSON + media (default scope).
                    -SyncUseCache skips gov.pl when gov-cache already has Excel and ZIPs.
                    Does not download PJM. Does not touch src\data in git/contrib.
                    With media on the server, sets mediaBase=media in local.json.
                    No administrator, no service reinstall.

  -DropMissingMedia Only with -SyncGov -SyncScope Full or Media: the parser strips
                    from JSON media whose file is missing in local raw. Default: NO.

  -SkipTranslateGaps With -SyncGov Questions/Full: do not fill missing EN/DE/UK
                    after parse-excel. Default: fill gaps (Gemini when a key
                    is available, else Google Translate).

  -GeminiApiKey     Optional. Google AI Studio key for this run (overrides
                    .geminienv). With -SyncGov Questions/Full and a key: Gemini
                    only (daily 429 tries the next Flash; all exhausted saves
                    and stops). Omit: .geminienv / GEMINI_API_KEY next to the
                    repo or the server, else Google Translate only.

  -MergeGov         On a running server: appends from ministry Excel only the gaps.
                    No server = install with no switches first.

  -Patch            Overlays code from the local checkout (-Dev, next to the script,
                    ..\prawko-contrib, ..\contrib). Skips data\ and media\.
                    Without contrib it overlays nothing — the server still has AnabelMaz
                    from install. On an already running server: overlay only,
                    no admin, no git checkout, no service reinstall.
                    On first install: AnabelMaz ZIP + service + overlay.

  -Export <path>    Portable pack (robocopy). Default includes a server snapshot:
                    snapshot\data, snapshot\media, snapshot\local.json, plus code-only
                    contrib (src\data and src\media omitted when they are in snapshot).
                    Opt out: -ExcludeData, -ExcludeMedia, -ExcludeLocalJson.
                    Optional ministry Excel+ZIPs: -IncludeGovCache (C:\ProgramData\prawko\gov-cache).
                    Also writes manifest.json. Does not touch the live server.

  -Import <path>    Restore from a pack. -ImportScope Auto (default), Code, or Runtime.
                    Runtime = snapshot only (server must exist). Code = overlay from
                    pack contrib. -ImportForce overwrites existing data/media.
                    Does not call gov.pl when the pack has a snapshot.

  -Dev <path>       Git clone only, for work (code, commit, push). Folder empty
                    or not yet existing. Not ProgramData. Does not install
                    Node, NSSM or the service — even if the server is not running yet.
                    Git is installed only here. To have localhost: first
                    run the installer with no switches, then -Dev.
                    Does not clone into C:\ProgramData\prawko. Media are not in git.

  -Https            HTTPS on port 5174 (HTTP 5173 stays). Any HTTP path/query
                    302-redirects to https://same-host:5174... Turn off in
                    src\local.json: "httpsRedirect": false (no service restart)
                    if HTTPS breaks. Generates a local CA + server cert unless
                    they already exist and are valid (CA with private key,
                    unexpired server cert covering current names/IPs, ACL,
                    NSSM). Re-run fills only gaps — no second Root CA. Or pass
                    -HttpsCert/-HttpsKey. Needs administrator. Combine with
                    -Patch on an already running HTTP server.

  -HttpsCert <pem>  Existing certificate (implies -Https). Pair with -HttpsKey.

  -HttpsKey <pem>   Existing private key.

  -HttpsPort <n>    HTTPS listen port (default 5174). HTTP stays on 5173.

  -Uninstall        Removes the PrawkoWORDService service and C:\ProgramData\prawko
                    except gov-cache (Excel + media ZIPs). FFmpeg in tools\ goes away.
                    Git/Node/NSSM stay on the system.

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
    -SyncGov         FFmpeg if missing (Full/Media); Excel from gov.pl
    -MergeGov        Excel from gov.pl, write to the running server
    -Export          nothing (file copy)
    -Import          nothing (file copy onto server)
    -Https           Node HTTPS + NSSM restart; optional generated CA
    -Uninstall       nothing new

WHAT THE APP NEEDS
  Server (no switches): Node.js + the 'serve' service. Git NO. Python NO.
  -Dev: Git only. FFmpeg with -SyncGov (JPG/WMV) and -MergeGov (frames); if missing,
  the script places a portable build in C:\ProgramData\prawko\tools (gone with -Uninstall).
  ZIPs are unpacked with Windows built-in tar. The app expects WebP/MP4, not JPG/WMV.
"@
    exit 0
}

function Read-LocalJsonObject ($root) {
    $path = Join-Path $root "src\local.json"
    $obj = [pscustomobject]@{}
    if (Test-Path -LiteralPath $path) {
        try {
            $parsed = ConvertFrom-Json ([IO.File]::ReadAllText($path))
            if ($parsed -is [System.Management.Automation.PSCustomObject]) { $obj = $parsed }
        } catch { $obj = [pscustomobject]@{} }
    }
    return @{ Path = $path; Object = $obj }
}

function Write-LocalJsonObject ($path, $obj) {
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText($path, (($obj | ConvertTo-Json -Compress) + "`n"), $utf8)
}

function Set-LocalJsonProperty ($root, [string]$Name, $Value) {
    $state = Read-LocalJsonObject $root
    $state.Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
    Write-LocalJsonObject $state.Path $state.Object
}

function Set-LocalMediaBase ($root) {
    Set-LocalJsonProperty $root 'mediaBase' 'media'
    Write-Host "-> src/local.json mediaBase=media (local files, not the CDN)." -ForegroundColor Green
}

function Get-PrawkoCertDir {
    return (Join-Path $targetDir "certs")
}

function Get-PrawkoServerArgs {
    $srcDir = Join-Path $targetDir "src"
    $serverJs = Join-Path $srcDir "server.js"
    $certDir = Get-PrawkoCertDir
    if (Test-Path -LiteralPath $serverJs) {
        return "`"$serverJs`" --http-port $listenPort --https-port $httpsPort --cert-dir `"$certDir`""
    }
    return $null
}

function Unlock-PrawkoCertDir ($certDir) {
    if (-not (Test-Path -LiteralPath $certDir)) { return }
    # Re-enable inheritance from ProgramData\prawko (Everyone F). A previous
    # /inheritance:r plus English "Administrators" on Polish Windows left
    # LocalSystem unable to read tls.pfx, so HTTPS never bound and HTTP did not redirect.
    icacls $certDir /inheritance:e | Out-Null
    icacls $certDir /grant "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null
}

function Ensure-PrawkoHttpsServerJs {
    $dst = Join-Path $targetDir "src\server.js"
    if (Test-Path -LiteralPath $dst) { return }
    $contrib = Find-LocalContribRoot
    if ($contrib) {
        $src = Join-Path $contrib "src\server.js"
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination $dst -Force
            Write-Host "-> Copied src\server.js from contrib." -ForegroundColor Cyan
            return
        }
    }
    throw "src\server.js is missing on the server. Run -Patch from contrib, or install from a ZIP that includes the HTTPS server, then -Https."
}

function Test-PrawkoHttpsFiles ($certDir) {
    $crt = Join-Path $certDir "tls.crt"
    $key = Join-Path $certDir "tls.key"
    $pfx = Join-Path $certDir "tls.pfx"
    return ((Test-Path -LiteralPath $crt) -and (Test-Path -LiteralPath $key)) -or (Test-Path -LiteralPath $pfx)
}

function Read-PrawkoCertThumbprint ($path) {
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($path)
    return $cert.Thumbprint
}

function Test-PrawkoCertNotExpiring ($cert) {
    if (-not $cert) { return $false }
    return $cert.NotAfter -gt (Get-Date).AddDays(7)
}

function Get-PrawkoCertSanNames ($cert) {
    $list = New-Object System.Collections.Generic.List[string]
    $cn = $cert.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($cn) { [void]$list.Add($cn) }
    $ext = $cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.17' }
    if ($ext) {
        foreach ($line in @($ext.Format($true) -split "`r?`n")) {
            if ($line -match '=\s*(.+)$') { [void]$list.Add($Matches[1].Trim()) }
        }
    }
    return @($list | Select-Object -Unique)
}

function Test-PrawkoSanCovers ($cert, $needed) {
    $have = @(Get-PrawkoCertSanNames $cert | ForEach-Object { $_.ToLowerInvariant() })
    foreach ($n in @($needed)) {
        if (-not $n) { continue }
        if ($have -notcontains $n.ToLowerInvariant()) { return $false }
    }
    return $true
}

function Test-PrawkoCertSignedBy ($leaf, $ca) {
    if (-not $leaf -or -not $ca) { return $false }
    $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
    $chain.ChainPolicy.RevocationMode = 'NoCheck'
    $chain.ChainPolicy.VerificationFlags = 'AllowUnknownCertificateAuthority'
    [void]$chain.ChainPolicy.ExtraStore.Add($ca)
    try { [void]$chain.Build($leaf) } catch { return $false }
    foreach ($el in $chain.ChainElements) {
        if ($el.Certificate.Thumbprint -eq $ca.Thumbprint) { return $true }
    }
    return $false
}

function Test-PrawkoCertDirAclOk ($certDir) {
    if (-not (Test-Path -LiteralPath $certDir)) { return $false }
    try {
        Get-ChildItem -LiteralPath $certDir -Force -ErrorAction Stop | Out-Null
        foreach ($name in @('tls.key', 'tls.pfx', 'tls.crt', 'ca.crt')) {
            $p = Join-Path $certDir $name
            if (-not (Test-Path -LiteralPath $p)) { continue }
            $fs = [IO.File]::Open($p, 'Open', 'Read', 'Read')
            $fs.Close()
        }
        $acl = Get-Acl -LiteralPath $certDir
        foreach ($ace in $acl.Access) {
            if ($ace.AccessControlType -ne 'Allow') { continue }
            $sid = ''
            try { $sid = $ace.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { }
            if ($sid -ne 'S-1-5-18' -and $sid -ne 'S-1-1-0') { continue }
            $rights = $ace.FileSystemRights.ToString()
            if ($rights -match 'FullControl|Modify|ReadAndExecute|Read') { return $true }
        }
        return $false
    } catch {
        return $false
    }
}

function Get-PrawkoLocalCaCert ($certDir) {
    $want = Read-PrawkoCertThumbprint (Join-Path $certDir "ca.crt")
    $found = @(Get-ChildItem Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
        Where-Object { ($_.FriendlyName -eq 'Prawko Local CA' -or $_.Subject -eq 'CN=Prawko Local CA') -and $_.HasPrivateKey -and (Test-PrawkoCertNotExpiring $_) })
    if ($want) {
        $match = $found | Where-Object { $_.Thumbprint -eq $want } | Select-Object -First 1
        if ($match) { return $match }
    }
    return $found | Sort-Object NotBefore -Descending | Select-Object -First 1
}

function Get-PrawkoHttpsServerCert ($certDir, $ca, $neededNames) {
    $want = Read-PrawkoCertThumbprint (Join-Path $certDir "tls.crt")
    $found = @(Get-ChildItem Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
        Where-Object { $_.FriendlyName -eq 'Prawko HTTPS' -and $_.HasPrivateKey -and (Test-PrawkoCertNotExpiring $_) })
    $ok = @($found | Where-Object {
        (Test-PrawkoSanCovers $_ $neededNames) -and (-not $ca -or (Test-PrawkoCertSignedBy $_ $ca))
    })
    if ($want) {
        $match = $ok | Where-Object { $_.Thumbprint -eq $want } | Select-Object -First 1
        if ($match) { return $match }
    }
    return $ok | Sort-Object NotBefore -Descending | Select-Object -First 1
}

function Test-PrawkoPemKeyMatches ($crt, $key) {
    $openssl = "C:\Program Files\Git\usr\bin\openssl.exe"
    if (-not (Test-Path -LiteralPath $openssl)) { return $true }
    $modCrt = & $openssl x509 -in $crt -noout -modulus 2>$null
    $modKey = & $openssl rsa -in $key -noout -modulus 2>$null
    if (-not $modCrt -or -not $modKey) { return $false }
    return (($modCrt | Out-String).Trim() -eq ($modKey | Out-String).Trim())
}

function Test-PrawkoPemServerOk ($certDir, $ca, $neededNames) {
    $crt = Join-Path $certDir "tls.crt"
    $key = Join-Path $certDir "tls.key"
    if (-not ((Test-Path -LiteralPath $crt) -and (Test-Path -LiteralPath $key))) { return $false }
    try {
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($crt)
        if (-not (Test-PrawkoCertNotExpiring $cert)) { return $false }
        if (-not (Test-PrawkoSanCovers $cert $neededNames)) { return $false }
        if ($ca -and -not (Test-PrawkoCertSignedBy $cert $ca)) { return $false }
        if (-not (Test-PrawkoPemKeyMatches $crt $key)) { return $false }
        return $true
    } catch {
        return $false
    }
}

function Ensure-PrawkoCaInRoot ($ca) {
    if (-not $ca) { return $false }
    $already = Get-ChildItem Cert:\LocalMachine\Root -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $ca.Thumbprint } |
        Select-Object -First 1
    if ($already) { return $false }
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store "Root", "LocalMachine"
    $store.Open("ReadWrite")
    $store.Add($ca)
    $store.Close()
    Write-Host "-> Trusted Prawko Local CA in LocalMachine\Root" -ForegroundColor Green
    return $true
}

function Remove-StalePrawkoHttpsStoreCerts {
    param($KeepCerts)
    $keep = @{}
    foreach ($c in @($KeepCerts)) {
        if ($c -and $c.Thumbprint) { $keep[$c.Thumbprint.ToUpperInvariant()] = $true }
    }
    if ($keep.Count -eq 0) { return }
    foreach ($storeName in @("Root", "My")) {
        $store = New-Object System.Security.Cryptography.X509Certificates.X509Store $storeName, "LocalMachine"
        $store.Open("ReadWrite")
        $stale = @($store.Certificates | Where-Object {
            ($_.FriendlyName -eq 'Prawko Local CA' -or $_.FriendlyName -eq 'Prawko HTTPS' -or $_.Subject -eq 'CN=Prawko Local CA') -and
            -not $keep.ContainsKey($_.Thumbprint.ToUpperInvariant())
        })
        foreach ($cert in $stale) {
            $store.Remove($cert)
            Write-Host "-> Removed leftover $($cert.FriendlyName) $($cert.Thumbprint) from LocalMachine\$storeName" -ForegroundColor Yellow
        }
        $store.Close()
    }
}

function Export-PrawkoTlsFiles ($certDir, $ca, $server) {
    $pfxPath = Join-Path $certDir "tls.pfx"
    $crtPath = Join-Path $certDir "tls.crt"
    $keyPath = Join-Path $certDir "tls.key"
    $chars = [char[]]((48..57) + (65..90) + (97..122))
    $pwPlain = -join (1..24 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
    $secure = New-Object System.Security.SecureString
    foreach ($c in $pwPlain.ToCharArray()) { $secure.AppendChar($c) }
    foreach ($old in @($pfxPath, $crtPath, $keyPath, (Join-Path $certDir "tls.pass"))) {
        if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force }
    }
    Export-PfxCertificate -Cert $server -FilePath $pfxPath -Password $secure | Out-Null
    [IO.File]::WriteAllText((Join-Path $certDir "tls.pass"), $pwPlain, (New-Object System.Text.UTF8Encoding $false))
    $openssl = "C:\Program Files\Git\usr\bin\openssl.exe"
    if (Test-Path -LiteralPath $openssl) {
        & $openssl pkcs12 -in $pfxPath -out $crtPath -nokeys -clcerts -passin "pass:$pwPlain" 2>$null
        & $openssl pkcs12 -in $pfxPath -out $keyPath -nocerts -nodes -passin "pass:$pwPlain" 2>$null
    }
    if ($ca) {
        $caPem = "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($ca.RawData, 'InsertLineBreaks') + "`n-----END CERTIFICATE-----`n"
        [IO.File]::WriteAllText((Join-Path $certDir "ca.crt"), $caPem, (New-Object System.Text.UTF8Encoding $false))
    }
}

function Get-PrawkoHttpsHostNames {
    $names = New-Object System.Collections.Generic.List[string]
    foreach ($n in @('localhost', '127.0.0.1')) { [void]$names.Add($n) }
    if ($env:COMPUTERNAME) { [void]$names.Add($env:COMPUTERNAME) }
    try {
        $hn = [System.Net.Dns]::GetHostName()
        if ($hn) { [void]$names.Add($hn) }
    } catch { }
    try {
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -and $_.IPAddress -notlike '169.254.*' } |
            ForEach-Object { [void]$names.Add($_.IPAddress) }
    } catch {
        try {
            [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
                Where-Object { $_.AddressFamily -eq 'InterNetwork' } |
                ForEach-Object { [void]$names.Add($_.ToString()) }
        } catch { }
    }
    return @($names | Select-Object -Unique)
}

function Sync-PrawkoGeneratedHttpsCerts ($certDir) {
    New-Item -ItemType Directory -Force -Path $certDir | Out-Null
    $filesChanged = $false
    $names = Get-PrawkoHttpsHostNames
    $ca = Get-PrawkoLocalCaCert $certDir
    if ($ca) {
        Write-Host "-> CA ok (private key, not expiring): $($ca.Thumbprint)" -ForegroundColor Green
    } else {
        Write-Host "-> Generating Prawko Local CA" -ForegroundColor Yellow
        $ca = New-SelfSignedCertificate -Subject "CN=Prawko Local CA" `
            -KeyUsage CertSign, CRLSign, DigitalSignature `
            -KeyExportPolicy Exportable `
            -NotAfter (Get-Date).AddYears(10) `
            -CertStoreLocation Cert:\LocalMachine\My `
            -HashAlgorithm SHA256 `
            -FriendlyName "Prawko Local CA" `
            -TextExtension @("2.5.29.19={critical}{text}ca=1&pathlength=0")
        $filesChanged = $true
    }
    $caFile = Join-Path $certDir "ca.crt"
    $caFileThumb = Read-PrawkoCertThumbprint $caFile
    if ($ca -and $caFileThumb -ne $ca.Thumbprint) {
        $caPem = "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($ca.RawData, 'InsertLineBreaks') + "`n-----END CERTIFICATE-----`n"
        [IO.File]::WriteAllText($caFile, $caPem, (New-Object System.Text.UTF8Encoding $false))
        $filesChanged = $true
    }
    [void](Ensure-PrawkoCaInRoot $ca)

    $server = Get-PrawkoHttpsServerCert $certDir $ca $names
    $pemOk = Test-PrawkoPemServerOk $certDir $ca $names
    if ($pemOk) {
        $thumb = Read-PrawkoCertThumbprint (Join-Path $certDir "tls.crt")
        Write-Host "-> Server cert ok (key, SAN, not expiring): $thumb" -ForegroundColor Green
    } elseif ($server) {
        Write-Host "-> Exporting existing server cert to $certDir" -ForegroundColor Yellow
        Export-PrawkoTlsFiles $certDir $ca $server
        $filesChanged = $true
    } else {
        Write-Host "-> Generating server cert (SAN: $($names -join ', '))" -ForegroundColor Yellow
        $server = New-SelfSignedCertificate -DnsName $names `
            -Signer $ca `
            -KeyExportPolicy Exportable `
            -NotAfter (Get-Date).AddYears(3) `
            -CertStoreLocation Cert:\LocalMachine\My `
            -HashAlgorithm SHA256 `
            -FriendlyName "Prawko HTTPS"
        Export-PrawkoTlsFiles $certDir $ca $server
        $filesChanged = $true
    }
    $fileLeaf = $null
    $crtPath = Join-Path $certDir "tls.crt"
    if (Test-Path -LiteralPath $crtPath) {
        $fileLeaf = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($crtPath)
    }
    Remove-StalePrawkoHttpsStoreCerts -KeepCerts @($ca, $server, $fileLeaf)
    return $filesChanged
}

function Copy-PrawkoByoHttpsCerts ($certDir, $certFile, $keyFile) {
    if (-not $certFile -or -not $keyFile) {
        throw "-HttpsCert and -HttpsKey must be passed together."
    }
    if (-not (Test-Path -LiteralPath $certFile)) { throw "Certificate not found: $certFile" }
    if (-not (Test-Path -LiteralPath $keyFile)) { throw "Private key not found: $keyFile" }
    New-Item -ItemType Directory -Force -Path $certDir | Out-Null
    $dstCrt = Join-Path $certDir "tls.crt"
    $dstKey = Join-Path $certDir "tls.key"
    $same = $false
    if ((Test-Path -LiteralPath $dstCrt) -and (Test-Path -LiteralPath $dstKey)) {
        $same = ((Get-FileHash -LiteralPath $certFile -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $dstCrt -Algorithm SHA256).Hash) -and
            ((Get-FileHash -LiteralPath $keyFile -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $dstKey -Algorithm SHA256).Hash)
    }
    if ($same) {
        Write-Host "-> Supplied certificate already in certs\ (unchanged)" -ForegroundColor Green
        return $false
    }
    if (-not (Test-PrawkoCertDirAclOk $certDir)) { Unlock-PrawkoCertDir $certDir }
    Copy-Item -LiteralPath $certFile -Destination $dstCrt -Force
    Copy-Item -LiteralPath $keyFile -Destination $dstKey -Force
    foreach ($stale in @("tls.pfx", "tls.pass")) {
        $p = Join-Path $certDir $stale
        if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }
    }
    Write-Host "-> Installed supplied certificate as certs\tls.crt + tls.key" -ForegroundColor Green
    return $true
}

function Get-PrawkoNssmPath {
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

function Get-PrawkoNssmPlainValue ($nssmLocal, $key) {
    $raw = & $nssmLocal get $serviceName $key 2>$null
    if ($null -eq $raw) { return '' }
    return ((($raw | Out-String) -replace "`0", '').Trim())
}

function Set-PrawkoHttpsService {
    param([switch]$RestartIfFilesChanged)
    Ensure-PrawkoHttpsServerJs
    $args = Get-PrawkoServerArgs
    if (-not $args) { throw "Could not build HTTPS server arguments (src\server.js missing)." }
    $nssmLocal = Get-PrawkoNssmPath
    if (-not $nssmLocal) { throw "NSSM not found. HTTPS needs the Prawko Windows service." }
    $srcDir = Join-Path $targetDir "src"
    $curParams = (Get-PrawkoNssmPlainValue $nssmLocal AppParameters) -replace '"', ''
    $wantParams = $args -replace '"', ''
    $curDir = Get-PrawkoNssmPlainValue $nssmLocal AppDirectory
    $needSet = ($curParams -ne $wantParams) -or ($curDir.TrimEnd('\') -ne $srcDir.TrimEnd('\'))
    if ($needSet) {
        & $nssmLocal set $serviceName AppParameters $args
        & $nssmLocal set $serviceName AppDirectory $srcDir
    } else {
        Write-Host "-> NSSM already on server.js HTTPS" -ForegroundColor Green
    }
    if (-not $needSet -and -not $RestartIfFilesChanged) {
        Write-Host "-> Service left running (nothing to reconfigure)" -ForegroundColor Green
        return
    }
    cmd.exe /c "`"$nssmLocal`" restart $serviceName >nul 2>&1"
    if ($LASTEXITCODE -ne 0) {
        cmd.exe /c "`"$nssmLocal`" stop $serviceName >nul 2>&1"
        Start-Sleep -Seconds 1
        & $nssmLocal start $serviceName
    }
}

function Invoke-ConfigurePrawkoHttps {
    if ($HttpsCert -xor $HttpsKey) {
        throw "-HttpsCert and -HttpsKey must be passed together."
    }
    $certDir = Get-PrawkoCertDir
    New-Item -ItemType Directory -Force -Path $certDir | Out-Null
    $filesChanged = $false
    if (-not (Test-PrawkoCertDirAclOk $certDir)) {
        Write-Host "-> Fixing certs\ ACL so LocalSystem can read keys" -ForegroundColor Yellow
        Unlock-PrawkoCertDir $certDir
        $filesChanged = $true
    } else {
        Write-Host "-> certs\ ACL ok" -ForegroundColor Green
    }
    if ($HttpsCert) {
        if (Copy-PrawkoByoHttpsCerts $certDir $HttpsCert $HttpsKey) { $filesChanged = $true }
    } else {
        if (Sync-PrawkoGeneratedHttpsCerts $certDir) { $filesChanged = $true }
    }
    $json = Read-LocalJsonObject $targetDir
    if ($json.Object.httpsRedirect -eq $true) {
        Write-Host "-> local.json httpsRedirect already true" -ForegroundColor Green
    } else {
        Set-LocalJsonProperty $targetDir 'httpsRedirect' $true
        Write-Host "-> src/local.json httpsRedirect=true (set false on disk if HTTPS breaks; no restart)." -ForegroundColor Green
    }
    Set-PrawkoHttpsService -RestartIfFilesChanged:$filesChanged
    Write-Host " Application: https://localhost:$httpsPort  (HTTP $listenPort redirects here)" -ForegroundColor Yellow
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
    $logParts = New-Object System.Collections.Generic.List[string]
    for ($li = 0; $li -lt $ArgumentList.Count; $li++) {
        $logParts.Add($ArgumentList[$li])
        if ($ArgumentList[$li] -match '^-GeminiApiKey$' -and ($li + 1) -lt $ArgumentList.Count -and $ArgumentList[$li + 1] -notmatch '^-') {
            $logParts.Add('***')
            $li++
        }
    }
    Write-Host "-> $Name $($logParts -join ' ')" -ForegroundColor Cyan
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
    Write-Host "-> On the server: $qTotal question assignments. Originals in contrib\src\data are left as-is." -ForegroundColor Green
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

function ConvertTo-RobocopyDestFile {
    param(
        [Parameter(Mandatory = $true)][string]$ListedPath,
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    $listed = $ListedPath.Trim().Trim('"')
    $destRoot = [IO.Path]::GetFullPath($Destination).TrimEnd('\', '/')
    $srcRoot = [IO.Path]::GetFullPath($Source).TrimEnd('\', '/')
    $sep = [string][IO.Path]::DirectorySeparatorChar
    if (-not [IO.Path]::IsPathRooted($listed)) {
        return (Join-Path $destRoot $listed)
    }
    try {
        $full = [IO.Path]::GetFullPath($listed)
    } catch {
        return (Join-Path $destRoot $listed)
    }
    $fullTrim = $full.TrimEnd('\', '/')
    if ($fullTrim.Equals($srcRoot, [StringComparison]::OrdinalIgnoreCase) -or
        $fullTrim.StartsWith($srcRoot + $sep, [StringComparison]::OrdinalIgnoreCase)) {
        $tail = $fullTrim.Substring($srcRoot.Length).TrimStart('\', '/')
        if ($tail) { return (Join-Path $destRoot $tail) }
        return $destRoot
    }
    if ($fullTrim.Equals($destRoot, [StringComparison]::OrdinalIgnoreCase) -or
        $fullTrim.StartsWith($destRoot + $sep, [StringComparison]::OrdinalIgnoreCase)) {
        return $full
    }
    return (Join-Path $destRoot ([IO.Path]::GetFileName($full)))
}

function Get-RobocopyCopyPlan {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [string]$ProgressActivity = ""
    )
    $listArgs = @()
    foreach ($token in $ArgumentList) {
        if ($token -and ($token -notmatch '^(?i)/(nfl|ndl|njs|nc|ns|np|njh|l|bytes)$')) {
            $listArgs += $token
        }
    }
    $listArgs += @("/L", "/BYTES", "/NJH", "/NDL", "/NP")
    if ($ProgressActivity) {
        $planJob = Start-Job -ScriptBlock {
            param($Source, $Destination, $ArgumentList)
            & robocopy.exe $Source $Destination @ArgumentList 2>&1 | ForEach-Object { "$_" }
        } -ArgumentList $Source, $Destination, $listArgs
        try {
            while ($true) {
                $finished = Wait-Job -Job $planJob -Timeout 1
                Write-Progress -Activity $ProgressActivity -Status "planning copy..." -PercentComplete 0
                if ($finished) { break }
            }
            $output = @(Receive-Job -Job $planJob | ForEach-Object { "$_" })
        } finally {
            Remove-Job -Job $planJob -Force -ErrorAction SilentlyContinue
        }
    } else {
        $output = & robocopy.exe $Source $Destination @listArgs 2>&1 | ForEach-Object { "$_" }
    }
    $items = New-Object 'System.Collections.Generic.List[object]'
    $totalFiles = [int64]0
    $copyFiles = [int64]0
    $totalBytes = [int64]0
    $copyBytes = [int64]0
    foreach ($line in $output) {
        if ($line -match '(?i)^\s*(Files|Pliki)\s*:\s+(\d+)\s+(\d+)\s+(\d+)') {
            $totalFiles = [int64]$Matches[2]
            $copyFiles = [int64]$Matches[3]
            continue
        }
        if ($line -match '(?i)^\s*(Bytes|Bajty)\s*:\s+(\d+)\s+(\d+)\s+(\d+)') {
            $totalBytes = [int64]$Matches[2]
            $copyBytes = [int64]$Matches[3]
            continue
        }
        if ($line -match '(?i)\b(New File|Newer|Nowy plik|Nowszy)\b\s+(\d+)\s+(.+)$') {
            $listed = ([string]$Matches[3]).Trim()
            if (-not $listed) { continue }
            $size = [int64]$Matches[2]
            $destFile = ConvertTo-RobocopyDestFile -ListedPath $listed -Source $Source -Destination $Destination
            $info = New-Object IO.FileInfo $destFile
            $existed = $info.Exists
            [void]$items.Add(@{
                DestPath = $destFile
                Bytes = $size
                Existed = $existed
                OrigLength = $(if ($existed) { $info.Length } else { [int64]0 })
                OrigWriteTimeUtc = $(if ($existed) { $info.LastWriteTimeUtc } else { [datetime]::MinValue })
            })
        }
    }
    if ($items.Count -gt 0) {
        $copyFiles = [int64]$items.Count
        $copyBytes = [int64]0
        foreach ($item in $items) { $copyBytes += $item.Bytes }
    }
    if ($totalFiles -le 0) { $totalFiles = $copyFiles }
    if ($totalBytes -le 0) { $totalBytes = $copyBytes }
    return @{
        Items = $items
        TotalFiles = $totalFiles
        CopyFiles = $copyFiles
        TotalBytes = $totalBytes
        CopyBytes = $copyBytes
        Ok = ($totalBytes -gt 0 -or $copyBytes -gt 0 -or $items.Count -gt 0)
    }
}

function Measure-RobocopyCopyProgress {
    param(
        [Parameter(Mandatory = $true)]$Items
    )
    $bytes = [int64]0
    $files = [int64]0
    foreach ($item in $Items) {
        $info = New-Object IO.FileInfo $item.DestPath
        if (-not $info.Exists) { continue }
        if ($item.Existed) {
            $mtimeDelta = [Math]::Abs(($info.LastWriteTimeUtc - $item.OrigWriteTimeUtc).TotalSeconds)
            $lenChanged = ($info.Length -ne $item.OrigLength)
            if ($lenChanged -and ($item.Bytes -le 0 -or $info.Length -lt $item.Bytes)) {
                $bytes += $info.Length
            } elseif ($mtimeDelta -ge 2 -or $lenChanged) {
                $files++
                $bytes += $item.Bytes
            }
        } else {
            $have = $info.Length
            if ($item.Bytes -gt 0 -and $have -gt $item.Bytes) { $have = $item.Bytes }
            $bytes += $have
            if ($item.Bytes -le 0 -or $info.Length -ge $item.Bytes) {
                $files++
            }
        }
    }
    return @{ Bytes = $bytes; Files = $files }
}

function Invoke-SafeRobocopy {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [string]$Activity = "Copy",
        [int64]$ProgressTotalBytes = 0,
        [string[]]$ProgressExcludeDirNames = @(),
        [switch]$Quiet
    )
    if ($Quiet) {
        & robocopy.exe $Source $Destination @ArgumentList | Out-Null
        if ($LASTEXITCODE -ge 8) {
            throw "robocopy failed (code $LASTEXITCODE): $Source -> $Destination"
        }
        return
    }

    $activity = $Activity
    if ($ProgressTotalBytes -le 0) {
        $srcStats = Get-CopyTreeStats -Root $Source -ExcludeDirNames $ProgressExcludeDirNames
        $ProgressTotalBytes = $srcStats.Bytes
    }

    $plan = Get-RobocopyCopyPlan -Source $Source -Destination $Destination -ArgumentList $ArgumentList -ProgressActivity $activity
    if (-not $plan.Ok) {
        $plan.TotalBytes = $ProgressTotalBytes
        $plan.CopyBytes = $ProgressTotalBytes
    }
    if ($plan.TotalBytes -le 0) { $plan.TotalBytes = $plan.CopyBytes }
    $alreadyBytes = [Math]::Max([int64]0, $plan.TotalBytes - $plan.CopyBytes)
    $alreadyFiles = [Math]::Max([int64]0, $plan.TotalFiles - $plan.CopyFiles)
    $maxDoneBytes = $alreadyBytes
    $maxDoneFiles = $alreadyFiles

    $startDest = Get-CopyTreeStats -Root $Destination -ExcludeDirNames $ProgressExcludeDirNames
    $job = Start-Job -ScriptBlock {
        param($Source, $Destination, $ArgumentList)
        & robocopy.exe $Source $Destination @ArgumentList | Out-Null
        return $LASTEXITCODE
    } -ArgumentList $Source, $Destination, $ArgumentList
    try {
        while ($true) {
            $finished = Wait-Job -Job $job -Timeout 1
            if ($finished) { break }
            $copied = @{ Bytes = [int64]0; Files = [int64]0 }
            if ($plan.Items.Count -gt 0) {
                $copied = Measure-RobocopyCopyProgress -Items $plan.Items
            } else {
                $nowDest = Get-CopyTreeStats -Root $Destination -ExcludeDirNames $ProgressExcludeDirNames
                $copied.Bytes = [Math]::Max([int64]0, $nowDest.Bytes - $startDest.Bytes)
                $copied.Files = [Math]::Max([int64]0, $nowDest.Files - $startDest.Files)
            }
            $doneBytes = $alreadyBytes + $copied.Bytes
            if ($doneBytes -gt $plan.TotalBytes) { $doneBytes = $plan.TotalBytes }
            $doneFiles = $alreadyFiles + $copied.Files
            if ($doneFiles -gt $plan.TotalFiles -and $plan.TotalFiles -gt 0) { $doneFiles = $plan.TotalFiles }
            if ($doneBytes -lt $maxDoneBytes) { $doneBytes = $maxDoneBytes }
            if ($doneFiles -lt $maxDoneFiles) { $doneFiles = $maxDoneFiles }
            $maxDoneBytes = $doneBytes
            $maxDoneFiles = $doneFiles
            $status = "{0} / {1}   {2} / {3} files" -f (Format-CopySize $doneBytes), (Format-CopySize $plan.TotalBytes), $doneFiles, $plan.TotalFiles
            $pct = 0
            if ($plan.TotalBytes -gt 0) {
                $pct = [int][Math]::Min(99, [Math]::Floor(100.0 * $doneBytes / $plan.TotalBytes))
            }
            Write-Progress -Activity $activity -Status $status -PercentComplete $pct
        }
        $raw = Receive-Job -Job $job
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
        if ($plan.TotalBytes -gt 0) {
            $finalFiles = $plan.TotalFiles
            if ($finalFiles -le 0) { $finalFiles = $alreadyFiles + $plan.CopyFiles }
            Write-Progress -Activity $activity -Status ("{0} / {1}   {2} / {3} files" -f (Format-CopySize $plan.TotalBytes), (Format-CopySize $plan.TotalBytes), $finalFiles, $finalFiles) -PercentComplete 100
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
    Invoke-SafeRobocopy -Quiet -Source $srcApp -Destination $dstApp -ArgumentList @("/E", "/XD", "data", "media", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np")
    $trDstDir = Join-Path $dstApp "data"
    if (Test-Path -LiteralPath $trDstDir) {
        $trEnSrc = Join-Path $srcApp "data\translations_en.json"
        if (Test-Path -LiteralPath $trEnSrc) {
            Copy-Item -LiteralPath $trEnSrc -Destination (Join-Path $trDstDir "translations_en.json") -Force
        }
        $trUkSrc = Join-Path $srcApp "data\translations_uk.json"
        $trUkDst = Join-Path $trDstDir "translations_uk.json"
        $trUaDst = Join-Path $trDstDir "translations_ua.json"
        if (Test-Path -LiteralPath $trUkSrc) {
            Copy-Item -LiteralPath $trUkSrc -Destination $trUkDst -Force
        } elseif ((Test-Path -LiteralPath $trUaDst) -and -not (Test-Path -LiteralPath $trUkDst)) {
            Move-Item -LiteralPath $trUaDst -Destination $trUkDst -Force
        }
        if (Test-Path -LiteralPath $trUaDst) {
            Remove-Item -LiteralPath $trUaDst -Force
        }
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

function Test-DirHasFiles ([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    return [bool]@((Get-ChildItem -LiteralPath $Path -File -ErrorAction SilentlyContinue | Select-Object -First 1)).Count
}

function Resolve-ExportSnapshotDataSource {
    $serverData = Join-Path $targetDir "src\data"
    if ((Test-Path -LiteralPath $serverData) -and (Test-Path -LiteralPath (Join-Path $serverData "meta.json"))) {
        return $serverData
    }
    try {
        $contribData = Join-Path (Get-ContribRoot) "src\data"
        if ((Test-Path -LiteralPath $contribData) -and (Test-Path -LiteralPath (Join-Path $contribData "meta.json"))) {
            return $contribData
        }
    } catch { }
    return $null
}

function Resolve-ExportSnapshotMediaRoot {
    $serverMedia = Join-Path $targetDir "src\media"
    if (Test-LocalMediaFiles $targetDir) { return $serverMedia }
    try {
        $contribRoot = Get-ContribRoot
        if (Test-LocalMediaFiles $contribRoot) { return (Join-Path $contribRoot "src\media") }
    } catch { }
    $localMedia = Join-Path $env:LOCALAPPDATA "prawko\media"
    if ((Test-Path -LiteralPath (Join-Path $localMedia "img")) -or (Test-Path -LiteralPath (Join-Path $localMedia "vid"))) {
        return $localMedia
    }
    return $null
}

function Resolve-ExportLocalJsonSource {
    $serverJson = Join-Path $targetDir "src\local.json"
    if (Test-Path -LiteralPath $serverJson) { return $serverJson }
    try {
        $contribJson = Join-Path (Get-ContribRoot) "src\local.json"
        if (Test-Path -LiteralPath $contribJson) { return $contribJson }
    } catch { }
    return $null
}

function Get-GovCacheExportSources {
    $dirs = New-Object System.Collections.Generic.List[string]
    $local = Join-Path $targetDir "gov-cache"
    if (Test-DirHasFiles $local) { [void]$dirs.Add($local) }
    return $dirs.ToArray()
}

function Write-PrawkoExportManifest {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [hashtable]$Components,
        [hashtable]$Sources,
        [hashtable]$Locations = @{}
    )
    $payload = [ordered]@{
        format     = 1
        created    = (Get-Date).ToString("o")
        platform   = "windows"
        components = $Components
        sources    = $Sources
    }
    if ($Locations -and $Locations.Count -gt 0) {
        $payload.locations = $Locations
    }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $payload -Depth 4), $utf8)
}

function Read-PrawkoExportManifest ([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Export-PrawkoPack {
    param(
        [Parameter(Mandatory = $true)][string]$Destination,
        [switch]$SkipData,
        [switch]$SkipMedia,
        [switch]$SkipLocalJson,
        [switch]$WithGovCache
    )
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
    $destSnapshot = Join-Path $destRoot "snapshot"
    $destGovCache = Join-Path $destRoot "gov-cache"
    $scriptDst = Join-Path $destInstall "Install_Prawko.windows.ps1"
    $manifestPath = Join-Path $destRoot "manifest.json"
    $components = @{
        code      = $true
        data      = $false
        media     = $false
        localJson = $false
        govCache  = $false
    }
    $sources = @{}
    $locations = @{}
    $skipContribData = $false
    $skipContribMedia = $false

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
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText($scriptDst, $stub.Replace("`n", "`r`n"), $utf8NoBom)
    Write-Host "-> Launcher: $scriptDst" -ForegroundColor Green

    if (-not $SkipData) {
        $dataSrc = Resolve-ExportSnapshotDataSource
        if ($dataSrc) {
            $dataDst = Join-Path $destSnapshot "data"
            New-Item -ItemType Directory -Path $dataDst -Force | Out-Null
            Write-Host "-> Snapshot data: $dataSrc -> $dataDst" -ForegroundColor Cyan
            Invoke-SafeRobocopy -Activity "Snapshot data" -Source $dataSrc -Destination $dataDst -ArgumentList @(
                "/E", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"
            )
            $components.data = $true
            $sources.data = $dataSrc
            $locations.data = "snapshot"
            $skipContribData = $true
        } else {
            Write-Host "-> Snapshot data: nothing to export (server/contrib have no parsed meta.json)." -ForegroundColor DarkYellow
        }
    }

    if (-not $SkipMedia) {
        $mediaSrc = Resolve-ExportSnapshotMediaRoot
        if ($mediaSrc) {
            $mediaDst = Join-Path $destSnapshot "media"
            New-Item -ItemType Directory -Path $mediaDst -Force | Out-Null
            Write-Host "-> Snapshot media: $mediaSrc -> $mediaDst" -ForegroundColor Cyan
            foreach ($sub in @("img", "vid")) {
                $from = Join-Path $mediaSrc $sub
                if (-not (Test-Path -LiteralPath $from)) { continue }
                $to = Join-Path $mediaDst $sub
                New-Item -ItemType Directory -Path $to -Force | Out-Null
                Invoke-SafeRobocopy -Activity "Snapshot media ($sub)" -Source $from -Destination $to -ArgumentList @(
                    "/E", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"
                )
            }
            $components.media = $true
            $sources.media = $mediaSrc
            $locations.media = "snapshot"
            $skipContribMedia = $true
        } else {
            Write-Host "-> Snapshot media: nothing to export." -ForegroundColor DarkYellow
        }
    }

    if (-not $SkipLocalJson) {
        $jsonSrc = Resolve-ExportLocalJsonSource
        if ($jsonSrc) {
            New-Item -ItemType Directory -Path $destSnapshot -Force | Out-Null
            $jsonDst = Join-Path $destSnapshot "local.json"
            Copy-Item -LiteralPath $jsonSrc -Destination $jsonDst -Force
            Write-Host "-> Snapshot local.json: $jsonSrc -> $jsonDst" -ForegroundColor Cyan
            $components.localJson = $true
            $sources.localJson = $jsonSrc
            $locations.localJson = "snapshot"
        } elseif ($components.media) {
            New-Item -ItemType Directory -Path $destSnapshot -Force | Out-Null
            $defaultLocal = Join-Path $destSnapshot "local.json"
            [IO.File]::WriteAllText($defaultLocal, "{`n  `"mediaBase`": `"media`"`n}`n", $utf8NoBom)
            Write-Host "-> Snapshot local.json: generated mediaBase=media -> $defaultLocal" -ForegroundColor Cyan
            $components.localJson = $true
            $sources.localJson = "(generated)"
            $locations.localJson = "snapshot"
        }
    }

    if ($WithGovCache) {
        $govSources = Get-GovCacheExportSources
        if ($govSources.Count -gt 0) {
            New-Item -ItemType Directory -Path $destGovCache -Force | Out-Null
            foreach ($gs in $govSources) {
                Write-Host "-> Gov cache: $gs -> $destGovCache" -ForegroundColor Cyan
                Invoke-SafeRobocopy -Activity "Gov cache" -Source $gs -Destination $destGovCache -ArgumentList @(
                    "/E", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"
                )
            }
            $components.govCache = $true
            $sources.govCache = ($govSources -join "; ")
        } else {
            Write-Host "-> Gov cache: nothing to export." -ForegroundColor DarkYellow
        }
    }

    $contribFull = [IO.Path]::GetFullPath($contribSrc)
    $destContribFull = [IO.Path]::GetFullPath($destContrib)
    if (Test-SamePath $contribFull $destContribFull) {
        Write-Host "-> Contrib is already at $destContrib (skipping copy)." -ForegroundColor Gray
    } else {
        New-Item -ItemType Directory -Path $destContrib -Force | Out-Null
        $xdNames = @("node_modules", ".git", "test-results", "playwright-report", "blob-report", "coverage", ".cursor", "gov-data")
        $robocopyXd = @("node_modules", ".git", "test-results", "playwright-report", "blob-report", "coverage", ".cursor", "gov-data")
        if ($skipContribData) {
            $xdNames += "data"
            $robocopyXd += "data"
        }
        if ($skipContribMedia) {
            $xdNames += "media"
            $robocopyXd += "media"
        }
        Write-Host "-> Contrib: $contribSrc -> $destContrib" -ForegroundColor Cyan
        if ($skipContribData -or $skipContribMedia) {
            $omit = @()
            if ($skipContribData) { $omit += "src\data" }
            if ($skipContribMedia) { $omit += "src\media" }
            Write-Host ("   Runtime in snapshot — omitting contrib: {0}" -f ($omit -join ", ")) -ForegroundColor Gray
        }
        $srcStats = Get-CopyTreeStats -Root $contribSrc -ExcludeDirNames $xdNames
        Invoke-SafeRobocopy -Activity "Export contrib" -ProgressTotalBytes $srcStats.Bytes -ProgressExcludeDirNames $xdNames -Source $contribSrc -Destination $destContrib -ArgumentList @(
            @("/E", "/XD") + $robocopyXd + @("/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np")
        )
        $idx = Join-Path $destContrib "src\index.html"
        if (-not (Test-Path -LiteralPath $idx)) {
            throw "After export, missing $idx"
        }
        Write-Host "-> Contrib: $destContrib" -ForegroundColor Green
    }
    $locations.code = "contrib"

    Write-PrawkoExportManifest -Path $manifestPath -Components $components -Sources $sources -Locations $locations
    Write-Host "-> Manifest: $manifestPath" -ForegroundColor Green

    Write-Host "Done. From the pack:" -ForegroundColor Green
    Write-Host "  powershell -ExecutionPolicy Bypass -File `"$scriptDst`""
    Write-Host "  ... -Import `"$destRoot`"   /   -Patch   /   -SyncGov"
}

function Import-PrawkoPack {
    param(
        [Parameter(Mandatory = $true)][string]$PackRoot,
        [ValidateSet('Auto', 'Code', 'Runtime')]
        [string]$Scope = 'Auto',
        [switch]$Force
    )
    if ([string]::IsNullOrWhiteSpace($PackRoot)) {
        throw "-Import requires a path to an export pack."
    }
    if (-not [IO.Path]::IsPathRooted($PackRoot)) {
        $PackRoot = Join-Path (Get-Location).Path $PackRoot
    }
    $PackRoot = [IO.Path]::GetFullPath($PackRoot)
    if (-not (Test-Path -LiteralPath $PackRoot)) {
        throw "-Import: pack not found: $PackRoot"
    }

    $manifest = Read-PrawkoExportManifest (Join-Path $PackRoot "manifest.json")
    $packContrib = Join-Path $PackRoot "prawko-contrib"
    $snapshot = Join-Path $PackRoot "snapshot"
    $govCache = Join-Path $PackRoot "gov-cache"
    $doCode = $Scope -eq 'Code'
    $doRuntime = $Scope -eq 'Runtime'
    if ($Scope -eq 'Auto') {
        $doCode = $true
        $doRuntime = $true
    }

    Write-Host "Import <- $PackRoot" -ForegroundColor Cyan

    if ($doCode) {
        if (-not (Test-Path -LiteralPath (Join-Path $packContrib "src\index.html"))) {
            throw "-Import: missing $packContrib\src\index.html"
        }
        if (-not (Test-PrawkoServerInstalled)) {
            throw "-Import -ImportScope Code (or Auto) needs a running server. First: Install_Prawko.windows.ps1 with no switches, then -Import."
        }
        Write-Host "-> Overlay code from pack contrib" -ForegroundColor Cyan
        Publish-AppSrcOverlay -SourceSrc (Join-Path $packContrib "src") -DestRoot $targetDir -CachePrefix "prawko-import"
    }

    if ($doRuntime) {
        if (-not (Test-PrawkoServerInstalled)) {
            throw "-Import needs a running server. First: Install_Prawko.windows.ps1 with no switches, then -Import."
        }
        $dataSrc = Join-Path $snapshot "data"
        $mediaSrc = Join-Path $snapshot "media"
        $localSrc = Join-Path $snapshot "local.json"
        $hasData = (Test-Path -LiteralPath (Join-Path $dataSrc "meta.json"))
        $hasMedia = (Test-Path -LiteralPath (Join-Path $mediaSrc "img")) -or (Test-Path -LiteralPath (Join-Path $mediaSrc "vid"))
        if ($hasMedia) {
            $hasMedia = (Test-DirHasFiles (Join-Path $mediaSrc "img")) -or (Test-DirHasFiles (Join-Path $mediaSrc "vid"))
        }
        if (-not $hasData -and -not $hasMedia -and -not (Test-Path -LiteralPath $localSrc)) {
            if ($manifest -and $manifest.components) {
                $mc = $manifest.components
                if (-not $mc.data -and -not $mc.media -and -not $mc.localJson) {
                    Write-Host "-> Snapshot: pack has no runtime data (code-only export)." -ForegroundColor Gray
                } else {
                    throw "-Import: manifest lists runtime components but snapshot\ is missing or empty."
                }
            } else {
                Write-Host "-> Snapshot: no manifest and no snapshot\ — skipping runtime restore." -ForegroundColor DarkYellow
            }
        } else {
            if ($hasData) {
                $dstData = Join-Path $targetDir "src\data"
                if ((Test-DirHasFiles $dstData) -and -not $Force) {
                    Write-Host "-> Server data exists; use -ImportForce to overwrite." -ForegroundColor DarkYellow
                } else {
                    New-Item -ItemType Directory -Path $dstData -Force | Out-Null
                    Write-Host "-> Restore data: $dataSrc -> $dstData" -ForegroundColor Cyan
                    Invoke-SafeRobocopy -Activity "Import data" -Source $dataSrc -Destination $dstData -ArgumentList @(
                        "/E", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"
                    )
                }
            }
            if ($hasMedia) {
                $dstMedia = Join-Path $targetDir "src\media"
                if ((Test-LocalMediaFiles $targetDir) -and -not $Force) {
                    Write-Host "-> Server media exists; use -ImportForce to overwrite." -ForegroundColor DarkYellow
                } else {
                    foreach ($sub in @("img", "vid")) {
                        $from = Join-Path $mediaSrc $sub
                        if (-not (Test-Path -LiteralPath $from)) { continue }
                        $to = Join-Path $dstMedia $sub
                        New-Item -ItemType Directory -Path $to -Force | Out-Null
                        Write-Host "-> Restore media/$sub" -ForegroundColor Cyan
                        Invoke-SafeRobocopy -Activity "Import media ($sub)" -Source $from -Destination $to -ArgumentList @(
                            "/E", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"
                        )
                    }
                }
            }
            if (Test-Path -LiteralPath $localSrc) {
                Copy-Item -LiteralPath $localSrc -Destination (Join-Path $targetDir "src\local.json") -Force
                Write-Host "-> Restore local.json" -ForegroundColor Cyan
            } elseif ($hasMedia) {
                Set-LocalMediaBase -root $targetDir
            }
            Set-ServerCacheVersion -Root $targetDir -Prefix "prawko-import"
        }
    }

    if (Test-Path -LiteralPath $govCache) {
        $govDst = Join-Path $targetDir "gov-cache"
        $from = $govCache
        if (Test-Path -LiteralPath (Join-Path $govCache "baza_pytan.xlsx")) {
            $from = $govCache
        } elseif (Test-Path -LiteralPath (Join-Path $govCache "gov-cache\baza_pytan.xlsx")) {
            $from = Join-Path $govCache "gov-cache"
        } elseif (Test-Path -LiteralPath (Join-Path $govCache "gov-data\baza_pytan.xlsx")) {
            $from = Join-Path $govCache "gov-data"
        }
        Write-Host "-> Restore gov-cache -> $govDst" -ForegroundColor Cyan
        New-Item -ItemType Directory -Path $govDst -Force | Out-Null
        Invoke-SafeRobocopy -Activity "Import gov-cache" -Source $from -Destination $govDst -ArgumentList @(
            "/E", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"
        )
    }

    Write-Host "Done. Refresh the app in the browser (Update available banner)." -ForegroundColor Green
}

if ($PSBoundParameters.ContainsKey("Export")) {
    Export-PrawkoPack -Destination $Export -SkipData:$ExcludeData -SkipMedia:$ExcludeMedia -SkipLocalJson:$ExcludeLocalJson -WithGovCache:$IncludeGovCache
    exit 0
}

if ($PSBoundParameters.ContainsKey("Import")) {
    Import-PrawkoPack -PackRoot $Import -Scope $ImportScope -Force:$ImportForce
    Complete-IfInteractive
    exit 0
}

if ($Patch -and -not $Https -and -not $MergeGov -and -not $Uninstall -and -not $PSBoundParameters.ContainsKey("Dev") -and (Test-PrawkoServerInstalled)) {
    Remove-LegacyServerRawMediaDir
    Apply-PrawkoAppFixes -root $targetDir
    Write-Host "Done. In the open app, banner: Update available / Refresh." -ForegroundColor Green
    exit 0
}

if (-not $Https -and -not $Uninstall -and -not $MergeGov -and -not $SyncGov -and -not $Patch -and -not $PSBoundParameters.ContainsKey("Dev") -and -not $PSBoundParameters.ContainsKey("Import") -and (Test-PrawkoServerInstalled)) {
    Remove-LegacyServerRawMediaDir
    Write-Host "Server already running in $targetDir — not overwriting files (no git checkout / pull)." -ForegroundColor Yellow
    Write-Host "  Code from local contrib: Install_Prawko.windows.ps1 -Patch" -ForegroundColor Gray
    Write-Host "  Ministry data:         Install_Prawko.windows.ps1 -SyncGov   or   -SyncGov -SyncScope Questions" -ForegroundColor Gray
    Write-Host "  Git for changes:       Install_Prawko.windows.ps1 -Dev D:\prawko" -ForegroundColor Gray
    Write-Host "  Pack to USB:           Install_Prawko.windows.ps1 -Export D:\backup" -ForegroundColor Gray
    Write-Host "  Restore from pack:     Install_Prawko.windows.ps1 -Import D:\backup" -ForegroundColor Gray
    Write-Host "  Install from scratch:  Install_Prawko.windows.ps1 -Uninstall   then no switches" -ForegroundColor Gray
    exit 0
}

function Test-IsAdmin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Admin only: first server install, -Uninstall, or -Https (NSSM + optional Root CA).
# -Dev / -Patch / -MergeGov / -SyncGov / -Export / -Import: no elevation.
$httpsOnInstalled = $Https -and -not $Uninstall -and (Test-PrawkoServerInstalled)
$installingServer = -not $Uninstall -and -not $MergeGov -and -not $SyncGov -and -not $PSBoundParameters.ContainsKey("Dev") -and -not $PSBoundParameters.ContainsKey("Export") -and -not $PSBoundParameters.ContainsKey("Import") -and -not (Test-PrawkoServerInstalled)
if (($Uninstall -or $installingServer -or $httpsOnInstalled) -and -not (Test-IsAdmin)) {
    Write-Host "Administrator rights required. Retrying with elevation..." -ForegroundColor Yellow
    $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
    if ($NonInteractive) { $argList += "-NonInteractive" }
    if ($Uninstall) { $argList += "-Uninstall" }
    if ($SyncGov) { $argList += "-SyncGov"; if ($SyncScope -ne 'Full') { $argList += "-SyncScope"; $argList += $SyncScope } }
    if ($SyncUseCache) { $argList += "-SyncUseCache" }
    if ($DropMissingMedia) { $argList += "-DropMissingMedia" }
    if ($SkipTranslateGaps) { $argList += "-SkipTranslateGaps" }
    if ($MergeGov) { $argList += "-MergeGov" }
    if ($Patch) { $argList += "-Patch" }
    if ($PSBoundParameters.ContainsKey("Export") -and $Export) { $argList += "-Export"; $argList += "`"$Export`"" }
    if ($PSBoundParameters.ContainsKey("Import") -and $Import) { $argList += "-Import"; $argList += "`"$Import`"" }
    if ($ExcludeData) { $argList += "-ExcludeData" }
    if ($ExcludeMedia) { $argList += "-ExcludeMedia" }
    if ($ExcludeLocalJson) { $argList += "-ExcludeLocalJson" }
    if ($IncludeGovCache) { $argList += "-IncludeGovCache" }
    if ($ImportForce) { $argList += "-ImportForce" }
    if ($PSBoundParameters.ContainsKey("ImportScope") -and $ImportScope -ne 'Auto') { $argList += "-ImportScope"; $argList += $ImportScope }
    if ($PSBoundParameters.ContainsKey("Dev") -and $Dev) { $argList += "-Dev"; $argList += "`"$Dev`"" }
    if ($Https) { $argList += "-Https" }
    if ($HttpsCert) { $argList += "-HttpsCert"; $argList += "`"$HttpsCert`"" }
    if ($HttpsKey) { $argList += "-HttpsKey"; $argList += "`"$HttpsKey`"" }
    if ($PSBoundParameters.ContainsKey("HttpsPort") -and $HttpsPort -ne 5174) { $argList += "-HttpsPort"; $argList += "$HttpsPort" }
    if ($Help) { $argList += "-Help" }
    Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -ArgumentList $argList
    exit $LASTEXITCODE
}

if ($Https -and -not $Uninstall -and (Test-PrawkoServerInstalled)) {
    Remove-LegacyServerRawMediaDir
    if ($Patch) {
        Apply-PrawkoAppFixes -root $targetDir
    }
    Invoke-ConfigurePrawkoHttps
    Write-Host "Done. Open https://localhost:$httpsPort — HTTP $listenPort redirects unless local.json httpsRedirect is false." -ForegroundColor Green
    Complete-IfInteractive
    exit 0
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
        Invoke-SafeRobocopy -Activity "Install app ZIP" -Source $inner.FullName -Destination $Destination -ArgumentList @(
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
    if (-not (Test-PrawkoServerInstalled)) {
        throw "Install the server first (installer with no switches), then -SyncGov -SyncScope Questions."
    }
    $govDir = Get-GovDataDir
    $excelPath = Join-Path $govDir "baza_pytan.xlsx"
    $serverData = Join-Path $targetDir "src\data"

    Write-Host "SyncGov Questions: Excel from gov.pl → $govDir; JSON → $serverData (contrib\src\data left untouched)" -ForegroundColor Cyan
    Write-Host "No media ZIP, no src\media, no CDN change." -ForegroundColor Gray
    Invoke-PrawkoScript "download-gov.ps1" @("-ExcelOnly")
    $qParse = @("-Excel", $excelPath, "-OutDir", $serverData)
    if ($SkipTranslateGaps) { $qParse += "-SkipTranslateGaps" }
    if (([string]$GeminiApiKey).Trim()) { $qParse += @("-GeminiApiKey", $GeminiApiKey) }
    Invoke-PrawkoScript "parse-excel.ps1" $qParse
    Assert-GovDataParsed -govDir $serverData -excelPath $excelPath
    Set-ServerCacheVersion -Root $targetDir -Prefix "prawko-govq"
    Remove-LegacyServerRawMediaDir
    Write-Host "Done. Server reads JSON from the ministry. -Patch will not undo this (it skips data\)." -ForegroundColor Green
    Write-Host "Originals remain in contrib\src\data. Videos from CDN." -ForegroundColor Gray
}

function Publish-GovInstall {
    param([switch]$SkipGovDownload)

    Import-PrawkoGovLibrary
    if (-not (Test-PrawkoServerInstalled)) {
        throw "Install the server first (installer with no switches), then -SyncGov."
    }
    $govDir = Get-GovDataDir
    $excelPath = Join-Path $govDir "baza_pytan.xlsx"
    $serverData = Join-Path $targetDir "src\data"
    $imgOut = Join-Path $targetDir "src\media\img"
    $vidOut = Join-Path $targetDir "src\media\vid"

    Write-Host "SyncGov Full: Excel+ZIP → $govDir; unpack TEMP; WebP/MP4+JSON → $targetDir\src" -ForegroundColor Cyan
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

    if (-not $SkipGovDownload) {
        Invoke-PrawkoScript "download-gov.ps1"
    } else {
        Write-Host "Skipping gov.pl download (-SyncUseCache / cached staging)." -ForegroundColor Gray
    }
    if (-not (Test-Path -LiteralPath $excelPath)) {
        throw "Missing $excelPath — the question bank from gov.pl was not downloaded."
    }

    if (-not (Test-GovCacheHasZips)) {
        throw "No ministry media ZIPs in $(Get-GovZipCacheDir). Run -SyncGov -SyncScope Full, or -Import a pack with -IncludeGovCache."
    }

    $rawForConvert = $null
    if ($DropMissingMedia) {
        $rawForConvert = Expand-GovMediaZipsToTemp
    }

    Write-Host "`n=== Converting situational media (JPG→WebP, WMV→MP4) ===" -ForegroundColor Cyan
    $convertArgs = @("-FfmpegExe", $ffmpegExe, "-ImgOut", $imgOut, "-VidOut", $vidOut)
    if ($rawForConvert) { $convertArgs += @("-SourceDir", $rawForConvert) }
    Invoke-PrawkoScript "convert-media.ps1" $convertArgs

    Write-Host "`n=== JSON from Excel → server src\data ===" -ForegroundColor Cyan
    $parseArgs = @("-Excel", $excelPath, "-OutDir", $serverData)
    if ($DropMissingMedia) {
        $parseArgs += @("-MediaDir", $rawForConvert, "-DropMissingMedia")
        Write-Host "DropMissingMedia: questions without a file in the temp unpack lose their media reference." -ForegroundColor DarkYellow
    }
    if ($SkipTranslateGaps) { $parseArgs += "-SkipTranslateGaps" }
    if (([string]$GeminiApiKey).Trim()) { $parseArgs += @("-GeminiApiKey", $GeminiApiKey) }
    Invoke-PrawkoScript "parse-excel.ps1" $parseArgs
    Assert-GovDataParsed -govDir $serverData -excelPath $excelPath
    if ($rawForConvert) { Remove-GovRawTempDir }

    Remove-LegacyServerRawMediaDir
    Set-ServerCacheVersion -Root $targetDir -Prefix "prawko-govmedia"
    Set-LocalMediaBase -root $targetDir
    Write-Host "Done. Server: JSON + media from gov.pl. -Patch will not overwrite data\ or media\." -ForegroundColor Green
    Write-Host "Excel and ZIPs stay in $govDir after -Uninstall." -ForegroundColor Gray
}

function Publish-SyncGovMedia {
    Import-PrawkoGovLibrary
    if (-not (Test-PrawkoServerInstalled)) {
        throw "Install the server first (installer with no switches), then -SyncGov -SyncScope Media."
    }
    if (-not (Test-GovCacheHasZips)) {
        throw "No ministry media ZIPs in $(Get-GovZipCacheDir). Run -SyncGov -SyncScope Full first, or -Import a pack with -IncludeGovCache."
    }
    $imgOut = Join-Path $targetDir "src\media\img"
    $vidOut = Join-Path $targetDir "src\media\vid"

    Write-Host "SyncGov Media: unpack cached ZIPs in TEMP → WebP/MP4 on the server (no Excel download)." -ForegroundColor Cyan
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

    Write-Host "`n=== Converting situational media (JPG→WebP, WMV→MP4) ===" -ForegroundColor Cyan
    Invoke-PrawkoScript "convert-media.ps1" @(
        "-FfmpegExe", $ffmpegExe,
        "-ImgOut", $imgOut,
        "-VidOut", $vidOut
    )

    Remove-LegacyServerRawMediaDir
    Set-LocalMediaBase -root $targetDir
    Write-Host "Done. Server uses local media (mediaBase=media)." -ForegroundColor Green
}

function Invoke-PublishSyncGov {
    switch ($SyncScope) {
        'Questions' { Publish-GovQuestions }
        'Media' { Publish-SyncGovMedia }
        'Full' {
            if ($SyncUseCache) {
                Import-PrawkoGovLibrary
                $govDir = Get-GovDataDir
                $excelPath = Join-Path $govDir "baza_pytan.xlsx"
                if ((Test-Path -LiteralPath $excelPath) -and (Test-GovCacheHasZips)) {
                    Write-Host "SyncUseCache: gov-cache has Excel and ZIPs — skipping gov.pl download." -ForegroundColor Gray
                    Publish-GovInstall -SkipGovDownload
                    return
                }
            }
            Publish-GovInstall
        }
        default { throw "Unknown -SyncScope: $SyncScope (use Questions, Media, or Full)." }
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
        Write-Host "Removing $targetDir (keeping gov-cache) ..." -ForegroundColor Yellow
        Get-ChildItem -LiteralPath $targetDir -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ne "gov-cache" } |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
        $left = @(Get-ChildItem -LiteralPath $targetDir -Force -ErrorAction SilentlyContinue)
        if ($left.Count -eq 0) {
            Remove-Item -LiteralPath $targetDir -Force -ErrorAction SilentlyContinue
        }
    }
    if ((Test-Path $targetDir) -and -not (Test-Path (Join-Path $targetDir "gov-cache"))) {
        & cmd.exe /c "rmdir /s /q `"$targetDir`""
    }
    if ((Test-Path $targetDir) -and -not (Test-Path (Join-Path $targetDir "gov-cache")) -and -not (Test-Path (Join-Path $targetDir "src\index.html"))) {
        throw "Could not remove $targetDir. Close Cursor/the browser if that folder is open and try again."
    }

    Write-Host "Removed service $serviceName and the application directory." -ForegroundColor Green
    Write-Host "gov-cache (Excel + ZIPs) is kept under $targetDir\gov-cache if it existed." -ForegroundColor Gray
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

if ($SyncGov -or $MergeGov) {
    $prawkoGovLib = Resolve-PrawkoPipelineScript "download-gov.ps1"
    if (-not $prawkoGovLib) {
        throw "Missing scripts\download-gov.ps1. Run Install_Prawko.windows.ps1 with no switches (it will download the app with scripts into $targetDir) or run the installer from the root of a cloned repo."
    }
    . $prawkoGovLib -LibraryOnly
    if (-not (Get-Command Get-GovDataDir -ErrorAction SilentlyContinue)) {
        throw "Did not load Get-GovDataDir from $prawkoGovLib."
    }
}

if ($SyncGov) {
    Invoke-PublishSyncGov
    Complete-IfInteractive
    exit 0
}

if ($MergeGov) {
    if (-not (Test-PrawkoServerInstalled)) {
        throw "-MergeGov needs a running server. First Install_Prawko.windows.ps1 with no switches."
    }
    Write-Host "=== MergeGov: gaps from ministry Excel (no service reinstall) ===" -ForegroundColor Cyan
    Remove-LegacyServerRawMediaDir
    Import-PrawkoGovLibrary
    Invoke-PrawkoScript "download-gov.ps1" @("-ExcelOnly")
    $govDir = Get-GovDataDir
    $excelPath = Join-Path $govDir "baza_pytan.xlsx"
    if (-not (Test-Path -LiteralPath $excelPath)) {
        throw "Missing $excelPath — no downloaded ministry question bank to merge."
    }
    $parseOut = Join-Path ([IO.Path]::GetTempPath()) "prawko\gov-json"
    Invoke-PrawkoScript "parse-excel.ps1" @("-Excel", $excelPath, "-OutDir", $parseOut, "-SkipTranslateGaps")
    $mergeArgs = @(
        "-GovDir", $parseOut,
        "-OutDir", (Join-Path $targetDir "src\data")
    )
    $ffmpegMerge = Resolve-FfmpegExe
    if ($ffmpegMerge) { $mergeArgs += @("-FfmpegExe", $ffmpegMerge) }
    $mergeMedia = New-Object System.Collections.Generic.List[string]
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
    if (Test-Path -LiteralPath $parseOut) {
        Remove-Item -LiteralPath $parseOut -Recurse -Force -ErrorAction SilentlyContinue
    }
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
Write-Host "-> Ministry full (Excel+media): Install_Prawko.windows.ps1 -SyncGov" -ForegroundColor Gray
Write-Host "-> Ministry questions only:      Install_Prawko.windows.ps1 -SyncGov -SyncScope Questions" -ForegroundColor Gray
Write-Host "-> Gaps from ministry:           Install_Prawko.windows.ps1 -MergeGov" -ForegroundColor Gray
Write-Host "-> Pack / restore:               -Export D:\pack   /   -Import D:\pack" -ForegroundColor Gray
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

if ($Https) {
    if ($HttpsCert -xor $HttpsKey) {
        throw "-HttpsCert and -HttpsKey must be passed together."
    }
    $certDir = Get-PrawkoCertDir
    New-Item -ItemType Directory -Force -Path $certDir | Out-Null
    if (-not (Test-PrawkoCertDirAclOk $certDir)) { Unlock-PrawkoCertDir $certDir }
    if ($HttpsCert) {
        Copy-PrawkoByoHttpsCerts $certDir $HttpsCert $HttpsKey | Out-Null
    } else {
        Sync-PrawkoGeneratedHttpsCerts $certDir | Out-Null
    }
    $json = Read-LocalJsonObject $targetDir
    if ($json.Object.httpsRedirect -ne $true) {
        Set-LocalJsonProperty $targetDir 'httpsRedirect' $true
        Write-Host "-> src/local.json httpsRedirect=true (set false on disk if HTTPS breaks; no restart)." -ForegroundColor Green
    }
    Ensure-PrawkoHttpsServerJs
}

Write-Host "Registering service $serviceName..." -ForegroundColor Yellow
$appParameters = Get-PrawkoServerArgs
if (-not $appParameters) {
    $appParameters = "`"$serveEntry`" -s . -l $listenPort"
}
& $nssmExe install $serviceName $nodeExe
& $nssmExe set $serviceName AppParameters $appParameters
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
    if ($Https) {
        Write-Host " Application: https://localhost:$httpsPort " -ForegroundColor Yellow
        Write-Host " HTTP $listenPort redirects to HTTPS (local.json httpsRedirect; set false if HTTPS breaks)." -ForegroundColor Yellow
    } else {
        Write-Host " Application: http://localhost:$listenPort " -ForegroundColor Yellow
    }
    Write-Host " Questions:   bank from AnabelMaz/prawko (src\data) " -ForegroundColor Yellow
        Write-Host " Media:     prawko-maz CDN (Backblaze) " -ForegroundColor Yellow
        Write-Host " Ministry sync:         Install_Prawko.windows.ps1 -SyncGov " -ForegroundColor DarkGray
        Write-Host " Ministry questions:    Install_Prawko.windows.ps1 -SyncGov -SyncScope Questions " -ForegroundColor DarkGray
        Write-Host " Gaps from ministry:    Install_Prawko.windows.ps1 -MergeGov " -ForegroundColor DarkGray
        Write-Host " Pack / restore:        -Export / -Import " -ForegroundColor DarkGray
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
