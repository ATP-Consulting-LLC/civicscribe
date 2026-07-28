// POST /api/recorder/upload?meetingId=... - store the local WAV safety copy.
//
// The recorder always writes a full-quality WAV to disk while it streams, so
// even if every live turn was lost to a bad connection the meeting can still be
// transcribed from this file. Body is the raw audio, not multipart: there is no
// browser form here, just the desktop client.
//
// Storage goes through the same FileStorage abstraction the upload route uses,
// so this works against local disk in mock mode and Supabase Storage in prod.

import { NextResponse } from "next/server";
import { getStore, getFileStorage } from "@/lib/store";
import { getConfig } from "@/lib/config";
import { requireRecorderMeeting } from "@/lib/recorder/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const meetingId = new URL(request.url).searchParams.get("meetingId");

  const gate = await requireRecorderMeeting(request, meetingId);
  if (!gate.ok) return gate.response;
  const { meeting } = gate;

  const maxBytes = getConfig().maxUploadMb * 1024 * 1024;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    return NextResponse.json(
      { error: `recording exceeds the ${getConfig().maxUploadMb} MB limit` },
      { status: 413 }
    );
  }

  const data = Buffer.from(await request.arrayBuffer());
  if (data.length === 0) {
    return NextResponse.json({ error: "empty recording" }, { status: 400 });
  }
  if (data.length > maxBytes) {
    return NextResponse.json(
      { error: `recording exceeds the ${getConfig().maxUploadMb} MB limit` },
      { status: 413 }
    );
  }

  const storagePath = `meetings/${meeting.id}/audio.wav`;
  await getFileStorage().put(storagePath, data, "audio/wav");
  await getStore().updateMeeting(meeting.id, {
    audio_storage_path: storagePath,
  });

  return NextResponse.json({ ok: true, storagePath, bytes: data.length });
}
