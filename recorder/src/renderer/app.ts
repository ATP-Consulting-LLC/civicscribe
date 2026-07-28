// Wires the UI to the capture pipeline.
//
// Config lives in recorder-config.json next to this file (gitignored, written
// once per machine). Missing config falls back to a local dev server, and
// ?mock=1 runs the whole flow with no keys and no backend.

import { listSources, openPipe } from "./audio/capture";
import { LiveTranscriber, type TranscriberLike } from "./streaming/assemblyai";
import { MockTranscriber } from "./streaming/mock";
import { BackendClient } from "./api/backend";
import { RecorderSession } from "./state/session";
import type {
  CaptureSource,
  RecorderNative,
  RecorderPhase,
  TranscriptTurn,
} from "../shared/types";

declare global {
  interface Window {
    recorderNative: RecorderNative;
  }
}

interface RecorderConfig {
  baseUrl: string;
  secret: string;
}

const MOCK = new URLSearchParams(location.search).has("mock");

async function loadConfig(): Promise<RecorderConfig> {
  try {
    const res = await fetch("./recorder-config.json");
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as RecorderConfig;
  } catch {
    return { baseUrl: "http://localhost:3000", secret: "" };
  }
}

const el = {
  title: document.getElementById("title") as HTMLInputElement,
  body: document.getElementById("body") as HTMLInputElement,
  source: document.getElementById("source") as HTMLSelectElement,
  startstop: document.getElementById("startstop") as HTMLButtonElement,
  uploadLater: document.getElementById("uploadLater") as HTMLButtonElement,
  dot: document.getElementById("dot") as HTMLSpanElement,
  phase: document.getElementById("phase") as HTMLSpanElement,
  publicLink: document.getElementById("public-link") as HTMLSpanElement,
  transcript: document.getElementById("transcript") as HTMLDivElement,
  err: document.getElementById("err") as HTMLDivElement,
  invisible: document.getElementById("invisible") as HTMLInputElement,
};

let config: RecorderConfig = { baseUrl: "http://localhost:3000", secret: "" };
let sources: CaptureSource[] = [];
let session: RecorderSession | null = null;
let recording = false;

function showError(message: string): void {
  el.err.textContent = message;
}

function renderPhase(phase: RecorderPhase): void {
  el.phase.textContent = phase;
  el.dot.className =
    phase === "recording"
      ? "recording"
      : phase === "reconnecting"
        ? "reconnecting"
        : phase === "error"
          ? "error"
          : "";

  // Offer the retry button whenever a finished recording has not landed.
  const stuck = phase === "error" || (phase === "done" && session?.pendingUpload === true);
  el.uploadLater.hidden = !stuck;
  if (phase === "error") {
    showError(
      "Upload failed. The recording is safe on disk - use Upload recording to retry."
    );
  }
}

function renderTurn(turn: TranscriptTurn): void {
  const empty = el.transcript.querySelector(".empty");
  if (empty) empty.remove();

  const p = document.createElement("p");
  if (turn.speaker) {
    const s = document.createElement("span");
    s.className = "spk";
    s.textContent = `${turn.speaker}:`;
    p.appendChild(s);
  }
  p.appendChild(document.createTextNode(turn.text));
  el.transcript.appendChild(p);
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

function showPublicLink(meetingId: string): void {
  el.publicLink.replaceChildren();
  const a = document.createElement("a");
  a.href = `${config.baseUrl}/meetings/${meetingId}/live`;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = "Open public live page";
  el.publicLink.appendChild(a);
}

async function populateSources(): Promise<void> {
  sources = await listSources();
  el.source.replaceChildren();
  sources.forEach((s, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = s.label;
    el.source.appendChild(o);
  });
}

function buildSession(): RecorderSession {
  const backend = new BackendClient(config.baseUrl, config.secret);
  const s: RecorderSession = new RecorderSession({
    backend,
    native: window.recorderNative,
    openPipe,
    onPhase: renderPhase,
    onTurn: renderTurn,
    makeTranscriber: (getToken): TranscriberLike =>
      MOCK
        ? new MockTranscriber((t) => s.addTurn(t))
        : new LiveTranscriber({
            getToken,
            onTurn: (t) => s.addTurn(t),
            onStatus: (status) => {
              if (status === "reconnecting") renderPhase("reconnecting");
              if (status === "connected" && recording) renderPhase("recording");
            },
          }),
  });
  return s;
}

async function startRecording(): Promise<void> {
  showError("");
  el.transcript.replaceChildren();
  el.publicLink.replaceChildren();

  const title = el.title.value.trim() || "Untitled meeting";
  const bodyName = el.body.value.trim() || title;

  session = buildSession();
  recording = true;
  el.startstop.textContent = "Stop recording";

  try {
    await session.start(sources[Number(el.source.value)], { title, bodyName });
  } catch (err) {
    recording = false;
    el.startstop.textContent = "Start recording";
    renderPhase("error");
    showError(err instanceof Error ? err.message : String(err));
    return;
  }

  if (session.localOnly) {
    showError(
      "No connection to CivicScribe. Recording locally - you can upload when the network is back."
    );
  } else if (session.meetingId) {
    showPublicLink(session.meetingId);
  }
}

async function stopRecording(): Promise<void> {
  recording = false;
  el.startstop.textContent = "Start recording";
  el.startstop.disabled = true;
  try {
    await session?.stop();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    el.startstop.disabled = false;
  }
}

el.startstop.addEventListener("click", () => {
  void (recording ? stopRecording() : startRecording());
});

// Screen-share invisibility. Main applies it at window creation too, so the
// window is never briefly capturable on startup; this just keeps the two in sync.
el.invisible.addEventListener("change", () => {
  void window.recorderNative
    .setInvisible(el.invisible.checked)
    .catch((err: unknown) =>
      showError(
        `Could not change screen-share visibility: ${err instanceof Error ? err.message : String(err)}`
      )
    );
});

el.uploadLater.addEventListener("click", () => {
  void (async () => {
    el.uploadLater.disabled = true;
    showError("");
    try {
      await session?.uploadLater();
      if (session?.meetingId) showPublicLink(session.meetingId);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      el.uploadLater.disabled = false;
    }
  })();
});

void (async () => {
  config = await loadConfig();
  if (MOCK) el.phase.textContent = "idle (mock mode)";
  try {
    await populateSources();
  } catch (err) {
    showError(
      `Could not list audio devices: ${err instanceof Error ? err.message : String(err)}`
    );
  }
})();
