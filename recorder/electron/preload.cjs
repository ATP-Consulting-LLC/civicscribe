// Bridges the renderer to the main process's WAV writer. Kept as plain CommonJS
// so it loads as a preload script without a build step of its own.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("recorderNative", {
  startRecording: (sessionId, sampleRate) =>
    ipcRenderer.invoke("recording-start", sessionId, sampleRate),
  audioChunk: (buf) => ipcRenderer.send("audio-chunk", buf),
  finalizeRecording: () => ipcRenderer.invoke("recording-finalize"),
  readRecordingBytes: () => ipcRenderer.invoke("read-recording-bytes"),
  setInvisible: (invisible) => ipcRenderer.invoke("set-invisible", invisible),
});
