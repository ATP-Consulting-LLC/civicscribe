// Types shared by the Electron main process and the renderer.

export type CaptureSourceKind = "system" | "input";

export interface CaptureSource {
  kind: CaptureSourceKind;
  /** Only set for kind "input" (a real device from enumerateDevices). */
  deviceId?: string;
  label: string;
}

/** What the server hands back when a recording session is opened. */
export interface SessionInfo {
  meetingId: string;
  storagePath: string;
}

/** One finalized transcript turn. Mirrors what the server needs to build a
 *  live utterance (speaker_label, text, ts_seconds). */
export interface TranscriptTurn {
  order: number;
  text: string;
  startMs: number;
  endMs: number;
  final: boolean;
  /** AssemblyAI speaker label ("A", "B", "UNKNOWN"...) when diarization is on.
   *  Null when unavailable; the server falls back to a generic label. */
  speaker: string | null;
}

export type RecorderPhase =
  | "idle"
  | "starting"
  | "recording"
  | "reconnecting"
  | "stopping"
  | "uploading"
  | "done"
  | "error";

export interface FinalizedRecording {
  path: string;
  bytes: number;
  durationMs: number;
}

/** The IPC surface the preload script exposes to the renderer. */
export interface RecorderNative {
  startRecording(sessionId: string, sampleRate: number): Promise<string>;
  audioChunk(buf: ArrayBuffer): void;
  finalizeRecording(): Promise<FinalizedRecording>;
  readRecordingBytes(): Promise<ArrayBuffer>;
}
