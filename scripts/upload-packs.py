#!/usr/bin/env python3
"""Upload zip packs + manifest to B2 as an archive copy (macOS/Linux).

Same job as scripts/upload-packs.ps1. Public offline host is Cloudflare R2,
not this B2 prefix.

  python3 scripts/upload-packs.py
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(1)


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def default_packs_dir() -> Path:
    home = Path(os.environ.get("PRAWKO_USER_HOME") or os.path.expanduser("~"))
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "prawko" / "packs"
    xdg = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg) if xdg else home / ".local" / "share"
    return base / "prawko" / "packs"


def read_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip("'").strip('"'))


def find_b2() -> str:
    which = shutil.which("b2")
    if which:
        return which
    local = Path.home() / ".local" / "bin" / "b2"
    if local.is_file():
        return str(local)
    die("b2 command not found. python3 -m pip install --user b2")
    raise AssertionError


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--packs-dir")
    args = ap.parse_args()
    packs = Path(args.packs_dir) if args.packs_dir else default_packs_dir()
    read_dotenv(repo_root() / ".b2env")
    key_id = os.environ.get("B2_APPLICATION_KEY_ID") or os.environ.get("B2_KEY_ID")
    app_key = os.environ.get("B2_APPLICATION_KEY") or os.environ.get("B2_APP_KEY")
    bucket = os.environ.get("B2_BUCKET")
    manifest = packs / "manifest.json"
    if not manifest.is_file():
        die(f"Missing {manifest}. Run scripts/build-media-packs.py first.")
    zips = list(packs.glob("*.zip"))
    if not zips:
        die(f"No .zip files in {packs} (run build-media-packs without --no-zip).")
    if not key_id or not app_key or not bucket:
        die("Missing B2 credentials (.b2env or B2_APPLICATION_KEY_ID / KEY / BUCKET).")
    b2 = find_b2()
    print("Signing in to B2...")
    rc = subprocess.call([b2, "account", "authorize", key_id, app_key])
    if rc != 0:
        rc = subprocess.call([b2, "authorize-account", key_id, app_key])
    if rc != 0:
        die("b2 authorize failed.")
    print(f"Uploading packs -> b2://{bucket}/packs/  ({len(zips)} zip + manifest)...")
    rc = subprocess.call([b2, "sync", "--allowEmptySource", "--skipNewer", str(packs), f"b2://{bucket}/packs/"])
    if rc != 0:
        die(f"b2 sync packs failed ({rc})")
    print("")
    print("Done. Pack prefix (offline zip, not individual videos):")
    print(f"  https://fXXX.backblazeb2.com/file/{bucket}/packs/manifest.json")
    print("Online play still uses .../img/ and .../vid/ (upload-media.py).")


if __name__ == "__main__":
    main()
