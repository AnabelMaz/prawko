# Prawko — notes for AI agents

This file is a short map of the repo for agents. Humans use `README.md`. Question-translation prompt: `scripts/translate-questions.skill.md` (scripts fill `{lang}`). Runtime: `scripts/translate-questions.ps1` / `.py`.

Day-to-day product is the local service at http://localhost:5173 (`C:\ProgramData\prawko` on Windows, `/usr/local/prawko` on macOS, `/opt/prawko` on Linux). The human tests there. After any `src/` change on this machine, run `Install_Prawko.windows.ps1 -Patch` in the same turn (overlay contrib onto ProgramData; no wipe, no SyncGov). Optional HTTPS is a separate port (5174); HTTP 5173 then 302-redirects every path unless `local.json` has `httpsRedirect: false`. GitHub Pages (`src/` after Playwright) is an extra preview, not the primary install.

## Project Structure
- `src/` — PWA (vanilla JS). Served locally; also published to GitHub Pages on push to `main`
- `scripts/` — data pipeline (Excel→JSON, media conversion)
- Ministry Excel + media ZIPs: `C:\ProgramData\prawko\gov-cache` (Windows), `/usr/local/prawko/gov-cache` (macOS), `/opt/prawko/gov-cache` (Linux). Survives uninstall. Unpack JPG/WMV only in TEMP for convert-media, then delete. JSON and WebP/MP4 go to `src/data` and `src/media` on the server (git `src/data` only when you parse into the checkout). Low disk: scripts abort.
- Converted media for the app: `C:\ProgramData\prawko\src\media` (Windows), `/usr/local/prawko/src/media` (macOS), `/opt/prawko/src/media` (Linux). Git `src/media` stays empty.

## Key Rules
- Windows `.ps1` files are UTF-8 **with BOM** (PowerShell 5.1). Restore with `UTF8Encoding $true` after a write. No helper script in `scripts/`. CI: `tests/ps1-utf8-bom.spec.js` reads the bytes itself.
- Vanilla JS (ES modules), no frameworks, no build step
- UI languages: Polish (default), English, German, Ukrainian — switchable via the language toggle
- Dark/light theme toggle (persisted in localStorage)
- i18n: `data-i18n` for chrome. Question strings in `translations_{en,de,uk}.json` come from the ministry Excel first. `parse-excel` fills gaps via `translate-questions` unless `-SkipTranslateGaps` / `--skip-translate-gaps`. Gemini if a key is available (`-GeminiApiKey` / `--gemini-api-key`, else `.geminienv`, else `GEMINI_API_KEY`); no key = Google Translate only. With a key: Gemini only (no Google mix). Verify fail tries the next Flash; skip the ID only when every model fails. Parse merges: Excel overwrites the same IDs, fills for missing IDs stay.
- Exam: 32 questions (20 basic TAK/NIE + 12 specialist A/B/C), 25 min, 74 pts max, 68 to pass
- Points: basic [10×3, 6×2, 4×1], specialist [6×3, 4×2, 2×1]
- Per-question timers: basic 20s, specialist 50s (shown separately from total timer with labels)
- JSON files per category, loaded on demand
- Media file names from Excel stay in JSON by default (CDN); `-DropMissingMedia` only when asked
- Media for **online play**: Backblaze B2 `prawko-maz` (`img/` `vid/`), not in git. `upload-media.ps1` / `.py` (`b2 sync --skipNewer`; empty bucket = full upload). Defaults to the same folder as convert-media (ProgramData / `/usr/local/prawko` / `/opt/prawko`), not empty git `src/media`
- Offline **zip packs**: Cloudflare R2 `prawko-packs` (`PACKS_BASE`, `r2.dev`). Build with `build-media-packs`; **upload in the R2 dashboard** (no wrangler script). `upload-packs.ps1` / `.py` is an optional B2 archive of those zips, not the app host
- Installer `-SyncGov` does **not** upload to B2 or R2
- `MEDIA_BASE` in data.js: github.io defaults to B2+R2; a self-hosted server defaults to same-origin `media/` and reads `local.json` from the same origin. `mediaBase: 'cdn'` plus optional `packsBase` is the escape hatch to your own B2/R2
- Learning: default filter unknown + random order; catalog number in the blue counter jumps within the current sequential list only when `local.json` has `learnQuestionJump`
- HTTPS: installer `-Https` / `--https` (own CA, or `-HttpsCert`+`-HttpsKey`). CA CN/FriendlyName **Prawko Local CA**. Certs live next to the install (`certs/`, not under `src/`). `src/server.js` listens on 5173+5174. No HSTS. When HTTPS is up, HTTP always 302-redirects (missing or broken `local.json` included). Kill-switch: only an explicit `httpsRedirect: false` in valid `local.json` (read per request; no restart). Re-run fills only gaps (working CA+key, valid SAN/expiry server cert, ACL, service params) — no second Root.
- App updates: two exclusive paths. Loopback (any protocol) and HTTPS use the service worker: `registration.update()` in the background, `updatefound` banner; first `clients.claim()` does not reload, later `controllerchange` does. HTTP off-loopback has no SW; compare `CACHE_VERSION` only after an in-app load click (next/prev, home/categories, …) and only if ≥30s since the last check — never a 30s interval, never tab focus.
- Skins: Panel (WORD OSK layout) and Stacja; Panel question/ABC copy is fitted into fixed slots (`fit-text.js`)
- PWA with service worker. Viewed photos/films are stored in Cache Storage on that browser (prev/next from `blob:`), whether they came from B2 or this host’s `/media/`. Skip the copy only on loopback **and** `mediaBase: media` (files already on this computer’s disk). github.io, another server with or without media, and localhost with `mediaBase: cdn` all cache on view. Missing `/media/` files are a config error, not a silent CDN fallback. “Download offline” fills a whole category (R2 zips when `mediaBase: cdn`, else files from this host)

## i18n Architecture
- `src/js/i18n.js` — translations dict, `getLang()`, `setLang()`, `t(key)`, `translateQuestion()`. UI chrome: selected lang → English → Polish. Question text: selected lang → English → Polish. First visit: browser language, else English.
- `src/data/translations_en.json`, `translations_de.json`, `translations_uk.json` — ministry Excel columns `Pytanie [EN]`, `[D]`, `[UA]`, written by `parse-excel`; missing IDs filled by `translate-questions` (Gemini when a key is passed, else Google). Each ID has `src`: `excel` or `gemini`.
- Language persisted in `localStorage` key `prawko_lang`
- Question translations lazy-loaded when a non-Polish language is selected
- A new question language needs a new Excel column and a matching entry in parse-excel / i18n.js. Fill Excel gaps with `translate-questions` from Polish; do not overwrite ministry wording.

## File Structure
- `src/js/` — app.js (router), data.js, exam.js, learn.js, ui.js, timer.js, stats.js, i18n.js, profiles.js, offline.js, zip.js, scale.js, scale-boot.js, fit-text.js
- `src/server.js` — local HTTP/HTTPS static server (NSSM / launchd / systemd). Fallback remains the `serve` package when this file is missing.
- `src/data/` — meta.json, {category}.json, translations_{en,de,uk}.json
- `src/media/` — empty in git; img/ (WebP) and vid/ (MP4) live only on the server after `-SyncGov`
- `Install_Prawko.windows.ps1` / `Install_Prawko.macos.sh` / `Install_Prawko.linux.sh` — one downloaded file per OS. Default: ZIP of AnabelMaz/prawko + Node + service (no Git). `-Dev` / `--dev`: Git clone only (no Node, no server). macOS: launchd, `/usr/local/prawko`. Linux: systemd, `/opt/prawko`. `-SyncGov` / `--sync-gov` uses `download-gov.ps1` (Windows) or `download-gov.py` (macOS/Linux) for gov-cache (Excel + ZIPs next to the install), then convert-media (TEMP unpack) and parse-excel.
- `scripts/` — Windows `.ps1` (no Python). macOS/Linux pipeline `.py`. Installers stay `.ps1` / `.sh`. No Node in the data pipeline.

## Data Pipeline
Windows: PowerShell only (no Python, no Node in `scripts/`). macOS/Linux: installer `.sh`, remaining scripts `.py` (no Node).

```bash
# Windows
powershell -File scripts/parse-excel.ps1
powershell -File scripts/translate-questions.ps1
powershell -File scripts/convert-media.ps1
powershell -File scripts/merge-gov.ps1
powershell -File scripts/filter-no-media.ps1
powershell -File scripts/upload-media.ps1
powershell -File scripts/build-media-packs.ps1
# R2 dashboard: upload packs\manifest.json + zips (public PACKS_BASE)
# optional: powershell -File scripts/upload-packs.ps1   # B2 archive only

# macOS / Linux
python3 scripts/parse-excel.py
python3 scripts/translate-questions.py
python3 scripts/convert-media.py
python3 scripts/filter-no-media.py
python3 scripts/merge-gov.py --gov-dir DIR --out-dir DIR
python3 scripts/upload-media.py
python3 scripts/build-media-packs.py
# R2 dashboard: same as Windows
# optional: python3 scripts/upload-packs.py
```

Media conversion entry points: `convert-media.ps1` (Windows) and `convert-media.py` (macOS/Linux). `-MergeGov` / `--merge-gov` calls `merge-gov.ps1` or `merge-gov.py`.

## Licensing
- Questions: CC BY-SA 4.0
- Media: CC BY-NC-ND 4.0
- Source: gov.pl/web/infrastruktura/prawo-jazdy
