// POST /api/recorder/token - mint a short-lived AssemblyAI streaming token.
//
// The desktop recorder never holds the API key: it is distributed software, and
// a key in a shipped bundle is a leaked key. The server exchanges its own key
// for a token with a short redemption window, scoped to one WebSocket.
//
// requireRecorderMeeting is what makes this the enforcement point: no token is
// issued unless the target meeting is a public local capture.

import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { requireRecorderMeeting } from "@/lib/recorder/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Redemption window for the token, in seconds (API maximum is 600). */
const EXPIRES_IN_SECONDS = 300;
/** Cap on the streaming session this token can open. 3h covers a long meeting. */
const MAX_SESSION_SECONDS = 10800;

export async function POST(request: Request): Promise<NextResponse> {
  let body: { meetingId?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const gate = await requireRecorderMeeting(request, body.meetingId);
  if (!gate.ok) return gate.response;

  const config = getConfig();
  if (config.mockMode) {
    // Keyless demo: the recorder uses its mock transcriber and never opens a
    // socket, but returning a shaped response keeps the client path identical.
    return NextResponse.json({
      token: "mock-streaming-token",
      expiresInSeconds: EXPIRES_IN_SECONDS,
    });
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ASSEMBLYAI_API_KEY is not configured" },
      { status: 503 }
    );
  }

  const url =
    `https://streaming.assemblyai.com/v3/token` +
    `?expires_in_seconds=${EXPIRES_IN_SECONDS}` +
    `&max_session_duration_seconds=${MAX_SESSION_SECONDS}`;

  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(
      `[recorder:token] AssemblyAI token mint failed HTTP ${res.status}: ${detail.slice(0, 200)}`
    );
    return NextResponse.json({ error: "token mint failed" }, { status: 502 });
  }

  const json = (await res.json()) as { token?: string };
  if (!json.token) {
    return NextResponse.json({ error: "token mint returned no token" }, { status: 502 });
  }

  return NextResponse.json({
    token: json.token,
    expiresInSeconds: EXPIRES_IN_SECONDS,
  });
}
