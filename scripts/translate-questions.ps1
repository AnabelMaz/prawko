# UTF-8 with BOM — Windows PowerShell 5.1 otherwise misreads non-ASCII text and here-strings.
# Fill missing question translations (Windows, no Python).
# Same job as scripts/translate-questions.py. Does not overwrite ministry Excel
# strings already in translations_{en,de,ua}.json. -Lang ua is Ukrainian
# (Google language code uk).
#
# Gemini key (optional): -GeminiApiKey this run, else GEMINI_API_KEY in the
# environment, else .geminienv at the repo root (gitignored; template
# scripts/geminienv.example). No key = Google Translate only. With a key:
# Gemini only (v1beta generateContent — that is Google's REST surface,
# not a beta/preview model). One bad question is skipped; abort only on
# auth/key errors (progress saved).
#
# Helpers load with:
#   . scripts\translate-questions.ps1 -LibraryOnly
#   Fill-MissingQuestionTranslations -DataDir DIR [-Lang en,de,ua] [-GeminiApiKey KEY] [-SkipVerifyAi]
#
# powershell -ExecutionPolicy Bypass -File scripts/translate-questions.ps1
# powershell -ExecutionPolicy Bypass -File scripts/translate-questions.ps1 -Lang ua
# powershell -ExecutionPolicy Bypass -File scripts/translate-questions.ps1 -Lang ua -GeminiApiKey KEY
# parse-excel.ps1 calls this by default after writing JSON (-SkipTranslateGaps to skip).
# Fills are checked (length, structure, numbers, script) unless -SkipVerifyAi.

param(
    [switch]$LibraryOnly,
    [string[]]$Lang,
    [string]$DataDir,
    [string]$GeminiApiKey,
    [switch]$SkipVerifyAi
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$script:TrRepoRoot = Split-Path -Parent $PSScriptRoot
$script:TrDataDir = if ($DataDir) { $DataDir } else { Join-Path $script:TrRepoRoot "src\data" }
$script:TrGeminiApiKey = $GeminiApiKey
$script:TrSkipVerifyAi = [bool]$SkipVerifyAi
# PS 5.1 StrictMode: a scalar (one value, not created as @()) has no .Count.
function Get-TrLen ($obj) {
    if ($null -eq $obj) { return 0 }
    if ($obj -is [string]) { return 1 }
    if ($obj -is [System.Collections.ICollection]) { return [int]$obj.Count }
    if ($obj -is [System.Collections.IDictionary]) { return @( @($obj.Keys) ).Count }
    return @( $obj ).Count
}
$skipJson = @{
    "meta.json"              = $true
    "translations_en.json"   = $true
    "translations_de.json"   = $true
    "translations_ua.json"   = $true
    "translations_uk.json"   = $true
    "translations_pl.json"   = $true
}
$googleLang = @{ en = "en"; de = "de"; ua = "uk" }
$geminiLang = @{
    en = "English"
    de = "German"
    ua = "Ukrainian"
}
$geminiModels = @("gemini-3.5-flash-lite", "gemini-3.8-flash")
# Skip preview|experimental|beta|latest and non-text Flash when listing.
$geminiSkipSub = @(
    "live", "tts", "image", "embed", "transcribe", "veo", "lyria",
    "robotics", "audio", "banana", "omni", "computer",
    "preview", "experimental", "beta", "latest"
)
$script:TrGeminiModel = $null
$script:TrGeminiModels = $null
$script:TrGeminiDead = New-Object System.Collections.Generic.List[string]
$script:TrLastMap = $null
$script:TrLastBatch = $null
$script:TrLastQ = $null
$script:TrLastA = $null
$script:TrLastB = $null
$script:TrLastC = $null
$script:TrSrc = New-Object 'System.Collections.Generic.Dictionary[string,string]'
$script:TrSaved = New-Object 'System.Collections.Generic.Dictionary[string,string]'
$delaySec = 0.4
$geminiDelaySec = 0.4
$geminiBatchSize = 1
$saveEvery = 1
[Net.ServicePointManager]::Expect100Continue = $false

Add-Type -AssemblyName System.Web.Extensions

function Escape-TrJsonString ([string]$s) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $s.ToCharArray()) {
        switch ([int]$ch) {
            8 { [void]$sb.Append('\b') }
            9 { [void]$sb.Append('\t') }
            10 { [void]$sb.Append('\n') }
            12 { [void]$sb.Append('\f') }
            13 { [void]$sb.Append('\r') }
            34 { [void]$sb.Append('\"') }
            92 { [void]$sb.Append('\\') }
            default {
                if ($ch -lt 32) { [void]$sb.AppendFormat('\u{0:x4}', [int]$ch) }
                else { [void]$sb.Append($ch) }
            }
        }
    }
    return $sb.ToString()
}

function ConvertTo-TrJson ($map) {
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($id in @($map.Keys)) {
        $tr = $map[$id]
        $fields = New-Object System.Collections.Generic.List[string]
        foreach ($k in @('q', 'a', 'b', 'c')) {
            if ($tr[$k]) {
                $fields.Add(('"{0}":"{1}"' -f $k, (Escape-TrJsonString ([string]$tr[$k]))))
            }
        }
        $parts.Add(('"{0}":{{{1}}}' -f (Escape-TrJsonString ([string]$id)), ($fields -join ',')))
    }
    return '{' + ($parts -join ',') + '}'
}

function Get-TranslationPath ([string]$name) {
    return (Join-Path $script:TrDataDir "translations_$name.json")
}

function Get-UniqueQuestions {
    $questions = [ordered]@{}
    Get-ChildItem -LiteralPath $script:TrDataDir -Filter *.json | Sort-Object Name | ForEach-Object {
        if ($skipJson.ContainsKey($_.Name)) { return }
        $data = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($q in @($data.questions)) {
            $qid = [string]$q.id
            if ($qid -and -not $questions.Contains($qid)) { $questions[$qid] = $q }
        }
    }
    return ,$questions
}

function Read-TranslationMap ([string]$name) {
    $path = Get-TranslationPath $name
    if (-not (Test-Path -LiteralPath $path) -and $name -eq 'ua') {
        $path = Get-TranslationPath 'uk'
    }
    $map = [ordered]@{}
    if (-not (Test-Path -LiteralPath $path)) { return ,$map }
    $existing = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($p in $existing.PSObject.Properties) {
        $tr = [ordered]@{}
        foreach ($field in @('q', 'a', 'b', 'c')) {
            $prop = $p.Value.PSObject.Properties[$field]
            if ($prop -and $prop.Value) { $tr[$field] = [string]$prop.Value }
        }
        if ((Get-TrLen $tr) -gt 0) { $map[$p.Name] = $tr }
    }
    return ,$map
}

function Save-TranslationMap ([string]$name, $map) {
    $utf8 = New-Object System.Text.UTF8Encoding $false
    $path = Get-TranslationPath $name
    $tmp = $path + '.tmp'
    $json = ConvertTo-TrJson $map
    $last = $null
    for ($i = 0; $i -lt 8; $i++) {
        try {
            [IO.File]::WriteAllText($tmp, $json, $utf8)
            if (Test-Path -LiteralPath $path) {
                [IO.File]::Copy($tmp, $path, $true)
            } else {
                [IO.File]::Move($tmp, $path)
            }
            if (Test-Path -LiteralPath $tmp) { [IO.File]::Delete($tmp) }
            return
        } catch {
            $last = $_
            Start-Sleep -Milliseconds (250 * ($i + 1))
        }
    }
    throw $last
}

function Read-TrDotEnv ([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        $eq = $line.IndexOf("=")
        if ($eq -lt 1) { return }
        $name = $line.Substring(0, $eq).Trim()
        $value = $line.Substring($eq + 1).Trim().Trim("'").Trim('"')
        $existing = ""
        try { $existing = [string](Get-Item -Path "Env:$name" -ErrorAction Stop).Value } catch { }
        if (-not $existing.Trim()) {
            Set-Item -Path "Env:$name" $value
        }
    }
}

function Resolve-GeminiApiKey ([string]$Explicit) {
    $k = ([string]$Explicit).Trim()
    if ($k) { return $k }
    $k = ([string]$env:GEMINI_API_KEY).Trim()
    if ($k) { return $k }
    $paths = New-Object System.Collections.Generic.List[string]
    [void]$paths.Add((Join-Path $script:TrRepoRoot ".geminienv"))
    [void]$paths.Add((Join-Path (Get-Location).Path ".geminienv"))
    if ($script:TrDataDir) {
        [void]$paths.Add((Join-Path (Split-Path -Parent $script:TrDataDir) ".geminienv"))
        [void]$paths.Add((Join-Path (Split-Path -Parent (Split-Path -Parent $script:TrDataDir)) ".geminienv"))
    }
    $seen = @{}
    foreach ($path in $paths) {
        if (-not $path) { continue }
        try { $full = [IO.Path]::GetFullPath($path) } catch { continue }
        if ($seen.ContainsKey($full)) { continue }
        $seen[$full] = $true
        Read-TrDotEnv $path
        $k = ([string]$env:GEMINI_API_KEY).Trim()
        if ($k) { return $k }
    }
    return $null
}

function Protect-TrErrorMessage ([string]$msg, [string]$key) {
    $text = [string]$msg
    if ($key) { $text = $text.Replace($key, '***') }
    return [regex]::Replace($text, '(?i)(key=)[^&\s]+', '${1}***')
}

function Set-QuestionSourceFields ($q) {
    if (-not $script:TrSrc) { $script:TrSrc = New-Object 'System.Collections.Generic.Dictionary[string,string]' }
    $script:TrSrc.Clear()
    if ($null -eq $q) { return }
    $qText = ([string](Get-TrFieldValue $q 'q')).Trim()
    if ($qText) { [void]$script:TrSrc.Add('q', $qText) }
    if ([string](Get-TrFieldValue $q 'type') -ne 'specialist') { return }
    foreach ($name in @('a', 'b', 'c')) {
        $text = ([string](Get-TrFieldValue $q $name)).Trim()
        if ($text) { [void]$script:TrSrc.Add($name, $text) }
    }
}

function Get-TrWordList ([string]$text) {
    return @(@([regex]::Split(([string]$text).Trim(), '\s+') | Where-Object { $_ }))
}

function Get-TrParaCount ([string]$text) {
    return (Get-TrLen @(@([regex]::Split(([string]$text).Trim(), '\n\s*\n') | Where-Object { $_.Trim() })))
}

function Get-TrNumberedCount ([string]$text) {
    return [regex]::Matches(([string]$text), '(?m)^\s*(?:[1-9]|[12]\d)[.)]\s+\S').Count
}

function Get-TrSentCount ([string]$text) {
    return [regex]::Matches(([string]$text), '[.!?…।؟]+').Count
}

function Test-TrField ([string]$src, [string]$dst, [string]$langName) {
    $src = ([string]$src).Trim()
    $dst = ([string]$dst).Trim()
    if (-not $src) { return $null }
    if (-not $dst) { return 'empty' }
    $srcWords = @(Get-TrWordList $src)
    $dstWords = @(Get-TrWordList $dst)
    $srcN = ($srcWords -join ' ')
    $dstN = ($dstWords -join ' ')
    if ($srcN.ToLower() -eq $dstN.ToLower()) {
        # A. / B. / 70 km/h stay; Tak./Nie. and other 3+ letter words must change.
        if ([regex]::IsMatch($srcN, '\p{L}{3,}')) { return 'untranslated' }
        return $null
    }
    if ($srcN.Length -ge 24 -and $dstN.ToLower().IndexOf($srcN.ToLower()) -ge 0 -and $dstN.Length -gt ($srcN.Length + 20)) {
        return 'contains source'
    }
    $srcLen = $srcN.Length
    $dstLen = $dstN.Length
    $srcW = Get-TrLen $srcWords
    $dstW = Get-TrLen $dstWords
    if ($srcLen -ge 12) {
        if ($dstLen -gt ($srcLen * 2.4) -and $dstLen -gt ($srcLen + 50)) { return 'too long' }
        if ($dstW -gt ($srcW * 2.5) -and $dstW -gt ($srcW + 10)) { return 'too many words' }
        if ($srcLen -gt 40 -and ($dstLen * 3) -lt $srcLen) { return 'too short' }
    }
    if ((Get-TrParaCount $dst) -ge 3 -and (Get-TrParaCount $src) -le 1 -and $dstLen -gt ($srcLen + 40)) {
        return 'extra paragraphs'
    }
    if ((Get-TrNumberedCount $dst) -ge 3 -and (Get-TrNumberedCount $src) -eq 0) {
        return 'extra list'
    }
    $srcS = Get-TrSentCount $src
    $dstS = Get-TrSentCount $dst
    $needS = 4
    if (($srcS * 3) -gt $needS) { $needS = $srcS * 3 }
    if ($dstS -ge $needS -and $dstLen -gt ($srcLen + 40)) { return 'extra sentences' }
    $letters = 0
    $cyr = 0
    foreach ($ch in $dstN.ToCharArray()) {
        if (-not [regex]::IsMatch([string]$ch, '\p{L}')) { continue }
        $letters++
        if ([regex]::IsMatch([string]$ch, '\p{IsCyrillic}')) { $cyr++ }
    }
    if ($letters -gt 8) {
        $frac = $cyr / [double]$letters
        if ($langName -eq 'ua' -and $frac -lt 0.25) { return 'not Ukrainian' }
        if ($langName -in @('en', 'de') -and $frac -gt 0.25) { return 'wrong script' }
    }
    foreach ($num in [regex]::Matches($src, '\d{2,}')) {
        if ($dst.IndexOf($num.Value) -lt 0) { return ("missing number {0}" -f $num.Value) }
    }
    return $null
}

function Assert-TrTranslation ($q, $tr, [string]$langName) {
    Set-QuestionSourceFields $q
    foreach ($name in @('q', 'a', 'b', 'c')) {
        if (-not $script:TrSrc.ContainsKey($name)) { continue }
        $src = $script:TrSrc[$name]
        $dst = $null
        if ($script:TrSaved -and $script:TrSaved.ContainsKey($name)) { $dst = $script:TrSaved[$name] }
        if (-not $dst) { $dst = [string](Get-TrFieldValue $tr $name) }
        $why = Test-TrField $src ([string]$dst) $langName
        if ($why) { throw "verify: $name $why" }
    }
}

function Invoke-GoogleTranslate ([string]$text, [string]$target) {
    $url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=pl&tl=$target&dt=t&q=$([uri]::EscapeDataString($text))"
    $last = $null
    for ($attempt = 0; $attempt -lt 6; $attempt++) {
        try {
            $json = Invoke-TrHttp -Method GET -Url $url
            $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
            $ser.MaxJsonLength = 32MB
            $obj = $ser.DeserializeObject($json)
            $chunks = $obj[0]
            $sb = New-Object System.Text.StringBuilder
            foreach ($part in $chunks) {
                if ($part -and $part[0]) { [void]$sb.Append([string]$part[0]) }
            }
            $out = $sb.ToString()
            if (-not $out) { throw "empty Google Translate response" }
            return $out
        } catch {
            $last = $_
            $msg = [string]$_.Exception.Message
            if ($msg -match '429|Too Many|5\d\d') {
                Start-Sleep -Seconds ([Math]::Min(60, [Math]::Pow(2, $attempt)))
                continue
            }
            throw
        }
    }
    throw $last
}

function Get-GeminiTranslateRules ([string]$langName) {
    $label = $geminiLang[$langName]
    return @"
Translate Polish driving-licence theory exam questions into $label.
The POLISH lines are the ministry source. After each label (q: a: b: c:) write only the $label text.
Do not copy the Polish source. Repeating Polish sentences is wrong.
Keep digits, units (km/h, t, m), and lone option letters (A/B/C) unchanged.
Tak/Nie in the source is exam text — translate it.
Do not add extra options or explanations. Same meaning, similar length.
No commentary, no JSON, no markdown table.
"@
}

function Get-TrSrcLabeledLines {
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($fname in @('q', 'a', 'b', 'c')) {
        if (-not $script:TrSrc.ContainsKey($fname)) { continue }
        $lines.Add(('POLISH {0}: {1}' -f $fname, $script:TrSrc[$fname]))
    }
    return ($lines -join "`n")
}

function Get-GeminiPrompt ($q, [string]$langName) {
    Set-QuestionSourceFields $q
    $src = Get-TrSrcLabeledLines
    $rules = Get-GeminiTranslateRules $langName
    $label = $geminiLang[$langName]
    return @"
$rules

$src

Reply in ${label}:
q:
"@
}

function Get-GeminiBatchPrompt ($questions, $ids, [string]$langName) {
    $blocks = New-Object System.Collections.Generic.List[string]
    foreach ($qid in @($ids)) {
        $qid = [string]$qid
        Set-QuestionSourceFields $questions[$qid]
        $blocks.Add(('id {0}' -f $qid))
        $blocks.Add((Get-TrSrcLabeledLines))
    }
    $rules = Get-GeminiTranslateRules $langName
    $label = $geminiLang[$langName]
    $src = $blocks -join "`n"
    return @"
$rules
Several questions: before each block write id <number>, then q:/a:/b:/c: in $label.

$src
"@
}

function Set-TrSavedFromMap ($props) {
    $qval = ([string](Get-TrFieldValue $props 'q')).Trim()
    if (-not $qval) { throw "Gemini returned empty q" }
    Clear-TrLastFields
    if (-not $script:TrSaved) { $script:TrSaved = New-Object 'System.Collections.Generic.Dictionary[string,string]' }
    [void]$script:TrSaved.Add('q', $qval)
    $script:TrLastQ = $qval
    foreach ($k in @('a', 'b', 'c')) {
        $v = ([string](Get-TrFieldValue $props $k)).Trim()
        if (-not $v) { continue }
        [void]$script:TrSaved.Add($k, $v)
        if ($k -eq 'a') { $script:TrLastA = $v }
        elseif ($k -eq 'b') { $script:TrLastB = $v }
        else { $script:TrLastC = $v }
    }
    return (New-Object PSObject -Property @{
            q = $qval
            a = $(if ($script:TrSaved.ContainsKey('a')) { $script:TrSaved['a'] } else { $null })
            b = $(if ($script:TrSaved.ContainsKey('b')) { $script:TrSaved['b'] } else { $null })
            c = $(if ($script:TrSaved.ContainsKey('c')) { $script:TrSaved['c'] } else { $null })
        })
}

function Read-TrLabeledFields ([string]$text) {
    $props = New-Object 'System.Collections.Generic.Dictionary[string,string]'
    $cur = $null
    foreach ($line in [regex]::Split([string]$text, '\r?\n')) {
        $m = [regex]::Match($line.TrimEnd(), '^(?:[-*]\s+)?(q|a|b|c)\s*:\s*(.*)$', 'IgnoreCase')
        if ($m.Success) {
            $cur = $m.Groups[1].Value.ToLowerInvariant()
            $val = $m.Groups[2].Value.Trim()
            if ($props.ContainsKey($cur)) { $props[$cur] = $val } else { [void]$props.Add($cur, $val) }
            continue
        }
        if (-not $cur) { continue }
        $extra = $line.Trim()
        if (-not $extra) { continue }
        if ($props[$cur]) { $props[$cur] = $props[$cur] + ' ' + $extra } else { $props[$cur] = $extra }
    }
    foreach ($k in @('q', 'a', 'b', 'c')) {
        if (-not $props.ContainsKey($k)) { continue }
        $t = $props[$k].Trim()
        if ($t) { $props[$k] = $t } else { [void]$props.Remove($k) }
    }
    return ,$props
}

function Get-TrTextBeforeLabels ([string]$text) {
    $bits = New-Object System.Collections.Generic.List[string]
    foreach ($line in [regex]::Split([string]$text, '\r?\n')) {
        if ([regex]::IsMatch($line.TrimEnd(), '^(?:[-*]\s+)?(q|a|b|c)\s*:', 'IgnoreCase')) { break }
        $t = $line.Trim()
        if ($t) { [void]$bits.Add($t) }
    }
    if ($bits.Count -lt 1) { return '' }
    return ($bits -join ' ')
}

function Read-TrParagraphFields ([string]$text) {
    $props = New-Object 'System.Collections.Generic.Dictionary[string,string]'
    if (-not $script:TrSrc -or $script:TrSrc.Count -lt 1) { return ,$props }
    $paras = New-Object System.Collections.Generic.List[string]
    foreach ($block in [regex]::Split([string]$text, '\r?\n\s*\r?\n')) {
        $t = $block.Trim()
        if ($t) { [void]$paras.Add($t) }
    }
    $keys = New-Object System.Collections.Generic.List[string]
    foreach ($k in @('q', 'a', 'b', 'c')) {
        if ($script:TrSrc.ContainsKey($k)) { [void]$keys.Add($k) }
    }
    if ($paras.Count -ne $keys.Count -or $keys.Count -lt 1) { return ,$props }
    for ($i = 0; $i -lt $keys.Count; $i++) { [void]$props.Add($keys[$i], $paras[$i]) }
    return ,$props
}

function Read-TrMarkdownFields ([string]$text) {
    $props = New-Object 'System.Collections.Generic.Dictionary[string,string]'
    foreach ($line in [regex]::Split([string]$text, '\r?\n')) {
        $t = $line.Trim()
        if (-not $t.StartsWith('|')) { continue }
        $inner = $t.Trim('|')
        if ($inner -match '^[\s:|-]+$') { continue }
        $cells = New-Object System.Collections.Generic.List[string]
        foreach ($part in $inner.Split('|')) { [void]$cells.Add($part.Trim()) }
        $n = $cells.Count
        if ($n -lt 2) { continue }
        $key = [string]$cells[0]
        $val = [string]$cells[1]
        if ($n -ge 3 -and ([string]$cells[1]).ToLowerInvariant() -match '^[qabc]$') {
            $key = [string]$cells[1]
            $val = [string]$cells[2]
        }
        $key = $key.Trim().ToLowerInvariant()
        if ($key -notmatch '^[qabc]$') { continue }
        if (-not $val) { continue }
        if ($props.ContainsKey($key)) { $props[$key] = $val } else { [void]$props.Add($key, $val) }
    }
    return ,$props
}

function ConvertFrom-GeminiText ([string]$text) {
    $raw = $text.Trim()
    if (-not $raw) { throw "Gemini returned empty q" }
    if ($raw.StartsWith('```')) {
        $raw = [regex]::Replace($raw, '^```(?:json|markdown|md)?\s*', '')
        $raw = [regex]::Replace($raw, '\s*```$', '')
    }
    $fromLines = Read-TrLabeledFields $raw
    if ($fromLines -and -not $fromLines.ContainsKey('q')) {
        $pre = Get-TrTextBeforeLabels $raw
        if ($pre) { [void]$fromLines.Add('q', $pre) }
    }
    if ($fromLines -and $fromLines.ContainsKey('q') -and $fromLines['q']) {
        return (Set-TrSavedFromMap $fromLines)
    }
    $fromParas = Read-TrParagraphFields $raw
    if ($fromParas -and $fromParas.ContainsKey('q') -and $fromParas['q']) {
        return (Set-TrSavedFromMap $fromParas)
    }
    $fromTable = Read-TrMarkdownFields $raw
    if ($fromTable -and $fromTable.ContainsKey('q') -and $fromTable['q']) {
        return (Set-TrSavedFromMap $fromTable)
    }
    if ($raw.StartsWith('{') -or $raw.StartsWith('[')) {
        return (ConvertFrom-GeminiJsonText $raw)
    }
    $one = New-Object 'System.Collections.Generic.Dictionary[string,string]'
    [void]$one.Add('q', $raw)
    return (Set-TrSavedFromMap $one)
}

function ConvertFrom-GeminiJsonText ([string]$text) {
    $raw = $text.Trim()
    if (-not $raw) { throw "Gemini returned empty q" }
    if ($raw.StartsWith('```')) {
        $raw = [regex]::Replace($raw, '^```(?:json)?\s*', '')
        $raw = [regex]::Replace($raw, '\s*```$', '')
    }
    if (-not $raw.StartsWith('{') -and -not $raw.StartsWith('[')) {
        throw "Gemini returned empty q"
    }
    $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $ser.MaxJsonLength = 32MB
    $obj = $ser.DeserializeObject($raw)
    if ($obj -is [System.Collections.IEnumerable] -and $obj -isnot [string] -and $obj -isnot [System.Collections.IDictionary]) {
        $first = $null
        foreach ($item in $obj) { $first = $item; break }
        $obj = $first
    }
    if ($obj -isnot [System.Collections.IDictionary]) { throw "Gemini JSON is not an object" }
    $props = New-Object 'System.Collections.Generic.Dictionary[string,string]'
    foreach ($k in @('q', 'a', 'b', 'c')) {
        $val = Get-TrFieldValue $obj $k
        if ($null -ne $val -and [string]$val) { [void]$props.Add($k, ([string]$val).Trim()) }
    }
    return (Set-TrSavedFromMap $props)
}

function ConvertFrom-GeminiBatchText ([string]$text, $expectedIds) {
    $raw = $text.Trim()
    if (-not $raw) { throw "Gemini returned empty q" }
    if ($raw.StartsWith('```')) {
        $raw = [regex]::Replace($raw, '^```(?:json)?\s*', '')
        $raw = [regex]::Replace($raw, '\s*```$', '')
    }
    if (-not $raw.StartsWith('{') -and -not $raw.StartsWith('[')) {
        $brace = [regex]::Match($raw, '\{[\s\S]*\}')
        if ($brace.Success) { $raw = $brace.Value }
    }
    $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $ser.MaxJsonLength = 32MB
    $obj = $ser.DeserializeObject($raw)
    if ($obj -is [System.Collections.IEnumerable] -and $obj -isnot [string] -and $obj -isnot [System.Collections.IDictionary]) {
        $first = $null
        foreach ($item in $obj) { $first = $item; break }
        $obj = $first
    }
    if ($obj -isnot [System.Collections.IDictionary]) { throw "Gemini JSON is not an object" }
    $ids = New-Object System.Collections.Generic.List[string]
    foreach ($qid in @($expectedIds)) {
        $s = [string]$qid
        if ($s) { [void]$ids.Add($s) }
    }
    $hasIdKey = $false
    foreach ($qid in $ids) {
        if ($null -ne (Get-TrFieldValue $obj $qid)) { $hasIdKey = $true; break }
    }
    $map = @{}
    if (-not $hasIdKey -and (Get-TrLen $ids) -eq 1) {
        $one = ConvertFrom-GeminiJsonText $raw
        $map[$ids[0]] = $one
        $script:TrLastBatch = $map
        return
    }
    foreach ($qid in $ids) {
        $inner = Get-TrFieldValue $obj $qid
        if ($null -eq $inner) { continue }
        $props = @{}
        foreach ($k in @('q', 'a', 'b', 'c')) {
            $val = Get-TrFieldValue $inner $k
            if ($null -ne $val -and [string]$val) { $props[$k] = ([string]$val).Trim() }
        }
        if ($props.ContainsKey('q') -and $props['q']) {
            $map[$qid] = New-Object PSObject -Property $props
        }
    }
    if ((Get-TrLen $map) -eq 0) { throw "Gemini returned empty q" }
    $script:TrLastBatch = $map
}

function Get-TrFieldValue ($obj, [string]$name) {
    if ($null -eq $obj -or -not $name) { return $null }
    if ($obj -is [string]) {
        if ($name -eq 'q') { return $obj }
        return $null
    }
    if ($obj -is [System.Collections.DictionaryEntry]) {
        if ([string]$obj.Key -eq $name) { return $obj.Value }
        return $null
    }
    if ($obj -is [System.Collections.IDictionary]) {
        foreach ($k in @($obj.Keys)) {
            if ([string]$k -eq $name) { return $obj[$k] }
        }
        return $null
    }
    $prop = $obj.PSObject.Properties[$name]
    if ($prop) { return $prop.Value }
    return $null
}

function Get-TrSnippet ([string]$text) {
    $t = [regex]::Replace(([string]$text).Trim(), '\s+', ' ')
    if ($t.Length -gt 120) { $t = $t.Substring(0, 117) + '...' }
    return $t
}

function Get-GeminiFailHint ($obj, [string]$text) {
    $bits = New-Object System.Collections.Generic.List[string]
    if ($obj -is [System.Collections.IDictionary]) {
        $cands = $obj["candidates"]
        $first = $null
        if ($cands -is [System.Collections.IDictionary]) { $first = $cands }
        else { foreach ($item in @($cands)) { $first = $item; break } }
        if ($first -is [System.Collections.IDictionary] -and $first["finishReason"]) {
            $bits.Add('finishReason=' + [string]$first["finishReason"])
        }
        $fb = $obj["promptFeedback"]
        if ($fb -is [System.Collections.IDictionary] -and $fb["blockReason"]) {
            $bits.Add('block=' + [string]$fb["blockReason"])
        }
    }
    $snip = Get-TrSnippet $text
    if ($snip) { $bits.Add('text=' + $snip) }
    if ((Get-TrLen $bits) -eq 0) { return '' }
    return ' (' + ($bits -join '; ') + ')'
}

function Add-TrModelName ($list, $item) {
    if ($null -eq $item) { return }
    if ($item -is [string]) {
        $name = $item.Trim()
        if ($name -match '^[A-Za-z0-9._-]+$' -and -not $list.Contains($name)) { [void]$list.Add($name) }
        return
    }
    if ($item -is [System.Collections.IEnumerable]) {
        foreach ($inner in $item) { Add-TrModelName $list $inner }
    }
}

function Add-TrGeminiDead ([string]$model) {
    if (-not $model) { return }
    if (-not $script:TrGeminiDead) { $script:TrGeminiDead = New-Object System.Collections.Generic.List[string] }
    if (-not $script:TrGeminiDead.Contains($model)) { [void]$script:TrGeminiDead.Add($model) }
}

function Get-TrGeminiTryOrder ([string]$apiKey) {
    $list = New-Object System.Collections.Generic.List[string]
    Add-TrModelName $list $script:TrGeminiModel
    Add-TrModelName $list (Get-GeminiFlashModelIds $apiKey)
    if (-not $script:TrGeminiDead -or (Get-TrLen $script:TrGeminiDead) -eq 0) { return ,$list }
    $alive = New-Object System.Collections.Generic.List[string]
    foreach ($m in $list) {
        if (-not $script:TrGeminiDead.Contains([string]$m)) { Add-TrModelName $alive $m }
    }
    return ,$alive
}

function Get-GeminiCandidateText ($obj) {
    if ($null -eq $obj -or $obj -isnot [System.Collections.IDictionary]) { return "" }
    $cands = $obj["candidates"]
    $first = $null
    if ($cands -is [System.Collections.IDictionary]) { $first = $cands }
    else {
        foreach ($item in @($cands)) { $first = $item; break }
    }
    if ($null -eq $first) { return "" }
    $content = $null
    if ($first -is [System.Collections.IDictionary]) { $content = $first["content"] }
    else { $content = Get-TrFieldValue $first "content" }
    if ($content -is [string]) { return $content }
    $parts = $null
    if ($content -is [System.Collections.IDictionary]) { $parts = $content["parts"] }
    elseif ($content) { $parts = Get-TrFieldValue $content "parts" }
    $sb = New-Object System.Text.StringBuilder
    if ($parts -is [string]) { [void]$sb.Append($parts) }
    elseif ($parts -is [System.Collections.IDictionary]) {
        $t = $parts["text"]
        if ($t) { [void]$sb.Append([string]$t) }
    }
    else {
        foreach ($part in @($parts)) {
            if ($null -eq $part) { continue }
            if ($part -is [string]) { [void]$sb.Append($part); continue }
            $t = $null
            if ($part -is [System.Collections.IDictionary]) { $t = $part["text"] }
            else { $t = Get-TrFieldValue $part "text" }
            if ($t) { [void]$sb.Append([string]$t) }
        }
    }
    return $sb.ToString()
}

function Write-TrProgress ([string]$Status, [int]$Percent) {
    if ($Percent -lt 0) { $Percent = 0 }
    if ($Percent -gt 100) { $Percent = 100 }
    Write-Progress -Activity "Translate questions" -Status $Status -PercentComplete $Percent
}

function Complete-TrProgress {
    Write-Progress -Activity "Translate questions" -Completed
}

# WebClient.UploadString has no timeout and can hang for minutes. HttpWebRequest
# Timeout/ReadWriteTimeout abort a dead generateContent so the next Flash model
# can be tried (same as 404). Do not skip the question on the first timeout:
# 3.8 Flash often needs longer than Lite.
function Invoke-TrHttp {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][string]$Url,
        [string]$Body,
        [string]$ApiKey
    )
    $req = [Net.HttpWebRequest]::Create($Url)
    $req.Method = $Method
    $req.Timeout = 30000
    $req.ReadWriteTimeout = 30000
    $req.KeepAlive = $false
    $req.ProtocolVersion = [Net.HttpVersion]::Version11
    if ($req.ServicePoint) { $req.ServicePoint.Expect100Continue = $false }
    $req.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
    $req.UserAgent = "Mozilla/5.0 Prawko"
    if ($ApiKey) { $req.Headers.Add("x-goog-api-key", $ApiKey) }
    try {
        if ($Method -eq 'POST') {
            $req.ContentType = "application/json; charset=utf-8"
            $bytes = [Text.Encoding]::UTF8.GetBytes($Body)
            $req.ContentLength = $bytes.Length
            $stream = $req.GetRequestStream()
            try {
                $stream.Write($bytes, 0, $bytes.Length)
            } finally {
                $stream.Close()
            }
        }
        $resp = $req.GetResponse()
        try {
            $reader = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
            try {
                return $reader.ReadToEnd()
            } finally {
                $reader.Close()
            }
        } finally {
            $resp.Close()
        }
    } catch [Net.WebException] {
        $ex = $_.Exception
        try { $req.Abort() } catch { }
        if ($ex.Status -eq [Net.WebExceptionStatus]::Timeout) {
            throw (New-Object System.Exception "timeout 30s")
        }
        $httpResp = $ex.Response
        if ($httpResp) {
            $code = [int]$httpResp.StatusCode
            $errBody = ""
            try {
                $errReader = New-Object IO.StreamReader($httpResp.GetResponseStream())
                $errBody = $errReader.ReadToEnd()
                $errReader.Close()
            } catch { }
            try { $httpResp.Close() } catch { }
            throw (New-Object System.Exception ("HTTP {0} {1}" -f $code, $errBody))
        }
        throw (New-Object System.Exception ("connection closed ({0})" -f $ex.Status))
    }
}

function Get-TrGeminiVersion ([string]$name) {
    $m = [regex]::Match([string]$name, '(\d+)\.(\d+)')
    if (-not $m.Success) { return 0 }
    return (([int]$m.Groups[1].Value) * 1000) + [int]$m.Groups[2].Value
}

function Get-GeminiGenerateUrl ([string]$model) {
    if ($model -notmatch '^[A-Za-z0-9._-]+$') { throw "unexpected model name format" }
    return "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent"
}

function Get-GeminiModelsListUrl ([string]$pageToken) {
    $url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100"
    if ($pageToken) { $url = $url + "&pageToken=" + [uri]::EscapeDataString($pageToken) }
    return $url
}

function Test-TrGeminiFlashModel ([string]$id, $methods) {
    $hasGen = $false
    foreach ($m in @($methods)) {
        if ([string]$m -eq 'generateContent') { $hasGen = $true; break }
    }
    if (-not $hasGen) { return $false }
    $low = $id.ToLowerInvariant()
    if ($low.IndexOf('flash') -lt 0) { return $false }
    foreach ($part in $geminiSkipSub) {
        if ($low.IndexOf($part) -ge 0) { return $false }
    }
    return $true
}

function Get-TrGeminiModelId ($item) {
    $name = [string](Get-TrFieldValue $item 'name')
    if (-not $name) { $name = [string]$item }
    $name = $name.Trim()
    if ($name.StartsWith('models/')) { $name = $name.Substring(7) }
    return $name
}

function Get-GeminiFlashModelIds ([string]$apiKey) {
    if ($script:TrGeminiModels) { return ,$script:TrGeminiModels }
    $found = New-Object System.Collections.Generic.List[string]
    $token = $null
    try {
        for ($page = 0; $page -lt 20; $page++) {
            $json = Invoke-TrHttp -Method GET -Url (Get-GeminiModelsListUrl $token) -ApiKey $apiKey
            $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
            $ser.MaxJsonLength = 32MB
            $obj = $ser.DeserializeObject($json)
            $models = $null
            if ($obj -is [System.Collections.IDictionary]) { $models = $obj["models"] }
            foreach ($item in @($models)) {
                $mid = Get-TrGeminiModelId $item
                $methods = Get-TrFieldValue $item 'supportedGenerationMethods'
                if (Test-TrGeminiFlashModel $mid $methods) { Add-TrModelName $found $mid }
            }
            $token = $null
            if ($obj -is [System.Collections.IDictionary]) { $token = [string]$obj["nextPageToken"] }
            if (-not $token) { break }
        }
    } catch {
        $msg = Protect-TrErrorMessage ([string]$_.Exception.Message) $apiKey
        if ($msg -match '401|403|API_KEY|PERMISSION_DENIED|UNAUTHENTICATED') {
            throw (New-Object System.Exception $msg)
        }
        Write-Host ("  Gemini model list failed: {0}" -f $msg) -ForegroundColor DarkYellow
        $found.Clear()
    }
    $sorted = @($found | Sort-Object @{ Expression = { if ($_.ToLowerInvariant().IndexOf('lite') -ge 0) { 0 } else { 1 } } }, @{ Expression = { -(Get-TrGeminiVersion $_) } }, @{ Expression = { $_.ToLowerInvariant() } })
    $ranked = New-Object System.Collections.Generic.List[string]
    foreach ($m in $sorted) { Add-TrModelName $ranked $m }
    if ((Get-TrLen $ranked) -eq 0) {
        foreach ($m in $geminiModels) { Add-TrModelName $ranked $m }
    }
    $script:TrGeminiModels = $ranked
    Write-Host ("Gemini models: {0}" -f ($ranked -join ', ')) -ForegroundColor Cyan
    return ,$ranked
}

function Clear-TrLastFields {
    $script:TrLastQ = $null
    $script:TrLastA = $null
    $script:TrLastB = $null
    $script:TrLastC = $null
    if ($script:TrSaved) { $script:TrSaved.Clear() }
}

function Set-TrLastFields ($obj) {
    Clear-TrLastFields
    $qval = Get-TrFieldValue $obj 'q'
    if ($null -eq $qval -or -not [string]$qval) { return }
    $script:TrLastQ = ([string]$qval).Trim()
    $aval = Get-TrFieldValue $obj 'a'
    if ($null -ne $aval -and [string]$aval) { $script:TrLastA = ([string]$aval).Trim() }
    $bval = Get-TrFieldValue $obj 'b'
    if ($null -ne $bval -and [string]$bval) { $script:TrLastB = ([string]$bval).Trim() }
    $cval = Get-TrFieldValue $obj 'c'
    if ($null -ne $cval -and [string]$cval) { $script:TrLastC = ([string]$cval).Trim() }
}

function Get-TrLastField ([string]$name) {
    if ($name -eq 'q') { return $script:TrLastQ }
    if ($name -eq 'a') { return $script:TrLastA }
    if ($name -eq 'b') { return $script:TrLastB }
    if ($name -eq 'c') { return $script:TrLastC }
    return $null
}

function Apply-TrQuestionFields ($existing, [string]$qid, $q, $tr) {
    $gotQ = $null
    if ($script:TrSaved -and $script:TrSaved.ContainsKey('q')) { $gotQ = $script:TrSaved['q'] }
    if (-not $gotQ) { $gotQ = [string]$script:TrLastQ }
    if (-not $gotQ) { $gotQ = [string](Get-TrFieldValue $tr 'q') }
    if (-not $gotQ) { return $false }
    if (-not $existing.Contains($qid)) { $existing[$qid] = [ordered]@{} }
    $existing[$qid]['q'] = ([string]$gotQ).Trim()
    foreach ($k in @('a', 'b', 'c')) {
        $val = $null
        if ($script:TrSaved -and $script:TrSaved.ContainsKey($k)) { $val = $script:TrSaved[$k] }
        if (-not $val) { $val = Get-TrLastField $k }
        if ($val) { $existing[$qid][$k] = ([string]$val).Trim() }
    }
    return $true
}

function Invoke-GeminiTranslateIds ($questions, $ids, [string]$langName, [string]$apiKey) {
    $script:TrLastMap = $null
    $script:TrLastBatch = @{}
    Clear-TrLastFields
    $idArr = New-Object System.Collections.Generic.List[string]
    foreach ($qid in @($ids)) {
        $s = [string]$qid
        if ($s) { [void]$idArr.Add($s) }
    }
    $n = Get-TrLen $idArr
    if ($n -lt 1) { throw "Gemini returned empty q" }
    if ($n -eq 1) {
        $prompt = Get-GeminiPrompt $questions[$idArr[0]] $langName
    } else {
        $prompt = Get-GeminiBatchPrompt $questions $idArr $langName
    }
    $body = '{"contents":[{"parts":[{"text":"' + (Escape-TrJsonString $prompt) + '"}]}]}'
    $models = Get-TrGeminiTryOrder $apiKey
    if ((Get-TrLen $models) -eq 0) { throw "Gemini models 404" }
    $last = $null
    $mi = 0
    $modelCount = Get-TrLen $models
    foreach ($model in $models) {
        $model = [string]$model
        if ($model -notmatch '^[A-Za-z0-9._-]+$') { continue }
        $mi++
        $url = Get-GeminiGenerateUrl $model
        $tryNext = $false
        for ($attempt = 0; $attempt -lt 6; $attempt++) {
            try {
                $json = Invoke-TrHttp -Method POST -Url $url -Body $body -ApiKey $apiKey
                $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
                $ser.MaxJsonLength = 32MB
                $obj = $ser.DeserializeObject($json)
                $text = Get-GeminiCandidateText $obj
                $parsed = ConvertFrom-GeminiText $text
                if (-not $script:TrSaved -or -not $script:TrSaved.ContainsKey('q')) { throw "Gemini returned empty q" }
                if (-not $script:TrSkipVerifyAi) { Assert-TrTranslation $questions[$idArr[0]] $parsed $langName }
                if ($script:TrGeminiModel -ne $model) {
                    $script:TrGeminiModel = $model
                    Write-Host ("Gemini model: {0}" -f $model) -ForegroundColor Cyan
                }
                return
            } catch {
                $last = $_
                $msg = Protect-TrErrorMessage ([string]$_.Exception.Message) $apiKey
                Clear-TrLastFields
                if ($msg -match '404|Nie znaleziono|Not Found|unexpected model name format') {
                    Add-TrGeminiDead $model
                    Write-Host ("  Gemini model {0}: 404, trying next" -f $model) -ForegroundColor DarkYellow
                    $tryNext = $true
                    break
                }
                if ($msg -match 'timeout|timed out') {
                    Write-Host ("  Gemini model {0}: timeout, trying next" -f $model) -ForegroundColor DarkYellow
                    $tryNext = $true
                    break
                }
                if ($msg -match 'connection closed|przerwane|KeepAlive|zakończone|GetResponse') {
                    if ($attempt -lt 1) {
                        Write-Host ("  Gemini model {0}: connection closed, retry" -f $model) -ForegroundColor DarkYellow
                        Start-Sleep -Milliseconds 400
                        continue
                    }
                    Write-Host ("  Gemini model {0}: connection closed, trying next" -f $model) -ForegroundColor DarkYellow
                    $tryNext = $true
                    break
                }
                if ($msg -match 'empty q|not an object|property ''Count''|Invalid JSON') {
                    Write-Host ("  Gemini model {0}: bad response, trying next" -f $model) -ForegroundColor DarkYellow
                    $tryNext = $true
                    break
                }
                if ($msg -match 'verify:') {
                    Write-Host ("  Gemini model {0}: {1}, skip question" -f $model, $msg) -ForegroundColor DarkYellow
                    throw (New-Object System.Exception $msg)
                }
                if ($msg -match '429|Too Many|RESOURCE_EXHAUSTED|5\d\d') {
                    Start-Sleep -Seconds ([Math]::Min(60, [Math]::Pow(2, $attempt)))
                    continue
                }
                throw (New-Object System.Exception $msg)
            }
        }
        if (-not $tryNext -and $last) { break }
    }
    throw (New-Object System.Exception (Protect-TrErrorMessage ([string]$last) $apiKey))
}

function Invoke-GeminiTranslateQuestion ($q, [string]$langName, [string]$apiKey) {
    $qid = [string](Get-TrFieldValue $q 'id')
    if (-not $qid) { $qid = 'q' }
    $wrap = @{ $qid = $q }
    Invoke-GeminiTranslateIds $wrap @($qid) $langName $apiKey
}

function Fill-MissingQuestionTranslations {
    param(
        [string]$DataDir,
        [string[]]$Lang,
        [string]$GeminiApiKey,
        [switch]$SkipVerifyAi
    )
    if ($DataDir) { $script:TrDataDir = $DataDir }
    if ($PSBoundParameters.ContainsKey('GeminiApiKey')) { $script:TrGeminiApiKey = $GeminiApiKey }
    if ($PSBoundParameters.ContainsKey('SkipVerifyAi')) { $script:TrSkipVerifyAi = [bool]$SkipVerifyAi }
    $apiKey = Resolve-GeminiApiKey $script:TrGeminiApiKey
    $script:TrGeminiModel = $null
    $script:TrGeminiModels = $null
    $script:TrGeminiDead = New-Object System.Collections.Generic.List[string]
    $script:TrLastMap = $null
    $script:TrLastBatch = $null
    if ($apiKey) { [void](Get-GeminiFlashModelIds $apiKey) }
    if (-not (Test-Path -LiteralPath $script:TrDataDir)) { throw "Missing $($script:TrDataDir)" }
    $questions = Get-UniqueQuestions
    if ((Get-TrLen $questions) -eq 0) { throw "No category JSON in $($script:TrDataDir)." }

    $langs = @($Lang | Where-Object { $_ })
    if ((Get-TrLen $langs) -eq 1 -and $langs[0] -match ',') {
        $langs = @($langs[0].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }
    if ((Get-TrLen $langs) -eq 0) { $langs = @('en', 'de', 'ua') }
    foreach ($name in $langs) {
        if (-not $googleLang.ContainsKey($name)) { throw "Unknown -Lang $name (use en, de, ua)." }
    }

    foreach ($name in $langs) {
    $existing = Read-TranslationMap $name
    $target = $googleLang[$name]
    $missing = New-Object System.Collections.Generic.List[string]
    foreach ($qid in @($questions.Keys)) {
        if ($existing.Contains($qid) -and $existing[$qid]['q']) { continue }
        Set-QuestionSourceFields $questions[$qid]
        if ($script:TrSrc.Count -gt 0) { $missing.Add($qid) }
    }
    $engine = if ($apiKey) { "Gemini" } else { "Google Translate" }
    Write-Host ("{0}: {1} unique, {2} already filled, {3} questions to translate ({4})" -f $name, (Get-TrLen $questions), (Get-TrLen $existing), (Get-TrLen $missing), $engine) -ForegroundColor Cyan
    if ((Get-TrLen $missing) -eq 0) {
        Save-TranslationMap $name $existing
        continue
    }
    $done = 0
    $missN = Get-TrLen $missing
    try {
    $pos = 0
    while ($pos -lt $missN) {
        $pct = if ($missN -lt 1) { 100 } else { [int][Math]::Min(99, [Math]::Floor(100.0 * $done / $missN)) }
        $engineNow = if ($apiKey) { "Gemini" } else { "Google Translate" }
        Write-TrProgress ("{0}  {1} / {2}  {3}" -f $name, $done, $missN, $engineNow) $pct
        $take = [Math]::Min($geminiBatchSize, $missN - $pos)
        if (-not $apiKey) { $take = 1 }
        $chunk = New-Object System.Collections.Generic.List[string]
        for ($k = 0; $k -lt $take; $k++) { [void]$chunk.Add([string]$missing[$pos + $k]) }
        $pos += $take
        if ($apiKey) {
            $batchOk = $false
            $batchErr = $null
            try {
                $script:TrLastBatch = $null
                Invoke-GeminiTranslateIds $questions $chunk $name $apiKey
                $batchOk = $true
            } catch {
                $emsg = Protect-TrErrorMessage $_.Exception.Message $apiKey
                if ($emsg -match '401|403|API_KEY|PERMISSION_DENIED|UNAUTHENTICATED') {
                    Write-Host ("  Gemini fail {0}: {1}" -f ($chunk -join ','), $emsg) -ForegroundColor DarkYellow
                    Save-TranslationMap $name $existing
                    throw "Gemini failed; progress saved. Re-run without a key to use Google Translate."
                }
                $batchErr = $emsg
                $script:TrLastBatch = $null
            }
            foreach ($qid in $chunk) {
                $q = $questions[$qid]
                if ($batchOk -and (Apply-TrQuestionFields $existing $qid $q $null)) {
                    continue
                }
                if (-not $batchOk) {
                    $why = if ($batchErr) { $batchErr } else { 'batch failed' }
                    Write-Host ("  skip {0}: {1}" -f $qid, $why) -ForegroundColor DarkYellow
                    continue
                }
                Write-Host ("  skip {0}: Gemini returned empty q" -f $qid) -ForegroundColor DarkYellow
            }
        } else {
            foreach ($qid in $chunk) {
                $q = $questions[$qid]
                Set-QuestionSourceFields $q
                if (-not $existing.Contains($qid)) { $existing[$qid] = [ordered]@{} }
                foreach ($fname in @('q', 'a', 'b', 'c')) {
                    if (-not $script:TrSrc.ContainsKey($fname)) { continue }
                    if ($existing[$qid][$fname]) { continue }
                    $srcText = $script:TrSrc[$fname]
                    try {
                        $out = Invoke-GoogleTranslate $srcText $target
                        if (-not $script:TrSkipVerifyAi) {
                            $why = Test-TrField $srcText $out $name
                            if ($why) { throw "verify: $why" }
                        }
                        $existing[$qid][$fname] = $out
                    } catch {
                        Write-Host ("  skip {0}.{1}: {2}" -f $qid, $fname, $_.Exception.Message) -ForegroundColor DarkYellow
                    }
                }
            }
        }
        $done += $take
        if (($done % $saveEvery) -eq 0) { Save-TranslationMap $name $existing }
        if ($apiKey) { Start-Sleep -Seconds $geminiDelaySec } else { Start-Sleep -Seconds $delaySec }
    }
    Save-TranslationMap $name $existing
    Write-TrProgress ("{0}  {1} / {1}  done" -f $name, (Get-TrLen $missing)) 100
    Write-Host ("Wrote {0} ({1} questions)." -f (Get-TranslationPath $name), (Get-TrLen $existing)) -ForegroundColor Green
    } finally {
        Complete-TrProgress
    }
    }
}

if ($LibraryOnly) { return }

Fill-MissingQuestionTranslations -DataDir $script:TrDataDir -Lang $Lang -GeminiApiKey $GeminiApiKey -SkipVerifyAi:$SkipVerifyAi
