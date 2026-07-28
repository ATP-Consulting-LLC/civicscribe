// Electron main process for the CivicScribe Recorder.
//
// Two jobs:
//  1. Answer getDisplayMedia() with `audio: 'loopback'`, which is what lets the
//     renderer capture SYSTEM audio on Windows (WASAPI) with no native code.
//     This is the whole reason the public path needs no bot in the meeting.
//  2. Own the local WAV safety copy. The renderer streams PCM over IPC and we
//     append it to disk, so a dropped network connection never loses a meeting.

import { app, BrowserWindow, session, desktopCapturer, ipcMain } from "electron";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { WavWriter } from "./wav-writer";

let writer: WavWriter | null = null;
let currentPath = "";

function recordingsDir(): string {
  return path.join(app.getPath("documents"), "CivicScribe Recordings");
}

app.whenReady().then(async () => {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    // We only want the audio; a video source must still be named for the
    // request to resolve, and the renderer stops the video track immediately.
    desktopCapturer
      .getSources({ types: ["screen"] })
      .then((sources) => callback({ video: sources[0], audio: "loopback" }))
      .catch(() => callback({}));
  });

  const win = new BrowserWindow({
    width: 820,
    height: 680,
    title: "CivicScribe Recorder",
    webPreferences: { preload: path.join(__dirname, "preload.cjs") },
  });

  await win.loadFile(path.join(__dirname, "..", "src", "renderer", "index.html"));
});

app.on("window-all-closed", () => app.quit());

ipcMain.handle(
  "recording-start",
  async (_event, sessionId: string, sampleRate: number): Promise<string> => {
    const dir = recordingsDir();
    await mkdir(dir, { recursive: true });
    // sessionId is a server-issued uuid, but keep the filename defensive.
    const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
    currentPath = path.join(dir, `${safe}.wav`);
    writer = await WavWriter.create(currentPath, sampleRate);
    return currentPath;
  }
);

ipcMain.on("audio-chunk", (_event, buf: ArrayBuffer) => {
  // Fire-and-forget by design: WavWriter serializes writes internally, and a
  // dropped chunk must never block the audio pipeline.
  writer?.append(new Int16Array(buf));
});

ipcMain.handle("recording-finalize", async () => {
  if (!writer) throw new Error("no recording in progress");
  const result = await writer.finalize();
  writer = null;
  return { path: currentPath, ...result };
});

ipcMain.handle("read-recording-bytes", async (): Promise<ArrayBuffer> => {
  const buf = await readFile(currentPath);
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength
  ) as ArrayBuffer;
});
