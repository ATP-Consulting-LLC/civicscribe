// Taps raw Float32 mono PCM off the audio graph and ships it to the main thread.
// An AudioWorklet (not ScriptProcessor) so capture never blocks the UI thread.

class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // slice() copies: the render quantum buffer is reused after we return.
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}

registerProcessor("pcm-tap", PcmTap);
