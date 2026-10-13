#!/usr/bin/env python3
"""Merge ministry Excel JSON into an existing src/data bank.

Same rules as scripts/merge-gov.ps1:
match on question text; skip when media filename matches or (optional)
ffmpeg frames are ≥95% similar. New rows get id suffix -mi when taken.

  python3 scripts/merge-gov.py --gov-dir DIR --out-dir DIR [--ffmpeg PATH] [--media-dir DIR]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

CATEGORIES = ["A", "A1", "A2", "AM", "B", "B1", "C", "C1", "D", "D1", "PT", "T"]
SIZE = 96
THRESHOLD = 0.95
EXAM = {
    "totalQuestions": 32,
    "basicQuestions": 20,
    "specialistQuestions": 12,
    "maxPoints": 74,
    "passThreshold": 68,
    "totalTimeSeconds": 1500,
    "basicTimeSeconds": 20,
    "specialistTimeSeconds": 50,
    "basicPoints": [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1],
    "specialistPoints": [3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1],
}


def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(1)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def field(question: dict, name: str) -> str:
    value = question.get(name)
    return "" if value is None else str(value)


def load_category_questions(path: Path) -> list[dict]:
    data = read_json(path)
    ids = data.get("questionIds")
    if not isinstance(ids, list):
        die(f"{path} has no questionIds")
    root = path.parent
    facts = read_json(root / "questions.json") if (root / "questions.json").is_file() else {}
    polish = read_json(root / "translations_pl.json") if (root / "translations_pl.json").is_file() else {}
    if not isinstance(facts, dict):
        facts = {}
    if not isinstance(polish, dict):
        polish = {}
    loaded = []
    for qid in ids:
        key = str(qid)
        fact = facts.get(key) if isinstance(facts.get(key), dict) else {}
        text = polish.get(key) if isinstance(polish.get(key), dict) else {}
        item = {
            "id": qid,
            "q": text.get("q") or "",
            "type": fact.get("type"),
            "correct": fact.get("correct"),
            "points": fact.get("points"),
            "media": fact.get("media"),
            "mediaType": fact.get("mediaType"),
        }
        if text.get("a") or text.get("b") or text.get("c"):
            item["a"] = text.get("a") or ""
            item["b"] = text.get("b") or ""
            item["c"] = text.get("c") or ""
        loaded.append(item)
    return loaded


def stored_fact(question: dict) -> dict:
    fact = {
        "type": question.get("type"),
        "correct": question.get("correct"),
        "points": question.get("points"),
    }
    if question.get("media"):
        fact["media"] = question.get("media")
        fact["mediaType"] = question.get("mediaType")
    return fact


def stored_polish(question: dict) -> dict:
    text = {"q": field(question, "q"), "src": "excel"}
    if question.get("a") or question.get("b") or question.get("c"):
        text["a"] = field(question, "a")
        text["b"] = field(question, "b")
        text["c"] = field(question, "c")
    return text


def text_key(text) -> str:
    return re.sub(r"\s+", " ", str(text or "").strip()).lower()


def media_stem(media) -> str:
    name = Path(str(media or "").strip()).name
    return Path(name).stem.lower() if name else ""


def unique_id(desired, existing: set) -> str:
    base = str(desired or "").strip() or "mi"
    if base not in existing:
        return base
    n = 1
    while True:
        candidate = f"{base}-mi" if n == 1 else f"{base}-mi{n}"
        if candidate not in existing:
            return candidate
        n += 1


def is_video_path(p: str, question) -> bool:
    if re.search(r"\.(mp4|wmv|webm|mov)$", p, re.I):
        return True
    if re.search(r"\.(jpg|jpeg|webp|png)$", p, re.I):
        return False
    return str((question or {}).get("mediaType") or "").lower() == "video"


def index_media(dirs) -> dict:
    mapping = {}
    for d in dirs:
        if not d:
            continue
        folder = Path(d)
        if not folder.is_dir():
            continue
        for name in os.listdir(folder):
            full = folder / name
            if not full.is_file():
                continue
            stem = Path(name).stem.lower()
            mapping.setdefault(stem, str(full))
    return mapping


def resolve_media_path(index: dict, question) -> str:
    stem = media_stem((question or {}).get("media"))
    return index.get(stem, "") if stem else ""


def duration_seconds(ffprobe: str, file: str) -> float:
    r = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode != 0:
        return 0.0
    try:
        return float((r.stdout or "").strip())
    except ValueError:
        return 0.0


def extract_frame(ffmpeg: str, file: str, start_at: float):
    r = subprocess.run(
        [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-ss", str(start_at), "-i", file, "-frames:v", "1",
            "-vf", f"scale={SIZE}:{SIZE}", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
        ],
        capture_output=True,
        check=False,
    )
    if r.returncode != 0 or not r.stdout:
        return None
    return r.stdout


_visual_cache = {}


def visual_signature(ffmpeg: str, ffprobe: str, file: str, question):
    if file in _visual_cache:
        return _visual_cache[file]
    if is_video_path(file, question) and ffprobe:
        dur = duration_seconds(ffprobe, file)
        times = [0.05, dur / 2, max(0, dur - 0.05)] if dur > 0 else [0, 0.5, 1]
        parts = []
        for t in times:
            frame = extract_frame(ffmpeg, file, t)
            if frame:
                parts.append(frame)
        buf = b"".join(parts) if parts else extract_frame(ffmpeg, file, 0)
    else:
        buf = extract_frame(ffmpeg, file, 0)
    _visual_cache[file] = buf
    return buf


def rgb_similarity(a, b) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    if not n:
        return 0.0
    acc = sum(abs(a[i] - b[i]) for i in range(n))
    return 1 - acc / (n * 255)


def visually_same(ffmpeg, ffprobe, index, left, right) -> bool:
    path_l = resolve_media_path(index, left)
    path_r = resolve_media_path(index, right)
    if not path_l or not path_r:
        return False
    return rgb_similarity(
        visual_signature(ffmpeg, ffprobe, path_l, left),
        visual_signature(ffmpeg, ffprobe, path_r, right),
    ) >= THRESHOLD


def duplicate_reason(q, candidates, ffmpeg, ffprobe, index):
    if not candidates:
        return None
    new_stem = media_stem(q.get("media"))
    for old in candidates:
        old_stem = media_stem(old.get("media"))
        if new_stem and old_stem and new_stem == old_stem:
            return "filename"
        if not new_stem and not old_stem:
            return "text-only"
        if ffmpeg and visually_same(ffmpeg, ffprobe, index, q, old):
            return "visual"
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gov-dir", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--ffmpeg", default="")
    ap.add_argument("--ffprobe", default="")
    ap.add_argument("--media-dir", action="append", default=[])
    args = ap.parse_args()

    ffmpeg = args.ffmpeg if args.ffmpeg and Path(args.ffmpeg).exists() else ""
    ffprobe = args.ffprobe
    if ffmpeg and not ffprobe:
        sibling = Path(ffmpeg).with_name("ffprobe")
        if sibling.exists():
            ffprobe = str(sibling)
    media_index = index_media(args.media_dir)
    if ffmpeg and not media_index:
        print("-> No local media — merge without frame comparison (filename only).")
        ffmpeg = ""
    elif ffmpeg:
        print(f"-> Visual media comparison (FFmpeg {SIZE}×{SIZE}, threshold {round(THRESHOLD * 100)}%).")
    else:
        print("-> No FFmpeg — merge without frame comparison (media filename only).")

    added_total = 0
    meta_categories = []
    fact_map = {}
    polish_map = {}
    gov_dir = Path(args.gov_dir)
    out_dir = Path(args.out_dir)

    for cat in CATEGORIES:
        src = gov_dir / f"{cat}.json"
        dest = out_dir / f"{cat}.json"
        if not src.is_file():
            die(f"Missing {src} — run parse-excel first.")
        if not dest.is_file():
            die(f"Missing {dest} — merge needs the repo question bank.")
        incoming = load_category_questions(src)
        existing_ids = set()
        by_text = {}
        lst = []
        for q in load_category_questions(dest):
            existing_ids.add(str(q.get("id", "")).strip())
            tk = text_key(q.get("q"))
            if tk:
                by_text.setdefault(tk, []).append(q)
            lst.append(q)

        added = skipped_same = skipped_visual = id_rewritten = 0
        for q in incoming:
            tk = text_key(q.get("q"))
            if not tk:
                continue
            why = duplicate_reason(q, by_text.get(tk) or [], ffmpeg, ffprobe, media_index)
            if why in ("filename", "text-only"):
                skipped_same += 1
                continue
            if why == "visual":
                skipped_visual += 1
                continue
            new_id = unique_id(q.get("id"), existing_ids)
            to_add = dict(q)
            if str(new_id) != str(q.get("id", "")).strip():
                to_add["id"] = new_id
                id_rewritten += 1
            existing_ids.add(str(to_add["id"]).strip())
            by_text.setdefault(tk, []).append(to_add)
            lst.append(to_add)
            added += 1

        ids = []
        for question in lst:
            ids.append(question.get("id"))
            key = str(question.get("id", "")).strip()
            if not key or key in fact_map:
                continue
            fact_map[key] = stored_fact(question)
            polish_map[key] = stored_polish(question)
        write_json(dest, {"category": cat, "questionIds": ids})
        basic = sum(1 for q in lst if q.get("type") == "basic")
        specialist = sum(1 for q in lst if q.get("type") == "specialist")
        meta_categories.append({
            "id": cat,
            "name": f"Kategoria {cat}",
            "questionCount": len(lst),
            "basicCount": basic,
            "specialistCount": specialist,
        })
        added_total += added
        skip_bits = []
        if skipped_same:
            skip_bits.append(f"same text+media: {skipped_same}")
        if skipped_visual:
            skip_bits.append(f"same text+frames ≥95%: {skipped_visual}")
        if id_rewritten:
            skip_bits.append(f"new id (number taken): {id_rewritten}")
        skip_note = f", skipped {', '.join(skip_bits)}" if skip_bits else ""
        print(f"  {cat:>3}: +{added:4} from ministry (total {len(lst)}{skip_note})")

    (out_dir / "questions.json").write_text(
        json.dumps(fact_map, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (out_dir / "translations_pl.json").write_text(
        json.dumps(polish_map, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    meta_path = out_dir / "meta.json"
    exam = EXAM
    if meta_path.is_file():
        old = read_json(meta_path)
        if old.get("exam"):
            exam = old["exam"]
        for cat in meta_categories:
            prev = next((c for c in (old.get("categories") or []) if c.get("id") == cat["id"]), None)
            if prev and prev.get("name"):
                cat["name"] = prev["name"]
    write_json(meta_path, {"categories": meta_categories, "exam": exam})
    print(f"-> Merge: added {added_total} ministry questions that were not in the repo.")


if __name__ == "__main__":
    main()
