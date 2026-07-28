# Recorder plan - integration map (Task 0)

Recorded 2026-07-28 against master @ 59636a3. The implementation plan was written
without repo access; several of its defaults are wrong. This file is the
authority - where it disagrees with the plan, THIS WINS.

## Facts

| # | Plan assumed | Actual | Affects |
|---|---|---|---|
| 1 | bot dispatch site to gate | `src/lib/jobs/stages/capture.ts` dispatches via `providers.capture`; meetings are routed by `source_type`. A local meeting simply never enqueues a `capture` job. | T12 |
| 2 | `meetings` table + `capture_mode` column | `meetings` exists. Creation goes through `createAndEnqueueCapture(store, NewMeeting)` in `src/lib/meetings/create.ts`, which ALWAYS enqueues capture. Local mode must call `store.createMeeting()` directly and skip that. | T8, T9 |
| 3 | `transcripts(meeting_id, content, source)` | `store.createTranscript({meeting_id, raw_json, language, diarized})` + `store.createUtterances()`. Do not call these directly - use `persistTranscription(store, meeting, result, {diarized})` from `src/lib/jobs/persist-transcript.ts`, the shared path the transcribe stage and caption fast lane both use. | T9, T10 |
| 4 | enqueue a `transcribe` job for the offline path | Correct. `store.enqueueJob(meetingId, 'transcribe')`; the tick loop claims it. Job types + retry semantics in `src/lib/jobs/runner.ts` (3 attempts, `JobNotReadyError` requeues without consuming one). | T9, T10 |
| 5 | `boards` table for per-board defaults | No such table. Bodies are a free-text `body_name` on the meeting, plus `schedules`. **Per-board default capture mode is dropped from v1.** | T8, T12 |
| 6 | meeting create form | `src/components/dashboard/NewMeetingForm.tsx` (tabbed: zoom / upload / stream). | T12 |
| 7 | Supabase project ref | `qohvolrzcijqcfapryee`, but irrelevant: the store is swappable (`MemoryStore` file-backed under `.data/` vs `SupabaseStore`) behind `DataStore`. Never touch Supabase directly; go through `getStore()`. | T8, T9 |
| 8 | invent `x-recorder-key` header | House pattern exists: `isAuthorized(provided, secret)` in `src/lib/auth.ts` (constant-time, accepts raw or `Bearer`). The Recall webhook refuses to run in non-mock mode without its secret. **Mirror this exactly** with a new `recorderSecret` in `src/lib/config.ts` (`RECORDER_SECRET`). | T9 |
| 9 | FileStorage put + MAX_UPLOAD_MB | Storage is swappable too (`.data/storage/` local vs Supabase bucket `meeting-audio`). `maxUploadMb` in config, default 200. Audio is served through `/api/audio/[...path]`. | T9 |

## The big one: live transcript already exists

The app ALREADY ships a public live-transcript feature, built for the bot:

- `store.appendLiveUtterance(meetingId, {speaker_label, text, ts_seconds})` - the write path
- `GET /api/meetings/[id]/live?since=<cursor>` - public poll endpoint, tri-state `waiting|live|ended`
- `src/components/meeting/LiveTranscript.tsx` - the public page component
- `src/lib/live/catchup.ts` - a rolling LLM "here's what you missed" recap, self-throttling (~120 s)
- `meetings.live_enabled`, `live_started_at`, `live_ended_at`, `live_summary*`

Currently the ONLY caller of `appendLiveUtterance` is the Recall webhook
(`src/app/api/webhooks/recall/route.ts:148`) on a `transcript.data` event.

### Consequences for the plan

1. **The recorder must POST each final turn to the server as it arrives**, not
   batch them until Stop. The original plan rendered turns only inside the
   recorder window, which would leave the PUBLIC live page empty during a public
   meeting - the exact audience that matters. New endpoint: `POST /api/recorder/live`.
2. **The recorder does not need to build a transcript UI.** It shows a local
   tail for the operator; the real public experience is the existing live page,
   which now works for local recordings for free, catch-up recap included.
3. **`capture_mode` is dropped.** The repo already models this axis as
   `source_type`. Add `"local"` to `SourceType` instead of a parallel column.
   `live_enabled` gains a third legitimate source (it is currently documented
   "bot sources only" and force-disabled for `stream`).

## Revised endpoint set

| Endpoint | Purpose |
|---|---|
| `POST /api/recorder/session` | create meeting (`source_type: 'local'`, `live_enabled: true`), return `{meetingId, storagePath}` |
| `POST /api/recorder/token` | mint a short-lived AssemblyAI streaming token |
| `POST /api/recorder/live` | append ONE final turn -> `appendLiveUtterance` (the new hot path) |
| `POST /api/recorder/upload` | store the WAV via the storage layer |
| `POST /api/recorder/finalize` | persist full transcript + enqueue `summarize`, or enqueue `transcribe` for the offline path; stamp `live_ended_at` |

All five guarded by `isAuthorized(token, config.recorderSecret)`.

## Also noted

- Branch `feat/live-transcription` exists on origin and is already merged into
  master's behavior (the live feature is present at 59636a3). Not used here.
- `DECISIONS.md` #18: tick/webhook endpoints are unauthenticated by default in
  mock mode. The recorder routes follow the same "open in mock, required in
  real" rule so the keyless demo still works.
