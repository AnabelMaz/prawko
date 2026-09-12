#!/usr/bin/env bash
# Install_Prawko.macos.sh — Prawko installer for macOS (counterpart of Install_Prawko.windows.ps1).
# Download this one file and run it. Server: Homebrew/Node + ZIP + launchd.
# --dev: Git and clone only (no Node, no server).
# Pipeline (gov.pl, Excel, media, merge) is Python under scripts/, not Node.
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
SYNC_GOV=0
SYNC_SCOPE="full"
SYNC_USE_CACHE=0
MERGE_GOV=0
PATCH=0
DROP_MISSING_MEDIA=0
EXPORT=""
IMPORT=""
IMPORT_SCOPE="auto"
IMPORT_FORCE=0
EXCLUDE_DATA=0
EXCLUDE_MEDIA=0
EXCLUDE_LOCAL_JSON=0
INCLUDE_GOV_CACHE=0
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
Install_Prawko.macos.sh — Prawko installer (driving-licence exam) for macOS.

SYNOPSIS
  bash Install_Prawko.macos.sh [options]
  One file from GitHub is enough (Downloads, Desktop). You do not clone the repo by hand.
  Server (no flags): Homebrew/Node if missing, ZIP, launchd. No Git.

FLAGS (same as Install_Prawko.windows.ps1 on Windows)
  (none)                 Default mode: ZIP from GitHub AnabelMaz/prawko (branch ${REPO_BRANCH}),
                         launchd http://localhost:${LISTEN_PORT}. No Git. Questions from the repo, media
                         from the prawko-maz CDN. If the server is already running, nothing is overwritten.
  --sync-gov             Ministry data from gov.pl → staging → server.
                         Scope: --sync-scope questions|media|full (default full).
                         --sync-use-cache skips gov.pl when staging has Excel/raw.
  --drop-missing-media   Only with --sync-gov (full/media): strip missing media from JSON.
  --merge-gov            On a running server: fills gaps from ministry Excel.
  --patch                Overlays code from a local checkout (--dev, next to the script,
                         ../prawko-contrib). Skips data/ and media/.
                         On an already running server: overlay only, no sudo,
                         no launchd reinstall.
                         On first install: AnabelMaz ZIP + launchd + overlay.
  --export <path>        Portable pack. Default: snapshot/data, snapshot/media,
                         snapshot/local.json, code-only contrib (no duplicate src/data
                         or src/media when in snapshot). Opt out: --exclude-data,
                         --exclude-media, --exclude-local-json. Optional: --include-gov-cache.
  --import <path>        Restore from a pack. --import-scope auto|code|runtime.
                         --import-force overwrites existing data/media.
  --dev <path>           Git clone only (code, commit, push). Not ${TARGET_DIR}.
                         Does not install Node or launchd — even if the server is not running.
                         Git is used only here. Localhost: run the script with no flags first.
                         Folder must be empty or not exist yet.
  --uninstall            Removes launchd and ${TARGET_DIR}. Homebrew / Git / Node stay.
  --non-interactive      No Enter pause at the end.
  --help                 This help.

TWO USER TYPES
  Regular: script with no flags. ZIP + Node + launchd. No Git.
  Developer: code only, no server:
    bash Install_Prawko.macos.sh --dev ~/prawko
  Both (localhost + git): no flags first, then --dev.

  Each flag installs only what it uses:
    (none)           Homebrew if missing, Node, app ZIP, launchd
    --dev            Git + clone (no Node, no server, no sudo)
    --patch          nothing when the server is up; without a server: Node + launchd + overlay
    --sync-gov       FFmpeg if missing (full/media); Excel from gov.pl
    --merge-gov      Python; writes to the running server
    --export         nothing (file copy)
    --import         nothing (file copy onto server)
    --uninstall      nothing new

REQUIREMENTS
  Server (no flags): sudo, Homebrew/Node if missing, ZIP, launchd. No Git.
  --dev: Git + clone only (no Node, no server, no sudo). Does not install Homebrew,
         unless brew is already present and git is missing — then brew install git.
  --sync-gov: FFmpeg (full/media); Python+openpyxl. --merge-gov: Python; requires a server.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h|-Help) HELP=1; shift ;;
    --non-interactive|-NonInteractive) NONINTERACTIVE=1; shift ;;
    --uninstall|-Uninstall) UNINSTALL=1; shift ;;
    --sync-gov|-SyncGov) SYNC_GOV=1; shift ;;
    --sync-scope|-SyncScope)
      [ $# -ge 2 ] || die "--sync-scope requires questions, media, or full"
      SYNC_SCOPE="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
      shift 2
      ;;
    --sync-use-cache|-SyncUseCache) SYNC_USE_CACHE=1; shift ;;
    --merge-gov|-MergeGov) MERGE_GOV=1; shift ;;
    --patch|-Patch) PATCH=1; shift ;;
    --drop-missing-media|-DropMissingMedia) DROP_MISSING_MEDIA=1; shift ;;
    --export|-Export)
      [ $# -ge 2 ] || die "--export requires a path"
      EXPORT="$2"
      shift 2
      ;;
    --import|-Import)
      [ $# -ge 2 ] || die "--import requires a path"
      IMPORT="$2"
      shift 2
      ;;
    --import-scope|-ImportScope)
      [ $# -ge 2 ] || die "--import-scope requires auto, code, or runtime"
      IMPORT_SCOPE="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
      shift 2
      ;;
    --import-force|-ImportForce) IMPORT_FORCE=1; shift ;;
    --exclude-data|-ExcludeData) EXCLUDE_DATA=1; shift ;;
    --exclude-media|-ExcludeMedia) EXCLUDE_MEDIA=1; shift ;;
    --exclude-local-json|-ExcludeLocalJson) EXCLUDE_LOCAL_JSON=1; shift ;;
    --include-gov-cache|-IncludeGovCache) INCLUDE_GOV_CACHE=1; shift ;;
    --dev|-Dev)
      [ $# -ge 2 ] || die "--dev requires a path"
      DEV="$2"
      DEV_SET=1
      shift 2
      ;;
    *) die "Unknown argument: $1 (see --help)" ;;
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
  die "This installer is for macOS. Linux: Install_Prawko.linux.sh  Windows: Install_Prawko.windows.ps1"
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
_prawko_gov_data_preset="${PRAWKO_GOV_DATA:-}"
GOV_DATA="${_prawko_gov_data_preset:-$REAL_HOME/Library/Application Support/prawko/gov-data}"
export PRAWKO_GOV_DATA="$GOV_DATA"
DEV_WORK_ROOT=""

is_root() { [ "$(id -u)" -eq 0 ]; }

need_root_for_default() {
  # sudo only: first server install or --uninstall.
  [ "$UNINSTALL" -eq 1 ] && return 0
  [ -n "$EXPORT" ] && return 1
  [ -n "$IMPORT" ] && return 1
  [ "$SYNC_GOV" -eq 1 ] && return 1
  [ "$MERGE_GOV" -eq 1 ] && return 1
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
  say_y "Administrator privileges required. Re-running with sudo..."
  exec sudo -E "$SCRIPT_PATH" "$@"
}

looks_like_repo() {
  local root="$1"
  [ -n "$root" ] || return 1
  [ -f "$root/src/index.html" ] || return 1
  [ -f "$root/scripts/download-gov.py" ] || [ -f "$root/scripts/download-gov.ps1" ]
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
  [ -n "$found" ] || die "No local checkout for changes. Run ./Install_Prawko.macos.sh --dev <path> or keep the repo next to the installer."
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
  path="$(resolve_pipeline "$name")" || die "Missing script $name (looked next to the installer, in contrib, and in $TARGET_DIR/scripts)."
  say_c "-> $name $*"
  python3 "$path" "$@"
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
  local json="$1/src/local.json"
  python3 - "$json" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
data = {}
if p.is_file():
    try:
        parsed = json.loads(p.read_text(encoding="utf-8") or "{}")
        if isinstance(parsed, dict):
            data = parsed
    except json.JSONDecodeError:
        data = {}
data["mediaBase"] = "media"
p.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY
  say_g "-> src/local.json mediaBase=media (local files, not the CDN)."
}

stamp_cache() {
  local root="$1" prefix="$2" sw stamp
  sw="$root/src/sw.js"
  [ -f "$sw" ] || die "Missing $sw"
  stamp="$(date +%Y%m%d%H%M%S)"
  sed -i '' -E "s/const CACHE_VERSION = '[^']+';/const CACHE_VERSION = '${prefix}-${stamp}';/" "$sw"
  grep -q "const CACHE_VERSION = '${prefix}-${stamp}'" "$sw" || die "Could not stamp CACHE_VERSION in $sw"
  say_c "Service worker: ${prefix}-${stamp}"
}

remove_legacy_server_raw() {
  local legacy="$TARGET_DIR/Pytania egzaminacyjne na prawo jazdy 2025"
  [ -e "$legacy" ] || return 0
  say_y "Removing leftover raw-media folder from the server: $legacy"
  rm -rf "$legacy"
  [ ! -e "$legacy" ] || die "Could not remove $legacy."
}

copy_gov_json_to_server() {
  local gov_dir="$1" sw_prefix="$2" cat tr
  [ -f "$TARGET_DIR/src/index.html" ] && [ -d "$TARGET_DIR/src/data" ] || return 1
  cp "$gov_dir/meta.json" "$TARGET_DIR/src/data/meta.json" || return 2
  for cat in A A1 A2 AM B B1 C C1 D D1 PT T; do
    if [ -f "$gov_dir/$cat.json" ]; then
      cp "$gov_dir/$cat.json" "$TARGET_DIR/src/data/$cat.json" || return 2
    fi
  done
  for tr in translations_en.json translations_de.json translations_uk.json; do
    if [ -f "$gov_dir/$tr" ]; then
      cp "$gov_dir/$tr" "$TARGET_DIR/src/data/$tr" || return 2
    fi
  done
  stamp_cache "$TARGET_DIR" "$sw_prefix"
  return 0
}

overlay_src() {
  local src_app="$1" dest_root="$2" prefix="$3"
  [ -f "$src_app/index.html" ] || die "Missing $src_app/index.html"
  [ -f "$dest_root/src/index.html" ] || die "Server is not installed (missing $dest_root/src/index.html)."
  say_c "-> Overlaying $src_app -> $dest_root/src (skipping data/ and media/)"
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
    say_y "-> No local contrib. Leaving code from GitHub $REPO_URL ($REPO_BRANCH)."
    return 0
  fi
  say_y "-> Overlaying code from local contrib: $contrib"
  overlay_src "$contrib/src" "$TARGET_DIR" "prawko-patch"
  say_g "-> Overlayed code from local contrib."
}

load_brew_env() {
  # sudo on macOS often overwrites PATH (secure_path) — Git/Node from brew disappear.
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
  say_y "[Homebrew missing] Installing Homebrew (Windows winget equivalent)..."
  say_d "This may take a while. Administrator password: same as on first Windows install."
  as_user env NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  load_brew_env
  command -v brew >/dev/null 2>&1 || die "Homebrew is not available after install. Check the network and retry."
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
  # /usr/bin/git and python3 are sometimes CLT stubs — command -v lies, --version does not.
  if command -v "$cmd" >/dev/null 2>&1 && "$cmd" --version >/dev/null 2>&1; then
    say_g "[OK] $cmd"
    return 0
  fi
  say_y "[Missing $cmd] Installing $brew_pkg..."
  brew_install "$brew_pkg"
  load_brew_env
  if command -v "$cmd" >/dev/null 2>&1 && "$cmd" --version >/dev/null 2>&1; then
    say_g "[OK] $cmd"
    return 0
  fi
  die "$cmd is not available after install."
}

ensure_app_tools() {
  say_c "=== Tools (Node — installer will add it if needed) ==="
  ensure_cmd node node
}

ensure_git() {
  say_c "=== Git (--dev only) ==="
  load_brew_env
  if command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; then
    say_g "[OK] git"
    return 0
  fi
  if command -v brew >/dev/null 2>&1; then
    say_y "[Missing git] Installing git via Homebrew (brew is already present)..."
    brew_install git
    load_brew_env
    if command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; then
      say_g "[OK] git"
      return 0
    fi
  fi
  die "Git is missing. --dev does not install Node, Homebrew, or the server. Install Git (xcode-select --install or brew install git) and retry."
}

ensure_python_openpyxl() {
  ensure_cmd python3 python
  if as_user python3 -c "import openpyxl" 2>/dev/null; then
    return 0
  fi
  say_y "Installing openpyxl (parse-excel.py)..."
  as_user python3 -m pip install --user openpyxl
  as_user python3 -c "import openpyxl" || die "openpyxl is not available (python3 -m pip install --user openpyxl)."
}

run_parse_excel() {
  local excel="$1" out="$2"
  shift 2
  local py extra=()
  py="$(resolve_pipeline parse-excel.py)" || die "Missing scripts/parse-excel.py"
  extra=(--excel "$excel" --out-dir "$out")
  if [ "$DROP_MISSING_MEDIA" -eq 1 ]; then
    extra+=(--drop-missing-media --media-dir "$GOV_DATA/raw")
    say_y "DropMissingMedia: questions without a local file in raw lose their media reference."
  fi
  say_c "-> parse-excel.py ${extra[*]}"
  as_user python3 "$py" "${extra[@]}"
}

assert_gov_parsed() {
  local gov_dir="$1" excel="$2" meta qtotal
  meta="$gov_dir/meta.json"
  [ -f "$meta" ] || die "Missing meta.json after parsing Excel."
  qtotal="$(as_user python3 -c "import json,sys; m=json.load(open(sys.argv[1],encoding='utf-8')); print(sum(int(c.get('questionCount') or 0) for c in (m.get('categories') or [])))" "$meta")"
  if [ "${qtotal:-0}" -lt 100 ]; then
    die "Excel parser wrote too few questions ($qtotal). Check the column layout in $excel."
  fi
  say_g "-> In gov-data: $qtotal question assignments. Originals in contrib/src/data are left as-is."
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
  git_exe="$(resolve_git)" || die "Missing git"
  GIT_LFS_SKIP_SMUDGE=1 "$git_exe" clone --branch "$REPO_BRANCH" "$REPO_URL" "$dest"
}

install_from_github_zip() {
  local dest="$1" stage zip unpack inner
  stage="$(mktemp -d "${TMPDIR:-/tmp}/prawko-zip.XXXXXX")"
  zip="$stage/prawko.zip"
  unpack="$stage/unpack"
  mkdir -p "$unpack" "$dest"
  say_y "Downloading AnabelMaz/prawko ($REPO_BRANCH) as ZIP — no Git..."
  curl -fsSL --retry 5 -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" \
    -o "$zip" "https://github.com/AnabelMaz/prawko/archive/refs/heads/${REPO_BRANCH}.zip" \
    || die "Could not download the ZIP from GitHub."
  if command -v tar >/dev/null 2>&1 && tar -tf "$zip" >/dev/null 2>&1; then
    tar -xf "$zip" -C "$unpack"
  else
    unzip -q "$zip" -d "$unpack"
  fi
  inner="$(find "$unpack" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [ -n "$inner" ] || die "GitHub ZIP contains no directory (expected prawko-${REPO_BRANCH})."
  [ -f "$inner/src/index.html" ] || die "GitHub ZIP does not look like Prawko (missing src/index.html)."
  rsync -a "$inner/" "$dest/"
  [ -f "$dest/src/index.html" ] || die "After unpacking, src/index.html is missing in $dest"
  rm -rf "$stage"
  say_g "App from ZIP: $dest"
}

install_dev_clone() {
  local dest="$1"
  [ -n "$dest" ] || die "--dev requires a path, e.g. --dev ~/prawko"
  case "$dest" in
    /*) ;;
    *) dest="$INITIAL_PWD/$dest" ;;
  esac
  dest="$(mkdir -p "$(dirname "$dest")" && cd "$(dirname "$dest")" && pwd)/$(basename "$dest")"
  if [ "$dest" = "$TARGET_DIR" ]; then
    die "--dev does not clone into the server ($TARGET_DIR). Give a separate folder for code and git."
  fi
  case "$dest" in
    "$TARGET_DIR"/*) die "--dev: folder must not lie inside $TARGET_DIR." ;;
  esac
  if looks_like_repo "$dest"; then
    say_y "-> Git for changes is already there: $dest (skipping clone)."
    DEV_WORK_ROOT="$dest"
    return 0
  fi
  if [ -e "$dest" ]; then
    if [ -n "$(ls -A "$dest" 2>/dev/null)" ]; then
      die "Directory $dest already exists and is not a Prawko checkout. Give an empty folder or another path."
    fi
  fi
  say_y "Cloning $REPO_URL ($REPO_BRANCH) → $dest (code, no media folder in git)..."
  as_user env GIT_LFS_SKIP_SMUDGE=1 git clone --branch "$REPO_BRANCH" "$REPO_URL" "$dest"
  [ -f "$dest/src/index.html" ] || die "After --dev, src/index.html is missing in $dest"
  if is_root && [ -n "${SUDO_USER:-}" ]; then
    chown -R "$SUDO_USER" "$dest"
  fi
  DEV_WORK_ROOT="$dest"
  say_g "Git for changes: $dest"
  say_d "Preview stays in $TARGET_DIR. You commit and push here. Onto the server: ./Install_Prawko.macos.sh --patch"
}

dir_has_files() {
  [ -d "$1" ] && [ -n "$(find "$1" -type f 2>/dev/null | head -n 1)" ]
}

rsync_progress() {
  if rsync --help 2>&1 | grep -q -- '--info=progress2'; then
    rsync --info=progress2 "$@"
  else
    rsync --progress "$@"
  fi
}

resolve_export_data_src() {
  if [ -f "$TARGET_DIR/src/data/meta.json" ]; then echo "$TARGET_DIR/src/data"; return 0; fi
  local contrib; contrib="$(require_contrib)"
  if [ -f "$contrib/src/data/meta.json" ]; then echo "$contrib/src/data"; return 0; fi
  return 1
}

resolve_export_media_root() {
  if dir_has_files "$TARGET_DIR/src/media/img" || dir_has_files "$TARGET_DIR/src/media/vid"; then
    echo "$TARGET_DIR/src/media"; return 0
  fi
  local contrib; contrib="$(require_contrib)"
  if dir_has_files "$contrib/src/media/img" || dir_has_files "$contrib/src/media/vid"; then
    echo "$contrib/src/media"; return 0
  fi
  local local_media="$REAL_HOME/Library/Application Support/prawko/media"
  if dir_has_files "$local_media/img" || dir_has_files "$local_media/vid"; then
    echo "$local_media"; return 0
  fi
  return 1
}

write_export_manifest() {
  local path="$1" data="$2" media="$3" localjson="$4" govcache="$5"
  local ds="$6" ms="$7" ls="$8" gs="$9"
  python3 - "$path" "$data" "$media" "$localjson" "$govcache" "$ds" "$ms" "$ls" "$gs" <<'PY'
import json, sys, datetime
path, data, media, localjson, govcache, ds, ms, ls, gs = sys.argv[1:10]
locations = {"code": "contrib"}
if data == "1":
    locations["data"] = "snapshot"
if media == "1":
    locations["media"] = "snapshot"
if localjson == "1":
    locations["localJson"] = "snapshot"
payload = {
    "format": 1,
    "created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "platform": "macos",
    "components": {
        "code": True,
        "data": data == "1",
        "media": media == "1",
        "localJson": localjson == "1",
        "govCache": govcache == "1",
    },
    "sources": {k: v for k, v in [
        ("data", ds), ("media", ms), ("localJson", ls), ("govCache", gs)
    ] if v},
    "locations": locations,
}
open(path, "w", encoding="utf-8").write(json.dumps(payload, indent=2) + "\n")
PY
}

export_pack() {
  local dest_root dest_install dest_contrib contrib data_src media_src local_src
  local has_data=0 has_media=0 has_local=0 has_gov=0
  local src_data="" src_media="" src_local="" src_gov=""
  dest_root="$1"
  [ -n "$dest_root" ] || die "--export requires a path, e.g. --export ~/Desktop/prawko-pack"
  case "$dest_root" in
    /*) ;;
    *) dest_root="$INITIAL_PWD/$dest_root" ;;
  esac
  dest_root="$(mkdir -p "$dest_root" && cd "$dest_root" && pwd)"
  case "$dest_root" in
    "$TARGET_DIR"|"$TARGET_DIR"/*) die "--export does not copy into the installed server ($TARGET_DIR)." ;;
  esac
  contrib="$(require_contrib)"
  case "$dest_root" in
    "$contrib"|"$contrib"/*) die "--export: destination directory must not lie inside contrib ($contrib)." ;;
  esac
  dest_install="$dest_root/prawko"
  dest_contrib="$dest_root/prawko-contrib"
  mkdir -p "$dest_install"
  cat > "$dest_install/Install_Prawko.macos.sh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
real="$(cd "$(dirname "$0")/../prawko-contrib" && pwd)/Install_Prawko.macos.sh"
[ -f "$real" ] || { echo "Not found: $real" >&2; exit 1; }
exec bash "$real" "$@"
STUB
  chmod +x "$dest_install/Install_Prawko.macos.sh"
  say_g "-> Launcher: $dest_install/Install_Prawko.macos.sh"
  if [ "$EXCLUDE_DATA" -eq 0 ]; then
    if data_src="$(resolve_export_data_src)"; then
      mkdir -p "$dest_root/snapshot/data"
      say_c "-> Snapshot data: $data_src"
      rsync_progress -a "$data_src/" "$dest_root/snapshot/data/"
      has_data=1; src_data="$data_src"
    else
      say_y "-> Snapshot data: nothing to export."
    fi
  fi
  if [ "$EXCLUDE_MEDIA" -eq 0 ]; then
    if media_src="$(resolve_export_media_root)"; then
      mkdir -p "$dest_root/snapshot/media"
      say_c "-> Snapshot media: $media_src"
      for sub in img vid; do
        [ -d "$media_src/$sub" ] || continue
        mkdir -p "$dest_root/snapshot/media/$sub"
        rsync_progress -a "$media_src/$sub/" "$dest_root/snapshot/media/$sub/"
      done
      has_media=1; src_media="$media_src"
    else
      say_y "-> Snapshot media: nothing to export."
    fi
  fi
  if [ "$EXCLUDE_LOCAL_JSON" -eq 0 ]; then
    if [ -f "$TARGET_DIR/src/local.json" ]; then
      mkdir -p "$dest_root/snapshot"
      cp "$TARGET_DIR/src/local.json" "$dest_root/snapshot/local.json"
      has_local=1; src_local="$TARGET_DIR/src/local.json"
      say_c "-> Snapshot local.json"
    elif [ "$has_media" -eq 1 ]; then
      mkdir -p "$dest_root/snapshot"
      printf '{\n  "mediaBase": "media"\n}\n' > "$dest_root/snapshot/local.json"
      has_local=1; src_local="(generated)"
      say_c "-> Snapshot local.json: generated mediaBase=media"
    fi
  fi
  if [ "$INCLUDE_GOV_CACHE" -eq 1 ]; then
    if dir_has_files "$GOV_DATA"; then
      mkdir -p "$dest_root/gov-cache/gov-data"
      say_c "-> Gov cache: $GOV_DATA"
      rsync_progress -a "$GOV_DATA/" "$dest_root/gov-cache/gov-data/"
      has_gov=1; src_gov="$GOV_DATA"
    else
      say_y "-> Gov cache: nothing to export."
    fi
  fi
  if [ "$(cd "$contrib" && pwd)" = "$(mkdir -p "$dest_contrib" && cd "$dest_contrib" && pwd)" ]; then
    say_d "-> Contrib is already in $dest_contrib (skipping copy)."
  else
    mkdir -p "$dest_contrib"
    say_c "-> rsync contrib: $contrib -> $dest_contrib (code only)"
    _rsync_ex=(
      -a
      --exclude node_modules --exclude .git --exclude test-results
      --exclude playwright-report --exclude blob-report --exclude coverage --exclude .cursor --exclude gov-data
    )
    if [ "$has_data" -eq 1 ]; then
      _rsync_ex+=(--exclude 'src/data/')
      say_d "   Runtime in snapshot — omitting contrib src/data"
    fi
    if [ "$has_media" -eq 1 ]; then
      _rsync_ex+=(--exclude 'src/media/')
      say_d "   Runtime in snapshot — omitting contrib src/media"
    fi
    rsync_progress "${_rsync_ex[@]}" "$contrib/" "$dest_contrib/"
    unset _rsync_ex
    [ -f "$dest_contrib/src/index.html" ] || die "After export, missing $dest_contrib/src/index.html"
    say_g "-> Contrib: $dest_contrib"
  fi
  write_export_manifest "$dest_root/manifest.json" "$has_data" "$has_media" "$has_local" "$has_gov" \
    "$src_data" "$src_media" "$src_local" "$src_gov"
  say_g "-> Manifest: $dest_root/manifest.json"
  say_g "Done. From the pack:"
  say "  bash \"$dest_install/Install_Prawko.macos.sh\""
  say "  ... --import \"$dest_root\"   /   --patch   /   --sync-gov"
}

import_pack() {
  local pack_root="$1" pack_contrib="$pack_root/prawko-contrib" snapshot="$pack_root/snapshot"
  local do_code=0 do_runtime=0
  [ -n "$pack_root" ] || die "--import requires a path"
  case "$pack_root" in
    /*) ;;
    *) pack_root="$INITIAL_PWD/$pack_root" ;;
  esac
  pack_root="$(cd "$pack_root" && pwd)"
  [ -d "$pack_root" ] || die "--import: pack not found: $pack_root"
  case "$IMPORT_SCOPE" in
    code) do_code=1 ;;
    runtime) do_runtime=1 ;;
    auto) do_code=1; do_runtime=1 ;;
    *) die "Unknown --import-scope: $IMPORT_SCOPE" ;;
  esac
  say_c "Import <- $pack_root"
  if [ "$do_code" -eq 1 ]; then
    [ -f "$pack_contrib/src/index.html" ] || die "--import: missing $pack_contrib/src/index.html"
    server_installed || die "--import needs a running server. First run with no flags, then --import."
    say_c "-> Overlay code from pack contrib"
    overlay_src "$pack_contrib/src" "$TARGET_DIR" "prawko-import"
  fi
  if [ "$do_runtime" -eq 1 ]; then
    server_installed || die "--import needs a running server. First run with no flags, then --import."
    if [ -f "$snapshot/data/meta.json" ]; then
      if [ "$IMPORT_FORCE" -eq 0 ] && [ -f "$TARGET_DIR/src/data/meta.json" ]; then
        say_y "-> Server data exists; use --import-force to overwrite."
      else
        mkdir -p "$TARGET_DIR/src/data"
        say_c "-> Restore data"
        rsync_progress -a "$snapshot/data/" "$TARGET_DIR/src/data/"
      fi
    fi
    if [ -d "$snapshot/media/img" ] || [ -d "$snapshot/media/vid" ]; then
      if [ "$IMPORT_FORCE" -eq 0 ] && { dir_has_files "$TARGET_DIR/src/media/img" || dir_has_files "$TARGET_DIR/src/media/vid"; }; then
        say_y "-> Server media exists; use --import-force to overwrite."
      else
        mkdir -p "$TARGET_DIR/src/media/img" "$TARGET_DIR/src/media/vid"
        for sub in img vid; do
          [ -d "$snapshot/media/$sub" ] || continue
          say_c "-> Restore media/$sub"
          rsync_progress -a "$snapshot/media/$sub/" "$TARGET_DIR/src/media/$sub/"
        done
      fi
    fi
    if [ -f "$snapshot/local.json" ]; then
      cp "$snapshot/local.json" "$TARGET_DIR/src/local.json"
      say_c "-> Restore local.json"
    elif dir_has_files "$TARGET_DIR/src/media/img" || dir_has_files "$TARGET_DIR/src/media/vid"; then
      set_local_media_base "$TARGET_DIR"
    fi
    stamp_cache "$TARGET_DIR" "prawko-import"
  fi
  if [ -d "$pack_root/gov-cache/gov-data" ]; then
    mkdir -p "$GOV_DATA"
    say_c "-> Restore gov-cache"
    rsync_progress -a "$pack_root/gov-cache/gov-data/" "$GOV_DATA/"
  fi
  say_g "Done. Refresh the app in the browser."
}

do_uninstall() {
  say_c "=== UNINSTALL: removing launchd and the Prawko directory ==="
  stop_launchd
  rm -f "$LAUNCH_PLIST"
  if [ -d "$TARGET_DIR" ]; then
    say_y "Removing $TARGET_DIR ..."
    rm -rf "$TARGET_DIR"
  fi
  [ ! -e "$TARGET_DIR" ] || die "Could not remove $TARGET_DIR."
  say_g "Removed service $LAUNCH_LABEL and the application directory."
  say_d "Homebrew, Git, and Node stay. Homebrew FFmpeg too (it is not under $TARGET_DIR/tools)."
  say_d "gov-data staging stays in $GOV_DATA"
}

publish_gov_questions() {
  local excel="$GOV_DATA/baza_pytan.xlsx" copy_rc=0
  ensure_python_openpyxl
  remove_legacy_server_raw
  say_c "SyncGov Questions: Excel from gov.pl → $GOV_DATA (contrib/src/data left untouched)"
  say_d "No media ZIP, no src/media, no CDN change."
  run_pipeline download-gov.py --excel-only
  run_parse_excel "$excel" "$GOV_DATA"
  assert_gov_parsed "$GOV_DATA" "$excel"
  copy_gov_json_to_server "$GOV_DATA" "prawko-govq" || copy_rc=$?
  if [ "$copy_rc" -eq 0 ]; then
    say_g "Done. Server reads ministry JSON. --patch will not revert this (it skips data/)."
    say_d "Originals remain in contrib/src/data. Videos from the CDN."
  elif [ "$copy_rc" -eq 1 ]; then
    say_y "Server is not installed — ministry JSON only in gov-data. After install, run --sync-gov --sync-scope questions again."
  else
    say_y "Ministry JSON is in gov-data, but could not be written to the server."
    say_d "contrib/src/data left untouched. Check permissions on $TARGET_DIR or copy gov-data by hand."
  fi
}

publish_gov_install() {
  local excel="$GOV_DATA/baza_pytan.xlsx" img_out vid_out ffmpeg copy_rc=0 skip_dl=0
  [ "${1:-}" = "skip_download" ] && skip_dl=1
  ensure_cmd ffmpeg ffmpeg
  if ! command -v cwebp >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      say_y "[Missing cwebp] Trying brew install webp..."
      brew_install webp || true
    fi
    if ! command -v cwebp >/dev/null 2>&1; then
      say_y "cwebp missing — convert-media will use ffmpeg for WebP."
    fi
  fi
  ensure_python_openpyxl
  say_c "SyncGov Full: Excel + situational-media ZIP from gov.pl → $GOV_DATA"
  say_d "Not downloading PJM (sign-language) packs."
  if [ "$skip_dl" -eq 0 ]; then
    run_pipeline download-gov.py
  else
    say_d "Skipping gov.pl download (--sync-use-cache / cached staging)."
  fi
  [ -f "$excel" ] || die "Missing $excel — the question bank from gov.pl was not downloaded."
  if server_installed; then
    img_out="$TARGET_DIR/src/media/img"
    vid_out="$TARGET_DIR/src/media/vid"
  else
    img_out="$REAL_HOME/Library/Application Support/prawko/media/img"
    vid_out="$REAL_HOME/Library/Application Support/prawko/media/vid"
  fi
  say_c "=== Converting situational media (JPG→WebP, WMV→MP4) ==="
  ffmpeg="$(command -v ffmpeg)"
  run_pipeline convert-media.py --source "$GOV_DATA/raw" --img-out "$img_out" --vid-out "$vid_out" --ffmpeg "$ffmpeg"
  say_c "=== JSON from Excel → gov-data ==="
  run_parse_excel "$excel" "$GOV_DATA"
  assert_gov_parsed "$GOV_DATA" "$excel"
  remove_legacy_server_raw
  if ! server_installed; then
    say_y "Server is not installed — Excel/JSON/media in $GOV_DATA. After install, run --sync-gov again."
    return 0
  fi
  say_c "Copying ministry JSON onto the server (git/ contrib/src/data left untouched)..."
  copy_gov_json_to_server "$GOV_DATA" "prawko-govmedia" || copy_rc=$?
  if [ "$copy_rc" -ne 0 ]; then
    say_y "JSON/media are in staging, but could not be written to the server."
    say_d "Check permissions on $TARGET_DIR."
    return 0
  fi
  mkdir -p "$TARGET_DIR/src/media/img" "$TARGET_DIR/src/media/vid"
  if [ "$img_out" != "$TARGET_DIR/src/media/img" ]; then
    say_c "Copying WebP/MP4: $img_out + $vid_out → $TARGET_DIR/src/media"
    rsync -a "$img_out/" "$TARGET_DIR/src/media/img/" || {
      say_y "JSON is on the server, but the media copy did not land. Check permissions on $TARGET_DIR."
      return 0
    }
    rsync -a "$vid_out/" "$TARGET_DIR/src/media/vid/" || {
      say_y "JSON is on the server, but the media copy did not land. Check permissions on $TARGET_DIR."
      return 0
    }
  fi
  set_local_media_base "$TARGET_DIR"
  say_g "Done. Server: JSON + media from gov.pl. --patch will not overwrite data/ or media/."
}

publish_sync_gov_media() {
  local img_out vid_out ffmpeg raw_dir="$GOV_DATA/raw"
  dir_has_files "$raw_dir" || die "No situational raw in $GOV_DATA/raw. Run --sync-gov --sync-scope full first."
  ensure_cmd ffmpeg ffmpeg
  if server_installed; then
    img_out="$TARGET_DIR/src/media/img"
    vid_out="$TARGET_DIR/src/media/vid"
  else
    img_out="$REAL_HOME/Library/Application Support/prawko/media/img"
    vid_out="$REAL_HOME/Library/Application Support/prawko/media/vid"
  fi
  say_c "SyncGov Media: convert existing raw → WebP/MP4 (no Excel download)."
  ffmpeg="$(command -v ffmpeg)"
  run_pipeline convert-media.py --source "$raw_dir" --img-out "$img_out" --vid-out "$vid_out" --ffmpeg "$ffmpeg"
  remove_legacy_server_raw
  server_installed || {
    say_y "Server is not installed — media in staging. After install, run --sync-gov --sync-scope media again."
    return 0
  }
  mkdir -p "$TARGET_DIR/src/media/img" "$TARGET_DIR/src/media/vid"
  if [ "$img_out" != "$TARGET_DIR/src/media/img" ]; then
    rsync -a "$img_out/" "$TARGET_DIR/src/media/img/"
    rsync -a "$vid_out/" "$TARGET_DIR/src/media/vid/"
  fi
  set_local_media_base "$TARGET_DIR"
  say_g "Done. Server uses local media (mediaBase=media)."
}

invoke_sync_gov() {
  case "$SYNC_SCOPE" in
    questions) publish_gov_questions ;;
    media) publish_sync_gov_media ;;
    full)
      if [ "$SYNC_USE_CACHE" -eq 1 ] && [ -f "$GOV_DATA/baza_pytan.xlsx" ] && dir_has_files "$GOV_DATA/raw"; then
        say_d "SyncUseCache: staging has Excel and raw — skipping gov.pl download."
        publish_gov_install skip_download
      else
        publish_gov_install
      fi
      ;;
    *) die "Unknown --sync-scope: $SYNC_SCOPE (use questions, media, or full)." ;;
  esac
}

do_merge() {
  local excel="$GOV_DATA/baza_pytan.xlsx" py ffmpeg="" media_args=()
  ensure_python_openpyxl
  remove_legacy_server_raw
  run_pipeline download-gov.py --excel-only
  [ -f "$excel" ] || die "Missing $excel — no downloaded ministry bank to merge."
  run_parse_excel "$excel" "$GOV_DATA"
  py="$(resolve_pipeline merge-gov.py)" || die "Missing scripts/merge-gov.py"
  if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg="$(command -v ffmpeg)"
  else
    say_y "-> FFmpeg missing — merge without frame comparison (media filename only)."
  fi
  media_args=(--gov-dir "$GOV_DATA" --out-dir "$TARGET_DIR/src/data")
  [ -n "$ffmpeg" ] && media_args+=(--ffmpeg "$ffmpeg")
  [ -d "$GOV_DATA/raw" ] && media_args+=(--media-dir "$GOV_DATA/raw")
  [ -d "$TARGET_DIR/src/media/img" ] && media_args+=(--media-dir "$TARGET_DIR/src/media/img")
  [ -d "$TARGET_DIR/src/media/vid" ] && media_args+=(--media-dir "$TARGET_DIR/src/media/vid")
  say_c "-> merge-gov.py ${media_args[*]}"
  python3 "$py" "${media_args[@]}"
  restore_media_base_if_needed "$TARGET_DIR"
}

pause_if_interactive() {
  cd "$INITIAL_PWD" 2>/dev/null || true
  [ "$NONINTERACTIVE" -eq 1 ] && return 0
  [ -t 0 ] || return 0
  printf "Press Enter to close "
  read -r _
}

# --- dispatch ---

if [ -n "$EXPORT" ]; then
  export_pack "$EXPORT"
  exit 0
fi

if [ -n "$IMPORT" ]; then
  import_pack "$IMPORT"
  pause_if_interactive
  exit 0
fi

if [ "$DEV_SET" -eq 1 ] && [ "$UNINSTALL" -eq 0 ]; then
  say_c "=== Git for changes (--dev) — no Node, no server ==="
  ensure_git
  install_dev_clone "$DEV"
  if [ "$PATCH" -eq 1 ]; then
    if server_installed; then
      remove_legacy_server_raw
      apply_patch
      say_g "Done. In the open app, banner: Available update / Refresh."
    else
      say_y "Server is not running — --patch skipped. First run bash Install_Prawko.macos.sh with no flags."
    fi
  else
    say_d "This does not start localhost. App: bash Install_Prawko.macos.sh with no flags."
  fi
  pause_if_interactive
  exit 0
fi

if [ "$SYNC_GOV" -eq 1 ] || [ "$MERGE_GOV" -eq 1 ]; then
  _prawko_gov_py="$(resolve_pipeline download-gov.py)" || die "Missing scripts/download-gov.py. Run the installer with no flags (it will download the app with scripts into $TARGET_DIR) or run it from the root of a cloned repo."
  command -v python3 >/dev/null 2>&1 || die "python3 is required for --sync-gov / --merge-gov."
  if [ -n "$_prawko_gov_data_preset" ]; then
    export PRAWKO_GOV_DATA="$_prawko_gov_data_preset"
  else
    unset PRAWKO_GOV_DATA
  fi
  GOV_DATA="$(python3 "$_prawko_gov_py" --print-gov-data-dir)"
  export PRAWKO_GOV_DATA="$GOV_DATA"
  unset _prawko_gov_py
fi

if [ "$SYNC_GOV" -eq 1 ]; then
  invoke_sync_gov
  pause_if_interactive
  exit 0
fi

if [ "$MERGE_GOV" -eq 1 ]; then
  if ! server_installed; then
    die "--merge-gov requires a running server. First run bash Install_Prawko.macos.sh with no flags."
  fi
  say_c "=== MergeGov: gaps from ministry Excel (no launchd reinstall) ==="
  do_merge
  pause_if_interactive
  exit 0
fi

if [ "$PATCH" -eq 1 ] && [ "$MERGE_GOV" -eq 0 ] && [ "$UNINSTALL" -eq 0 ] && [ "$DEV_SET" -eq 0 ] && server_installed; then
  remove_legacy_server_raw
  apply_patch
  say_g "Done. In the open app, banner: Available update / Refresh."
  pause_if_interactive
  exit 0
fi

if [ "$UNINSTALL" -eq 0 ] && [ "$MERGE_GOV" -eq 0 ] && [ "$SYNC_GOV" -eq 0 ] && [ "$PATCH" -eq 0 ] && [ "$DEV_SET" -eq 0 ] && [ -z "$IMPORT" ] && server_installed; then
  remove_legacy_server_raw
  say_y "Server already running in $TARGET_DIR — not overwriting files (no git checkout / pull)."
  say_d "  Code from local contrib: ./Install_Prawko.macos.sh --patch"
  say_d "  Ministry data:         ./Install_Prawko.macos.sh --sync-gov"
  say_d "  Git for changes:       ./Install_Prawko.macos.sh --dev ~/prawko"
  say_d "  Pack:                  ./Install_Prawko.macos.sh --export ~/Desktop/kopia"
  say_d "  Restore:               ./Install_Prawko.macos.sh --import ~/Desktop/kopia"
  say_d "  From scratch:          ./Install_Prawko.macos.sh --uninstall   then with no flags"
  pause_if_interactive
  exit 0
fi

# Capture original argv-equivalent for sudo re-exec
if ! is_root && need_root_for_default; then
  args=()
  [ "$NONINTERACTIVE" -eq 1 ] && args+=(--non-interactive)
  [ "$UNINSTALL" -eq 1 ] && args+=(--uninstall)
  [ "$SYNC_GOV" -eq 1 ] && args+=(--sync-gov)
  [ "$SYNC_GOV" -eq 1 ] && [ "$SYNC_SCOPE" != "full" ] && args+=(--sync-scope "$SYNC_SCOPE")
  [ "$SYNC_USE_CACHE" -eq 1 ] && args+=(--sync-use-cache)
  [ "$MERGE_GOV" -eq 1 ] && args+=(--merge-gov)
  [ "$PATCH" -eq 1 ] && args+=(--patch)
  [ "$DROP_MISSING_MEDIA" -eq 1 ] && args+=(--drop-missing-media)
  [ -n "$EXPORT" ] && args+=(--export "$EXPORT")
  [ -n "$IMPORT" ] && args+=(--import "$IMPORT")
  [ "$EXCLUDE_DATA" -eq 1 ] && args+=(--exclude-data)
  [ "$EXCLUDE_MEDIA" -eq 1 ] && args+=(--exclude-media)
  [ "$EXCLUDE_LOCAL_JSON" -eq 1 ] && args+=(--exclude-local-json)
  [ "$INCLUDE_GOV_CACHE" -eq 1 ] && args+=(--include-gov-cache)
  [ "$IMPORT_FORCE" -eq 1 ] && args+=(--import-force)
  [ -n "$IMPORT" ] && [ "$IMPORT_SCOPE" != "auto" ] && args+=(--import-scope "$IMPORT_SCOPE")
  [ "$DEV_SET" -eq 1 ] && args+=(--dev "$DEV")
  if [ "$UNINSTALL" -eq 0 ]; then
    # Homebrew does not install as root — tools before sudo, like winget before the service.
    ensure_app_tools
  fi
  say_y "Administrator privileges required. Re-running with sudo..."
  exec sudo -E "$SCRIPT_PATH" "${args[@]}"
fi

load_brew_env

if [ "$UNINSTALL" -eq 1 ]; then
  do_uninstall
  pause_if_interactive
  exit 0
fi

say_c "=== 1. CHECKING AND INSTALLING TOOLS ==="
ensure_cmd node node
say_d "-> Git skipped (server from ZIP). For code: --dev."
say_d "-> Default mode: ZIP AnabelMaz/prawko ($REPO_BRANCH) + CDN prawko-maz."

say_c "=== 2. STOPPING LAUNCHD (IF RUNNING) ==="
stop_launchd

say_c "=== 3. PREPARING THE APPLICATION DIRECTORY ==="
if server_installed; then
  say_y "Server already has src in $TARGET_DIR — skipping download / clone."
  say_d "src/data, src/media, and overlayed code stay. From scratch: --uninstall."
elif [ -d "$TARGET_DIR/.git" ]; then
  die "Directory $TARGET_DIR has .git but is missing src/index.html. Use --uninstall and install again."
else
  if [ -d "$TARGET_DIR" ] && [ -n "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]; then
    die "Directory $TARGET_DIR already exists and is not empty. Remove or empty it before install."
  fi
  mkdir -p "$TARGET_DIR"
  install_from_github_zip "$TARGET_DIR"
fi
say_g "Application directory ready: $TARGET_DIR"
remove_legacy_server_raw

say_c "=== 4–5. SKIPPED (bank from AnabelMaz/prawko ZIP) ==="
say_d "-> Questions: src/data from the pack. Media: CDN prawko-maz."
say_d "-> Ministry sync: ./Install_Prawko.macos.sh --sync-gov"
say_d "-> Gaps from ministry: ./Install_Prawko.macos.sh --merge-gov"
say_d "-> Pack / restore: --export / --import"
say_d "-> Local contrib: ./Install_Prawko.macos.sh --patch"
say_d "-> Git for changes:    ./Install_Prawko.macos.sh --dev ~/prawko (no server)"

if [ "$PATCH" -eq 1 ]; then
  say_c "=== 5b. CODE FROM LOCAL CONTRIB (--patch) ==="
  apply_patch
else
  say_c "=== 5b. SKIPPED (no --patch) ==="
  say_d "-> App code stays as in AnabelMaz/prawko."
fi

say_c "=== 6. NPM INSTALL AND LAUNCHD REGISTRATION ==="
cd "$TARGET_DIR"
[ -f "$TARGET_DIR/package.json" ] || die "Missing package.json in $TARGET_DIR — GitHub ZIP download failed."
npm_exe="$(resolve_npm)" || die "Missing npm (Node.js). The installer should have added Node."
say_y "Installing 'serve'..."
"$npm_exe" install --omit=dev --no-fund --no-audit
"$npm_exe" install serve --no-fund --no-audit
serve_entry="$(resolve_serve_entry "$TARGET_DIR")" || die "Could not find the 'serve' package in node_modules."
node_exe="$(resolve_node)" || die "Missing node"
[ -f "$TARGET_DIR/src/index.html" ] || die "Missing src/index.html."

# User can later --patch without sudo (like icacls Everyone on Windows).
if [ -n "${SUDO_USER:-}" ]; then
  chown -R "$SUDO_USER":admin "$TARGET_DIR" 2>/dev/null || chown -R "$SUDO_USER" "$TARGET_DIR"
  chmod -R u+rwX,go+rX "$TARGET_DIR"
fi

say_y "Registering launchd $LAUNCH_LABEL..."
install_launchd "$node_exe" "$serve_entry"
sleep 3

if curl -fsS "http://127.0.0.1:${LISTEN_PORT}/" >/dev/null 2>&1; then
  say_g "=================================================="
  say_g " SERVICE STARTED SUCCESSFULLY! "
  say_y " App: http://localhost:${LISTEN_PORT} "
  if [ "$MERGE_GOV" -eq 1 ]; then
    say_y " Questions:   AnabelMaz/prawko + gaps from ministry Excel (merge) "
  else
    say_y " Questions:   bank from AnabelMaz/prawko (src/data) "
    say_y " Media:     CDN prawko-maz (Backblaze) "
  fi
  say_g "=================================================="
else
  say_r "[ERROR] Service is not responding at http://localhost:${LISTEN_PORT}"
  [ -f "$TARGET_DIR/service_error.log" ] && tail -n 20 "$TARGET_DIR/service_error.log"
  exit 1
fi

pause_if_interactive
