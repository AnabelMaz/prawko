# Prawko - Polish Driving License Exam App

Day-to-day product is the local service at http://localhost:5173 (`C:\ProgramData\prawko` on Windows, `/usr/local/prawko` on macOS, `/opt/prawko` on Linux). GitHub Pages (`src/` after Playwright) is an extra preview, not the primary install.

## Project Structure
- `src/` — PWA (vanilla JS). Served locally; also published to GitHub Pages on push to `main`
- `scripts/` — data pipeline (Excel→JSON, media conversion)
- Source Excel / ZIP / raw (Windows): `%LOCALAPPDATA%\prawko\gov-data` (not the git working copy, not ProgramData). Overflow: `gov-data/` in the checkout if that disk has space. macOS: `~/Library/Application Support/prawko/gov-data`. Linux: `~/.local/share/prawko/gov-data`
- Converted media for the app: `C:\ProgramData\prawko\src\media` (Windows), `/usr/local/prawko/src/media` (macOS), `/opt/prawko/src/media` (Linux). Git `src/media` stays empty.

## Key Rules
- Windows `.ps1` files are UTF-8 **with BOM** (PowerShell 5.1). After creating or editing one: `node scripts/ensure-ps1-bom.js`
- Vanilla JS (ES modules), no frameworks, no build step
- UI languages: Polish (default), English, German, Ukrainian — switchable via the language toggle
- Dark/light theme toggle (persisted in localStorage)
- i18n: `data-i18n` for chrome; question strings in `translations_{lang}.json` come from the ministry Excel (EN/DE/UA columns), not machine translation
- Exam: 32 questions (20 basic TAK/NIE + 12 specialist A/B/C), 25 min, 74 pts max, 68 to pass
- Points: basic [10×3, 6×2, 4×1], specialist [6×3, 4×2, 2×1]
- Per-question timers: basic 20s, specialist 50s (shown separately from total timer with labels)
- JSON files per category, loaded on demand
- Media file names from Excel stay in JSON by default (CDN); `-DropMissingMedia` only when asked
- Media for **online play**: Backblaze B2 (`img/` `vid/`), not in git
- Offline **zip packs**: Cloudflare R2 (`PACKS_BASE`); `r2.dev` is the public URL (no paid domain)
- `MEDIA_BASE` in data.js; on a server that has local `src/media/img` or `media/vid`, `local.json` sets `mediaBase` to `'media'`
- Learning: default filter unknown + random order; catalog number in the blue counter jumps within the current sequential list only when `local.json` has `learnQuestionJump`
- Skins: Panel (WORD OSK layout) and Stacja; Panel question/ABC copy is fitted into fixed slots (`fit-text.js`)
- PWA with service worker; “Download offline” unpacks R2 zips into Cache Storage

## i18n Architecture
- `src/js/i18n.js` — translations dict, `getLang()`, `setLang()`, `t(key)`, `translateQuestion()`
- `src/data/translations_en.json`, `translations_de.json`, `translations_uk.json` — ministry Excel columns `Pytanie [EN]`, `[D]`, `[UA]`, written by `parse-excel.ps1`
- Language persisted in `localStorage` key `prawko_lang`
- Question translations lazy-loaded when a non-Polish language is selected
- A new question language needs a new Excel column and a matching entry in parse-excel / i18n.js — do not machine-translate the banks

## File Structure
- `src/js/` — app.js (router), data.js, exam.js, learn.js, ui.js, timer.js, stats.js, i18n.js, profiles.js, offline.js, zip.js, scale.js, scale-boot.js, fit-text.js
- `src/data/` — meta.json, {category}.json, translations_{en,de,uk}.json
- `src/media/` — empty in git; img/ (WebP) and vid/ (MP4) live only on the server after `-InstallGov`
- `Install_Prawko.windows.ps1` / `Install_Prawko.macos.sh` / `Install_Prawko.linux.sh` — one downloaded file per OS. Default: ZIP of AnabelMaz/prawko + Node + service (no Git). `-Dev` / `--dev`: Git clone only (no Node, no server). macOS: launchd, `/usr/local/prawko`. Linux: systemd, `/opt/prawko`. `-InstallGov` / `--install-gov` dotsources `scripts/download-gov` (`-LibraryOnly` / `PRAWKO_GOV_LIBRARY_ONLY`) so gov-data paths come from that library, then runs convert-media and parse-excel.
- `scripts/` — download-gov, convert-media, parse-excel, filter-no-media, build-media-packs (Windows `.ps1`; macOS/Linux `.sh` + existing `parse-excel.py` / `build-media-packs.py`).

## Data Pipeline
```bash
powershell -File scripts/parse-excel.ps1     # Excel → src/data/*.json (+ translations_*.json)
powershell -File scripts/convert-media.ps1   # JPG → WebP, WMV → MP4 (entry point on Windows)
bash scripts/convert-media.sh                # same job on macOS/Linux
powershell -File scripts/filter-no-media.ps1 # report only; -Remove to drop rows
bash scripts/upload-media.sh                 # Upload img/vid to Backblaze B2
powershell -File scripts/build-media-packs.ps1  # Zip packs + manifest (Windows)
```

Media conversion entry points: `convert-media.ps1` (Windows) and `convert-media.sh` (macOS/Linux).

## Licensing
- Questions: CC BY-SA 4.0
- Media: CC BY-NC-ND 4.0
- Source: gov.pl/web/infrastruktura/prawo-jazdy
