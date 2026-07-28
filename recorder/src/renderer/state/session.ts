// Orchestrates one recording: audio in, transcript out, WAV on disk.
//
// Two rules drive the design:
//  1. The local WAV is written no matter what. Network failures degrade the
//     live transcript, never the recording.
//  2. Turns are pushed to the server the instant they finalize, because the
//     audience for a public meeting is watching the PUBLIC live page, not the
//     operator's laptop screen.

import type { BackendClientLike, NewSessionInput } from "../api/backend";
import type { TranscriberLike } from "../streaming/assemblyai";
import type {
  CaptureSource,
  RecorderNative,
  RecorderPhase,
  SessionInfo,
  TranscriptTurn,
} from "../../shared/types";

export interface AudioPipe {
  onPcm(cb: (pcm: Int16Array) => void): void;
  stop(): Promise<void>;
}

export interface SessionDeps {
  backend: BackendClientLike;
  makeTranscriber(getToken: () => Promise<string>): TranscriberLike;
  native: RecorderNative;
  openPipe(source: CaptureSource): Promise<AudioPipe>;
  onPhase(phase: RecorderPhase): void;
  onTurn(turn: TranscriptTurn): void;
}

export class RecorderSession {
  /** True when the meeting could not be opened on the server (offline start). */
  localOnly = false;
  /** True while a finished recording still needs to reach the server. */
  pendingUpload = false;

  private session: SessionInfo | null = null;
  private transcriber: TranscriberLike | null = null;
  private pipe: AudioPipe | null = null;
  private turns: TranscriptTurn[] = [];
  private durationMs = 0;
  private input: NewSessionInput = { title: "", bodyName: "" };

  constructor(private readonly deps: SessionDeps) {}

  /** The server-side meeting id, once one exists. Null while offline. */
  get meetingId(): string | null {
    return this.session?.meetingId ?? null;
  }

  private setPhase(p: RecorderPhase): void {
    this.deps.onPhase(p);
  }

  async start(source: CaptureSource, input: NewSessionInput): Promise<void> {
    this.input = input;
    this.setPhase("starting");

    try {
      this.session = await this.deps.backend.createSession(input);
    } catch {
      // No network at start: record now, upload later. Nothing is lost.
      this.localOnly = true;
      this.session = null;
    }

    const recordingId = this.session?.meetingId ?? `local-${Date.now()}`;
    await this.deps.native.startRecording(recordingId, 16000);

    if (this.session) {
      const meetingId = this.session.meetingId;
      this.transcriber = this.deps.makeTranscriber(() =>
        this.deps.backend.getStreamingToken(meetingId)
      );
      await this.transcriber.start();
    }

    this.pipe = await this.deps.openPipe(source);
    this.pipe.onPcm((pcm) => {
      this.transcriber?.sendAudio(pcm);
      this.deps.native.audioChunk(
        pcm.buffer.slice(
          pcm.byteOffset,
          pcm.byteOffset + pcm.byteLength
        ) as ArrayBuffer
      );
    });

    this.setPhase("recording");
  }

  /** Called for every finalized turn. Renders locally and pushes to the server
   *  fire-and-forget: a dropped line must never stall the audio pipeline. */
  addTurn(turn: TranscriptTurn): void {
    this.turns.push(turn);
    this.deps.onTurn(turn);
    const meetingId = this.session?.meetingId;
    if (!meetingId) return;
    void this.deps.backend.postLiveTurn(meetingId, turn).catch(() => {
      // The turn is still in this.turns and lands with finalize().
    });
  }

  async stop(): Promise<void> {
    this.setPhase("stopping");
    await this.pipe?.stop();
    await this.transcriber?.stop();
    this.pipe = null;
    this.transcriber = null;

    const rec = await this.deps.native.finalizeRecording();
    this.durationMs = rec.durationMs;
    this.pendingUpload = true;

    if (!this.session) {
      // Offline: hold the file for uploadLater().
      this.setPhase("done");
      return;
    }
    await this.uploadAndFinalize(false);
  }

  /** Offline path, run once the network is back. */
  async uploadLater(): Promise<void> {
    if (!this.session) {
      this.session = await this.deps.backend.createSession(this.input);
    }
    // The live turns never reached the server, so let the normal transcribe
    // pipeline redo them from the uploaded audio.
    await this.uploadAndFinalize(this.localOnly);
  }

  private async uploadAndFinalize(transcriptPending: boolean): Promise<void> {
    this.setPhase("uploading");
    try {
      const bytes = await this.deps.native.readRecordingBytes();
      await this.deps.backend.uploadAudio(this.session!.meetingId, bytes);
      await this.deps.backend.finalize(
        this.session!.meetingId,
        transcriptPending ? [] : this.turns,
        this.durationMs,
        transcriptPending
      );
      this.pendingUpload = false;
      this.setPhase("done");
    } catch {
      // The WAV is untouched on disk; the operator can retry.
      this.setPhase("error");
    }
  }
}
