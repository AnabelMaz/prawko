#!/usr/bin/env python3
"""Fill missing question translations (macOS/Linux).

Same job as scripts/translate-questions.ps1. Does not overwrite ministry Excel
strings already in translations_{en,de,ua}.json. Target `ua` is Ukrainian
(Google language code `uk`). No extra pip package.

Key resolution (Gemini if any of these exist, else Google Translate):
  1. --gemini-api-key for this run
  2. GEMINI_API_KEY already in the environment
  3. .geminienv at the repo root (gitignored; template scripts/geminienv.example)
With a key: Gemini only (same POST as a working AI Studio probe: gemini-3.5-flash-lite).
Gemini failure aborts (progress saved). No key: Google Translate. A progress bar
runs during the fill.

  python3 scripts/translate-questions.py
  python3 scripts/translate-questions.py --lang ua
  python3 scripts/translate-questions.py --lang ua --gemini-api-key KEY

Library: fill_missing(data_dir, langs=None, gemini_api_key=None, skip_verify_ai=False).
parse-excel.py calls it unless --skip-translate-gaps.
Fills are checked (length, structure, numbers, script) unless --skip-verify-ai.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DATA = REPO_ROOT / "src" / "data"
GEMINI_ENV_NAME = ".geminienv"
SKIP_JSON = {
    "meta.json",
    "translations_en.json",
    "translations_de.json",
    "translations_ua.json",
    "translations_uk.json",
    "translations_pl.json",
}
GOOGLE_LANG = {"en": "en", "de": "de", "ua": "uk"}
GEMINI_LANG = {
    "en": "English",
    "de": "German",
    "ua": "Ukrainian",
}
# Older Flash endpoints return 404. New keys: 3.5 Flash-Lite / 3.8 Flash.
GEMINI_MODELS = (
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
)
GEMINI_URL_TMPL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_HTTP_TIMEOUT = 30
_gemini_model: str | None = None
_gemini_models_ranked: list[str] | None = None
_gemini_dead: set[str] = set()
GEMINI_SKIP_SUB = (
    "live", "tts", "image", "embed", "transcribe", "veo", "lyria",
    "robotics", "audio", "banana", "omni", "computer",
    "preview", "experimental", "beta", "latest",
)
BATCH_SIZE = 1
DELAY = 0.4
GEMINI_DELAY = 0.4
SAVE_EVERY = 1


def die(msg: str) -> None:
    clear_progress()
    print(msg, file=sys.stderr)
    raise SystemExit(1)


def write_progress(done: int, total: int, lang: str, extra: str = "") -> None:
    pct = 100 if total <= 0 else min(100, int(100 * done / total))
    width = 20
    filled = int(width * pct / 100)
    bar = "#" * filled + "-" * (width - filled)
    line = f"  [{bar}] {pct:3d}%  {lang}  {done}/{total}"
    if extra:
        line += f"  {extra}"
    print("\r" + line.ljust(110), end="", file=sys.stderr, flush=True)


def clear_progress() -> None:
    print("\r" + " " * 110 + "\r", end="", file=sys.stderr, flush=True)


def read_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip("'").strip('"')
        if not (os.environ.get(name) or "").strip():
            os.environ[name] = value


def gemini_env_paths(data_dir: Path | None = None) -> list[Path]:
    paths = [REPO_ROOT / GEMINI_ENV_NAME, Path.cwd() / GEMINI_ENV_NAME]
    if data_dir:
        paths.append(data_dir.parent / GEMINI_ENV_NAME)
        paths.append(data_dir.parent.parent / GEMINI_ENV_NAME)
    seen: set[Path] = set()
    out: list[Path] = []
    for path in paths:
        try:
            resolved = path.resolve()
        except OSError:
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        out.append(path)
    return out


def resolve_gemini_api_key(explicit: str | None = None, data_dir: Path | None = None) -> str | None:
    key = (explicit or "").strip()
    if key:
        return key
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if key:
        return key
    for path in gemini_env_paths(data_dir):
        read_dotenv(path)
        key = (os.environ.get("GEMINI_API_KEY") or "").strip()
        if key:
            return key
    return None


def sanitize_error(msg: str, key: str | None = None) -> str:
    text = str(msg)
    if key:
        text = text.replace(key, "***")
    return re.sub(r"(key=)[^&\s]+", r"\1***", text, flags=re.I)


def load_unique_questions(data_dir: Path | None = None) -> dict[str, dict]:
    root = data_dir or SRC_DATA
    questions: dict[str, dict] = {}
    for path in sorted(root.glob("*.json")):
        if path.name in SKIP_JSON:
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for q in data.get("questions") or []:
            qid = str(q.get("id", ""))
            if qid and qid not in questions:
                questions[qid] = q
    return questions


def translation_path(lang: str, data_dir: Path | None = None) -> Path:
    return (data_dir or SRC_DATA) / f"translations_{lang}.json"


def load_existing(lang: str, data_dir: Path | None = None) -> dict:
    root = data_dir or SRC_DATA
    path = translation_path(lang, root)
    if path.is_file():
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    if lang == "ua":
        legacy = root / "translations_uk.json"
        if legacy.is_file():
            data = json.loads(legacy.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    return {}


def save_translations(lang: str, data: dict, data_dir: Path | None = None) -> None:
    path = translation_path(lang, data_dir)
    tmp = path.with_suffix(path.suffix + ".tmp")
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    last: Exception | None = None
    for i in range(8):
        try:
            tmp.write_text(text, encoding="utf-8")
            tmp.replace(path)
            return
        except OSError as exc:
            last = exc
            time.sleep(0.25 * (i + 1))
    raise last if last else OSError("save failed")


def question_fields(q: dict) -> list[tuple[str, str]]:
    fields = [("q", (q.get("q") or "").strip())]
    if q.get("type") == "specialist":
        for name in ("a", "b", "c"):
            text = (q.get(name) or "").strip()
            if text:
                fields.append((name, text))
    return [(name, text) for name, text in fields if text]


def _tr_words(text: str) -> list[str]:
    return [w for w in re.split(r"\s+", (text or "").strip()) if w]


def _tr_script_stats(text: str) -> tuple[int, int]:
    letters = 0
    cyr = 0
    for ch in text or "":
        if ch.isalpha():
            letters += 1
            o = ord(ch)
            if 0x0400 <= o <= 0x04FF or 0x0500 <= o <= 0x052F:
                cyr += 1
    return letters, cyr


def _tr_paras(text: str) -> list[str]:
    return [p for p in re.split(r"\n\s*\n", (text or "").strip()) if p.strip()]


def _tr_numbered(text: str) -> int:
    return len(re.findall(r"(?m)^\s*(?:[1-9]|[12]\d)[.)]\s+\S", text or ""))


def _tr_sents(text: str) -> int:
    return len(re.findall(r"[.!?…।؟]+", text or ""))


def check_translation_field(src: str, dst: str, lang: str) -> str | None:
    src = (src or "").strip()
    dst = (dst or "").strip()
    if not src:
        return None
    if not dst:
        return "empty"
    src_n = " ".join(_tr_words(src))
    dst_n = " ".join(_tr_words(dst))
    if src_n.lower() == dst_n.lower():
        # A. / B. / 70 km/h stay; Tak./Nie. and other 3+ letter words must change.
        if re.search(r"[^\W\d_]{3,}", src_n):
            return "untranslated"
        return None
    if len(src_n) >= 24 and src_n.lower() in dst_n.lower() and len(dst_n) > len(src_n) + 20:
        return "contains source"
    src_len = len(src_n)
    dst_len = len(dst_n)
    src_w = len(_tr_words(src_n))
    dst_w = len(_tr_words(dst_n))
    if src_len >= 12:
        if dst_len > src_len * 2.4 and dst_len > src_len + 50:
            return "too long"
        if dst_w > src_w * 2.5 and dst_w > src_w + 10:
            return "too many words"
        if src_len > 40 and dst_len * 3 < src_len:
            return "too short"
    if len(_tr_paras(dst)) >= 3 and len(_tr_paras(src)) <= 1 and dst_len > src_len + 40:
        return "extra paragraphs"
    if _tr_numbered(dst) >= 3 and _tr_numbered(src) == 0:
        return "extra list"
    src_s = _tr_sents(src)
    dst_s = _tr_sents(dst)
    if dst_s >= max(4, src_s * 3) and dst_len > src_len + 40:
        return "extra sentences"
    letters, cyr = _tr_script_stats(dst_n)
    if letters > 8:
        frac = cyr / letters
        if lang == "ua" and frac < 0.25:
            return "not Ukrainian"
        if lang in ("en", "de") and frac > 0.25:
            return "wrong script"
    for num in re.findall(r"\d{2,}", src):
        if num not in dst:
            return f"missing number {num}"
    return None


def assert_translation(q: dict, translated: dict, lang: str) -> None:
    for name, src in question_fields(q):
        why = check_translation_field(src, str(translated.get(name) or ""), lang)
        if why:
            raise RuntimeError(f"verify: {name} {why}")


def google_translate_batch(texts: list[str], target: str) -> list[str]:
    if not texts:
        return []
    params = [("client", "gtx"), ("sl", "pl"), ("tl", target), ("dt", "t")]
    for text in texts:
        params.append(("q", text))
    url = "https://translate.googleapis.com/translate_a/single?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 Prawko"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(str(exc)) from exc
    chunks = payload[0] if payload and isinstance(payload[0], list) else []
    joined = "".join(part[0] for part in chunks if part and part[0])
    if len(texts) == 1:
        return [joined or texts[0]]
    raise RuntimeError("batch decode")


def translate_one(text: str, target: str) -> str:
    last: Exception | None = None
    for attempt in range(6):
        try:
            return google_translate_batch([text], target)[0]
        except RuntimeError as exc:
            last = exc
            msg = str(exc)
            if "429" in msg or "Too Many" in msg or "HTTP 5" in msg:
                time.sleep(min(60.0, 2 ** attempt))
                continue
            raise
    raise RuntimeError(str(last) if last else "translate failed")


def gemini_translate_rules(lang: str) -> str:
    label = GEMINI_LANG[lang]
    return (
        f"Translate Polish driving-licence theory exam questions into {label}.\n"
        f"The POLISH lines are the ministry source. After each label (q: a: b: c:) write only the {label} text.\n"
        "Do not copy the Polish source. Repeating Polish sentences is wrong.\n"
        "Keep digits, units (km/h, t, m), and lone option letters (A/B/C) unchanged.\n"
        "Tak/Nie in the source is exam text — translate it.\n"
        "Do not add extra options or explanations. Same meaning, similar length.\n"
        "No commentary, no JSON, no markdown table."
    )


def src_labeled_lines(q: dict) -> str:
    return "\n".join(f"POLISH {name}: {text}" for name, text in question_fields(q))


def gemini_prompt(q: dict, lang: str) -> str:
    label = GEMINI_LANG[lang]
    return (
        gemini_translate_rules(lang)
        + "\n\n"
        + src_labeled_lines(q)
        + f"\n\nReply in {label}:\nq:"
    )


def gemini_batch_prompt(questions: dict, ids: list[str], lang: str) -> str:
    label = GEMINI_LANG[lang]
    blocks = []
    for qid in ids:
        blocks.append(f"id {qid}")
        blocks.append(src_labeled_lines(questions[qid]))
    return (
        gemini_translate_rules(lang)
        + f"\nSeveral questions: before each block write id <number>, then q:/a:/b:/c: in {label}.\n\n"
        + "\n".join(blocks)
    )


def parse_labeled_fields(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    cur: str | None = None
    key_line = re.compile(r"^(?:[-*]\s+)?(q|a|b|c)\s*:\s*(.*)$", re.I)
    for line in (text or "").splitlines():
        found = key_line.match(line.rstrip())
        if found:
            cur = found.group(1).lower()
            out[cur] = (found.group(2) or "").strip()
            continue
        if not cur:
            continue
        extra = line.strip()
        if extra:
            out[cur] = (out.get(cur, "") + " " + extra).strip()
    return {k: v.strip() for k, v in out.items() if v.strip()}


def text_before_labels(text: str) -> str:
    bits: list[str] = []
    key_line = re.compile(r"^(?:[-*]\s+)?(q|a|b|c)\s*:", re.I)
    for line in (text or "").splitlines():
        if key_line.match(line.rstrip()):
            break
        t = line.strip()
        if t:
            bits.append(t)
    return " ".join(bits)


def parse_paragraph_fields(text: str, src: dict[str, str] | None) -> dict[str, str]:
    if not src:
        return {}
    paras = [p.strip() for p in re.split(r"\n\s*\n", text or "") if p.strip()]
    keys = [k for k in ("q", "a", "b", "c") if k in src]
    if len(paras) != len(keys) or not keys:
        return {}
    return dict(zip(keys, paras))


def parse_markdown_fields(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in (text or "").splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        inner = line.strip("|")
        if re.fullmatch(r"[\s:|-]+", inner or ""):
            continue
        cells = [c.strip() for c in inner.split("|")]
        if len(cells) < 2:
            continue
        key, val = cells[0], cells[1]
        if len(cells) >= 3 and cells[1].lower() in ("q", "a", "b", "c"):
            key, val = cells[1], cells[2]
        key = key.strip().lower()
        if key not in ("q", "a", "b", "c") or not val:
            continue
        out[key] = val
    return out


def parse_gemini_reply(text: str, src: dict | None = None) -> dict:
    raw = (text or "").strip()
    if not raw:
        raise RuntimeError("Gemini returned empty q")
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json|markdown|md)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    got = parse_labeled_fields(raw)
    if not (got.get("q") or "").strip():
        pre = text_before_labels(raw)
        if pre:
            got = dict(got)
            got["q"] = pre
    q = (got.get("q") or "").strip()
    if q:
        return {k: v.strip() for k, v in got.items() if (v or "").strip()}
    got = parse_paragraph_fields(raw, src)
    q = (got.get("q") or "").strip()
    if q:
        return got
    got = parse_markdown_fields(raw)
    q = (got.get("q") or "").strip()
    if q:
        return {k: v.strip() for k, v in got.items() if (v or "").strip()}
    if raw.lstrip().startswith("{") or raw.lstrip().startswith("["):
        return parse_gemini_json(raw)
    return {"q": raw}


def parse_gemini_json(text: str) -> dict:
    raw = (text or "").strip()
    if not raw:
        raise RuntimeError("Gemini returned empty q")
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    if not raw.startswith("{") and not raw.startswith("["):
        raise RuntimeError("Gemini returned empty q")
    data = json.loads(raw)
    if isinstance(data, list) and data:
        data = data[0]
    if not isinstance(data, dict):
        raise RuntimeError("Gemini JSON is not an object")
    out: dict[str, str] = {}
    for key in ("q", "a", "b", "c"):
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            out[key] = val.strip()
        elif val is not None and not isinstance(val, (dict, list)):
            s = str(val).strip()
            if s:
                out[key] = s
    return out


def parse_gemini_batch(text: str, ids: list[str]) -> dict[str, dict]:
    raw = (text or "").strip()
    if not raw:
        raise RuntimeError("Gemini returned empty q")
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    if not raw.startswith("{") and not raw.startswith("["):
        found = re.search(r"\{[\s\S]*\}", raw)
        if found:
            raw = found.group(0)
    data = json.loads(raw)
    if isinstance(data, list) and data:
        data = data[0]
    if not isinstance(data, dict):
        raise RuntimeError("Gemini JSON is not an object")
    want = [str(qid) for qid in ids]
    has_id = any(qid in data for qid in want)
    out: dict[str, dict] = {}
    if not has_id and len(want) == 1:
        one = parse_gemini_json(raw)
        if (one.get("q") or "").strip():
            out[want[0]] = one
        return out
    for qid in want:
        inner = data.get(qid)
        if not isinstance(inner, dict):
            continue
        item: dict[str, str] = {}
        for key in ("q", "a", "b", "c"):
            val = inner.get(key)
            if isinstance(val, str) and val.strip():
                item[key] = val.strip()
            elif val is not None and not isinstance(val, (dict, list)):
                s = str(val).strip()
                if s:
                    item[key] = s
        if (item.get("q") or "").strip():
            out[qid] = item
    if not out:
        raise RuntimeError("Gemini returned empty q")
    return out


def gemini_fail_hint(payload: object, text: str) -> str:
    bits: list[str] = []
    if isinstance(payload, dict):
        cands = payload.get("candidates") or []
        if isinstance(cands, dict):
            cands = [cands]
        first = cands[0] if isinstance(cands, list) and cands else None
        if isinstance(first, dict) and first.get("finishReason"):
            bits.append("finishReason=" + str(first.get("finishReason")))
        fb = payload.get("promptFeedback") or {}
        if isinstance(fb, dict) and fb.get("blockReason"):
            bits.append("block=" + str(fb.get("blockReason")))
    snip = re.sub(r"\s+", " ", (text or "").strip())
    if len(snip) > 120:
        snip = snip[:117] + "..."
    if snip:
        bits.append("text=" + snip)
    return (" (" + "; ".join(bits) + ")") if bits else ""


def mark_gemini_dead(model: str) -> None:
    if model:
        _gemini_dead.add(model)


def models_to_try(api_key: str) -> list[str]:
    all_ids = [m for m in load_gemini_model_ids(api_key) if m not in _gemini_dead]
    if _gemini_model and _gemini_model not in _gemini_dead:
        rest = [m for m in all_ids if m != _gemini_model]
        return [_gemini_model] + rest
    return all_ids


def gemini_response_text(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    cands = payload.get("candidates") or []
    if isinstance(cands, dict):
        cands = [cands]
    if not isinstance(cands, list) or not cands:
        return ""
    first = cands[0]
    if isinstance(first, str):
        return first
    if not isinstance(first, dict):
        return ""
    content = first.get("content") or {}
    if isinstance(content, str):
        return content
    if not isinstance(content, dict):
        return ""
    parts = content.get("parts") or []
    if isinstance(parts, str):
        return parts
    if isinstance(parts, dict):
        parts = [parts]
    if not isinstance(parts, list):
        return ""
    chunks: list[str] = []
    for part in parts:
        if isinstance(part, str):
            chunks.append(part)
        elif isinstance(part, dict):
            chunks.append(str(part.get("text") or ""))
    return "".join(chunks)


def gemini_model_id(name: str) -> str:
    return (name or "").split("/")[-1]


def is_text_flash_model(model_id: str, methods: list | None) -> bool:
    if "generateContent" not in (methods or []):
        return False
    low = model_id.lower()
    if "flash" not in low:
        return False
    return not any(part in low for part in GEMINI_SKIP_SUB)


def gemini_version_key(model_id: str) -> int:
    found = re.search(r"(\d+)\.(\d+)", model_id or "")
    if not found:
        return 0
    return int(found.group(1)) * 1000 + int(found.group(2))


def rank_gemini_model(model_id: str) -> tuple:
    low = model_id.lower()
    lite = 0 if "lite" in low else 1
    return (lite, -gemini_version_key(low), low)


def load_gemini_model_ids(api_key: str) -> list[str]:
    global _gemini_models_ranked
    if _gemini_models_ranked:
        return _gemini_models_ranked
    found: list[str] = []
    token: str | None = None
    try:
        for _page in range(20):
            params = {"pageSize": "100"}
            if token:
                params["pageToken"] = token
            url = GEMINI_MODELS_URL + "?" + urllib.parse.urlencode(params)
            req = urllib.request.Request(
                url,
                headers={
                    "x-goog-api-key": api_key,
                    "User-Agent": "Mozilla/5.0 Prawko",
                },
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=GEMINI_HTTP_TIMEOUT) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            for model in payload.get("models") or []:
                if not isinstance(model, dict):
                    continue
                mid = gemini_model_id(str(model.get("name") or ""))
                methods = model.get("supportedGenerationMethods") or []
                if is_text_flash_model(mid, methods):
                    found.append(mid)
            token = payload.get("nextPageToken") or None
            if not token:
                break
    except urllib.error.HTTPError as exc:
        msg = sanitize_error(f"HTTP {exc.code}", api_key)
        if exc.code in (401, 403) or "API_KEY" in msg:
            raise RuntimeError(msg) from exc
        print(f"  Gemini model list failed: {msg}")
        found = []
    except (urllib.error.URLError, TimeoutError, socket.timeout, json.JSONDecodeError, RuntimeError) as exc:
        print(f"  Gemini model list failed: {sanitize_error(str(exc), api_key)}")
        found = []
    ranked = sorted(dict.fromkeys(found), key=rank_gemini_model)
    if not ranked:
        ranked = list(GEMINI_MODELS)
    _gemini_models_ranked = ranked
    print("Gemini models: " + ", ".join(ranked))
    return _gemini_models_ranked


def gemini_translate_ids(
    questions: dict,
    ids: list[str],
    lang: str,
    api_key: str,
    verify: bool = True,
) -> dict[str, dict]:
    global _gemini_model
    models = models_to_try(api_key)
    if not models:
        raise RuntimeError("Gemini models 404")
    if len(ids) == 1:
        prompt = gemini_prompt(questions[ids[0]], lang)
    else:
        prompt = gemini_batch_prompt(questions, ids, lang)
    body = json.dumps(
        {"contents": [{"parts": [{"text": prompt}]}]},
        ensure_ascii=False,
    ).encode("utf-8")
    last: Exception | None = None
    for mi, model in enumerate(models, 1):
        url = GEMINI_URL_TMPL.format(model=model)
        for attempt in range(6):
            req = urllib.request.Request(
                url,
                data=body,
                headers={
                    "Content-Type": "application/json; charset=utf-8",
                    "x-goog-api-key": api_key,
                    "User-Agent": "Mozilla/5.0 Prawko",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=GEMINI_HTTP_TIMEOUT) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                text = gemini_response_text(payload)
                try:
                    if len(ids) == 1:
                        src = {name: t for name, t in question_fields(questions[ids[0]])}
                        parsed = parse_gemini_reply(text, src)
                        if not (parsed.get("q") or "").strip():
                            raise RuntimeError("Gemini returned empty q")
                        got = {ids[0]: parsed}
                    else:
                        got = parse_gemini_batch(text, ids)
                except (json.JSONDecodeError, RuntimeError) as exc:
                    hint = gemini_fail_hint(payload, text)
                    raise RuntimeError("Gemini returned empty q" + hint) from exc
                if verify:
                    checked: dict[str, dict] = {}
                    for qid, item in got.items():
                        try:
                            assert_translation(questions[qid], item, lang)
                        except RuntimeError:
                            if len(ids) == 1:
                                raise
                            continue
                        checked[qid] = item
                    got = checked
                if not got:
                    raise RuntimeError("Gemini returned empty q" + gemini_fail_hint(payload, text))
                if _gemini_model != model:
                    _gemini_model = model
                    print(f"Gemini model: {model}")
                return got
            except urllib.error.HTTPError as exc:
                last = RuntimeError(f"HTTP {exc.code}")
                body_err = ""
                try:
                    body_err = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
                msg = sanitize_error(f"HTTP {exc.code} {body_err}", api_key)
                if exc.code == 404:
                    mark_gemini_dead(model)
                    print(f"  Gemini model {model}: 404, trying next")
                    break
                if exc.code in (429, 500, 502, 503, 504) or "RESOURCE_EXHAUSTED" in msg:
                    time.sleep(min(60.0, 2 ** attempt))
                    continue
                raise RuntimeError(msg) from exc
            except (urllib.error.URLError, TimeoutError, socket.timeout, json.JSONDecodeError, RuntimeError) as exc:
                last = exc
                msg = sanitize_error(str(exc), api_key)
                if "404" in msg:
                    mark_gemini_dead(model)
                    print(f"  Gemini model {model}: 404, trying next")
                    break
                timed_out = isinstance(exc, (TimeoutError, socket.timeout)) or "timed out" in msg.lower() or "timeout" in msg.lower()
                if isinstance(exc, urllib.error.URLError) and isinstance(getattr(exc, "reason", None), (TimeoutError, socket.timeout)):
                    timed_out = True
                if timed_out:
                    print(f"  Gemini model {model}: timeout, trying next")
                    break
                reason = getattr(exc, "reason", None)
                conn_closed = (
                    isinstance(exc, (ConnectionError, ConnectionResetError, BrokenPipeError))
                    or isinstance(reason, (ConnectionError, ConnectionResetError, BrokenPipeError))
                    or "przerwane" in msg.lower()
                    or ("connection" in msg.lower() and any(tok in msg.lower() for tok in ("reset", "aborted", "closed", "refused")))
                )
                if conn_closed:
                    if attempt < 1:
                        print(f"  Gemini model {model}: connection closed, retry")
                        time.sleep(0.4)
                        continue
                    print(f"  Gemini model {model}: connection closed, trying next")
                    break
                if isinstance(exc, json.JSONDecodeError) or "empty q" in msg or "not an object" in msg:
                    print(f"  Gemini model {model}: bad response, trying next")
                    break
                if "verify:" in msg:
                    print(f"  Gemini model {model}: {msg}, skip question")
                    raise RuntimeError(msg) from exc
                if "429" in msg or "Too Many" in msg or "HTTP 5" in msg or "RESOURCE_EXHAUSTED" in msg:
                    time.sleep(min(60.0, 2 ** attempt))
                    continue
                raise RuntimeError(msg) from exc
    raise RuntimeError(sanitize_error(str(last) if last else "Gemini models 404", api_key))


def gemini_translate_question(q: dict, lang: str, api_key: str, verify: bool = True) -> dict:
    qid = str(q.get("id") or "q")
    got = gemini_translate_ids({qid: q}, [qid], lang, api_key, verify)
    item = got.get(qid)
    if not item or not (item.get("q") or "").strip():
        raise RuntimeError("Gemini returned empty q")
    return item


def apply_fields(existing: dict, qid: str, fields: list[tuple[str, str]], translated: dict) -> None:
    if qid not in existing:
        existing[qid] = {}
    dest = existing[qid]
    for name, _src in fields:
        val = translated.get(name)
        if isinstance(val, str) and val.strip():
            dest[name] = val.strip()


def fill_lang(
    lang: str,
    questions: dict[str, dict],
    data_dir: Path | None = None,
    gemini_api_key: str | None = None,
    skip_verify_ai: bool = False,
) -> None:
    existing = load_existing(lang, data_dir)
    target = GOOGLE_LANG[lang]
    missing: list[str] = []
    for qid, q in questions.items():
        if qid in existing and existing[qid].get("q"):
            continue
        if question_fields(q):
            missing.append(qid)
    engine = "Gemini" if gemini_api_key else "Google Translate"
    print(
        f"{lang}: {len(questions)} unique, {len(existing)} already filled, "
        f"{len(missing)} questions to translate ({engine})"
    )
    if not missing:
        save_translations(lang, existing, data_dir)
        return

    done = 0
    try:
        pos = 0
        while pos < len(missing):
            take = BATCH_SIZE if gemini_api_key else 1
            chunk = missing[pos : pos + take]
            pos += len(chunk)
            write_progress(done, len(missing), lang, "Gemini" if gemini_api_key else "Google")
            if gemini_api_key:
                got: dict[str, dict] = {}
                batch_ok = False
                batch_err: str | None = None
                try:
                    got = gemini_translate_ids(
                        questions, chunk, lang, gemini_api_key, verify=not skip_verify_ai
                    )
                    batch_ok = True
                except RuntimeError as exc:
                    msg = sanitize_error(str(exc), gemini_api_key)
                    hard = any(tok in msg for tok in ("401", "403", "API_KEY", "PERMISSION_DENIED", "UNAUTHENTICATED"))
                    if hard:
                        print(f"  Gemini fail {','.join(chunk)}: {msg}")
                        save_translations(lang, existing, data_dir)
                        die("Gemini failed; progress saved. Re-run without a key to use Google Translate.")
                    batch_err = msg
                for qid in chunk:
                    q = questions[qid]
                    fields = question_fields(q)
                    item = got.get(qid) if batch_ok else None
                    if item and (item.get("q") or "").strip():
                        apply_fields(existing, qid, fields, item)
                        continue
                    if not batch_ok:
                        print(f"  skip {qid}: {batch_err or 'batch failed'}")
                        continue
                    print(f"  skip {qid}: Gemini returned empty q")
            else:
                for qid in chunk:
                    q = questions[qid]
                    fields = question_fields(q)
                    if qid not in existing:
                        existing[qid] = {}
                    for name, text in fields:
                        if existing[qid].get(name):
                            continue
                        try:
                            out = translate_one(text, target)
                            if not skip_verify_ai:
                                why = check_translation_field(text, out, lang)
                                if why:
                                    raise RuntimeError(f"verify: {why}")
                            existing[qid][name] = out
                        except RuntimeError as exc:
                            print(f"  skip {qid}.{name}: {exc}")
            done += len(chunk)
            write_progress(done, len(missing), lang, "Gemini" if gemini_api_key else "Google")
            if done % SAVE_EVERY == 0:
                save_translations(lang, existing, data_dir)
            time.sleep(GEMINI_DELAY if gemini_api_key else DELAY)
        save_translations(lang, existing, data_dir)
        print(f"Wrote {translation_path(lang, data_dir)} ({len(existing)} questions).")
    finally:
        clear_progress()


def fill_missing(
    data_dir: Path | str | None = None,
    langs: list[str] | None = None,
    gemini_api_key: str | None = None,
    skip_verify_ai: bool = False,
) -> None:
    global _gemini_model, _gemini_models_ranked, _gemini_dead
    root = Path(data_dir) if data_dir else SRC_DATA
    if not root.is_dir():
        die(f"Missing {root}")
    questions = load_unique_questions(root)
    if not questions:
        die(f"No category JSON in {root}.")
    _gemini_model = None
    _gemini_models_ranked = None
    _gemini_dead = set()
    key = resolve_gemini_api_key(gemini_api_key, root)
    if key:
        load_gemini_model_ids(key)
    for lang in langs or list(GOOGLE_LANG):
        fill_lang(lang, questions, root, key, skip_verify_ai)


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Fill missing question translations (Gemini if a key is passed, else Google Translate)"
    )
    ap.add_argument("--lang", action="append", choices=sorted(GOOGLE_LANG), help="Repeatable. Default: all with gaps.")
    ap.add_argument("--data-dir", dest="data_dir")
    ap.add_argument(
        "--gemini-api-key",
        dest="gemini_api_key",
        help="Google AI Studio key for this run (overrides .geminienv). Omit to use .geminienv or Google Translate.",
    )
    ap.add_argument(
        "--skip-verify-ai",
        action="store_true",
        help="Do not reject translations that fail length/script/structure checks.",
    )
    args = ap.parse_args()
    fill_missing(args.data_dir, args.lang, args.gemini_api_key, args.skip_verify_ai)


if __name__ == "__main__":
    main()
