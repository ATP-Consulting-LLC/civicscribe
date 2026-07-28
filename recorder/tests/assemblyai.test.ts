import { describe, it, expect, vi } from "vitest";
import { LiveTranscriber } from "../src/renderer/streaming/assemblyai";
import type { TranscriptTurn } from "../src/shared/types";

class FakeWS {
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: (ArrayBuffer | string)[] = [];
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(d: ArrayBuffer | string): void {
    this.sent.push(d);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  message(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

function make() {
  FakeWS.instances = [];
  const turns: TranscriptTurn[] = [];
  const statuses: string[] = [];
  let tokenCount = 0;
  const getToken = vi.fn(async () => `tok-${++tokenCount}`);
  const t = new LiveTranscriber({
    getToken,
    onTurn: (turn) => turns.push(turn),
    onStatus: (s) => statuses.push(s),
    wsFactory: (url) => new FakeWS(url) as unknown as WebSocket,
    reconnectDelaysMs: [0],
  });
  return { t, turns, statuses, getToken };
}

/** A realistic v3 Turn payload. Timings live on words, not the turn. */
function turnMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: "Turn",
    turn_order: 0,
    end_of_turn: true,
    turn_is_formatted: true,
    transcript: "Call to order.",
    speaker_label: "A",
    words: [
      { text: "Call", start: 1000, end: 1200, word_is_final: true },
      { text: "to", start: 1250, end: 1350, word_is_final: true },
      { text: "order.", start: 1400, end: 1900, word_is_final: true },
    ],
    ...overrides,
  };
}

describe("LiveTranscriber", () => {
  it("connects with a fetched token and the required v3 params", async () => {
    const { t, statuses } = make();
    await t.start();
    const ws = FakeWS.instances[0];
    expect(ws.url).toContain("wss://streaming.assemblyai.com/v3/ws");
    expect(ws.url).toContain("token=tok-1");
    expect(ws.url).toContain("sample_rate=16000");
    expect(ws.url).toContain("encoding=pcm_s16le");
    // speech_model is required by the v3 API
    expect(ws.url).toContain("speech_model=universal-streaming-english");
    // formatted turns give punctuation/casing, which a public transcript needs
    expect(ws.url).toContain("format_turns=true");
    ws.open();
    expect(statuses).toContain("connected");
  });

  it("forwards audio as binary frames once open", async () => {
    const { t } = make();
    await t.start();
    const ws = FakeWS.instances[0];
    ws.open();
    t.sendAudio(new Int16Array([1, 2, 3]));
    expect(ws.sent.length).toBe(1);
    expect(ws.sent[0]).toBeInstanceOf(ArrayBuffer);
  });

  it("derives turn timings from words and captures the speaker", async () => {
    const { t, turns } = make();
    await t.start();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.message(turnMessage());
    expect(turns.length).toBe(1);
    expect(turns[0]).toEqual({
      order: 0,
      text: "Call to order.",
      startMs: 1000,
      endMs: 1900,
      final: true,
      speaker: "A",
    });
  });

  it("ignores partial turns and empty transcripts", async () => {
    const { t, turns } = make();
    await t.start();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.message(turnMessage({ end_of_turn: false }));
    ws.message(turnMessage({ transcript: "" }));
    ws.message({ type: "Begin", id: "sess-1" });
    ws.message("not json at all");
    expect(turns.length).toBe(0);
  });

  it("survives a Turn with no words array", async () => {
    const { t, turns } = make();
    await t.start();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.message({ type: "Turn", end_of_turn: true, transcript: "hi", turn_order: 4 });
    expect(turns[0]).toMatchObject({ order: 4, text: "hi", startMs: 0, endMs: 0, speaker: null });
  });

  it("buffers audio while down, refetches a token, and flushes on reconnect", async () => {
    const { t, statuses, getToken } = make();
    await t.start();
    const ws1 = FakeWS.instances[0];
    ws1.open();
    ws1.close();
    t.sendAudio(new Int16Array([1]));
    t.sendAudio(new Int16Array([2]));
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(2));
    const ws2 = FakeWS.instances[1];
    ws2.open();
    expect(ws2.sent.length).toBe(2);
    expect(ws2.url).toContain("token=tok-2");
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(["connected", "reconnecting", "connected"]);
  });

  it("caps the reconnect buffer instead of growing without bound", async () => {
    const { t } = make();
    await t.start();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.close();
    for (let i = 0; i < 7000; i++) t.sendAudio(new Int16Array([i]));
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(2));
    const ws2 = FakeWS.instances[1];
    ws2.open();
    expect(ws2.sent.length).toBeLessThanOrEqual(6000);
  });

  it("stop() sends Terminate and does not reconnect", async () => {
    const { t, statuses } = make();
    await t.start();
    const ws = FakeWS.instances[0];
    ws.open();
    await t.stop();
    expect(
      ws.sent.some((m) => typeof m === "string" && m.includes("Terminate"))
    ).toBe(true);
    ws.close();
    expect(FakeWS.instances.length).toBe(1);
    expect(statuses).toContain("closed");
  });
});
