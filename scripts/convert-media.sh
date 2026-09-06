#!/usr/bin/env bash
# Convert ministry situational media: JPG→WebP, WMV→MP4 (macOS/Linux).
# Same job as scripts/convert-media.ps1 / convert-videos.sh + optimize-images.sh.
# Does not touch gov-data/pjm.
#
#   bash scripts/convert-media.sh
#   bash scripts/convert-media.sh --source DIR --img-out DIR --vid-out DIR

set -euo pipefail

say() { printf '%s\n' "$*"; }
say_c() { printf '\033[36m%s\033[0m\n' "$*"; }
say_g() { printf '\033[32m%s\033[0m\n' "$*"; }
say_y() { printf '\033[33m%s\033[0m\n' "$*"; }
say_d() { printf '\033[90m%s\033[0m\n' "$*"; }
die() { echo "$*" >&2; exit 1; }

script_dir="$(cd "$(dirname "$0")" && pwd)"
home="${PRAWKO_USER_HOME:-$HOME}"
case "$(uname -s)" in
  Darwin) user_prawko="$home/Library/Application Support/prawko" ;;
  *) user_prawko="${XDG_DATA_HOME:-$home/.local/share}/prawko" ;;
esac
gov_raw="${PRAWKO_GOV_DATA:-$user_prawko/gov-data}/raw"
server=""
for d in /opt/prawko /usr/local/prawko; do
  if [ -f "$d/src/index.html" ]; then
    server="$d"
    break
  fi
done
server="${server:-/usr/local/prawko}"

SOURCE_DIR=""
IMG_OUT=""
VID_OUT=""
FFMPEG_EXE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --source|--SourceDir|-SourceDir) SOURCE_DIR="$2"; shift 2 ;;
    --img-out|--ImgOut|-ImgOut) IMG_OUT="$2"; shift 2 ;;
    --vid-out|--VidOut|-VidOut) VID_OUT="$2"; shift 2 ;;
    --ffmpeg|--FfmpegExe|-FfmpegExe) FFMPEG_EXE="$2"; shift 2 ;;
    --help|-h|-Help)
      echo "convert-media.sh — JPG→WebP, WMV→MP4"
      echo "  --source DIR   surowe JPG/WMV (domyślnie gov-data/raw)"
      echo "  --img-out DIR  WebP"
      echo "  --vid-out DIR  MP4"
      echo "  --ffmpeg PATH  ffmpeg"
      exit 0
      ;;
    *) die "Nieznany argument: $1" ;;
  esac
done

if [ -z "$SOURCE_DIR" ]; then
  SOURCE_DIR="$gov_raw"
fi
if [ -z "$IMG_OUT" ]; then
  if [ -f "$server/src/index.html" ]; then
    IMG_OUT="$server/src/media/img"
  else
    IMG_OUT="$user_prawko/media/img"
  fi
fi
if [ -z "$VID_OUT" ]; then
  if [ -f "$server/src/index.html" ]; then
    VID_OUT="$server/src/media/vid"
  else
    VID_OUT="$user_prawko/media/vid"
  fi
fi

resolve_ffmpeg() {
  if [ -n "$FFMPEG_EXE" ]; then
    [ -x "$FFMPEG_EXE" ] || die "Brak ffmpeg: $FFMPEG_EXE"
    printf '%s\n' "$FFMPEG_EXE"
    return
  fi
  if command -v ffmpeg >/dev/null 2>&1; then
    command -v ffmpeg
    return
  fi
  local bundled
  bundled="$(find /opt/prawko/tools /usr/local/prawko/tools -name ffmpeg -type f 2>/dev/null | head -n 1)"
  if [ -n "$bundled" ]; then
    printf '%s\n' "$bundled"
    return
  fi
  return 1
}

[ -d "$SOURCE_DIR" ] || die "Brak katalogu źródłowego: $SOURCE_DIR (najpierw scripts/download-gov.sh)."

ffmpeg="$(resolve_ffmpeg)" || die "FFmpeg nie jest dostępny. Zainstaluj ffmpeg (brew / apt / dnf) albo odpal instalator z --install-gov."
say_g "[OK] FFmpeg: $ffmpeg"
say_d "Źródło (sytuacyjne): $SOURCE_DIR"
say_d "Wyjście: $IMG_OUT  /  $VID_OUT"
say_d "gov-data/pjm nie jest konwertowane."

mkdir -p "$IMG_OUT" "$VID_OUT"

cwebp_bin="$(command -v cwebp || true)"
videotoolbox=0
if "$ffmpeg" -hide_banner -encoders 2>/dev/null | grep -q h264_videotoolbox; then
  videotoolbox=1
fi

is_pjm_name() {
  local base
  base="$(basename "$1")"
  case "$base" in [Pp][Jj][Mm]*) return 0 ;; esac
  return 1
}

count=0
for img in "$SOURCE_DIR"/*.jpg "$SOURCE_DIR"/*.JPG "$SOURCE_DIR"/*.jpeg "$SOURCE_DIR"/*.JPEG; do
  [ -f "$img" ] || continue
  count=$((count + 1))
done
say_c "-> Konwersja obrazów JPG → WebP ($count plików)..."
i=0
for img in "$SOURCE_DIR"/*.jpg "$SOURCE_DIR"/*.JPG "$SOURCE_DIR"/*.jpeg "$SOURCE_DIR"/*.JPEG; do
  [ -f "$img" ] || continue
  i=$((i + 1))
  base="$(basename "$img")"
  stem="${base%.*}"
  dest="$IMG_OUT/$stem.webp"
  if [ -s "$dest" ]; then
    continue
  fi
  if [ -n "$cwebp_bin" ]; then
    "$cwebp_bin" -q 80 "$img" -o "$dest" >/dev/null 2>&1 || "$ffmpeg" -y -hide_banner -loglevel error -i "$img" -c:v libwebp -quality 80 "$dest"
  else
    "$ffmpeg" -y -hide_banner -loglevel error -i "$img" -c:v libwebp -quality 80 "$dest"
  fi
  if [ $((i % 50)) -eq 0 ]; then
    say_d "   obrazy $i / $count"
  fi
done

count=0
for vid in "$SOURCE_DIR"/*.wmv "$SOURCE_DIR"/*.WMV; do
  [ -f "$vid" ] || continue
  is_pjm_name "$vid" && continue
  count=$((count + 1))
done
say_c "-> Konwersja filmów WMV → MP4 ($count plików, to może potrwać)..."
i=0
for vid in "$SOURCE_DIR"/*.wmv "$SOURCE_DIR"/*.WMV; do
  [ -f "$vid" ] || continue
  is_pjm_name "$vid" && continue
  i=$((i + 1))
  base="$(basename "$vid")"
  stem="${base%.*}"
  dest="$VID_OUT/$stem.mp4"
  if [ -s "$dest" ]; then
    continue
  fi
  if [ "$videotoolbox" -eq 1 ]; then
    if ! "$ffmpeg" -y -hide_banner -loglevel error -i "$vid" \
      -c:v h264_videotoolbox -q:v 65 \
      -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
      -movflags +faststart -an "$dest" </dev/null; then
      say_y "   pominięto (błąd ffmpeg): $(basename "$vid")"
    fi
  else
    if ! "$ffmpeg" -y -hide_banner -loglevel error -i "$vid" \
      -c:v libx264 -preset veryfast -crf 23 \
      -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
      -movflags +faststart -an "$dest" </dev/null; then
      say_y "   pominięto (błąd ffmpeg): $(basename "$vid")"
    fi
  fi
  if [ $((i % 10)) -eq 0 ]; then
    say_d "   filmy $i / $count"
  fi
done

for ready in "$SOURCE_DIR"/*.webp "$SOURCE_DIR"/*.WEBP; do
  [ -f "$ready" ] || continue
  dest="$IMG_OUT/$(basename "$ready")"
  [ -e "$dest" ] || cp "$ready" "$dest"
done
for ready in "$SOURCE_DIR"/*.mp4 "$SOURCE_DIR"/*.MP4; do
  [ -f "$ready" ] || continue
  dest="$VID_OUT/$(basename "$ready")"
  [ -e "$dest" ] || cp "$ready" "$dest"
done

webp_n="$(find "$IMG_OUT" -maxdepth 1 -name '*.webp' -o -name '*.WEBP' | wc -l | tr -d ' ')"
mp4_n="$(find "$VID_OUT" -maxdepth 1 -name '*.mp4' -o -name '*.MP4' | wc -l | tr -d ' ')"
say_g "-> Gotowe multimedia dla aplikacji: $webp_n WebP, $mp4_n MP4"
