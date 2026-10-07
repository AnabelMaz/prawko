# Prawko

Aplikacja PWA do nauki i symulacji egzaminu teoretycznego na prawo jazdy w Polsce. To **fork** [szkocot/prawko](https://github.com/szkocot/prawko): układ stacji WORD, skórki Panel/Stacja, profile lokalne i przebudowana nauka. Małe łatki mogą iść upstream; pełna wersja na **Windows**, **macOS** i **Linux** zostaje tutaj.

Do użytku **nie trzeba lokalnej instalacji**. Wejdź na [anabelmaz.github.io/prawko](https://anabelmaz.github.io/prawko/): to pełna aplikacja. Możesz dodać ją do ekranu głównego (PWA), w kategorii kliknąć **Pobierz offline** i uczyć się bez sieci. Przez limity Backblaze **zdjęcia i filmy bywają puste, dopóki nie ściągniesz paczki** na to urządzenie; po pobraniu działają lokalnie (zipy z Cloudflare R2).

Własny serwer stawiaj tylko gdy chcesz trzymać aplikację u siebie albo **wgrać nowszy katalog pytań i mediów z ministerstwa** — publiczne zasoby mogą być starsze niż aktualny Excel na [gov.pl](https://www.gov.pl/web/infrastruktura/prawo-jazdy).

Baza w repozytorium to JSON z tego katalogu (**3518** unikalnych pytań, **lipiec 2026**, `KATALOG_dla_kandydatów_na_kierowców_072026.xlsx`). Oglądanie mediów: Backblaze; **„Pobierz offline”**: zipy z R2.

[Polski](#instalacja-na-windows) · [macOS](#instalacja-na-macos) · [Linux](#instalacja-na-linuxie) · [English](#install-on-windows)

---

## Instalacja na Windows

Instalator Windows to **`Install_Prawko.windows.ps1`** (ten sam schemat nazw co `Install_Prawko.macos.sh` i `Install_Prawko.linux.sh`).

Docelowe środowisko to **Windows 10/11**. Python nie jest potrzebny — ani do instalacji, ani do skryptów danych.

### Wymagania

| | |
|---|---|
| System | Windows 10 lub 11 |
| Powłoka | Windows PowerShell 5.1 albo nowszy |
| Uprawnienia | Pierwsza instalacja wymaga **administratora** (Node.js, NSSM, usługa Windows) |
| Sieć | GitHub (ZIP aplikacji i narzędzia). Oglądanie z Backblaze, paczki offline z Cloudflare; lokalna paczka MI jest opcjonalna |
| Git | **Nie** — tylko przy `-Dev` |
| Python | **Nie** |

Instalator sam doinstaluje brakujące **Node.js** i **NSSM**. Gita nie rusza, chyba że podasz `-Dev`.

### Szybki start

1. Ściągnij [`Install_Prawko.windows.ps1`](https://github.com/AnabelMaz/prawko/blob/main/Install_Prawko.windows.ps1) (**Raw** → Zapisz jako) — Pulpit, Pobrane albo pendrive. **Nie musisz** klonować repozytorium ręcznie.
2. W PowerShellu, w folderze z plikiem:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1
```

Ściągaj plik na dysk (`-OutFile` albo Raw → Zapisz jako). Nie wklejaj treści ze strony do Notatnika — Windows PowerShell 5.1 wymaga UTF-8 z BOM.

Albo bez przeglądarki, jednym ciągiem:

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/AnabelMaz/prawko/main/Install_Prawko.windows.ps1 -OutFile Install_Prawko.windows.ps1
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1
```

3. Otwórz [http://localhost:5173](http://localhost:5173).

Jeśli Windows zablokuje skrypt (SmartScreen / ExecutionPolicy), zostaw `-ExecutionPolicy Bypass` jak wyżej — dotyczy tylko tego procesu, nie całego systemu. Pełna lista przełączników: `Install_Prawko.windows.ps1 -Help`.

### Co instalator robi (tryb domyślny)

Bez przełączników instalator:

- doinstalowuje Node.js i NSSM, jeśli ich nie ma,
- ściąga ZIP [AnabelMaz/prawko](https://github.com/AnabelMaz/prawko) (`main`) do `C:\ProgramData\prawko` (**bez Gita**),
- stawia usługę Windows **PrawkoWORDService**,
- serwuje aplikację na porcie **5173**.

Pytania pochodzą z JSON w repozytorium. Oglądanie zdjęć i filmów: kubeł Backblaze `prawko-maz`. „Pobierz offline”: zipy z Cloudflare R2. Gdy usługa już stoi, ponowne odpalenie **bez przełączników nic nie nadpisuje**.

Po wgraniu nowszej wersji kodu w otwartej karcie może pojawić się baner „Dostępna aktualizacja” — wystarczy **Odśwież**, bez Ctrl+F5.

### Gdzie lądują pliki

| Co | Ścieżka |
|---|---|
| Aplikacja i usługa | `C:\ProgramData\prawko` |
| Excel + ZIP-y mediów z gov.pl | `C:\ProgramData\prawko\gov-cache` (zostaje po `-Uninstall`) |
| Rozpakowanie JPG/WMV (scratch) | `%TEMP%\prawko\raw` (kasowane po konwersji) |
| Skonwertowane WebP / MP4 i JSON z Excela | `C:\ProgramData\prawko\src\media` oraz `src\data` |
| FFmpeg przenośny (przy `-SyncGov` / `-MergeGov`, gdy nie ma w PATH) | `C:\ProgramData\prawko\tools` |

Zwykły użytkownik **nie potrzebuje** drugiego klona gita. `-SyncGov` nie kopiuje mediów do folderu gita — tylko na serwer w ProgramData.

### Przełączniki instalatora

| Przełącznik | Działanie |
|---|---|
| *(brak)* | Serwer: ZIP z GitHuba, pytania z repo, media z CDN |
| `-SyncGov` | Gov.pl → staging → serwer. Domyślnie **Full** (Excel + ZIP + WebP/MP4 + JSON). **Nie** pobiera PJM (~10 GB) |
| `-SyncScope Questions\|Media\|Full` | Zakres `-SyncGov`: tylko pytania / ZIP→TEMP→WebP·MP4 / pełne (domyślne) |
| `-SyncUseCache` | Przy `-SyncGov`: nie woła gov.pl, gdy `gov-cache` ma Excel i ZIP-y |
| `-DropMissingMedia` | Przy `-SyncGov` (Full/Media): wycina z JSON media bez pliku lokalnego. Domyślnie **wyłączone** |
| `-SkipTranslateGaps` | Przy `-SyncGov` Questions/Full: nie uzupełniaj pustych EN/DE/UA. Domyślnie **uzupełnia** (Gemini gdy jest klucz, inaczej Google Translate) |
| `-GeminiApiKey <klucz>` | Przy `-SyncGov` Questions/Full: Gemini na ten run (nadpisuje `.geminienv`). Bez parametru: `.geminienv` jak `.b2env`. Przy kluczu tylko Gemini (dzienny 429 → kolejny Flash). Bez klucza: Google |
| `-MergeGov` | Na stojącym serwerze: dopisuje z Excela MI tylko braki |
| `-Export <ścieżka>` | Paczka przenośna: kod + **domyślnie** snapshot serwera (`data`, `media`, `local.json`, `manifest.json`) |
| `-ExcludeData` / `-ExcludeMedia` / `-ExcludeLocalJson` | Przy `-Export`: wyklucz z paczki (domyślnie wszystko wchodzi) |
| `-IncludeGovCache` | Przy `-Export`: dołóż `gov-cache` (Excel + ZIP-y; nie snapshot serwera) |
| `-Import <ścieżka>` | Przywróć z paczki exportu (serwer musi już stać). `-ImportScope Auto\|Code\|Runtime`, `-ImportForce` |
| `-Dev <folder>` | Tylko Git + klon. **Bez** Node i serwera |
| `-Patch` | Overlay kodu z lokalnego klona (`-Dev`; `src\`, bez `data\` i `media\`) |
| `-Uninstall` | Usuwa usługę i `C:\ProgramData\prawko` **oprócz** `gov-cache` |
| `-NonInteractive` / `-Help` | Bez pauzy Enter / pełna pomoc |

Administrator tylko przy **pierwszej instalacji serwera** albo `-Uninstall`.

### Gov.pl na serwerze (opcjonalnie, kilka GB)

Domyślna instalacja wystarcza (JSON z repo, media z CDN).

Pełna paczka MI lokalnie:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -SyncGov
```

Tylko pytania, filmy z CDN:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -SyncGov -SyncScope Questions
```

Excel i ZIP-y → `C:\ProgramData\prawko\gov-cache`. Rozpakowanie JPG/WMV w TEMP, potem kasowane. WebP/MP4 i JSON → `C:\ProgramData\prawko\src\`.

### Export i import (USB / nowy PC)

**Export** — domyślnie pełny snapshot (pytania + media + `local.json`), bez dotykania serwera:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Export D:\backup\prawko-pack
```

Tylko kod (mniejsza paczka): dodaj `-ExcludeData -ExcludeMedia -ExcludeLocalJson`.

Struktura paczki: `prawko\` (launcher), `prawko-contrib\`, `snapshot\`, `manifest.json`; opcjonalnie `gov-cache\`.

**Import** — na nowym PC najpierw instalator **bez przełączników**, potem:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Import D:\backup\prawko-pack
```

`-ImportForce` nadpisuje istniejące `data`/`media` na serwerze. Bez gov.pl, jeśli paczka ma snapshot.

### Instalacja dla dewelopera

Sam kod, bez localhost i bez Node:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Dev D:\prawko
```

Git doinstaluje się tylko tu. Serwera to **nie** stawia. Folder musi być **pusty** albo jeszcze nie istnieć (nie `C:\ProgramData\prawko`).

Oba (aplikacja + git): najpierw instalator **bez** przełączników, potem `-Dev`.

Podgląd własnych zmian na działającym serwerze (po `-Dev`):

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Patch
```

`-Patch` nakłada `src` z klona, **bez** `data\` i `media\`.

### Odinstalowanie

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Uninstall
```

Znika usługa i `C:\ProgramData\prawko` (w tym FFmpeg z `-SyncGov`). `C:\ProgramData\prawko\gov-cache` oraz Git / Node / NSSM zostają.

---

## Instalacja na macOS

Ten sam produkt co na Windowsie: ściągasz **jeden skrypt**, resztę robi on sam (narzędzia, ZIP, usługa, port **5173**). Usługa to **launchd**, nie NSSM.

### Wymagania

| | |
|---|---|
| System | macOS (Intel albo Apple Silicon) |
| Powłoka | bash (wbudowany) — **nie** musisz klonować repo ani instalować Homebrew wcześniej |
| Uprawnienia | Pierwsza instalacja zapyta o **hasło administratora** (sudo), jak UAC na Windows |
| Python | Tylko przy `--sync-gov` / `--merge-gov`. Do samego serwera **nie** |

Instalator sam doinstaluje **Homebrew** (jeśli go nie ma), potem **Node.js**. Gita nie rusza, chyba że podasz `--dev`.

### Szybki start

1. Ściągnij [`Install_Prawko.macos.sh`](https://github.com/AnabelMaz/prawko/blob/main/Install_Prawko.macos.sh) (**Raw** → Zapisz jako) — Pulpit albo Pobrane. **Nie musisz** klonować repozytorium ręcznie.
2. W Terminalu, w folderze z plikiem:

```bash
bash Install_Prawko.macos.sh
```

Albo bez przeglądarki, jednym ciągiem:

```bash
curl -fsSL -o Install_Prawko.macos.sh https://raw.githubusercontent.com/AnabelMaz/prawko/main/Install_Prawko.macos.sh
bash Install_Prawko.macos.sh
```

3. Otwórz [http://localhost:5173](http://localhost:5173).

`chmod +x` nie jest potrzebny — odpalasz przez `bash`, tak jak na Windowsie `powershell -File`. Pełna lista: `bash Install_Prawko.macos.sh --help`.

### Co instalator robi (tryb domyślny)

Bez przełączników instalator:

- doinstaluje **Homebrew**, jeśli go nie ma (odpowiednik winget),
- doinstaluje **Node.js**,
- ściąga ZIP [AnabelMaz/prawko](https://github.com/AnabelMaz/prawko) (`main`) do `/usr/local/prawko` (**bez Gita**),
- stawia LaunchDaemon **pl.prawko.word**,
- serwuje aplikację na porcie **5173**.

Gdy usługa już stoi, ponowne odpalenie **bez przełączników nic nie nadpisuje**.

### Gdzie lądują pliki

| Co | Ścieżka |
|---|---|
| Aplikacja i launchd | `/usr/local/prawko` |
| Excel + ZIP-y mediów z gov.pl | `/usr/local/prawko/gov-cache` |
| Rozpakowanie JPG/WMV (scratch) | `$TMPDIR/prawko/raw` (kasowane po konwersji) |
| Skonwertowane WebP / MP4 i JSON z Excela | `/usr/local/prawko/src/media` oraz `src/data` |
| plist | `/Library/LaunchDaemons/pl.prawko.word.plist` |

### Przełączniki (jak na Windowsie)

Te same przełączniki co w tabeli Windows (`--sync-gov`, `--export`, `--import`, `--merge-gov` itd.).

```bash
bash Install_Prawko.macos.sh --sync-gov
bash Install_Prawko.macos.sh --export ~/Desktop/prawko-pack
bash Install_Prawko.macos.sh --import ~/Desktop/prawko-pack
bash Install_Prawko.macos.sh --dev ~/prawko
bash Install_Prawko.macos.sh --patch
```

`--sync-gov` i `--merge-gov` wymagają **Pythona**. Sudo tylko przy pierwszej instalacji serwera albo `--uninstall`.

### Instalacja dla dewelopera (macOS)

Sam kod, bez localhost i bez Node:

```bash
bash Install_Prawko.macos.sh --dev ~/prawko
```

Git doinstaluje się tylko tu (i tylko gdy już masz Homebrew — w przeciwnym razie `xcode-select --install` albo `brew install git`). Serwera to **nie** stawia. Folder musi być **pusty** albo jeszcze nie istnieć (nie `/usr/local/prawko`).

Oba (aplikacja + git): najpierw skrypt **bez** przełączników, potem `--dev`.

Na podgląd localhost z Twojego kodu (gdy serwer już stoi):

```bash
bash Install_Prawko.macos.sh --patch
```

---

## Instalacja na Linuxie

Ten sam produkt: jeden skrypt, ZIP, Node, port **5173**. Usługa to **systemd** (nie launchd i nie NSSM). Katalog aplikacji: **`/opt/prawko`**.

Wymaga **systemd** (Ubuntu, Debian, Fedora, Arch, openSUSE i pokrewne). Alpine / OpenRC — zainstaluj Node 18+ sam i serwuj `src/` ręcznie.

### Wymagania

| | |
|---|---|
| System | Linux z systemd, x86_64 albo aarch64 (glibc) |
| Powłoka | bash |
| Uprawnienia | Pierwsza instalacja: **sudo** (katalog `/opt/prawko` i unit systemd) |
| Python | Tylko przy `--sync-gov` / `--merge-gov` |

Node: najpierw to, co już jest w PATH (18+), potem paczka dystrybucji (`apt` / `dnf` / `yum` / `pacman` / `zypper` / `apk`), na końcu oficjalny tarball z nodejs.org do `/opt/prawko/tools/node`. Homebrew na Linuksie **nie** jest używany. `--dev` nie instaluje Gita — daj `sudo apt install git` (albo odpowiednik).

### Szybki start

1. Ściągnij [`Install_Prawko.linux.sh`](https://github.com/AnabelMaz/prawko/blob/main/Install_Prawko.linux.sh) (**Raw** → Zapisz jako). **Nie musisz** klonować repozytorium ręcznie.
2. W terminalu, w folderze z plikiem:

```bash
bash Install_Prawko.linux.sh
```

Albo bez przeglądarki:

```bash
curl -fsSL -o Install_Prawko.linux.sh https://raw.githubusercontent.com/AnabelMaz/prawko/main/Install_Prawko.linux.sh
bash Install_Prawko.linux.sh
```

3. Otwórz [http://localhost:5173](http://localhost:5173).

Pełna lista: `bash Install_Prawko.linux.sh --help`. Przełączniki jak na macOS (`--sync-gov`, `--export`, `--import`, …).

### Gdzie lądują pliki

| Co | Ścieżka |
|---|---|
| Aplikacja i systemd | `/opt/prawko` |
| Unit | `/etc/systemd/system/prawko.service` |
| Excel + ZIP-y mediów z gov.pl | `/opt/prawko/gov-cache` |
| Rozpakowanie JPG/WMV (scratch) | `$TMPDIR/prawko/raw` (kasowane po konwersji) |
| Skonwertowane WebP / MP4 i JSON z Excela | `/opt/prawko/src/media` oraz `src/data` |
| Tarball Node (gdy brak paczki 18+) | `/opt/prawko/tools/node` |

```bash
bash Install_Prawko.linux.sh --sync-gov
bash Install_Prawko.linux.sh --export ~/prawko-pack
bash Install_Prawko.linux.sh --import ~/prawko-pack
bash Install_Prawko.linux.sh --dev ~/prawko
bash Install_Prawko.linux.sh --patch
```

---

## Funkcje

- **Tryb nauki** — pytania po kategoriach, bez limitu czasu, z zapamiętywaniem postępu
- **Symulacja egzaminu** — 32 pytania, 25 minut, punktacja jak na egzaminie
- **12 kategorii** — A, A1, A2, AM, B, B1, C, C1, D, D1, PT, T
- **Skórki** — Panel i Stacja
- **Multimedia** — zdjęcia i filmy z oficjalnej bazy (stream z Backblaze, paczki offline z Cloudflare, albo lokalnie po `-SyncGov`)
- **Języki** — PL, EN, DE, UA (interfejs i treść pytań)
- **Tryb ciemny / jasny** — zapisany w przeglądarce
- **Profile lokalne** — postęp na tym komputerze
- **Offline** — PWA / Service Worker; „Pobierz offline” ściąga zipy z Cloudflare R2 i rozpakowuje je w Cache Storage przeglądarki
- **Układ** — telefon i szeroki ekran, w tym tryb stacji

## Zasady egzaminu

Zgodnie z rozporządzeniem (Dz.U. 2023 poz. 2659):

- 20 pytań podstawowych (TAK/NIE, 20 s) + 12 specjalistycznych (A/B/C, 50 s)
- maksymalnie **74 punkty**, próg **68 punktów** (92 %)
- łączny czas **25 minut**
- punktacja pytania pochodzi z katalogu MI (kolumna „Liczba punktów”); typ pytania z poprawnej odpowiedzi (**T/N** = podstawowe, **A/B/C** = specjalistyczne), nie z kolumny „Zakres struktury” (bywa błędna)

## Języki

Przełącznik w aplikacji cyklicznie: **PL → EN → DE → UA**. Pierwsza wizyta: język przeglądarki, inaczej angielski. Chrome UI: wybrany język → EN → PL. Treść pytania bez tłumaczenia w wybranym języku: **angielski**, potem polski.

Treść pytań w językach obcych pochodzi z Excela MI (`Pytanie [EN]`, `Pytanie [D]`, `Pytanie [UA]`) i jest zapisana w `src/data/translations_{en,de,ua}.json` przez `parse-excel.ps1` (`ua` = ukraiński, nie mylić z UK). Parser **domyślnie** uzupełnia puste kolumny przez `translate-questions`. Gemini, gdy jest klucz: parametr `-GeminiApiKey` / `--gemini-api-key` na ten run, albo gitignored `.geminienv` w katalogu repo (szablon `scripts/geminienv.example`, jak `.b2env`), albo zmienna `GEMINI_API_KEY`. Przy kluczu **tylko Gemini** (lista Flash z API, lite pierwsze); 404 i dzienny 429 idą na kolejny model; gdy wszystkie padną — zapis i stop, bez Google. Pytanie ze złym tłumaczeniem (verify) jest pomijane. Bez klucza: Google Translate. Wyłączenie: `-SkipTranslateGaps` / `--skip-translate-gaps`. Przy kolejnym Excelu **nie kasuje** tych uzupełnień, tylko nadpisuje ID, które MI już ma.

## Dane i multimedia

| | W gicie | Windows | macOS | Linux |
|---|---|---|---|---|
| Pytania JSON | `src/data/` | `C:\ProgramData\prawko\src\data` | `/usr/local/prawko/src/data` | `/opt/prawko/src/data` |
| Zdjęcia / filmy | nie (pusty `src/media`) | CDN albo `C:\ProgramData\prawko\src\media` | CDN albo `/usr/local/prawko/src/media` | CDN albo `/opt/prawko/src/media` |
| Excel + ZIP-y mediów | nie | `C:\ProgramData\prawko\gov-cache` | `/usr/local/prawko/gov-cache` | `/opt/prawko/gov-cache` |
| JPG / WMV (scratch) | nie | `%TEMP%\prawko\raw` | `$TMPDIR/prawko/raw` | `$TMPDIR/prawko/raw` |

Czysty clone **nie wymaga** `-SyncGov`. JSON jest w `src/data`. Domyślnie (github.io i localhost bez mediów na dysku):

| Co | Skąd | Stała w `src/js/data.js` |
|---|---|---|
| Oglądanie `img/` i `vid/` | Backblaze B2 `prawko-maz` | `MEDIA_CDN` |
| „Pobierz offline” (zip + manifest) | Cloudflare R2 `prawko-packs` | `PACKS_BASE` (`https://pub-….r2.dev`) |

R2 zostaje na publicznym adresie testowym `r2.dev` (bez płatnej domeny). Własna domena na kubeł nie jest wymagana. Stary fetch plik-po-pliku z B2 zostaje w kodzie (`OFFLINE_DOWNLOAD = 'files'`).

**Dwa hosty, zawsze oba** — jakby kubełki były puste. Instalator (`-SyncGov`) robi tylko dysk lokalny (kroki 1–3). **Nie** wgrywa nic na B2 ani R2.

### Od gov.pl do chmury (kolejność)

PJM (tłumaczenia migowe) na gov.pl jest **wylistywane, nie pobierane**.

| Krok | Skąd | Co | Dokąd | Narzędzie |
|---|---|---|---|---|
| 1 | [gov.pl — prawo jazdy](https://www.gov.pl/web/infrastruktura/prawo-jazdy) | Excel + ZIP-y JPG/WMV (sytuacyjne) | `C:\ProgramData\prawko\gov-cache` (`baza_pytan.xlsx`, `zip\`) | `download-gov.ps1` albo `-SyncGov` |
| 2 | te ZIP-y | rozpakowanie w TEMP → WebP/MP4 | `C:\ProgramData\prawko\src\media\img` i `vid` | `convert-media.ps1` |
| 3 | Excel | JSON pytań (nazwy plików mediów) | `src\data\` (i kopia na serwerze) | `parse-excel.ps1` |
| 4 | `src\media` z kroku 2 | pojedyncze WebP i MP4 | Backblaze B2 `prawko-maz` → `img/` i `vid/` (oglądanie online, `MEDIA_CDN`) | `upload-media.ps1` (`.b2env`; `b2 sync --skipNewer`) |
| 5 | JSON + te same `img/` `vid/` | zipy kategorii + `manifest.json` | `%LOCALAPPDATA%\prawko\packs` | `build-media-packs.ps1` |
| 6 | ten folder `packs` | zipy + `manifest.json` | Cloudflare R2 `prawko-packs` (publiczny `PACKS_BASE`, `r2.dev`) | **ręcznie** panel Cloudflare → Objects → Upload (brak skryptu / wranglera) |
| 7 | opcjonalnie ten sam `packs` | kopia zipów | B2 `prawko-maz` → `packs/` | `upload-packs.ps1` — **nie** host aplikacji; B2 tnie duże zipy |

Kolejność 1 → 2 → 3 → 4 i 5 → 6. Krok 4 i 5 mogą iść równolegle (oba czytają skonwertowane media). 6 po 5. 7 na końcu, jeśli chcesz archiwum na B2.

Na macOS/Linux ta sama kolejność: `download-gov.py` → `convert-media.py` → `parse-excel.py` → `upload-media.py` / `build-media-packs.py` → panel R2. Ścieżki: `/usr/local/prawko/gov-cache` albo `/opt/prawko/gov-cache`; media serwera `/usr/local/prawko/src/media` albo `/opt/prawko/src/media`.

Na **zainstalowanym serwerze** przeglądarka pobiera opcjonalny `src/local.json` (gitignore; na github.io go nie ma) z tego samego originu co aplikacja. Klucze: `learnQuestionJump`, `mediaBase` (`media` = pliki na serwerze, `cdn` = Backblaze), `offlineDownload` (`packs` / `files`), opcjonalnie `packsBase` (własny host zipów). Bez pliku: github.io używa B2+R2; serwer bez mediów na dysku wymaga `mediaBase: "cdn"` albo `-SyncGov`.

W paczce MI brakuje pliku `!RS_Parking zastrzeżony.webp`. Parser **nie wycina** przez to pytania — nazwa z Excela zostaje, żeby zadziałał CDN albo późniejsze uzupełnienie.

Push na `main` odpala testy Playwright i wgrywa `src/` na GitHub Pages: [anabelmaz.github.io/prawko](https://anabelmaz.github.io/prawko/). Codzienna aplikacja to usługa na [http://localhost:5173](http://localhost:5173).

---

## Pipeline danych na Windows

Regeneracja JSON i mediów jest w **PowerShellu** (bez Pythona i bez Node w pipeline). Instalator woła te skrypty przez `-SyncGov` / `-MergeGov`. Ręcznie — tylko gdy wiesz, co robisz; zwykły user idzie przez instalator.

Wymagania poza instalatorem: **FFmpeg** i **cwebp** (`-SyncGov` kładzie przenośnego FFmpeg do `tools\`, jeśli brak w PATH).

| Skrypt | Zadanie |
|---|---|
| `scripts/download-gov.ps1` | Excel + ZIP z gov.pl → `C:\ProgramData\prawko\gov-cache` |
| `scripts/parse-excel.ps1` | Excel → `src/data/*.json` oraz `translations_{en,de,ua}.json`; domyślnie wypełnia braki (`-SkipTranslateGaps` wyłącza; `-GeminiApiKey` opcjonalnie) |
| `scripts/translate-questions.ps1` | To samo uzupełnianie osobno albo `. -LibraryOnly` + `Fill-MissingQuestionTranslations` (`-GeminiApiKey` albo sam Google) |
| `scripts/convert-media.ps1` | ZIP → TEMP → JPG→WebP, WMV→MP4 (TEMP kasowane; nie rusza PJM) |
| `scripts/merge-gov.ps1` | Dopisywanie braków MI (`-MergeGov`); też `. scripts\merge-gov.ps1 -LibraryOnly` |
| `scripts/filter-no-media.ps1` | **Raport** pytań z `media: null`. Kasowanie wierszy tylko z `-Remove` |
| `scripts/upload-media.ps1` | Sync `img/` `vid/` na B2 `prawko-maz` (online). Domyślnie ProgramData / LocalAppData / repo; `-MediaDir`. `--skipNewer` |
| `scripts/build-media-packs.ps1` | Zipy + `manifest.json` → `%LOCALAPPDATA%\prawko\packs` (nie git) |
| `scripts/upload-packs.ps1` | Opcjonalne archiwum zipów na B2 — **nie** host „Pobierz offline” |

Przykład — JSON z Excela już leżącego na dysku. Parser czyta `C:\ProgramData\prawko\gov-cache\baza_pytan.xlsx` i zapisuje gitowy katalog `src\data`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\parse-excel.ps1
```

Inny Excel / inny katalog wyjścia:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\parse-excel.ps1 `
  -Excel "C:\ProgramData\prawko\gov-cache\baza_pytan.xlsx" `
  -OutDir src\data
```

Gemini — ten sam układ co B2: skopiuj `scripts/geminienv.example` → `.geminienv` w katalogu repo (gitignore) i wklej klucz z [Google AI Studio](https://aistudio.google.com). Potem zwykłe komendy, **bez** parametru:

```powershell
Copy-Item scripts\geminienv.example .geminienv
# wpisz GEMINI_API_KEY=... w .geminienv
powershell -ExecutionPolicy Bypass -File .\scripts\translate-questions.ps1 -Lang ua
powershell -ExecutionPolicy Bypass -File .\scripts\parse-excel.ps1
.\Install_Prawko.windows.ps1 -SyncGov -SyncScope Questions
```

Albo klucz tylko na ten run, bez pliku: `-GeminiApiKey "WLEJ_KLUCZ"` / `--gemini-api-key`. Bez niczego zostaje Google Translate. Przy kluczu: dzienny 429 przełącza model; gdy wszystkie Flash-e wyczerpane albo błąd klucza — stop (postęp zapisany). Google tylko gdy odpalisz bez klucza.

`-DropMissingMedia` zeruje w JSON odwołania do plików, których nie ma w lokalnym raw. Bez tego przełącznika nazwy z Excela zostają (CDN).

Raport mediów (nic nie kasuje):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\filter-no-media.ps1
```

Zimny start (B2 + R2, dwa osobne wrzucenia):

```powershell
# .b2env w katalogu repo (szablon: scripts/b2env.example)
powershell -ExecutionPolicy Bypass -File .\scripts\upload-media.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\build-media-packs.ps1
# R2 prawko-packs: panel Cloudflare → Objects → Upload (manifest.json + zipy)
# opcjonalnie kopia zipów na B2:
# powershell -ExecutionPolicy Bypass -File .\scripts\upload-packs.ps1
```

Po pierwszym syncu B2 ustaw `MEDIA_CDN` w `src/js/data.js` na URL wypisany przez `upload-media.ps1`. `PACKS_BASE` to publiczny URL R2 (`r2.dev`), nie B2.

Aktualizacja pytań na stojącym serwerze: `-SyncGov -SyncScope Questions` albo `-SyncGov`. Pełny reinstal „dla pewności” nie jest potrzebny.

---

## Pipeline danych na macOS i Linuxie

Instalator to **`.sh`**. Reszta pipeline to **Python** (`python3`), bez Node i bez bliźniaków `.sh` / `.js` w `scripts/`. Node jest tylko do serwera aplikacji (`serve`). Ścieżka `gov-cache`: `python3 scripts/download-gov.py --print-gov-data-dir`. Ręcznie (z checkoutu):

| Skrypt | Zadanie |
|---|---|
| `scripts/download-gov.py` | Excel + ZIP z gov.pl → macOS: `/usr/local/prawko/gov-cache`; Linux: `/opt/prawko/gov-cache` |
| `scripts/parse-excel.py` | Excel → JSON (ten sam zestaw reguł co `parse-excel.ps1`; `--skip-translate-gaps` wyłącza fill; `--gemini-api-key` opcjonalnie) |
| `scripts/translate-questions.py` | To samo uzupełnianie osobno albo `fill_missing(data_dir, gemini_api_key=…)` |
| `scripts/convert-media.py` | ZIP → TEMP → JPG→WebP, WMV→MP4 (TEMP kasowane; VideoToolbox, gdy jest; nie rusza PJM) |
| `scripts/filter-no-media.py` | Raport; kasowanie tylko z `--remove` |
| `scripts/merge-gov.py` | Dopisywanie braków MI (`--merge-gov`) |
| `scripts/upload-media.py` | Sync `img/` `vid/` na B2 (online). `--skipNewer`. `--media-dir` |
| `scripts/build-media-packs.py` | To samo co `build-media-packs.ps1` (zipy + manifest) |
| `scripts/upload-packs.py` | Opcjonalne archiwum zipów na B2 — nie host „Pobierz offline” |

```bash
python3 scripts/download-gov.py --excel-only
python3 scripts/parse-excel.py --out-dir src/data
# python3 scripts/parse-excel.py --out-dir src/data --gemini-api-key KEY
# python3 scripts/translate-questions.py --lang ua --gemini-api-key KEY
python3 scripts/convert-media.py
# python3 scripts/upload-media.py
# python3 scripts/build-media-packs.py
# R2 dashboard: Objects → Upload (manifest.json + zips)
```

---

## Źródło danych

Pytania egzaminacyjne pochodzą z oficjalnej bazy Ministerstwa Infrastruktury:  
https://www.gov.pl/web/infrastruktura/prawo-jazdy

- **Stan katalogu:** lipiec 2026 (`KATALOG_dla_kandydatów_na_kierowców_072026.xlsx`; Excel zapisany 15 czerwca 2026)
- **Treść pytań:** CC BY-SA 4.0
- **Materiały audiowizualne:** CC BY-NC-ND 4.0 (użytek niekomercyjny, bez opracowań)

## Licencja kodu

Kod aplikacji jest na [ISC](LICENSE) (tak jak w `package.json` źródła). Przy kopiowaniu zostaw zastrzeżenie praw. Mediów z MI **nie** commitujemy (`src/media`). Atrybucja jest też na stronie „Źródło danych” w aplikacji.

---

# Prawko — Polish driving licence exam

A PWA for learning and simulating the Polish theoretical driving test. This is a **fork** of [szkocot/prawko](https://github.com/szkocot/prawko): WORD station layout, Panel/Station skins, local profiles, and a rebuilt learn mode. Small fixes can still go upstream; the full **Windows**, **macOS**, and **Linux** product stays here.

You do **not** need a local install to use it. Open [anabelmaz.github.io/prawko](https://anabelmaz.github.io/prawko/): that is the full app. You can install it as a PWA, tap **Download offline** on a category, and study without a network. Because of Backblaze limits, **photos and films may stay empty until you download the pack** on that device; after that they run locally (zip packs from Cloudflare R2).

Run your own server only if you want the app on your machine or need to **load a newer ministry question and media catalogue** — the public files can lag behind the current Excel on [gov.pl](https://www.gov.pl/web/infrastruktura/prawo-jazdy).

The repo JSON is that catalogue (**3518** unique questions, **July 2026**, `KATALOG_dla_kandydatów_na_kierowców_072026.xlsx`). Playback is Backblaze; **Download offline** is R2 zips.

## Install on Windows

The Windows installer is **`Install_Prawko.windows.ps1`** (same naming scheme as `Install_Prawko.macos.sh` and `Install_Prawko.linux.sh`).

**Windows 10/11** is the supported PC target. Python is not required for install or for the Windows data pipeline.

### Requirements

| | |
|---|---|
| OS | Windows 10 or 11 |
| Shell | Windows PowerShell 5.1 or later |
| Privileges | First install needs **Administrator** (Node.js, NSSM, Windows service) |
| Network | GitHub (app ZIP and tools). Playback from Backblaze, offline packs from Cloudflare; the local ministry pack is optional |
| Git | **No** — only with `-Dev` |
| Python | **Not used** |

The installer installs **Node.js** and **NSSM** if they are missing. It does not install Git unless you pass `-Dev`.

### Quick start

1. Download [`Install_Prawko.windows.ps1`](https://github.com/AnabelMaz/prawko/blob/main/Install_Prawko.windows.ps1) (**Raw**, then Save as) anywhere. You do **not** need to clone the repo first.
2. In PowerShell, in that folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1
```

Download the file to disk (`-OutFile` or Raw → Save as). Do not paste it into Notepad — Windows PowerShell 5.1 needs UTF-8 with a BOM.

Or without a browser:

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/AnabelMaz/prawko/main/Install_Prawko.windows.ps1 -OutFile Install_Prawko.windows.ps1
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1
```

3. Open [http://localhost:5173](http://localhost:5173).

If Windows blocks the script, keep `-ExecutionPolicy Bypass` as above — it applies to this process only. All switches: `Install_Prawko.windows.ps1 -Help`.

### What the default install does

With no switches the installer:

- installs Node.js and NSSM if needed,
- downloads the [AnabelMaz/prawko](https://github.com/AnabelMaz/prawko) (`main`) ZIP into `C:\ProgramData\prawko` (**no Git**),
- registers the **PrawkoWORDService** Windows service,
- serves the app on port **5173**.

Questions come from the repo JSON. Photos and films stream from the public Backblaze bucket `prawko-maz`. “Download offline” pulls zip packs from Cloudflare R2. If the service is already running, a second run **with no switches does not overwrite** it.

After a code overlay, an open tab may show an "Update available" banner — use **Refresh**; a hard reload is not required.

### Where files land

| What | Path |
|---|---|
| App and service | `C:\ProgramData\prawko` |
| Excel + media ZIPs from gov.pl | `C:\ProgramData\prawko\gov-cache` (kept after `-Uninstall`) |
| JPG/WMV unpack (scratch) | `%TEMP%\prawko\raw` (deleted after convert) |
| Converted WebP / MP4 and Excel JSON | `C:\ProgramData\prawko\src\media` and `src\data` |
| Portable FFmpeg (if `-SyncGov` / `-MergeGov` and none on PATH) | `C:\ProgramData\prawko\tools` |

A normal user does **not** need a second git clone. `-SyncGov` does not duplicate media next to the checkout.

### Installer switches

| Switch | Effect |
|---|---|
| *(none)* | Server: GitHub ZIP, repo questions, CDN media |
| `-SyncGov` | Gov.pl → staging → server. Default **Full** (Excel + ZIP + WebP/MP4 + JSON). No PJM (~10 GB) |
| `-SyncScope Questions\|Media\|Full` | Scope for `-SyncGov`: questions only / ZIP→TEMP→WebP·MP4 / full (default) |
| `-SyncUseCache` | Skip gov.pl when `gov-cache` already has Excel and ZIPs |
| `-DropMissingMedia` | With `-SyncGov` (Full/Media): strip JSON media without local files. **Off** by default |
| `-SkipTranslateGaps` | With `-SyncGov` Questions/Full: do not fill empty EN/DE/UA. **Fills** by default (Gemini when a key is present, else Google Translate) |
| `-GeminiApiKey <key>` | With `-SyncGov` Questions/Full: Gemini for this run (overrides `.geminienv`). Without the switch: `.geminienv` like `.b2env`. With a key: Gemini only (daily 429 → next Flash). No key: Google |
| `-MergeGov` | On a running server: append ministry Excel rows that are missing |
| `-Export <path>` | Portable pack: code + **default** server snapshot (`data`, `media`, `local.json`, `manifest.json`) |
| `-ExcludeData` / `-ExcludeMedia` / `-ExcludeLocalJson` | Slim down `-Export` (all included by default) |
| `-IncludeGovCache` | Add `gov-cache` (Excel + ZIPs) to export; not the server snapshot |
| `-Import <path>` | Restore from export pack (server must already be up). `-ImportScope Auto\|Code\|Runtime`, `-ImportForce` |
| `-Dev <folder>` | Git clone only — **no** Node, **no** server |
| `-Patch` | Overlay code from local clone (`-Dev`; `src\`, skip `data\` and `media\`) |
| `-Uninstall` | Remove the service and `C:\ProgramData\prawko` **except** `gov-cache` |
| `-NonInteractive` / `-Help` | No Enter pause / full help |

Administrator only for the **first server install** or `-Uninstall`.

### Optional local ministry pack (several GB)

Default install is enough (repo JSON, CDN media).

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -SyncGov
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -SyncGov -SyncScope Questions
```

Excel and ZIPs → `C:\ProgramData\prawko\gov-cache`. Unpack JPG/WMV in TEMP, then delete. WebP/MP4 and JSON → `C:\ProgramData\prawko\src\`.

### Export and import (USB / new PC)

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Export D:\backup\prawko-pack
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Import D:\backup\prawko-pack
```

Code-only pack: add `-ExcludeData -ExcludeMedia -ExcludeLocalJson`. On a new PC: install **with no switches** first, then `-Import`.

### Developer install

Code only, no localhost and no Node:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Dev D:\prawko
```

Git is installed only here. This does **not** set up the server. The folder must be **empty** or not exist yet (not `C:\ProgramData\prawko`).

Both (app + git): run the installer **with no switches** first, then `-Dev`.

Preview your changes on a running server (after `-Dev`):

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Patch
```

`-Patch` overlays `src` from the clone and **skips** `data\` and `media\`.

### Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Uninstall
```

Removes the service and `C:\ProgramData\prawko` (including FFmpeg from `-SyncGov`). `C:\ProgramData\prawko\gov-cache` and Git / Node / NSSM remain.

---

## Install on macOS

Same product as Windows: download **one script**, it does the rest (tools, ZIP, service, port **5173**). The service is **launchd**, not NSSM.

### Requirements

| | |
|---|---|
| OS | macOS (Intel or Apple Silicon) |
| Shell | built-in bash — you do **not** clone the repo or install Homebrew first |
| Privileges | First install asks for the **administrator password** (sudo), like UAC on Windows |
| Python | Only for `--sync-gov` / `--merge-gov`. Not needed to run the app |

The installer installs **Homebrew** if missing, then **Node.js**. Git is installed only with `--dev`.

### Quick start

1. Download [`Install_Prawko.macos.sh`](https://github.com/AnabelMaz/prawko/blob/main/Install_Prawko.macos.sh) (**Raw**, then Save as) anywhere. You do **not** need to clone the repo first.
2. In Terminal, in that folder:

```bash
bash Install_Prawko.macos.sh
```

Or without a browser:

```bash
curl -fsSL -o Install_Prawko.macos.sh https://raw.githubusercontent.com/AnabelMaz/prawko/main/Install_Prawko.macos.sh
bash Install_Prawko.macos.sh
```

3. Open [http://localhost:5173](http://localhost:5173).

No `chmod +x` — run it with `bash`, like `powershell -File` on Windows. All switches: `bash Install_Prawko.macos.sh --help`.

### What the default install does

With no switches the installer:

- installs **Homebrew** if missing (like winget on Windows),
- installs **Node.js**,
- downloads the [AnabelMaz/prawko](https://github.com/AnabelMaz/prawko) (`main`) ZIP into `/usr/local/prawko` (**no Git**),
- registers LaunchDaemon **pl.prawko.word**,
- serves the app on port **5173**.

If the service is already running, a second run **with no switches does not overwrite** it.

### Where files land

| What | Path |
|---|---|
| App and launchd | `/usr/local/prawko` |
| Excel + media ZIPs from gov.pl | `/usr/local/prawko/gov-cache` |
| JPG/WMV unpack (scratch) | `$TMPDIR/prawko/raw` (deleted after convert) |
| Converted WebP / MP4 and Excel JSON | `/usr/local/prawko/src/media` and `src/data` |
| plist | `/Library/LaunchDaemons/pl.prawko.word.plist` |

### Switches (same jobs as Windows)

Same flags as the Windows table (`--sync-gov`, `--export`, `--import`, `--merge-gov`, etc.).

```bash
bash Install_Prawko.macos.sh --sync-gov
bash Install_Prawko.macos.sh --export ~/Desktop/prawko-pack
bash Install_Prawko.macos.sh --import ~/Desktop/prawko-pack
bash Install_Prawko.macos.sh --dev ~/prawko
bash Install_Prawko.macos.sh --patch
```

`--sync-gov` and `--merge-gov` need **Python**. Sudo only on first server install or `--uninstall`.

### Developer install (macOS)

Code only, no localhost and no Node:

```bash
bash Install_Prawko.macos.sh --dev ~/prawko
```

Git is installed only here (and only if Homebrew is already present — otherwise `xcode-select --install` or `brew install git`). This does **not** set up the server. The folder must be **empty** or not exist yet (not `/usr/local/prawko`).

Both (app + git): run the script **with no switches** first, then `--dev`.

```bash
bash Install_Prawko.macos.sh --patch
```

---

## Install on Linux

Same product: one script, ZIP, Node, port **5173**. The service is **systemd** (not launchd, not NSSM). App directory: **`/opt/prawko`**.

Needs **systemd** (Ubuntu, Debian, Fedora, Arch, openSUSE and similar). Alpine / OpenRC — install Node 18+ yourself and serve `src/` by hand.

### Requirements

| | |
|---|---|
| OS | Linux with systemd, x86_64 or aarch64 (glibc) |
| Shell | bash |
| Privileges | First install: **sudo** (`/opt/prawko` and the systemd unit) |
| Python | Only for `--sync-gov` / `--merge-gov` |

Node: PATH first (18+), then the distro package (`apt` / `dnf` / `yum` / `pacman` / `zypper` / `apk`), then the official nodejs.org tarball into `/opt/prawko/tools/node`. Homebrew on Linux is **not** used. `--dev` does not install Git — use `sudo apt install git` (or your distro’s equivalent).

### Quick start

1. Download [`Install_Prawko.linux.sh`](https://github.com/AnabelMaz/prawko/blob/main/Install_Prawko.linux.sh) (**Raw**, then Save as). You do **not** need to clone the repo first.
2. In a terminal, in that folder:

```bash
bash Install_Prawko.linux.sh
```

Or without a browser:

```bash
curl -fsSL -o Install_Prawko.linux.sh https://raw.githubusercontent.com/AnabelMaz/prawko/main/Install_Prawko.linux.sh
bash Install_Prawko.linux.sh
```

3. Open [http://localhost:5173](http://localhost:5173).

All switches: `bash Install_Prawko.linux.sh --help`. Same flags as macOS (`--sync-gov`, `--export`, `--import`, …).

### Where files land

| What | Path |
|---|---|
| App and systemd | `/opt/prawko` |
| Unit | `/etc/systemd/system/prawko.service` |
| Excel + media ZIPs from gov.pl | `/opt/prawko/gov-cache` |
| JPG/WMV unpack (scratch) | `$TMPDIR/prawko/raw` (deleted after convert) |
| Converted WebP / MP4 and Excel JSON | `/opt/prawko/src/media` and `src/data` |
| Node tarball (if no distro Node 18+) | `/opt/prawko/tools/node` |

```bash
bash Install_Prawko.linux.sh --sync-gov
bash Install_Prawko.linux.sh --export ~/prawko-pack
bash Install_Prawko.linux.sh --import ~/prawko-pack
bash Install_Prawko.linux.sh --dev ~/prawko
bash Install_Prawko.linux.sh --patch
```

---

## Features

- **Learn mode** — questions by category, no timer, progress remembered
- **Exam simulation** — 32 questions, 25 minutes, official scoring
- **12 categories** — A, A1, A2, AM, B, B1, C, C1, D, D1, PT, T
- **Skins** — Panel and Station
- **Media** — official photos and films (Backblaze stream, Cloudflare offline packs, or local after `-SyncGov`)
- **Languages** — PL, EN, DE, UA (UI and question text)
- **Dark / light theme** — persisted in the browser
- **Local profiles** — progress on this machine
- **Offline** — PWA / service worker; “Download offline” fetches zip packs from Cloudflare R2 into Cache Storage
- **Layout** — phone and wide station screens

## Exam rules

Per the regulation (Dz.U. 2023 item 2659):

- 20 basic questions (YES/NO, 20 s) + 12 specialist questions (A/B/C, 50 s)
- **74** points maximum, pass mark **68** (92 %)
- **25** minutes total
- Each question’s points come from the ministry catalogue; the type follows the correct answer (**T/N** = basic, **A/B/C** = specialist), not the “Zakres struktury” column (that column is sometimes wrong)

## Languages

The in-app control cycles **PL → EN → DE → UA**. First visit: browser language, otherwise English. UI chrome: selected language → EN → PL. Question text missing in the selected language: **English**, then Polish.

Non-Polish question text comes from the ministry Excel (`Pytanie [EN]`, `Pytanie [D]`, `Pytanie [UA]`) into `src/data/translations_{en,de,ua}.json` via `parse-excel.ps1` (`ua` = Ukrainian, not UK). The parser **by default** fills empty Excel columns through `translate-questions`. Gemini when a key is available: `-GeminiApiKey` / `--gemini-api-key` for this run, or gitignored `.geminienv` at the repo root (template `scripts/geminienv.example`, same idea as `.b2env`), or `GEMINI_API_KEY` in the environment. No key: Google Translate. With a key: Gemini only (Flash list from the API, lite first); 404 and daily 429 try the next model; when every Flash is exhausted — save and stop, no Google. A verify failure skips that question. Opt out: `-SkipTranslateGaps` / `--skip-translate-gaps`. A later parse **keeps** those fills and only overwrites IDs the ministry already has.

## Data and media

| | In git | Windows | macOS | Linux |
|---|---|---|---|---|
| Question JSON | `src/data/` | `C:\ProgramData\prawko\src\data` | `/usr/local/prawko/src/data` | `/opt/prawko/src/data` |
| Photos / films | no (empty `src/media`) | CDN or `C:\ProgramData\prawko\src\media` | CDN or `/usr/local/prawko/src/media` | CDN or `/opt/prawko/src/media` |
| Excel + media ZIPs | no | `C:\ProgramData\prawko\gov-cache` | `/usr/local/prawko/gov-cache` | `/opt/prawko/gov-cache` |
| JPG / WMV (scratch) | no | `%TEMP%\prawko\raw` | `$TMPDIR/prawko/raw` | `$TMPDIR/prawko/raw` |

A clean clone does **not** need `-SyncGov`. JSON is in `src/data`. Defaults (github.io and localhost without files on disk):

| What | Where | Constant in `src/js/data.js` |
|---|---|---|
| Playing `img/` and `vid/` | Backblaze B2 `prawko-maz` | `MEDIA_CDN` |
| “Download offline” (zip + manifest) | Cloudflare R2 `prawko-packs` | `PACKS_BASE` (`https://pub-….r2.dev`) |

Packs stay on the free `r2.dev` public development URL (no paid custom domain). The old per-file B2 fetch remains in code (`OFFLINE_DOWNLOAD = 'files'`).

**Two hosts, always both** — treat the buckets as empty. The installer (`-SyncGov`) only fills the local disk (steps 1–3). It does **not** upload to B2 or R2.

### From gov.pl to the cloud (order)

PJM (sign-language) links on gov.pl are **listed, not downloaded**.

| Step | From | What | To | Tool |
|---|---|---|---|---|
| 1 | [gov.pl — driving licence](https://www.gov.pl/web/infrastruktura/prawo-jazdy) | Excel + JPG/WMV ZIPs (situational) | `C:\ProgramData\prawko\gov-cache` (`baza_pytan.xlsx`, `zip\`) | `download-gov.ps1` or `-SyncGov` |
| 2 | those ZIPs | unpack in TEMP → WebP/MP4 | `C:\ProgramData\prawko\src\media\img` and `vid` | `convert-media.ps1` |
| 3 | Excel | question JSON (media file names) | `src\data\` (and the server copy) | `parse-excel.ps1` |
| 4 | `src\media` from step 2 | individual WebP and MP4 | Backblaze B2 `prawko-maz` → `img/` and `vid/` (online play, `MEDIA_CDN`) | `upload-media.ps1` (`.b2env`; `b2 sync --skipNewer`) |
| 5 | JSON + the same `img/` `vid/` | category zips + `manifest.json` | `%LOCALAPPDATA%\prawko\packs` | `build-media-packs.ps1` |
| 6 | that `packs` folder | zips + `manifest.json` | Cloudflare R2 `prawko-packs` (public `PACKS_BASE`, `r2.dev`) | **manually** Cloudflare dashboard → Objects → Upload (no script / wrangler) |
| 7 | optionally the same `packs` | zip archive | B2 `prawko-maz` → `packs/` | `upload-packs.ps1` — **not** the app host; B2 throttles large zips |

Order: 1 → 2 → 3 → 4 and 5 → 6. Steps 4 and 5 can run in parallel (both read converted media). 6 after 5. 7 last, if you want a B2 archive.

On macOS/Linux the same order: `download-gov.py` → `convert-media.py` → `parse-excel.py` → `upload-media.py` / `build-media-packs.py` → R2 dashboard. Paths: `/usr/local/prawko/gov-cache` or `/opt/prawko/gov-cache`; server media `/usr/local/prawko/src/media` or `/opt/prawko/src/media`.

On an **installed server** the browser fetches optional `src/local.json` (gitignored; not on github.io) from the same origin as the app. Keys: `learnQuestionJump`, `mediaBase` (`media` = files on the server, `cdn` = Backblaze), `offlineDownload` (`packs` / `files`), optional `packsBase` (your zip host). Without the file: github.io uses B2+R2; a server with no media on disk needs `mediaBase: "cdn"` or `-SyncGov`.

The ministry pack is missing `!RS_Parking zastrzeżony.webp`. The parser does **not** drop that question — the Excel file name stays so the CDN or a later file can fill it.

A push to `main` runs Playwright and publishes `src/` to GitHub Pages: [anabelmaz.github.io/prawko](https://anabelmaz.github.io/prawko/). Day-to-day use is the service at [http://localhost:5173](http://localhost:5173).

---

## Data pipeline on Windows

Regenerate JSON and media with **PowerShell** (no Python and no Node in the pipeline). The installer runs these via `-SyncGov` / `-MergeGov`. Manual runs are for advanced use.

Besides the installer: media conversion needs **FFmpeg** and **cwebp** (`-SyncGov` can drop a portable FFmpeg into `tools\` if none is on PATH).

| Script | Job |
|---|---|
| `scripts/download-gov.ps1` | Excel + ZIPs from gov.pl → `C:\ProgramData\prawko\gov-cache` |
| `scripts/parse-excel.ps1` | Excel → `src/data/*.json` and `translations_{en,de,ua}.json`; fills gaps by default (`-SkipTranslateGaps` disables; optional `-GeminiApiKey`) |
| `scripts/translate-questions.ps1` | Same fill standalone, or `. -LibraryOnly` + `Fill-MissingQuestionTranslations` (`-GeminiApiKey` or Google only) |
| `scripts/convert-media.ps1` | ZIP → TEMP → JPG→WebP, WMV→MP4 (TEMP deleted; does not touch PJM) |
| `scripts/merge-gov.ps1` | Append missing ministry rows (`-MergeGov`); also `. scripts\merge-gov.ps1 -LibraryOnly` |
| `scripts/filter-no-media.ps1` | **Report** questions with `media: null`. Drops rows only with `-Remove` |
| `scripts/upload-media.ps1` | Sync `img/` `vid/` to B2 `prawko-maz` (online). Default ProgramData / LocalAppData / repo; `-MediaDir`. `--skipNewer` |
| `scripts/build-media-packs.ps1` | Zips + `manifest.json` → `%LOCALAPPDATA%\prawko\packs` (not git) |
| `scripts/upload-packs.ps1` | Optional zip archive on B2 — **not** the “Download offline” host |

Parse an Excel file already on disk. The parser reads `C:\ProgramData\prawko\gov-cache\baza_pytan.xlsx` and writes the git catalog `src\data`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\parse-excel.ps1
```

Another Excel / output folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\parse-excel.ps1 `
  -Excel "C:\ProgramData\prawko\gov-cache\baza_pytan.xlsx" `
  -OutDir src\data
```

Gemini — same pattern as B2: copy `scripts/geminienv.example` → `.geminienv` at the repo root (gitignored) and paste the key from [Google AI Studio](https://aistudio.google.com). Then the usual commands, **no** parameter:

```powershell
Copy-Item scripts\geminienv.example .geminienv
# set GEMINI_API_KEY=... in .geminienv
powershell -ExecutionPolicy Bypass -File .\scripts\translate-questions.ps1 -Lang ua
powershell -ExecutionPolicy Bypass -File .\scripts\parse-excel.ps1
.\Install_Prawko.windows.ps1 -SyncGov -SyncScope Questions
```

Or this run only, no file: `-GeminiApiKey "PASTE_KEY"` / `--gemini-api-key`. With neither, Google Translate stays. With a key: daily 429 switches model; when every Flash is exhausted or the key fails — stop (progress saved). Google only if you run without a key.

`-DropMissingMedia` clears JSON media names whose files are missing from local raw. Without it, Excel names stay (CDN).

Report only (does not delete questions):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\filter-no-media.ps1
```

Cold start (B2 + R2, two separate uploads):

```powershell
# .b2env at the repo root (template: scripts/b2env.example)
powershell -ExecutionPolicy Bypass -File .\scripts\upload-media.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\build-media-packs.ps1
# R2 prawko-packs: Cloudflare dashboard → Objects → Upload (manifest.json + zips)
# optional zip archive on B2:
# powershell -ExecutionPolicy Bypass -File .\scripts\upload-packs.ps1
```

After the first B2 sync, set `MEDIA_CDN` in `src/js/data.js` to the URL `upload-media.ps1` prints. `PACKS_BASE` is the public R2 URL (`r2.dev`), not B2.

To refresh questions on a running server: `-SyncGov -SyncScope Questions` or `-SyncGov`. A full reinstall is not needed.

---

## Data pipeline on macOS and Linux

The installer is **`.sh`**. The rest of the pipeline is **Python** (`python3`), with no Node and no `.sh` / `.js` twins under `scripts/`. Node is only for the app server (`serve`). `gov-cache` path: `python3 scripts/download-gov.py --print-gov-data-dir`. To run them yourself from a checkout:

| Script | Job |
|---|---|
| `scripts/download-gov.py` | Excel + ZIPs from gov.pl → macOS: `/usr/local/prawko/gov-cache`; Linux: `/opt/prawko/gov-cache` |
| `scripts/parse-excel.py` | Excel → JSON (same rules as `parse-excel.ps1`; `--skip-translate-gaps` skips fill; optional `--gemini-api-key`) |
| `scripts/translate-questions.py` | Same fill standalone, or `fill_missing(data_dir, gemini_api_key=…)` |
| `scripts/convert-media.py` | ZIP → TEMP → JPG→WebP, WMV→MP4 (TEMP deleted; VideoToolbox when available; skips PJM) |
| `scripts/filter-no-media.py` | Report; delete rows only with `--remove` |
| `scripts/merge-gov.py` | Add missing ministry rows (`--merge-gov`) |
| `scripts/upload-media.py` | Sync `img/` `vid/` to B2 (online). `--skipNewer`. `--media-dir` |
| `scripts/build-media-packs.py` | Same job as `build-media-packs.ps1` (zips + manifest) |
| `scripts/upload-packs.py` | Optional zip archive on B2 — not the “Download offline” host |

```bash
python3 scripts/download-gov.py --excel-only
python3 scripts/parse-excel.py --out-dir src/data
# python3 scripts/parse-excel.py --out-dir src/data --gemini-api-key KEY
# python3 scripts/translate-questions.py --lang ua --gemini-api-key KEY
python3 scripts/convert-media.py
# python3 scripts/upload-media.py
# python3 scripts/build-media-packs.py
# R2 dashboard: Objects → Upload (manifest.json + zips)
```

---

## Data source

Questions come from the official Ministry of Infrastructure database:  
https://www.gov.pl/web/infrastruktura/prawo-jazdy

- **Catalogue date:** July 2026 (`KATALOG_dla_kandydatów_na_kierowców_072026.xlsx`; Excel last saved 15 June 2026)
- **Question text:** CC BY-SA 4.0
- **Audiovisual materials:** CC BY-NC-ND 4.0 (non-commercial, no derivatives)

## License

Application **code** is [ISC](LICENSE) (same as upstream `package.json`). Keep the copyright notice when you copy it.

Ministry **question text** is CC BY-SA 4.0. Ministry **photos and films** are CC BY-NC-ND 4.0: non-commercial, no derivatives, do not commit `src/media` to git. See the in-app “Źródło danych” page for attribution.
