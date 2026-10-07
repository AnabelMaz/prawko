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
import tempfile
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


def server_root() -> Path:
    if sys.platform == "win32":
        return Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "prawko"
    if sys.platform == "darwin":
        return Path("/usr/local/prawko")
    return Path("/opt/prawko")


def local_app_gov_data() -> Path:
    home = Path(os.environ.get("PRAWKO_USER_HOME") or os.path.expanduser("~"))
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "prawko" / "gov-data"
    if sys.platform == "win32":
        local = Path(os.environ.get("LOCALAPPDATA") or (home / "AppData" / "Local"))
        return local / "prawko" / "gov-data"
    xdg = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg) if xdg else home / ".local" / "share"
    return base / "prawko" / "gov-data"


def gov_data_dir() -> Path:
    env = os.environ.get("PRAWKO_GOV_DATA")
    if env:
        return Path(env)
    return server_root() / "gov-cache"


def gov_zip_dir() -> Path:
    return gov_data_dir() / "zip"


def gov_raw_temp_dir() -> Path:
    return Path(tempfile.gettempdir()) / "prawko" / "raw"


def copy_legacy_app_gov_cache() -> None:
    legacy = local_app_gov_data()
    dest = gov_data_dir()
    if not legacy.is_dir():
        return
    dest.mkdir(parents=True, exist_ok=True)
    legacy_excel = legacy / "baza_pytan.xlsx"
    dest_excel = dest / "baza_pytan.xlsx"
    if legacy_excel.is_file() and not dest_excel.exists():
        shutil.copy2(legacy_excel, dest_excel)
        say_y(f"-> Copied legacy Excel → {dest_excel}")
    for hash_file in legacy.glob("*.hash"):
        to = dest / hash_file.name
        if not to.exists():
            shutil.copy2(hash_file, to)
    legacy_zip = legacy / "cache"
    zip_dest = gov_zip_dir()
    if legacy_zip.is_dir():
        zip_dest.mkdir(parents=True, exist_ok=True)
        for zf in legacy_zip.glob("*.zip"):
            to = zip_dest / zf.name
            if not to.exists():
                shutil.copy2(zf, to)


def gov_cache_has_zips() -> bool:
    zdir = gov_zip_dir()
    return zdir.is_dir() and any(zdir.glob("*.zip"))


def expand_gov_media_zips_to_temp() -> Path:
    zdir = gov_zip_dir()
    raw = gov_raw_temp_dir()
    if not gov_cache_has_zips():
        die(f"No ministry media ZIPs in {zdir}. Run download-gov / --sync-gov first.")
    assert_disk_space(raw, 8 * 1024 * 1024 * 1024, "temp unpack JPG/WMV")
    if raw.exists():
        shutil.rmtree(raw, ignore_errors=True)
    raw.mkdir(parents=True, exist_ok=True)
    for zf in sorted(zdir.glob("*.zip")):
        say_g(f"-> Unpacking {zf.name} → {raw}")
        unpack_archive(zf, raw)
    flatten_media_dir(raw)
    return raw


def remove_gov_raw_temp() -> None:
    raw = gov_raw_temp_dir()
    if raw.exists():
        shutil.rmtree(raw, ignore_errors=True)


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


def assert_disk_space(path: Path, min_free: int, what: str) -> None:
    free = free_bytes(path)
    if free >= min_free:
        return
    have_gb = free / (1024 ** 3)
    need_gb = min_free / (1024 ** 3)
    die(
        f"Not enough disk space for {what}: {have_gb:.1f} GB free at {path} "
        f"(need {need_gb:.1f} GB). Free space and retry — files stay in {path}."
    )


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
    say_y(f"Ignoring leftover {legacy.name} in the checkout. Media ZIPs live in {gov_zip_dir()}.")


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
    copy_legacy_app_gov_cache()
    gov_dir.mkdir(parents=True, exist_ok=True)

    if args.excel_only:
        say_c(f"download-gov: Excel only → {excel_path}")
        assert_disk_space(gov_dir, 64 * 1024 * 1024, "ministry Excel")
        sync_excel(excel_path, excel_hash)
        if not excel_path.is_file():
            die(f"Missing {excel_path} — question bank from gov.pl was not downloaded.")
        say_g(f"Done. Excel: {excel_path}")
        return

    move_legacy_raw()
    zip_cache = gov_zip_dir()
    if not args.skip_media:
        assert_disk_space(zip_cache, 12 * 1024 * 1024 * 1024, "ministry ZIPs")
    zip_cache.mkdir(parents=True, exist_ok=True)

    say_c(f"download-gov: Excel + situational media ZIP from gov.pl → {gov_dir}")
    say_d(f"ZIP: {zip_cache} (kept; unpack is convert-media into TEMP)")
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
                hash_file = gov_dir / f".media_{url_hash}.hash"
                zip_path = zip_cache / f"media_{url_hash}.zip"
                say_c("-> Hashing first 1 MB of the media pack...")
                if needs_download(url, hash_file, zip_path):
                    say_y("-> Downloading media pack from gov.pl (resumable if interrupted)...")
                    curl_download(url, zip_path)
                    save_prefix_hash(hash_file, url)
                else:
                    say_d(f"-> Media pack unchanged: {zip_path}")
        else:
            say_d("-> Skipping (not Excel or media).")
        say("--------------------------------------------------")

    if not excel_path.is_file():
        die(f"Missing {excel_path} — question bank from gov.pl was not downloaded.")
    say_g(f"Done. Excel: {excel_path}")
    say_d(f"ZIPs: {zip_cache}")


if __name__ == "__main__":
    main()
