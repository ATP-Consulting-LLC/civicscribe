import { describe, it, expect, vi } from "vitest";
import {
  RecorderSession,
  type SessionDeps,
  type AudioPipe,
} from "../src/renderer/state/session";
import type {
  CaptureSource,
  RecorderPhase,
  TranscriptTurn,
} from "../src/shared/types";

const SOURCE: CaptureSource = {
  kind: "input",
  deviceId: "d1",
  label: "USB Mic",
};

const TURN: TranscriptTurn = {
  order: 0,
  text: "Call to order.",
  startMs: 0,
  endMs: 500,
  final: true,
  speaker: "A",
};

function makeDeps(opts: { createSessionFails?: boolean } = {}) {
  let pcmCb: ((pcm: Int16Array) => void) | null = null;
  const phases: RecorderPhase[] = [];
  const rendered: TranscriptTurn[] = [];
  const sentAudio: Int16Array[] = [];

  const transcriber = {
    start: vi.fn(async () => {}),
    sendAudio: vi.fn((p: Int16Array) => {
      sentAudio.push(p);
    }),
    stop: vi.fn(async () => {}),
  };

  const backend = {
    createSession: vi.fn(async () => {
      if (opts.createSessionFails) throw new Error("offline");
      return { meetingId: "m1", storagePath: "recordings/m1.wav" };
    }),
    getStreamingToken: vi.fn(async () => "tok"),
    postLiveTurn: vi.fn(async () => {}),
    uploadAudio: vi.fn(async () => {}),
    finalize: vi.fn(async () => {}),
  };

  const native = {
    startRecording: vi.fn(async () => "C:/rec/m1.wav"),
    audioChunk: vi.fn(),
    finalizeRecording: vi.fn(async () => ({
      path: "C:/rec/m1.wav",
      bytes: 64044,
      durationMs: 2000,
    })),
    readRecordingBytes: vi.fn(async () => new ArrayBuffer(64044)),
  };

  const pipe: AudioPipe = {
    onPcm: (cb) => {
      pcmCb = cb;
    },
    stop: vi.fn(async () => {}),
  };

  const deps: SessionDeps = {
    backend,
    makeTranscriber: () => transcriber,
    native,
    openPipe: vi.fn(async () => pipe),
    onPhase: (p) => phases.push(p),
    onTurn: (t) => rendered.push(t),
  };

  return {
    deps,
    backend,
    native,
    transcriber,
    phases,
    rendered,
    sentAudio,
    feedPcm: (p: Int16Array) => pcmCb?.(p),
  };
}

describe("RecorderSession", () => {
  it("start pipes audio to both the transcriber and the local wav", async () => {
    const { deps, native, phases, feedPcm, sentAudio } = makeDeps();
    const s = new RecorderSession(deps);
    await s.start(SOURCE, { title: "Council", bodyName: "City Council" });
    expect(phases).toEqual(["starting", "recording"]);
    feedPcm(new Int16Array([1, 2]));
    expect(sentAudio.length).toBe(1);
    expect(native.audioChunk).toHaveBeenCalledTimes(1);
  });

  it("pushes each turn to the public live page as it arrives", async () => {
    const { deps, backend, rendered } = makeDeps();
    const s = new RecorderSession(deps);
    await s.start(SOURCE, { title: "t", bodyName: "b" });
    s.addTurn(TURN);
    // rendered locally for the operator AND posted for the public live page
    expect(rendered).toEqual([TURN]);
    await vi.waitFor(() =>
      expect(backend.postLiveTurn).toHaveBeenCalledWith("m1", TURN)
    );
  });

  it("a failed live post never breaks the recording", async () => {
    const { deps, backend, rendered } = makeDeps();
    backend.postLiveTurn = vi.fn(async () => {
      throw new Error("network blip");
    });
    const s = new RecorderSession(deps);
    await s.start(SOURCE, { title: "t", bodyName: "b" });
    expect(() => s.addTurn(TURN)).not.toThrow();
    expect(rendered).toEqual([TURN]);
  });

  it("stop uploads, finalizes with the collected turns, and reports done", async () => {
    const { deps, backend, phases } = makeDeps();
    const s = new RecorderSession(deps);
    await s.start(SOURCE, { title: "t", bodyName: "b" });
    s.addTurn(TURN);
    await s.stop();
    expect(backend.uploadAudio).toHaveBeenCalledWith(
      "m1",
      expect.any(ArrayBuffer)
    );
    expect(backend.finalize).toHaveBeenCalledWith(
      "m1",
      [TURN],
      2000,
      false
    );
    expect(phases).toEqual([
      "starting",
      "recording",
      "stopping",
      "uploading",
      "done",
    ]);
  });

  it("offline start falls back to local-only and still records to disk", async () => {
    const { deps, native, phases, backend } = makeDeps({
      createSessionFails: true,
    });
    const s = new RecorderSession(deps);
    await s.start(SOURCE, { title: "t", bodyName: "b" });
    expect(s.localOnly).toBe(true);
    expect(native.startRecording).toHaveBeenCalled();
    expect(backend.getStreamingToken).not.toHaveBeenCalled();
    expect(phases).toEqual(["starting", "recording"]);
  });

  it("local-only stop finishes without touching the network", async () => {
    const { deps, backend, phases } = makeDeps({ createSessionFails: true });
    const s = new RecorderSession(deps);
    await s.start(SOURCE, { title: "t", bodyName: "b" });
    await s.stop();
    expect(backend.uploadAudio).not.toHaveBeenCalled();
    expect(phases[phases.length - 1]).toBe("done");
    expect(s.pendingUpload).toBe(true);
  });

  it("uploadLater creates the session and finalizes as transcript-pending", async () => {
    const { deps, backend } = makeDeps({ createSessionFails: true });
    const s = new RecorderSession(deps);
    await s.start(SOURCE, { title: "Late", bodyName: "Board" });
    await s.stop();
    backend.createSession = vi.fn(async () => ({
      meetingId: "m9",
      storagePath: "recordings/m9.wav",
    }));
    await s.uploadLater();
    expect(backend.uploadAudio).toHaveBeenCalledWith(
      "m9",
      expect.any(ArrayBuffer)
    );
    expect(backend.finalize).toHaveBeenCalledWith("m9", [], 2000, true);
  });

  it("upload failure lands in error and keeps the recording retryable", async () => {
    const { deps, backend, phases } = makeDeps();
    backend.uploadAudio = vi.fn(async () => {
      throw new Error("net down");
    });
    const s = new RecorderSession(deps);
    await s.start(SOURCE, { title: "t", bodyName: "b" });
    await s.stop();
    expect(phases[phases.length - 1]).toBe("error");
    expect(s.pendingUpload).toBe(true);
  });
});
