#!/usr/bin/env bash
# Install_Prawko.macos.sh — instalator Prawko na macOS (odpowiednik Install_Prawko.ps1).
# Ściągnij ten jeden plik i odpal. Serwer: Homebrew/Node + ZIP + launchd.
# --dev: tylko Git i klon (bez Node, bez serwera).
#
#   curl -fsSL -o Install_Prawko.macos.sh https://raw.githubusercontent.com/AnabelMaz/prawko/main/Install_Prawko.macos.sh
#   bash Install_Prawko.macos.sh

set -euo pipefail

REPO_URL="https://github.com/AnabelMaz/prawko.git"
REPO_BRANCH="main"
LISTEN_PORT=5173
TARGET_DIR="/usr/local/prawko"
LAUNCH_LABEL="pl.prawko.word"
LAUNCH_PLIST="/Library/LaunchDaemons/${LAUNCH_LABEL}.plist"

HELP=0
NONINTERACTIVE=0
UNINSTALL=0
INSTALL_GOV=0
GOV_QUESTIONS=0
MERGE=0
PATCH=0
DROP_MISSING_MEDIA=0
EXPORT=""
DEV=""
DEV_SET=0

say() { printf '%s\n' "$*"; }
say_c() { printf '\033[36m%s\033[0m\n' "$*"; }
say_g() { printf '\033[32m%s\033[0m\n' "$*"; }
say_y() { printf '\033[33m%s\033[0m\n' "$*"; }
say_d() { printf '\033[90m%s\033[0m\n' "$*"; }
say_r() { printf '\033[31m%s\033[0m\n' "$*"; }
die() { say_r "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Install_Prawko.macos.sh — instalator Prawko (egzamin na prawo jazdy) na macOS.

SKŁADNIA
  bash Install_Prawko.macos.sh [opcje]
  Z GitHuba wystarczy ten jeden plik (Pobrane, Pulpit). Nie klonujesz repo ręcznie.
  Serwer (bez przełączników): Homebrew/Node gdy brak, ZIP, launchd. Bez Gita.

PRZEŁĄCZNIKI (jak w Install_Prawko.ps1 na Windows)
  (brak)                 Tryb domyślny: ZIP z GitHub AnabelMaz/prawko (gałąź ${REPO_BRANCH}),
                         launchd http://localhost:${LISTEN_PORT}. Bez Gita. Pytania z repo, media
                         z CDN prawko-maz. Gdy serwer już stoi, nic nie nadpisuje.
  --install-gov          Excel + ZIP multimediów sytuacyjnych z gov.pl.
                         Staging: ~/Library/Application Support/prawko/gov-data
                         Konwersja (WebP/MP4) i JSON: ${TARGET_DIR}
                         PJM nie pobiera. --patch pomija data/ i media/.
  --drop-missing-media   Tylko z --install-gov: parser wykreśla z JSON media,
                         których pliku nie ma w lokalnym raw. Domyślnie NIE.
  --gov-questions        Tylko katalog pytań z ministerstwa na żywy serwer.
                         Nie rusza src/media ani CDN.
  --patch                Nakłada kod z lokalnego checkoutu (--dev, obok skryptu,
                         ../prawko-contrib). Pomija data/ i media/.
                         Na już stojącym serwerze: tylko overlay, bez sudo,
                         bez reinstalu launchd.
                         Przy pierwszej instalacji: ZIP AnabelMaz + launchd + overlay.
  --export <ścieżka>     Paczka: <ścieżka>/prawko/Install_Prawko.macos.sh
                         oraz <ścieżka>/prawko-contrib/. Bez ruszania serwera.
  --dev <ścieżka>        Tylko klon gita (kod, commit, push). Nie ${TARGET_DIR}.
                         Nie instaluje Node ani launchd — nawet gdy serwer nie stoi.
                         Git tylko tu. Localhost: najpierw skrypt bez przełączników.
                         Folder pusty albo jeszcze nie istnieje.
  --merge                Na już stojącym serwerze: dopisuje braki z Excel MI.
                         Nie stawia launchd. Brak serwera = najpierw bez przełączników.
  --uninstall            Usuwa launchd i ${TARGET_DIR}. Homebrew / Git / Node zostają.
  --non-interactive      Bez pauzy Enter na końcu.
  --help                 Ta pomoc.

DWA TYPY UŻYTKOWNIKA
  Zwykły: skrypt bez przełączników. ZIP + Node + launchd. Bez Gita.
  Deweloper: tylko kod, bez serwera:
    bash Install_Prawko.macos.sh --dev ~/prawko
  Oba (localhost + git): najpierw bez przełączników, potem --dev.

  Każdy przełącznik doinstalowuje tylko to, czego używa:
    (brak)           Homebrew gdy brak, Node, ZIP aplikacji, launchd
    --dev            Git + klon (bez Node, bez serwera, bez sudo)
    --patch          nic, gdy serwer stoi; bez serwera: Node + launchd + overlay
    --install-gov    FFmpeg gdy brak; Excel+ZIP z gov.pl
    --gov-questions  Node (gov.pl) + Python do parsera
    --merge          Node + Python; zapis do stojącego serwera
    --export         nic (kopia plików)
    --uninstall      nic nowego

CZEGO WYMAGA
  Serwer (bez przełączników): sudo, Homebrew/Node gdy brak, ZIP, launchd. Bez Gita.
  --dev: tylko Git + klon (bez Node, bez serwera, bez sudo). Nie instaluje Homebrew,
         chyba że brew już jest i brakuje gita — wtedy brew install git.
  --install-gov: FFmpeg; Python+openpyxl do parse-excel.py.
  --gov-questions / --merge: Node (gov.pl) + Python do parsera; --merge wymaga serwera.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h|-Help) HELP=1; shift ;;
    --non-interactive|-NonInteractive) NONINTERACTIVE=1; shift ;;
    --uninstall|-Uninstall) UNINSTALL=1; shift ;;
    --install-gov|-InstallGov) INSTALL_GOV=1; shift ;;
    --gov-questions|-GovQuestions) GOV_QUESTIONS=1; shift ;;
    --merge|-Merge) MERGE=1; shift ;;
    --patch|-Patch) PATCH=1; shift ;;
    --drop-missing-media|-DropMissingMedia) DROP_MISSING_MEDIA=1; shift ;;
    --export|-Export)
      [ $# -ge 2 ] || die "--export wymaga ścieżki"
      EXPORT="$2"
      shift 2
      ;;
    --dev|-Dev)
      [ $# -ge 2 ] || die "--dev wymaga ścieżki"
      DEV="$2"
      DEV_SET=1
      shift 2
      ;;
    *) die "Nieznany argument: $1 (zobacz --help)" ;;
  esac
done

if [ "$HELP" -eq 1 ]; then
  usage
  exit 0
fi

SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INITIAL_PWD="$(pwd)"

if [ "$(uname -s)" != "Darwin" ]; then
  die "Ten instalator jest na macOS. Linux: Install_Prawko.linux.sh  Windows: Install_Prawko.ps1"
fi
xattr -d com.apple.quarantine "$SCRIPT_PATH" 2>/dev/null || true

REAL_USER="${SUDO_USER:-${USER:-$(id -un)}}"
if [ "$REAL_USER" = "root" ]; then
  REAL_HOME="/var/root"
else
  REAL_HOME="$(dscl . -read "/Users/$REAL_USER" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
  REAL_HOME="${REAL_HOME:-$HOME}"
fi
export PRAWKO_USER_HOME="$REAL_HOME"
GOV_DATA="${PRAWKO_GOV_DATA:-$REAL_HOME/Library/Application Support/prawko/gov-data}"
export PRAWKO_GOV_DATA="$GOV_DATA"
DEV_WORK_ROOT=""

is_root() { [ "$(id -u)" -eq 0 ]; }

need_root_for_default() {
  # sudo tylko: pierwsza instalacja serwera albo --uninstall.
  [ "$UNINSTALL" -eq 1 ] && return 0
  [ -n "$EXPORT" ] && return 1
  [ "$GOV_QUESTIONS" -eq 1 ] && return 1
  [ "$INSTALL_GOV" -eq 1 ] && return 1
  [ "$MERGE" -eq 1 ] && return 1
  [ "$DEV_SET" -eq 1 ] && return 1
  [ "$PATCH" -eq 1 ] && server_installed && return 1
  server_installed && return 1
  return 0
}

elevate_if_needed() {
  if is_root; then
    return 0
  fi
  if ! need_root_for_default; then
    return 0
  fi
  say_y "Wymagane uprawnienia administratora. Ponawiam z sudo..."
  exec sudo -E "$SCRIPT_PATH" "$@"
}

looks_like_repo() {
  local root="$1"
  [ -n "$root" ] || return 1
  [ -f "$root/src/index.html" ] || return 1
  [ -f "$root/scripts/download-gov.sh" ] || [ -f "$root/scripts/download-gov.ps1" ]
}

abs_path() {
  local p="$1"
  case "$p" in
    /*) printf '%s\n' "$p" ;;
    *) printf '%s\n' "$(cd "$INITIAL_PWD" && cd "$(dirname "$p")" && pwd)/$(basename "$p")" ;;
  esac
}

same_path() {
  local a b
  a="$(cd "$1" 2>/dev/null && pwd)" || return 1
  b="$(cd "$2" 2>/dev/null && pwd)" || return 1
  [ "$a" = "$b" ]
}

find_contrib() {
  local c full
  for c in \
    ${DEV_WORK_ROOT:+"$DEV_WORK_ROOT"} \
    ${DEV:+"$DEV"} \
    "$SCRIPT_DIR" \
    "$SCRIPT_DIR/prawko-contrib" \
    "$(dirname "$SCRIPT_DIR")/prawko-contrib" \
    "$(dirname "$SCRIPT_DIR")/contrib"
  do
    [ -n "$c" ] || continue
    if [ "$DEV_SET" -eq 1 ] && [ "$c" = "$DEV" ]; then
      case "$c" in
        /*) ;;
        *) c="$INITIAL_PWD/$c" ;;
      esac
    fi
    looks_like_repo "$c" || continue
    full="$(cd "$c" && pwd)"
    if [ "$full" = "$TARGET_DIR" ]; then
      continue
    fi
    printf '%s\n' "$full"
    return 0
  done
  return 1
}

require_contrib() {
  local found
  found="$(find_contrib || true)"
  [ -n "$found" ] || die "Brak lokalnego checkoutu do zmian. Odpal ./Install_Prawko.macos.sh --dev <ścieżka> albo trzymaj repo obok instalatora."
  printf '%s\n' "$found"
}

resolve_pipeline() {
  local name="$1" c contrib
  contrib="$(find_contrib 2>/dev/null || true)"
  for c in "$SCRIPT_DIR/scripts/$name" ${contrib:+"$contrib/scripts/$name"} "$TARGET_DIR/scripts/$name"; do
    [ -n "$c" ] || continue
    if [ -f "$c" ]; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

run_pipeline() {
  local name="$1"
  shift
  local path
  path="$(resolve_pipeline "$name")" || die "Brak skryptu $name (szukano obok instalatora, w contrib i w $TARGET_DIR/scripts)."
  say_c "-> $name $*"
  bash "$path" "$@"
}

server_installed() {
  [ -f "$TARGET_DIR/src/index.html" ]
}

local_media_present() {
  local root="$1"
  [ -n "$(find "$root/src/media/img" -type f 2>/dev/null | head -n 1)" ] && return 0
  [ -n "$(find "$root/src/media/vid" -type f 2>/dev/null | head -n 1)" ] && return 0
  return 1
}

restore_media_base_if_needed() {
  if local_media_present "$1"; then
    set_local_media_base "$1"
  fi
}

set_local_media_base() {
  local datajs="$1/src/js/data.js"
  [ -f "$datajs" ] || die "Brak $datajs"
  sed -i '' -E "s/export const MEDIA_BASE = [^;[:space:]]+/export const MEDIA_BASE = 'media'/" "$datajs"
  grep -q "export const MEDIA_BASE = 'media'" "$datajs" || die "Nie udało się ustawić lokalnego MEDIA_BASE w data.js"
  say_g "-> Aplikacja będzie brać multimedia z src/media (nie z CDN)."
}

stamp_cache() {
  local root="$1" prefix="$2" sw stamp
  sw="$root/src/sw.js"
  [ -f "$sw" ] || die "Brak $sw"
  stamp="$(date +%Y%m%d%H%M%S)"
  sed -i '' -E "s/const CACHE_VERSION = '[^']+';/const CACHE_VERSION = '${prefix}-${stamp}';/" "$sw"
  grep -q "const CACHE_VERSION = '${prefix}-${stamp}'" "$sw" || die "Could not stamp CACHE_VERSION in $sw"
  say_c "Service worker: ${prefix}-${stamp}"
}

copy_gov_json_to_server() {
  local gov_dir="$1" sw_prefix="$2" cat tr
  [ -f "$TARGET_DIR/src/index.html" ] && [ -d "$TARGET_DIR/src/data" ] || return 1
  cp "$gov_dir/meta.json" "$TARGET_DIR/src/data/meta.json"
  for cat in A A1 A2 AM B B1 C C1 D D1 PT T; do
    if [ -f "$gov_dir/$cat.json" ]; then
      cp "$gov_dir/$cat.json" "$TARGET_DIR/src/data/$cat.json"
    fi
  done
  for tr in translations_en.json translations_de.json translations_uk.json; do
    if [ -f "$gov_dir/$tr" ]; then
      cp "$gov_dir/$tr" "$TARGET_DIR/src/data/$tr"
    fi
  done
  stamp_cache "$TARGET_DIR" "$sw_prefix"
  return 0
}

overlay_src() {
  local src_app="$1" dest_root="$2" prefix="$3"
  [ -f "$src_app/index.html" ] || die "Brak $src_app/index.html"
  [ -f "$dest_root/src/index.html" ] || die "Serwer nie jest zainstalowany (brak $dest_root/src/index.html)."
  say_c "-> Nakładanie $src_app -> $dest_root/src (pomijam data/ i media/)"
  rsync -a --exclude data --exclude media "$src_app/" "$dest_root/src/"
  if [ -f "$src_app/data/translations_en.json" ] && [ -d "$dest_root/src/data" ]; then
    cp "$src_app/data/translations_en.json" "$dest_root/src/data/translations_en.json"
  fi
  stamp_cache "$dest_root" "$prefix"
  restore_media_base_if_needed "$dest_root"
}

apply_patch() {
  local contrib
  contrib="$(find_contrib || true)"
  if [ -z "$contrib" ]; then
    say_y "-> Brak lokalnego contrib. Zostawiam kod z GitHub $REPO_URL ($REPO_BRANCH)."
    return 0
  fi
  say_y "-> Nakładanie kodu z lokalnego contrib: $contrib"
  overlay_src "$contrib/src" "$TARGET_DIR" "prawko-patch"
  say_g "-> Nałożono kod z lokalnego contrib."
}

load_brew_env() {
  # sudo na macOS często nadpisuje PATH (secure_path) — Git/Node z brew znikają.
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
}

as_user() {
  load_brew_env
  if is_root && [ -n "${SUDO_USER:-}" ]; then
    sudo -u "$SUDO_USER" -H env HOME="$REAL_HOME" PATH="$PATH" "$@"
  else
    "$@"
  fi
}

ensure_brew() {
  load_brew_env
  if command -v brew >/dev/null 2>&1; then
    return 0
  fi
  say_y "[Brak Homebrew] Instaluję Homebrew (odpowiednik winget na Windows)..."
  say_d "To może chwilę zająć. Hasło administratora: tak jak przy pierwszej instalacji na Windows."
  as_user env NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  load_brew_env
  command -v brew >/dev/null 2>&1 || die "Homebrew nie jest dostępny po instalacji. Sprawdź sieć i ponów."
  say_g "[OK] Homebrew"
}

brew_install() {
  local pkg="$1"
  ensure_brew
  as_user brew install "$pkg"
  load_brew_env
}

ensure_cmd() {
  local cmd="$1" brew_pkg="$2"
  load_brew_env
  # /usr/bin/git i python3 bywają zaślepką CLT — command -v kłamie, --version nie.
  if command -v "$cmd" >/dev/null 2>&1 && "$cmd" --version >/dev/null 2>&1; then
    say_g "[OK] $cmd"
    return 0
  fi
  say_y "[Brak $cmd] Instaluję $brew_pkg..."
  brew_install "$brew_pkg"
  load_brew_env
  if command -v "$cmd" >/dev/null 2>&1 && "$cmd" --version >/dev/null 2>&1; then
    say_g "[OK] $cmd"
    return 0
  fi
  die "$cmd nie jest dostępny po instalacji."
}

ensure_app_tools() {
  say_c "=== Narzędzia (Node — instalator doinstaluje, jeśli trzeba) ==="
  ensure_cmd node node
}

ensure_git() {
  say_c "=== Git (tylko --dev) ==="
  load_brew_env
  if command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; then
    say_g "[OK] git"
    return 0
  fi
  if command -v brew >/dev/null 2>&1; then
    say_y "[Brak git] Instaluję git przez Homebrew (brew już jest)..."
    brew_install git
    load_brew_env
    if command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; then
      say_g "[OK] git"
      return 0
    fi
  fi
  die "Brak Git. --dev nie instaluje Node, Homebrew ani serwera. Zainstaluj Git (xcode-select --install albo brew install git) i ponów."
}

ensure_python_openpyxl() {
  ensure_cmd python3 python
  if as_user python3 -c "import openpyxl" 2>/dev/null; then
    return 0
  fi
  say_y "Instaluję openpyxl (parse-excel.py)..."
  as_user python3 -m pip install --user openpyxl
  as_user python3 -c "import openpyxl" || die "openpyxl nie jest dostępny (python3 -m pip install --user openpyxl)."
}

run_parse_excel() {
  local excel="$1" out="$2"
  shift 2
  local py extra=()
  py="$(resolve_pipeline parse-excel.py)" || die "Brak scripts/parse-excel.py"
  extra=(--excel "$excel" --out-dir "$out")
  if [ "$DROP_MISSING_MEDIA" -eq 1 ]; then
    extra+=(--drop-missing-media --media-dir "$GOV_DATA/raw")
    say_y "DropMissingMedia: pytania bez lokalnego pliku w raw tracą odwołanie do mediów."
  fi
  say_c "-> parse-excel.py ${extra[*]}"
  as_user python3 "$py" "${extra[@]}"
}

assert_gov_parsed() {
  local gov_dir="$1" excel="$2" meta qtotal
  meta="$gov_dir/meta.json"
  [ -f "$meta" ] || die "Brak meta.json po parsowaniu Excela."
  qtotal="$(node -e "const m=require(process.argv[1]); console.log((m.categories||[]).reduce((s,c)=>s+(c.questionCount||0),0))" "$meta")"
  if [ "${qtotal:-0}" -lt 100 ]; then
    die "Parser Excela zapisał za mało pytań ($qtotal). Sprawdź układ kolumn w $excel."
  fi
  say_g "-> W gov-data: $qtotal przypisań pytań. Oryginały w contrib/src/data zostają."
}

resolve_node() {
  load_brew_env
  local c
  for c in "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -n "$c" ] && [ -x "$c" ]; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

resolve_git() {
  load_brew_env
  local c
  for c in "$(command -v git 2>/dev/null || true)" /opt/homebrew/bin/git /usr/local/bin/git /usr/bin/git; do
    if [ -n "$c" ] && [ -x "$c" ]; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

resolve_npm() {
  load_brew_env
  local c node_dir
  for c in "$(command -v npm 2>/dev/null || true)" /opt/homebrew/bin/npm /usr/local/bin/npm; do
    if [ -n "$c" ] && [ -x "$c" ]; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  node_dir="$(dirname "$(resolve_node)")"
  if [ -x "$node_dir/npm" ]; then
    printf '%s\n' "$node_dir/npm"
    return 0
  fi
  return 1
}

resolve_serve_entry() {
  local root="$1" c
  for c in \
    "$root/node_modules/serve/build/main.js" \
    "$root/node_modules/serve/src/index.js" \
    "$root/node_modules/serve/bin/serve.js"
  do
    if [ -f "$c" ]; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

install_launchd() {
  local node_exe="$1" serve_entry="$2"
  cat > "$LAUNCH_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node_exe}</string>
    <string>${serve_entry}</string>
    <string>-s</string>
    <string>.</string>
    <string>-l</string>
    <string>${LISTEN_PORT}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${TARGET_DIR}/src</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${TARGET_DIR}/service_output.log</string>
  <key>StandardErrorPath</key>
  <string>${TARGET_DIR}/service_error.log</string>
</dict>
</plist>
EOF
  launchctl bootout system/"$LAUNCH_LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap system "$LAUNCH_PLIST"
  launchctl enable system/"$LAUNCH_LABEL" >/dev/null 2>&1 || true
  launchctl kickstart -k system/"$LAUNCH_LABEL" >/dev/null 2>&1 || launchctl start "$LAUNCH_LABEL" || true
}

stop_launchd() {
  launchctl bootout system/"$LAUNCH_LABEL" >/dev/null 2>&1 || true
  launchctl unload "$LAUNCH_PLIST" >/dev/null 2>&1 || true
}

git_clone() {
  local dest="$1" git_exe
  git_exe="$(resolve_git)" || die "Brak git"
  GIT_LFS_SKIP_SMUDGE=1 "$git_exe" clone --branch "$REPO_BRANCH" "$REPO_URL" "$dest"
}

install_from_github_zip() {
  local dest="$1" stage zip unpack inner
  stage="$(mktemp -d "${TMPDIR:-/tmp}/prawko-zip.XXXXXX")"
  zip="$stage/prawko.zip"
  unpack="$stage/unpack"
  mkdir -p "$unpack" "$dest"
  say_y "Pobieram AnabelMaz/prawko ($REPO_BRANCH) jako ZIP — bez Gita..."
  curl -fsSL --retry 5 -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" \
    -o "$zip" "https://github.com/AnabelMaz/prawko/archive/refs/heads/${REPO_BRANCH}.zip" \
    || die "Nie udało się pobrać ZIP z GitHuba."
  if command -v tar >/dev/null 2>&1 && tar -tf "$zip" >/dev/null 2>&1; then
    tar -xf "$zip" -C "$unpack"
  else
    unzip -q "$zip" -d "$unpack"
  fi
  inner="$(find "$unpack" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [ -n "$inner" ] || die "ZIP z GitHuba nie zawiera katalogu (oczekiwano prawko-${REPO_BRANCH})."
  [ -f "$inner/src/index.html" ] || die "ZIP z GitHuba nie wygląda na Prawko (brak src/index.html)."
  rsync -a "$inner/" "$dest/"
  [ -f "$dest/src/index.html" ] || die "Po rozpakowaniu brak src/index.html w $dest"
  rm -rf "$stage"
  say_g "Aplikacja z ZIP: $dest"
}

install_dev_clone() {
  local dest="$1"
  [ -n "$dest" ] || die "--dev wymaga ścieżki, np. --dev ~/prawko"
  case "$dest" in
    /*) ;;
    *) dest="$INITIAL_PWD/$dest" ;;
  esac
  dest="$(mkdir -p "$(dirname "$dest")" && cd "$(dirname "$dest")" && pwd)/$(basename "$dest")"
  if [ "$dest" = "$TARGET_DIR" ]; then
    die "--dev nie klonuje do serwera ($TARGET_DIR). Podaj osobny folder na kod i git."
  fi
  case "$dest" in
    "$TARGET_DIR"/*) die "--dev: folder nie może leżeć wewnątrz $TARGET_DIR." ;;
  esac
  if looks_like_repo "$dest"; then
    say_y "-> Git do zmian już jest: $dest (pomijam clone)."
    DEV_WORK_ROOT="$dest"
    return 0
  fi
  if [ -e "$dest" ]; then
    if [ -n "$(ls -A "$dest" 2>/dev/null)" ]; then
      die "Katalog $dest już istnieje i nie jest checkoutem Prawko. Podaj pusty folder albo inną ścieżkę."
    fi
  fi
  say_y "Klonowanie $REPO_URL ($REPO_BRANCH) → $dest (kod, bez folderu mediów w gicie)..."
  as_user env GIT_LFS_SKIP_SMUDGE=1 git clone --branch "$REPO_BRANCH" "$REPO_URL" "$dest"
  [ -f "$dest/src/index.html" ] || die "Po --dev brak src/index.html w $dest"
  if is_root && [ -n "${SUDO_USER:-}" ]; then
    chown -R "$SUDO_USER" "$dest"
  fi
  DEV_WORK_ROOT="$dest"
  say_g "Git do zmian: $dest"
  say_d "Podgląd zostaje w $TARGET_DIR. Tu commitujesz i pushujesz. Na serwer: ./Install_Prawko.macos.sh --patch"
}

export_pack() {
  local dest_root dest_install dest_contrib contrib
  dest_root="$1"
  [ -n "$dest_root" ] || die "--export wymaga ścieżki, np. --export ~/Desktop/prawko-pack"
  case "$dest_root" in
    /*) ;;
    *) dest_root="$INITIAL_PWD/$dest_root" ;;
  esac
  dest_root="$(mkdir -p "$dest_root" && cd "$dest_root" && pwd)"
  case "$dest_root" in
    "$TARGET_DIR"|"$TARGET_DIR"/*) die "--export nie kopiuje do zainstalowanego serwera ($TARGET_DIR)." ;;
  esac
  contrib="$(require_contrib)"
  case "$dest_root" in
    "$contrib"|"$contrib"/*) die "--export: katalog docelowy nie może leżeć wewnątrz contrib ($contrib)." ;;
  esac
  dest_install="$dest_root/prawko"
  dest_contrib="$dest_root/prawko-contrib"
  mkdir -p "$dest_install"
  cat > "$dest_install/Install_Prawko.macos.sh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
real="$(cd "$(dirname "$0")/../prawko-contrib" && pwd)/Install_Prawko.macos.sh"
[ -f "$real" ] || { echo "Nie znaleziono $real" >&2; exit 1; }
exec bash "$real" "$@"
STUB
  chmod +x "$dest_install/Install_Prawko.macos.sh"
  say_g "-> Launcher: $dest_install/Install_Prawko.macos.sh"
  if [ "$(cd "$contrib" && pwd)" = "$(mkdir -p "$dest_contrib" && cd "$dest_contrib" && pwd)" ]; then
    say_d "-> Contrib już jest w $dest_contrib (pomijam kopię)."
  else
    mkdir -p "$dest_contrib"
    say_c "-> rsync contrib: $contrib -> $dest_contrib"
    rsync -a --exclude node_modules --exclude .git --exclude test-results \
      --exclude playwright-report --exclude blob-report --exclude coverage --exclude .cursor \
      "$contrib/" "$dest_contrib/"
    [ -f "$dest_contrib/src/index.html" ] || die "Po eksporcie brak $dest_contrib/src/index.html"
    say_g "-> Contrib: $dest_contrib"
  fi
  say_g "Gotowe. Z paczki:"
  say "  bash \"$dest_install/Install_Prawko.macos.sh\""
  say "  ... --patch  /  --install-gov  /  --export <inny folder>"
}

do_uninstall() {
  say_c "=== UNINSTALL: usuwanie launchd i katalogu Prawko ==="
  stop_launchd
  rm -f "$LAUNCH_PLIST"
  if [ -d "$TARGET_DIR" ]; then
    say_y "Usuwam $TARGET_DIR ..."
    rm -rf "$TARGET_DIR"
  fi
  [ ! -e "$TARGET_DIR" ] || die "Nie udało się usunąć $TARGET_DIR."
  say_g "Usunięto usługę $LAUNCH_LABEL i katalog aplikacji."
  say_d "Homebrew, Git i Node zostają. FFmpeg z tools/ w katalogu Prawko znika razem z folderem."
  say_d "Staging gov-data zostaje w $GOV_DATA"
}

publish_gov_questions() {
  local excel="$GOV_DATA/baza_pytan.xlsx"
  ensure_cmd node node
  ensure_python_openpyxl
  say_c "GovQuestions: Excel z gov.pl → $GOV_DATA (contrib/src/data nietknięty)"
  say_d "Bez ZIP multimediów, bez src/media, bez zmiany CDN."
  run_pipeline download-gov.sh --excel-only
  run_parse_excel "$excel" "$GOV_DATA"
  assert_gov_parsed "$GOV_DATA" "$excel"
  if copy_gov_json_to_server "$GOV_DATA" "prawko-govq"; then
    say_g "Done. Serwer czyta JSON z ministerstwa. --patch tego nie cofnie (pomija data/)."
    say_d "Oryginały nadal w contrib/src/data. Filmy z CDN."
  else
    say_y "Serwer nie zainstalowany — JSON ministerstwa tylko w gov-data. Po instalacji odpal --gov-questions jeszcze raz."
  fi
}

publish_gov_install() {
  local excel="$GOV_DATA/baza_pytan.xlsx" img_out vid_out ffmpeg
  ensure_cmd node node
  ensure_cmd ffmpeg ffmpeg
  if ! command -v cwebp >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      say_y "[Brak cwebp] Próbuję brew install webp..."
      brew_install webp || true
    fi
    if ! command -v cwebp >/dev/null 2>&1; then
      say_y "Brak cwebp — convert-media użyje ffmpeg do WebP."
    fi
  fi
  ensure_python_openpyxl
  say_c "InstallGov: Excel + ZIP multimediów sytuacyjnych z gov.pl → $GOV_DATA"
  say_d "Tłumaczeń migowych (PJM) nie pobieram."
  run_pipeline download-gov.sh
  [ -f "$excel" ] || die "Brak $excel — baza pytań z gov.pl nie została pobrana."
  if server_installed; then
    img_out="$TARGET_DIR/src/media/img"
    vid_out="$TARGET_DIR/src/media/vid"
  else
    img_out="$REAL_HOME/Library/Application Support/prawko/media/img"
    vid_out="$REAL_HOME/Library/Application Support/prawko/media/vid"
  fi
  say_c "=== Konwersja mediów sytuacyjnych (JPG→WebP, WMV→MP4) ==="
  ffmpeg="$(command -v ffmpeg)"
  run_pipeline convert-media.sh --source "$GOV_DATA/raw" --img-out "$img_out" --vid-out "$vid_out" --ffmpeg "$ffmpeg"
  say_c "=== JSON z Excela → gov-data ==="
  run_parse_excel "$excel" "$GOV_DATA"
  assert_gov_parsed "$GOV_DATA" "$excel"
  if ! server_installed; then
    say_y "Serwer nie zainstalowany — Excel/JSON/media w $GOV_DATA. Po instalacji odpal --install-gov jeszcze raz."
    return 0
  fi
  say_c "Kopiuję JSON MI na serwer (git/ contrib/src/data nietknięty)..."
  copy_gov_json_to_server "$GOV_DATA" "prawko-govmedia" || die "Brak src/data na serwerze."
  mkdir -p "$TARGET_DIR/src/media/img" "$TARGET_DIR/src/media/vid"
  if [ "$img_out" != "$TARGET_DIR/src/media/img" ]; then
    rsync -a "$img_out/" "$TARGET_DIR/src/media/img/"
    rsync -a "$vid_out/" "$TARGET_DIR/src/media/vid/"
  fi
  set_local_media_base "$TARGET_DIR"
  say_g "Done. Serwer: JSON + media z gov.pl. --patch nie nadpisze data/ ani media/."
}

do_merge() {
  local excel="$GOV_DATA/baza_pytan.xlsx" js ffmpeg="" media_args=()
  ensure_cmd node node
  ensure_python_openpyxl
  run_pipeline download-gov.sh --excel-only
  [ -f "$excel" ] || die "Brak $excel — nie ma ściągniętej bazy ministerstwa do merge."
  run_parse_excel "$excel" "$GOV_DATA"
  js="$(resolve_pipeline merge-gov.js)" || die "Brak scripts/merge-gov.js"
  if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg="$(command -v ffmpeg)"
  fi
  media_args=(--gov-dir "$GOV_DATA" --out-dir "$TARGET_DIR/src/data")
  [ -n "$ffmpeg" ] && media_args+=(--ffmpeg "$ffmpeg")
  [ -d "$GOV_DATA/raw" ] && media_args+=(--media-dir "$GOV_DATA/raw")
  [ -d "$TARGET_DIR/src/media/img" ] && media_args+=(--media-dir "$TARGET_DIR/src/media/img")
  [ -d "$TARGET_DIR/src/media/vid" ] && media_args+=(--media-dir "$TARGET_DIR/src/media/vid")
  say_c "-> merge-gov.js ${media_args[*]}"
  node "$js" "${media_args[@]}"
  restore_media_base_if_needed "$TARGET_DIR"
}

pause_if_interactive() {
  cd "$INITIAL_PWD" 2>/dev/null || true
  [ "$NONINTERACTIVE" -eq 1 ] && return 0
  [ -t 0 ] || return 0
  printf "Naciśnij Enter, aby zamknąć "
  read -r _
}

# --- dispatch ---

if [ -n "$EXPORT" ]; then
  export_pack "$EXPORT"
  exit 0
fi

if [ "$DEV_SET" -eq 1 ] && [ "$UNINSTALL" -eq 0 ]; then
  say_c "=== Git do zmian (--dev) — bez Node, bez serwera ==="
  ensure_git
  install_dev_clone "$DEV"
  if [ "$PATCH" -eq 1 ]; then
    if server_installed; then
      apply_patch
      say_g "Gotowe. W otwartej aplikacji baner: Dostępna aktualizacja / Odśwież."
    else
      say_y "Serwer nie stoi — --patch pominięty. Najpierw bash Install_Prawko.macos.sh bez przełączników."
    fi
  else
    say_d "To nie stawia localhost. Aplikacja: bash Install_Prawko.macos.sh bez przełączników."
  fi
  pause_if_interactive
  exit 0
fi

if [ "$GOV_QUESTIONS" -eq 1 ]; then
  publish_gov_questions
  pause_if_interactive
  exit 0
fi

if [ "$INSTALL_GOV" -eq 1 ]; then
  publish_gov_install
  pause_if_interactive
  exit 0
fi

if [ "$MERGE" -eq 1 ]; then
  if ! server_installed; then
    die "--merge wymaga stojącego serwera. Najpierw bash Install_Prawko.macos.sh bez przełączników."
  fi
  say_c "=== MERGE: braki z Excel MI (bez reinstalu launchd) ==="
  do_merge
  pause_if_interactive
  exit 0
fi

if [ "$PATCH" -eq 1 ] && [ "$MERGE" -eq 0 ] && [ "$UNINSTALL" -eq 0 ] && [ "$DEV_SET" -eq 0 ] && server_installed; then
  apply_patch
  say_g "Gotowe. W otwartej aplikacji baner: Dostępna aktualizacja / Odśwież."
  pause_if_interactive
  exit 0
fi

if [ "$UNINSTALL" -eq 0 ] && [ "$MERGE" -eq 0 ] && [ "$GOV_QUESTIONS" -eq 0 ] && [ "$INSTALL_GOV" -eq 0 ] && [ "$PATCH" -eq 0 ] && [ "$DEV_SET" -eq 0 ] && server_installed; then
  say_y "Serwer już stoi w $TARGET_DIR — nie nadpisuję plików (żadnego git checkout / pull)."
  say_d "  Kod z lokalnego contrib: ./Install_Prawko.macos.sh --patch"
  say_d "  Pytania MI:        ./Install_Prawko.macos.sh --install-gov   albo   --gov-questions"
  say_d "  Git do zmian:      ./Install_Prawko.macos.sh --dev ~/prawko"
  say_d "  Paczka:            ./Install_Prawko.macos.sh --export ~/Desktop/kopia"
  say_d "  Od zera:           ./Install_Prawko.macos.sh --uninstall   potem bez przełączników"
  pause_if_interactive
  exit 0
fi

# Capture original argv-equivalent for sudo re-exec
if ! is_root && need_root_for_default; then
  args=()
  [ "$NONINTERACTIVE" -eq 1 ] && args+=(--non-interactive)
  [ "$UNINSTALL" -eq 1 ] && args+=(--uninstall)
  [ "$INSTALL_GOV" -eq 1 ] && args+=(--install-gov)
  [ "$GOV_QUESTIONS" -eq 1 ] && args+=(--gov-questions)
  [ "$MERGE" -eq 1 ] && args+=(--merge)
  [ "$PATCH" -eq 1 ] && args+=(--patch)
  [ "$DROP_MISSING_MEDIA" -eq 1 ] && args+=(--drop-missing-media)
  [ -n "$EXPORT" ] && args+=(--export "$EXPORT")
  [ "$DEV_SET" -eq 1 ] && args+=(--dev "$DEV")
  if [ "$UNINSTALL" -eq 0 ]; then
    # Homebrew nie instaluje się jako root — narzędzia przed sudo, jak winget przed usługą.
    ensure_app_tools
  fi
  say_y "Wymagane uprawnienia administratora. Ponawiam z sudo..."
  exec sudo -E "$SCRIPT_PATH" "${args[@]}"
fi

load_brew_env

if [ "$UNINSTALL" -eq 1 ]; then
  do_uninstall
  pause_if_interactive
  exit 0
fi

say_c "=== 1. SPRAWDZANIE I INSTALACJA NARZĘDZI ==="
ensure_cmd node node
say_d "-> Git pominięty (serwer ze ZIP). Do kodu: --dev."
say_d "-> Tryb domyślny: ZIP AnabelMaz/prawko ($REPO_BRANCH) + CDN prawko-maz."

say_c "=== 2. ZATRZYMYWANIE LAUNCHD (JEŚLI DZIAŁA) ==="
stop_launchd

say_c "=== 3. PRZYGOTOWANIE KATALOGU APLIKACJI ==="
if server_installed; then
  say_y "Serwer już ma src w $TARGET_DIR — pomijam pobieranie / clone."
  say_d "src/data, src/media i nałożony kod zostają. Od zera: --uninstall."
elif [ -d "$TARGET_DIR/.git" ]; then
  die "Katalog $TARGET_DIR ma .git, ale brak src/index.html. Użyj --uninstall i zainstaluj ponownie."
else
  if [ -d "$TARGET_DIR" ] && [ -n "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]; then
    die "Katalog $TARGET_DIR już istnieje i nie jest pusty. Usuń go albo opróżnij przed instalacją."
  fi
  mkdir -p "$TARGET_DIR"
  install_from_github_zip "$TARGET_DIR"
fi
say_g "Katalog aplikacji gotowy: $TARGET_DIR"

say_c "=== 4–5. POMINIĘTE (baza z ZIP AnabelMaz/prawko) ==="
say_d "-> Pytania: src/data z paczki. Media: CDN prawko-maz."
say_d "-> Excel+ZIP MI: ./Install_Prawko.macos.sh --install-gov"
say_d "-> Katalog pytań MI: ./Install_Prawko.macos.sh --gov-questions"
say_d "-> Braki z MI:    ./Install_Prawko.macos.sh --merge"
say_d "-> Lokalny contrib: ./Install_Prawko.macos.sh --patch"
say_d "-> Git do zmian:    ./Install_Prawko.macos.sh --dev ~/prawko (bez serwera)"

if [ "$PATCH" -eq 1 ]; then
  say_c "=== 5b. KOD Z LOKALNEGO CONTRIB (--patch) ==="
  apply_patch
else
  say_c "=== 5b. POMINIĘTE (bez --patch) ==="
  say_d "-> Kod aplikacji zostaje jak w AnabelMaz/prawko."
fi

say_c "=== 6. INSTALACJA NPM I REJESTRACJA LAUNCHD ==="
cd "$TARGET_DIR"
[ -f "$TARGET_DIR/package.json" ] || die "Brak package.json w $TARGET_DIR — pobranie ZIP z GitHuba nie powiodło się."
npm_exe="$(resolve_npm)" || die "Brak npm (Node.js). Instalator powinien był doinstalować Node."
say_y "Instalacja 'serve'..."
"$npm_exe" install --omit=dev --no-fund --no-audit
"$npm_exe" install serve --no-fund --no-audit
serve_entry="$(resolve_serve_entry "$TARGET_DIR")" || die "Nie znaleziono pakietu 'serve' w node_modules."
node_exe="$(resolve_node)" || die "Brak node"
[ -f "$TARGET_DIR/src/index.html" ] || die "Brak src/index.html."

# User can later --patch without sudo (jak icacls Everyone na Windows).
if [ -n "${SUDO_USER:-}" ]; then
  chown -R "$SUDO_USER":admin "$TARGET_DIR" 2>/dev/null || chown -R "$SUDO_USER" "$TARGET_DIR"
  chmod -R u+rwX,go+rX "$TARGET_DIR"
fi

say_y "Rejestrowanie launchd $LAUNCH_LABEL..."
install_launchd "$node_exe" "$serve_entry"
sleep 3

if curl -fsS "http://127.0.0.1:${LISTEN_PORT}/" >/dev/null 2>&1; then
  say_g "=================================================="
  say_g " USŁUGA WYSTARTOWAŁA POPRAWNIE! "
  say_y " Aplikacja: http://localhost:${LISTEN_PORT} "
  if [ "$MERGE" -eq 1 ]; then
    say_y " Pytania:   AnabelMaz/prawko + brakujące z Excel MI (merge) "
  else
    say_y " Pytania:   baza z AnabelMaz/prawko (src/data) "
    say_y " Media:     CDN prawko-maz (Backblaze) "
  fi
  say_g "=================================================="
else
  say_r "[BŁĄD] Usługa nie odpowiada na http://localhost:${LISTEN_PORT}"
  [ -f "$TARGET_DIR/service_error.log" ] && tail -n 20 "$TARGET_DIR/service_error.log"
  exit 1
fi

pause_if_interactive
