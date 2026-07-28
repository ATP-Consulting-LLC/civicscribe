// POST /api/recorder/live - append one finalized turn to the live transcript.
//
// This is the hot path. The desktop recorder posts each turn the moment
// AssemblyAI finalizes it, which is what makes a local recording appear on the
// PUBLIC live page in real time - the same page, component, and rolling catch-up
// recap the bot path already drives. Without this the audience for a public
// meeting would see nothing until the recording ended.
//
// Mirrors the Recall webhook's live ingest (see api/webhooks/recall): tolerate
// odd payloads, never throw, and stamp live_started_at on the first line.

import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { requireRecorderMeeting } from "@/lib/recorder/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TurnPayload {
  text?: unknown;
  startMs?: unknown;
  speaker?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: { meetingId?: unknown; turn?: TurnPayload } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const gate = await requireRecorderMeeting(request, body.meetingId);
  if (!gate.ok) return gate.response;
  const { meeting } = gate;

  const turn = body.turn ?? {};
  const text = typeof turn.text === "string" ? turn.text.trim() : "";
  if (text === "") {
    // Nothing to record, but not an error: the recorder should not retry.
    return NextResponse.json({ appended: false });
  }

  const startMs = typeof turn.startMs === "number" ? turn.startMs : 0;
  const speaker =
    typeof turn.speaker === "string" && turn.speaker.trim() !== ""
      ? turn.speaker.trim()
      : "SPEAKER";

  const store = getStore();
  await store.appendLiveUtterance(meeting.id, {
    speaker_label: speaker,
    text,
    ts_seconds: Math.max(0, Math.round(startMs / 1000)),
  });

  if (meeting.live_started_at == null) {
    await store.updateMeeting(meeting.id, {
      live_started_at: new Date().toISOString(),
    });
  }

  return NextResponse.json({ appended: true });
}
