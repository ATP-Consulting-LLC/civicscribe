# CivicScribe Recorder (Dual-Mode Capture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a no-bot public-meeting capture path to CivicScribe: a desktop recorder that streams any local audio source (system loopback or mic/line-in) to AssemblyAI live transcription and lands in the existing summary pipeline, while private meetings keep the Recall bot.

**Architecture:** New self-contained Electron app (`recorder/`) plus four Next.js API routes inside the existing civicscribe app and one DB migration. The recorder never holds the AssemblyAI key; it authenticates to the app (mechanism per FACT-8) and the server mints short-lived streaming tokens from the ASSEMBLYAI_API_KEY already in the Railway env. Audio is simultaneously written to a local WAV backup. Downstream, local transcripts enter the app's existing jobs queue (transcribe -> summarize tick loop), so no new worker or webhook exists.

**Tech Stack:** Electron 31+, TypeScript (strict), vitest, Next.js API routes (existing civicscribe app, LIVE on Railway), Supabase (DB + storage via the app's FileStorage abstraction, project qohvolrzcijqcfapryee), AssemblyAI Universal-Streaming (v3 WS) + the app's existing batch transcribe pipeline.

## Global Constraints

- All paths below are relative to the **civicscribe repo root** (github.com/quantunite/civicscribe, historically cloned at `Projects\personal\meeting-recorder`). The repo is NOT on COL-LAP1ANE. Execution happens on the personal machine.
- The app is LIVE in prod on Railway (civicscribe-production.up.railway.app). Deploys are MANUAL (`railway up --service civicscribe --ci` with RAILWAY_API_TOKEN exported, working tree on master). numReplicas MUST stay 1 (the in-process jobs tick loop depends on it). Do not deploy mid-plan; deploy once at Task 10 and once at ship (Task 13) unless a task says otherwise.
- No em dashes anywhere: code, comments, UI copy, docs. Use " - " or commas.
- The AssemblyAI API key exists ONLY in the server env (already set in Railway; put it in `.env.local` for local dev). Never in the recorder bundle, renderer, env files committed to git, or logs.
- Always write the local WAV backup while live-streaming. Never delete it on upload failure.
- No-bot capture is only offered for meetings with `capture_mode = 'local'` (public meetings). The bot path is not modified by this plan.
- Audio to AssemblyAI: 16 kHz, mono, PCM signed 16-bit little-endian, binary frames of 50 ms (1600 samples / 3200 bytes).
- Node 20+, Electron >= 31 (needs `setDisplayMediaRequestHandler` with `audio: 'loopback'`), TypeScript strict mode, vitest for tests.
- AssemblyAI endpoint shapes below are from Jan-2026 knowledge. Before Task 4, verify against current docs (context7: `resolve-library-id "assemblyai"` then `query-docs` for "universal streaming websocket token") and adjust URLs/fields if they moved.
- Mock mode must stay keyless: `MOCK_TRANSCRIBER=1` runs the full recorder UI with a fake transcriber and no backend, matching CivicScribe v1's mock philosophy.
- Commit after every task minimum; steps marked Commit are mandatory.

---

## File Structure (new files unless marked Modify)

```
docs/superpowers/specs/2026-07-24-dual-mode-capture-design.md      (copied in Task 0)
docs/superpowers/plans/2026-07-24-civicscribe-recorder-implementation-plan.md (this file, copied in Task 0)
docs/superpowers/plans/2026-07-24-integration-map.md               (produced by Task 0)
recorder/package.json
recorder/tsconfig.json
recorder/scripts/copy-static.mjs
recorder/electron/main.ts            app lifecycle, loopback handler, IPC, WAV writing
recorder/electron/preload.cjs        contextBridge IPC surface (plain JS)
recorder/electron/wav-writer.ts      queued WAV file writer
recorder/src/shared/types.ts         types shared by renderer and main
recorder/src/renderer/index.html     UI shell
recorder/src/renderer/app.ts         UI wiring
recorder/src/renderer/audio/capture.ts       source enumeration + stream open + audio pipe
recorder/src/renderer/audio/pcm-worklet.js   AudioWorklet tap (static JS)
recorder/src/renderer/audio/downsample.ts    Float32@any-rate -> Int16@16k
recorder/src/renderer/streaming/assemblyai.ts  live WS client: reconnect, buffer, token refresh
recorder/src/renderer/streaming/mock.ts        keyless fake transcriber
recorder/src/renderer/api/backend.ts           session/token/upload/finalize client
recorder/src/renderer/state/session.ts         recorder state machine
recorder/tests/wav-writer.test.ts
recorder/tests/downsample.test.ts
recorder/tests/assemblyai.test.ts
recorder/tests/backend.test.ts
recorder/tests/session.test.ts
supabase/migrations/20260724T000000_capture_mode.sql
src/app/api/recorder/session/route.ts
src/app/api/recorder/token/route.ts
src/app/api/recorder/upload/route.ts
src/app/api/recorder/finalize/route.ts
src/lib/recorder-auth.ts                 shared auth check for the four routes
(web app meeting form - exact path recorded as FACT-6 in the integration map)  Modify
(bot dispatch site in recall.ts - FACT-1)                                      Modify
```

No `recorder-transcript-webhook` exists: the offline path enqueues a job on the
app's existing transcribe pipeline, which already handles AssemblyAI batch results
and chains into summarize.

---

### Task 0: Integration recon + docs into repo

**Files:**
- Create: `docs/superpowers/specs/2026-07-24-dual-mode-capture-design.md` (copy from city laptop staging folder `Projects\City of Lawrence\civicscribe-recorder-plan\`)
- Create: `docs/superpowers/plans/2026-07-24-civicscribe-recorder-implementation-plan.md` (same)
- Create: `docs/superpowers/plans/2026-07-24-integration-map.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `integration-map.md` with FACT-1..FACT-7 that Tasks 8, 10, 11, 12 substitute for the default names used in this plan.

- [ ] **Step 1: Locate the repo and copy the docs in**

On the personal machine, the clone historically lives at `Projects\personal\meeting-recorder`; if absent, `git clone github.com/quantunite/civicscribe`. Before anything else read `FINAL_REPORT.md` and `DECISIONS.md` in the repo (18 recorded decisions; do not re-derive them). Copy both plan-folder docs into `docs/superpowers/specs/` and `docs/superpowers/plans/` as named above.

- [ ] **Step 2: Record the integration facts**

Known already (verify, do not rediscover): FACT-7 Supabase project = `qohvolrzcijqcfapryee`; Railway project `civicscribe`, service `civicscribe`, env production; jobs are claimed by an in-process tick loop (POST /api/jobs/tick every 5 s from scripts/railway-start.mjs); a summarize job is enqueued as `insert into jobs(meeting_id, type, payload) values (<id>, 'summarize', '{}')`; storage has a FileStorage abstraction with a `signedReadUrl` used to hand AssemblyAI batch audio.

Run these from the repo root and record answers in `docs/superpowers/plans/2026-07-24-integration-map.md`:

```
rg -ln "recall" --ignore-case src/    # FACT-1: bot dispatch site in recall.ts (where the bot is sent so Task 12 can gate it)
rg -n "create table" supabase/migrations/                # FACT-2: meetings table name + required columns on insert
rg -n "transcript" supabase/migrations/ src/lib/         # FACT-3: transcript storage shape + the exact function the transcribe worker calls to store one
rg -n "'transcribe'|\"transcribe\"" src/                 # FACT-4: transcribe job payload shape + confirm it auto-chains into summarize on completion
rg -n "boards|bodies" supabase/migrations/               # FACT-5: does a board/body table exist (yes/no + name)
rg -ln "use client" src/app | rg -i "meeting|submit|new" # FACT-6: meeting create/submission form file
rg -n "auth|session|cookie" src/app/api -g "route.ts"    # FACT-8: how existing API routes authenticate; decide recorder auth (reuse it, else RECORDER_API_KEY header - plan default)
rg -n "class .*Storage|FileStorage" src/lib/             # FACT-9: FileStorage put/get API + bucket, and the existing upload route path + MAX_UPLOAD_MB
```

Write the file as a table: FACT-N, plan default, actual value, affected tasks. Every later task that says "per FACT-N" reads this file first.

- [ ] **Step 3: Commit**

```bash
git checkout -b feature/recorder
git add docs/superpowers
git commit -m "docs: dual-mode capture spec, plan, and integration map"
```

---

### Task 1: Scaffold the recorder package

**Files:**
- Create: `recorder/package.json`, `recorder/tsconfig.json`, `recorder/scripts/copy-static.mjs`, `recorder/electron/main.ts`, `recorder/electron/preload.cjs`, `recorder/src/renderer/index.html`, `recorder/src/shared/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `window.recorderNative` (typed in Step 4), shared types in `src/shared/types.ts` used by every later task; `npm start` boots a window; `npm test` runs vitest.

- [ ] **Step 1: package.json and tsconfig**

`recorder/package.json`:

```json
{
  "name": "civicscribe-recorder",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "dist/electron/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json && node scripts/copy-static.mjs",
    "start": "npm run build && electron .",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "electron": "^31.3.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`recorder/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "outDir": "dist",
    "rootDir": ".",
    "skipLibCheck": true
  },
  "include": ["electron/**/*.ts", "src/**/*.ts"]
}
```

`recorder/scripts/copy-static.mjs`:

```js
import { cp } from 'node:fs/promises';
await cp('src/renderer/index.html', 'dist/src/renderer/index.html');
await cp('src/renderer/audio/pcm-worklet.js', 'dist/src/renderer/audio/pcm-worklet.js');
await cp('electron/preload.cjs', 'dist/electron/preload.cjs');
```

- [ ] **Step 2: Shared types**

`recorder/src/shared/types.ts`:

```ts
export type CaptureSourceKind = 'system' | 'input';

export interface CaptureSource {
  kind: CaptureSourceKind;
  deviceId?: string;
  label: string;
}

export interface SessionInfo {
  sessionId: string;
  storagePath: string;
}

export interface TranscriptTurn {
  order: number;
  text: string;
  startMs: number;
  endMs: number;
  final: boolean;
}

export type RecorderPhase =
  | 'idle' | 'starting' | 'recording' | 'reconnecting'
  | 'stopping' | 'uploading' | 'done' | 'error';

export interface FinalizedRecording {
  path: string;
  bytes: number;
  durationMs: number;
}

export interface RecorderNative {
  startRecording(sessionId: string, sampleRate: number): Promise<string>;
  audioChunk(buf: ArrayBuffer): void;
  finalizeRecording(): Promise<FinalizedRecording>;
  readRecordingBytes(): Promise<ArrayBuffer>;
}
```

- [ ] **Step 3: Minimal main + preload + html**

`recorder/electron/main.ts` (loopback handler included now so Task 7 only adds IPC):

```ts
import { app, BrowserWindow, session, desktopCapturer } from 'electron';
import path from 'node:path';

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      // audio: 'loopback' captures Windows system audio (WASAPI) with no native code
      callback({ video: sources[0], audio: 'loopback' });
    });
  });
  const win = new BrowserWindow({
    width: 760,
    height: 600,
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs') }
  });
  void win.loadFile(path.join(import.meta.dirname, '../src/renderer/index.html'));
});

app.on('window-all-closed', () => app.quit());
```

`recorder/electron/preload.cjs`:

```js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('recorderNative', {
  startRecording: (sessionId, sampleRate) => ipcRenderer.invoke('recording-start', sessionId, sampleRate),
  audioChunk: (buf) => ipcRenderer.send('audio-chunk', buf),
  finalizeRecording: () => ipcRenderer.invoke('recording-finalize'),
  readRecordingBytes: () => ipcRenderer.invoke('read-recording-bytes')
});
```

`recorder/src/renderer/index.html`:

```html
<!doctype html>
<meta charset="utf-8" />
<title>CivicScribe Recorder</title>
<body>
  <h1>CivicScribe Recorder</h1>
  <div id="app">booting</div>
  <script type="module" src="../../dist-renderer-placeholder.js"></script>
</body>
```

(The script src is corrected to the compiled `app.js` path in Task 7 when app.ts exists.)

- [ ] **Step 4: Verify it boots**

Run: `cd recorder && npm install && npm start`
Expected: a window opens showing "CivicScribe Recorder / booting". Devtools console may show a 404 for the placeholder script - fine for now.

- [ ] **Step 5: Commit**

```bash
git add recorder
git commit -m "feat(recorder): scaffold Electron app with loopback handler and IPC preload"
```

---

### Task 2: WAV writer (TDD)

**Files:**
- Create: `recorder/electron/wav-writer.ts`
- Test: `recorder/tests/wav-writer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `WavWriter.create(filePath: string, sampleRate: number): Promise<WavWriter>`, `append(pcm: Int16Array): void` (internally queued, safe to call without awaiting), `finalize(): Promise<{ bytes: number; durationMs: number }>`. Used by main.ts IPC in Task 7.

- [ ] **Step 1: Write the failing test**

`recorder/tests/wav-writer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WavWriter } from '../electron/wav-writer.js';

describe('WavWriter', () => {
  it('writes a valid 16k mono PCM16 wav with patched sizes', async () => {
    const p = join(tmpdir(), `wavtest-${process.pid}.wav`);
    const w = await WavWriter.create(p, 16000);
    const oneSecond = new Int16Array(16000).fill(1000);
    w.append(oneSecond);
    w.append(oneSecond);
    const { bytes, durationMs } = await w.finalize();

    const buf = await readFile(p);
    expect(buf.length).toBe(bytes);
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
    expect(buf.readUInt32LE(24)).toBe(16000);      // sample rate
    expect(buf.readUInt16LE(22)).toBe(1);          // mono
    expect(buf.readUInt32LE(40)).toBe(64000);      // data bytes
    expect(buf.readUInt32LE(4)).toBe(36 + 64000);  // riff size
    expect(durationMs).toBe(2000);
  });

  it('refuses append after finalize', async () => {
    const p = join(tmpdir(), `wavtest2-${process.pid}.wav`);
    const w = await WavWriter.create(p, 16000);
    await w.finalize();
    expect(() => w.append(new Int16Array(10))).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd recorder && npx vitest run tests/wav-writer.test.ts`
Expected: FAIL, cannot find module '../electron/wav-writer.js'.

- [ ] **Step 3: Implement**

`recorder/electron/wav-writer.ts`:

```ts
import { open, type FileHandle } from 'node:fs/promises';

export class WavWriter {
  private fh: FileHandle | null = null;
  private dataBytes = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  private constructor(private readonly sampleRate: number) {}

  static async create(filePath: string, sampleRate: number): Promise<WavWriter> {
    const w = new WavWriter(sampleRate);
    w.fh = await open(filePath, 'w');
    await w.fh.write(w.header(0)); // placeholder sizes, patched in finalize
    return w;
  }

  // fire-and-forget safe: writes are serialized on an internal promise chain
  append(pcm: Int16Array): void {
    if (this.closed) throw new Error('WavWriter is finalized');
    const buf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    this.dataBytes += buf.length;
    this.queue = this.queue.then(() => this.fh!.write(buf));
  }

  async finalize(): Promise<{ bytes: number; durationMs: number }> {
    if (this.closed) throw new Error('WavWriter is finalized');
    this.closed = true;
    await this.queue;
    await this.fh!.write(this.header(this.dataBytes), 0, 44, 0);
    await this.fh!.close();
    const durationMs = Math.round((this.dataBytes / 2 / this.sampleRate) * 1000);
    return { bytes: 44 + this.dataBytes, durationMs };
  }

  private header(dataBytes: number): Buffer {
    const b = Buffer.alloc(44);
    b.write('RIFF', 0);
    b.writeUInt32LE(36 + dataBytes, 4);
    b.write('WAVE', 8);
    b.write('fmt ', 12);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);  // PCM
    b.writeUInt16LE(1, 22);  // mono
    b.writeUInt32LE(this.sampleRate, 24);
    b.writeUInt32LE(this.sampleRate * 2, 28); // byte rate
    b.writeUInt16LE(2, 32);  // block align
    b.writeUInt16LE(16, 34); // bits per sample
    b.write('data', 36);
    b.writeUInt32LE(dataBytes, 40);
    return b;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/wav-writer.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add recorder/electron/wav-writer.ts recorder/tests/wav-writer.test.ts
git commit -m "feat(recorder): queued WAV writer with patched header"
```

---

### Task 3: Downsampler (TDD)

**Files:**
- Create: `recorder/src/renderer/audio/downsample.ts`
- Test: `recorder/tests/downsample.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `new Downsampler(inputRate: number)` with `process(input: Float32Array): Int16Array` producing 16 kHz PCM16. Stateful across calls (fractional position carries), so one instance per recording. Used by capture.ts (Task 7).

- [ ] **Step 1: Write the failing test**

`recorder/tests/downsample.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Downsampler } from '../src/renderer/audio/downsample.js';

describe('Downsampler', () => {
  it('reduces 48k input to ~1/3 the samples', () => {
    const d = new Downsampler(48000);
    const out = d.process(new Float32Array(4800)); // 100ms at 48k
    expect(out.length).toBeGreaterThanOrEqual(1595);
    expect(out.length).toBeLessThanOrEqual(1600);  // ~100ms at 16k
  });

  it('preserves a DC signal value', () => {
    const d = new Downsampler(48000);
    const out = d.process(new Float32Array(4800).fill(0.5));
    expect(out[100]).toBeGreaterThan(16000);
    expect(out[100]).toBeLessThan(16600); // 0.5 * 32767 ~ 16384
  });

  it('chunked processing equals one-shot processing', () => {
    const src = new Float32Array(9600).map((_, i) => Math.sin(i / 20));
    const one = new Downsampler(48000).process(src);
    const d = new Downsampler(48000);
    const a = d.process(src.slice(0, 5000));
    const b = d.process(src.slice(5000));
    const chunked = new Int16Array(a.length + b.length);
    chunked.set(a, 0); chunked.set(b, a.length);
    expect(chunked.length).toBe(one.length);
    for (let i = 0; i < one.length; i++) expect(chunked[i]).toBe(one[i]);
  });

  it('clamps out-of-range floats', () => {
    const d = new Downsampler(16000);
    const out = d.process(new Float32Array(100).fill(2.0));
    expect(out[10]).toBe(32767);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/downsample.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

`recorder/src/renderer/audio/downsample.ts`:

```ts
export class Downsampler {
  private readonly ratio: number;
  private pos = 0;                       // fractional read position carried across calls
  private tail = new Float32Array(0);    // unconsumed samples carried across calls

  constructor(inputRate: number, readonly outputRate = 16000) {
    if (inputRate < outputRate) throw new Error('upsampling not supported');
    this.ratio = inputRate / outputRate;
  }

  process(input: Float32Array): Int16Array {
    const src = new Float32Array(this.tail.length + input.length);
    src.set(this.tail, 0);
    src.set(input, this.tail.length);
    const out: number[] = [];
    let pos = this.pos;
    while (pos + 1 < src.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const sample = src[i] * (1 - frac) + src[i + 1] * frac; // linear interpolation
      out.push(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))));
      pos += this.ratio;
    }
    const consumed = Math.floor(pos);
    this.tail = src.slice(consumed);
    this.pos = pos - consumed;
    return Int16Array.from(out);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/downsample.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add recorder/src/renderer/audio/downsample.ts recorder/tests/downsample.test.ts
git commit -m "feat(recorder): stateful 16k PCM16 downsampler"
```

---

### Task 4: AssemblyAI live streaming client (TDD)

**Files:**
- Create: `recorder/src/renderer/streaming/assemblyai.ts`
- Create: `recorder/src/renderer/streaming/mock.ts`
- Test: `recorder/tests/assemblyai.test.ts`

**Interfaces:**
- Consumes: `TranscriptTurn` from `src/shared/types.ts`.
- Produces (used by session.ts in Task 6 and app.ts in Task 7):

```ts
export interface TranscriberLike {
  start(): Promise<void>;
  sendAudio(pcm: Int16Array): void;
  stop(): Promise<void>;
}
export interface TranscriberOpts {
  getToken: () => Promise<string>;
  onTurn: (turn: TranscriptTurn) => void;
  onStatus: (status: 'connected' | 'reconnecting' | 'closed') => void;
  wsFactory?: (url: string) => WebSocket;   // injected in tests
  sampleRate?: number;                      // default 16000
}
export class LiveTranscriber implements TranscriberLike { constructor(opts: TranscriberOpts) }
export class MockTranscriber implements TranscriberLike { constructor(onTurn: (t: TranscriptTurn) => void) }
```

- [ ] **Step 0: Verify current AssemblyAI API shapes**

Per Global Constraints, check context7 docs for Universal-Streaming. Plan assumes:
token mint `GET https://streaming.assemblyai.com/v3/token?expires_in_seconds=600` with `Authorization: <api key>` returning `{ token }` (backend side, Task 9);
WS `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&encoding=pcm_s16le&token=<token>`;
inbound JSON messages with `type: "Begin" | "Turn" | "Termination"`, Turn carrying `transcript`, `end_of_turn`, `audio_start_ms`(or per-word timing), outbound audio as raw binary frames, graceful stop by sending `{"type":"Terminate"}`. Adjust code below if the docs differ, and note any change in the integration map.

- [ ] **Step 1: Write the failing test**

`recorder/tests/assemblyai.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { LiveTranscriber } from '../src/renderer/streaming/assemblyai.js';
import type { TranscriptTurn } from '../src/shared/types.js';

class FakeWS {
  static instances: FakeWS[] = [];
  readyState = 0; // CONNECTING
  sent: (ArrayBuffer | string)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = '';
  constructor(public url: string) { FakeWS.instances.push(this); }
  send(d: ArrayBuffer | string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

function make(turns: TranscriptTurn[], statuses: string[]) {
  FakeWS.instances = [];
  let tokenCount = 0;
  const getToken = vi.fn(async () => `tok-${++tokenCount}`);
  const t = new LiveTranscriber({
    getToken,
    onTurn: (turn) => turns.push(turn),
    onStatus: (s) => statuses.push(s),
    wsFactory: (url) => new FakeWS(url) as unknown as WebSocket,
    reconnectDelaysMs: [0]
  });
  return { t, getToken };
}

describe('LiveTranscriber', () => {
  it('connects with a fetched token and forwards audio as binary', async () => {
    const turns: TranscriptTurn[] = []; const statuses: string[] = [];
    const { t } = make(turns, statuses);
    await t.start();
    const ws = FakeWS.instances[0];
    expect(ws.url).toContain('token=tok-1');
    ws.open();
    t.sendAudio(new Int16Array([1, 2, 3]));
    expect(ws.sent.length).toBe(1);
    expect(statuses).toContain('connected');
  });

  it('surfaces final Turn messages as TranscriptTurn', async () => {
    const turns: TranscriptTurn[] = []; const statuses: string[] = [];
    const { t } = make(turns, statuses);
    await t.start();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.message({ type: 'Turn', transcript: 'call to order', end_of_turn: true, audio_start_ms: 100, audio_end_ms: 2100 });
    expect(turns.length).toBe(1);
    expect(turns[0]).toMatchObject({ order: 0, text: 'call to order', startMs: 100, endMs: 2100, final: true });
  });

  it('buffers audio while disconnected, refetches token, flushes on reconnect', async () => {
    const turns: TranscriptTurn[] = []; const statuses: string[] = [];
    const { t, getToken } = make(turns, statuses);
    await t.start();
    const ws1 = FakeWS.instances[0];
    ws1.open();
    ws1.close();                       // drop
    t.sendAudio(new Int16Array([1]));  // while down
    t.sendAudio(new Int16Array([2]));
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(2));
    const ws2 = FakeWS.instances[1];
    ws2.open();
    expect(ws2.sent.length).toBe(2);   // buffered audio flushed
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(['connected', 'reconnecting', 'connected']);
  });

  it('stop() sends Terminate and does not reconnect', async () => {
    const turns: TranscriptTurn[] = []; const statuses: string[] = [];
    const { t } = make(turns, statuses);
    await t.start();
    const ws = FakeWS.instances[0];
    ws.open();
    await t.stop();
    expect(ws.sent.some((m) => typeof m === 'string' && m.includes('Terminate'))).toBe(true);
    ws.close();
    expect(FakeWS.instances.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/assemblyai.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

`recorder/src/renderer/streaming/assemblyai.ts`:

```ts
import type { TranscriptTurn } from '../../shared/types.js';

export interface TranscriberLike {
  start(): Promise<void>;
  sendAudio(pcm: Int16Array): void;
  stop(): Promise<void>;
}

export interface TranscriberOpts {
  getToken: () => Promise<string>;
  onTurn: (turn: TranscriptTurn) => void;
  onStatus: (status: 'connected' | 'reconnecting' | 'closed') => void;
  wsFactory?: (url: string) => WebSocket;
  sampleRate?: number;
  reconnectDelaysMs?: number[];
}

const MAX_BUFFERED_CHUNKS = 6000; // 50ms chunks -> ~5 minutes

export class LiveTranscriber implements TranscriberLike {
  private ws: WebSocket | null = null;
  private buffer: Int16Array[] = [];
  private closedByUser = false;
  private turnOrder = 0;
  private attempt = 0;
  private readonly delays: number[];

  constructor(private readonly opts: TranscriberOpts) {
    this.delays = opts.reconnectDelaysMs ?? [1000, 2000, 4000, 8000, 15000];
  }

  async start(): Promise<void> {
    await this.connect();
  }

  private async connect(): Promise<void> {
    const token = await this.opts.getToken();
    const rate = this.opts.sampleRate ?? 16000;
    const url = `wss://streaming.assemblyai.com/v3/ws?sample_rate=${rate}&encoding=pcm_s16le&token=${token}`;
    const ws = (this.opts.wsFactory ?? ((u: string) => new WebSocket(u)))(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.attempt = 0;
      this.opts.onStatus('connected');
      const held = this.buffer; this.buffer = [];
      for (const pcm of held) ws.send(pcm.buffer as ArrayBuffer);
    };
    ws.onmessage = (ev) => this.handleMessage(String(ev.data));
    ws.onclose = () => {
      if (this.closedByUser) { this.opts.onStatus('closed'); return; }
      this.opts.onStatus('reconnecting');
      const delay = this.delays[Math.min(this.attempt++, this.delays.length - 1)];
      setTimeout(() => { void this.connect(); }, delay);
    };
    ws.onerror = () => { /* onclose follows; nothing to do */ };
    this.ws = ws;
  }

  sendAudio(pcm: Int16Array): void {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(pcm.buffer as ArrayBuffer);
    } else if (this.buffer.length < MAX_BUFFERED_CHUNKS) {
      this.buffer.push(pcm); // held while reconnecting; local WAV still has everything
    }
  }

  async stop(): Promise<void> {
    this.closedByUser = true;
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'Terminate' }));
      this.ws.close();
    }
  }

  private handleMessage(data: string): void {
    let msg: { type?: string; transcript?: string; end_of_turn?: boolean; audio_start_ms?: number; audio_end_ms?: number };
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'Turn' && msg.end_of_turn && msg.transcript) {
      this.opts.onTurn({
        order: this.turnOrder++,
        text: msg.transcript,
        startMs: msg.audio_start_ms ?? 0,
        endMs: msg.audio_end_ms ?? 0,
        final: true
      });
    }
  }
}
```

`recorder/src/renderer/streaming/mock.ts`:

```ts
import type { TranscriptTurn } from '../../shared/types.js';
import type { TranscriberLike } from './assemblyai.js';

const LINES = [
  'Call to order at seven pm.',
  'Roll call: all members present.',
  'Motion to approve the minutes.',
  'Motion carries unanimously.'
];

export class MockTranscriber implements TranscriberLike {
  private timer: ReturnType<typeof setInterval> | null = null;
  private i = 0;
  constructor(private readonly onTurn: (t: TranscriptTurn) => void) {}

  async start(): Promise<void> {
    this.timer = setInterval(() => {
      const text = LINES[this.i % LINES.length];
      this.onTurn({ order: this.i, text, startMs: this.i * 4000, endMs: this.i * 4000 + 3500, final: true });
      this.i++;
    }, 4000);
  }

  sendAudio(): void { /* discarded in mock mode */ }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/assemblyai.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add recorder/src/renderer/streaming recorder/tests/assemblyai.test.ts
git commit -m "feat(recorder): AssemblyAI live client with reconnect buffering, plus keyless mock"
```

---

### Task 5: Backend client (TDD)

**Files:**
- Create: `recorder/src/renderer/api/backend.ts`
- Test: `recorder/tests/backend.test.ts`

**Interfaces:**
- Consumes: `SessionInfo`, `TranscriptTurn` from shared types.
- Produces (used by session.ts in Task 6):

```ts
export interface BackendClientLike {
  createSession(meetingTitle: string): Promise<SessionInfo>;
  getStreamingToken(sessionId: string): Promise<string>;
  uploadAudio(sessionId: string, bytes: ArrayBuffer): Promise<void>;
  finalize(sessionId: string, turns: TranscriptTurn[], durationMs: number, transcriptPending: boolean): Promise<void>;
}
export class BackendClient implements BackendClientLike { constructor(baseUrl: string, apiKey: string) }
```

Auth default is an `x-recorder-key` header checked against a server env var; if FACT-8 found reusable session auth, swap the header for it here and in Task 9's `recorder-auth.ts` only - the interface stays.

- [ ] **Step 1: Write the failing test**

`recorder/tests/backend.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackendClient } from '../src/renderer/api/backend.js';

const calls: { url: string; init: RequestInit }[] = [];

function stubFetch(responder: (url: string) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = responder(url);
    if (body === null) return new Response('boom', { status: 500 });
    return Response.json(body);
  }));
}

describe('BackendClient', () => {
  beforeEach(() => { calls.length = 0; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('creates a session with the auth header', async () => {
    stubFetch(() => ({ sessionId: 's1', storagePath: 'recordings/s1.wav' }));
    const c = new BackendClient('https://example.test', 'k1');
    const s = await c.createSession('School Committee 7/24');
    expect(s).toEqual({ sessionId: 's1', storagePath: 'recordings/s1.wav' });
    expect(calls[0].url).toBe('https://example.test/api/recorder/session');
    expect((calls[0].init.headers as Record<string, string>)['x-recorder-key']).toBe('k1');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ meetingTitle: 'School Committee 7/24' });
  });

  it('gets a streaming token for a session', async () => {
    stubFetch(() => ({ token: 'aai-tok', expiresInSeconds: 600 }));
    const c = new BackendClient('https://example.test', 'k1');
    expect(await c.getStreamingToken('s1')).toBe('aai-tok');
    expect(calls[0].url).toBe('https://example.test/api/recorder/token');
  });

  it('uploads audio bytes as audio/wav', async () => {
    stubFetch(() => ({ ok: true }));
    const c = new BackendClient('https://example.test', 'k1');
    await c.uploadAudio('s1', new ArrayBuffer(8));
    expect(calls[0].url).toBe('https://example.test/api/recorder/upload?sessionId=s1');
    expect((calls[0].init.headers as Record<string, string>)['content-type']).toBe('audio/wav');
  });

  it('throws on a non-2xx response', async () => {
    stubFetch(() => null);
    const c = new BackendClient('https://example.test', 'k1');
    await expect(c.createSession('x')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/backend.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

`recorder/src/renderer/api/backend.ts`:

```ts
import type { SessionInfo, TranscriptTurn } from '../../shared/types.js';

export interface BackendClientLike {
  createSession(meetingTitle: string): Promise<SessionInfo>;
  getStreamingToken(sessionId: string): Promise<string>;
  uploadAudio(sessionId: string, bytes: ArrayBuffer): Promise<void>;
  finalize(sessionId: string, turns: TranscriptTurn[], durationMs: number, transcriptPending: boolean): Promise<void>;
}

export class BackendClient implements BackendClientLike {
  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}

  private async post<T>(path: string, body: BodyInit, contentType: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'x-recorder-key': this.apiKey, 'content-type': contentType },
      body
    });
    if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  private postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.post<T>(path, JSON.stringify(body), 'application/json');
  }

  createSession(meetingTitle: string): Promise<SessionInfo> {
    return this.postJson<SessionInfo>('/api/recorder/session', { meetingTitle });
  }

  async getStreamingToken(sessionId: string): Promise<string> {
    const { token } = await this.postJson<{ token: string }>('/api/recorder/token', { sessionId });
    return token;
  }

  async uploadAudio(sessionId: string, bytes: ArrayBuffer): Promise<void> {
    await this.post(`/api/recorder/upload?sessionId=${sessionId}`, bytes, 'audio/wav');
  }

  async finalize(sessionId: string, turns: TranscriptTurn[], durationMs: number, transcriptPending: boolean): Promise<void> {
    await this.postJson('/api/recorder/finalize', { sessionId, turns, durationMs, transcriptPending });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/backend.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add recorder/src/renderer/api recorder/tests/backend.test.ts
git commit -m "feat(recorder): backend client for session, token, upload, finalize"
```

---

### Task 6: Recorder session state machine (TDD)

**Files:**
- Create: `recorder/src/renderer/state/session.ts`
- Test: `recorder/tests/session.test.ts`

**Interfaces:**
- Consumes: `BackendClientLike` (Task 5), `TranscriberLike` (Task 4), `RecorderNative` + shared types (Task 1).
- Produces (used by app.ts in Task 7):

```ts
export interface AudioPipe { onPcm(cb: (pcm: Int16Array) => void): void; stop(): Promise<void>; }
export interface SessionDeps {
  backend: BackendClientLike;
  makeTranscriber(getToken: () => Promise<string>): TranscriberLike;
  native: RecorderNative;
  openPipe(source: CaptureSource): Promise<AudioPipe>;
  onPhase(phase: RecorderPhase): void;
  onTurn(turn: TranscriptTurn): void;
}
export class RecorderSession {
  constructor(deps: SessionDeps);
  readonly localOnly: boolean;
  start(source: CaptureSource, meetingTitle: string): Promise<void>;
  stop(): Promise<void>;                 // full happy-path: finalize wav, upload, finalize backend
  uploadLater(): Promise<void>;          // offline path: create session now, upload wav, transcriptPending=true
}
```

- [ ] **Step 1: Write the failing test**

`recorder/tests/session.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { RecorderSession, type SessionDeps, type AudioPipe } from '../src/renderer/state/session.js';
import type { TranscriptTurn, RecorderPhase, CaptureSource } from '../src/shared/types.js';

const SOURCE: CaptureSource = { kind: 'input', deviceId: 'd1', label: 'USB Mic' };

function makeDeps(overrides: Partial<{ createSessionFails: boolean }> = {}) {
  let pcmCb: ((pcm: Int16Array) => void) | null = null;
  const phases: RecorderPhase[] = [];
  const turns: TranscriptTurn[] = [];
  const sentAudio: Int16Array[] = [];
  const transcriber = {
    start: vi.fn(async () => {}),
    sendAudio: vi.fn((p: Int16Array) => { sentAudio.push(p); }),
    stop: vi.fn(async () => {})
  };
  const backend = {
    createSession: vi.fn(async () => {
      if (overrides.createSessionFails) throw new Error('offline');
      return { sessionId: 's1', storagePath: 'recordings/s1.wav' };
    }),
    getStreamingToken: vi.fn(async () => 'tok'),
    uploadAudio: vi.fn(async () => {}),
    finalize: vi.fn(async () => {})
  };
  const native = {
    startRecording: vi.fn(async () => 'C:/rec/s1.wav'),
    audioChunk: vi.fn(),
    finalizeRecording: vi.fn(async () => ({ path: 'C:/rec/s1.wav', bytes: 64044, durationMs: 2000 })),
    readRecordingBytes: vi.fn(async () => new ArrayBuffer(64044))
  };
  const pipe: AudioPipe = { onPcm: (cb) => { pcmCb = cb; }, stop: vi.fn(async () => {}) };
  const deps: SessionDeps = {
    backend,
    makeTranscriber: () => transcriber,
    native,
    openPipe: vi.fn(async () => pipe),
    onPhase: (p) => phases.push(p),
    onTurn: (t) => turns.push(t)
  };
  return { deps, backend, native, transcriber, phases, feedPcm: (p: Int16Array) => pcmCb?.(p), sentAudio };
}

describe('RecorderSession', () => {
  it('happy path: start pipes audio to transcriber and disk, stop uploads and finalizes', async () => {
    const { deps, backend, native, phases, feedPcm, sentAudio } = makeDeps();
    const s = new RecorderSession(deps);
    await s.start(SOURCE, 'Council 7/24');
    expect(phases).toEqual(['starting', 'recording']);
    feedPcm(new Int16Array([1, 2]));
    expect(sentAudio.length).toBe(1);
    expect(native.audioChunk).toHaveBeenCalledTimes(1);
    await s.stop();
    expect(backend.uploadAudio).toHaveBeenCalledWith('s1', expect.any(ArrayBuffer));
    expect(backend.finalize).toHaveBeenCalledWith('s1', [], 2000, false);
    expect(phases).toEqual(['starting', 'recording', 'stopping', 'uploading', 'done']);
  });

  it('collects turns via addTurn and passes them to finalize', async () => {
    const { deps, backend } = makeDeps();
    const s = new RecorderSession(deps);
    await s.start(SOURCE, 'x');
    s.addTurn({ order: 0, text: 'hi', startMs: 0, endMs: 500, final: true });
    await s.stop();
    expect(backend.finalize).toHaveBeenCalledWith('s1', [expect.objectContaining({ text: 'hi' })], 2000, false);
  });

  it('offline start falls back to local-only recording', async () => {
    const { deps, native, phases } = makeDeps({ createSessionFails: true });
    const s = new RecorderSession(deps);
    await s.start(SOURCE, 'x');
    expect(s.localOnly).toBe(true);
    expect(native.startRecording).toHaveBeenCalled(); // still records to disk
    expect(phases).toEqual(['starting', 'recording']);
  });

  it('upload failure lands in error phase and keeps the wav', async () => {
    const { deps, backend, phases } = makeDeps();
    backend.uploadAudio = vi.fn(async () => { throw new Error('net down'); });
    const s = new RecorderSession(deps);
    await s.start(SOURCE, 'x');
    await s.stop();
    expect(phases[phases.length - 1]).toBe('error');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

`recorder/src/renderer/state/session.ts`:

```ts
import type { BackendClientLike } from '../api/backend.js';
import type { TranscriberLike } from '../streaming/assemblyai.js';
import type { CaptureSource, RecorderNative, RecorderPhase, SessionInfo, TranscriptTurn } from '../../shared/types.js';

export interface AudioPipe {
  onPcm(cb: (pcm: Int16Array) => void): void;
  stop(): Promise<void>;
}

export interface SessionDeps {
  backend: BackendClientLike;
  makeTranscriber(getToken: () => Promise<string>): TranscriberLike;
  native: RecorderNative;
  openPipe(source: CaptureSource): Promise<AudioPipe>;
  onPhase(phase: RecorderPhase): void;
  onTurn(turn: TranscriptTurn): void;
}

export class RecorderSession {
  localOnly = false;
  private phase: RecorderPhase = 'idle';
  private session: SessionInfo | null = null;
  private transcriber: TranscriberLike | null = null;
  private pipe: AudioPipe | null = null;
  private turns: TranscriptTurn[] = [];
  private durationMs = 0;
  private meetingTitle = '';

  constructor(private readonly deps: SessionDeps) {}

  private setPhase(p: RecorderPhase): void {
    this.phase = p;
    this.deps.onPhase(p);
  }

  async start(source: CaptureSource, meetingTitle: string): Promise<void> {
    this.meetingTitle = meetingTitle;
    this.setPhase('starting');
    try {
      this.session = await this.deps.backend.createSession(meetingTitle);
    } catch {
      this.localOnly = true; // offline: record now, upload later
      this.session = { sessionId: `local-${crypto.randomUUID()}`, storagePath: '' };
    }
    await this.deps.native.startRecording(this.session.sessionId, 16000);
    if (!this.localOnly) {
      // the transcriber's onTurn is wired by app.ts inside makeTranscriber, routing to this.addTurn
      this.transcriber = this.deps.makeTranscriber(() =>
        this.deps.backend.getStreamingToken(this.session!.sessionId)
      );
      await this.transcriber.start();
    }
    this.pipe = await this.deps.openPipe(source);
    this.pipe.onPcm((pcm) => {
      this.transcriber?.sendAudio(pcm);
      this.deps.native.audioChunk(pcm.buffer as ArrayBuffer);
    });
    this.setPhase('recording');
  }

  addTurn(turn: TranscriptTurn): void {
    this.turns.push(turn);
    this.deps.onTurn(turn);
  }

  async stop(): Promise<void> {
    this.setPhase('stopping');
    await this.pipe?.stop();
    await this.transcriber?.stop();
    const rec = await this.deps.native.finalizeRecording();
    this.durationMs = rec.durationMs;
    if (this.localOnly) { this.setPhase('done'); return; }
    await this.uploadAndFinalize(false);
  }

  // offline path: called later from the UI when network is back
  async uploadLater(): Promise<void> {
    this.session = await this.deps.backend.createSession(this.meetingTitle);
    await this.uploadAndFinalize(true);
  }

  private async uploadAndFinalize(transcriptPending: boolean): Promise<void> {
    this.setPhase('uploading');
    try {
      const bytes = await this.deps.native.readRecordingBytes();
      await this.deps.backend.uploadAudio(this.session!.sessionId, bytes);
      await this.deps.backend.finalize(this.session!.sessionId, this.turns, this.durationMs, transcriptPending);
      this.setPhase('done');
    } catch {
      this.setPhase('error'); // local wav is untouched; operator can retry
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/session.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Full suite green + commit**

Run: `npx vitest run`
Expected: all tests pass.

```bash
git add recorder/src/renderer/state recorder/tests/session.test.ts
git commit -m "feat(recorder): session state machine with offline fallback and upload retry surface"
```

---

### Task 7: Audio capture + UI wiring (manual verification)

**Files:**
- Create: `recorder/src/renderer/audio/capture.ts`, `recorder/src/renderer/audio/pcm-worklet.js`, `recorder/src/renderer/app.ts`
- Modify: `recorder/src/renderer/index.html`, `recorder/electron/main.ts`

**Interfaces:**
- Consumes: `Downsampler` (Task 3), `LiveTranscriber`/`MockTranscriber` (Task 4), `BackendClient` (Task 5), `RecorderSession`/`AudioPipe` (Task 6), `window.recorderNative` (Task 1).
- Produces: the working app. `listSources(): Promise<CaptureSource[]>` and `openPipe(source): Promise<AudioPipe>` from capture.ts.

- [ ] **Step 1: Worklet tap**

`recorder/src/renderer/audio/pcm-worklet.js`:

```js
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
```

- [ ] **Step 2: Capture module**

`recorder/src/renderer/audio/capture.ts`:

```ts
import { Downsampler } from './downsample.js';
import type { CaptureSource } from '../../shared/types.js';
import type { AudioPipe } from '../state/session.js';

export async function listSources(): Promise<CaptureSource[]> {
  // ask for mic permission once so device labels populate
  try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); } catch { /* no mic is fine */ }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({ kind: 'input' as const, deviceId: d.deviceId, label: d.label || 'Audio input' }));
  return [{ kind: 'system', label: 'System audio (this computer)' }, ...inputs];
}

export async function openPipe(source: CaptureSource): Promise<AudioPipe> {
  let stream: MediaStream;
  if (source.kind === 'system') {
    // main process answers this via setDisplayMediaRequestHandler with audio 'loopback'
    stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    stream.getVideoTracks().forEach((t) => t.stop()); // audio only
  } else {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: source.deviceId! } } });
  }
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
  const src = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, 'pcm-tap');
  src.connect(tap);
  const down = new Downsampler(ctx.sampleRate);
  let cb: ((pcm: Int16Array) => void) | null = null;
  tap.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    const pcm = down.process(ev.data);
    if (pcm.length > 0) cb?.(pcm);
  };
  return {
    onPcm(fn) { cb = fn; },
    async stop() {
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
    }
  };
}
```

- [ ] **Step 3: Main-process IPC for recording**

Add to `recorder/electron/main.ts` (below the existing code):

```ts
import { ipcMain } from 'electron';
import { mkdir, readFile } from 'node:fs/promises';
import { WavWriter } from './wav-writer.js';

let writer: WavWriter | null = null;
let currentPath = '';

ipcMain.handle('recording-start', async (_e, sessionId: string, sampleRate: number) => {
  const dir = path.join(app.getPath('documents'), 'CivicScribe Recordings');
  await mkdir(dir, { recursive: true });
  currentPath = path.join(dir, `${sessionId}.wav`);
  writer = await WavWriter.create(currentPath, sampleRate);
  return currentPath;
});

ipcMain.on('audio-chunk', (_e, buf: ArrayBuffer) => {
  writer?.append(new Int16Array(buf));
});

ipcMain.handle('recording-finalize', async () => {
  const r = await writer!.finalize();
  writer = null;
  return { path: currentPath, ...r };
});

ipcMain.handle('read-recording-bytes', async () => (await readFile(currentPath)).buffer);
```

(Merge the `ipcMain` import into the existing electron import line.)

- [ ] **Step 4: UI**

Replace `recorder/src/renderer/index.html` body:

```html
<!doctype html>
<meta charset="utf-8" />
<title>CivicScribe Recorder</title>
<style>
  body { font-family: system-ui; margin: 1.5rem; }
  #transcript { border: 1px solid #ccc; height: 320px; overflow-y: auto; padding: .5rem; margin-top: 1rem; }
  #status { font-weight: 600; }
  .reconnecting { color: #b45309; }
  .error { color: #b91c1c; }
</style>
<body>
  <h1>CivicScribe Recorder</h1>
  <label>Meeting title <input id="title" size="40" placeholder="City Council - July 24" /></label>
  <label>Audio source <select id="source"></select></label>
  <button id="startstop">Start recording</button>
  <button id="uploadLater" hidden>Upload recording</button>
  <div>Status: <span id="status">idle</span></div>
  <div id="transcript"></div>
  <script type="module" src="../../src/renderer/app.js"></script>
</body>
```

`recorder/src/renderer/app.ts`:

```ts
import { listSources, openPipe } from './audio/capture.js';
import { LiveTranscriber, type TranscriberLike } from './streaming/assemblyai.js';
import { MockTranscriber } from './streaming/mock.js';
import { BackendClient } from './api/backend.js';
import { RecorderSession } from './state/session.js';
import type { CaptureSource, RecorderNative, RecorderPhase, TranscriptTurn } from '../shared/types.js';

declare global { interface Window { recorderNative: RecorderNative; } }

const MOCK = new URLSearchParams(location.search).has('mock');

// recorder-config.json sits next to index.html, is gitignored, and is written once
// per machine at Task 11: {"baseUrl": "https://civicscribe-production.up.railway.app", "apiKey": "..."}
// In mock mode the file is optional and the client goes unused.
interface RecorderConfig { baseUrl: string; apiKey: string; }
async function loadConfig(): Promise<RecorderConfig> {
  try { return await (await fetch('./recorder-config.json')).json(); }
  catch { return { baseUrl: 'http://localhost:3000', apiKey: 'devkey' }; }
}
const config = await loadConfig();
const backend = new BackendClient(config.baseUrl, config.apiKey);

const el = {
  title: document.getElementById('title') as HTMLInputElement,
  source: document.getElementById('source') as HTMLSelectElement,
  startstop: document.getElementById('startstop') as HTMLButtonElement,
  uploadLater: document.getElementById('uploadLater') as HTMLButtonElement,
  status: document.getElementById('status') as HTMLSpanElement,
  transcript: document.getElementById('transcript') as HTMLDivElement
};

let sources: CaptureSource[] = [];
let session: RecorderSession | null = null;
let recording = false;

function renderPhase(p: RecorderPhase): void {
  el.status.textContent = p;
  el.status.className = p === 'reconnecting' || p === 'error' ? p : '';
  el.uploadLater.hidden = !(p === 'done' && session?.localOnly) && p !== 'error';
}

function renderTurn(t: TranscriptTurn): void {
  const line = document.createElement('p');
  line.textContent = t.text;
  el.transcript.appendChild(line);
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

async function init(): Promise<void> {
  sources = await listSources();
  el.source.innerHTML = '';
  for (const [i, s] of sources.entries()) {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = s.label;
    el.source.appendChild(o);
  }
}

el.startstop.addEventListener('click', () => {
  void (async () => {
    if (!recording) {
      session = new RecorderSession({
        backend,
        native: window.recorderNative,
        openPipe,
        onPhase: renderPhase,
        onTurn: renderTurn,
        makeTranscriber: (getToken): TranscriberLike =>
          MOCK
            ? new MockTranscriber((t) => session!.addTurn(t))
            : new LiveTranscriber({
                getToken,
                onTurn: (t) => session!.addTurn(t),
                onStatus: (s) => renderPhase(s === 'connected' ? 'recording' : s === 'reconnecting' ? 'reconnecting' : 'stopping')
              })
      });
      recording = true;
      el.startstop.textContent = 'Stop recording';
      await session.start(sources[Number(el.source.value)], el.title.value || 'Untitled meeting');
    } else {
      recording = false;
      el.startstop.textContent = 'Start recording';
      await session!.stop();
    }
  })();
});

el.uploadLater.addEventListener('click', () => { void session?.uploadLater(); });

void init();
```

Fix the compiled script path: the html above loads `app.js` relative to the compiled tree; after `npm run build` confirm `dist/src/renderer/app.js` exists and the html copied into `dist/src/renderer/` resolves it (both live in the same folder, so use `<script type="module" src="./app.js"></script>` - adjust the html to that and re-run the build).

Note on `session.addTurn`: RecorderSession collects turns internally AND forwards to `onTurn` for rendering; app.ts routes transcriber turns through `addTurn` so both happen.

- [ ] **Step 5: Manual verification (mock, keyless)**

Run: `npm start` then in devtools console confirm no module errors. Relaunch with mock: edit the `win.loadFile` call to append `{ query: { mock: '1' } }`, or open with `?mock=1`. Click Start with any source.
Expected: status goes starting -> recording, canned transcript lines appear every 4 s, Stop finalizes a WAV in `Documents/CivicScribe Recordings/`. Open the WAV in a media player: correct duration, silence or captured audio.

- [ ] **Step 6: Manual verification (system loopback)**

Play any audio on the machine, Start with "System audio (this computer)". In mock mode the transcript is canned, but the WAV must contain the system audio. Play the WAV back to confirm.

- [ ] **Step 7: Commit**

```bash
git add recorder
git commit -m "feat(recorder): capture pipeline, source picker, live transcript UI"
```

---

### Task 8: Database migration

**Files:**
- Create: `supabase/migrations/20260724T000000_capture_mode.sql`

**Interfaces:**
- Consumes: FACT-2 (meetings table name + insert requirements), FACT-5 (board/body table) from the integration map. SQL below uses plan defaults `meetings` / `boards`; substitute per the map. Storage needs no migration - the WAV goes through the app's existing FileStorage (FACT-9).
- Produces: `meetings.capture_mode`, `capture_sessions` table - used by the four API routes.

- [ ] **Step 1: Write the migration**

Match the style of the existing files in `supabase/migrations/` (naming convention, RLS posture). The app accesses the DB server-side, so `capture_sessions` follows whatever RLS pattern the existing tables use - copy it, do not invent a new one.

```sql
-- dual-mode capture: public meetings record locally, private meetings keep the bot
alter table meetings
  add column if not exists capture_mode text not null default 'bot'
  check (capture_mode in ('bot', 'local'));

-- per-board default so recurring public boards start in local mode (skip if FACT-5 = no such table)
alter table boards
  add column if not exists default_capture_mode text not null default 'bot'
  check (default_capture_mode in ('bot', 'local'));

create table if not exists capture_sessions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings(id),
  status text not null default 'recording'
    check (status in ('recording', 'uploading', 'complete', 'failed')),
  storage_path text not null,
  duration_ms bigint,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
-- + RLS statements copied from the pattern the existing tables use
```

- [ ] **Step 2: Apply and verify**

Apply the way the repo's docs say migrations are applied (memory records `supabase db push` against project qohvolrzcijqcfapryee; confirm in the repo README first, and prefer a local stack run before prod if one is configured).
Expected: applies cleanly. Verify: `select capture_mode from meetings limit 1;` and `select * from capture_sessions;` both succeed.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): capture_mode, capture_sessions, recordings bucket"
```

---

### Task 9: API routes - session, token, upload, finalize

**Files:**
- Create: `src/lib/recorder-auth.ts`
- Create: `src/app/api/recorder/session/route.ts`
- Create: `src/app/api/recorder/token/route.ts`
- Create: `src/app/api/recorder/upload/route.ts`
- Create: `src/app/api/recorder/finalize/route.ts`

**Interfaces:**
- Consumes: Task 8 schema; env `ASSEMBLYAI_API_KEY` (already in Railway) and new `RECORDER_API_KEY` (per FACT-8; skip if reusing existing session auth); FACT-2 (meeting insert), FACT-3 (transcript store function), FACT-4 (transcribe job payload), FACT-9 (FileStorage put API).
- Produces: the HTTP contract BackendClient (Task 5) already targets:
  - `POST /api/recorder/session` body `{meetingTitle}` -> `{sessionId, storagePath}`
  - `POST /api/recorder/token` body `{sessionId}` -> `{token, expiresInSeconds}`
  - `POST /api/recorder/upload?sessionId=` raw audio/wav body -> `{ok}`
  - `POST /api/recorder/finalize` body `{sessionId, turns, durationMs, transcriptPending}` -> `{ok}`

Route code below uses the repo's own data-access idiom: wherever a comment says "per FACT-N", call the exact existing function the map recorded (the same one the bot/upload path calls) instead of writing raw queries a second way. Follow the error-shape and handler style of the app's existing `route.ts` files.

- [ ] **Step 1: Auth helper**

`src/lib/recorder-auth.ts` (plan default; if FACT-8 found reusable session auth, implement this helper on top of it instead - the routes only call `requireRecorder`):

```ts
import { NextRequest, NextResponse } from 'next/server';

export function requireRecorder(req: NextRequest): NextResponse | null {
  const key = process.env.RECORDER_API_KEY;
  if (!key || req.headers.get('x-recorder-key') !== key) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
```

- [ ] **Step 2: session route**

`src/app/api/recorder/session/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRecorder } from '@/lib/recorder-auth';

export async function POST(req: NextRequest) {
  const denied = requireRecorder(req);
  if (denied) return denied;

  const { meetingTitle } = await req.json();
  // create the meeting via the SAME function the intake/upload path uses (per FACT-2),
  // passing capture_mode: 'local' and whatever fields that function requires
  const meeting = await createMeeting({ title: meetingTitle ?? 'Untitled meeting', captureMode: 'local' });
  // capture_sessions insert via the repo's DB helper (same client the workers use)
  const session = await createCaptureSession({ meetingId: meeting.id, storagePath: '' });
  const storagePath = `recordings/${session.id}.wav`;
  await updateCaptureSession(session.id, { storagePath });
  return NextResponse.json({ sessionId: session.id, storagePath });
}
```

`createMeeting` here means the repo's real meeting-creation function per FACT-2; `createCaptureSession`/`updateCaptureSession` are small helpers to add next to the repo's existing DB access code, in its idiom. Do not hand-roll a second DB client.

- [ ] **Step 3: token route**

`src/app/api/recorder/token/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRecorder } from '@/lib/recorder-auth';

export async function POST(req: NextRequest) {
  const denied = requireRecorder(req);
  if (denied) return denied;

  const { sessionId } = await req.json();
  const session = await getCaptureSession(sessionId);
  if (!session) return NextResponse.json({ error: 'unknown session' }, { status: 404 });

  // endpoint per Task 4 Step 0 verification
  const r = await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=600', {
    headers: { Authorization: process.env.ASSEMBLYAI_API_KEY! }
  });
  if (!r.ok) return NextResponse.json({ error: 'token mint failed' }, { status: 502 });
  const { token } = await r.json();
  return NextResponse.json({ token, expiresInSeconds: 600 });
}
```

- [ ] **Step 4: upload route**

`src/app/api/recorder/upload/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRecorder } from '@/lib/recorder-auth';

export async function POST(req: NextRequest) {
  const denied = requireRecorder(req);
  if (denied) return denied;

  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const session = sessionId ? await getCaptureSession(sessionId) : null;
  if (!session) return NextResponse.json({ error: 'unknown session' }, { status: 404 });

  const bytes = Buffer.from(await req.arrayBuffer());
  // store via the app's FileStorage abstraction per FACT-9 (same put the upload path uses);
  // respect MAX_UPLOAD_MB and reuse its size-limit error shape
  await fileStorage.put(session.storagePath, bytes, 'audio/wav');
  await updateCaptureSession(session.id, { status: 'uploading' });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: finalize route**

`src/app/api/recorder/finalize/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRecorder } from '@/lib/recorder-auth';

export async function POST(req: NextRequest) {
  const denied = requireRecorder(req);
  if (denied) return denied;

  const { sessionId, turns, durationMs, transcriptPending } = await req.json();
  const session = await getCaptureSession(sessionId);
  if (!session) return NextResponse.json({ error: 'unknown session' }, { status: 404 });

  if (!transcriptPending) {
    // live path: store the transcript with the SAME function the transcribe worker
    // uses when it finishes a job (per FACT-3), source-tagged 'local',
    // then enqueue a summarize job exactly as the pipeline does:
    // insert into jobs(meeting_id, type, payload) values (meetingId, 'summarize', '{}')
    const text = (turns as { text: string }[]).map((t) => t.text).join('\n');
    await storeTranscript(session.meetingId, text, 'local');
    await enqueueJob(session.meetingId, 'summarize', {});
  } else {
    // offline path: the wav is already in FileStorage (upload route);
    // enqueue a transcribe job with the payload shape per FACT-4 pointing at that file.
    // The existing worker hands AssemblyAI a signed URL and chains into summarize.
    await enqueueJob(session.meetingId, 'transcribe', transcribePayloadFor(session.storagePath));
  }
  await updateCaptureSession(session.id, { status: 'complete', durationMs, completedAt: new Date() });
  return NextResponse.json({ ok: true });
}
```

`storeTranscript`, `enqueueJob`, `transcribePayloadFor` = the repo's real functions per FACT-3/FACT-4. If the transcribe job does NOT auto-chain into summarize (FACT-4 says), enqueue both here the way the intake path does.

- [ ] **Step 6: Local smoke test**

Run the app locally (`npm run dev` + worker per the repo README, `RECORDER_API_KEY=devkey` in `.env.local`):

```bash
curl -s -X POST "http://localhost:3000/api/recorder/session" -H "x-recorder-key: devkey" -H "Content-Type: application/json" -d "{\"meetingTitle\":\"smoke\"}"
```

Expected: `{"sessionId":"<uuid>","storagePath":"recordings/<uuid>.wav"}`. Then the token route with that sessionId returns `{"token":"...","expiresInSeconds":600}` (needs a real ASSEMBLYAI_API_KEY in `.env.local`; without it expect the 502, which also proves auth and lookup). A request without the header returns 401.

If the repo's test suite covers API routes, add route tests in its idiom: 401 without key, 404 unknown session, finalize enqueues the right job rows (mock the DB helpers). Run the full suite.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/recorder src/lib/recorder-auth.ts
git commit -m "feat(api): recorder session, token mint, upload, finalize routes"
```

---

### Task 10: Prove the jobs handoff + deploy

**Files:**
- Modify: none expected (fixes only if Step 1 finds a gap)

**Interfaces:**
- Consumes: everything backend (Tasks 8-9).
- Produces: verified end-to-end pipeline + deployed prod backend.

- [ ] **Step 1: Prove it end to end locally**

With the local app + worker running: create a session via curl, POST a short real WAV to the upload route, then finalize with `transcriptPending: true`.
Expected: the tick loop claims the transcribe job within ~5 s, a transcript row appears, a summary follows (or the chained summarize job does). Then repeat with `transcriptPending: false` and canned turns; expected: transcript row + summarize job -> summary. Both paths land where bot-path output lands.

- [ ] **Step 2: Deploy + prod smoke**

Set `RECORDER_API_KEY` in the Railway service env first, then from the repo on master:

```bash
$env:RAILWAY_API_TOKEN = <from .env>
railway up --service civicscribe --ci
```

Smoke: the session-create curl against civicscribe-production.up.railway.app returns a sessionId; `/api/health` still `{ok}`; a request without the header gets 401.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "feat(backend): local capture flows through the jobs pipeline, deployed"
```

---

### Task 11: Real-mode recorder run (live AssemblyAI)

**Files:**
- Create: `recorder/src/renderer/recorder-config.json` on this machine only (gitignored - add `recorder/**/recorder-config.json` to .gitignore) with the prod baseUrl + the RECORDER_API_KEY value; `scripts/copy-static.mjs` gains one line copying it into dist when present.

**Interfaces:**
- Consumes: everything.
- Produces: verified live path.

- [ ] **Step 1: Write the config, rebuild, run without mock**

Run: `npm start` (no `?mock=1`). The recorder loads recorder-config.json and talks to prod (or point baseUrl at localhost:3000 to rehearse against the dev stack first - do that once before touching prod).

- [ ] **Step 2: Live smoke: speak into a mic for 60 seconds**

Expected: turns appear within a few seconds of each pause; Stop -> uploading -> done; `capture_sessions.status='complete'`; WAV in the bucket; transcript row present; summary generated (Task 10).

- [ ] **Step 3: Kill the network mid-recording (airplane mode / pull cable)**

Expected: status shows reconnecting, local WAV keeps growing; restore network: reconnects and resumes turns. Then Stop and confirm a complete upload.

- [ ] **Step 4: Offline-from-start**

Start with network off.
Expected: localOnly mode, recording works, Stop -> done with "Upload recording" visible. Restore network, click Upload recording.
Expected: the transcribe job runs on the existing pipeline; within minutes the transcript row appears, summarize follows, and capture_sessions.status flips to complete.

- [ ] **Step 5: Commit any fixes**

```bash
git add recorder .gitignore
git commit -m "feat(recorder): machine-local config; verified live, drop, and offline paths"
```

---

### Task 12: Web app public/private toggle

**Files:**
- Modify: FACT-6 file (meeting create form) and, if FACT-5 = yes, the board settings form.

**Interfaces:**
- Consumes: FACT-5, FACT-6; `meetings.capture_mode`, `boards.default_capture_mode` (Task 8).
- Produces: operators choose "Public (no bot, local recorder)" vs "Private (bot joins)" per meeting; new meetings default from their board.

- [ ] **Step 1: Add the control to the meeting form**

Shape (adapt to the FACT-6 file's stack and idiom; this is the required behavior, not literal paste):

```
Capture: ( ) Public meeting - record locally with the CivicScribe Recorder, no bot
         ( ) Private meeting - the CivicScribe bot joins the call
default = the board's default_capture_mode, else 'bot'
writes meetings.capture_mode
```

Copy rule: never present the local option as covert. Label it "recorded by the clerk's recorder" style language, because the Open Meeting Law posture depends on it being an announced public recording.

- [ ] **Step 2: Gate the bot dispatch**

At the FACT-1 site where the Recall bot is dispatched, skip dispatch when `capture_mode = 'local'`. This is the only touch to the bot path in the whole plan.

- [ ] **Step 3: Test**

If the web app has a test suite (check in Task 0), add: creating a meeting with `capture_mode='local'` does not call the bot dispatch (mock it), and the form defaults from the board. Run the suite.
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add <FACT-6 paths>
git commit -m "feat(web): per-meeting public/private capture toggle, bot skipped for local mode"
```

---

### Task 13: Ship gate - manual matrix + docs

**Files:**
- Create: `docs/superpowers/plans/2026-07-24-recorder-test-matrix.md`
- Modify: repo README (recorder section: install, mock mode, source-picker guidance)

**Interfaces:**
- Consumes: everything.
- Produces: the evidence that this is done. Record results (date, machine, pass/fail, notes) in the matrix file. Open-engine rule applies: no done without these receipts.

- [ ] **Step 1: Run and record the matrix**

| # | Scenario | Source | Expectation |
|---|----------|--------|-------------|
| 1 | Real Zoom/Teams call from this machine | System audio | Live turns for all speakers, clean WAV, summary lands |
| 2 | Chamber simulation: external mic or line-in | Input device | Live turns, clean WAV, summary lands |
| 3 | Hybrid: call audio + room voice on the same machine | System audio | Both remote and local speakers transcribed |
| 4 | Mid-meeting network drop (repeat of Task 11 Step 3) | Either | No audio lost; recovers or batch path completes |
| 5 | Keyless demo | Mock mode | Full UI flow with canned transcript, no keys configured |

- [ ] **Step 2: README section**

Document: prerequisites, `npm start`, mock mode, choosing System audio vs an input device per meeting format, where local WAVs live, and the IT heads-up note for chamber-PC installs.

- [ ] **Step 3: Final commit + update open-engine**

```bash
git add docs README.md
git commit -m "docs(recorder): test matrix results and operator guide"
```

Close/annotate the open-engine task for this build (search `oe list` for "recorder") with the matrix file as the receipt.

---

## Execution notes

- Tasks 2-6 are pure-logic TDD and can run in any order after Task 1 (2 and 3 have no deps on 4-6). Task 7 needs all of 2-6. Tasks 8-10 are backend and can proceed in parallel with 2-7 after Task 0. Task 11 needs everything before it. 12 and 13 close it out.
- Never parallel-edit the same file across agents.
- The AssemblyAI streaming shapes get verified once (Task 4 Step 0) and any corrections propagate to Task 9's token route. The batch path needs no verification - it reuses the app's existing, prod-proven transcribe pipeline.
