# Prawko

Aplikacja PWA do nauki i symulacji egzaminu teoretycznego na prawo jazdy w Polsce.

To **fork** projektu [szkocot/prawko](https://github.com/szkocot/prawko) (demo źródła: https://szkocot.github.io/prawko/). Ta kopia: repozytorium [AnabelMaz/prawko](https://github.com/AnabelMaz/prawko), podgląd w przeglądarce [anabelmaz.github.io/prawko](https://anabelmaz.github.io/prawko/). Trzyma układ stacji WORD, skórki Panel/Stacja, profile lokalne i przebudowany tryb nauki. Małe, samodzielne łatki mogą iść do repozytorium źródłowego; tutaj zostaje pełna wersja na **Windows**, **macOS** i **Linux**.

Baza w repozytorium to JSON z katalogu Ministerstwa Infrastruktury (**3518** unikalnych pytań). Zdjęcia i filmy nie są w gicie: **oglądanie** z Backblaze, **„Pobierz offline”** to zipy z Cloudflare R2. Publiczny katalog na [gov.pl](https://www.gov.pl/web/infrastruktura/prawo-jazdy): **lipiec 2026** (`KATALOG_dla_kandydatów_na_kierowców_072026.xlsx`).

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
| ZIP / surowe JPG·WMV z gov.pl | `%LOCALAPPDATA%\prawko\gov-data` |
| Skonwertowane WebP / MP4 i JSON z Excela | `C:\ProgramData\prawko\src\media` oraz `src\data` |
| FFmpeg przenośny (przy `-InstallGov` / `-Merge`, gdy nie ma w PATH) | `C:\ProgramData\prawko\tools` |

Zwykły użytkownik **nie potrzebuje** drugiego klona gita. `-InstallGov` nie kopiuje mediów jeszcze raz obok checkoutu.

Jedyna powtórka przy `-InstallGov`: archiwum ZIP + rozpakowane JPG/WMV (cache, żeby nie ściągać od zera) oraz surowe pliki + WebP/MP4 (źródło vs to, co odtwarza przeglądarka). To nie są dwie kopie tej samej paczki w ProgramData i w gicie.

### Przełączniki instalatora

| Przełącznik | Działanie |
|---|---|
| *(brak)* | Instalacja serwera, pytania z repo; oglądanie z Backblaze, offline z Cloudflare |
| `-InstallGov` | Excel + ZIP multimediów sytuacyjnych z gov.pl; konwersja WebP/MP4 na serwer. **Nie** pobiera tłumaczeń migowych (PJM, ~10 GB) |
| `-GovQuestions` | Tylko katalog pytań (Excel → JSON na serwerze). Nie rusza mediów ani CDN |
| `-DropMissingMedia` | Tylko z `-InstallGov`: wykreśla z JSON media, których nie ma w lokalnym raw. **Domyślnie wyłączone** — nazwa z Excela zostaje (CDN) |
| `-Dev <folder>` | Tylko Git + klon do pracy. **Bez** Node i **bez** serwera |
| `-Patch` | Overlay `src` z contrib (bez `data\` i `media\`). Na **stojącym** serwerze nic nie doinstalowuje. **Bez** serwera = ZIP + Node + usługa + overlay |
| `-Merge` | Na **stojącym** serwerze dopisuje z Excela MI tylko braki. Bez serwera = błąd |
| `-Export <ścieżka>` | Paczka do innego folderu (instalator + contrib), bez ruszania serwera |
| `-Uninstall` | Usuwa usługę i `C:\ProgramData\prawko`. Git / Node / NSSM zostają w systemie |
| `-NonInteractive` | Bez pauzy Enter na końcu |
| `-Help` | Pełna pomoc |

Każdy przełącznik doinstalowuje **tylko to, czego używa**:

| Akcja | Może doinstalować | Nie rusza |
|---|---|---|
| *(brak)* | Node, NSSM, ZIP aplikacji, usługa | Git |
| `-Dev` | Git + klon | Node, NSSM, serwer |
| `-Patch` | nic, gdy serwer stoi; bez serwera: Node + usługa + overlay | Git |
| `-InstallGov` | FFmpeg gdy brak | Git, reinstal usługi |
| `-GovQuestions` | Excel z gov.pl | Git, Node, serwer |
| `-Merge` | Excel; zapis do stojącego serwera | pełny reinstal (brak serwera = błąd) |
| `-Export` | nic | serwer |
| `-Uninstall` | nic nowego | Git / Node / NSSM zostają |

Administrator tylko przy **pierwszej instalacji serwera** albo `-Uninstall`.

### Lokalna paczka ministerstwa (opcjonalnie, kilka GB)

Domyślna instalacja **wystarcza do nauki i egzaminu**. JSON jest w repo; oglądanie z Backblaze, „Pobierz offline” z Cloudflare.

Lokalne WebP/MP4 (na dysku serwera, bez B2/R2, albo własna kopia):

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -InstallGov
```

Staging (ZIP, surowe JPG/WMV) ląduje w `%LOCALAPPDATA%\prawko\gov-data`. Konwersja i JSON — tylko na serwerze w ProgramData. Gdy na `C:` mało miejsca, ZIP/raw mogą spaść do `gov-data` w checkoutcie na innym dysku.

Sam katalog pytań, bez ściągania filmów:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -GovQuestions
```

### Instalacja dla dewelopera

Sam kod, bez localhost i bez Node:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Dev D:\prawko
```

Git doinstaluje się tylko tu. Serwera to **nie** stawia. Folder musi być **pusty** albo jeszcze nie istnieć (nie `C:\ProgramData\prawko`).

Oba (aplikacja + git): najpierw instalator **bez** przełączników, potem `-Dev`.

Na podgląd localhost z Twojego kodu (gdy serwer już stoi):

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Patch
```

`-Patch` nakłada `src` z contrib, **bez** `data\` i `media\`. Gov ZIP-y i WebP nie idą drugi raz do folderu gita. Gdy serwer już stoi — tylko overlay. Gdy nie stoi — najpierw ZIP + usługa, potem overlay.

### Odinstalowanie

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Uninstall
```

Znika usługa i `C:\ProgramData\prawko` (w tym FFmpeg ściągnięty tam przez `-InstallGov`). Katalog `%LOCALAPPDATA%\prawko\gov-data` oraz Git / Node / NSSM zostają.

---

## Instalacja na macOS

Ten sam produkt co na Windowsie: ściągasz **jeden skrypt**, resztę robi on sam (narzędzia, ZIP, usługa, port **5173**). Usługa to **launchd**, nie NSSM.

### Wymagania

| | |
|---|---|
| System | macOS (Intel albo Apple Silicon) |
| Powłoka | bash (wbudowany) — **nie** musisz klonować repo ani instalować Homebrew wcześniej |
| Uprawnienia | Pierwsza instalacja zapyta o **hasło administratora** (sudo), jak UAC na Windows |
| Python | Tylko przy `--install-gov` / `--gov-questions` / `--merge`. Do samego serwera **nie** |

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
| ZIP / surowe JPG·WMV z gov.pl | `~/Library/Application Support/prawko/gov-data` |
| Skonwertowane WebP / MP4 i JSON z Excela | `/usr/local/prawko/src/media` oraz `src/data` |
| plist | `/Library/LaunchDaemons/pl.prawko.word.plist` |

### Przełączniki (jak na Windowsie)

| macOS | Windows | Działanie |
|---|---|---|
| *(brak)* | *(brak)* | Serwer, pytania z repo; oglądanie z Backblaze, offline z Cloudflare |
| `--install-gov` | `-InstallGov` | Excel + ZIP z gov.pl; WebP/MP4 na serwer. **Nie** pobiera PJM |
| `--gov-questions` | `-GovQuestions` | Tylko Excel → JSON na serwerze |
| `--drop-missing-media` | `-DropMissingMedia` | Tylko z `--install-gov`; domyślnie **wyłączone** |
| `--dev <folder>` | `-Dev <folder>` | Tylko Git + klon. **Bez** Node i **bez** serwera. Nie `/usr/local/prawko` |
| `--patch` | `-Patch` | Overlay `src` bez `data/` i `media/`. Na stojącym serwerze nic nie doinstalowuje. Bez serwera = ZIP + Node + launchd + overlay |
| `--merge` | `-Merge` | Dopisz z Excela MI tylko braki; **wymaga** serwera |
| `--export <ścieżka>` | `-Export` | Paczka instalator + contrib |
| `--uninstall` | `-Uninstall` | Usuwa launchd i `/usr/local/prawko` |
| `--non-interactive` | `-NonInteractive` | Bez pauzy Enter |
| `--help` | `-Help` | Pomoc |

```bash
./Install_Prawko.macos.sh --install-gov
./Install_Prawko.macos.sh --gov-questions
./Install_Prawko.macos.sh --dev ~/prawko
./Install_Prawko.macos.sh --patch
./Install_Prawko.macos.sh --uninstall
```

Na macOS `--gov-questions`, `--install-gov` i `--merge` potrzebują **Pythona** (gov.pl + Excel). Node jest tylko do serwera aplikacji. `--dev` tego nie rusza. Sudo tylko przy pierwszej instalacji serwera albo `--uninstall`.

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
| Python | Tylko przy `--install-gov` / `--gov-questions` / `--merge` |

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

Pełna lista: `bash Install_Prawko.linux.sh --help`. Przełączniki jak na macOS (`--dev`, `--patch`, `--install-gov`, …).

### Gdzie lądują pliki

| Co | Ścieżka |
|---|---|
| Aplikacja i systemd | `/opt/prawko` |
| Unit | `/etc/systemd/system/prawko.service` |
| ZIP / surowe JPG·WMV z gov.pl | `~/.local/share/prawko/gov-data` |
| Skonwertowane WebP / MP4 i JSON z Excela | `/opt/prawko/src/media` oraz `src/data` |
| Tarball Node (gdy brak paczki 18+) | `/opt/prawko/tools/node` |

```bash
bash Install_Prawko.linux.sh --install-gov
bash Install_Prawko.linux.sh --dev ~/prawko
bash Install_Prawko.linux.sh --patch
bash Install_Prawko.linux.sh --uninstall
```

---

## Funkcje

- **Tryb nauki** — pytania po kategoriach, bez limitu czasu, z zapamiętywaniem postępu
- **Symulacja egzaminu** — 32 pytania, 25 minut, punktacja jak na egzaminie
- **12 kategorii** — A, A1, A2, AM, B, B1, C, C1, D, D1, PT, T
- **Skórki** — Panel i Stacja
- **Multimedia** — zdjęcia i filmy z oficjalnej bazy (stream z Backblaze, paczki offline z Cloudflare, albo lokalnie po `-InstallGov`)
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

Przełącznik w aplikacji cyklicznie: **PL → EN → DE → UA**.

Treść pytań w językach obcych pochodzi z Excela MI (`Pytanie [EN]`, `Pytanie [D]`, `Pytanie [UA]`) i jest zapisana w `src/data/translations_{en,de,uk}.json` przez `parse-excel.ps1`. Nie używamy maszynowego tłumaczenia banku pytań.

## Dane i multimedia

| | W gicie | Windows | macOS | Linux |
|---|---|---|---|---|
| Pytania JSON | `src/data/` | `C:\ProgramData\prawko\src\data` | `/usr/local/prawko/src/data` | `/opt/prawko/src/data` |
| Zdjęcia / filmy | nie (pusty `src/media`) | CDN albo `C:\ProgramData\prawko\src\media` | CDN albo `/usr/local/prawko/src/media` | CDN albo `/opt/prawko/src/media` |
| Excel / ZIP / JPG / WMV | nie | `%LOCALAPPDATA%\prawko\gov-data` | `~/Library/Application Support/prawko/gov-data` | `~/.local/share/prawko/gov-data` |

Czysty clone **nie wymaga** `-InstallGov`. JSON jest w `src/data`. Domyślnie (github.io i localhost bez mediów na dysku):

| Co | Skąd | Stała w `src/js/data.js` |
|---|---|---|
| Oglądanie `img/` i `vid/` | Backblaze B2 `prawko-maz` | `MEDIA_CDN` |
| „Pobierz offline” (zip + manifest) | Cloudflare R2 `prawko-packs` | `PACKS_BASE` (`https://pub-….r2.dev`) |

R2 zostaje na publicznym adresie testowym `r2.dev` (bez płatnej domeny). Własna domena na kubeł nie jest wymagana. Stary fetch plik-po-pliku z B2 zostaje w kodzie (`OFFLINE_DOWNLOAD = 'files'`).

Na **localhost** przeglądarka czyta `src/local.json` (gitignore, nie ma go na github.io). Klucze: `learnQuestionJump`, `mediaBase` (`media` / `cdn`), `offlineDownload` (`packs` / `files`), `packsBase` (nadpisuje host zipów).

W paczce MI brakuje pliku `!RS_Parking zastrzeżony.webp`. Parser **nie wycina** przez to pytania — nazwa z Excela zostaje, żeby zadziałał CDN albo późniejsze uzupełnienie.

Push na `main` odpala testy Playwright i wgrywa `src/` na GitHub Pages: [anabelmaz.github.io/prawko](https://anabelmaz.github.io/prawko/). Codzienna aplikacja to usługa na [http://localhost:5173](http://localhost:5173).

---

## Pipeline danych na Windows

Regeneracja JSON i mediów jest w **PowerShellu** (bez Pythona i bez Node w pipeline). Na Windowsie nie używaj bliźniaków `.py`. Instalator `Install_Prawko.windows.ps1` woła te skrypty sam (`-InstallGov` / `-GovQuestions` / `-Merge`). Ścieżki `gov-data` bierze z `scripts/download-gov.ps1 -LibraryOnly` (nie zgaduje katalogu w instalatorze). `convert-media.ps1` ładuje tę samą bibliotekę. `-Merge` woła `scripts/merge-gov.ps1` (ten sam job co `merge-gov.py` na macOS/Linux).

Wymagania poza instalatorem: przy konwersji mediów **FFmpeg** i **cwebp** (instalator przy `-InstallGov` kładzie przenośnego FFmpeg do `tools\`, jeśli nie ma w PATH).

| Skrypt | Zadanie |
|---|---|
| `scripts/download-gov.ps1` | Excel + ZIP z gov.pl → `%LOCALAPPDATA%\prawko\gov-data` |
| `scripts/parse-excel.ps1` | Excel → `src/data/*.json` oraz `translations_{en,de,uk}.json` |
| `scripts/convert-media.ps1` | JPG → WebP, WMV → MP4 (nie rusza PJM) |
| `scripts/merge-gov.ps1` | Dopisywanie braków MI (`-Merge`); też `. scripts\merge-gov.ps1 -LibraryOnly` |
| `scripts/filter-no-media.ps1` | **Raport** pytań z `media: null`. Kasowanie wierszy tylko z `-Remove` |
| `scripts/upload-media.ps1` | Upload `src/media` (`img/` `vid/`) na Backblaze B2 (klucze w `.b2env`, nie w gicie) |
| `scripts/build-media-packs.ps1` | Zipy + `manifest.json` → `%LOCALAPPDATA%\prawko\packs` (nie git) |
| `scripts/upload-packs.ps1` | Archiwum zipów na B2 — **nie** publiczny host aplikacji |

Przykład — JSON z Excela już leżącego na dysku:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\parse-excel.ps1
```

Domyślna ścieżka Excela to `gov-data\baza_pytan.xlsx` obok repo. Po `-InstallGov` / `-GovQuestions` plik jest w LocalAppData — wtedy podaj `-Excel`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\parse-excel.ps1 `
  -Excel "$env:LOCALAPPDATA\prawko\gov-data\baza_pytan.xlsx" `
  -OutDir src\data
```

`-DropMissingMedia` zeruje w JSON odwołania do plików, których nie ma w lokalnym raw. Bez tego przełącznika nazwy z Excela zostają (CDN).

Raport mediów (nic nie kasuje):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\filter-no-media.ps1
```

Upload streamu na B2: skopiuj `scripts/b2env.example` do `.b2env` w katalogu głównym repo, uzupełnij klucze, potem `scripts/upload-media.ps1`. Po pierwszym wgraniu ustaw `MEDIA_CDN` w `src/js/data.js` na URL wypisany przez skrypt.

Paczki offline: `scripts/build-media-packs.ps1` (JSON + lokalne `img/` `vid/`). Wynik wrzuć do kubełka R2 **prawko-packs** w panelu Cloudflare (Objects → Upload: `manifest.json` i zipy). Aplikacja czyta `PACKS_BASE`. **Nie** wgrywaj zipów na Backblaze jako źródła „Pobierz offline” — B2 tnie duże pobrania. `upload-packs.ps1` zostaje tylko jako kopia archiwalna na B2.

Zwykła aktualizacja pytań na już stojącym serwerze: `Install_Prawko.windows.ps1 -GovQuestions` albo `-InstallGov`. Nie odpalaj pełnego instalatora „dla pewności”, jeśli serwer już działa.

---

## Pipeline danych na macOS i Linuxie

Instalator to **`.sh`**. Reszta pipeline to **Python** (`python3`), bez Node i bez bliźniaków `.sh` / `.js` w `scripts/`. Node jest tylko do serwera aplikacji (`serve`). Ścieżka `gov-data`: `python3 scripts/download-gov.py --print-gov-data-dir`. Ręcznie (z checkoutu):

| Skrypt | Zadanie |
|---|---|
| `scripts/download-gov.py` | Excel + ZIP z gov.pl → macOS: `~/Library/Application Support/prawko/gov-data`; Linux: `~/.local/share/prawko/gov-data` |
| `scripts/parse-excel.py` | Excel → JSON (ten sam zestaw reguł co `parse-excel.ps1`) |
| `scripts/convert-media.py` | JPG → WebP, WMV → MP4 (VideoToolbox, gdy jest; nie rusza PJM) |
| `scripts/filter-no-media.py` | Raport; kasowanie tylko z `--remove` |
| `scripts/merge-gov.py` | Dopisywanie braków MI (`--merge`) |
| `scripts/upload-media.py` | Upload `src/media` na B2 (klucze w `.b2env`) |
| `scripts/build-media-packs.py` | To samo co `build-media-packs.ps1` (zipy + manifest) |
| `scripts/upload-packs.py` | Archiwum zipów na B2 — nie publiczny host |

```bash
python3 scripts/download-gov.py --excel-only
python3 scripts/parse-excel.py \
  --excel "$HOME/Library/Application Support/prawko/gov-data/baza_pytan.xlsx" \
  --out-dir src/data
python3 scripts/convert-media.py
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

A PWA for learning and simulating the Polish theoretical driving test.

This is a **fork** of [szkocot/prawko](https://github.com/szkocot/prawko) (upstream demo: https://szkocot.github.io/prawko/). This copy: repository [AnabelMaz/prawko](https://github.com/AnabelMaz/prawko), browser preview [anabelmaz.github.io/prawko](https://anabelmaz.github.io/prawko/). It keeps a WORD station layout, Panel/Station skins, local profiles, and a rebuilt learn mode. Small standalone fixes can still go upstream; this repository holds the full **Windows**, **macOS**, and **Linux** product.

The repo JSON has **3518** unique ministry questions. Photos and films are not in git: **playback** is Backblaze, **Download offline** is zip packs from Cloudflare R2. The public catalogue on [gov.pl](https://www.gov.pl/web/infrastruktura/prawo-jazdy) is **July 2026** (`KATALOG_dla_kandydatów_na_kierowców_072026.xlsx`).

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
| ZIP / raw JPG·WMV from gov.pl | `%LOCALAPPDATA%\prawko\gov-data` |
| Converted WebP / MP4 and Excel JSON | `C:\ProgramData\prawko\src\media` and `src\data` |
| Portable FFmpeg (if `-InstallGov` / `-Merge` and none on PATH) | `C:\ProgramData\prawko\tools` |

A normal user does **not** need a second git clone. `-InstallGov` does not duplicate media next to the checkout.

The only duplication with `-InstallGov` is ZIP + unpacked JPG/WMV (download cache) versus raw + WebP/MP4 (source vs what the browser plays). That is not two copies of the same pack in ProgramData and in git.

### Installer switches

| Switch | Effect |
|---|---|
| *(none)* | Server install, repo questions; playback from Backblaze, offline from Cloudflare |
| `-InstallGov` | Excel + situational media ZIPs from gov.pl; WebP/MP4 on the server. Does **not** download sign-language packs (PJM, ~10 GB) |
| `-GovQuestions` | Question catalogue only (Excel → JSON on the server). Leaves media and the CDN alone |
| `-DropMissingMedia` | With `-InstallGov` only: clear JSON media names whose files are missing from local raw. **Off by default** — Excel names stay (CDN) |
| `-Dev <folder>` | Git clone only — **no** Node and **no** server. Empty or new folder; **not** `C:\ProgramData\prawko` |
| `-Patch` | Overlay `src` from contrib (skip `data\` and `media\`). Installs nothing if the server is already up. **Without** a server: ZIP + Node + service + overlay |
| `-Merge` | Keep GitHub questions; add ministry Excel rows that are not already there. **Requires** a running server |
| `-Export <path>` | Copy a portable pack (installer + contrib) without touching the server |
| `-Uninstall` | Remove the service and `C:\ProgramData\prawko`. Git / Node / NSSM stay on the machine |
| `-NonInteractive` | No Enter pause at the end |
| `-Help` | Full help |

Each switch installs **only what it uses**:

| Action | May install | Leaves alone |
|---|---|---|
| *(none)* | Node, NSSM, app ZIP, service | Git |
| `-Dev` | Git + clone | Node, NSSM, server |
| `-Patch` | nothing if the server is up; otherwise Node + service + overlay | Git |
| `-InstallGov` | FFmpeg if missing | Git, service reinstall |
| `-GovQuestions` | Excel from gov.pl | Git, Node, server |
| `-Merge` | Excel; writes into the running server | full reinstall (no server = error) |
| `-Export` | nothing | server |
| `-Uninstall` | nothing new | Git / Node / NSSM stay |

Administrator only for the **first server install** or `-Uninstall`.

### Optional local ministry pack (several GB)

The default install is enough to study and sit a mock exam. JSON is in the repo; playback is Backblaze, Download offline is Cloudflare.

Local WebP/MP4 (on the server disk, no B2/R2, or your own copy):

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -InstallGov
```

Staging (ZIP, raw JPG/WMV) goes to `%LOCALAPPDATA%\prawko\gov-data`. Conversion and JSON go only to the ProgramData server. If `C:` is tight, ZIP/raw may overflow to `gov-data` in a checkout on another drive.

Questions only, no film download:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -GovQuestions
```

### Developer install

Code only, no localhost and no Node:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Dev D:\prawko
```

Git is installed only here. This does **not** set up the server. The folder must be **empty** or not exist yet (not `C:\ProgramData\prawko`).

Both (app + git): run the installer **with no switches** first, then `-Dev`.

Preview your code on localhost (server already running):

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Patch
```

`-Patch` overlays `src` from the contrib tree and **skips** `data\` and `media\`. Gov ZIPs and WebP are not copied into the git folder. If the server is already up — overlay only. If it is not — ZIP + service first, then overlay.

### Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File .\Install_Prawko.windows.ps1 -Uninstall
```

Removes the service and `C:\ProgramData\prawko` (including FFmpeg dropped there by `-InstallGov`). `%LOCALAPPDATA%\prawko\gov-data` and Git / Node / NSSM remain.

---

## Install on macOS

Same product as Windows: download **one script**, it does the rest (tools, ZIP, service, port **5173**). The service is **launchd**, not NSSM.

### Requirements

| | |
|---|---|
| OS | macOS (Intel or Apple Silicon) |
| Shell | built-in bash — you do **not** clone the repo or install Homebrew first |
| Privileges | First install asks for the **administrator password** (sudo), like UAC on Windows |
| Python | Only for `--install-gov` / `--gov-questions` / `--merge`. Not needed to run the app |

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
| ZIP / raw JPG·WMV from gov.pl | `~/Library/Application Support/prawko/gov-data` |
| Converted WebP / MP4 and Excel JSON | `/usr/local/prawko/src/media` and `src/data` |
| plist | `/Library/LaunchDaemons/pl.prawko.word.plist` |

### Switches (same jobs as Windows)

| macOS | Windows | Effect |
|---|---|---|
| *(none)* | *(none)* | Server, repo questions; playback from Backblaze, offline from Cloudflare |
| `--install-gov` | `-InstallGov` | Excel + ZIPs from gov.pl; WebP/MP4 on the server. No PJM |
| `--gov-questions` | `-GovQuestions` | Excel → JSON on the server only |
| `--drop-missing-media` | `-DropMissingMedia` | With `--install-gov` only; **off** by default |
| `--dev <folder>` | `-Dev <folder>` | Git + clone only. **No** Node and **no** server. Not `/usr/local/prawko` |
| `--patch` | `-Patch` | Overlay `src`, skip `data/` and `media/`. Installs nothing if the server is up. Without a server: ZIP + Node + launchd + overlay |
| `--merge` | `-Merge` | Add ministry Excel rows that are not already there; **requires** a running server |
| `--export <path>` | `-Export` | Portable pack |
| `--uninstall` | `-Uninstall` | Remove launchd and `/usr/local/prawko` |
| `--non-interactive` | `-NonInteractive` | No Enter pause |
| `--help` | `-Help` | Help |

```bash
./Install_Prawko.macos.sh --install-gov
./Install_Prawko.macos.sh --dev ~/prawko
./Install_Prawko.macos.sh --patch
./Install_Prawko.macos.sh --uninstall
```

`--dev` does not set up localhost and does not install Node. `--patch` overlays your code onto a **running** server.

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
| Python | Only for `--install-gov` / `--gov-questions` / `--merge` |

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

All switches: `bash Install_Prawko.linux.sh --help`. Same flags as macOS (`--dev`, `--patch`, `--install-gov`, …).

### Where files land

| What | Path |
|---|---|
| App and systemd | `/opt/prawko` |
| Unit | `/etc/systemd/system/prawko.service` |
| ZIP / raw JPG·WMV from gov.pl | `~/.local/share/prawko/gov-data` |
| Converted WebP / MP4 and Excel JSON | `/opt/prawko/src/media` and `src/data` |
| Node tarball (if no distro Node 18+) | `/opt/prawko/tools/node` |

```bash
bash Install_Prawko.linux.sh --install-gov
bash Install_Prawko.linux.sh --dev ~/prawko
bash Install_Prawko.linux.sh --patch
bash Install_Prawko.linux.sh --uninstall
```

---

## Features

- **Learn mode** — questions by category, no timer, progress remembered
- **Exam simulation** — 32 questions, 25 minutes, official scoring
- **12 categories** — A, A1, A2, AM, B, B1, C, C1, D, D1, PT, T
- **Skins** — Panel and Station
- **Media** — official photos and films (Backblaze stream, Cloudflare offline packs, or local after `-InstallGov`)
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

The in-app control cycles **PL → EN → DE → UA**.

Non-Polish question text comes from the ministry Excel (`Pytanie [EN]`, `Pytanie [D]`, `Pytanie [UA]`) into `src/data/translations_{en,de,uk}.json` via `parse-excel.ps1`. The question banks are not machine-translated.

## Data and media

| | In git | Windows | macOS | Linux |
|---|---|---|---|---|
| Question JSON | `src/data/` | `C:\ProgramData\prawko\src\data` | `/usr/local/prawko/src/data` | `/opt/prawko/src/data` |
| Photos / films | no (empty `src/media`) | CDN or `C:\ProgramData\prawko\src\media` | CDN or `/usr/local/prawko/src/media` | CDN or `/opt/prawko/src/media` |
| Excel / ZIP / JPG / WMV | no | `%LOCALAPPDATA%\prawko\gov-data` | `~/Library/Application Support/prawko/gov-data` | `~/.local/share/prawko/gov-data` |

A clean clone does **not** need `-InstallGov`. JSON is in `src/data`. Defaults (github.io and localhost without files on disk):

| What | Where | Constant in `src/js/data.js` |
|---|---|---|
| Playing `img/` and `vid/` | Backblaze B2 `prawko-maz` | `MEDIA_CDN` |
| “Download offline” (zip + manifest) | Cloudflare R2 `prawko-packs` | `PACKS_BASE` (`https://pub-….r2.dev`) |

Packs stay on the free `r2.dev` public development URL (no paid custom domain). The old per-file B2 fetch remains in code (`OFFLINE_DOWNLOAD = 'files'`).

On **localhost** the browser reads `src/local.json` (gitignored; github.io does not have it). Keys: `learnQuestionJump`, `mediaBase` (`media` / `cdn`), `offlineDownload` (`packs` / `files`), `packsBase` (overrides the zip host).

The ministry pack is missing `!RS_Parking zastrzeżony.webp`. The parser does **not** drop that question — the Excel file name stays so the CDN or a later file can fill it.

A push to `main` runs Playwright and publishes `src/` to GitHub Pages: [anabelmaz.github.io/prawko](https://anabelmaz.github.io/prawko/). Day-to-day use is the service at [http://localhost:5173](http://localhost:5173).

---

## Data pipeline on Windows

Regenerate JSON and media with **PowerShell** (no Python and no Node in the pipeline). Do not use the `.py` twins on Windows. `Install_Prawko.windows.ps1` runs these scripts (`-InstallGov` / `-GovQuestions` / `-Merge`). Gov-data paths come from `scripts/download-gov.ps1 -LibraryOnly` (the installer does not invent that folder). `convert-media.ps1` loads the same library. `-Merge` runs `scripts/merge-gov.ps1` (same job as `merge-gov.py` on macOS/Linux).

Besides the installer: media conversion needs **FFmpeg** and **cwebp** (`-InstallGov` can drop a portable FFmpeg into `tools\` if none is on PATH).

| Script | Job |
|---|---|
| `scripts/download-gov.ps1` | Excel + ZIPs from gov.pl → `%LOCALAPPDATA%\prawko\gov-data` |
| `scripts/parse-excel.ps1` | Excel → `src/data/*.json` and `translations_{en,de,uk}.json` |
| `scripts/convert-media.ps1` | JPG → WebP, WMV → MP4 (does not touch PJM) |
| `scripts/merge-gov.ps1` | Append missing ministry rows (`-Merge`); also `. scripts\merge-gov.ps1 -LibraryOnly` |
| `scripts/filter-no-media.ps1` | **Report** questions with `media: null`. Drops rows only with `-Remove` |
| `scripts/upload-media.ps1` | Upload `src/media` (`img/` `vid/`) to Backblaze B2 (keys in `.b2env`, not in git) |
| `scripts/build-media-packs.ps1` | Zips + `manifest.json` → `%LOCALAPPDATA%\prawko\packs` (not git) |
| `scripts/upload-packs.ps1` | Archive copy of zips to B2 — **not** the app’s public pack host |

Parse an Excel file already on disk:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\parse-excel.ps1
```

The default Excel path is `gov-data\baza_pytan.xlsx` next to the repo. After `-InstallGov` / `-GovQuestions` the file lives under LocalAppData — pass `-Excel`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\parse-excel.ps1 `
  -Excel "$env:LOCALAPPDATA\prawko\gov-data\baza_pytan.xlsx" `
  -OutDir src\data
```

`-DropMissingMedia` clears JSON media names whose files are missing from local raw. Without it, Excel names stay (CDN).

Report only (does not delete questions):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\filter-no-media.ps1
```

B2 stream upload: copy `scripts/b2env.example` to `.b2env` at the repo root, fill in the keys, then run `scripts/upload-media.ps1`. After the first upload, set `MEDIA_CDN` in `src/js/data.js` to the URL the script prints.

Offline packs: `scripts/build-media-packs.ps1` (JSON + local `img/` `vid/`). Upload the result to the R2 bucket **prawko-packs** in the Cloudflare dashboard (Objects → Upload: `manifest.json` and the zips). The app reads `PACKS_BASE`. **Do not** serve those zips from Backblaze — B2 throttles large downloads. `upload-packs.ps1` is only an archive copy on B2.

To refresh questions on a running server, use `Install_Prawko.windows.ps1 -GovQuestions` or `-InstallGov`. Do not re-run a full install “just in case” if the service is already up.

---

## Data pipeline on macOS and Linux

The installer is **`.sh`**. The rest of the pipeline is **Python** (`python3`), with no Node and no `.sh` / `.js` twins under `scripts/`. Node is only for the app server (`serve`). Gov-data path: `python3 scripts/download-gov.py --print-gov-data-dir`. To run them yourself from a checkout:

| Script | Job |
|---|---|
| `scripts/download-gov.py` | Excel + ZIPs from gov.pl → macOS: `~/Library/Application Support/prawko/gov-data`; Linux: `~/.local/share/prawko/gov-data` |
| `scripts/parse-excel.py` | Excel → JSON (same rules as `parse-excel.ps1`) |
| `scripts/convert-media.py` | JPG → WebP, WMV → MP4 (VideoToolbox when available; skips PJM) |
| `scripts/filter-no-media.py` | Report; delete rows only with `--remove` |
| `scripts/merge-gov.py` | Add missing ministry rows (`--merge`) |
| `scripts/upload-media.py` | Upload `src/media` to B2 (keys in `.b2env`) |
| `scripts/build-media-packs.py` | Same job as `build-media-packs.ps1` (zips + manifest) |
| `scripts/upload-packs.py` | Archive copy of zips to B2 — not the app’s public pack host |

```bash
python3 scripts/download-gov.py --excel-only
python3 scripts/parse-excel.py \
  --excel "$HOME/Library/Application Support/prawko/gov-data/baza_pytan.xlsx" \
  --out-dir src/data
python3 scripts/convert-media.py
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
