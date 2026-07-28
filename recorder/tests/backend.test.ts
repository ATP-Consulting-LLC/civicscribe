import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BackendClient } from "../src/renderer/api/backend";
import type { TranscriptTurn } from "../src/shared/types";

interface Call {
  url: string;
  init: RequestInit;
}
const calls: Call[] = [];

function stubFetch(responder: (url: string) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = responder(url);
      if (body === null) {
        return new Response("boom", { status: 500 });
      }
      return Response.json(body);
    })
  );
}

function headerOf(call: Call, name: string): string | undefined {
  return (call.init.headers as Record<string, string> | undefined)?.[name];
}

const TURN: TranscriptTurn = {
  order: 0,
  text: "Call to order.",
  startMs: 1000,
  endMs: 1900,
  final: true,
  speaker: "A",
};

describe("BackendClient", () => {
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a session and sends the shared secret as a Bearer token", async () => {
    stubFetch(() => ({ meetingId: "m1", storagePath: "recordings/m1.wav" }));
    const c = new BackendClient("https://example.test", "k1");
    const s = await c.createSession({
      title: "School Committee",
      bodyName: "School Committee",
    });
    expect(s).toEqual({ meetingId: "m1", storagePath: "recordings/m1.wav" });
    expect(calls[0].url).toBe("https://example.test/api/recorder/session");
    expect(headerOf(calls[0], "authorization")).toBe("Bearer k1");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      title: "School Committee",
      bodyName: "School Committee",
    });
  });

  it("omits the auth header when no secret is configured (mock mode)", async () => {
    stubFetch(() => ({ meetingId: "m1", storagePath: "p" }));
    const c = new BackendClient("https://example.test", "");
    await c.createSession({ title: "t", bodyName: "b" });
    expect(headerOf(calls[0], "authorization")).toBeUndefined();
  });

  it("gets a streaming token", async () => {
    stubFetch(() => ({ token: "aai-tok", expiresInSeconds: 600 }));
    const c = new BackendClient("https://example.test", "k1");
    expect(await c.getStreamingToken("m1")).toBe("aai-tok");
    expect(calls[0].url).toBe("https://example.test/api/recorder/token");
  });

  it("posts a single live turn as it arrives", async () => {
    stubFetch(() => ({ ok: true }));
    const c = new BackendClient("https://example.test", "k1");
    await c.postLiveTurn("m1", TURN);
    expect(calls[0].url).toBe("https://example.test/api/recorder/live");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      meetingId: "m1",
      turn: TURN,
    });
  });

  it("uploads audio bytes as audio/wav", async () => {
    stubFetch(() => ({ ok: true }));
    const c = new BackendClient("https://example.test", "k1");
    await c.uploadAudio("m1", new ArrayBuffer(8));
    expect(calls[0].url).toBe(
      "https://example.test/api/recorder/upload?meetingId=m1"
    );
    expect(headerOf(calls[0], "content-type")).toBe("audio/wav");
  });

  it("finalizes with turns, duration, and the pending flag", async () => {
    stubFetch(() => ({ ok: true }));
    const c = new BackendClient("https://example.test", "k1");
    await c.finalize("m1", [TURN], 2000, false);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      meetingId: "m1",
      turns: [TURN],
      durationMs: 2000,
      transcriptPending: false,
    });
  });

  it("throws with status and body on a non-2xx response", async () => {
    stubFetch(() => null);
    const c = new BackendClient("https://example.test", "k1");
    await expect(c.createSession({ title: "x", bodyName: "y" })).rejects.toThrow(
      /500.*boom/
    );
  });
});
