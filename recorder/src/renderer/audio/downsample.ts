// Resamples the AudioContext's native rate (usually 44.1k or 48k) down to the
// 16 kHz mono PCM16 that AssemblyAI streaming expects.
//
// Stateful on purpose: audio arrives in small chunks, and both the fractional
// read position and the unconsumed tail must carry across calls or every chunk
// boundary produces a click. One instance per recording.

const OUTPUT_RATE = 16000;

export class Downsampler {
  private readonly ratio: number;
  private pos = 0;
  private tail = new Float32Array(0);

  constructor(
    inputRate: number,
    readonly outputRate: number = OUTPUT_RATE
  ) {
    if (inputRate < outputRate) {
      throw new Error(
        `upsampling not supported (input ${inputRate} < output ${outputRate})`
      );
    }
    this.ratio = inputRate / outputRate;
  }

  process(input: Float32Array): Int16Array {
    const src = new Float32Array(this.tail.length + input.length);
    src.set(this.tail, 0);
    src.set(input, this.tail.length);

    const out: number[] = [];
    let pos = this.pos;
    while (pos + 1 < src.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      // Linear interpolation between neighbouring samples.
      const sample = src[i] * (1 - frac) + src[i + 1] * frac;
      const scaled = Math.round(sample * 32767);
      out.push(scaled > 32767 ? 32767 : scaled < -32768 ? -32768 : scaled);
      pos += this.ratio;
    }

    // pos can land past the end of this buffer (the next sample we want lives in
    // a future chunk). Clamp what we drop to what actually exists and let pos
    // keep the remainder, or that skipped distance is silently lost and every
    // chunk boundary shifts the signal.
    const consumed = Math.min(Math.floor(pos), src.length);
    this.tail = src.slice(consumed);
    this.pos = pos - consumed;
    return Int16Array.from(out);
  }
}
