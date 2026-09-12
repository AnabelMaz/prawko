# UTF-8 with BOM — Windows PowerShell 5.1 otherwise misreads non-ASCII text and here-strings.
# Parse the ministry Excel catalogue into src/data JSON (Windows, no Python).
# Same job as scripts/parse-excel.py. Uses column headers, not fixed indexes,
# so extra columns (points, translations) do not shift Kategorie.
#
# Regulation (Dz.U. 2023 poz. 2659): basic = TAK/NIE, specialist = A/B/C.
# MI "Zakres struktury" is sometimes wrong (ABC tagged PODSTAWOWY). Type follows
# the correct answer: T/N = basic, A/B/C = specialist.
# The Excel "Liczba punktow" column is stored on each question; exam draw uses those values.
#
# Default: keep media file names even if the local pack is missing (CDN).
# -DropMissingMedia only when asked: then missing raw files clear media in JSON.
#
# powershell -ExecutionPolicy Bypass -File scripts/parse-excel.ps1
# powershell -ExecutionPolicy Bypass -File scripts/parse-excel.ps1 -Excel gov-data\baza_pytan.xlsx -OutDir src\data
# Installer: Install_Prawko.windows.ps1 -SyncGov (repo root)
# Drop missing media: parse-excel.ps1 -DropMissingMedia or Install_Prawko.windows.ps1 -SyncGov -DropMissingMedia

param(
    [string]$Excel,
    [string]$OutDir,
    [string]$MediaDir,
    [switch]$DropMissingMedia
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Excel) { $Excel = Join-Path $repoRoot "gov-data\baza_pytan.xlsx" }
if (-not $OutDir) { $OutDir = Join-Path $repoRoot "src\data" }
if (-not [IO.Path]::IsPathRooted($Excel)) { $Excel = Join-Path $repoRoot $Excel }
if (-not [IO.Path]::IsPathRooted($OutDir)) { $OutDir = Join-Path $repoRoot $OutDir }
if ($MediaDir -and -not [IO.Path]::IsPathRooted($MediaDir)) { $MediaDir = Join-Path $repoRoot $MediaDir }

$Categories = @("A", "A1", "A2", "AM", "B", "B1", "C", "C1", "D", "D1", "PT", "T")
$ExamRules = [ordered]@{
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

function Get-ExcelColumnIndex ([string]$cellRef) {
    if ($cellRef -notmatch '^([A-Za-z]+)') { return -1 }
    $n = 0
    foreach ($ch in $Matches[1].ToUpperInvariant().ToCharArray()) {
        $n = $n * 26 + ([int][char]$ch - [int][char]'A' + 1)
    }
    return $n - 1
}

function Find-ExcelHeaderIndex ($header, [string]$label, [string[]]$exact, [string]$regex) {
    for ($i = 0; $i -lt $header.Count; $i++) {
        $h = ([string]$header[$i]).Trim()
        foreach ($n in @($exact)) {
            if ($n -and $h -eq $n) { return $i }
        }
        if ($regex -and $h -match $regex) { return $i }
    }
    throw "Missing column $label. Headers: $($header -join ' | ')"
}

function Get-PrawkoQuestionType ([string]$structure, [string]$correct, [string]$ansA, [string]$ansB, [string]$ansC) {
    if ($correct -in @('A', 'B', 'C')) { return 'specialist' }
    if ($correct -in @('T', 'N')) { return 'basic' }
    if ($ansA -and $ansB -and $ansC) { return 'specialist' }
    if ($structure -eq 'PODSTAWOWY') { return 'basic' }
    return 'specialist'
}

function Find-ExcelHeaderIndexOptional ($header, [string]$regex) {
    for ($i = 0; $i -lt $header.Count; $i++) {
        $h = ([string]$header[$i]).Trim()
        if ($regex -and $h -match $regex) { return $i }
    }
    return -1
}

function Get-ExcelCell ([object]$row, [int]$col) {
    if ($col -lt 0) { return '' }
    $rowLen = $row.Length
    if ($col -ge $rowLen -or -not $row[$col]) { return '' }
    return ([string]$row[$col]).Trim()
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

$script:PrawkoJsonCompact = $false

function ConvertTo-PrawkoJson {
    param($Value, [int]$Level = 0)
    $compact = [bool]$script:PrawkoJsonCompact
    $nl = if ($compact) { '' } else { "`n" }
    $pad = if ($compact) { '' } else { ("  " * $Level) }
    $pad2 = if ($compact) { '' } else { ("  " * ($Level + 1)) }
    $colon = if ($compact) { ':' } else { ': ' }
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
            $parts.Add(($pad2 + '"' + (Escape-PrawkoJsonString ([string]$k)) + '"' + $colon + (ConvertTo-PrawkoJson $dict[$k] ($Level + 1))))
        }
        return '{' + $nl + ($parts -join ($(if ($compact) { ',' } else { ',' + $nl }))) + $nl + $pad + '}'
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        $arr = @($Value)
        if ($arr.Count -eq 0) { return '[]' }
        $parts = New-Object System.Collections.Generic.List[string]
        foreach ($item in $arr) {
            $parts.Add(($pad2 + (ConvertTo-PrawkoJson $item ($Level + 1))))
        }
        return '[' + $nl + ($parts -join ($(if ($compact) { ',' } else { ',' + $nl }))) + $nl + $pad + ']'
    }
    return '"' + (Escape-PrawkoJsonString ([string]$Value)) + '"'
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
        if (-not $sheetEntry) { throw "No xl/worksheets/sheet1.xml in $xlsxPath" }
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

if (-not (Test-Path -LiteralPath $Excel)) {
    throw "Excel not found: $Excel. Download the catalogue from gov.pl (or Install_Prawko.windows.ps1 -GovQuestions)."
}

$mediaLookup = $null
if ($DropMissingMedia) {
    if (-not $MediaDir) {
        $MediaDir = Join-Path $repoRoot "gov-data\raw"
        $legacyMedia = Join-Path $repoRoot "Pytania egzaminacyjne na prawo jazdy 2025"
        if (-not (Test-Path -LiteralPath $MediaDir) -and (Test-Path -LiteralPath $legacyMedia)) {
            $MediaDir = $legacyMedia
        }
    }
    if (Test-Path -LiteralPath $MediaDir) {
        $mediaLookup = @{}
        Get-ChildItem -LiteralPath $MediaDir -File -ErrorAction SilentlyContinue | ForEach-Object {
            $mediaLookup[$_.Name.ToLowerInvariant()] = $true
        }
    }
}

Write-Host "Parsing $Excel -> $OutDir" -ForegroundColor Cyan
$sheet = Read-XlsxSheetRows $Excel
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
$colPoints = Find-ExcelHeaderIndex $header "Liczba punktow" -regex '^Liczba punkt'
$colCats = Find-ExcelHeaderIndex $header "Kategorie" -exact @("Kategorie")
$colEnQ = Find-ExcelHeaderIndexOptional $header '^Pytanie \[EN\]$'
$colEnA = Find-ExcelHeaderIndexOptional $header '^Odpowied.+ A \[EN\]$'
$colEnB = Find-ExcelHeaderIndexOptional $header '^Odpowied.+ B \[EN\]$'
$colEnC = Find-ExcelHeaderIndexOptional $header '^Odpowied.+ C \[EN\]$'
$colDeQ = Find-ExcelHeaderIndexOptional $header '^Pytanie \[D\]$'
$colDeA = Find-ExcelHeaderIndexOptional $header '^Odpowied.+ A \[D\]$'
$colDeB = Find-ExcelHeaderIndexOptional $header '^Odpowied.+ B \[D\]$'
$colDeC = Find-ExcelHeaderIndexOptional $header '^Odpowied.+ C \[D\]$'
$colUkQ = Find-ExcelHeaderIndexOptional $header '^Pytanie \[UA\]$'
$colUkA = Find-ExcelHeaderIndexOptional $header '^Odpowied.+ A \[UA\]$'
$colUkB = Find-ExcelHeaderIndexOptional $header '^Odpowied.+ B \[UA\]$'
$colUkC = Find-ExcelHeaderIndexOptional $header '^Odpowied.+ C \[UA\]$'

$catQuestions = @{}
foreach ($cat in $Categories) { $catQuestions[$cat] = New-Object System.Collections.Generic.List[object] }
$missingMedia = 0
$forcedSpecialist = 0
$translations = @{
    en = [ordered]@{}
    de = [ordered]@{}
    uk = [ordered]@{}
}

function Add-QuestionTranslation ($map, [string]$id, [string]$q, [string]$a, [string]$b, [string]$c, [string]$qType) {
    if (-not $id) { return }
    if ($map.Contains($id)) { return }
    if (-not $q -and -not $a -and -not $b -and -not $c) { return }
    $tr = [ordered]@{}
    if ($q) { $tr['q'] = $q }
    if ($qType -eq 'specialist') {
        if ($a) { $tr['a'] = $a }
        if ($b) { $tr['b'] = $b }
        if ($c) { $tr['c'] = $c }
    }
    if ($tr.Count -gt 0) { $map[$id] = $tr }
}

for ($r = 1; $r -lt $rows.Count; $r++) {
    $row = $rows[$r]
    $qnum = Get-ExcelCell $row $colNum
    $qtext = Get-ExcelCell $row $colQ
    $correct = Get-ExcelCell $row $colCorrect
    $structure = Get-ExcelCell $row $colStructure
    $rawCats = Get-ExcelCell $row $colCats
    $rawMedia = Get-ExcelCell $row $colMedia
    $ansA = Get-ExcelCell $row $colA
    $ansB = Get-ExcelCell $row $colB
    $ansC = Get-ExcelCell $row $colC
    $rawPoints = Get-ExcelCell $row $colPoints

    $qType = Get-PrawkoQuestionType $structure $correct $ansA $ansB $ansC
    if ($qType -eq 'specialist' -and $structure -eq 'PODSTAWOWY') { $forcedSpecialist++ }

    $points = 0
    if ($rawPoints -match '^\d+') { $points = [int]$Matches[0] }
    if ($points -lt 1 -or $points -gt 3) {
        $points = if ($qType -eq 'basic') { 1 } else { 2 }
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

    $qid = [string]$qObj.id
    Add-QuestionTranslation $translations.en $qid (Get-ExcelCell $row $colEnQ) (Get-ExcelCell $row $colEnA) (Get-ExcelCell $row $colEnB) (Get-ExcelCell $row $colEnC) $qType
    Add-QuestionTranslation $translations.de $qid (Get-ExcelCell $row $colDeQ) (Get-ExcelCell $row $colDeA) (Get-ExcelCell $row $colDeB) (Get-ExcelCell $row $colDeC) $qType
    Add-QuestionTranslation $translations.uk $qid (Get-ExcelCell $row $colUkQ) (Get-ExcelCell $row $colUkA) (Get-ExcelCell $row $colUkB) (Get-ExcelCell $row $colUkC) $qType

    foreach ($cat in ($rawCats -split ',')) {
        $cat = $cat.Trim()
        if ($catQuestions.ContainsKey($cat)) {
            $catQuestions[$cat].Add([pscustomobject]$qObj)
        }
    }
}

if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$metaCategories = @()
$total = 0
$uniqueIds = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($cat in $Categories) {
    $questions = $catQuestions[$cat].ToArray()
    foreach ($q in $questions) {
        if ($null -ne $q.id -and [string]$q.id -ne '') {
            [void]$uniqueIds.Add([string]$q.id)
        }
    }
    $basic = @($questions | Where-Object { $_.type -eq "basic" }).Count
    $specialist = @($questions | Where-Object { $_.type -eq "specialist" }).Count
    $payload = [ordered]@{ category = $cat; questions = $questions }
    [IO.File]::WriteAllText((Join-Path $OutDir "$cat.json"), ((ConvertTo-PrawkoJson $payload) + "`n"), $utf8)
    $metaCategories += [ordered]@{
        id              = $cat
        name            = "Kategoria $cat"
        questionCount   = $questions.Length
        basicCount      = $basic
        specialistCount = $specialist
    }
    $total += $questions.Length
    Write-Host ("  {0,3}: {1,4} questions ({2} basic + {3} specialist)" -f $cat, $questions.Length, $basic, $specialist)
}

$meta = [ordered]@{ uniqueQuestionCount = $uniqueIds.Count; categories = $metaCategories; exam = $ExamRules }
[IO.File]::WriteAllText((Join-Path $OutDir "meta.json"), ((ConvertTo-PrawkoJson $meta) + "`n"), $utf8)
Write-Host "Wrote meta.json ($($uniqueIds.Count) unique, $total category assignments)." -ForegroundColor Green

$script:PrawkoJsonCompact = $true
foreach ($pair in @(@('en', 'translations_en.json'), @('de', 'translations_de.json'), @('uk', 'translations_uk.json'))) {
    $lang = $pair[0]
    $file = $pair[1]
    $map = $translations[$lang]
    [IO.File]::WriteAllText((Join-Path $OutDir $file), (ConvertTo-PrawkoJson $map), $utf8)
    Write-Host "Wrote $file ($($map.Count) questions)." -ForegroundColor Green
}
$script:PrawkoJsonCompact = $false

if ($forcedSpecialist) {
    Write-Host "Treated $forcedSpecialist PODSTAWOWY rows as specialist (correct answer A/B/C)." -ForegroundColor Yellow
}
if ($missingMedia) {
    Write-Host "WARNING: $missingMedia questions reference media missing from $MediaDir" -ForegroundColor DarkYellow
}
