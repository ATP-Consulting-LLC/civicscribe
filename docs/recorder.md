# CivicScribe Recorder (local, no-bot capture)

A desktop app that records a public meeting from the operator's own machine.
No bot joins the call, so a host cannot deny it entry - which is the failure
mode it exists to remove.

Private meetings are unaffected and keep the visible, self-announcing Recall
bot. See "Why the restriction is enforced" below; this is not a preference.

## What it covers

One control - the audio source picker - covers all three meeting formats:

| Format | Source to pick | What it captures |
|---|---|---|
| Remote call (Zoom / Teams / Meet) | System audio (this computer) | Everyone on the call, via Windows loopback |
| In-person chamber | A microphone or AV/PA line-in | The room. No computer carries the audio, so loopback is not an option |
| Hybrid | System audio (this computer) | The remote half plus whatever the room mic feeds into the call |

## Running it

```bash
cd recorder
npm install
npm start            # builds, then launches
npm test             # 34 unit tests, no keys needed
```

Keyless demo (canned transcript, no backend, nothing uploaded):

```bash
RECORDER_MOCK=1 npm start
```

### Pointing it at a deployment

Create `recorder/src/renderer/recorder-config.json` (gitignored - it holds a
secret):

```json
{
  "baseUrl": "https://civicscribe-production.up.railway.app",
  "secret": "<the RECORDER_SECRET set on the server>"
}
```

With no config file it falls back to `http://localhost:3000` with no secret,
which is what you want against a local dev server.

## How a recording flows

1. **Start.** The recorder opens a meeting server-side (`source_type: 'local'`,
   `live_enabled: true`, attested public) and gets a short-lived AssemblyAI
   streaming token. The API key never ships inside the app.
2. **During.** Audio streams to AssemblyAI at 16 kHz mono, and every finalized
   turn is posted straight to the server - so the meeting's **public live page**
   follows along in real time, rolling catch-up recap included. The same audio
   is simultaneously written to a local WAV.
3. **Stop.** The WAV is uploaded, the turns are persisted as the transcript, and
   a summarize job is queued. From here it is indistinguishable from a bot
   capture.

### When the network misbehaves

The local WAV is written no matter what, so a bad connection degrades the
transcript and never the recording.

- **Drop mid-meeting:** audio buffers (about 5 minutes) while the client
  reconnects with a fresh token, then flushes. Longer than that and the gap is
  recovered from the WAV.
- **Offline at start:** the recorder records locally and shows "Upload
  recording". That path finalizes with `transcriptPending`, which routes the
  uploaded WAV through the ordinary transcribe job instead of the live turns.
- **Upload fails:** the phase goes to `error` and the WAV is left on disk in
  `Documents/CivicScribe Recordings/`. Retry with the same button.

## Screen-share invisibility

The recorder window is excluded from screen captures and screen shares
(Windows `WDA_EXCLUDEFROMCAPTURE`, via Electron's `setContentProtection`). It
stays visible to the operator. Toggle it off with the checkbox.

This exists so the recorder UI does not leak into a screen share the operator is
presenting. It hides the *window*, not the fact of recording.

## Why the restriction is enforced, not documented

Local capture is deliberately unobtrusive: no bot in the call, no announcement,
and a window that does not appear in a screen share. That is fine for an open
meeting of a public body, where the meeting is public by definition and
recording is lawful under the Massachusetts Open Meeting Law. It is **not** fine
for a private conversation - Massachusetts requires all-party consent (G.L.
c. 272, s. 99), and on the bot path the bot's visible arrival is what supplies
that notice.

So the rule does not live in a comment. `src/lib/recorder/guard.ts` refuses to
mint a streaming token, append a live line, accept an upload, or finalize unless
the target meeting is `source_type: 'local'` **and** `attestation: 'public'`. A
modified or home-built client cannot get around it, because the server will not
serve it. `tests/unit/recorder-routes.test.ts` pins this down.

Also required in any non-mock deploy: `RECORDER_SECRET`. These routes write to
the public live transcript, so without a configured secret they return 503
rather than run open - the same posture as the Recall webhook.

## Server surface

| Route | Purpose |
|---|---|
| `POST /api/recorder/session` | Open a local meeting |
| `POST /api/recorder/token` | Mint a short-lived AssemblyAI streaming token |
| `POST /api/recorder/live` | Append one finalized turn (the hot path) |
| `POST /api/recorder/upload` | Store the WAV safety copy |
| `POST /api/recorder/finalize` | Persist the transcript and queue summarize |

## The icon

`node scripts/make-icon.mjs` regenerates `build/icon.png` and `build/icon.ico`
from code - no image dependencies, no binary asset of unknown provenance. The
mark is the site's civic dome from `src/app/layout.tsx`, with two adjustments
for legibility at 16px: a thinner stroke (so the columns do not merge into the
walls) and a dome set back from the base (a full-width dome silhouettes as a
bell). `node scripts/icon-preview.mjs` renders a size sheet.

## Notes

- `recorder/` is excluded from the Railway build (`.railwayignore`) and from the
  Next app's eslint. It never ships with the server.
- The recorder is not code-signed. Windows SmartScreen will warn on first run on
  a machine that did not build it.
- Installing it on a managed city machine (a chamber PC especially) is worth
  clearing with IT first.
