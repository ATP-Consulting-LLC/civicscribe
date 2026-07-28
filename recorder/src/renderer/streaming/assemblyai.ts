// AssemblyAI Universal-Streaming (v3) client.
//
// Never holds an API key: it calls getToken() for a short-lived streaming token
// that the CivicScribe server mints. On an unexpected close it reconnects with
// backoff, fetching a FRESH token each time (tokens are single-use redemption
// windows), and buffers audio in the meantime so a blip does not punch a hole in
// the transcript. The local WAV is the real safety net; this buffer just covers
// short drops.

import type { TranscriptTurn } from "../../shared/types";

export interface TranscriberLike {
  start(): Promise<void>;
  sendAudio(pcm: Int16Array): void;
  stop(): Promise<void>;
}

export type TranscriberStatus = "connected" | "reconnecting" | "closed";

export interface TranscriberOpts {
  getToken: () => Promise<string>;
  onTurn: (turn: TranscriptTurn) => void;
  onStatus: (status: TranscriberStatus) => void;
  /** Injected in tests. */
  wsFactory?: (url: string) => WebSocket;
  sampleRate?: number;
  reconnectDelaysMs?: number[];
}

/** 50 ms chunks -> roughly 5 minutes of audio held while reconnecting. */
const MAX_BUFFERED_CHUNKS = 6000;
const WS_OPEN = 1;

interface TurnWord {
  start?: number;
  end?: number;
}

interface TurnMessage {
  type?: string;
  transcript?: string;
  end_of_turn?: boolean;
  turn_order?: number;
  speaker_label?: string;
  words?: TurnWord[];
}

export class LiveTranscriber implements TranscriberLike {
  private ws: WebSocket | null = null;
  private buffer: Int16Array[] = [];
  private closedByUser = false;
  private attempt = 0;
  private readonly delays: number[];

  constructor(private readonly opts: TranscriberOpts) {
    this.delays = opts.reconnectDelaysMs ?? [1000, 2000, 4000, 8000, 15000];
  }

  async start(): Promise<void> {
    await this.connect();
  }

  private buildUrl(token: string): string {
    const params = new URLSearchParams({
      sample_rate: String(this.opts.sampleRate ?? 16000),
      encoding: "pcm_s16le",
      // Required by v3. English model: civic meetings in Lawrence are conducted
      // in English; swap to universal-streaming-multilingual if that changes.
      speech_model: "universal-streaming-english",
      // Punctuation and casing on final turns - a public transcript needs it.
      format_turns: "true",
      token,
    });
    return `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`;
  }

  private async connect(): Promise<void> {
    const token = await this.opts.getToken();
    const factory =
      this.opts.wsFactory ?? ((u: string) => new WebSocket(u));
    const ws = factory(this.buildUrl(token));
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      this.attempt = 0;
      this.opts.onStatus("connected");
      const held = this.buffer;
      this.buffer = [];
      for (const pcm of held) ws.send(this.toFrame(pcm));
    };
    ws.onmessage = (ev: MessageEvent) => this.handleMessage(String(ev.data));
    ws.onclose = () => {
      if (this.closedByUser) {
        this.opts.onStatus("closed");
        return;
      }
      this.opts.onStatus("reconnecting");
      const delay = this.delays[Math.min(this.attempt++, this.delays.length - 1)];
      setTimeout(() => {
        void this.connect().catch(() => {
          // A failed token fetch still needs to retry; onclose will not fire
          // because no socket was created.
          if (!this.closedByUser) {
            setTimeout(() => void this.connect().catch(() => {}), delay);
          }
        });
      }, delay);
    };
    ws.onerror = () => {
      // onclose always follows; reconnect logic lives there.
    };

    this.ws = ws;
  }

  private toFrame(pcm: Int16Array): ArrayBuffer {
    return pcm.buffer.slice(
      pcm.byteOffset,
      pcm.byteOffset + pcm.byteLength
    ) as ArrayBuffer;
  }

  sendAudio(pcm: Int16Array): void {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(this.toFrame(pcm));
      return;
    }
    if (this.buffer.length < MAX_BUFFERED_CHUNKS) {
      this.buffer.push(pcm);
    }
  }

  async stop(): Promise<void> {
    this.closedByUser = true;
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(JSON.stringify({ type: "Terminate" }));
      this.ws.close();
    } else {
      this.opts.onStatus("closed");
    }
  }

  private handleMessage(data: string): void {
    let msg: TurnMessage;
    try {
      msg = JSON.parse(data) as TurnMessage;
    } catch {
      return;
    }
    if (msg.type !== "Turn") return;
    if (!msg.end_of_turn) return;
    const text = (msg.transcript ?? "").trim();
    if (text === "") return;

    // v3 carries timings per word, not on the turn.
    const words = Array.isArray(msg.words) ? msg.words : [];
    const startMs = words.length > 0 ? (words[0].start ?? 0) : 0;
    const endMs = words.length > 0 ? (words[words.length - 1].end ?? 0) : 0;

    this.opts.onTurn({
      order: msg.turn_order ?? 0,
      text,
      startMs,
      endMs,
      final: true,
      speaker: msg.speaker_label ?? null,
    });
  }
}
