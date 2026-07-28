// POST /api/recorder/session - open a local (no-bot) recording.
//
// Creates the meeting the desktop recorder will stream into. Deliberately does
// NOT go through createAndEnqueueCapture: that enqueues a capture job, which is
// how a bot gets dispatched. A local recording has no bot and no URL to join -
// the operator is the capture device - so the meeting starts life in
// "capturing" and the pipeline picks it up at finalize.

import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { checkRecorderAuth } from "@/lib/recorder/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const denied = checkRecorderAuth(request);
  if (denied) return denied;

  let body: { title?: unknown; bodyName?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const title =
    typeof body.title === "string" && body.title.trim() !== ""
      ? body.title.trim()
      : "Untitled meeting";
  const bodyName =
    typeof body.bodyName === "string" && body.bodyName.trim() !== ""
      ? body.bodyName.trim()
      : title;

  const store = getStore();
  const meeting = await store.createMeeting({
    title,
    body_name: bodyName,
    source_type: "local",
    source_url: null,
    // The recorder is only ever pointed at open meetings of a public body; the
    // guard enforces this on every subsequent call.
    attestation: "public",
    // Local capture drives the same public live page the bot path does.
    live_enabled: true,
  });

  await store.setMeetingStatus(meeting.id, "capturing");

  return NextResponse.json({
    meetingId: meeting.id,
    storagePath: `recordings/${meeting.id}.wav`,
  });
}
