import { describe, it, expect } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WavWriter } from "../electron/wav-writer";

function tmpPath(name: string): string {
  return join(tmpdir(), `civicscribe-${name}-${process.pid}-${Math.random().toString(36).slice(2)}.wav`);
}

describe("WavWriter", () => {
  it("writes a valid 16k mono PCM16 wav with patched header sizes", async () => {
    const p = tmpPath("basic");
    const w = await WavWriter.create(p, 16000);
    const oneSecond = new Int16Array(16000).fill(1000);
    w.append(oneSecond);
    w.append(oneSecond);
    const { bytes, durationMs } = await w.finalize();

    const buf = await readFile(p);
    expect(buf.length).toBe(bytes);
    expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
    expect(buf.toString("ascii", 8, 12)).toBe("WAVE");
    expect(buf.readUInt16LE(20)).toBe(1); // PCM
    expect(buf.readUInt16LE(22)).toBe(1); // mono
    expect(buf.readUInt32LE(24)).toBe(16000); // sample rate
    expect(buf.readUInt32LE(28)).toBe(32000); // byte rate
    expect(buf.readUInt16LE(34)).toBe(16); // bits per sample
    expect(buf.readUInt32LE(40)).toBe(64000); // data chunk bytes
    expect(buf.readUInt32LE(4)).toBe(36 + 64000); // riff size
    expect(durationMs).toBe(2000);

    await rm(p, { force: true });
  });

  it("preserves the sample values it was given", async () => {
    const p = tmpPath("values");
    const w = await WavWriter.create(p, 16000);
    w.append(Int16Array.from([1, -1, 32767, -32768]));
    await w.finalize();

    const buf = await readFile(p);
    expect(buf.readInt16LE(44)).toBe(1);
    expect(buf.readInt16LE(46)).toBe(-1);
    expect(buf.readInt16LE(48)).toBe(32767);
    expect(buf.readInt16LE(50)).toBe(-32768);

    await rm(p, { force: true });
  });

  it("serializes many un-awaited appends without losing data", async () => {
    const p = tmpPath("queue");
    const w = await WavWriter.create(p, 16000);
    for (let i = 0; i < 200; i++) w.append(new Int16Array(160).fill(i));
    const { bytes } = await w.finalize();

    const buf = await readFile(p);
    expect(bytes).toBe(44 + 200 * 160 * 2);
    expect(buf.length).toBe(bytes);
    // spot-check that the 200th chunk actually landed
    expect(buf.readInt16LE(44 + 199 * 160 * 2)).toBe(199);

    await rm(p, { force: true });
  });

  it("refuses append after finalize", async () => {
    const p = tmpPath("closed");
    const w = await WavWriter.create(p, 16000);
    await w.finalize();
    expect(() => w.append(new Int16Array(10))).toThrow(/finalized/);
    await rm(p, { force: true });
  });

  it("refuses a second finalize", async () => {
    const p = tmpPath("double");
    const w = await WavWriter.create(p, 16000);
    await w.finalize();
    await expect(w.finalize()).rejects.toThrow(/finalized/);
    await rm(p, { force: true });
  });
});
