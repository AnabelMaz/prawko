# UTF-8 with BOM — Windows PowerShell 5.1 otherwise misreads Polish text and here-strings.
# Report JSON questions that mention a photo/film but have media: null.
# Does not drop ministry rows unless -Remove. Default parse-excel keeps Excel
# media names for CDN, so this should normally match nothing.
#
# powershell -ExecutionPolicy Bypass -File scripts/filter-no-media.ps1
# powershell -ExecutionPolicy Bypass -File scripts/filter-no-media.ps1 -ListRemoved
# powershell -ExecutionPolicy Bypass -File scripts/filter-no-media.ps1 -Remove

param(
    [string]$DataDir,
    [switch]$Remove,
    [switch]$DryRun,
    [Alias('v')]
    [switch]$ListRemoved
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $DataDir) { $DataDir = Join-Path $repoRoot "src\data" }
if (-not [IO.Path]::IsPathRooted($DataDir)) { $DataDir = Join-Path $repoRoot $DataDir }

$Categories = @("A", "A1", "A2", "AM", "B", "B1", "C", "C1", "D", "D1", "PT", "T")

$MediaReferencePatterns = @(
    '[Ww] tej sytuacji',
    '[Ww] przedstawionej sytuacji',
    '[Ww] takiej sytuacji',
    '[Ww] takim terenie',
    'na zdj\u0119ciu',
    'na fotografii',
    'na ilustracji',
    'na rysunku',
    'na filmie',
    'na widocznym',
    'tak oznakow',
    'tak oznacz',
    'takim odcinku',
    'takiej drod',
    'takim skrzy\u017cowaniu',
    'na takiej autostradzie',
    'na takiej drodze',
    'tego znaku',
    'tym sygnale',
    'widoczn\w+ znak',
    'widoczn\w+ s\u0142upk',
    'widoczn\w+ lini',
    'widoczn\w+ pojazd',
    'widoczn\w+ przejazd',
    'widoczn\w+ przej\u015bci',
    'widoczn\w+ przystan',
    'widoczn\w+ po lewej',
    'widoczn\w+ po prawej',
    'widoczn\w+ zakr\u0119t'
)

$MediaReferenceRegex = New-Object Text.RegularExpressions.Regex(
    ($MediaReferencePatterns -join '|'),
    [Text.RegularExpressions.RegexOptions]::IgnoreCase
)

function Test-QuestionNeedsMedia ([string]$text) {
    if ([string]::IsNullOrEmpty($text)) { return $false }
    return $MediaReferenceRegex.IsMatch($text)
}

function Escape-PrawkoJsonString ([string]$s) {
    $sb = New-Object Text.StringBuilder ($s.Length + 16)
    foreach ($ch in $s.ToCharArray()) {
        $code = [int]$ch
        switch ($code) {
            34 { [void]$sb.Append('\"'); continue }
            92 { [void]$sb.Append('\\'); continue }
            8 { [void]$sb.Append('\b'); continue }
            12 { [void]$sb.Append('\f'); continue }
            10 { [void]$sb.Append('\n'); continue }
            13 { [void]$sb.Append('\r'); continue }
            9 { [void]$sb.Append('\t'); continue }
            default {
                if ($code -lt 32) {
                    [void]$sb.Append(('\u{0:x4}' -f $code))
                } else {
                    [void]$sb.Append($ch)
                }
            }
        }
    }
    return $sb.ToString()
}

function ConvertTo-PrawkoJson {
    param($Value, [int]$Level = 0)
    $nl = "`n"
    $pad = "  " * $Level
    $pad2 = "  " * ($Level + 1)
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [bool]) { if ($Value) { return 'true' } else { return 'false' } }
    if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [uint16] -or $Value -is [int] -or $Value -is [uint32] -or $Value -is [long] -or $Value -is [uint64] -or $Value -is [decimal] -or $Value -is [double] -or $Value -is [single]) {
        return [string]$Value
    }
    if ($Value -is [string]) { return '"' + (Escape-PrawkoJsonString $Value) + '"' }
    $dict = $null
    if ($Value -is [System.Collections.IDictionary]) { $dict = $Value }
    elseif ($Value -is [psobject] -and @($Value.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' }).Count -gt 0) {
        $dict = [ordered]@{}
        foreach ($p in $Value.PSObject.Properties) {
            if ($p.MemberType -eq 'NoteProperty') { $dict[$p.Name] = $p.Value }
        }
    }
    if ($dict) {
        $keys = @($dict.Keys)
        if ($keys.Count -eq 0) { return '{}' }
        $parts = New-Object System.Collections.Generic.List[string]
        foreach ($k in $keys) {
            $parts.Add(($pad2 + '"' + (Escape-PrawkoJsonString ([string]$k)) + '": ' + (ConvertTo-PrawkoJson $dict[$k] ($Level + 1))))
        }
        return '{' + $nl + ($parts -join (',' + $nl)) + $nl + $pad + '}'
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        $arr = @($Value)
        if ($arr.Count -eq 0) { return '[]' }
        $parts = New-Object System.Collections.Generic.List[string]
        foreach ($item in $arr) {
            $parts.Add(($pad2 + (ConvertTo-PrawkoJson $item ($Level + 1))))
        }
        return '[' + $nl + ($parts -join (',' + $nl)) + $nl + $pad + ']'
    }
    return '"' + (Escape-PrawkoJsonString ([string]$Value)) + '"'
}

if (-not (Test-Path -LiteralPath $DataDir)) {
    throw "Data directory not found: $DataDir"
}

$write = $Remove -and -not $DryRun
if (-not $write) {
    Write-Host "=== REPORT ONLY (pass -Remove to delete ministry rows) ===" -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host "=== REMOVE MODE: dropping ministry questions from JSON ===" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "Checking questions with media: null in $DataDir"
Write-Host ""

$utf8 = New-Object System.Text.UTF8Encoding $false
$results = @()
$totalRemoved = 0
$totalOriginal = 0

foreach ($cat in $Categories) {
    $path = Join-Path $DataDir "$cat.json"
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing $path"
    }
    $data = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    $questions = @($data.questions)
    $kept = New-Object System.Collections.Generic.List[object]
    $removed = New-Object System.Collections.Generic.List[object]
    foreach ($q in $questions) {
        $needsMedia = Test-QuestionNeedsMedia ([string]$q.q)
        if ($null -eq $q.media -and $needsMedia) {
            $removed.Add($q)
        } else {
            $kept.Add($q)
        }
    }
    $removedBasic = @($removed | Where-Object { $_.type -eq 'basic' }).Count
    $removedSpecialist = @($removed | Where-Object { $_.type -eq 'specialist' }).Count
    $result = [ordered]@{
        category           = $cat
        original_count     = $questions.Count
        removed_count      = $removed.Count
        remaining_count    = $kept.Count
        removed_basic      = $removedBasic
        removed_specialist = $removedSpecialist
        removed_questions  = @($removed | ForEach-Object {
            $preview = [string]$_.q
            if ($preview.Length -gt 80) { $preview = $preview.Substring(0, 80) }
            [pscustomobject]@{ id = $_.id; q = $preview }
        })
    }
    $results += [pscustomobject]$result
    $totalRemoved += $removed.Count
    $totalOriginal += $questions.Count
    Write-Host ("  {0,3}: removed {1,3} questions (basic: {2}, specialist: {3}) | {4} -> {5}" -f `
        $cat, $removed.Count, $removedBasic, $removedSpecialist, $questions.Count, $kept.Count)
    if ($ListRemoved -and $removed.Count -gt 0) {
        foreach ($item in $result.removed_questions) {
            Write-Host ("       - [{0}] {1}..." -f $item.id, $item.q)
        }
    }
    if ($write -and $removed.Count -gt 0) {
        $data.questions = $kept.ToArray()
        [IO.File]::WriteAllText($path, ((ConvertTo-PrawkoJson $data) + "`n"), $utf8)
    }
}

Write-Host ""
Write-Host ("=" * 60)
Write-Host ("  TOTAL: removed {0} questions out of {1}" -f $totalRemoved, $totalOriginal)
Write-Host ("  Remaining: {0}" -f ($totalOriginal - $totalRemoved))
Write-Host ("=" * 60)

Write-Host ""
Write-Host "Updating meta.json..."
$metaPath = Join-Path $DataDir "meta.json"
$meta = Get-Content -LiteralPath $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json
$resultMap = @{}
foreach ($r in $results) { $resultMap[$r.category] = $r }
foreach ($catMeta in @($meta.categories)) {
    $catId = [string]$catMeta.id
    if (-not $resultMap.ContainsKey($catId)) { continue }
    $r = $resultMap[$catId]
    $oldTotal = [int]$catMeta.questionCount
    $oldBasic = [int]$catMeta.basicCount
    $oldSpecialist = [int]$catMeta.specialistCount
    $newBasic = $oldBasic - [int]$r.removed_basic
    $newSpecialist = $oldSpecialist - [int]$r.removed_specialist
    $newTotal = $newBasic + $newSpecialist
    if ([int]$r.removed_count -gt 0) {
        Write-Host ("  meta.json [{0}]: questionCount {1} -> {2}, basicCount {3} -> {4}, specialistCount {5} -> {6}" -f `
            $catId, $oldTotal, $newTotal, $oldBasic, $newBasic, $oldSpecialist, $newSpecialist)
    }
    $catMeta.questionCount = $newTotal
    $catMeta.basicCount = $newBasic
    $catMeta.specialistCount = $newSpecialist
}
if ($write) {
    [IO.File]::WriteAllText($metaPath, ((ConvertTo-PrawkoJson $meta) + "`n"), $utf8)
    Write-Host ""
    Write-Host "Done. JSON files updated." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "No files modified." -ForegroundColor Yellow
}
