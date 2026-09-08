#!/usr/bin/env python3
"""Report JSON questions that mention a photo/film but have media: null.

Does not drop ministry rows unless you pass --remove. Default parse-excel keeps
Excel media names for CDN, so this should normally match nothing.

Same job as scripts/filter-no-media.ps1.

  python3 scripts/filter-no-media.py
  python3 scripts/filter-no-media.py --remove
"""

import argparse
import json
import os
import re

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "data")
CATEGORIES = ["A", "A1", "A2", "AM", "B", "B1", "C", "C1", "D", "D1", "PT", "T"]

# Match Polish exam wording that implies a photo/film (do not translate the patterns).
MEDIA_REFERENCE_PATTERNS = [
    r"[Ww] tej sytuacji",
    r"[Ww] przedstawionej sytuacji",
    r"[Ww] takiej sytuacji",
    r"[Ww] takim terenie",
    r"na zdjęciu",
    r"na fotografii",
    r"na ilustracji",
    r"na rysunku",
    r"na filmie",
    r"na widocznym",
    r"tak oznakow",
    r"tak oznacz",
    r"takim odcinku",
    r"takiej drod",
    r"takim skrzyżowaniu",
    r"na takiej autostradzie",
    r"na takiej drodze",
    r"tego znaku",
    r"tym sygnale",
    r"widoczn\w+ znak",
    r"widoczn\w+ słupk",
    r"widoczn\w+ lini",
    r"widoczn\w+ pojazd",
    r"widoczn\w+ przejazd",
    r"widoczn\w+ przejści",
    r"widoczn\w+ przystan",
    r"widoczn\w+ po lewej",
    r"widoczn\w+ po prawej",
    r"widoczn\w+ zakręt",
]

MEDIA_REFERENCE_REGEX = re.compile("|".join(MEDIA_REFERENCE_PATTERNS), re.IGNORECASE)


def question_needs_media(question_text: str) -> bool:
    return bool(MEDIA_REFERENCE_REGEX.search(question_text or ""))


def process_category(category_id: str, remove: bool) -> dict:
    filepath = os.path.join(DATA_DIR, f"{category_id}.json")
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    questions = data["questions"]
    kept = []
    removed = []
    for q in questions:
        if q.get("media") is None and question_needs_media(q.get("q") or ""):
            removed.append(q)
        else:
            kept.append(q)

    if remove and removed:
        data["questions"] = kept
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")

    return {
        "category": category_id,
        "original_count": len(questions),
        "removed_count": len(removed),
        "remaining_count": len(kept),
        "removed_basic": sum(1 for q in removed if q.get("type") == "basic"),
        "removed_specialist": sum(1 for q in removed if q.get("type") == "specialist"),
        "removed_questions": [(q["id"], (q.get("q") or "")[:80]) for q in removed],
    }


def update_meta(results: list, remove: bool) -> None:
    meta_path = os.path.join(DATA_DIR, "meta.json")
    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
    result_map = {r["category"]: r for r in results}
    for cat_meta in meta["categories"]:
        cat_id = cat_meta["id"]
        if cat_id not in result_map:
            continue
        r = result_map[cat_id]
        old_total = cat_meta["questionCount"]
        old_basic = cat_meta["basicCount"]
        old_specialist = cat_meta["specialistCount"]
        new_basic = old_basic - r["removed_basic"]
        new_specialist = old_specialist - r["removed_specialist"]
        new_total = new_basic + new_specialist
        if r["removed_count"] > 0:
            print(
                f"  meta.json [{cat_id}]: "
                f"questionCount {old_total} -> {new_total}, "
                f"basicCount {old_basic} -> {new_basic}, "
                f"specialistCount {old_specialist} -> {new_specialist}"
            )
        if remove:
            cat_meta["questionCount"] = new_total
            cat_meta["basicCount"] = new_basic
            cat_meta["specialistCount"] = new_specialist
    if remove:
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
            f.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--remove",
        action="store_true",
        help="Delete matching questions from JSON. Default only reports. Not recommended: it drops ministry rows.",
    )
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    if not args.remove:
        print("=== REPORT ONLY (pass --remove to delete ministry rows) ===\n")
    else:
        print("=== REMOVE MODE: dropping ministry questions from JSON ===\n")

    print(f"Checking questions with media: null in {DATA_DIR}\n")
    results = []
    total_removed = 0
    total_original = 0
    for cat_id in CATEGORIES:
        result = process_category(cat_id, remove=args.remove)
        results.append(result)
        total_removed += result["removed_count"]
        total_original += result["original_count"]
        print(
            f"  {cat_id:>3}: {result['removed_count']:>3} without media "
            f"(basic: {result['removed_basic']}, specialist: {result['removed_specialist']}) "
            f"| {result['original_count']} -> {result['remaining_count']}"
        )
        if args.verbose and result["removed_questions"]:
            for qid, qtext in result["removed_questions"]:
                print(f"       - [{qid}] {qtext}...")

    print(f"\n{'=' * 60}")
    print(f"  TOTAL: {total_removed} of {total_original} assignments mention a photo but have media: null")
    print(f"{'=' * 60}")
    print("\nUpdating meta.json..." if args.remove else "\nmeta.json unchanged.")
    update_meta(results, remove=args.remove)
    if args.remove:
        print("\nDone. JSON files updated.")
    else:
        print("\nNo files modified.")


if __name__ == "__main__":
    main()
