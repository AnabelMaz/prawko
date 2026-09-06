#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT/gov-data/raw"
OUT_DIR="$ROOT/src/media/vid"

mkdir -p "$OUT_DIR"

TOTAL=$(find "$SRC_DIR" -maxdepth 1 -name "*.wmv" | wc -l | tr -d ' ')
echo "Found $TOTAL WMV files to process."

COUNTER_FILE=$(mktemp)
echo 0 > "$COUNTER_FILE"
SKIP_FILE=$(mktemp)
echo 0 > "$SKIP_FILE"
trap 'rm -f "$COUNTER_FILE" "$SKIP_FILE"' EXIT

convert_one() {
    local src="$1"
    local basename
    basename="$(basename "$src" .wmv)"
    local dest="$OUT_DIR/${basename}.mp4"

    if [ -f "$dest" ]; then
        local skip
        skip=$(cat "$SKIP_FILE")
        echo $((skip + 1)) > "$SKIP_FILE"
        return 0
    fi

    ffmpeg -y -i "$src" \
        -c:v h264_videotoolbox -q:v 65 \
        -vf "scale='min(1024,iw)':'min(576,ih)'" \
        -movflags +faststart \
        -an \
        "$dest" </dev/null 2>/dev/null

    local count
    count=$(cat "$COUNTER_FILE")
    count=$((count + 1))
    echo "$count" > "$COUNTER_FILE"
    echo "[${count}/${TOTAL}] Converted: ${basename}.mp4"
}

export -f convert_one
export OUT_DIR TOTAL COUNTER_FILE SKIP_FILE

find "$SRC_DIR" -maxdepth 1 -name "*.wmv" -print0 \
    | xargs -0 -P8 -I{} bash -c 'convert_one "$@"' _ {}

CONVERTED=$(cat "$COUNTER_FILE")
SKIPPED=$(cat "$SKIP_FILE")
RESULT=$(ls "$OUT_DIR"/*.mp4 2>/dev/null | wc -l | tr -d ' ')

echo ""
echo "=== Done ==="
echo "Converted: $CONVERTED"
echo "Skipped (already existed): $SKIPPED"
echo "Total MP4 files in output: $RESULT"
