// Copies the non-TypeScript assets into dist/ after tsc runs.
// recorder-config.json is machine-local (gitignored) and optional.

import { cp, access } from "node:fs/promises";

async function copyIfPresent(from, to) {
  try {
    await access(from);
  } catch {
    return;
  }
  await cp(from, to);
}

await cp("src/renderer/index.html", "dist/src/renderer/index.html");
await cp(
  "src/renderer/audio/pcm-worklet.js",
  "dist/src/renderer/audio/pcm-worklet.js"
);
await cp("electron/preload.cjs", "dist/electron/preload.cjs");
await copyIfPresent(
  "src/renderer/recorder-config.json",
  "dist/src/renderer/recorder-config.json"
);
