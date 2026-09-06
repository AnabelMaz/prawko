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
- i18n system: `data-i18n` attributes for static text, `translations_{lang}.json` for questions
- Exam: 32 questions (20 basic TAK/NIE + 12 specialist A/B/C), 25 min, 74 pts max, 68 to pass
- Points: basic [10×3, 6×2, 4×1], specialist [6×3, 4×2, 2×1]
- Per-question timers: basic 20s, specialist 50s (shown separately from total timer with labels)
- JSON files per category, loaded on demand
- Questions requiring media assets but missing them are filtered out
- Media hosted on Backblaze B2 (via Cloudflare CDN), not in git repo
- MEDIA_BASE URL configured in data.js, used by ui.js for img/video src
- Learning progress tracked per category (localStorage), resumes from first unanswered question
- PWA with service worker for offline

## i18n Architecture
- `src/js/i18n.js` — translations dict, `getLang()`, `setLang()`, `t(key)`, `translateQuestion()`
- `src/data/translations_en.json` — English translations keyed by question ID
- Language persisted in `localStorage` key `prawko_lang`
- Question translations lazy-loaded only when EN is selected
- To add a new language, use the `translate-questions` skill (`.codex/skills/translate-questions/`)

## File Structure
- `src/js/` — app.js (router), data.js, exam.js, learn.js, ui.js, timer.js, stats.js, i18n.js
- `src/data/` — meta.json, {category}.json, translations_en.json
- `src/media/` — img/ (WebP), vid/ (MP4) — Git LFS
- `Install_Prawko.ps1` — Windows installer (repo root). Download and run from anywhere; clones the repo and uses `scripts/`.
- `scripts/` — download-gov.ps1, convert-media.ps1, parse-excel.ps1, filter-no-media.ps1 (Windows). Legacy .py/.sh left in place.
- `.codex/skills/translate-questions/` — skill for translating questions to new languages

## Data Pipeline
```bash
python3 scripts/parse-excel.py        # Excel → src/data/*.json
bash scripts/convert-videos.sh         # WMV → MP4 (GPU: h264_videotoolbox)
bash scripts/optimize-images.sh        # JPG → WebP
python3 scripts/filter-no-media.py     # Remove questions needing missing media
bash scripts/upload-media.sh            # Upload media to Backblaze B2
```

## Licensing
- Questions: CC BY-SA 4.0
- Media: CC BY-NC-ND 4.0
- Source: gov.pl/web/infrastruktura/prawo-jazdy
