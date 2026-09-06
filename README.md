# 🚗 Prawko — Egzamin na prawo jazdy

To **fork** projektu [szkocot/prawko](https://github.com/szkocot/prawko) (demo źródła: https://szkocot.github.io/prawko/). Tutaj zostaje układ stacji WORD, skórki Image/PWPW, profile lokalne i przebudowana nauka. Małe, samodzielne łatki mogą iść do repozytorium źródłowego; ta kopia trzyma pełną wersję.

Aplikacja webowa (PWA) do nauki i symulacji egzaminu na prawo jazdy w Polsce. Baza w repo to JSON z katalogu MI (**3518** unikalnych pytań). Zdjęcia i filmy nie są w gicie. Publiczny katalog na gov.pl: **lipiec 2026** (`KATALOG_dla_kandydatów_na_kierowców_072026.xlsx`).

## Instalacja na Windows

Ściągnij [`Install_Prawko.ps1`](https://github.com/AnabelMaz/prawko/blob/main/Install_Prawko.ps1) (przycisk **Raw**, potem Zapisz jako) **gdzie chcesz** — Pulpit, Pobrane, pendrive. Nie musisz klonować repo ręcznie.

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.ps1
```

Albo w PowerShellu, bez przeglądarki:

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/AnabelMaz/prawko/main/Install_Prawko.ps1 -OutFile Install_Prawko.ps1
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.ps1
```

Instalator doinstaluje Git, Node.js i NSSM, sklonuje to repo do `C:\ProgramData\prawko` i wystawi aplikację na [http://localhost:5173](http://localhost:5173). Pytania są z repo, filmy i zdjęcia z CDN. Lokalna paczka z gov.pl (opcjonalnie, kilka GB): `Install_Prawko.ps1 -InstallGov`.

### Gdzie to ląduje (bez podwójnych GB)

**Zwykły użytkownik** (zainstalować, ewentualnie dociągnąć media z gov.pl):

| Co | Gdzie |
|---|---|
| Aplikacja + usługa | `C:\ProgramData\prawko` |
| ZIP / surowe JPG·WMV / PJM | `%LOCALAPPDATA%\prawko\gov-data` |
| Skonwertowane WebP / MP4 i JSON z Excela | `C:\ProgramData\prawko\src\media` i `src\data` |

Nie potrzebuje drugiego klona gita. `-InstallGov` nie kopiuje mediów jeszcze raz obok.

**Osoba jak Ty (kod + push na GitHub)** — ten sam `Install_Prawko.ps1`, z folderem na gita:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.ps1 -Dev D:\prawko
```

Ścieżkę podajesz sam (`D:\prawko`, `Documents\prawko`, … — nie ProgramData). Gdy serwer jeszcze nie stoi, instalator stawia ProgramData **i** klonuje. Gdy serwer już jest: tylko klon, bez admina. Tam edytujesz, commitujesz, pushujesz. Na podgląd: `Install_Prawko.ps1 -Patch` (albo znowu `-Dev` ta sama ścieżka + `-Patch`). Gov ZIP-y i WebP **nie** idą drugi raz do tego folderu.

Jedyna powtórka, której nie da się uniknąć przy `-InstallGov`: archiwum ZIP + rozpakowane JPG/WMV (żeby nie ściągać od zera) oraz surowe pliki + WebP/MP4 (źródło vs to, co odtwarza aplikacja). To nie są dwie kopie tej samej paczki w ProgramData i w gicie.

## Funkcje

- **Tryb nauki** — przeglądanie pytań po kategoriach, bez limitu czasu, z zapamiętywaniem postępu
- **Symulacja egzaminu** — 32 pytania, 25 minut, punktacja jak na prawdziwym egzaminie
- **12 kategorii** — A, A1, A2, AM, B, B1, C, C1, D, D1, PT, T
- **Multimedia** — zdjęcia i filmy z oficjalnej bazy
- **Polski i angielski** — przełączanie języka interfejsu i pytań
- **Tryb ciemny / jasny** — przełączanie motywu kolorystycznego
- **Tryb offline** — działa bez internetu dzięki Service Worker
- **Mobilna** — w pełni responsywna

## Zasady egzaminu

- 20 pytań podstawowych (TAK/NIE, 20 sekund) + 12 specjalistycznych (A/B/C, 50 sekund)
- Maksymalnie **74 punkty**, próg zaliczenia **68 punktów** (92%)
- Łączny czas: **25 minut**

## Generowanie danych

Wymagania na Windows: PowerShell. Media: `ffmpeg`, `cwebp`.

```bash
# Parsowanie Excela → JSON (Windows, bez Pythona)
powershell -ExecutionPolicy Bypass -File scripts/parse-excel.ps1

# Konwersja wideo WMV → MP4 (GPU: h264_videotoolbox na macOS)
bash scripts/convert-videos.sh

# Optymalizacja obrazów JPG → WebP
bash scripts/optimize-images.sh

# Filtrowanie pytań bez wymaganych multimediów
python3 scripts/filter-no-media.py

# Upload multimediów na Backblaze B2 (Windows: scripts/upload-media.ps1)
bash scripts/upload-media.sh
```

Czysty clone **nie wymaga** `-InstallGov`: JSON jest w `src/data`, a `MEDIA_CDN` w `src/js/data.js` wskazuje publiczny kubeł B2 `prawko-maz` (`img/` i `vid/`). Lokalna paczka MI (~3 GB) jest opcjonalna, na dysk idzie przez `-InstallGov`.

## TODO

- [x] Odzyskane z paczki MI (7/8): `313D12_a_org_światło.webp`, `policjant_przód_02.webp`, `policjant_przód_03.webp`, `policjant_przód_ręka_w_górze.webp`, `zagłówekorg.webp`, `JAZDA NOCĄorg.mp4`, `pięć5.mp4`
- [ ] Brak w paczce MI: `!RS_Parking zastrzeżony.webp`

## Źródło danych

Pytania egzaminacyjne pochodzą z oficjalnej bazy Ministerstwa Infrastruktury:
https://www.gov.pl/web/infrastruktura/prawo-jazdy

- **Stan katalogu**: lipiec 2026 (`KATALOG_dla_kandydatów_na_kierowców_072026.xlsx`; Excel zapisany 15 czerwca 2026)
- **Treść pytań**: licencja CC BY-SA 4.0
- **Materiały audiowizualne**: licencja CC BY-NC-ND 4.0

## Licencja kodu

Kod aplikacji jest na [ISC](LICENSE) (tak jak w `package.json` źródła). Przy kopiowaniu zostaw zastrzeżenie praw. Mediów z MI nie wrzucamy do gita (`src/media`).

---

# 🚗 Prawko — Polish Driving License Exam

This is a **fork** of [szkocot/prawko](https://github.com/szkocot/prawko) (upstream demo: https://szkocot.github.io/prawko/). It keeps a WORD station layout, Image/PWPW skins, local profiles, and a rebuilt learn mode. Small standalone fixes can still go upstream; this repository holds the full local product.

A PWA web app for Polish driving license exam preparation. The repo JSON has **3518** unique ministry questions. The public catalogue on gov.pl is **July 2026** (`KATALOG_dla_kandydatów_na_kierowców_072026.xlsx`).

## Install on Windows

Download [`Install_Prawko.ps1`](https://github.com/AnabelMaz/prawko/blob/main/Install_Prawko.ps1) (**Raw**, then Save as) anywhere. You do not need to clone the repo first.

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.ps1
```

The installer installs Git, Node.js and NSSM, clones this repo to `C:\ProgramData\prawko`, and serves the app at [http://localhost:5173](http://localhost:5173). Optional `-InstallGov` stores ZIP/raw under `%LOCALAPPDATA%\prawko\gov-data` and converted WebP/MP4 only on the server — not a second copy in a git clone. Developers use the same installer with `-Dev <folder>` to clone a working tree for code and `git push`; ProgramData stays the running app.

## Features

- **Learning mode** — browse questions by category, no time limit, progress tracking
- **Exam simulation** — 32 questions, 25 minutes, real scoring
- **12 categories** — A, A1, A2, AM, B, B1, C, C1, D, D1, PT, T
- **Media** — images and videos from the official database
- **Polish & English** — switchable UI and question language
- **Dark / light theme** — toggle color scheme
- **Offline mode** — works without internet via Service Worker
- **Mobile-friendly** — fully responsive

## Data Source

Questions from the official Ministry of Infrastructure database:
https://www.gov.pl/web/infrastruktura/prawo-jazdy

- **Catalogue date**: July 2026 (`KATALOG_dla_kandydatów_na_kierowców_072026.xlsx`; Excel last saved 15 June 2026)
- **Question text**: CC BY-SA 4.0
- **Audiovisual materials**: CC BY-NC-ND 4.0

## TODO

- [x] Recovered from the ministry pack (7/8): `313D12_a_org_światło.webp`, `policjant_przód_02.webp`, `policjant_przód_03.webp`, `policjant_przód_ręka_w_górze.webp`, `zagłówekorg.webp`, `JAZDA NOCĄorg.mp4`, `pięć5.mp4`
- [ ] Still missing from the ministry pack: `!RS_Parking zastrzeżony.webp`

## License

Application **code** is [ISC](LICENSE) (same as upstream `package.json`). Keep the copyright notice when you copy it.

Ministry **question text** is CC BY-SA 4.0. Ministry **photos and films** are CC BY-NC-ND 4.0: non-commercial, no derivatives, do not commit `src/media` to git. See the in-app "Źródło danych" page for attribution.
