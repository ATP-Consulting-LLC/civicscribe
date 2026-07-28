import { describe, it, expect } from "vitest";
import { Downsampler } from "../src/renderer/audio/downsample";

describe("Downsampler", () => {
  it("reduces 48k input to roughly a third of the samples", () => {
    const d = new Downsampler(48000);
    const out = d.process(new Float32Array(4800)); // 100ms at 48k
    expect(out.length).toBeGreaterThanOrEqual(1590);
    expect(out.length).toBeLessThanOrEqual(1600); // ~100ms at 16k
  });

  it("passes 16k through at the same length", () => {
    const d = new Downsampler(16000);
    const out = d.process(new Float32Array(1600));
    expect(out.length).toBeGreaterThanOrEqual(1595);
    expect(out.length).toBeLessThanOrEqual(1600);
  });

  it("preserves a DC signal value", () => {
    const d = new Downsampler(48000);
    const out = d.process(new Float32Array(4800).fill(0.5));
    expect(out[100]).toBeGreaterThan(16000);
    expect(out[100]).toBeLessThan(16600); // 0.5 * 32767 ~= 16384
  });

  it("chunked processing equals one-shot processing", () => {
    const src = new Float32Array(9600);
    for (let i = 0; i < src.length; i++) src[i] = Math.sin(i / 20);

    const one = new Downsampler(48000).process(src);

    const d = new Downsampler(48000);
    const a = d.process(src.slice(0, 5000));
    const b = d.process(src.slice(5000));
    const chunked = new Int16Array(a.length + b.length);
    chunked.set(a, 0);
    chunked.set(b, a.length);

    expect(chunked.length).toBe(one.length);
    for (let i = 0; i < one.length; i++) {
      expect(chunked[i]).toBe(one[i]);
    }
  });

  it("clamps out-of-range floats instead of wrapping", () => {
    const d = new Downsampler(16000);
    const out = d.process(new Float32Array(100).fill(2.0));
    expect(out[10]).toBe(32767);
    const d2 = new Downsampler(16000);
    const out2 = d2.process(new Float32Array(100).fill(-2.0));
    expect(out2[10]).toBe(-32768);
  });

  it("rejects upsampling rather than producing garbage", () => {
    expect(() => new Downsampler(8000)).toThrow(/upsampling/);
  });
});
