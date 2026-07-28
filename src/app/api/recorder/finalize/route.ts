// POST /api/recorder/finalize - the recording has stopped.
//
// Two paths, both landing exactly where the bot path lands:
//
//  * Normal: the live turns already streamed in, so we persist them as the
//    meeting's transcript (via the same persistTranscription the transcribe
//    stage uses) and enqueue summarize. No second trip to AssemblyAI - the
//    audio was already transcribed once, live.
//
//  * transcriptPending: the recorder was offline during the meeting and has no
//    turns, only the uploaded WAV. Enqueue the ordinary transcribe job and let
//    the existing pipeline do it, exactly like an uploaded file.

import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { persistTranscription } from "@/lib/jobs/persist-transcript";
import { requireRecorderMeeting } from "@/lib/recorder/guard";
import type { DiarizedUtterance } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TurnPayload {
  text?: unknown;
  startMs?: unknown;
  endMs?: unknown;
  speaker?: unknown;
}

function toUtterances(turns: unknown): DiarizedUtterance[] {
  if (!Array.isArray(turns)) return [];
  const out: DiarizedUtterance[] = [];
  for (const raw of turns as TurnPayload[]) {
    const text = typeof raw?.text === "string" ? raw.text.trim() : "";
    if (text === "") continue;
    out.push({
      speaker_label:
        typeof raw.speaker === "string" && raw.speaker.trim() !== ""
          ? raw.speaker.trim()
          : "SPEAKER",
      start_ms: typeof raw.startMs === "number" ? raw.startMs : 0,
      end_ms: typeof raw.endMs === "number" ? raw.endMs : 0,
      text,
    });
  }
  return out;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: {
    meetingId?: unknown;
    turns?: unknown;
    durationMs?: unknown;
    transcriptPending?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const gate = await requireRecorderMeeting(request, body.meetingId);
  if (!gate.ok) return gate.response;
  const { meeting } = gate;

  const store = getStore();
  const durationMs =
    typeof body.durationMs === "number" && body.durationMs > 0
      ? body.durationMs
      : null;

  // Close the live session: the public live page flips from "live" to "ended".
  await store.updateMeeting(meeting.id, {
    live_ended_at: new Date().toISOString(),
    ...(durationMs != null
      ? { duration_seconds: Math.round(durationMs / 1000) }
      : {}),
  });

  const utterances = toUtterances(body.turns);

  if (body.transcriptPending === true || utterances.length === 0) {
    // No usable live transcript. Fall back to the ordinary pipeline, which
    // transcribes the uploaded WAV and chains into summarize.
    if (meeting.audio_storage_path == null) {
      await store.setMeetingStatus(
        meeting.id,
        "failed",
        "recording finalized with no transcript and no audio"
      );
      return NextResponse.json(
        { error: "no transcript and no uploaded audio" },
        { status: 400 }
      );
    }
    await store.setMeetingStatus(meeting.id, "transcribing");
    await store.enqueueJob(meeting.id, "transcribe");
    return NextResponse.json({ ok: true, path: "batch" });
  }

  await persistTranscription(
    store,
    meeting,
    {
      rawJson: { source: "civicscribe-recorder", turns: body.turns },
      language: "en",
      durationSeconds: durationMs != null ? Math.round(durationMs / 1000) : null,
      utterances,
    },
    { diarized: true }
  );

  await store.setMeetingStatus(meeting.id, "summarizing");
  await store.enqueueJob(meeting.id, "summarize");

  return NextResponse.json({ ok: true, path: "live", utterances: utterances.length });
}
