# Recorder - what is verified, and what is not

Recorded 2026-07-28 on COL-LAP1ANE. Honest ledger: the open-engine rule is that
"done" needs a receipt, so anything without one is listed as NOT verified.

## Verified

| # | Check | Receipt |
|---|---|---|
| 1 | Recorder unit tests | 34 passed (5 files): WAV writer, downsampler, AssemblyAI client, backend client, session machine |
| 2 | App test suite, no regressions | 480 passed (67 files), up from 468. `live-transcription.test.ts` flakes on Windows in the parallel run (known temp-dir race, documented pre-existing); passes on re-run |
| 3 | Recorder route tests | 12 passed, incl. every capture-gate case |
| 4 | Typecheck + lint | `tsc --noEmit` clean; eslint 0 errors (1 pre-existing warning in topic-synthesis.test.ts) |
| 5 | Recorder builds | `npm run build` clean; dist layout correct (CJS main, ESM renderer, static copied) |
| 6 | App launches | Electron runs 12s+ with no stdout/stderr output, window created, icon and content protection applied |
| 7 | **Session -> public live page** | Over HTTP in mock mode: created meeting, minted token, posted 3 turns, `GET /api/meetings/<id>/live` returned `phase=live` with all 3 utterances and speaker labels, **no auth required for the public read** |
| 8 | **Upload -> finalize -> summary** | Uploaded WAV (4444 bytes), finalized live path (3 utterances), ticked the queue: summarize -> notify -> `status=complete`, transcript persisted, `duration_seconds=9`, `live_ended_at` set, live page flipped to `phase=ended` |
| 9 | Capture gate rejects | Bot meeting -> 403; local-but-not-public -> 403; non-local live append -> 403 and zero utterances written; unknown meeting -> 404 |
| 10 | Auth | Wrong secret -> 401, correct secret -> 200 |
| 11 | No stray capture job | A recorder session enqueues no `capture` job (that is how a bot gets dispatched) |

## NOT verified

| # | Gap | Why | What it needs |
|---|---|---|---|
| A | **Live AssemblyAI streaming** | No `ASSEMBLYAI_API_KEY` on this machine (keys live in Railway). Every streaming test used a fake WebSocket; the v3 URL params and Turn parsing are from current docs, not a live socket | A real key, then a 60s speech test |
| B | **Summary quality** | Mock mode returns a canned fixture, so check 8's summary describes a different meeting than the turns supplied. The *wiring* is proven, the *content* is not | A real `ANTHROPIC_API_KEY` run |
| C | **System-audio loopback** | Requires real audio playing and a human to look at the result | Manual: play audio, record, listen back |
| D | **Mic / AV line-in** | Requires physical hardware | Manual: plug in, record, listen back |
| E | **Screen-share invisibility** | Cannot be checked headlessly - the whole point is that it is absent from a capture | Manual: share the screen in a call, confirm the window is missing from what others see |
| F | **Mid-meeting network drop** | Buffering and reconnect are unit-tested against a fake socket, not a real one | Manual: pull the network during a live recording |
| G | **Deploy** | Not deployed. `RECORDER_SECRET` is not set in Railway, and migration 0015 is not applied to prod | `supabase db push`, set the secret, `railway up` |

## The manual matrix (still to run)

| # | Scenario | Source | Expected |
|---|---|---|---|
| 1 | Real Zoom/Teams call | System audio | Live turns for all speakers; clean WAV; summary lands |
| 2 | Chamber mic or line-in | Input device | Live turns; clean WAV; summary lands |
| 3 | Hybrid | System audio | Remote and in-room speakers both transcribed |
| 4 | Network drop mid-meeting | Either | No audio lost; reconnects or the batch path completes |
| 5 | Offline from start | Either | Local-only, then "Upload recording" completes via the transcribe job |
| 6 | Screen share while recording | Any | Recorder window absent from what participants see |
| 7 | Keyless demo | Mock | Full UI flow, canned transcript, nothing uploaded |

## Deploy checklist

1. `supabase db push` (migration `0015_local_capture.sql` widens the
   `meetings.source_type` check constraint to allow `'local'`)
2. Set `RECORDER_SECRET` in the Railway service env - **without it the recorder
   routes return 503 in non-mock mode, by design**
3. Confirm `ASSEMBLYAI_API_KEY` has real-time streaming enabled (the batch API
   the app already uses is a separate entitlement)
4. `railway up --service civicscribe --ci` from master, `numReplicas` stays 1
5. Write `recorder/src/renderer/recorder-config.json` on the operator's machine
   with the prod URL and that secret
