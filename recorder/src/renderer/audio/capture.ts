// Opens an audio source and yields 16 kHz mono PCM16.
//
// Two source kinds cover all three meeting formats:
//   system -> getDisplayMedia with loopback (remote + hybrid calls: whatever the
//             computer is playing, i.e. everyone on the call)
//   input  -> getUserMedia on a chosen device (an in-person chamber: a USB mic
//             or a cable from the room's AV/PA board)

import { Downsampler } from "./downsample";
import type { CaptureSource } from "../../shared/types";
import type { AudioPipe } from "../state/session";

export async function listSources(): Promise<CaptureSource[]> {
  // Device labels stay blank until permission has been granted once.
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
  } catch {
    // No mic, or permission denied: system audio still works.
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs: CaptureSource[] = devices
    .filter((d) => d.kind === "audioinput")
    .map((d, i) => ({
      kind: "input",
      deviceId: d.deviceId,
      label: d.label || `Audio input ${i + 1}`,
    }));

  return [
    { kind: "system", label: "System audio (this computer)" },
    ...inputs,
  ];
}

export async function openPipe(source: CaptureSource): Promise<AudioPipe> {
  let stream: MediaStream;

  if (source.kind === "system") {
    // The main process answers this with { audio: 'loopback' }. A video track
    // must be requested for the picker to resolve; we drop it immediately.
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true,
    });
    stream.getVideoTracks().forEach((t) => {
      t.stop();
      stream.removeTrack(t);
    });
    if (stream.getAudioTracks().length === 0) {
      throw new Error(
        "No system audio was captured. Windows shares audio only for the whole screen, not a single window."
      );
    }
  } else {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: source.deviceId! },
        // A meeting room is not a phone call: keep the raw signal.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  }

  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(
    new URL("./pcm-worklet.js", import.meta.url)
  );
  const src = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, "pcm-tap");
  src.connect(tap);

  const down = new Downsampler(ctx.sampleRate);
  let cb: ((pcm: Int16Array) => void) | null = null;

  tap.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    const pcm = down.process(ev.data);
    if (pcm.length > 0) cb?.(pcm);
  };

  return {
    onPcm(fn) {
      cb = fn;
    },
    async stop() {
      tap.port.onmessage = null;
      src.disconnect();
      tap.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}
