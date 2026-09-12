# UTF-8 with BOM — Windows PowerShell 5.1 otherwise misreads non-ASCII text and here-strings.
# Build media zip packs + manifest from category JSON (Windows, no Python).
# Same job as scripts/build-media-packs.py.
#
# Input is JSON after parse-excel (WebP/MP4 names), not the Excel. Excel still
# needs parse-excel.ps1 — packs only group files the app already references.
#
# Pipeline (two public hosts — treat buckets as empty):
#   1. Install_Prawko.windows.ps1 -SyncGov   → Excel, convert-media, JSON
#   2. scripts/upload-media.ps1         → B2 prawko-maz img/ + vid/ (online play)
#   3. scripts/build-media-packs.ps1    → zip + manifest (this script)
#   4. Cloudflare R2 dashboard          → prawko-packs (public PACKS_BASE)
#   5. optional scripts/upload-packs.ps1 → archive copy of zips on B2 (not the app host)
#
# powershell -ExecutionPolicy Bypass -File scripts/build-media-packs.ps1
# powershell -ExecutionPolicy Bypass -File scripts/build-media-packs.ps1 -MaxZipMiB 250
# powershell -ExecutionPolicy Bypass -File scripts/build-media-packs.ps1 -NoZip
# powershell -ExecutionPolicy Bypass -File scripts/build-media-packs.ps1 -SelfTest
#
# Zip cap: $DefaultMaxZipMiB below, or -MaxZipMiB on the command line.
# R2 dashboard 300 MB is 300e6 bytes (~286 MiB). Wrangler allows 300 MiB.

param(
    [string]$DataDir,
    [string]$MediaDir,
    [string]$OutDir,
    [int]$MaxZipMiB,
    [double]$Margin = 12,
    [double]$Jaccard = 0.45,
    [int]$PartFiles = 180,
    [int]$Tiny = 8,
    [switch]$NoZip,
    [switch]$SelfTest
)

# Change this to raise/lower zip size. -MaxZipMiB on the command line overrides.
$DefaultMaxZipMiB = 280
if (-not $PSBoundParameters.ContainsKey("MaxZipMiB")) {
    $MaxZipMiB = $DefaultMaxZipMiB
}

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Web.Extensions
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$script:SkipJson = @("meta.json", "translations_en.json", "translations_de.json", "translations_uk.json", "translations_pl.json")
$script:RepoRoot = Split-Path -Parent $PSScriptRoot

function Get-DefaultMediaDir {
    $server = "C:\ProgramData\prawko\src\media"
    if ((Test-Path (Join-Path $server "img")) -or (Test-Path (Join-Path $server "vid"))) { return $server }
    $local = Join-Path $env:LOCALAPPDATA "prawko\media"
    if ((Test-Path (Join-Path $local "img")) -or (Test-Path (Join-Path $local "vid"))) { return $local }
    return $null
}

function Get-DefaultOutDir {
    return (Join-Path $env:LOCALAPPDATA "prawko\packs")
}

function Get-CatSortKey([string]$c) {
    return ("{0:D2}-{1}" -f $c.Length, $c)
}

function ConvertTo-SortedCats([string[]]$cats) {
    return @($cats | Sort-Object { Get-CatSortKey $_ })
}

function ConvertTo-SupportKey([string[]]$cats) {
    return ((ConvertTo-SortedCats $cats) -join "|")
}

function ConvertFrom-SupportKey([string]$key) {
    if ([string]::IsNullOrEmpty($key)) { return @() }
    return @($key.Split("|") | Where-Object { $_ })
}

function Get-SupportId([string]$key, [string[]]$allCats) {
    $cats = @(ConvertFrom-SupportKey $key)
    if ($cats.Count -eq 0) { return "set-empty" }
    $allKey = ConvertTo-SupportKey $allCats
    if ($key -eq $allKey) { return "set-all" }
    if ($cats.Count -eq 1) { return "cat-$($cats[0])" }
    $slug = $cats -join "-"
    if ($slug.Length -le 48) { return "set-$slug" }
    $sha = [System.Security.Cryptography.SHA1]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes(($cats -join ","))
        $hex = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").Substring(0, 10).ToLowerInvariant()
    } finally { $sha.Dispose() }
    return "set-$($cats.Count)-$hex"
}

function Get-FileKind([string]$name, $declared) {
    if ($declared -eq "video" -or $declared -eq "image") { return [string]$declared }
    $ext = [IO.Path]::GetExtension($name)
    if ($ext -match '\.(mp4|webm|wmv)$') { return "video" }
    return "image"
}

function Test-MapKey($map, [string]$key) {
    if ($null -eq $map) { return $false }
    if ($map -is [System.Collections.IDictionary]) {
        try { return [bool]$map.Contains($key) } catch { }
        try { return [bool]$map.ContainsKey($key) } catch { }
    }
    return $false
}

function Get-MapValue($map, [string]$key) {
    if (-not (Test-MapKey $map $key)) { return $null }
    return $map[$key]
}

function Walk-MediaNode($node, [scriptblock]$emit) {
    if ($null -eq $node) { return }
    if ($node -is [System.Collections.IDictionary]) {
        if (Test-MapKey $node "media") {
            $mediaVal = $node["media"]
            if ($mediaVal -is [string] -and $mediaVal.Trim()) {
                $mt = Get-MapValue $node "mediaType"
                & $emit $mediaVal.Trim() $mt
            }
        }
        foreach ($k in @($node.Keys)) { Walk-MediaNode $node[$k] $emit }
        return
    }
    if ($node -is [string]) { return }
    if ($node -is [System.Collections.IEnumerable]) {
        foreach ($x in $node) { Walk-MediaNode $x $emit }
    }
}

function Read-JsonObject([string]$path) {
    $raw = [IO.File]::ReadAllText($path)
    $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $ser.MaxJsonLength = [int]::MaxValue
    $ser.RecursionLimit = 100
    return $ser.DeserializeObject($raw)
}

function Get-CategoryIds([string]$dataDir) {
    $metaPath = Join-Path $dataDir "meta.json"
    if (Test-Path -LiteralPath $metaPath) {
        $meta = Read-JsonObject $metaPath
        if (Test-MapKey $meta "categories") {
            $ids = @()
            foreach ($c in $meta["categories"]) {
                if ($c -is [System.Collections.IDictionary] -and (Test-MapKey $c "id") -and $c["id"]) {
                    $ids += [string]$c["id"]
                }
            }
            if ($ids.Count -gt 0) { return $ids }
        }
    }
    $ids = @()
    Get-ChildItem -LiteralPath $dataDir -Filter "*.json" | Sort-Object Name | ForEach-Object {
        if ($script:SkipJson -notcontains $_.Name) { $ids += $_.BaseName }
    }
    if ($ids.Count -eq 0) { throw "No category JSON in $dataDir" }
    return $ids
}

function Get-WhereMap([string]$dataDir, [string[]]$categories) {
    $where = @{}
    $kinds = @{}
    foreach ($cat in $categories) {
        $path = Join-Path $dataDir "$cat.json"
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $obj = Read-JsonObject $path
        Walk-MediaNode $obj {
            param($name, $mtype)
            if (-not $where.ContainsKey($name)) { $where[$name] = New-Object System.Collections.Generic.HashSet[string] }
            [void]$where[$name].Add($cat)
            $kinds[$name] = Get-FileKind $name $mtype
        }
    }
    return @{ Where = $where; Kinds = $kinds }
}

function Get-Jaccard([string]$a, [string]$b) {
    $sa = New-Object System.Collections.Generic.HashSet[string] (,[string[]](ConvertFrom-SupportKey $a))
    $sb = New-Object System.Collections.Generic.HashSet[string] (,[string[]](ConvertFrom-SupportKey $b))
    $inter = New-Object System.Collections.Generic.HashSet[string] $sa
    $inter.IntersectWith($sb)
    $uni = New-Object System.Collections.Generic.HashSet[string] $sa
    $uni.UnionWith($sb)
    if ($uni.Count -eq 0) { return 0.0 }
    return [double]$inter.Count / $uni.Count
}

function New-Block([string[]]$files, [string]$support, $kinds) {
    return @{
        Files    = @($files | Sort-Object)
        Support  = $support
        Kinds    = $kinds
        N        = @($files).Count
    }
}

function Get-NeededN($block, [string]$cat, $where) {
    $n = 0
    foreach ($f in $block.Files) {
        if ($where[$f].Contains($cat)) { $n++ }
    }
    return $n
}

function Get-MaxWastePct($blocks, [string[]]$categories, $where) {
    $max = 0.0
    foreach ($cat in $categories) {
        $need = 0
        foreach ($pair in $where.GetEnumerator()) {
            if ($pair.Value.Contains($cat)) { $need++ }
        }
        if ($need -eq 0) { continue }
        $got = 0
        foreach ($b in $blocks) {
            if ((Get-NeededN $b $cat $where) -gt 0) { $got += $b.N }
        }
        $pct = 100.0 * ($got - $need) / $need
        if ($pct -gt $max) { $max = $pct }
    }
    return $max
}

function Merge-BlockPair($blocks, [int]$i, [int]$j) {
    $a = $blocks[$i]; $b = $blocks[$j]
    $sa = New-Object System.Collections.Generic.HashSet[string] (,[string[]](ConvertFrom-SupportKey $a.Support))
    $sb = New-Object System.Collections.Generic.HashSet[string] (,[string[]](ConvertFrom-SupportKey $b.Support))
    $sa.UnionWith($sb)
    $merged = New-Block (@($a.Files) + @($b.Files)) (ConvertTo-SupportKey @($sa)) $a.Kinds
    $out = New-Object System.Collections.Generic.List[object]
    for ($k = 0; $k -lt $blocks.Count; $k++) {
        if ($k -ne $i -and $k -ne $j) { [void]$out.Add($blocks[$k]) }
    }
    [void]$out.Add($merged)
    return $out
}

function Invoke-GreedyMerge2($blockList, [string[]]$categories, $where, [double]$margin, [double]$jaccardMin) {
    $blocks = New-Object System.Collections.Generic.List[object]
    foreach ($b in $blockList) { [void]$blocks.Add($b) }
    for ($round = 0; $round -lt 400; $round++) {
        $bestI = -1; $bestJ = -1; $bestJac = -1.0; $bestWaste = 999.0; $bestId = ""
        for ($i = 0; $i -lt $blocks.Count; $i++) {
            for ($j = $i + 1; $j -lt $blocks.Count; $j++) {
                $jac = Get-Jaccard $blocks[$i].Support $blocks[$j].Support
                if ($jac -lt $jaccardMin) { continue }
                $trial = Merge-BlockPair $blocks $i $j
                $waste = Get-MaxWastePct $trial $categories $where
                if ($waste -gt $margin) { continue }
                $idPair = (Get-SupportId $blocks[$i].Support $categories) + "|" + (Get-SupportId $blocks[$j].Support $categories)
                $better = $false
                if ($bestI -lt 0) { $better = $true }
                elseif ($jac -gt $bestJac) { $better = $true }
                elseif ($jac -eq $bestJac -and $waste -lt $bestWaste) { $better = $true }
                elseif ($jac -eq $bestJac -and $waste -eq $bestWaste -and $idPair -lt $bestId) { $better = $true }
                if ($better) {
                    $bestI = $i; $bestJ = $j; $bestJac = $jac; $bestWaste = $waste; $bestId = $idPair
                }
            }
        }
        if ($bestI -lt 0) { break }
        $blocks = Merge-BlockPair $blocks $bestI $bestJ
    }
    return $blocks
}

function Invoke-AbsorbTiny($blockList, [string[]]$categories, $where, [double]$margin, [int]$tinyN) {
    $blocks = New-Object System.Collections.Generic.List[object]
    foreach ($b in $blockList) { [void]$blocks.Add($b) }
    $changed = $true
    while ($changed) {
        $changed = $false
        $tiny = @()
        for ($i = 0; $i -lt $blocks.Count; $i++) {
            if ($blocks[$i].N -le $tinyN) { $tiny += $i }
        }
        $tiny = $tiny | Sort-Object { $blocks[$_].N }, { Get-SupportId $blocks[$_].Support $categories }
        foreach ($i in $tiny) {
            $bestJ = -1
            $bestJac = -1.0
            $bestId = ""
            for ($j = 0; $j -lt $blocks.Count; $j++) {
                if ($j -eq $i) { continue }
                $jac = Get-Jaccard $blocks[$i].Support $blocks[$j].Support
                $trial = Merge-BlockPair $blocks $i $j
                if ((Get-MaxWastePct $trial $categories $where) -gt $margin) { continue }
                $oid = Get-SupportId $blocks[$j].Support $categories
                if ($jac -gt $bestJac -or ($jac -eq $bestJac -and $oid -lt $bestId)) {
                    $bestJac = $jac; $bestJ = $j; $bestId = $oid
                }
            }
            if ($bestJ -ge 0) {
                $blocks = Merge-BlockPair $blocks $i $bestJ
                $changed = $true
                break
            }
        }
    }
    return $blocks
}

function Split-EvenBlock($block, [int]$targetN) {
    $n = $block.N
    if ($n -le 1) { return @($block) }
    if ($n -le [int]($targetN * 1.35)) { return @($block) }
    $files = @($block.Files)
    $chunks = New-Object System.Collections.Generic.List[object]
    for ($i = 0; $i -lt $files.Count; $i += $targetN) {
        $take = [Math]::Min($targetN, $files.Count - $i)
        [void]$chunks.Add(@($files[$i..($i + $take - 1)]))
    }
    if ($chunks.Count -gt 1 -and @($chunks[$chunks.Count - 1]).Count -lt 40) {
        $chunks[$chunks.Count - 2] = @($chunks[$chunks.Count - 2]) + @($chunks[$chunks.Count - 1])
        [void]$chunks.RemoveAt($chunks.Count - 1)
    }
    if ($chunks.Count -le 1) { return @($block) }
    $out = @()
    foreach ($ch in $chunks) {
        $out += New-Block @($ch) $block.Support $block.Kinds
    }
    return $out
}

function Get-MediaFileSizes([string]$mediaDir) {
    $sizes = @{}
    if (-not $mediaDir) { return $sizes }
    foreach ($sub in @("img", "vid")) {
        $dir = Join-Path $mediaDir $sub
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | ForEach-Object {
            $sizes[$_.Name] = [int64]$_.Length
        }
    }
    return $sizes
}

function Split-ByMaxBytes($block, $sizes, [int64]$maxBytes) {
    if ($maxBytes -le 0 -or $null -eq $sizes -or $sizes.Count -eq 0) { return @($block) }
    $n = $block.N
    if ($n -le 1) { return @($block) }
    $files = @($block.Files)
    $chunks = New-Object System.Collections.Generic.List[object]
    $cur = New-Object System.Collections.Generic.List[string]
    $used = [int64]0
    foreach ($name in $files) {
        $sz = [int64]0
        if ($sizes.ContainsKey($name)) { $sz = [int64]$sizes[$name] }
        if ($cur.Count -gt 0 -and ($used + $sz) -gt $maxBytes) {
            [void]$chunks.Add(@($cur.ToArray()))
            $cur = New-Object System.Collections.Generic.List[string]
            $used = [int64]0
        }
        [void]$cur.Add($name)
        $used += $sz
    }
    if ($cur.Count -gt 0) { [void]$chunks.Add(@($cur.ToArray())) }
    if ($chunks.Count -le 1) { return @($block) }
    $out = @()
    foreach ($ch in $chunks) {
        $out += New-Block @($ch) $block.Support $block.Kinds
    }
    return $out
}

function ConvertTo-NamedPacks($blockList, [string[]]$allCats) {
    $groups = @{}
    foreach ($b in $blockList) {
        $base = Get-SupportId $b.Support $allCats
        if (-not $groups.ContainsKey($base)) { $groups[$base] = New-Object System.Collections.Generic.List[object] }
        [void]$groups[$base].Add($b)
    }
    $named = New-Object System.Collections.Generic.List[object]
    foreach ($base in ($groups.Keys | Sort-Object)) {
        $parts = @($groups[$base] | Sort-Object { $_.Files[0] }, { $_.N })
        if ($parts.Count -eq 1) {
            [void]$named.Add(@{ Id = $base; Block = $parts[0] })
            continue
        }
        $i = 1
        foreach ($p in $parts) {
            [void]$named.Add(@{ Id = ("{0}-p{1:D2}" -f $base, $i); Block = $p })
            $i++
        }
    }
    return @($named | Sort-Object { $_.Id })
}

function Find-MediaFile([string]$mediaDir, [string]$name, [string]$kind) {
    $sub = if ($kind -eq "video") { "vid" } else { "img" }
    $direct = Join-Path (Join-Path $mediaDir $sub) $name
    if (Test-Path -LiteralPath $direct) { return $direct }
    foreach ($folder in @((Join-Path $mediaDir "img"), (Join-Path $mediaDir "vid"))) {
        $cand = Join-Path $folder $name
        if (Test-Path -LiteralPath $cand) { return $cand }
    }
    return $null
}

function Write-PackFiles($named, $mediaDir, [string]$outDir, $kinds, [bool]$makeZip) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    Write-Host "-> Clearing $outDir ..." -ForegroundColor Yellow
    Get-ChildItem -LiteralPath $outDir -Force -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force
    $packMeta = [ordered]@{}
    $packTotal = @($named).Count
    if ($packTotal -lt 1) { $packTotal = 1 }
    if ($makeZip -and $mediaDir) {
        Write-Host "-> Writing $packTotal zip packs (this may take a while)..." -ForegroundColor Cyan
    } else {
        Write-Host "-> Writing $packTotal pack lists (no zip)..." -ForegroundColor Cyan
    }
    $packI = 0
    foreach ($item in $named) {
        $packI++
        $packId = $item.Id
        $block = $item.Block
        $listPath = Join-Path $outDir "$packId.txt"
        [IO.File]::WriteAllText($listPath, (($block.Files -join "`n") + "`n"))
        $missing = New-Object System.Collections.Generic.List[string]
        $zipName = $null
        $bytes = $null
        $sha = $null
        $label = if ($makeZip -and $mediaDir) { "$packId.zip" } else { "$packId.txt" }
        Write-Host ("   pack {0} / {1}  {2}  ({3} files)..." -f $packI, $packTotal, $label, $block.N) -ForegroundColor Gray
        if ($makeZip -and $mediaDir) {
            $zipPath = Join-Path $outDir "$packId.zip"
            if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
            $zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
            try {
                $fi = 0
                $fileN = [Math]::Max(1, $block.N)
                foreach ($name in $block.Files) {
                    $fi++
                    if (($fi % 25 -eq 0) -or ($fi -eq $block.N)) {
                        $overall = [int][Math]::Min(100, [Math]::Floor(100.0 * (($packI - 1) + ($fi / $fileN)) / $packTotal))
                        Write-Progress -Activity "Media packs" -Status ("{0}  {1} / {2} files" -f $packId, $fi, $block.N) -PercentComplete $overall
                    }
                    $kind = $kinds[$name]
                    $src = Find-MediaFile $mediaDir $name $kind
                    $arc = "$(if ($kind -eq 'video') { 'vid' } else { 'img' })/$name"
                    if (-not $src) { [void]$missing.Add($name); continue }
                    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $src, $arc)
                }
            } finally { $zip.Dispose() }
            $zipName = "$packId.zip"
            $bytes = (Get-Item -LiteralPath $zipPath).Length
            $limit = 300MB
            if ($bytes -gt $limit) {
                Write-Progress -Activity "Media packs" -Completed
                throw "Zip $zipName is $([math]::Round($bytes/1MB,1)) MiB — over the 300 MiB wrangler/dashboard limit. Re-run with a lower -MaxZipMiB."
            }
            Write-Progress -Activity "Media packs" -Status ("SHA256 {0}" -f $zipName) -PercentComplete ([int][Math]::Min(99, [Math]::Floor(100.0 * $packI / $packTotal)))
            Write-Host ("   hashing {0} ..." -f $zipName) -ForegroundColor DarkGray
            $sha = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
            Write-Host ("   pack {0} / {1}  {2}  {3:N1} MiB" -f $packI, $packTotal, $zipName, ($bytes / 1MB)) -ForegroundColor Green
        } else {
            $sha1 = [System.Security.Cryptography.SHA256]::Create()
            try {
                $payload = [Text.Encoding]::UTF8.GetBytes(($block.Files -join "`n"))
                $sha = ([BitConverter]::ToString($sha1.ComputeHash($payload))).Replace("-", "").ToLowerInvariant()
            } finally { $sha1.Dispose() }
        }
        $packMeta[$packId] = [ordered]@{
            id      = $packId
            file    = $zipName
            files   = $block.N
            support = @(ConvertFrom-SupportKey $block.Support)
            missing = @($missing)
            sha256  = $sha
        }
        if ($null -ne $bytes) { $packMeta[$packId].bytes = $bytes }
    }
    Write-Progress -Activity "Media packs" -Completed
    return $packMeta
}

function Build-MediaPacks {
    param(
        [string]$DataDir,
        [string]$MediaDir,
        [string]$OutDir,
        [double]$Margin,
        [double]$Jaccard,
        [int]$PartFiles,
        [int]$Tiny,
        [bool]$MakeZip,
        [int64]$MaxZipBytes = 0
    )
    $categories = @(Get-CategoryIds $DataDir)
    Write-Host "-> Scanning JSON in $DataDir ($($categories.Count) categories)..." -ForegroundColor Cyan
    $maps = Get-WhereMap $DataDir $categories
    $where = $maps.Where
    $kinds = $maps.Kinds
    if ($where.Count -eq 0) { throw "No media names in JSON." }
    Write-Host "-> $($where.Count) media files — grouping by category overlap..." -ForegroundColor Cyan

    $atoms = @{}
    foreach ($pair in $where.GetEnumerator()) {
        $key = ConvertTo-SupportKey @($pair.Value)
        if (-not $atoms.ContainsKey($key)) { $atoms[$key] = New-Object System.Collections.Generic.List[string] }
        [void]$atoms[$key].Add($pair.Key)
    }
    $blocks = New-Object System.Collections.Generic.List[object]
    foreach ($key in $atoms.Keys) {
        [void]$blocks.Add((New-Block @($atoms[$key]) $key $kinds))
    }
    $atomN = $blocks.Count
    $blocks = Invoke-GreedyMerge2 $blocks $categories $where $Margin $Jaccard
    $blocks = Invoke-AbsorbTiny $blocks $categories $where $Margin $Tiny
    $sizes = Get-MediaFileSizes $MediaDir
    $split = New-Object System.Collections.Generic.List[object]
    foreach ($b in $blocks) {
        # With real file sizes, fill each zip up to -MaxZipMiB.
        # Do not pre-cut by file count: 180 photos can be 50 MiB leftover.
        if ($sizes.Count -gt 0 -and $MaxZipBytes -gt 0) {
            foreach ($p in (Split-ByMaxBytes $b $sizes $MaxZipBytes)) { [void]$split.Add($p) }
        } else {
            foreach ($p in (Split-EvenBlock $b $PartFiles)) { [void]$split.Add($p) }
        }
    }
    $named = ConvertTo-NamedPacks $split $categories
    $packMeta = Write-PackFiles $named $MediaDir $OutDir $kinds $MakeZip

    $catMap = [ordered]@{}
    $surplus = [ordered]@{}
    foreach ($cat in $categories) {
        $need = 0
        foreach ($pair in $where.GetEnumerator()) { if ($pair.Value.Contains($cat)) { $need++ } }
        $got = 0
        $ids = New-Object System.Collections.Generic.List[string]
        foreach ($item in $named) {
            if ((Get-NeededN $item.Block $cat $where) -gt 0) {
                [void]$ids.Add($item.Id)
                $got += $item.Block.N
            }
        }
        $catMap[$cat] = @($ids)
        $extra = $got - $need
        $pct = if ($need -gt 0) { [Math]::Round(100.0 * $extra / $need, 2) } else { 0 }
        $surplus[$cat] = [ordered]@{ need = $need; in_zips = $got; extra = $extra; extra_pct = $pct }
    }

    $manifest = [ordered]@{
        schema    = 1
        generated = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
        params    = [ordered]@{ margin_pct = $Margin; jaccard_min = $Jaccard; part_files = $PartFiles; tiny_n = $Tiny }
        atoms     = $atomN
        packs     = $packMeta
        categories = $catMap
        surplus   = $surplus
    }
    $json = $manifest | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText((Join-Path $OutDir "manifest.json"), $json)
    return $manifest
}

function Write-PackSummary($man) {
    $packCount = @($man.packs.Keys).Count
    Write-Host ("atoms {0}  packs {1}" -f $man.atoms, $packCount)
    Write-Host "category   zips  need   got  extra    %"
    foreach ($cat in @($man.surplus.Keys)) {
        $s = $man.surplus[$cat]
        $z = @($man.categories[$cat]).Count
        Write-Host ("  {0,-8} {1,4} {2,5} {3,5} {4,6} {5,5}%" -f $cat, $z, $s['need'], $s['in_zips'], $s['extra'], $s['extra_pct'])
    }
}

function Invoke-SelfTest {
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("prawko-packs-self-" + [guid]::NewGuid().ToString("N"))
    $data = Join-Path $tmp "data"
    $out = Join-Path $tmp "out"
    New-Item -ItemType Directory -Path $data | Out-Null
    $meta = '{"categories":[{"id":"A"},{"id":"B"},{"id":"C"}]}'
    [IO.File]::WriteAllText((Join-Path $data "meta.json"), $meta)
    [IO.File]::WriteAllText((Join-Path $data "A.json"), '{"questions":[{"media":"shared.webp","mediaType":"image"},{"media":"ab.webp","mediaType":"image"},{"media":"only-a.webp","mediaType":"image"}]}')
    [IO.File]::WriteAllText((Join-Path $data "B.json"), '{"questions":[{"media":"shared.webp","mediaType":"image"},{"media":"ab.webp","mediaType":"image"},{"media":"only-b.webp","mediaType":"image"}]}')
    [IO.File]::WriteAllText((Join-Path $data "C.json"), '{"questions":[{"media":"shared.webp","mediaType":"image"},{"media":"only-c.webp","mediaType":"image"}]}')
    $man = Build-MediaPacks -DataDir $data -MediaDir $null -OutDir $out -Margin 20 -Jaccard 0.45 -PartFiles 1000 -Tiny 2 -MakeZip $false -MaxZipBytes 0
    if ($man.schema -ne 1) { throw "self-test: schema" }
    foreach ($cat in @("A", "B", "C")) {
        $packs = @($man.categories.$cat)
        if ($packs.Count -lt 1) { throw "self-test: $cat has no packs" }
        $names = @()
        foreach ($packId in $packs) {
            $names += Get-Content -LiteralPath (Join-Path $out "$packId.txt") | Where-Object { $_ }
        }
        $needFile = Join-Path $data "$cat.json"
        if ($names.Count -lt 1) { throw "self-test: $cat empty files" }
        if (-not (Test-Path -LiteralPath $needFile)) { throw "self-test missing $needFile" }
    }
    Remove-Item -LiteralPath $tmp -Recurse -Force
    Write-Host "self-test ok"
}

if ($SelfTest) {
    Invoke-SelfTest
    return
}

if (-not $DataDir) { $DataDir = Join-Path $script:RepoRoot "src\data" }
if (-not $OutDir) { $OutDir = Get-DefaultOutDir }
if (-not $MediaDir) { $MediaDir = Get-DefaultMediaDir }
Write-Host "=== Building media packs ===" -ForegroundColor Cyan
Write-Host "JSON: $DataDir" -ForegroundColor Gray
Write-Host "Media: $(if ($MediaDir) { $MediaDir } else { '(none — lists only)' })" -ForegroundColor Gray
Write-Host "Output: $OutDir" -ForegroundColor Gray
Write-Host "Max zip: $MaxZipMiB MiB" -ForegroundColor Gray
$makeZip = (-not $NoZip) -and [bool]$MediaDir
$maxZipBytes = if ($MaxZipMiB -gt 0) { [int64]$MaxZipMiB * 1MB } else { [int64]0 }
$man = Build-MediaPacks -DataDir $DataDir -MediaDir $MediaDir -OutDir $OutDir -Margin $Margin -Jaccard $Jaccard -PartFiles $PartFiles -Tiny $Tiny -MakeZip $makeZip -MaxZipBytes $maxZipBytes
Write-Host "wrote $(Join-Path $OutDir 'manifest.json')"
Write-PackSummary $man
if (-not $makeZip) {
    Write-Host "No -MediaDir / img+vid — lists and manifest only, no zips." -ForegroundColor DarkYellow
}
