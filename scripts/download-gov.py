#!/usr/bin/env python3
"""Download ministry catalogue + media ZIPs from gov.pl (macOS/Linux).

Same job as scripts/download-gov.ps1. No Node — HTML is parsed in Python.

  python3 scripts/download-gov.py
  python3 scripts/download-gov.py --excel-only
  python3 scripts/download-gov.py --print-gov-data-dir
"""

from __future__ import annotations

import argparse
import hashlib
import html as htmlmod
import os
import re
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

MAIN_URL = "https://www.gov.pl/web/infrastruktura/prawo-jazdy"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
LEGACY_RAW_NAME = "Pytania egzaminacyjne na prawo jazdy 2025"
NEEDLES = (
    "Baza pytań",
    "KATALOG",
    "Multimedia do pytań",
    "tłumaczenia migowe",
    "tłumaczenie migowe",
    "migowe",
)
HREF_RE = re.compile(r"""<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)</a>""", re.I)


def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(1)


def say(msg: str, stream=sys.stdout) -> None:
    print(msg, file=stream, flush=True)


def say_c(msg: str) -> None:
    say(f"\033[36m{msg}\033[0m")


def say_g(msg: str) -> None:
    say(f"\033[32m{msg}\033[0m")


def say_y(msg: str) -> None:
    say(f"\033[33m{msg}\033[0m")


def say_d(msg: str) -> None:
    say(f"\033[90m{msg}\033[0m")


def script_dir() -> Path:
    return Path(__file__).resolve().parent


def repo_root() -> Path:
    env = os.environ.get("PRAWKO_REPO_ROOT")
    if env:
        return Path(env)
    root = script_dir().parent
    if (root / "src" / "index.html").is_file():
        return root
    die(f"Repo directory not found (src/index.html) above {script_dir()}.")
    raise AssertionError


def local_app_gov_data() -> Path:
    home = Path(os.environ.get("PRAWKO_USER_HOME") or os.path.expanduser("~"))
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "prawko" / "gov-data"
    xdg = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg) if xdg else home / ".local" / "share"
    return base / "prawko" / "gov-data"


def gov_data_dir() -> Path:
    env = os.environ.get("PRAWKO_GOV_DATA")
    if env:
        return Path(env)
    return local_app_gov_data()


def overflow_root() -> Path:
    local_dir = local_app_gov_data()
    repo = repo_root().resolve()
    for server in (Path("/opt/prawko"), Path("/usr/local/prawko")):
        try:
            if repo == server.resolve():
                return local_dir
        except OSError:
            continue
    return repo / "gov-data"


def url_fingerprint(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


def remote_prefix_hash(url: str) -> str:
    try:
        raw = subprocess.check_output(
            ["curl", "-fsSL", "-A", UA, "--range", "0-1048575", "--max-time", "30", url],
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        return ""
    digest = hashlib.sha256(raw).hexdigest().upper()
    return "-".join(digest[i : i + 2] for i in range(0, len(digest), 2))


def needs_download(url: str, hash_file: Path, local_file: Path) -> bool:
    remote = remote_prefix_hash(url)
    if not remote:
        return True
    if not local_file.exists() or not hash_file.is_file():
        return True
    stored = hash_file.read_text(encoding="utf-8").strip()
    return stored != remote


def save_prefix_hash(hash_file: Path, url: str) -> None:
    hash_file.parent.mkdir(parents=True, exist_ok=True)
    digest = remote_prefix_hash(url)
    if digest:
        hash_file.write_text(digest + "\n", encoding="utf-8")


def curl_download(url: str, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    head = subprocess.run(
        ["curl", "-sI", "-L", "-A", UA, "--max-time", "20", url],
        capture_output=True,
        text=True,
        check=False,
    )
    expected = None
    for line in (head.stdout or "").splitlines():
        if line.lower().startswith("content-length:"):
            try:
                expected = int(line.split(":", 1)[1].strip())
            except ValueError:
                expected = None
    if expected and expected > 0:
        say_d(f"-> Size: {expected / 1048576:.1f} MB")
    cmd = ["curl", "-L", "-C", "-", "--retry", "5", "-A", UA, "-e", MAIN_URL, "--output", str(out), url]
    rc = subprocess.call(cmd)
    if rc == 33:
        say_y("-> Server does not support resume; downloading from scratch...")
        out.unlink(missing_ok=True)
        rc = subprocess.call(
            ["curl", "-L", "--retry", "5", "-A", UA, "-e", MAIN_URL, "--output", str(out), url]
        )
    if rc != 0:
        die(f"Download failed (curl {rc}): {url}")


def flatten_media_dir(directory: Path) -> None:
    if not directory.is_dir():
        return
    say_y(f"-> Flattening subfolders in {directory}...")
    for f in list(directory.rglob("*")):
        if not f.is_file() or f.parent == directory:
            continue
        dest = directory / f.name
        if not dest.exists():
            f.replace(dest)
        else:
            f.unlink()
    for d in sorted((p for p in directory.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        try:
            d.rmdir()
        except OSError:
            pass


def parse_gov_links() -> list[tuple[str, str]]:
    html_path = Path(os.environ.get("TMPDIR") or "/tmp") / f"prawko-gov-{os.getpid()}.html"
    rc = subprocess.call(["curl", "-fsSL", "-A", UA, MAIN_URL, "-o", str(html_path)])
    if rc != 0 or not html_path.is_file():
        html_path.unlink(missing_ok=True)
        die(f"Failed to download {MAIN_URL}")
    try:
        raw = html_path.read_text(encoding="utf-8", errors="replace")
    finally:
        html_path.unlink(missing_ok=True)
    seen: dict[str, str] = {}
    for m in HREF_RE.finditer(raw):
        href, inner = m.group(1), m.group(2)
        text = re.sub(r"<[^>]+>", "", inner)
        text = htmlmod.unescape(text)
        text = re.sub(r"\s+", " ", text).strip()
        href_pjm = bool(re.search(r"migowe", href, re.I))
        if not text and not href_pjm:
            continue
        ok = href_pjm or any(n in text for n in NEEDLES)
        if not ok:
            continue
        if href.startswith("//"):
            href = "https:" + href
        elif not re.match(r"^https?://", href, re.I):
            href = "https://www.gov.pl" + href
        if not text:
            text = href
        prev = seen.get(href)
        if prev is None or len(text) > len(prev):
            seen[href] = text
    rows = [(opis, url) for url, opis in seen.items()]
    rows.sort(key=lambda x: 0 if re.search(r"\.xlsx$", x[1], re.I) or re.search(r"KATALOG|Baza pytań", x[0], re.I) else 1)
    if not rows:
        die("gov.pl page parser found no question-bank or multimedia links.")
    return rows


def is_excel(opis: str, url: str) -> bool:
    return bool(re.search(r"\.xlsx$", url, re.I) or re.search(r"KATALOG|Baza pytań", opis))


def is_pjm(opis: str, url: str) -> bool:
    return "migow" in opis.lower() or "migowe" in url.lower()


def is_media(opis: str, url: str) -> bool:
    return bool(re.search(r"\.zip$", url, re.I) or "Multimedia" in opis)


def free_bytes(path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        return shutil.disk_usage(path.parent).free
    except OSError:
        return 0


def same_volume(a: Path, b: Path) -> bool:
    try:
        return os.stat(a).st_dev == os.stat(b).st_dev
    except OSError:
        return False


def resolve_staging(preferred: Path, overflow: Path, min_free: int, what: str) -> Path:
    if preferred.is_dir() and any(preferred.iterdir()):
        return preferred
    pref_free = free_bytes(preferred)
    if pref_free >= min_free:
        return preferred
    overflow.parent.mkdir(parents=True, exist_ok=True)
    if same_volume(preferred.parent, overflow.parent):
        return preferred
    over_free = free_bytes(overflow)
    if over_free >= min_free:
        say_y(f"-> Low disk space for {what} ({preferred}). Using {overflow}")
        return overflow
    return preferred


def unpack_archive(archive: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    try:
        with tarfile.open(archive) as tar:
            tar.extractall(dest)
            return
    except tarfile.TarError:
        pass
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(dest)


def move_legacy_raw() -> None:
    legacy = repo_root() / LEGACY_RAW_NAME
    if not legacy.is_dir():
        return
    raw = gov_data_dir() / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    say_y("Merging legacy raw-media folder into gov-data/raw...")
    for f in legacy.rglob("*"):
        if not f.is_file():
            continue
        dest = raw / f.name
        if not dest.exists():
            f.replace(dest)
    shutil.rmtree(legacy, ignore_errors=True)


def sync_excel(excel_path: Path, hash_file: Path) -> None:
    excel_path.parent.mkdir(parents=True, exist_ok=True)
    say_c(f"-> Parsing {MAIN_URL} ...")
    found = False
    for opis, url in parse_gov_links():
        if not is_excel(opis, url):
            continue
        found = True
        if needs_download(url, hash_file, excel_path):
            say_c(f"-> Downloading Excel from gov.pl to {excel_path}...")
            curl_download(url, excel_path)
            save_prefix_hash(hash_file, url)
        else:
            say_d(f"-> Excel unchanged. Parsing local file: {excel_path}")
        break
    if not found:
        die("gov.pl has no Excel link for the question bank.")


def main() -> None:
    ap = argparse.ArgumentParser(description="Download Excel + situational media ZIP from gov.pl")
    ap.add_argument("--excel-only", action="store_true")
    ap.add_argument("--skip-media", action="store_true")
    ap.add_argument("--print-gov-data-dir", action="store_true")
    args = ap.parse_args()

    if args.print_gov_data_dir:
        print(gov_data_dir())
        return

    gov_dir = gov_data_dir()
    excel_path = gov_dir / "baza_pytan.xlsx"
    excel_hash = gov_dir / ".baza_pytan.hash"
    overflow = overflow_root()
    gov_dir.mkdir(parents=True, exist_ok=True)

    if args.excel_only:
        say_c(f"download-gov: Excel only → {excel_path}")
        sync_excel(excel_path, excel_hash)
        if not excel_path.is_file():
            die(f"Missing {excel_path} — question bank from gov.pl was not downloaded.")
        say_g(f"Done. Excel: {excel_path}")
        return

    move_legacy_raw()
    raw_preferred = gov_dir / "raw"
    raw_dir = resolve_staging(raw_preferred, overflow / "raw", 8 * 1024 * 1024 * 1024, "raw JPG/WMV")
    if raw_dir != raw_preferred:
        raw_dir.mkdir(parents=True, exist_ok=True)
        if raw_preferred.exists() or raw_preferred.is_symlink():
            raw_preferred.unlink()
        raw_preferred.symlink_to(raw_dir)
    zip_preferred = gov_dir / "cache"
    zip_cache = resolve_staging(zip_preferred, overflow / "cache", 12 * 1024 * 1024 * 1024, "ministry ZIPs")
    raw_dir.mkdir(parents=True, exist_ok=True)
    zip_cache.mkdir(parents=True, exist_ok=True)

    say_c("download-gov: Excel + situational media ZIP from gov.pl → gov-data.")
    say_d(f"ZIP: {zip_cache}")
    say_d(f"Situational JPG/WMV: {raw_dir}")
    say_c(f"-> Parsing {MAIN_URL} ...")
    for opis, url in parse_gov_links():
        say_g(f"DESC: {opis}")
        say_d(f"LINK: {url}")
        if is_excel(opis, url):
            if needs_download(url, excel_hash, excel_path):
                say_c(f"-> Downloading Excel from gov.pl to {excel_path}...")
                curl_download(url, excel_path)
                save_prefix_hash(excel_hash, url)
            else:
                say_d(f"-> Excel unchanged: {excel_path}")
        elif is_pjm(opis, url):
            say_d("-> Sign-language (PJM) pack found; not downloading.")
        elif is_media(opis, url):
            if args.skip_media:
                say_d("-> Skipping situational media (--skip-media).")
            else:
                url_hash = url_fingerprint(url)
                marker = raw_dir / f".downloaded_{url_hash}"
                hash_file = gov_dir / f".media_{url_hash}.hash"
                zip_path = zip_cache / f"media_{url_hash}.zip"
                say_c("-> Hashing first 1 MB of the media pack...")
                if needs_download(url, hash_file, marker):
                    say_y("-> Downloading media pack from gov.pl (resumable if interrupted)...")
                    curl_download(url, zip_path)
                    say_g(f"-> Unpacking to {raw_dir}...")
                    unpack_archive(zip_path, raw_dir)
                    flatten_media_dir(raw_dir)
                    marker.write_text("", encoding="utf-8")
                    save_prefix_hash(hash_file, url)
                    zip_path.unlink(missing_ok=True)
                else:
                    say_d("-> Media pack unchanged. Skipping download.")
        else:
            say_d("-> Skipping (not Excel or media).")
        say("--------------------------------------------------")

    if not excel_path.is_file():
        die(f"Missing {excel_path} — question bank from gov.pl was not downloaded.")
    say_g(f"Done. Excel: {excel_path}")
    say_d(f"Situational: {raw_dir}")


if __name__ == "__main__":
    main()
