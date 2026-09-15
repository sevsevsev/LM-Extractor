# Batch resilience v1: checkpoint/resume, pipelined concurrency, progress visibility

Status: Implemented (2026-09-15)

## Problem

Walking through what actually happens uploading ~80 documents surfaced three real gaps in the
*processing* phase (the triage/review/export UI already scales fine — see
`session-navigator-v1.md` / `ltr-column-review-v1.md`):

1. Zero persistence — `files` was plain in-memory React state. Closing the tab, refreshing, or a
   laptop sleep mid-batch lost everything: queued, in-progress, and completed-but-unexported files
   alike, for what can be a 30–50+ minute unattended operation.
2. Strictly one file at a time — the next file's conversion didn't start until the current file's
   *entire* pipeline, including the Gemini round-trip, finished. That network wait is most of the
   wall-clock time, and was pure dead time for every other queued file.
3. No progress visibility beyond scattered per-file badges in the session list.

## Changes

### 1. Session persistence (`services/sessionStore.ts`)

Thin native `indexedDB` wrapper — no new npm dependency, per the project's stated
zero-dependency-preference convention; IndexedDB natively stores `File`/`Blob` values via
structured clone, and `LogicModel` + the rest of `ProcessingFile` are plain JSON-safe values, so
this is a direct fit. One object store (`files`), one record per `ProcessingFile` keyed by `id`.

`PersistedFileRecord` deliberately excludes `sourcePreviewImages` (large base64 JPEGs — already
session-only) and `progressMsg` (transient). `App.tsx`'s `toPersistedRecord()` also normalizes
`'converting'`/`'extracting'` status to `'pending'` before writing — mid-network-call state can't
be safely resumed, and reverting to pending is exactly the shape the queue already expects for
incoming work, so no special-case resume logic is needed.

On mount, `App.tsx` checks the store before rendering the normal app: if it has records, a
full-screen prompt offers "Resume session" (restores `files` from the store) or "Start fresh"
(clears the store). Checkpoint writes are reactive and debounced (`PERSIST_DEBOUNCE_MS = 1200`):
one `useEffect` watches `files`, skips anything mid-flight, and writes any file whose
checkpoint-relevant fields changed since the last write (content-hash compared, `file` excluded
from the hash since it never changes after creation). `removeFile` deletes the record immediately
rather than waiting on the debounce.

Resumed files carry no cached source previews. `ensurePreviewImages()` regenerates them lazily —
re-running the same conversion function against the stored `File` — only when that file's source
pane is actually opened, not eagerly for every resumed file on load.

### 2. Pipelined (bounded) concurrency

Full N-way parallelism (converting *and* extracting several files at once) would have competed for
the same CPU/memory resources that make conversion (canvas rendering, up to 4.5x scale) the heavy
part of this pipeline — for comparatively little benefit, since the network wait on Gemini is what
actually dominates wall-clock time.

So conversion stays strictly serial (`convertingRef`, one in-flight at a time, same role the old
`processingRef` played), but a file's extract call no longer blocks the next file's conversion.
Once conversion finishes, the bundle is stashed (`pendingBundles` ref) and the file moves to
`'extracting'`; a second scan on the same effect dispatches extract calls for any `'extracting'`
file not yet dispatched (`dispatchedExtractIds` ref, dedupes across effect re-runs), bounded by
`MAX_CONCURRENT_EXTRACTS = 2`. Existing per-call retry/backoff (`services/geminiService.ts`,
`server/geminiLogicModel.ts`) absorbs any rate-limit hiccups the added concurrency surfaces — no
new rate-limiting logic needed. Both scans are cheap no-ops when there's nothing eligible, so
running them on every `files` change (already the effect's natural trigger) is fine.

Verified live: uploading 3 files showed 2 concurrently "running" pre-reload, and captured
`/api/gemini/extract` request timing showed genuine overlap between requests — with every result
still landing on the correct file (no cross-contamination from the added concurrency).

### 3. Progress visibility

`sessionProgressFraction()` (`shared/sessionQueue.ts`) reuses `countSessionFiles`'s existing counts
— (ready + needsAttention) / total — rendered as a small fill bar next to the existing
`formatSessionStatus` line in the header. No new counting logic.

## Verified

Live Playwright pass: uploaded 3 real documents, reloaded the page ~3s into processing (files
mid-conversion/mid-extraction), confirmed the resume prompt showed the correct file count,
resumed, confirmed the interrupted files reprocessed from scratch and all 3 reached "Ready to
export" with correct content, confirmed overlapping extract-request timing, and confirmed source
previews regenerated on demand when opening a resumed file. Typecheck, all 86 tests, and build
pass.

## Out of scope (v1)

- ETA estimate from rolling per-file timing (lowest-priority piece of the original ask, cut for
  now — the plain progress bar covers the "how far along is this" question).
- A manual "Clear saved session" control outside the initial resume-vs-fresh choice (mid-session
  clearing raises questions — stop future checkpointing too, or just wipe current state — that
  didn't seem worth the scope for v1; the resume prompt's "Start fresh" covers the common case).
- Tuning `MAX_CONCURRENT_EXTRACTS` from real multi-day usage data.
