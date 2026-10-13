const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const CASES = [
  { name: 'case and spaces', old: { id: 1, q: 'Czy TAK?' }, neu: { id: 1, q: 'czy  tak?' }, same: true },
  { name: 'dash and quotes', old: { id: 2, q: 'Znak \u2013 \u201Etak\u201D' }, neu: { id: 2, q: 'znak - "tak"' }, same: true },
  { name: 'one word', old: { id: 3, q: 'Czy musisz?' }, neu: { id: 3, q: 'Czy mo\u017cesz?' }, same: false },
  { name: 'one digit', old: { id: 4, q: 'Jedziesz 30 km/h' }, neu: { id: 4, q: 'Jedziesz 50 km/h' }, same: false },
  { name: 'answer C', old: { id: 5, q: 'Pytanie', a: 'A', b: 'B', c: 'Stop' }, neu: { id: 5, q: 'Pytanie', a: 'A', b: 'B', c: 'Jed\u017a' }, same: false },
];

function pythonBin() {
  for (const cmd of ['python', 'python3']) {
    try {
      execFileSync(cmd, ['-c', 'print(1)'], { encoding: 'utf8' });
      return cmd;
    } catch (_) { /* try next */ }
  }
  throw new Error('python not found');
}

function runPython() {
  const pyPath = path.join(ROOT, 'scripts', 'parse-excel.py');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prawko-pl-'));
  const jsonPath = path.join(dir, 'cases.json');
  fs.writeFileSync(jsonPath, JSON.stringify(CASES), 'utf8');
  const script = [
    'import importlib.util, json, sys, tempfile',
    'from pathlib import Path',
    'spec = importlib.util.spec_from_file_location("parse_excel", sys.argv[1])',
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    'cases = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))',
    'keys = []',
    'for c in cases:',
    '    keys.append(mod.polish_question_key(c["old"]) == mod.polish_question_key(c["neu"]))',
    'old = {str(c["old"]["id"]): mod.polish_question_key(c["old"]) for c in cases}',
    'changed = mod.changed_polish_ids(old, [c["neu"] for c in cases])',
    'root = Path(tempfile.mkdtemp())',
    'tr = root / "translations_en.json"',
    'tr.write_text(json.dumps({"1": {"q": "old keep", "src": "gemini"}, "3": {"q": "old drop", "src": "gemini"}, "9": {"q": "ministry", "src": "gemini"}}, ensure_ascii=False), encoding="utf-8")',
    'store = {"9": {"q": "from excel", "src": "excel"}}',
    'mod.merge_existing_translations(store, tr, {"1", "3", "9"}, {"3"})',
    'print(json.dumps({"same": keys, "kept": sorted(store)}))',
  ].join('\n');
  const raw = execFileSync(pythonBin(), ['-c', script, pyPath, jsonPath], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  return JSON.parse(raw);
}

function runPowerShell() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prawko-pl-'));
  const jsonPath = path.join(dir, 'cases.json');
  const psPath = path.join(dir, 'run.ps1');
  fs.writeFileSync(jsonPath, JSON.stringify(CASES), 'utf8');
  const ps1 = path.join(ROOT, 'scripts', 'parse-excel.ps1');
  fs.writeFileSync(psPath, [
    '. ' + JSON.stringify(ps1) + ' -LibraryOnly',
    '$cases = [IO.File]::ReadAllText(' + JSON.stringify(jsonPath) + ', [Text.Encoding]::UTF8) | ConvertFrom-Json',
    '$same = New-Object System.Collections.Generic.List[object]',
    '$old = @{}',
    '$neu = New-Object System.Collections.Generic.List[object]',
    'foreach ($c in @($cases)) {',
    '  $left = Get-PolishQuestionKey $c.old',
    '  $right = Get-PolishQuestionKey $c.neu',
    '  [void]$same.Add($left -eq $right)',
    '  $old[[string]$c.old.id] = $left',
    '  [void]$neu.Add($c.neu)',
    '}',
    '$changed = @(Get-ChangedPolishIds $old $neu)',
    '[ordered]@{ same = @($same.ToArray()); changed = @($changed) } | ConvertTo-Json -Compress',
  ].join('\r\n'), { encoding: 'utf8' });
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  return JSON.parse(raw.trim());
}

test('Polish wording match ignores case, spacing, dashes and quotes', () => {
  const py = runPython();
  const ps = runPowerShell();
  CASES.forEach((c, i) => {
    expect(py.same[i], `python ${c.name}`).toBe(c.same);
    expect(ps.same[i], `powershell ${c.name}`).toBe(c.same);
  });
  expect(py.kept).toEqual(['1', '9']);
  const changed = new Set((ps.changed || []).map(String));
  expect(changed.has('3')).toBe(true);
  expect(changed.has('4')).toBe(true);
  expect(changed.has('5')).toBe(true);
  expect(changed.has('1')).toBe(false);
  expect(changed.has('2')).toBe(false);
});
