# UTF-8 with BOM — Windows PowerShell 5.1 otherwise misreads non-ASCII text and here-strings.
# Merge ministry Excel JSON into an existing src/data bank (Windows, no Python).
# Same job as scripts/merge-gov.py. Match on question text; skip when media
# filename matches or (optional) ffmpeg frames are >=95% similar. New rows get
# id suffix -mi when the number is taken.
#
# Helpers load with:
#   . scripts\merge-gov.ps1 -LibraryOnly
#   Merge-GovExcelIntoDataFiles -GovDir DIR -OutDir DIR
#
# powershell -ExecutionPolicy Bypass -File scripts/merge-gov.ps1
# powershell -ExecutionPolicy Bypass -File scripts/merge-gov.ps1 -GovDir C:\ProgramData\prawko\gov-cache -OutDir C:\ProgramData\prawko\src\data
# Installer: Install_Prawko.windows.ps1 -MergeGov

param(
    [switch]$LibraryOnly,
    [string]$GovDir,
    [string]$OutDir,
    [string]$FfmpegExe,
    [string[]]$MediaDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

. (Join-Path $PSScriptRoot "download-gov.ps1") -LibraryOnly

$script:PrawkoMergeCategories = @("A", "A1", "A2", "AM", "B", "B1", "C", "C1", "D", "D1", "PT", "T")
$script:MediaVisualCache = @{}
$script:MediaVisualSize = 96
$script:MediaVisualThreshold = 0.95

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

function Resolve-MergeFfmpegExe ([string]$explicit) {
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

function Get-DefaultMergeMediaDirs {
    $dirs = New-Object System.Collections.Generic.List[string]
    $raw = Get-ContribRawMediaDir
    if ($raw) { [void]$dirs.Add($raw) }
    $server = "C:\ProgramData\prawko"
    [void]$dirs.Add((Join-Path $server "src\media\img"))
    [void]$dirs.Add((Join-Path $server "src\media\vid"))
    try {
        $repo = Get-PrawkoRepoRoot
        [void]$dirs.Add((Join-Path $repo "src\media\img"))
        [void]$dirs.Add((Join-Path $repo "src\media\vid"))
    } catch {}
    return $dirs.ToArray()
}

function Convert-MergeMediaDirList ([string[]]$explicit) {
    $dirs = New-Object System.Collections.Generic.List[string]
    foreach ($item in @($explicit)) {
        if ([string]::IsNullOrWhiteSpace($item)) { continue }
        foreach ($part in ($item -split ';')) {
            $p = $part.Trim()
            if ($p) { [void]$dirs.Add($p) }
        }
    }
    if ($dirs.Count -eq 0) { return @(Get-DefaultMergeMediaDirs) }
    return $dirs.ToArray()
}

function Get-MergeField ($question, [string]$name) {
    $prop = $question.PSObject.Properties[$name]
    if (-not $prop -or $null -eq $prop.Value) { return '' }
    return [string]$prop.Value
}

function Read-MergeJson ([string]$path) {
    if (-not $script:MergeJsonCache) { $script:MergeJsonCache = @{} }
    if ($script:MergeJsonCache.ContainsKey($path)) { return $script:MergeJsonCache[$path] }
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    $obj = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    $script:MergeJsonCache[$path] = $obj
    return $obj
}

function Import-MergeCategoryQuestions ([string]$path) {
    $data = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    $idsProp = $data.PSObject.Properties['questionIds']
    if (-not $idsProp) { throw "$path has no questionIds" }
    $root = Split-Path -Parent $path
    $facts = Read-MergeJson (Join-Path $root 'questions.json')
    $polish = Read-MergeJson (Join-Path $root 'translations_pl.json')
    $list = New-Object System.Collections.Generic.List[object]
    foreach ($id in $idsProp.Value) {
        $key = [string]$id
        $text = $null
        $fact = $null
        if ($polish) {
            $tp = $polish.PSObject.Properties[$key]
            if ($tp) { $text = $tp.Value }
        }
        if ($facts) {
            $fp = $facts.PSObject.Properties[$key]
            if ($fp) { $fact = $fp.Value }
        }
        $obj = [ordered]@{
            id        = $id
            q         = $(if ($text) { Get-MergeField $text 'q' } else { '' })
            type      = $(if ($fact) { Get-MergeField $fact 'type' } else { '' })
            correct   = $(if ($fact) { Get-MergeField $fact 'correct' } else { '' })
            points    = $(if ($fact -and $fact.PSObject.Properties['points']) { $fact.points } else { $null })
            media     = $null
            mediaType = $null
        }
        if ($text) {
            $a = Get-MergeField $text 'a'
            $b = Get-MergeField $text 'b'
            $c = Get-MergeField $text 'c'
            if ($a -or $b -or $c) {
                $obj['a'] = $a
                $obj['b'] = $b
                $obj['c'] = $c
            }
        }
        if ($fact) {
            $media = Get-MergeField $fact 'media'
            if ($media) {
                $obj.media = $media
                $obj.mediaType = Get-MergeField $fact 'mediaType'
            }
        }
        $list.Add([pscustomobject]$obj)
    }
    return $list.ToArray()
}

function ConvertTo-MergeFact ($question) {
    $fact = [ordered]@{
        type    = Get-MergeField $question 'type'
        correct = Get-MergeField $question 'correct'
        points  = $question.points
    }
    $media = Get-MergeField $question 'media'
    if ($media) {
        $fact['media'] = $media
        $fact['mediaType'] = Get-MergeField $question 'mediaType'
    }
    return [pscustomobject]$fact
}

function ConvertTo-MergePolish ($question) {
    $text = [ordered]@{
        q   = Get-MergeField $question 'q'
        src = 'excel'
    }
    $a = Get-MergeField $question 'a'
    $b = Get-MergeField $question 'b'
    $c = Get-MergeField $question 'c'
    if ($a -or $b -or $c) {
        $text['a'] = $a
        $text['b'] = $b
        $text['c'] = $c
    }
    return [pscustomobject]$text
}

function Merge-GovExcelIntoDataFiles {
    param(
        [Parameter(Mandatory = $true)][string]$GovDir,
        [Parameter(Mandatory = $true)][string]$OutDir,
        [string]$FfmpegExe,
        [string[]]$MediaDir
    )
    $categories = $script:PrawkoMergeCategories
    $script:MergeJsonCache = @{}
    $parsedCategories = @{}
    foreach ($cat in $categories) {
        $src = Join-Path $GovDir "$cat.json"
        if (-not (Test-Path -LiteralPath $src)) {
            throw "Missing $src — run scripts/parse-excel.ps1 first."
        }
        $parsedCategories[$cat] = @(Import-MergeCategoryQuestions $src)
    }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    $addedTotal = 0
    $metaCategories = @()
    $script:MediaVisualCache = @{}
    $ffmpegResolved = Resolve-MergeFfmpegExe $FfmpegExe
    $ffprobeExe = Get-FfprobeExe $ffmpegResolved
    $indexDirs = Convert-MergeMediaDirList $MediaDir
    $mediaIndex = New-MediaStemIndex $indexDirs
    if (-not $ffmpegResolved) {
        Write-Host "-> No FFmpeg — merge without frame comparison (media file name only)." -ForegroundColor DarkYellow
    } elseif ($mediaIndex.Count -eq 0) {
        Write-Host "-> No local media — merge without frame comparison (file name only)." -ForegroundColor DarkYellow
        $ffmpegResolved = $null
    } else {
        Write-Host "-> Visual media comparison (FFmpeg $($script:MediaVisualSize)x$($script:MediaVisualSize), threshold $([int]($script:MediaVisualThreshold * 100))%, videos: 1st/middle/last frame)." -ForegroundColor Cyan
    }

    $factMap = [ordered]@{}
    $polishMap = [ordered]@{}
    foreach ($cat in $categories) {
        $path = Join-Path $OutDir "$cat.json"
        if (-not (Test-Path $path)) {
            throw "Missing $path — merge needs the question bank from the repository."
        }
        $existingIds = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        $byText = @{}
        $list = New-Object System.Collections.Generic.List[object]
        foreach ($q in @(Import-MergeCategoryQuestions $path)) {
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
            $why = Get-QuestionDuplicateReason $q $candidates $ffmpegResolved $ffprobeExe $mediaIndex
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
        $ids = New-Object System.Collections.Generic.List[object]
        foreach ($q in $questions) {
            $ids.Add($q.id)
            $key = Get-QuestionIdKey $q.id
            if (-not $key -or $factMap.Contains($key)) { continue }
            $factMap[$key] = ConvertTo-MergeFact $q
            $polishMap[$key] = ConvertTo-MergePolish $q
        }
        $payload = [ordered]@{ category = $cat; questionIds = $ids }
        [IO.File]::WriteAllText($path, ((ConvertTo-Json -InputObject $payload -Depth 6) + "`n"), $utf8)
        $metaCategories += [ordered]@{
            id              = $cat
            name            = "Kategoria $cat"
            questionCount   = $questions.Length
            basicCount      = $basic
            specialistCount = $specialist
        }
        $addedTotal += $added
        $skipBits = @()
        if ($skippedSame) { $skipBits += "same text+media: $skippedSame" }
        if ($skippedVisual) { $skipBits += "same text+frames >=95%: $skippedVisual" }
        if ($idRewritten) { $skipBits += "new id (number taken): $idRewritten" }
        $skipNote = if ($skipBits.Count) { ", skipped $($skipBits -join ', ')" } else { "" }
        Write-Host ("  {0,3}: +{1,4} from ministry (total {2}{3})" -f $cat, $added, $questions.Length, $skipNote)
    }

    [IO.File]::WriteAllText((Join-Path $OutDir "questions.json"), (ConvertTo-Json -InputObject $factMap -Depth 5 -Compress), $utf8)
    [IO.File]::WriteAllText((Join-Path $OutDir "translations_pl.json"), (ConvertTo-Json -InputObject $polishMap -Depth 5 -Compress), $utf8)

    $metaPath = Join-Path $OutDir "meta.json"
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
    Write-Host "-> Merge: appended $addedTotal questions from the ministry bank that were not in the repo." -ForegroundColor Green
}

if ($LibraryOnly) { return }

$repoRoot = Get-PrawkoRepoRoot
$serverRoot = "C:\ProgramData\prawko"
$serverReady = Test-Path -LiteralPath (Join-Path $serverRoot "src\index.html")
if (-not $GovDir) { $GovDir = Get-GovDataDir }
if (-not $OutDir) {
    if ($serverReady) { $OutDir = Join-Path $serverRoot "src\data" }
    else { $OutDir = Join-Path $repoRoot "src\data" }
}
if (-not [IO.Path]::IsPathRooted($GovDir)) { $GovDir = Join-Path $repoRoot $GovDir }
if (-not [IO.Path]::IsPathRooted($OutDir)) { $OutDir = Join-Path $repoRoot $OutDir }

Merge-GovExcelIntoDataFiles -GovDir $GovDir -OutDir $OutDir -FfmpegExe $FfmpegExe -MediaDir $MediaDir
