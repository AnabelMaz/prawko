#!/usr/bin/env python3
"""Build category media zip packs from question JSON — no hand-maintained lists.

Windows: scripts/build-media-packs.ps1 (no Python). This file is the same job
for Linux/macOS.

Reads every category JSON (media names walked recursively). Files with the same
category support form an atom (kernel of the support map). Atoms are merged
when Jaccard(support) is high enough and per-category surplus stays under
--margin. Oversized packs are split into similar-weight parts (same support:
zero extra waste). Pack ids are derived only from the support set + part index.

Writes packs/manifest.json and optional zips. The app (later) downloads
categories[id] from that manifest.

  python3 scripts/build-media-packs.py
  python3 scripts/build-media-packs.py --max-zip-mib 250
  python3 scripts/build-media-packs.py --self-test
  python3 scripts/build-media-packs.py --data-dir src/data --media-dir <img/vid parent> --out-dir %LOCALAPPDATA%/prawko/packs
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path

SKIP_JSON = frozenset({
    "meta.json",
    "translations_en.json",
    "translations_de.json",
    "translations_uk.json",
    "translations_pl.json",
})

# Proxy MB when real files are missing (webp vs mp4 after convert-media).
W_IMAGE = 1.0
W_VIDEO = 11.0

# Zip cap in MiB. Override with --max-zip-mib. R2 dashboard 300 MB = 300e6 bytes (~286 MiB).
DEFAULT_MAX_ZIP_MIB = 280


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def discover_categories(data_dir: Path) -> list[str]:
    meta = data_dir / "meta.json"
    if meta.is_file():
        obj = json.loads(meta.read_text(encoding="utf-8"))
        cats = obj.get("categories") or []
        ids = [c["id"] for c in cats if isinstance(c, dict) and c.get("id")]
        if ids:
            return ids
    ids = []
    for p in sorted(data_dir.glob("*.json")):
        if p.name in SKIP_JSON:
            continue
        ids.append(p.stem)
    if not ids:
        raise SystemExit(f"No category JSON in {data_dir}")
    return ids


def iter_media(obj):
    """Yield (filename, mediaType|None) from any JSON shape."""
    if isinstance(obj, dict):
        media = obj.get("media")
        if isinstance(media, str) and media.strip():
            yield media.strip(), obj.get("mediaType")
        for v in obj.values():
            yield from iter_media(v)
    elif isinstance(obj, list):
        for x in obj:
            yield from iter_media(x)


def cat_key(c: str):
    return (len(c), c)


def support_id(support: frozenset[str], all_cats: list[str]) -> str:
    cats = tuple(sorted(support, key=cat_key))
    if not cats:
        return "set-empty"
    if set(cats) == set(all_cats) and len(cats) == len(all_cats):
        return "set-all"
    if len(cats) == 1:
        return f"cat-{cats[0]}"
    slug = "-".join(cats)
    if len(slug) <= 48:
        return f"set-{slug}"
    digest = hashlib.sha1(",".join(cats).encode("utf-8")).hexdigest()[:10]
    return f"set-{len(cats)}-{digest}"


def file_kind(name: str, declared: str | None) -> str:
    if declared in ("video", "image"):
        return declared
    ext = Path(name).suffix.lower()
    if ext in {".mp4", ".webm", ".wmv"}:
        return "video"
    return "image"


def file_weight(name: str, kind: str, sizes: dict[str, int]) -> float:
    if name in sizes:
        return max(sizes[name], 1) / (256 * 1024)
    return W_VIDEO if kind == "video" else W_IMAGE


class Block:
    __slots__ = ("files", "support", "kinds")

    def __init__(self, files: list[str], support: frozenset[str], kinds: dict[str, str]):
        self.files = list(files)
        self.support = frozenset(support)
        self.kinds = kinds

    def n(self) -> int:
        return len(self.files)

    def weight(self, sizes: dict[str, int]) -> float:
        return sum(file_weight(f, self.kinds[f], sizes) for f in self.files)

    def needed_n(self, cat: str, where: dict[str, frozenset[str]]) -> int:
        return sum(1 for f in self.files if cat in where[f])


def collect_where(data_dir: Path, categories: list[str]):
    where: dict[str, set[str]] = defaultdict(set)
    kinds: dict[str, str] = {}
    for cat in categories:
        path = data_dir / f"{cat}.json"
        if not path.is_file():
            continue
        obj = json.loads(path.read_text(encoding="utf-8"))
        for name, mtype in iter_media(obj):
            where[name].add(cat)
            kinds[name] = file_kind(name, mtype if isinstance(mtype, str) else None)
    frozen = {k: frozenset(v) for k, v in where.items()}
    return frozen, kinds


def scan_sizes(media_dir: Path | None) -> dict[str, int]:
    sizes: dict[str, int] = {}
    if not media_dir or not media_dir.is_dir():
        return sizes
    for sub in ("img", "vid"):
        folder = media_dir / sub
        if not folder.is_dir():
            continue
        for p in folder.iterdir():
            if p.is_file():
                sizes[p.name] = p.stat().st_size
    return sizes


def atoms(where: dict[str, frozenset[str]], kinds: dict[str, str]) -> list[Block]:
    groups: dict[frozenset[str], list[str]] = defaultdict(list)
    for name, supp in where.items():
        groups[supp].append(name)
    blocks = []
    for supp, files in groups.items():
        files.sort()
        blocks.append(Block(files, supp, kinds))
    return blocks


def jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    u = a | b
    if not u:
        return 0.0
    return len(a & b) / len(u)


def category_stats(blocks: list[Block], categories: list[str], where: dict[str, frozenset[str]]):
    need = {c: sum(1 for s in where.values() if c in s) for c in categories}
    out = {}
    for c in categories:
        used = [b for b in blocks if b.needed_n(c, where)]
        got = sum(b.n() for b in used)
        n = need[c]
        waste = got - n
        pct = (100.0 * waste / n) if n else 0.0
        out[c] = {"need": n, "got": got, "waste": waste, "waste_pct": pct, "zips": len(used)}
    return out


def max_waste_pct(blocks: list[Block], categories: list[str], where: dict[str, frozenset[str]]) -> float:
    st = category_stats(blocks, categories, where)
    if not st:
        return 0.0
    return max(v["waste_pct"] for v in st.values())


def merge_pair(blocks: list[Block], i: int, j: int) -> list[Block]:
    a, b = blocks[i], blocks[j]
    merged = Block(sorted(a.files + b.files), a.support | b.support, a.kinds)
    return [blk for k, blk in enumerate(blocks) if k not in (i, j)] + [merged]


def greedy_merge(
    blocks: list[Block],
    categories: list[str],
    where: dict[str, frozenset[str]],
    margin: float,
    jaccard_min: float,
) -> list[Block]:
    blocks = list(blocks)
    for _ in range(400):
        best = None
        n = len(blocks)
        for i, j in combinations(range(n), 2):
            jac = jaccard(blocks[i].support, blocks[j].support)
            if jac < jaccard_min:
                continue
            trial = merge_pair(blocks, i, j)
            waste = max_waste_pct(trial, categories, where)
            if waste > margin:
                continue
            key = (
                jac,
                -waste,
                -min(blocks[i].n(), blocks[j].n()),
                support_id(blocks[i].support, categories),
                support_id(blocks[j].support, categories),
            )
            if best is None or key > best[0]:
                best = (key, i, j)
        if best is None:
            break
        blocks = merge_pair(blocks, best[1], best[2])
    return blocks


def absorb_tiny(
    blocks: list[Block],
    categories: list[str],
    where: dict[str, frozenset[str]],
    margin: float,
    tiny_n: int,
) -> list[Block]:
    """Fold leftover 1–N file atoms into the closest support, still under margin."""
    blocks = list(blocks)
    changed = True
    while changed:
        changed = False
        tiny_idx = [i for i, b in enumerate(blocks) if b.n() <= tiny_n]
        tiny_idx.sort(key=lambda i: (blocks[i].n(), support_id(blocks[i].support, categories)))
        for i in tiny_idx:
            best_j = None
            best_jac = -1.0
            for j, other in enumerate(blocks):
                if j == i:
                    continue
                jac = jaccard(blocks[i].support, other.support)
                if jac > best_jac or (
                    jac == best_jac
                    and best_j is not None
                    and support_id(other.support, categories)
                    < support_id(blocks[best_j].support, categories)
                ):
                    trial = merge_pair(blocks, i, j)
                    if max_waste_pct(trial, categories, where) <= margin:
                        best_jac = jac
                        best_j = j
            if best_j is not None:
                blocks = merge_pair(blocks, i, best_j)
                changed = True
                break
    return blocks


def split_even(
    block: Block,
    target_n: int,
    sizes: dict[str, int],
    max_zip_mib: int = DEFAULT_MAX_ZIP_MIB,
) -> list[Block]:
    """Cut a same-support pack into similar pieces. Does not add surplus."""
    n = block.n()
    if n <= 1:
        return [block]
    if sizes and max_zip_mib > 0:
        max_bytes = max_zip_mib * 1024 * 1024
        files = list(block.files)
        chunks: list[list[str]] = []
        cur: list[str] = []
        used = 0
        for name in files:
            sz = int(sizes.get(name, 0))
            if cur and (used + sz) > max_bytes:
                chunks.append(cur)
                cur = []
                used = 0
            cur.append(name)
            used += sz
        if cur:
            chunks.append(cur)
        if len(chunks) <= 1:
            return [block]
        return [Block(ch, block.support, block.kinds) for ch in chunks]
    if n <= int(target_n * 1.35):
        return [block]
    files = sorted(block.files)
    chunks = [files[i:i + target_n] for i in range(0, n, target_n)]
    if len(chunks) > 1 and len(chunks[-1]) < 40:
        chunks[-2].extend(chunks[-1])
        chunks.pop()
    if len(chunks) == 1:
        return [block]
    return [Block(ch, block.support, block.kinds) for ch in chunks]


def assign_ids(blocks: list[Block], all_cats: list[str]) -> list[tuple[str, Block]]:
    groups: dict[str, list[Block]] = defaultdict(list)
    for b in blocks:
        groups[support_id(b.support, all_cats)].append(b)
    named: list[tuple[str, Block]] = []
    for base in sorted(groups, key=lambda s: (len(s), s)):
        parts = sorted(groups[base], key=lambda b: (b.files[0] if b.files else "", b.n()))
        if len(parts) == 1:
            named.append((base, parts[0]))
            continue
        for i, b in enumerate(parts, 1):
            named.append((f"{base}-p{i:02d}", b))
    named.sort(key=lambda x: x[0])
    return named


def resolve_media_file(media_dir: Path, name: str, kind: str) -> Path | None:
    sub = "vid" if kind == "video" else "img"
    direct = media_dir / sub / name
    if direct.is_file():
        return direct
    for folder in (media_dir / "img", media_dir / "vid"):
        cand = folder / name
        if cand.is_file():
            return cand
    return None


def write_zips(
    named: list[tuple[str, Block]],
    media_dir: Path | None,
    out_dir: Path,
    kinds: dict[str, str],
) -> dict[str, dict]:
    meta = {}
    total = len(named)
    dest = str(out_dir)
    print(f"-> Clearing {dest} ...", flush=True)
    if out_dir.exists():
        for child in out_dir.iterdir():
            if child.is_file() or child.is_symlink():
                child.unlink()
            else:
                shutil.rmtree(child)
    out_dir.mkdir(parents=True, exist_ok=True)
    if media_dir:
        print(f"-> Writing {total} zip packs (this may take a while)...", flush=True)
    else:
        print(f"-> Writing {total} pack lists (no zip)...", flush=True)
    for i, (pid, block) in enumerate(named, 1):
        zip_path = out_dir / f"{pid}.zip"
        missing = []
        label = f"{pid}.zip" if media_dir else f"{pid}.txt"
        print(f"   pack {i} / {total}  {label}  ({block.n()} files)...", flush=True)
        if media_dir:
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as zf:
                nfiles = max(1, block.n())
                for fi, name in enumerate(block.files, 1):
                    kind = kinds[name]
                    src = resolve_media_file(media_dir, name, kind)
                    arc = f"{'vid' if kind == 'video' else 'img'}/{name}"
                    if src is None:
                        missing.append(name)
                        continue
                    zf.write(src, arcname=arc)
                    if fi == nfiles or fi % 25 == 0:
                        print(f"      {fi} / {block.n()} files", flush=True)
        elif zip_path.exists():
            zip_path.unlink()
        list_path = out_dir / f"{pid}.txt"
        list_path.write_text("\n".join(block.files) + ("\n" if block.files else ""), encoding="utf-8")
        info = {
            "id": pid,
            "file": f"{pid}.zip" if media_dir else None,
            "files": block.n(),
            "support": sorted(block.support, key=cat_key),
            "missing": missing,
        }
        if media_dir and zip_path.is_file():
            print(f"   hashing {pid}.zip ...", flush=True)
            info["bytes"] = zip_path.stat().st_size
            info["sha256"] = hashlib.sha256(zip_path.read_bytes()).hexdigest()
            print(
                f"   pack {i} / {total}  {pid}.zip  {info['bytes'] / (1024 * 1024):.1f} MiB",
                flush=True,
            )
        else:
            info["sha256"] = hashlib.sha256("\n".join(block.files).encode("utf-8")).hexdigest()
        meta[pid] = info
    return meta


def build(
    data_dir: Path,
    media_dir: Path | None,
    out_dir: Path,
    margin: float,
    jaccard_min: float,
    target_weight: float,
    tiny_n: int,
    make_zip: bool,
    max_zip_mib: int = DEFAULT_MAX_ZIP_MIB,
) -> dict:
    categories = discover_categories(data_dir)
    where, kinds = collect_where(data_dir, categories)
    if not where:
        raise SystemExit("No media names in category JSON.")
    sizes = scan_sizes(media_dir) if media_dir else {}
    blocks = atoms(where, kinds)
    atom_n = len(blocks)
    blocks = greedy_merge(blocks, categories, where, margin, jaccard_min)
    blocks = absorb_tiny(blocks, categories, where, margin, tiny_n)
    split: list[Block] = []
    for b in blocks:
        split.extend(split_even(b, int(target_weight), sizes, max_zip_mib))
    named = assign_ids(split, categories)
    out_dir.mkdir(parents=True, exist_ok=True)
    zip_meta = write_zips(named, media_dir if make_zip else None, out_dir, kinds)
    cat_map = {}
    st = category_stats([b for _, b in named], categories, where)
    for c in categories:
        cat_map[c] = [pid for pid, b in named if b.needed_n(c, where)]
    manifest = {
        "schema": 1,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "params": {
            "margin_pct": margin,
            "jaccard_min": jaccard_min,
            "target_weight": target_weight,
            "tiny_n": tiny_n,
            "max_zip_mib": max_zip_mib,
        },
        "atoms": atom_n,
        "packs": zip_meta,
        "categories": cat_map,
        "surplus": {
            c: {
                "need": st[c]["need"],
                "in_zips": st[c]["got"],
                "extra": st[c]["waste"],
                "extra_pct": round(st[c]["waste_pct"], 2),
            }
            for c in categories
        },
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def self_test() -> None:
    """Tiny synthetic universe: kernel + merge + split + naming."""
    import tempfile

    data = {
        "A": {
            "questions": [
                {"media": "shared.webp", "mediaType": "image"},
                {"media": "ab.webp", "mediaType": "image"},
                {"media": "only-a.webp", "mediaType": "image"},
            ]
        },
        "B": {
            "questions": [
                {"media": "shared.webp", "mediaType": "image"},
                {"media": "ab.webp", "mediaType": "image"},
                {"media": "only-b.webp", "mediaType": "image"},
            ]
        },
        "C": {
            "questions": [
                {"media": "shared.webp", "mediaType": "image"},
                {"media": "only-c.webp", "mediaType": "image"},
            ]
        },
    }
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp) / "data"
        d.mkdir()
        (d / "meta.json").write_text(
            json.dumps({"categories": [{"id": "A"}, {"id": "B"}, {"id": "C"}]}),
            encoding="utf-8",
        )
        for cat, obj in data.items():
            (d / f"{cat}.json").write_text(json.dumps(obj), encoding="utf-8")
        out = Path(tmp) / "out"
        man = build(
            data_dir=d,
            media_dir=None,
            out_dir=out,
            margin=20.0,
            jaccard_min=0.45,
            target_weight=1000.0,
            tiny_n=2,
            make_zip=False,
        )
        assert man["schema"] == 1
        assert set(man["categories"]) == {"A", "B", "C"}
        assert "set-all" in man["packs"] or any("shared" in (out / f"{p}.txt").read_text(encoding="utf-8") for p in man["packs"])
        for cat, packs in man["categories"].items():
            assert packs, cat
            names = []
            for pid in packs:
                names.extend((out / f"{pid}.txt").read_text(encoding="utf-8").split())
            needed = {q["media"] for q in data[cat]["questions"]}
            assert needed <= set(names), (cat, needed, names)
        print("self-test ok")


def default_media_dir() -> Path | None:
    server = Path(r"C:\ProgramData\prawko\src\media")
    if (server / "img").is_dir() or (server / "vid").is_dir():
        return server
    local = Path(os.environ.get("LOCALAPPDATA", "")) / "prawko" / "media"
    if (local / "img").is_dir() or (local / "vid").is_dir():
        return local
    return None


def default_out_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(repo_root())
    return Path(base) / "prawko" / "packs"


def print_summary(man: dict) -> None:
    print(f"atoms {man['atoms']}  packs {len(man['packs'])}")
    print("id                                 files  cats")
    for pid, info in sorted(man["packs"].items(), key=lambda kv: (-kv[1]["files"], kv[0])):
        supp = "+".join(info["support"])
        if len(supp) > 36:
            supp = supp[:34] + ".."
        print(f"  {pid:<32} {info['files']:5}  {supp}")
    print("category   zips  need   got  extra    %")
    for c, s in man["surplus"].items():
        z = len(man["categories"][c])
        print(f"  {c:<8} {z:4} {s['need']:5} {s['in_zips']:5} {s['extra']:6} {s['extra_pct']:5.1f}%")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build universal media zip packs from category JSON.")
    ap.add_argument("--data-dir", type=Path, default=repo_root() / "src" / "data")
    ap.add_argument("--media-dir", type=Path, default=None, help="Parent of img/ and vid/ (omit to skip zip bytes).")
    ap.add_argument("--out-dir", type=Path, default=None)
    ap.add_argument("--margin", type=float, default=12.0, help="Max extra files per category, percent.")
    ap.add_argument("--jaccard", type=float, default=0.45, help="Min support overlap to merge atoms.")
    ap.add_argument("--target-weight", type=float, default=180.0, help="Split a pack after this many files (or by ~64MB when real sizes exist).")
    ap.add_argument("--tiny", type=int, default=8, help="Fold leftover packs with at most this many files.")
    ap.add_argument(
        "--max-zip-mib",
        type=int,
        default=DEFAULT_MAX_ZIP_MIB,
        help="Fill each zip up to this many MiB (default: %(default)s).",
    )
    ap.add_argument("--no-zip", action="store_true", help="Lists + manifest only.")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)
    if args.self_test:
        self_test()
        return 0
    media = args.media_dir if args.media_dir is not None else default_media_dir()
    out = args.out_dir or default_out_dir()
    make_zip = bool(media) and not args.no_zip
    man = build(
        data_dir=args.data_dir,
        media_dir=media if make_zip else None,
        out_dir=out,
        margin=args.margin,
        jaccard_min=args.jaccard,
        target_weight=args.target_weight,
        tiny_n=args.tiny,
        make_zip=make_zip,
        max_zip_mib=args.max_zip_mib,
    )
    print(f"wrote {out / 'manifest.json'}")
    print_summary(man)
    return 0


if __name__ == "__main__":
    sys.exit(main())
