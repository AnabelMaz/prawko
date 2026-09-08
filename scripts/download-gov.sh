#!/usr/bin/env bash
# Download ministry catalogue + media ZIPs from gov.pl (macOS/Linux, no new Python).
# Excel → gov-data/baza_pytan.xlsx
# Multimedia (JPG/WMV) → gov-data/raw
# PJM links are matched and skipped (~10 GB, unused in the app).
#
#   bash scripts/download-gov.sh
#   bash scripts/download-gov.sh --excel-only
# Helpers for installers / convert-media:
#   PRAWKO_GOV_LIBRARY_ONLY=1 . scripts/download-gov.sh
#
# Paths (override with env):
#   PRAWKO_GOV_DATA   staging dir (default: macOS Library/Application Support, Linux ~/.local/share)
#   PRAWKO_REPO_ROOT  checkout used only for overflow gov-data on another volume

set -euo pipefail

MAIN_URL="https://www.gov.pl/web/infrastruktura/prawo-jazdy"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
LEGACY_RAW_NAME="Pytania egzaminacyjne na prawo jazdy 2025"

EXCEL_ONLY=0
SKIP_MEDIA=0
if [ "${PRAWKO_GOV_LIBRARY_ONLY:-0}" != 1 ]; then
for arg in "$@"; do
  case "$arg" in
    --excel-only|-ExcelOnly) EXCEL_ONLY=1 ;;
    --skip-media|-SkipMedia) SKIP_MEDIA=1 ;;
    --help|-h|-Help)
      echo "download-gov.sh — Excel + situational media ZIP from gov.pl"
      echo "  --excel-only   Excel only (baza_pytan.xlsx)"
      echo "  --skip-media   Excel yes, ZIP no"
      exit 0
      ;;
    --library-only)
      # Installers set PRAWKO_GOV_LIBRARY_ONLY instead; keep the flag for CLI.
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done
fi

say() { printf '%s\n' "$*"; }
say_c() { printf '\033[36m%s\033[0m\n' "$*"; }
say_g() { printf '\033[32m%s\033[0m\n' "$*"; }
say_y() { printf '\033[33m%s\033[0m\n' "$*"; }
say_d() { printf '\033[90m%s\033[0m\n' "$*"; }

die() { echo "$*" >&2; exit 1; }

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

repo_root() {
  if [ -n "${PRAWKO_REPO_ROOT:-}" ]; then
    printf '%s\n' "$PRAWKO_REPO_ROOT"
    return
  fi
  local root
  root="$(cd "$script_dir/.." && pwd)"
  if [ -f "$root/src/index.html" ]; then
    printf '%s\n' "$root"
    return
  fi
  die "Repo directory not found (src/index.html) above $script_dir."
}

sha256_hex() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  else
    openssl dgst -sha256 | awk '{print $NF}'
  fi
}

local_app_gov_data() {
  local home="${PRAWKO_USER_HOME:-$HOME}"
  case "$(uname -s)" in
    Darwin) printf '%s\n' "$home/Library/Application Support/prawko/gov-data" ;;
    *) printf '%s\n' "${XDG_DATA_HOME:-$home/.local/share}/prawko/gov-data" ;;
  esac
}

gov_data_dir() {
  if [ -n "${PRAWKO_GOV_DATA:-}" ]; then
    printf '%s\n' "$PRAWKO_GOV_DATA"
    return
  fi
  local_app_gov_data
}

overflow_root() {
  local local_dir repo server a
  local_dir="$(local_app_gov_data)"
  repo="$(repo_root)"
  a="$(cd "$repo" 2>/dev/null && pwd)"
  for server in /opt/prawko /usr/local/prawko; do
    if [ "$a" = "$server" ]; then
      printf '%s\n' "$local_dir"
      return
    fi
  done
  printf '%s\n' "$repo/gov-data"
}

url_fingerprint() {
  printf '%s' "$1" | sha256_hex | awk '{print substr($1,1,16)}'
}

remote_prefix_hash() {
  # First 1 MB of the remote file (same idea as the Windows script).
  curl -fsSL -A "$UA" --range 0-1048575 --max-time 30 "$1" 2>/dev/null | sha256_hex | awk '{print toupper($1)}' | sed 's/\(..\)/\1-/g; s/-$//'
}

needs_download() {
  local url="$1" hash_file="$2" local_file="$3"
  local remote stored
  remote="$(remote_prefix_hash "$url" || true)"
  if [ -z "$remote" ]; then
    return 0
  fi
  if [ ! -e "$local_file" ] || [ ! -f "$hash_file" ]; then
    return 0
  fi
  stored="$(tr -d '[:space:]' < "$hash_file")"
  [ "$stored" != "$remote" ]
}

save_prefix_hash() {
  local hash_file="$1" url="$2" hash
  mkdir -p "$(dirname "$hash_file")"
  hash="$(remote_prefix_hash "$url" || true)"
  if [ -n "$hash" ]; then
    printf '%s\n' "$hash" > "$hash_file"
  fi
}

curl_download() {
  local url="$1" out="$2"
  mkdir -p "$(dirname "$out")"
  local expected=""
  expected="$(curl -sI -L -A "$UA" --max-time 20 "$url" 2>/dev/null | awk 'tolower($1)=="content-length:" {print $2}' | tr -d '\r' | tail -n 1)"
  if [ -n "$expected" ] && [ "$expected" -gt 0 ] 2>/dev/null; then
    say_d "-> Size: $(awk -v n="$expected" 'BEGIN { printf "%.1f MB", n/1048576 }')"
  fi
  if ! curl -L -C - --retry 5 -A "$UA" -e "$MAIN_URL" --output "$out" "$url"; then
    local rc=$?
    if [ "$rc" -eq 33 ]; then
      say_y "-> Server does not support resume; downloading from scratch..."
      rm -f "$out"
      curl -L --retry 5 -A "$UA" -e "$MAIN_URL" --output "$out" "$url" || die "Download failed: $url"
    else
      die "Download failed (curl $rc): $url"
    fi
  fi
}

flatten_media_dir() {
  local directory="$1" dir f dest
  [ -d "$directory" ] || return 0
  say_y "-> Flattening subfolders in $directory..."
  find "$directory" -mindepth 1 -type d -print0 2>/dev/null | while IFS= read -r -d '' dir; do
    :
  done
  find "$directory" -mindepth 2 -type f -print0 2>/dev/null | while IFS= read -r -d '' f; do
    dest="$directory/$(basename "$f")"
    if [ ! -e "$dest" ]; then
      mv "$f" "$dest"
    else
      rm -f "$f"
    fi
  done
  find "$directory" -mindepth 1 -type d -empty -delete 2>/dev/null || true
}

parse_gov_links() {
  local html node
  html="$(mktemp)"
  curl -fsSL -A "$UA" "$MAIN_URL" -o "$html" || { rm -f "$html"; die "Failed to download $MAIN_URL"; }
  node="$(command -v node || true)"
  if [ -z "$node" ]; then
    rm -f "$html"
    die "Node.js is required to parse gov.pl (brew install node)."
  fi
  "$node" - "$html" <<'NODE'
const fs = require("fs");
const html = fs.readFileSync(process.argv[2], "utf8");
const needles = [
  "Baza pytań",
  "KATALOG",
  "Multimedia do pytań",
  "tłumaczenia migowe",
  "tłumaczenie migowe",
  "migowe",
];
const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const seen = new Map();
let m;
while ((m = re.exec(html))) {
  let href = m[1];
  let text = m[2].replace(/<[^>]+>/g, "");
  text = text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  text = text.replace(/\s+/g, " ").trim();
  const hrefLooksPjm = /migowe/i.test(href);
  if (!text && !hrefLooksPjm) continue;
  let ok = hrefLooksPjm;
  if (!ok) ok = needles.some((n) => text.includes(n));
  if (!ok) continue;
  if (href.startsWith("//")) href = "https:" + href;
  else if (!/^https?:\/\//i.test(href)) href = "https://www.gov.pl" + href;
  if (!text) text = href;
  const prev = seen.get(href);
  if (!prev || text.length > prev.length) seen.set(href, text);
}
const rows = [...seen.entries()].map(([url, opis]) => ({ url, opis }));
rows.sort((a, b) => {
  const excel = (x) => /\.xlsx$/i.test(x.url) || /KATALOG|Baza pytań/i.test(x.opis);
  return (excel(a) ? 0 : 1) - (excel(b) ? 0 : 1);
});
if (!rows.length) {
  console.error("gov.pl page parser found no question-bank or multimedia links.");
  process.exit(1);
}
for (const row of rows) {
  process.stdout.write(row.opis.replace(/\t/g, " ") + "\t" + row.url + "\n");
}
NODE
  rm -f "$html"
}

is_excel() {
  local opis="$1" url="$2"
  case "$url" in *.xlsx|*.XLSX) return 0 ;; esac
  case "$opis" in *KATALOG*|*Baza\ pytań*) return 0 ;; esac
  return 1
}

is_pjm() {
  local opis="$1" url="$2"
  case "$opis" in *migow*) return 0 ;; esac
  case "$url" in *migowe*) return 0 ;; esac
  return 1
}

is_media() {
  local opis="$1" url="$2"
  case "$url" in *.zip|*.ZIP) return 0 ;; esac
  case "$opis" in *Multimedia*) return 0 ;; esac
  return 1
}

free_bytes() {
  local path="$1" dir
  dir="$(dirname "$path")"
  mkdir -p "$dir" 2>/dev/null || true
  df -k "$dir" 2>/dev/null | awk 'NR==2 {print $4 * 1024}'
}

same_volume() {
  local a b
  a="$(df "$1" 2>/dev/null | awk 'NR==2 {print $1}')"
  b="$(df "$2" 2>/dev/null | awk 'NR==2 {print $1}')"
  [ -n "$a" ] && [ "$a" = "$b" ]
}

resolve_staging() {
  local preferred="$1" overflow="$2" min_free="$3" what="$4"
  if [ -d "$preferred" ] && [ -n "$(find "$preferred" -maxdepth 1 -type f 2>/dev/null | head -n 1)" ]; then
    printf '%s\n' "$preferred"
    return
  fi
  local pref_free over_free
  pref_free="$(free_bytes "$preferred")"
  pref_free="${pref_free:-0}"
  if [ "$pref_free" -ge "$min_free" ]; then
    printf '%s\n' "$preferred"
    return
  fi
  mkdir -p "$(dirname "$overflow")" 2>/dev/null || true
  if same_volume "$(dirname "$preferred")" "$(dirname "$overflow")"; then
    printf '%s\n' "$preferred"
    return
  fi
  over_free="$(free_bytes "$overflow")"
  over_free="${over_free:-0}"
  if [ "$over_free" -ge "$min_free" ]; then
    say_y "-> Low disk space for $what ($preferred). Using $overflow"
    printf '%s\n' "$overflow"
    return
  fi
  printf '%s\n' "$preferred"
}

move_legacy_raw() {
  local repo legacy raw
  repo="$(repo_root)"
  legacy="$repo/$LEGACY_RAW_NAME"
  [ -d "$legacy" ] || return 0
  raw="$(gov_data_dir)/raw"
  mkdir -p "$raw"
  say_y "Merging legacy raw-media folder into gov-data/raw..."
  find "$legacy" -type f -exec sh -c 'dest="$1/$(basename "$2")"; [ -e "$dest" ] || mv "$2" "$dest"' _ "$raw" {} \;
  rm -rf "$legacy"
}

sync_excel() {
  local excel_path="$1" hash_file="$2" opis url found=0
  mkdir -p "$(dirname "$excel_path")"
  say_c "-> Parsing $MAIN_URL ..."
  while IFS="$(printf '\t')" read -r opis url; do
    [ -n "$url" ] || continue
    if is_excel "$opis" "$url"; then
      found=1
      if needs_download "$url" "$hash_file" "$excel_path"; then
        say_c "-> Downloading Excel from gov.pl to $excel_path..."
        curl_download "$url" "$excel_path"
        save_prefix_hash "$hash_file" "$url"
      else
        say_d "-> Excel unchanged. Parsing local file: $excel_path"
      fi
      break
    fi
  done < <(parse_gov_links)
  [ "$found" -eq 1 ] || die "gov.pl has no Excel link for the question bank."
}

if [ "${PRAWKO_GOV_LIBRARY_ONLY:-0}" = 1 ]; then
  # Sourced: return to caller. Executed as a file: return is invalid, so exit.
  return 0 2>/dev/null || exit 0
fi

GOV_DIR="$(gov_data_dir)"
EXCEL_PATH="$GOV_DIR/baza_pytan.xlsx"
EXCEL_HASH="$GOV_DIR/.baza_pytan.hash"
OVERFLOW="$(overflow_root)"
mkdir -p "$GOV_DIR"

if [ "$EXCEL_ONLY" -eq 1 ]; then
  say_c "download-gov: Excel only → $EXCEL_PATH"
  sync_excel "$EXCEL_PATH" "$EXCEL_HASH"
  [ -f "$EXCEL_PATH" ] || die "Missing $EXCEL_PATH — question bank from gov.pl was not downloaded."
  say_g "Done. Excel: $EXCEL_PATH"
  exit 0
fi

move_legacy_raw

RAW_PREFERRED="$GOV_DIR/raw"
RAW_DIR="$(resolve_staging "$RAW_PREFERRED" "$OVERFLOW/raw" $((8 * 1024 * 1024 * 1024)) "raw JPG/WMV")"
if [ "$RAW_DIR" != "$RAW_PREFERRED" ]; then
  mkdir -p "$RAW_DIR"
  ln -sfn "$RAW_DIR" "$RAW_PREFERRED"
fi

ZIP_PREFERRED="$GOV_DIR/cache"
ZIP_CACHE="$(resolve_staging "$ZIP_PREFERRED" "$OVERFLOW/cache" $((12 * 1024 * 1024 * 1024)) "ministry ZIPs")"
mkdir -p "$RAW_DIR" "$ZIP_CACHE"

say_c "download-gov: Excel + situational media ZIP from gov.pl → gov-data."
say_d "ZIP: $ZIP_CACHE"
say_d "Situational JPG/WMV: $RAW_DIR"

say_c "-> Parsing $MAIN_URL ..."
parse_gov_links | while IFS="$(printf '\t')" read -r opis url; do
  [ -n "$url" ] || continue
  say_g "DESC: $opis"
  say_d "LINK: $url"
  if is_excel "$opis" "$url"; then
    if needs_download "$url" "$EXCEL_HASH" "$EXCEL_PATH"; then
      say_c "-> Downloading Excel from gov.pl to $EXCEL_PATH..."
      curl_download "$url" "$EXCEL_PATH"
      save_prefix_hash "$EXCEL_HASH" "$url"
    else
      say_d "-> Excel unchanged: $EXCEL_PATH"
    fi
  elif is_pjm "$opis" "$url"; then
    say_d "-> Sign-language (PJM) pack found; not downloading."
  elif is_media "$opis" "$url"; then
    if [ "$SKIP_MEDIA" -eq 1 ]; then
      say_d "-> Skipping situational media (--skip-media)."
    else
      url_hash="$(url_fingerprint "$url")"
      marker="$RAW_DIR/.downloaded_$url_hash"
      hash_file="$GOV_DIR/.media_$url_hash.hash"
      zip_path="$ZIP_CACHE/media_$url_hash.zip"
      say_c "-> Hashing first 1 MB of the media pack..."
      if needs_download "$url" "$hash_file" "$marker"; then
        say_y "-> Downloading media pack from gov.pl (resumable if interrupted)..."
        curl_download "$url" "$zip_path"
        say_g "-> Unpacking to $RAW_DIR..."
        tar -xf "$zip_path" -C "$RAW_DIR" 2>/dev/null || unzip -qo "$zip_path" -d "$RAW_DIR"
        flatten_media_dir "$RAW_DIR"
        : > "$marker"
        save_prefix_hash "$hash_file" "$url"
        rm -f "$zip_path"
      else
        say_d "-> Media pack unchanged. Skipping download."
      fi
    fi
  else
    say_d "-> Skipping (not Excel or media)."
  fi
  say "--------------------------------------------------"
done

[ -f "$EXCEL_PATH" ] || die "Missing $EXCEL_PATH — question bank from gov.pl was not downloaded."
say_g "Done. Excel: $EXCEL_PATH"
say_d "Situational: $RAW_DIR"
