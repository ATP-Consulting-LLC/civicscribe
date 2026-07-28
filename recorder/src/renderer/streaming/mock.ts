// Keyless fake transcriber. Mirrors the app's MOCK_MODE philosophy (DECISIONS
// #2/#4): the whole recorder must be demonstrable end to end with zero API keys.
// Emits canned civic lines on a timer and discards the audio.

import type { TranscriptTurn } from "../../shared/types";
import type { TranscriberLike, TranscriberStatus } from "./assemblyai";

const LINES: Array<[string, string]> = [
  ["A", "Call to order at seven o'clock."],
  ["A", "Roll call: all members present."],
  ["B", "Motion to approve the minutes of the previous meeting."],
  ["C", "Second."],
  ["A", "All in favor? The motion carries unanimously."],
  ["B", "Next item: the fiscal year capital plan."],
];

const INTERVAL_MS = 4000;

export class MockTranscriber implements TranscriberLike {
  private timer: ReturnType<typeof setInterval> | null = null;
  private i = 0;

  constructor(
    private readonly onTurn: (t: TranscriptTurn) => void,
    private readonly onStatus?: (s: TranscriberStatus) => void
  ) {}

  async start(): Promise<void> {
    this.onStatus?.("connected");
    this.timer = setInterval(() => {
      const [speaker, text] = LINES[this.i % LINES.length];
      this.onTurn({
        order: this.i,
        text,
        startMs: this.i * INTERVAL_MS,
        endMs: this.i * INTERVAL_MS + 3500,
        final: true,
        speaker,
      });
      this.i++;
    }, INTERVAL_MS);
  }

  sendAudio(): void {
    // Discarded in mock mode.
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.onStatus?.("closed");
  }
}
