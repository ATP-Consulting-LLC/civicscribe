// Streaming WAV writer for the local safety copy.
//
// The audio pipeline calls append() from an IPC handler that cannot await, so
// writes are serialized on an internal promise chain and append() stays sync.
// The 44-byte header is written up front with zero sizes and patched in
// finalize(), which is what makes the file valid without buffering the whole
// recording in memory.

import { open, type FileHandle } from "node:fs/promises";

const HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

export class WavWriter {
  private fh: FileHandle | null = null;
  private dataBytes = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  private constructor(private readonly sampleRate: number) {}

  static async create(
    filePath: string,
    sampleRate: number
  ): Promise<WavWriter> {
    const writer = new WavWriter(sampleRate);
    writer.fh = await open(filePath, "w");
    await writer.fh.write(writer.header(0));
    return writer;
  }

  /** Queue a chunk of mono PCM16. Safe to call without awaiting. */
  append(pcm: Int16Array): void {
    if (this.closed) throw new Error("WavWriter is finalized");
    // Copy: the caller's buffer may be reused by the audio pipeline before the
    // queued write actually runs.
    const buf = Buffer.from(
      pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
    );
    this.dataBytes += buf.length;
    this.queue = this.queue.then(() => this.fh!.write(buf));
  }

  /** Flush, patch the header with real sizes, close. */
  async finalize(): Promise<{ bytes: number; durationMs: number }> {
    if (this.closed) throw new Error("WavWriter is finalized");
    this.closed = true;
    await this.queue;
    await this.fh!.write(this.header(this.dataBytes), 0, HEADER_BYTES, 0);
    await this.fh!.close();
    this.fh = null;
    const samples = this.dataBytes / (BITS_PER_SAMPLE / 8);
    return {
      bytes: HEADER_BYTES + this.dataBytes,
      durationMs: Math.round((samples / this.sampleRate) * 1000),
    };
  }

  private header(dataBytes: number): Buffer {
    const byteRate = this.sampleRate * CHANNELS * (BITS_PER_SAMPLE / 8);
    const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);
    const b = Buffer.alloc(HEADER_BYTES);
    b.write("RIFF", 0, "ascii");
    b.writeUInt32LE(36 + dataBytes, 4);
    b.write("WAVE", 8, "ascii");
    b.write("fmt ", 12, "ascii");
    b.writeUInt32LE(16, 16); // fmt chunk size
    b.writeUInt16LE(1, 20); // PCM
    b.writeUInt16LE(CHANNELS, 22);
    b.writeUInt32LE(this.sampleRate, 24);
    b.writeUInt32LE(byteRate, 28);
    b.writeUInt16LE(blockAlign, 32);
    b.writeUInt16LE(BITS_PER_SAMPLE, 34);
    b.write("data", 36, "ascii");
    b.writeUInt32LE(dataBytes, 40);
    return b;
  }
}
