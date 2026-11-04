#!/usr/bin/env python3
"""Convert ministry situational media: JPG→WebP, WMV→MP4 (macOS/Linux).

Same job as scripts/convert-media.ps1. Unpacks gov-cache ZIPs into TEMP, converts, then deletes the unpack tree. Does not convert PJM.

After MP4s exist, measures a black run glued to the start or the end by reading only the first and last 1.5s. Results go into questions.json as mediaIn/mediaOut (no src/data/media-trim.json). Skip-cache: gov-cache/media-trim-cache.json. Playback ignores a file with no in/out. An existing WebP/MP4 is not encoded again.

  python3 scripts/convert-media.py
  python3 scripts/convert-media.py --source DIR --img-out DIR --vid-out DIR --ffmpeg PATH
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
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
    die("FFmpeg is not available. Install ffmpeg (brew / apt / dnf) or run the installer with --sync-gov.")
    raise AssertionError


def is_pjm_name(path: Path) -> bool:
    return path.name.lower().startswith("pjm")


def run_ffmpeg(args: list[str]) -> int:
    return subprocess.call(args, stdin=subprocess.DEVNULL)


def _frame_duration(rate: str) -> float:
    text = (rate or "").strip()
    if "/" in text:
        num, den = text.split("/", 1)
        try:
            fps = float(num) / float(den)
        except (ValueError, ZeroDivisionError):
            fps = 0
    else:
        try:
            fps = float(text)
        except ValueError:
            fps = 0
    if fps <= 1:
        return 0.04
    return min(0.2, max(0.01, 1.0 / fps))


def _probe_clip(ffprobe: str, path: Path):
    proc = subprocess.run(
        [
            ffprobe, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=avg_frame_rate,duration",
            "-of", "csv=p=0", str(path),
        ],
        capture_output=True, text=True, errors="replace", check=False,
    )
    line = ((proc.stdout or "").strip().splitlines() or [""])[0]
    parts = [p.strip() for p in line.split(",")]
    duration = 0.0
    rate = ""
    if len(parts) >= 2:
        rate = parts[0]
        try:
            duration = float(parts[1])
        except ValueError:
            duration = 0.0
    if duration <= 0:
        proc = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, errors="replace", check=False,
        )
        try:
            duration = float((proc.stdout or "").strip().splitlines()[0])
        except (ValueError, IndexError):
            return None
    if duration <= 0:
        return None
    if duration <= 0.2:
        return duration, 0.04, True
    return duration, _frame_duration(rate), False


def _run_ffmpeg(ffmpeg: str, args: list[str], timeout: float = 20) -> str | None:
    proc = subprocess.Popen(
        [ffmpeg, *args],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        _, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        return None
    return (err or b"").decode("utf-8", "replace")


def _black_span(ffmpeg: str, path: Path, seek: float, seconds: float) -> list[float] | None:
    # -ss/-t before -i read only that span, not the whole file.
    # Reported times are relative to the seek, so add it back.
    args = ["-hide_banner"]
    if seek > 0:
        args += ["-ss", f"{seek:.3f}"]
    args += [
        "-t", f"{seconds:.3f}", "-i", str(path),
        "-vf", "blackframe=amount=90:threshold=32",
        "-an", "-f", "null", "-",
    ]
    err = _run_ffmpeg(ffmpeg, args)
    if err is None:
        return None
    return [float(m.group(1)) + seek for m in re.finditer(r"\bt:([0-9.]+)", err)]


def _edge_black_times(ffmpeg: str, path: Path, duration: float) -> list[float] | None:
    head = _black_span(ffmpeg, path, 0, 1.5)
    if head is None:
        return None
    seek = max(0.0, duration - 1.5)
    if seek < 0.2:
        return head
    tail = _black_span(ffmpeg, path, seek, 1.5)
    if tail is None:
        return None
    return head + tail


def _trim_edges(times: list[float], duration: float, frame_dur: float) -> tuple[float | None, float | None]:
    """Black run glued to an edge, at most 1.5s. Returns start and end inside the picture."""
    max_run = 1.5
    ordered = sorted(t for t in times if t >= 0)
    inn = None
    out = None
    if ordered and ordered[0] <= frame_dur * 0.75:
        run = [ordered[0]]
        for t in ordered[1:]:
            if t - run[-1] <= frame_dur * 1.6 and t <= max_run + frame_dur:
                run.append(t)
            else:
                break
        start = run[-1] + frame_dur
        if (run[-1] - run[0]) <= max_run and 0.04 < start < duration - 0.2:
            inn = round(start, 3)
    if ordered and ordered[-1] >= duration - frame_dur * 1.25:
        run = [ordered[-1]]
        for t in reversed(ordered[:-1]):
            if run[0] - t <= frame_dur * 1.6 and duration - t <= max_run + frame_dur:
                run.insert(0, t)
            else:
                break
        end = run[0] - frame_dur
        if (run[-1] - run[0]) <= max_run and end > 0.2 and duration - end > 0.04:
            out = round(end, 3)
    if inn is not None and out is not None and out - inn < 0.4:
        return None, None
    return inn, out


def _save_trim(dest: Path, files: dict) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    ordered = {name: files[name] for name in sorted(files)}
    payload = json.dumps({"version": 1, "files": ordered}, ensure_ascii=False, indent=2) + "\n"
    tmp = dest.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(dest)


def _load_trim_index(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    files = doc.get("files") if isinstance(doc, dict) else None
    return files if isinstance(files, dict) else {}


def _patch_questions_media_trim(questions_path: Path, trim_by_media: dict) -> None:
    if not questions_path.is_file():
        say(f"-> No questions.json at {questions_path} — skip mediaIn/mediaOut patch (run parse-excel first).", "y")
        return
    try:
        doc = json.loads(questions_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        say(f"-> Could not read {questions_path} — skip trim patch.", "y")
        return
    if not isinstance(doc, dict):
        say(f"-> Unexpected questions.json shape — skip trim patch.", "y")
        return
    changed = 0
    for fact in doc.values():
        if not isinstance(fact, dict):
            continue
        media = fact.get("media")
        if not media or media not in trim_by_media:
            continue
        row = trim_by_media[media]
        if not isinstance(row, dict):
            continue
        inn = row.get("in")
        out = row.get("out")
        new_in = round(float(inn), 3) if isinstance(inn, (int, float)) and not isinstance(inn, bool) and float(inn) > 0.04 else None
        new_out = round(float(out), 3) if isinstance(out, (int, float)) and not isinstance(out, bool) and float(out) > 0.04 else None
        if new_in is not None:
            if fact.get("mediaIn") != new_in:
                fact["mediaIn"] = new_in
                changed += 1
        elif "mediaIn" in fact:
            del fact["mediaIn"]
            changed += 1
        if new_out is not None:
            if fact.get("mediaOut") != new_out:
                fact["mediaOut"] = new_out
                changed += 1
        elif "mediaOut" in fact:
            del fact["mediaOut"]
            changed += 1
    questions_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    say(f"-> Patched mediaIn/mediaOut in {questions_path} ({changed} field updates)", "g")


def _write_black_edge_trim(vid_out: Path, ffmpeg: str, repo_root: Path, server: Path, dg) -> None:
    ffprobe = str(Path(ffmpeg).with_name("ffprobe"))
    if not Path(ffprobe).is_file():
        found = shutil.which("ffprobe")
        if not found:
            say("ffprobe missing; black-edge trim skipped.", "y")
            return
        ffprobe = found
    cache_dest = Path(dg.gov_data_dir()) / "media-trim-cache.json"
    previous = _load_trim_index(cache_dest)
    videos = sorted(
        p for p in vid_out.iterdir()
        if p.is_file() and p.suffix.lower() == ".mp4" and not is_pjm_name(p)
    )
    files: dict = {}
    measured = 0
    trimmed = 0
    timed_out = 0
    say(f"-> Black edges on MP4 ({len(videos)} files, first and last 1.5s)...", "c")
    for i, vid in enumerate(videos, 1):
        stat = vid.stat()
        mtime_s = int(stat.st_mtime)
        prev = previous.get(vid.name) if isinstance(previous.get(vid.name), dict) else None
        if prev and int(prev.get("bytes") or -1) == stat.st_size and int(prev.get("mtimeS") or -1) == mtime_s:
            files[vid.name] = prev
            if prev.get("in") or prev.get("out"):
                trimmed += 1
            say(f"   edges {i} / {len(videos)} {vid.name} cached", "d")
            continue
        say(f"   edges {i} / {len(videos)} {vid.name}", "d")
        probed = _probe_clip(ffprobe, vid)
        entry = {"bytes": stat.st_size, "mtimeS": mtime_s}
        if probed is None:
            say(f"   probe failed: {vid.name}", "y")
            continue
        duration, frame_dur, short = probed
        if not short:
            try:
                found = _edge_black_times(ffmpeg, vid, duration)
            except (OSError, ValueError):
                found = None
            if found is None:
                timed_out += 1
                say(f"   timeout: {vid.name}", "y")
                continue
            inn, out = _trim_edges(found, duration, frame_dur)
            if inn is not None:
                entry["in"] = inn
            if out is not None:
                entry["out"] = out
            measured += 1
        if entry.get("in") or entry.get("out"):
            trimmed += 1
            bits = []
            if entry.get("in"):
                bits.append(f"in={entry['in']}")
            if entry.get("out"):
                bits.append(f"out={entry['out']}")
            say(f"   trim {vid.name} {' '.join(bits)}", "g")
        files[vid.name] = entry
        if measured % 20 == 0:
            _save_trim(cache_dest, files)
    _save_trim(cache_dest, files)
    say(
        f"-> Black-edge trim: measured {measured}, with a cut {trimmed}, timeouts {timed_out}; cache {cache_dest}",
        "g",
    )
    for q_path in dict.fromkeys([
        server / "src" / "data" / "questions.json",
        repo_root / "src" / "data" / "questions.json",
    ]):
        _patch_questions_media_trim(q_path, files)
    legacy = repo_root / "src" / "data" / "media-trim.json"
    if legacy.is_file():
        legacy.unlink(missing_ok=True)
        say(f"-> Removed leftover {legacy}", "d")


def main() -> None:
    dg = load_download_gov()
    server = find_server()
    clean_raw = False

    ap = argparse.ArgumentParser(description="JPG to WebP, WMV to MP4")
    ap.add_argument("--source", dest="source")
    ap.add_argument("--img-out", dest="img_out")
    ap.add_argument("--vid-out", dest="vid_out")
    ap.add_argument("--ffmpeg", dest="ffmpeg")
    ap.add_argument(
        "--keep-raw",
        action="store_true",
        help="Leave TEMP unpack in place (DropMissingMedia / parse). Default deletes it.",
    )
    args = ap.parse_args()

    if args.source:
        source = Path(args.source)
    else:
        source = dg.expand_gov_media_zips_to_temp()
        clean_raw = not args.keep_raw
    if args.img_out:
        img_out = Path(args.img_out)
    elif (server / "src" / "index.html").is_file():
        img_out = server / "src" / "media" / "img"
    else:
        die(f"Install the server first. Converted media go to {server}/src/media.")
    if args.vid_out:
        vid_out = Path(args.vid_out)
    elif (server / "src" / "index.html").is_file():
        vid_out = server / "src" / "media" / "vid"
    else:
        die(f"Install the server first. Converted media go to {server}/src/media.")

    if not source.is_dir():
        if clean_raw:
            dg.remove_gov_raw_temp()
        die(f"Source directory not found: {source} (run scripts/download-gov.py first).")

    try:
        ffmpeg = resolve_ffmpeg(args.ffmpeg or "")
        say(f"[OK] FFmpeg: {ffmpeg}", "g")
        say(f"Source (situational): {source}", "d")
        say(f"Output: {img_out}  /  {vid_out}", "d")
        say("Temp unpack is deleted after convert. PJM is not converted.", "d")
        _convert_media(source, img_out, vid_out, ffmpeg, Path(__file__).resolve().parents[1], server, dg)
    finally:
        if clean_raw:
            dg.remove_gov_raw_temp()


def _convert_media(source: Path, img_out: Path, vid_out: Path, ffmpeg: str, repo_root: Path, server: Path, dg) -> None:
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
    _write_black_edge_trim(vid_out, ffmpeg, repo_root, server, dg)


if __name__ == "__main__":
    main()
