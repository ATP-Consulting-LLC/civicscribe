// Renders scripts/og-image/og-card.html to public/og.png at exactly 1200x630.
// Run: node scripts/og-image/render.mjs
// Uses the installed Chrome through Playwright (channel "chrome"), so no
// Playwright browser download is needed. Re-run whenever the card copy changes.

import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = pathToFileURL(path.join(here, "og-card.html")).href;
const out = path.resolve(here, "../../public/og.png");

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto(source, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: out,
    type: "png",
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
