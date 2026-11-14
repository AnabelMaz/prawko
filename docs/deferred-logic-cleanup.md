# Deferred: logic cleanup (not micro-perf)

Parked after exam→learn (`lockCurrentToLearn`) and a pass over `src/js`.
**Do not** start this as a drive-by refactor. Pick one item, keep Playwright scoped, patch localhost after `src/`.

Context: a proposed `learnSaved` flag + full scored sweep in `finishExam` was rejected; the lean path (lock current item on Dalej / finish only) shipped. Question was whether the rest of the app is similarly inflated — mostly no.

Related chat / analysis: Cursor agent transcript around 2026-11-14; explore pass [Analyze JS logic bloat](764f28b5-65b0-4eb3-b018-99b9dc739a0c).

## Verdict

Mostly pragmatic domain complexity (WORD exam phases, offline packs/files, scale settle, MSE early-play). Not systematically over-engineered. Clean pointwise when touching that area.

## Worth cleaning (when ready)

### 1. Profile export bit-packing → plain JSON

- **Where:** `src/js/stats.js` — `packLearnForExport` / `unpackLearnFromImport` (~351–574), `packExamHistoryForExport` / `unpackExamHistoryFromImport` (~576–723), helpers `codeFromEntry`, `entryFromCode`, `writeBits`, `readBits`, …
- **Why inflated:** Bytes/base64 save little vs real JSON for ≤50 exams and learn already stored as objects; loses exact wrong answer (`LEARN_WRONG_MARK = '!'`); ties export to current question bank order via `fetchCategory`.
- **Leaner:** Export/import the same JSON as `profileGet` (`prawko_learn` / `prawko_stats`). Update profile snapshot / import tests accordingly.
- **Risk:** Breaks old packed snapshots already exported — need format version or dual unpack.

### 2. Canonical offline media cache keys

- **Where:** `src/js/offline.js` — `addMediaCacheKeys`, `urlIsCached`, `idbKeyCandidates`, `idbGetMediaBlob`, `matchCachedMediaResponse`; overlap in `src/js/media-feed.js`
- **Why suboptimal:** Fan-out of encoded/raw/lower/tail URL variants; miss path can scan many IDB keys. Duplicated offline ↔ media-feed.
- **Leaner:** One canonical key on write (e.g. lower `vid/name.mp4`); one-shot migrate old keys; read only canonical.
- **Risk:** Offline “already downloaded” false negatives until migration; test packs + files paths.

## Nice-to-have (low priority)

- **`classifyEntry(entry, q) → { status, hard }`** in `stats.js` — `hardFromEntry` / breakdown / unique counts call aging+status twice today.
- **Exam counters** in `exam.js` `updateExamChrome` / `showQuestion` — several `filter`s over ~32 items; optional precomputed practice/scored offsets.
- **Drop array→object learn migration** in `saveLearnAnswer` / summary helpers once legacy formats are gone (migrate-on-load once, then object-only).
- **Dedupe shuffle** — `exam.js` `shuffle` vs `learn.js` `shuffleInPlace`.

## Leave alone

| Area | Why |
|------|-----|
| `exam.js` phases, `locked`, next-guard, practice handoff | Real state machine, not duplicate flags |
| `lockCurrentToLearn` | Already lean |
| `learn.js` seqList + randomList + draw bands + `sessionAnswers` | Product rules; answer does not rebuild queue |
| `scale.js` pin/settle/hold | Anti-flash; CSS “simplify” tends to regress |
| `media-feed.js` MP4/MSE remux | Feature cost, not bloat |
| `offline.js` packs vs files + resume | Required by `local.json` / CDN vs disk |
| `profiles.js` legacy migrate | One-shot |
| O(n) over category banks | Hundreds–thousands; localStorage fine |

## How to resume in Cursor

1. Checkout this branch: `git fetch && git checkout notes/logic-cleanup`
2. Open this file; optionally re-read `stats.js` export section and offline key helpers.
3. Implement **one** bullet per PR; do not mix with unrelated UI.
4. After merge to `main`, delete this branch or mark items done here.

Branch `notes/logic-cleanup` is documentation-only so pushes do not run CI (`deploy.yml` is `push` to `main` only).
