#!/usr/bin/env python3
"""Upload src/media to a public Backblaze B2 bucket (macOS/Linux).

Same job as scripts/upload-media.ps1. Keys from .b2env at the repo root.

  python3 scripts/upload-media.py
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
    home = Path.home()
    for ver in ("3.14", "3.13", "3.12", "3.11"):
        cand = home / "Library" / "Python" / ver / "bin" / "b2"
        if cand.is_file():
            return str(cand)
        cand = home / ".local" / "bin" / "b2"
        if cand.is_file():
            return str(cand)
    die("b2 CLI not found. Install with: python3 -m pip install --user b2")
    raise AssertionError


def main() -> None:
    root = repo_root()
    read_dotenv(root / ".b2env")
    key_id = os.environ.get("B2_APPLICATION_KEY_ID") or os.environ.get("B2_KEY_ID")
    app_key = os.environ.get("B2_APPLICATION_KEY") or os.environ.get("B2_APP_KEY")
    bucket = os.environ.get("B2_BUCKET")
    img = root / "src" / "media" / "img"
    vid = root / "src" / "media" / "vid"
    if not img.is_dir() or not vid.is_dir():
        die(f"Missing {img} or {vid}. Convert a local pack from gov.pl first.")
    if not key_id or not app_key or not bucket:
        die(
            "Missing B2 credentials. Create .b2env (template: scripts/b2env.example) or set "
            "B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET."
        )
    b2 = find_b2()
    print("Signing in to B2...")
    rc = subprocess.call([b2, "account", "authorize", key_id, app_key])
    if rc != 0:
        rc = subprocess.call([b2, "authorize-account", key_id, app_key])
    if rc != 0:
        die("b2 authorize failed.")
    print(f"Uploading images -> b2://{bucket}/img/ ...")
    rc = subprocess.call([b2, "sync", "--allowEmptySource", "--skipNewer", str(img), f"b2://{bucket}/img/"])
    if rc != 0:
        die(f"b2 sync img failed ({rc})")
    print(f"Uploading videos -> b2://{bucket}/vid/ (~3 GB, may take a while)...")
    rc = subprocess.call([b2, "sync", "--allowEmptySource", "--skipNewer", str(vid), f"b2://{bucket}/vid/"])
    if rc != 0:
        die(f"b2 sync vid failed ({rc})")
    cors = Path(__file__).with_name("b2-cors.json")
    if cors.is_file():
        print("Setting CORS (videos from GitHub Pages and localhost)...")
        rules = cors.read_text(encoding="utf-8")
        rc = subprocess.call([b2, "bucket", "update", "--cors-rules", rules, bucket, "allPublic"])
        if rc != 0:
            subprocess.call([b2, "update-bucket", "--corsRules", rules, bucket, "allPublic"])
    print("")
    print("Done. Public media prefix (set as MEDIA_CDN in src/js/data.js):")
    print(f"  https://fXXX.backblazeb2.com/file/{bucket}")


if __name__ == "__main__":
    main()
