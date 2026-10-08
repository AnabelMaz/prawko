const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const CASES = [
  {
    src: 'Którą z wymienionych grup osób, masz prawo przewozić w przyczepie ciągniętej przez ciągnik rolniczy?',
    dst: 'Яких із зазначених осіб ви маєте право перевозити в причеpi, що буксирується сільськогосподарським трактором?',
    lang: 'uk',
    want: 'mixed script',
  },
  {
    src: 'Co może osłabić działanie układu hamulcowego przedniego koła motocykla?',
    dst: 'Що може послабити дію гальмівної системи переднього колеса мотоциkla?',
    lang: 'uk',
    want: 'mixed script',
  },
  {
    src: 'Tak, ale tylko w przyczepie ciągniętej przez motocykl.',
    dst: 'Так, але лише в причеπі, який буксирується мотоциклом.',
    lang: 'uk',
    want: 'mixed script',
  },
  {
    src: 'Hat der Fahrzeugführer Vorfahrt vor den Fußgängern auf diesem Platz?',
    dst: 'Hat der Fahrzeugführer Vorfahrt vor den Fußgängern auf diesem Platz mit пріority extra words here?',
    lang: 'de',
    want: 'mixed script',
  },
  {
    src: 'Does the driver have the right of way over pedestrians in this square?',
    dst: 'Does the driver have the right of way over pedestrians in this square with пріority noted?',
    lang: 'en',
    want: 'mixed script',
  },
  {
    src: 'Jak powinien być oznakowany ciągnik rolniczy?',
    dst: 'Як повинен бути позначений сільськогосподарський трактор?',
    lang: 'uk',
    want: null,
  },
  {
    src: 'Jak powinien być oznakowany ciągnik rolniczy?',
    dst: 'How should an agricultural tractor be marked for this exam question?',
    lang: 'en',
    want: null,
  },
  {
    src: 'Obraz prawa jazdy w aplikacji mDokumenty.',
    dst: 'Зображення посвідчення водія в застосунку mDokumenty.',
    lang: 'uk',
    want: null,
  },
  {
    src: 'Jakim pojazdem możesz kierować, mając prawo jazdy kategorii AM?',
    dst: 'Яким транспортним засобом ви можете керувати, маючи посвідчення категорії AM?',
    lang: 'uk',
    want: null,
  },
];

function pythonBin() {
  const cmds = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  for (const cmd of cmds) {
    try {
      execFileSync(cmd, ['-c', 'print(1)'], { encoding: 'utf8' });
      return cmd;
    } catch (_) { /* try next */ }
  }
  throw new Error('python not found');
}

function runPython(cases) {
  const pyPath = path.join(ROOT, 'scripts', 'translate-questions.py');
  const script = 'import importlib.util,json,sys; spec=importlib.util.spec_from_file_location("tr", sys.argv[1]); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); cases=json.load(sys.stdin); print(json.dumps([mod.check_translation_field(c["src"], c["dst"], c["lang"]) for c in cases], ensure_ascii=False))';
  const raw = execFileSync(pythonBin(), ['-c', script, pyPath], {
    input: JSON.stringify(cases),
    encoding: 'utf8',
    cwd: ROOT,
  });
  return JSON.parse(raw);
}

function runPowerShell(cases) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prawko-tr-'));
  const jsonPath = path.join(dir, 'cases.json');
  const psPath = path.join(dir, 'run.ps1');
  fs.writeFileSync(jsonPath, JSON.stringify(cases), 'utf8');
  const ps1 = path.join(ROOT, 'scripts', 'translate-questions.ps1');
  fs.writeFileSync(psPath, [
    '. ' + JSON.stringify(ps1) + ' -LibraryOnly',
    '$cases = [IO.File]::ReadAllText(' + JSON.stringify(jsonPath) + ', [Text.Encoding]::UTF8) | ConvertFrom-Json',
    '$out = New-Object System.Collections.Generic.List[object]',
    'foreach ($c in @($cases)) {',
    '  $why = Test-TrField ([string]$c.src) ([string]$c.dst) ([string]$c.lang)',
    '  if ($null -eq $why -or $why -eq "") { [void]$out.Add($null) } else { [void]$out.Add([string]$why) }',
    '}',
    'ConvertTo-Json -InputObject @($out.ToArray()) -Compress',
  ].join('\r\n'), { encoding: 'utf8' });
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  return JSON.parse(raw.trim());
}

function assertCases(got) {
  expect(got).toHaveLength(CASES.length);
  CASES.forEach((c, i) => {
    const why = got[i];
    if (c.want == null) {
      expect(why, `${c.lang} should accept`).toBeNull();
    } else {
      expect(String(why || ''), `${c.lang} ${c.want}`).toContain(c.want);
    }
  });
}

test('translation JSON is a map of id to q and src excel or gemini', () => {
  const allowed = new Set(['q', 'a', 'b', 'c', 'src']);
  const bad = [];
  for (const lang of ['en', 'de', 'uk']) {
    const file = path.join(ROOT, 'src', 'data', `translations_${lang}.json`);
    if (!fs.existsSync(file)) {
      bad.push(`missing ${lang}`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      bad.push(`${lang} not an object`);
      continue;
    }
    const ids = Object.keys(data);
    if (ids.length < 1) bad.push(`${lang} empty`);
    for (const qid of ids) {
      const row = data[qid];
      if (!row || typeof row !== 'object') {
        bad.push(`${lang} ${qid} not an object`);
        continue;
      }
      if (!String(row.q || '').trim()) bad.push(`${lang} ${qid} empty q`);
      if (row.src != null && row.src !== 'excel' && row.src !== 'gemini') {
        bad.push(`${lang} ${qid} src ${row.src}`);
      }
      for (const key of Object.keys(row)) {
        if (!allowed.has(key)) bad.push(`${lang} ${qid} extra ${key}`);
      }
    }
  }
  expect(bad.slice(0, 20)).toEqual([]);
  expect(fs.existsSync(path.join(ROOT, 'src', 'data', 'translations_ua.json'))).toBe(false);
});

test('Python translation verify catches mixed script in every language', () => {
  assertCases(runPython(CASES));
});

test('PowerShell translation verify matches the Python checks', () => {
  test.skip(process.platform !== 'win32', 'Windows PowerShell 5.1');
  assertCases(runPowerShell(CASES));
});
