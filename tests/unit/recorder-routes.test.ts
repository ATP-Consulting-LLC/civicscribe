// /api/recorder/*: the desktop recorder's server surface.
//
// The #1 invariant is the CAPTURE GATE. The recorder is deliberately
// unobtrusive - no bot joins the call and its window is hidden from screen
// capture - which is appropriate for an open meeting of a public body and NOT
// appropriate for a private conversation (MA all-party consent, G.L. c. 272
// s. 99). So every route that touches a meeting must refuse unless that meeting
// is a local capture attested public. These tests pin that down, including the
// case that matters most: a real meeting of the WRONG kind must be rejected.
//
// The #2 invariant is auth: these routes append to the PUBLIC live transcript,
// so a configured secret must be required (and non-mock deploys must have one).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewMeeting } from "@/lib/types";

let dataDir: string;

function jsonReq(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Request {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const LOCAL_MEETING: NewMeeting = {
  title: "City Council",
  body_name: "City Council",
  source_type: "local",
  attestation: "public",
  live_enabled: true,
};

async function seedMeeting(input: NewMeeting) {
  const { getStore } = await import("@/lib/store");
  return getStore().createMeeting(input);
}

beforeEach(async () => {
  vi.resetModules();
  const { makeTempDataDir } = await import("./helpers");
  dataDir = await makeTempDataDir();
  process.env.MOCK_MODE = "true";
  process.env.DATA_DIR = dataDir;
  const g = globalThis as unknown as {
    __civicscribeStore?: unknown;
    __civicscribeFiles?: unknown;
  };
  delete g.__civicscribeStore;
  delete g.__civicscribeFiles;
});

afterEach(async () => {
  delete process.env.MOCK_MODE;
  delete process.env.DATA_DIR;
  delete process.env.RECORDER_SECRET;
  vi.resetModules();
  const { cleanupDataDir } = await import("./helpers");
  await cleanupDataDir(dataDir);
});

describe("the capture gate", () => {
  it("refuses to mint a streaming token for a bot meeting", async () => {
    const meeting = await seedMeeting({
      title: "Private sync",
      body_name: "Staff",
      source_type: "zoom",
      source_url: "https://zoom.us/j/1",
      attestation: "authorized",
    });
    const { POST } = await import("@/app/api/recorder/token/route");
    const res = await POST(
      jsonReq("/api/recorder/token", { meetingId: meeting.id })
    );
    expect(res.status).toBe(403);
  });

  it("refuses a local meeting that was not attested public", async () => {
    const meeting = await seedMeeting({
      ...LOCAL_MEETING,
      attestation: "authorized",
    });
    const { POST } = await import("@/app/api/recorder/token/route");
    const res = await POST(
      jsonReq("/api/recorder/token", { meetingId: meeting.id })
    );
    expect(res.status).toBe(403);
  });

  it("refuses to append a live line to a non-local meeting", async () => {
    const meeting = await seedMeeting({
      title: "Uploaded",
      body_name: "Board",
      source_type: "upload",
      attestation: "public",
    });
    const { POST } = await import("@/app/api/recorder/live/route");
    const res = await POST(
      jsonReq("/api/recorder/live", {
        meetingId: meeting.id,
        turn: { text: "forged line", startMs: 0 },
      })
    );
    expect(res.status).toBe(403);

    const { getStore } = await import("@/lib/store");
    expect(await getStore().listLiveUtterances(meeting.id)).toHaveLength(0);
  });

  it("404s an unknown meeting instead of leaking a gate decision", async () => {
    const { POST } = await import("@/app/api/recorder/live/route");
    const res = await POST(
      jsonReq("/api/recorder/live", {
        meetingId: "no-such-meeting",
        turn: { text: "hi" },
      })
    );
    expect(res.status).toBe(404);
  });

  it("allows a public local meeting through", async () => {
    const meeting = await seedMeeting(LOCAL_MEETING);
    const { POST } = await import("@/app/api/recorder/token/route");
    const res = await POST(
      jsonReq("/api/recorder/token", { meetingId: meeting.id })
    );
    expect(res.status).toBe(200);
  });
});

describe("auth", () => {
  it("rejects a wrong secret and accepts the right one", async () => {
    process.env.RECORDER_SECRET = "s3cret";
    const meeting = await seedMeeting(LOCAL_MEETING);
    const { POST } = await import("@/app/api/recorder/live/route");

    const bad = await POST(
      jsonReq(
        "/api/recorder/live",
        { meetingId: meeting.id, turn: { text: "x" } },
        { authorization: "Bearer wrong" }
      )
    );
    expect(bad.status).toBe(401);

    const good = await POST(
      jsonReq(
        "/api/recorder/live",
        { meetingId: meeting.id, turn: { text: "x" } },
        { authorization: "Bearer s3cret" }
      )
    );
    expect(good.status).toBe(200);
  });
});

describe("POST /api/recorder/session", () => {
  it("creates a local, live-enabled, public meeting and enqueues no capture job", async () => {
    const { POST } = await import("@/app/api/recorder/session/route");
    const res = await POST(
      jsonReq("/api/recorder/session", {
        title: "School Committee",
        bodyName: "School Committee",
      })
    );
    expect(res.status).toBe(200);
    const { meetingId } = (await res.json()) as { meetingId: string };

    const { getStore } = await import("@/lib/store");
    const meeting = await getStore().getMeeting(meetingId);
    expect(meeting).toMatchObject({
      source_type: "local",
      attestation: "public",
      live_enabled: true,
      status: "capturing",
      source_url: null,
    });
    // A capture job is how a bot gets dispatched; a local recording must not
    // create one.
    const job = await getStore().claimNextJob();
    expect(job).toBeNull();
  });
});

describe("POST /api/recorder/live", () => {
  it("appends a turn and stamps live_started_at on the first line", async () => {
    const meeting = await seedMeeting(LOCAL_MEETING);
    const { POST } = await import("@/app/api/recorder/live/route");
    const res = await POST(
      jsonReq("/api/recorder/live", {
        meetingId: meeting.id,
        turn: { text: "Call to order.", startMs: 4200, speaker: "A" },
      })
    );
    expect(res.status).toBe(200);

    const { getStore } = await import("@/lib/store");
    const rows = await getStore().listLiveUtterances(meeting.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      text: "Call to order.",
      speaker_label: "A",
      ts_seconds: 4,
    });
    expect((await getStore().getMeeting(meeting.id))?.live_started_at).not.toBeNull();
  });

  it("ignores an empty turn without erroring", async () => {
    const meeting = await seedMeeting(LOCAL_MEETING);
    const { POST } = await import("@/app/api/recorder/live/route");
    const res = await POST(
      jsonReq("/api/recorder/live", {
        meetingId: meeting.id,
        turn: { text: "   " },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ appended: false });
  });
});

describe("POST /api/recorder/finalize", () => {
  it("persists the live turns as the transcript and queues summarize", async () => {
    const meeting = await seedMeeting(LOCAL_MEETING);
    const { POST } = await import("@/app/api/recorder/finalize/route");
    const res = await POST(
      jsonReq("/api/recorder/finalize", {
        meetingId: meeting.id,
        durationMs: 62000,
        transcriptPending: false,
        turns: [
          { text: "Call to order.", startMs: 0, endMs: 1500, speaker: "A" },
          { text: "Motion carries.", startMs: 2000, endMs: 3200, speaker: "B" },
        ],
      })
    );
    expect(res.status).toBe(200);

    const { getStore } = await import("@/lib/store");
    const store = getStore();
    const transcript = await store.getTranscriptByMeeting(meeting.id);
    expect(transcript).not.toBeNull();

    const updated = await store.getMeeting(meeting.id);
    expect(updated?.status).toBe("summarizing");
    expect(updated?.duration_seconds).toBe(62);
    expect(updated?.live_ended_at).not.toBeNull();

    const job = await store.claimNextJob();
    expect(job?.type).toBe("summarize");
  });

  it("falls back to the batch pipeline when the transcript is pending", async () => {
    const meeting = await seedMeeting(LOCAL_MEETING);
    const { getStore } = await import("@/lib/store");
    await getStore().updateMeeting(meeting.id, {
      audio_storage_path: `meetings/${meeting.id}/audio.wav`,
    });

    const { POST } = await import("@/app/api/recorder/finalize/route");
    const res = await POST(
      jsonReq("/api/recorder/finalize", {
        meetingId: meeting.id,
        durationMs: 1000,
        transcriptPending: true,
        turns: [],
      })
    );
    expect(res.status).toBe(200);

    const job = await getStore().claimNextJob();
    expect(job?.type).toBe("transcribe");
  });

  it("fails the meeting when there is neither a transcript nor audio", async () => {
    const meeting = await seedMeeting(LOCAL_MEETING);
    const { POST } = await import("@/app/api/recorder/finalize/route");
    const res = await POST(
      jsonReq("/api/recorder/finalize", {
        meetingId: meeting.id,
        transcriptPending: true,
        turns: [],
      })
    );
    expect(res.status).toBe(400);

    const { getStore } = await import("@/lib/store");
    expect((await getStore().getMeeting(meeting.id))?.status).toBe("failed");
  });
});
