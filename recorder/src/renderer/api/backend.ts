// Talks to the CivicScribe app's /api/recorder/* routes.
//
// Auth mirrors the app's existing shared-secret pattern (src/lib/auth.ts): send
// the secret as a Bearer token. When no secret is configured we send no header
// at all, which is exactly what mock/dev mode expects.

import type { SessionInfo, TranscriptTurn } from "../../shared/types";

export interface NewSessionInput {
  title: string;
  bodyName: string;
}

export interface BackendClientLike {
  createSession(input: NewSessionInput): Promise<SessionInfo>;
  getStreamingToken(meetingId: string): Promise<string>;
  postLiveTurn(meetingId: string, turn: TranscriptTurn): Promise<void>;
  uploadAudio(meetingId: string, bytes: ArrayBuffer): Promise<void>;
  finalize(
    meetingId: string,
    turns: TranscriptTurn[],
    durationMs: number,
    transcriptPending: boolean
  ): Promise<void>;
}

export class BackendClient implements BackendClientLike {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string
  ) {}

  private headers(contentType: string): Record<string, string> {
    const h: Record<string, string> = { "content-type": contentType };
    if (this.secret) h.authorization = `Bearer ${this.secret}`;
    return h;
  }

  private async post<T>(
    path: string,
    body: BodyInit,
    contentType: string
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(contentType),
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${path} failed: HTTP ${res.status} ${text}`.trim());
    }
    return (await res.json()) as T;
  }

  private postJson<T>(path: string, body: unknown): Promise<T> {
    return this.post<T>(path, JSON.stringify(body), "application/json");
  }

  createSession(input: NewSessionInput): Promise<SessionInfo> {
    return this.postJson<SessionInfo>("/api/recorder/session", input);
  }

  async getStreamingToken(meetingId: string): Promise<string> {
    const { token } = await this.postJson<{ token: string }>(
      "/api/recorder/token",
      { meetingId }
    );
    return token;
  }

  /** Hot path: one finalized turn, pushed the moment it lands so the PUBLIC
   *  live page follows the meeting in real time. */
  async postLiveTurn(meetingId: string, turn: TranscriptTurn): Promise<void> {
    await this.postJson("/api/recorder/live", { meetingId, turn });
  }

  async uploadAudio(meetingId: string, bytes: ArrayBuffer): Promise<void> {
    await this.post(
      `/api/recorder/upload?meetingId=${encodeURIComponent(meetingId)}`,
      bytes,
      "audio/wav"
    );
  }

  async finalize(
    meetingId: string,
    turns: TranscriptTurn[],
    durationMs: number,
    transcriptPending: boolean
  ): Promise<void> {
    await this.postJson("/api/recorder/finalize", {
      meetingId,
      turns,
      durationMs,
      transcriptPending,
    });
  }
}
