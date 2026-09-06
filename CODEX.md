# Prawko - Polish Driving License Exam App

## Project Structure
- `src/` — deployed to GitHub Pages (SPA)
- `scripts/` — data pipeline (Excel→JSON, media conversion)
- Source Excel / ZIP / raw / PJM (Windows): `%LOCALAPPDATA%\prawko\gov-data` (not the git working copy, not ProgramData). Overflow: `gov-data/` in the checkout if that disk has space.
- Converted media for the app: `C:\ProgramData\prawko\src\media` (one copy). Git `src/media` stays empty / LFS.

## Key Rules
- Vanilla JS (ES modules), no frameworks, no build step
- Bilingual UI: Polish (default) + English, switchable via fixed language toggle
- Dark/light theme toggle (persisted in localStorage)
- i18n system: `data-i18n` attributes for static text; question strings in `translations_{lang}.json` come from the ministry Excel (EN/DE/UA columns), not machine translation
- Exam: 32 questions (20 basic TAK/NIE + 12 specialist A/B/C), 25 min, 74 pts max, 68 to pass
- Points: basic [10×3, 6×2, 4×1], specialist [6×3, 4×2, 2×1]
- Per-question timers: basic 20s, specialist 50s (shown separately from total timer with labels)
- JSON files per category, loaded on demand
- Media file names from Excel stay in JSON by default (CDN); `-DropMissingMedia` only when asked
- Media hosted on Backblaze B2 (via Cloudflare CDN), not in git repo
- MEDIA_BASE URL configured in data.js, used by ui.js for img/video src
- Learning progress tracked per category (localStorage), resumes from first unanswered question
- PWA with service worker for offline

## i18n Architecture
- `src/js/i18n.js` — translations dict, `getLang()`, `setLang()`, `t(key)`, `translateQuestion()`
- `src/data/translations_en.json`, `translations_de.json`, `translations_uk.json` — ministry Excel columns `Pytanie [EN]`, `[D]`, `[UA]`, written by `parse-excel.ps1`
- Language persisted in `localStorage` key `prawko_lang`
- Question translations lazy-loaded when a non-Polish language is selected
- A new question language needs a new Excel column and a matching entry in parse-excel / i18n.js — do not machine-translate the banks

## File Structure
- `src/js/` — app.js (router), data.js, exam.js, learn.js, ui.js, timer.js, stats.js, i18n.js
- `src/data/` — meta.json, {category}.json, translations_{en,de,uk}.json
- `src/media/` — img/ (WebP), vid/ (MP4) — Git LFS
- `Install_Prawko.ps1` / `Install_Prawko.sh` — one downloaded file. Default: ZIP of AnabelMaz/prawko + Node + service (no Git). `-Dev` / `--dev`: Git clone only (no Node, no server). macOS: launchd, `/usr/local/prawko`.
- `scripts/` — download-gov, convert-media, parse-excel, filter-no-media (Windows `.ps1`; macOS `.sh` + existing `parse-excel.py`).

## Data Pipeline
```bash
powershell -File scripts/parse-excel.ps1   # Excel → src/data/*.json (+ translations_*.json)
bash scripts/convert-videos.sh             # WMV → MP4 (GPU: h264_videotoolbox)
bash scripts/optimize-images.sh            # JPG → WebP
powershell -File scripts/filter-no-media.ps1   # report only; -Remove to drop rows
bash scripts/upload-media.sh               # Upload media to Backblaze B2
```

## Licensing
- Questions: CC BY-SA 4.0
- Media: CC BY-NC-ND 4.0
- Source: gov.pl/web/infrastruktura/prawo-jazdy
