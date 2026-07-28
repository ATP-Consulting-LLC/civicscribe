// Serves a single self-contained HTML file on localhost so it can be viewed in
// a browser. Node stand-in for the show-visuals python helper (no python here).
// Usage: node scripts/serve-preview.mjs build/icon-preview.html

import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/serve-preview.mjs <file.html>");
  process.exit(1);
}
const html = readFileSync(file);

const server = createServer((_req, res) => {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(html);
});

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  console.log(`VISUAL READY: http://127.0.0.1:${port}/`);
});
