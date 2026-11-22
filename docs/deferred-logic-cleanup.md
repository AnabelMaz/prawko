# Deferred: logic cleanup (not micro-perf)

Parked after exam→learn (`lockCurrentToLearn`) and a pass over `src/js`.
**Do not** start this as a drive-by refactor. Pick one item, keep Playwright scoped, patch localhost after `src/`.

Context: a proposed `learnSaved` flag + full scored sweep in `finishExam` was rejected; the lean path (lock current item on Dalej / finish only) shipped. Question was whether the rest of the app is similarly inflated — mostly no.

Related chat / analysis: Cursor agent transcript around 2026-11-14; explore pass [Analyze JS logic bloat](764f28b5-65b0-4eb3-b018-99b9dc739a0c).

## Verdict

Mostly pragmatic domain complexity (WORD exam phases, offline packs/files, scale settle, MSE early-play). Not systematically over-engineered. Clean pointwise when touching that area.

## Done

### 1. Learn export packing — no chosen letter (2026-11-22)

- **Was:** “plain JSON instead of packing” — rejected (keep small snapshots).
- **Done instead:** Durable learn stores only `{ streak, misses, answeredAt }`; session Map keeps the letter for UI. Pack/unpack no longer invents `'!'` / `question.correct`. Wire format unchanged (1 byte/question). Exam PXH2 unchanged.
- Shipped on `main` (learn storage + packer).

### 2. Canonical offline media cache keys (2026-11-22)

- **Done:** One logical key `/vid|img/<file>` (lowercase). Cache Storage writes `origin + tail`; IDB uses the same tail. Coverage and reads use only that key.
- **Migration:** Lazy `ensureCanonicalOfflineKeys()` on first offline helper call; rewrites old CDN/`media/` keys; marker `localStorage prawko_offline_key_schema = '1'` only after success (no Cache bucket rename).
- Touches `offline.js`, `media-feed.js`, `sw.js`. Shipped on `main` (canonical offline keys).

### 3. `classifyEntry` + learn array→object on load (2026-11-22)

- **Done:** `classifyEntry` runs aging once and returns `{ status, hard }`; breakdown / unique chips use it; `statusFromEntry` / `hardFromEntry` stay thin wrappers.
- **Done:** `loadLearnData` rewrites legacy per-category id arrays to `{ id: null }` objects and persists; hot paths assume objects (defensive `Array.isArray` still returns empty).
- Shipped on `main` (`stats.js` + learn-data-cache test).

## Worth cleaning (when ready)

_(none)_

## Nice-to-have (low priority)

_(none left)_

## Won’t do

| Item | Why |
|------|-----|
| Prefetch exam counters in `updateExamChrome` | ~32 questions; several `filter`s are cheap; extra state for no UX gain |
| Dedupe `exam.js` `shuffle` vs `learn.js` `shuffleInPlace` | Shared code would only be Fisher–Yates; exam picks by point recipe, learn bands by answer date — different product rules |

## Leave alone

| Area | Why |
|------|-----|
| `exam.js` phases, `locked`, next-guard, practice handoff | Real state machine, not duplicate flags |
| `lockCurrentToLearn` | Already lean |
| `learn.js` seqList + randomList + draw bands + `sessionAnswers` | Product rules; letter only in session |
| Exam history PXH2 (`given` + `ok` + bank index) | Review needs letter; `ok` for tombstone/catalogue change |
| Local JSON vs packed file | Canonical local; pack only at export/import boundary |
| `scale.js` pin/settle/hold | Anti-flash; CSS “simplify” tends to regress |
| `media-feed.js` MP4/MSE remux | Feature cost, not bloat |
| `offline.js` packs vs files + resume | Required by `local.json` / CDN vs disk |
| `profiles.js` legacy migrate | One-shot |
| O(n) over category banks | Hundreds–thousands; localStorage fine |

## How to resume in Cursor

1. Checkout this branch: `git fetch && git checkout notes/logic-cleanup`
2. Open this file; pick a nice-to-have if still useful.
3. Implement **one** bullet per PR; do not mix with unrelated UI.
4. After merge to `main`, mark items done here or delete this branch.

Branch `notes/logic-cleanup` is documentation-only so pushes do not run CI (`deploy.yml` is `push` to `main` only).
