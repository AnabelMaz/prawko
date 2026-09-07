#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT/gov-data/raw"
OUT_DIR="$ROOT/src/media/img"

mkdir -p "$OUT_DIR"

TOTAL=$(find "$SRC_DIR" -maxdepth 1 -iname "*.jpg" | wc -l | tr -d ' ')
echo "Found $TOTAL JPG files to convert"

COUNTER=0
SKIPPED=0

convert_file() {
    local src="$1"
    local basename
    basename=$(basename "$src")
    # Replace .jpg or .JPG extension with .webp
    local outname="${basename%.[jJ][pP][gG]}.webp"
    local dest="$2/$outname"

    if [ -f "$dest" ]; then
        echo "SKIP: $outname (already exists)"
        return 0
    fi

    cwebp -q 80 "$src" -o "$dest" > /dev/null 2>&1
    echo "DONE: $outname"
}

export -f convert_file
export OUT_DIR

find "$SRC_DIR" -maxdepth 1 -iname "*.jpg" -print0 | \
    xargs -0 -P10 -I{} bash -c 'convert_file "$@"' _ {} "$OUT_DIR"

CONVERTED=$(find "$OUT_DIR" -name "*.webp" | wc -l | tr -d ' ')
echo ""
echo "Conversion complete: $CONVERTED WebP files in $OUT_DIR"
