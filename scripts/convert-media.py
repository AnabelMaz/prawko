#!/usr/bin/env python3
"""Convert ministry situational media: JPG→WebP, WMV→MP4 (macOS/Linux).

Same job as scripts/convert-media.ps1. Does not touch gov-data/pjm.

  python3 scripts/convert-media.py
  python3 scripts/convert-media.py --source DIR --img-out DIR --vid-out DIR --ffmpeg PATH
"""

from __future__ import annotations

import argparse
import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path


def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(1)


def load_download_gov():
    path = Path(__file__).with_name("download-gov.py")
    spec = importlib.util.spec_from_file_location("download_gov", path)
    if spec is None or spec.loader is None:
        die(f"Cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def say(msg: str, color: str | None = None) -> None:
    if color:
        codes = {"c": "36", "g": "32", "y": "33", "d": "90"}
        print(f"\033[{codes[color]}m{msg}\033[0m", flush=True)
    else:
        print(msg, flush=True)


def find_server() -> Path:
    for d in (Path("/opt/prawko"), Path("/usr/local/prawko")):
        if (d / "src" / "index.html").is_file():
            return d
    return Path("/usr/local/prawko")


def resolve_ffmpeg(explicit: str) -> str:
    if explicit:
        p = Path(explicit)
        if not p.is_file():
            die(f"ffmpeg not found: {explicit}")
        return str(p)
    which = shutil.which("ffmpeg")
    if which:
        return which
    for root in (Path("/opt/prawko/tools"), Path("/usr/local/prawko/tools")):
        if not root.is_dir():
            continue
        hits = list(root.rglob("ffmpeg"))
        files = [h for h in hits if h.is_file()]
        if files:
            return str(files[0])
    die("FFmpeg is not available. Install ffmpeg (brew / apt / dnf) or run the installer with --install-gov.")
    raise AssertionError


def is_pjm_name(path: Path) -> bool:
    return path.name.lower().startswith("pjm")


def run_ffmpeg(args: list[str]) -> int:
    return subprocess.call(args, stdin=subprocess.DEVNULL)


def main() -> None:
    dg = load_download_gov()
    gov_raw = dg.gov_data_dir() / "raw"
    server = find_server()
    media_fallback = dg.gov_data_dir().parent / "media"

    ap = argparse.ArgumentParser(description="JPG to WebP, WMV to MP4")
    ap.add_argument("--source", dest="source")
    ap.add_argument("--img-out", dest="img_out")
    ap.add_argument("--vid-out", dest="vid_out")
    ap.add_argument("--ffmpeg", dest="ffmpeg")
    args = ap.parse_args()

    source = Path(args.source) if args.source else gov_raw
    if args.img_out:
        img_out = Path(args.img_out)
    elif (server / "src" / "index.html").is_file():
        img_out = server / "src" / "media" / "img"
    else:
        img_out = media_fallback / "img"
    if args.vid_out:
        vid_out = Path(args.vid_out)
    elif (server / "src" / "index.html").is_file():
        vid_out = server / "src" / "media" / "vid"
    else:
        vid_out = media_fallback / "vid"

    if not source.is_dir():
        die(f"Source directory not found: {source} (run scripts/download-gov.py first).")

    ffmpeg = resolve_ffmpeg(args.ffmpeg or "")
    say(f"[OK] FFmpeg: {ffmpeg}", "g")
    say(f"Source (situational): {source}", "d")
    say(f"Output: {img_out}  /  {vid_out}", "d")
    say("gov-data/pjm is not converted.", "d")
    img_out.mkdir(parents=True, exist_ok=True)
    vid_out.mkdir(parents=True, exist_ok=True)

    cwebp = shutil.which("cwebp")
    enc = subprocess.run(
        [ffmpeg, "-hide_banner", "-encoders"],
        capture_output=True,
        text=True,
        errors="replace",
        check=False,
    )
    videotoolbox = "h264_videotoolbox" in ((enc.stdout or "") + (enc.stderr or ""))

    images = sorted(
        p for p in source.iterdir() if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg"}
    )
    say(f"-> Converting images JPG → WebP ({len(images)} files)...", "c")
    for i, img in enumerate(images, 1):
        dest = img_out / (img.stem + ".webp")
        if dest.is_file() and dest.stat().st_size > 0:
            continue
        if cwebp:
            rc = subprocess.call([cwebp, "-q", "80", str(img), "-o", str(dest)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if rc != 0:
                run_ffmpeg([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(img), "-c:v", "libwebp", "-quality", "80", str(dest)])
        else:
            run_ffmpeg([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(img), "-c:v", "libwebp", "-quality", "80", str(dest)])
        if i % 50 == 0:
            say(f"   images {i} / {len(images)}", "d")

    videos = sorted(
        p for p in source.iterdir() if p.is_file() and p.suffix.lower() == ".wmv" and not is_pjm_name(p)
    )
    say(f"-> Converting videos WMV → MP4 ({len(videos)} files, this may take a while)...", "c")
    for i, vid in enumerate(videos, 1):
        dest = vid_out / (vid.stem + ".mp4")
        if dest.is_file() and dest.stat().st_size > 0:
            continue
        if videotoolbox:
            cmd = [
                ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(vid),
                "-c:v", "h264_videotoolbox", "-q:v", "65",
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-movflags", "+faststart", "-an", str(dest),
            ]
        else:
            cmd = [
                ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(vid),
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-movflags", "+faststart", "-an", str(dest),
            ]
        if run_ffmpeg(cmd) != 0:
            say(f"   skipped (ffmpeg error): {vid.name}", "y")
        if i % 10 == 0:
            say(f"   videos {i} / {len(videos)}", "d")

    for ready in source.iterdir():
        if not ready.is_file():
            continue
        ext = ready.suffix.lower()
        if ext == ".webp":
            dest = img_out / ready.name
            if not dest.exists():
                shutil.copy2(ready, dest)
        elif ext == ".mp4":
            dest = vid_out / ready.name
            if not dest.exists():
                shutil.copy2(ready, dest)

    webp_n = len([p for p in img_out.iterdir() if p.is_file() and p.suffix.lower() == ".webp"])
    mp4_n = len([p for p in vid_out.iterdir() if p.is_file() and p.suffix.lower() == ".mp4"])
    say(f"-> App media ready: {webp_n} WebP, {mp4_n} MP4", "g")


if __name__ == "__main__":
    main()
