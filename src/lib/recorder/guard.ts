// Shared gate for the /api/recorder/* routes.
//
// Two checks, and the second one is the important one.
//
// 1. Shared-secret auth, mirroring the Recall webhook: these routes append to
//    the PUBLIC live transcript, so an open endpoint in a public deploy would
//    let anyone forge caption lines onto a meeting.
//
// 2. A meeting is only recordable by the desktop recorder when it is a local
//    (no-bot) capture that the submitter attested is a public meeting.
//
// Why (2) exists: the desktop recorder is deliberately unobtrusive - no bot
// joins the call, and its window is excluded from screen capture. That is
// appropriate for an open meeting of a public body, where recording is lawful
// and the meeting is public by definition. It is NOT appropriate for a private
// conversation: Massachusetts requires all-party consent (G.L. c. 272, s. 99),
// and the visible, self-announcing Recall bot is what supplies that notice on
// the bot path. Enforcing the restriction here - server side, on the only route
// that can mint a transcription token or write a live line - means the rule
// cannot be bypassed by a modified or home-built client.

import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { isAuthorized } from "@/lib/auth";
import { getStore } from "@/lib/store";
import type { Meeting } from "@/lib/types";

/** Auth only. Returns a response to send when the caller is not allowed. */
export function checkRecorderAuth(request: Request): NextResponse | null {
  const config = getConfig();

  // A public deploy MUST configure the secret. Mock mode stays open so the
  // keyless demo and the test suite run unchanged.
  if (!config.mockMode && !config.recorderSecret) {
    return NextResponse.json(
      { error: "recorder not configured" },
      { status: 503 }
    );
  }

  const provided =
    request.headers.get("authorization") ??
    new URL(request.url).searchParams.get("token");
  if (!isAuthorized(provided, config.recorderSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

/** True when this meeting may be captured by the desktop recorder. */
export function isLocallyRecordable(meeting: Meeting): boolean {
  return meeting.source_type === "local" && meeting.attestation === "public";
}

export type RecorderMeetingResult =
  | { ok: true; meeting: Meeting }
  | { ok: false; response: NextResponse };

/**
 * Auth, load the meeting, and confirm it is a public local capture. Every
 * recorder route that touches an existing meeting goes through this.
 */
export async function requireRecorderMeeting(
  request: Request,
  meetingId: unknown
): Promise<RecorderMeetingResult> {
  const denied = checkRecorderAuth(request);
  if (denied) return { ok: false, response: denied };

  if (typeof meetingId !== "string" || meetingId === "") {
    return {
      ok: false,
      response: NextResponse.json({ error: "meetingId required" }, { status: 400 }),
    };
  }

  const meeting = await getStore().getMeeting(meetingId);
  if (!meeting) {
    return {
      ok: false,
      response: NextResponse.json({ error: "meeting not found" }, { status: 404 }),
    };
  }

  if (!isLocallyRecordable(meeting)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "local recording is limited to public meetings captured with source_type 'local'",
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true, meeting };
}
