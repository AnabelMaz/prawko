const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function listPs1Files(dir = ROOT, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listPs1Files(full, acc);
    else if (entry.name.endsWith('.ps1')) acc.push(full);
  }
  return acc;
}

function hasBom(buf) {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

test('PowerShell scripts keep a UTF-8 BOM so Windows PowerShell 5.1 can parse them', () => {
  const files = listPs1Files();
  expect(files.length).toBeGreaterThan(0);
  const missing = files
    .filter((file) => !hasBom(fs.readFileSync(file)))
    .map((file) => path.relative(ROOT, file).replace(/\\/g, '/'));
  expect(missing).toEqual([]);
});

test('macOS/Linux pipeline scripts are Python, not Node or bash twins', () => {
  const scriptsDir = path.join(ROOT, 'scripts');
  const scripts = fs.readdirSync(scriptsDir);
  const requiredPy = [
    'download-gov.py',
    'parse-excel.py',
    'translate-questions.py',
    'convert-media.py',
    'filter-no-media.py',
    'merge-gov.py',
    'upload-media.py',
    'build-media-packs.py',
    'upload-packs.py',
  ];
  for (const name of requiredPy) {
    expect(scripts).toContain(name);
  }
  expect(scripts.filter((name) => name.endsWith('.sh'))).toEqual([]);
  expect(scripts.filter((name) => name.endsWith('.js'))).toEqual([]);

  const macos = fs.readFileSync(path.join(ROOT, 'Install_Prawko.macos.sh'), 'utf8');
  const linux = fs.readFileSync(path.join(ROOT, 'Install_Prawko.linux.sh'), 'utf8');
  const windows = fs.readFileSync(path.join(ROOT, 'Install_Prawko.windows.ps1'), 'utf8');
  for (const text of [macos, linux]) {
    expect(text).not.toMatch(/merge-gov\.js/);
    expect(text).not.toMatch(/download-gov\.sh/);
    expect(text).not.toMatch(/convert-media\.sh/);
    expect(text).toMatch(/run_pipeline download-gov\.py/);
    expect(text).toMatch(/merge-gov\.py/);
    expect(text).toMatch(/python3 "\$path"/);
  }
  expect(linux).not.toMatch(/node -p /);
  expect(windows).not.toMatch(/python3 /);
  expect(windows).not.toMatch(/merge-gov\.js/);
  expect(windows).toMatch(/merge-gov\.ps1/);
  expect(windows).not.toMatch(/function Merge-GovExcelIntoDataFiles/);
  expect(windows).toMatch(/&\s*robocopy\.exe/);
  expect(windows).not.toMatch(/Start-Process -FilePath "robocopy\.exe"/);
  expect(windows).toMatch(/Get-RobocopyCopyPlan/);
  expect(windows).toMatch(/ConvertTo-RobocopyDestFile/);
  expect(windows).toMatch(/OrigWriteTimeUtc/);
  expect(windows).toMatch(/Write-Progress -Activity \$activity -Status \$status/);
  expect(windows).not.toMatch(/counting files/);
  expect(windows).not.toMatch(/will copy \{0\} files/);
  expect(windows).not.toMatch(/already on destination, skipping/);
  expect(scripts).toContain('merge-gov.ps1');
  expect(scripts).toContain('translate-questions.ps1');
});

test('ministry Excel and ZIPs live in server gov-cache; unpack is TEMP; scripts abort instead of spilling into the repo', () => {
  const downloadPs1 = fs.readFileSync(path.join(ROOT, 'scripts', 'download-gov.ps1'), 'utf8');
  expect(downloadPs1).not.toMatch(/Get-GovDataOverflowRoot/);
  expect(downloadPs1).not.toMatch(/Resolve-GovStagingDir/);
  expect(downloadPs1).toMatch(/function Assert-GovDiskSpace/);
  expect(downloadPs1).toMatch(/Join-Path \(Get-PrawkoServerRoot\) "gov-cache"/);
  expect(downloadPs1).toMatch(/function Expand-GovMediaZipsToTemp/);
  expect(downloadPs1).toMatch(/GetTempPath\(\)\) "prawko\\raw"/);
  const parsePs1 = fs.readFileSync(path.join(ROOT, 'scripts', 'parse-excel.ps1'), 'utf8');
  expect(parsePs1).toMatch(/Join-Path \(Get-GovDataDir\) "baza_pytan\.xlsx"/);
  expect(parsePs1).not.toMatch(/Join-Path \$repoRoot "gov-data\\baza_pytan\.xlsx"/);
  const downloadPy = fs.readFileSync(path.join(ROOT, 'scripts', 'download-gov.py'), 'utf8');
  expect(downloadPy).not.toMatch(/def overflow_root/);
  expect(downloadPy).toMatch(/def assert_disk_space/);
  expect(downloadPy).toMatch(/return server_root\(\) \/ "gov-cache"/);
  expect(downloadPy).toMatch(/def expand_gov_media_zips_to_temp/);
  const parsePy = fs.readFileSync(path.join(ROOT, 'scripts', 'parse-excel.py'), 'utf8');
  expect(parsePy).toMatch(/gov_data_dir\(\) \/ "baza_pytan\.xlsx"/);
  expect(parsePy).not.toMatch(/default="gov-data\/baza_pytan\.xlsx"/);
  const windows = fs.readFileSync(path.join(ROOT, 'Install_Prawko.windows.ps1'), 'utf8');
  expect(windows).not.toMatch(/Get-GovDataOverflowRoot/);
  expect(windows).toMatch(/keeping gov-cache/);
  expect(windows).toMatch(/Join-Path \$targetDir "gov-cache"/);
  expect(windows).toMatch(/prawko\\gov-json/);
  const linux = fs.readFileSync(path.join(ROOT, 'Install_Prawko.linux.sh'), 'utf8');
  const macos = fs.readFileSync(path.join(ROOT, 'Install_Prawko.macos.sh'), 'utf8');
  expect(linux).toMatch(/TARGET_DIR\/gov-cache/);
  expect(macos).toMatch(/TARGET_DIR\/gov-cache/);
  expect(linux).not.toMatch(/\$GOV_DATA\/raw/);
  expect(macos).not.toMatch(/\$GOV_DATA\/raw/);
  expect(linux).toMatch(/prawko-gov-json/);
  expect(macos).toMatch(/prawko-gov-json/);
  expect(linux).toMatch(/--keep-raw/);
  expect(macos).toMatch(/--keep-raw/);
  const convertPy = fs.readFileSync(path.join(ROOT, 'scripts', 'convert-media.py'), 'utf8');
  expect(convertPy).toMatch(/--keep-raw/);
  expect(convertPy).toMatch(/dg\.remove_gov_raw_temp\(\)/);
  expect(fs.existsSync(path.join(ROOT, 'src', 'data', 'translations_ua.json'))).toBe(true);
  expect(fs.existsSync(path.join(ROOT, 'src', 'data', 'translations_uk.json'))).toBe(false);
  const i18n = fs.readFileSync(path.join(ROOT, 'src', 'js', 'i18n.js'), 'utf8');
  expect(i18n).toMatch(/LANG_CYCLE = \['pl', 'en', 'de', 'ua'\]/);
  expect(i18n).toMatch(/translations_ua\.json/);
  expect(i18n).not.toMatch(/translations_uk\.json/);
  const parsePs1Ua = fs.readFileSync(path.join(ROOT, 'scripts', 'parse-excel.ps1'), 'utf8');
  expect(parsePs1Ua).toMatch(/translations_ua\.json/);
  expect(parsePs1Ua).toMatch(/function Merge-ExistingQuestionTranslations/);
  expect(parsePs1Ua).toMatch(/SkipTranslateGaps/);
  expect(parsePs1Ua).toMatch(/Fill-MissingQuestionTranslations/);
  const translatePs1 = fs.readFileSync(path.join(ROOT, 'scripts', 'translate-questions.ps1'), 'utf8');
  expect(translatePs1).toMatch(/LibraryOnly/);
  expect(translatePs1).toMatch(/function Fill-MissingQuestionTranslations/);
  expect(translatePs1).toMatch(/GeminiApiKey/);
  expect(translatePs1).toMatch(/Gemini failed; progress saved/);
  expect(translatePs1).not.toMatch(/Read-Host/);
  expect(translatePs1).toMatch(/v1beta\/models/);
  expect(translatePs1).not.toMatch(/googleapis\.com\/v1\/models/);
  expect(translatePs1).toMatch(/Write-Progress/);
  expect(translatePs1).toMatch(/function Write-TrProgress/);
  expect(translatePs1).not.toMatch(/Write-TrProgress \(\"Trying/);
  expect(translatePs1).toMatch(/WriteAllText\(\$tmp/);
  expect(translatePs1).toMatch(/preview\|experimental\|beta\|latest/);
  expect(translatePs1).toMatch(/function Get-GeminiFlashModelIds/);
  expect(translatePs1).toMatch(/function Test-TrGeminiFlashModel/);
  expect(translatePs1).toMatch(/pageSize=100/);
  expect(translatePs1).toMatch(/nextPageToken/);
  expect(translatePs1).not.toMatch(/Do not list \/v1beta\/models/);
  expect(translatePs1).toMatch(/Timeout = 30000/);
  expect(translatePs1).toMatch(/ReadWriteTimeout = 30000/);
  expect(translatePs1).toMatch(/timeout 30s/);
  expect(translatePs1).not.toMatch(/timeout 15s/);
  expect(translatePs1).toMatch(/timeout, trying next/);
  expect(translatePs1).not.toMatch(/timeout, skip question/);
  expect(translatePs1).toMatch(/function Set-QuestionSourceFields/);
  expect(translatePs1).toMatch(/\$script:TrSrc/);
  expect(translatePs1).not.toMatch(/function Get-QuestionFields/);
  expect(translatePs1).not.toMatch(/System\.Object\[\]/);
  expect(translatePs1).not.toMatch(/foreach \(\$item in @\(\$obj\)\)/);
  expect(translatePs1).not.toMatch(/Get-TrFieldValue \$item 'Field'/);
  expect(translatePs1).not.toMatch(/\$fields = @\(Get-QuestionFields/);
  expect(translatePs1).not.toMatch(/if \(\$script:TrSaved -and \$script:TrSaved.ContainsKey\('q'\)\) \{ return \}/);
  expect(translatePs1).not.toMatch(/Invoke-GeminiTranslateQuestion \$q/);
  expect(translatePs1).toMatch(/function Get-GeminiCandidateText/);
  expect(translatePs1).not.toMatch(/\$cands\.Count/);
  expect(translatePs1).toMatch(/bad response, trying next/);
  expect(translatePs1).toMatch(/function Test-TrField/);
  expect(translatePs1).toMatch(/\\p\{L\}\{3,\}/);
  expect(translatePs1).not.toMatch(/\\p\{L\}\{4,\}/);
  expect(translatePs1).toMatch(/function Get-TrLen/);
  expect(translatePs1).toMatch(/function Get-TrGeminiTryOrder/);
  expect(translatePs1).toMatch(/function Add-TrModelName/);
  expect(translatePs1).toMatch(/unexpected model name format/);
  expect(translatePs1).not.toMatch(/list\.ToArray/);
  expect(translatePs1).toMatch(/finishReason=/);
  expect(translatePs1).toMatch(/\$script:TrLastMap/);
  expect(translatePs1).toMatch(/function Set-TrLastFields/);
  expect(translatePs1).toMatch(/\$script:TrLastQ/);
  expect(translatePs1).toMatch(/Dictionary\[string,string\]/);
  expect(translatePs1).toMatch(/\$script:TrSaved/);
  expect(translatePs1).not.toMatch(/saved \{0\}/);
  expect(translatePs1).toMatch(/\$script:TrLastBatch/);
  expect(translatePs1).toMatch(/function Add-TrGeminiDead/);
  expect(translatePs1).toMatch(/\$geminiBatchSize/);
  expect(translatePs1).toMatch(/Expect100Continue/);
  expect(translatePs1).toMatch(/KeepAlive = \$false/);
  expect(translatePs1).not.toMatch(/KeepAlive = \$true/);
  expect(translatePs1).toMatch(/connection closed, trying next/);
  expect(translatePs1).toMatch(/function Get-TrGeminiVersion/);
  expect(translatePs1).toMatch(/New-Object PSObject -Property/);
  expect(translatePs1).not.toMatch(/Write-Output -NoEnumerate/);
  expect(translatePs1).toMatch(/SkipVerifyAi/);
  expect(translatePs1).toMatch(/verify:/);
  expect(translatePs1).toMatch(/\{1\}, skip question/);
  expect(translatePs1).not.toMatch(/\{1\}, trying next/);
  expect(translatePs1).not.toMatch(/New-Object System\.Net\.WebClient/);
  expect(translatePs1).not.toMatch(/local\.json/);
  expect(translatePs1).toMatch(/x-goog-api-key/);
  expect(translatePs1).toMatch(/gemini-3\.5-flash-lite/);
  expect(translatePs1).toMatch(/"contents":\[\{"parts":/);
  expect(translatePs1).toMatch(/POLISH \{0\}:/);
  expect(translatePs1).toMatch(/Translate Polish driving-licence theory exam questions into \$label/);
  expect(translatePs1).toMatch(/ua = "Ukrainian"/);
  expect(translatePs1).not.toMatch(/UK English/);
  expect(translatePs1).toMatch(/Do not copy the Polish source/);
  expect(translatePs1).toMatch(/Tak\/Nie in the source is exam text/);
  expect(translatePs1).not.toMatch(/Do not translate TAK\/NIE/);
  expect(translatePs1).not.toMatch(/UI chrome/);
  expect(translatePs1).not.toMatch(/Do not invent answers/);
  expect(translatePs1).toMatch(/Do not add extra options or explanations/);
  expect(translatePs1).toMatch(/function ConvertFrom-GeminiText/);
  expect(translatePs1).toMatch(/function Read-TrLabeledFields/);
  expect(translatePs1).toMatch(/function Get-TrTextBeforeLabels/);
  expect(translatePs1).toMatch(/function Read-TrParagraphFields/);
  expect(translatePs1).toMatch(/function Read-TrMarkdownFields/);
  expect(translatePs1).toMatch(/StartsWith\('\{'\) -or \$raw\.StartsWith\('\['\)/);
  expect(translatePs1).not.toMatch(/Return JSON only/);
  expect(translatePs1).not.toMatch(/Polish source JSON/);
  expect(translatePs1).not.toMatch(/responseMimeType/);
  expect(translatePs1).not.toMatch(/gemini-2\.0-flash/);
  const translatePy = fs.readFileSync(path.join(ROOT, 'scripts', 'translate-questions.py'), 'utf8');
  expect(translatePy).toMatch(/gemini-api-key/);
  expect(translatePy).toMatch(/gemini_api_key/);
  expect(translatePy).toMatch(/Gemini failed; progress saved/);
  expect(translatePy).not.toMatch(/input\(/);
  expect(translatePy).toMatch(/load_gemini_model_ids/);
  expect(translatePy).toMatch(/GEMINI_MODELS_URL/);
  expect(translatePy).toMatch(/def is_text_flash_model/);
  expect(translatePy).toMatch(/pageSize/);
  expect(translatePy).toMatch(/nextPageToken/);
  expect(translatePy).not.toMatch(/Do not GET \/v1beta\/models/);
  expect(translatePy).toMatch(/v1beta\/models/);
  expect(translatePy).not.toMatch(/googleapis\.com\/v1\/models/);
  expect(translatePy).toMatch(/def write_progress/);
  expect(translatePy).toMatch(/print\(\"\\r\" \+ line/);
  expect(translatePy).toMatch(/tmp\.replace\(path\)/);
  expect(translatePy).not.toMatch(/trying \{model\} \(\{mi\}/);
  expect(translatePy).toMatch(/GEMINI_HTTP_TIMEOUT = 30/);
  expect(translatePy).toMatch(/_gemini_dead/);
  expect(translatePy).toMatch(/gemini_translate_ids/);
  expect(translatePy).not.toMatch(/gemini_translate_question\(q, lang, gemini_api_key/);
  expect(translatePy).toMatch(/BATCH_SIZE/);
  expect(translatePy).toMatch(/timeout, trying next/);
  expect(translatePy).not.toMatch(/timeout, skip question/);
  expect(translatePy).toMatch(/connection closed, trying next/);
  expect(translatePy).toMatch(/def gemini_version_key/);
  expect(translatePy).toMatch(/def gemini_response_text/);
  expect(translatePy).toMatch(/def check_translation_field/);
  expect(translatePy).toContain('[^\\W\\d_]{3,}');
  expect(translatePy).not.toContain('[^\\W\\d_]{4,}');
  expect(translatePy).toMatch(/def models_to_try/);
  expect(translatePy).toMatch(/def gemini_fail_hint/);
  expect(translatePy).toMatch(/skip-verify-ai/);
  expect(translatePy).toMatch(/verify:/);
  expect(translatePy).toMatch(/\{msg\}, skip question/);
  expect(translatePy).not.toMatch(/\{msg\}, trying next/);
  expect(translatePy).toMatch(/bad response, trying next/);
  expect(translatePy).toMatch(/preview.*experimental.*beta.*latest/);
  expect(translatePy).toMatch(/x-goog-api-key/);
  expect(translatePy).toMatch(/"contents": \[\{"parts":/);
  expect(translatePy).toMatch(/POLISH \{name\}:/);
  expect(translatePy).toMatch(/Translate Polish driving-licence theory exam questions into \{label\}/);
  expect(translatePy).toMatch(/"ua": "Ukrainian"/);
  expect(translatePy).not.toMatch(/UK English/);
  expect(translatePy).toMatch(/Do not copy the Polish source/);
  expect(translatePy).toMatch(/Tak\/Nie in the source is exam text/);
  expect(translatePy).not.toMatch(/Do not translate TAK\/NIE/);
  expect(translatePy).not.toMatch(/UI chrome/);
  expect(translatePy).not.toMatch(/Do not invent answers/);
  expect(translatePy).toMatch(/Do not add extra options or explanations/);
  expect(translatePy).toMatch(/def parse_labeled_fields/);
  expect(translatePy).toMatch(/def text_before_labels/);
  expect(translatePy).toMatch(/def parse_paragraph_fields/);
  expect(translatePy).toMatch(/def parse_markdown_fields/);
  expect(translatePy).toMatch(/startswith\("\{"\)/);
  expect(translatePy).toMatch(/def parse_gemini_reply/);
  expect(translatePy).not.toMatch(/Return JSON only/);
  expect(translatePy).not.toMatch(/Polish source JSON/);
  expect(translatePy).not.toMatch(/responseMimeType/);
  expect(translatePy).toMatch(/gemini-3\.5-flash-lite/);
  expect(translatePy).not.toMatch(/gemini-2\.0-flash/);
  expect(translatePy).toMatch(/resolve_gemini_api_key/);
  expect(translatePy).toMatch(/\.geminienv/);
  expect(translatePs1).toMatch(/function Resolve-GeminiApiKey/);
  expect(translatePs1).toMatch(/\.geminienv/);
  expect(fs.existsSync(path.join(ROOT, 'scripts', 'geminienv.example'))).toBe(true);
  expect(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')).toMatch(/^\.geminienv$/m);
  expect(fs.readFileSync(path.join(ROOT, 'scripts', 'geminienv.example'), 'utf8')).toMatch(/GEMINI_API_KEY=/);
  expect(parsePs1Ua).toMatch(/GeminiApiKey/);
  expect(parsePy).toMatch(/skip-translate-gaps/);
  expect(parsePy).toMatch(/fill_missing/);
  expect(parsePy).toMatch(/gemini-api-key/);
  expect(windows).toMatch(/SkipTranslateGaps/);
  expect(windows).toMatch(/-SkipTranslateGaps/);
  expect(windows).toMatch(/GeminiApiKey/);
  expect(windows).toMatch(/\$logParts\.Add\('\*\*\*'\)/);
  expect(linux).toMatch(/--skip-translate-gaps/);
  expect(linux).toMatch(/--gemini-api-key/);
  expect(macos).toMatch(/--skip-translate-gaps/);
  expect(macos).toMatch(/--gemini-api-key/);
});
