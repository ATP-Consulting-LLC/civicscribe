# CivicScribe Dual-Mode Capture - Design Spec

Date: 2026-07-24
Status: Approved by Amel (conversation, 2026-07-24)
Repo: github.com/quantunite/civicscribe - Next.js app, LIVE in prod on Railway
(civicscribe-production.up.railway.app), Supabase DB project qohvolrzcijqcfapryee.
Local clone historically at Projects\personal\meeting-recorder on the personal
machine; not present on COL-LAP1ANE. Deploys are MANUAL via `railway up` from
master; the single container runs web + an in-process jobs tick loop
(numReplicas must stay 1).

## Problem

CivicScribe currently captures meetings only by sending a Recall.ai bot into the call.
Hosts can deny the bot entry, which kills the capture and reduces the platform's efficacy.
For public meetings, invisible capture is a feature (removes friction). For private
meetings the bot stays, because its visible presence doubles as the recording notice
required to stay clear of the Massachusetts wiretap statute (c. 272 s. 99).

## Decisions (locked)

1. **Dual mode.** Per-meeting `capture_mode`: `local` (public, no bot) or `bot`
   (private, existing Recall path, unchanged). Remembered per board so a recurring
   public council defaults to `local`.
2. **Public path = custom desktop recorder** (approach B), NOT Recall's Desktop SDK.
   Rationale: covers all three meeting formats, keeps public capture independent
   of Recall availability and per-hour cost, cheaper at city volume, fully owned.
   (Recall approval is already granted and the bot is live; independence is about
   cost and control, not unblocking.)
3. **All three meeting formats** must work: remote video call (capture system loopback
   audio), fully in-person chamber (capture a mic or line-in from the AV/PA board),
   and hybrid (loopback on the computer carrying the mixed audio). One control - the
   audio source picker - covers all three.
4. **Live transcription during the meeting** is required, not post-hoc. AssemblyAI
   real-time streaming (already in the stack) provides it.
5. **The AssemblyAI API key never ships in the app.** The backend mints short-lived
   streaming tokens. Non-negotiable.
6. **Always record a local WAV backup** while streaming. If the stream drops, the
   meeting is never lost; the file can be batch-transcribed on upload.
7. **Electron over Tauri** for the recorder. Electron 31+ gives Windows system-audio
   loopback through `setDisplayMediaRequestHandler` with `audio: 'loopback'` - no
   native WASAPI code to write or maintain.
8. **Legal guardrail:** the no-bot mode is only offered when `capture_mode = 'local'`
   (public meetings, recordable under the Open Meeting Law). Private meetings keep
   the self-announcing bot.

## Components

- **CivicScribe Recorder** (new Electron app, `recorder/` package in the repo).
  Sign in with existing CivicScribe Supabase auth. Pick an audio source (system
  loopback or any input device). Live transcript pane. Local WAV safety copy.
  On stop: upload audio + transcript to the backend.
- **Backend extensions** (inside the existing civicscribe Next.js app): `capture_mode`
  on meetings, a `capture_sessions` table, and four API routes -
  `/api/recorder/session` (start), `/api/recorder/token` (mint AssemblyAI streaming
  token server-side), `/api/recorder/upload` (WAV into the app's existing FileStorage),
  `/api/recorder/finalize` (store transcript + enqueue a summarize job, or for the
  offline path enqueue a transcribe job on the existing pipeline).
- **Existing pipeline unchanged downstream:** the app's jobs queue (in-process tick
  loop on Railway) already runs transcribe -> summarize with AssemblyAI signed URLs
  and Anthropic. Local-mode transcripts enter that same queue, so no webhook or new
  worker is needed and summaries come out identical regardless of `bot` or `local`
  origin.

## Public-meeting flow

1. Operator opens the recorder, signs in, picks/creates the meeting (mode Public).
2. Picks audio source, hits Start. Recorder calls `/api/recorder/session`, then
   `/api/recorder/token` for a short-lived AssemblyAI token.
3. Audio streams to AssemblyAI over WebSocket; live transcript renders; raw PCM is
   simultaneously written to a local WAV.
4. Stop: WAV finalized and uploaded via `/api/recorder/upload` (existing FileStorage),
   transcript posted to `/api/recorder/finalize`, summarize job enqueued on the
   existing jobs queue, notes stored - same landing zone as the bot.

## Error handling

- **Stream drops:** keep recording locally, buffer outbound audio (cap ~5 min), show
  "reconnecting", auto-retry with backoff, refresh token on reconnect. Worst case the
  local WAV is batch-transcribed at upload.
- **No network at start:** local-only session (record now, upload later). Upload flow
  submits the WAV through the app's existing transcribe job pipeline (the same one
  the audio-upload path already uses), which chains into summarize.
- **Token expiry mid-meeting:** silent refresh on reconnect.

## Testing

Unit tests (vitest): WAV writer, downsampler, streaming client (fake WebSocket),
backend client (fake fetch), session state machine (all fakes). Keyless mock mode
(fake transcriber) preserved, matching v1's mock-mode philosophy. Manual matrix
before ship: a real Zoom call, a chamber line-in, a hybrid meeting.

## Out of scope (v1)

Per-speaker multi-track capture, browser-extension capture, public live-transcript
web page, resumable (tus) uploads for very long recordings, macOS loopback polish
(Windows is the deploy target; mic/line-in works everywhere).

## Dependencies / flags

- Recorder installs on IT-managed city machines: same class as sanctioned tools,
  but give IT an early heads-up for a chamber PC install. Not a blocker.
- ASSEMBLYAI_API_KEY is already live in the Railway env (the prod transcribe path
  uses it). Verify the key has real-time streaming enabled; mock mode works keyless.
- Build and execution happen on the personal machine, where the civicscribe repo
  lives. This spec and its implementation plan get copied into the repo in Task 0.
