// The social link card (og:image). LinkedIn drops a card when og:image is not
// absolute or the file is missing, so both are checked here: the URL resolves
// absolute on the live domain, and public/og.png really is a 1200x630 PNG
// (read from the file's own IHDR header, not assumed).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OG_IMAGE, SITE_URL } from "@/lib/site";
import { buildMeetingMetadata } from "@/lib/meetings/metadata";
import type { Meeting } from "@/lib/types";

function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  expect([...buf.subarray(0, 8)]).toEqual(signature);
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("og:image", () => {
  it("resolves to an absolute https URL on the live domain", () => {
    // metadataBase in layout.tsx is new URL(SITE_URL); Next resolves the
    // relative image URL against it exactly like this.
    const resolved = new URL(OG_IMAGE.url, new URL(SITE_URL)).href;
    expect(resolved).toBe("https://civicscribe.us/og.png");
    expect(SITE_URL).toMatch(/^https:\/\//);
    expect(OG_IMAGE.alt.length).toBeGreaterThan(0);
  });

  it("declares 1200x630 and the file on disk matches", () => {
    expect(OG_IMAGE.width).toBe(1200);
    expect(OG_IMAGE.height).toBe(630);
    const file = path.join(process.cwd(), "public", OG_IMAGE.url.replace(/^\//, ""));
    expect(pngSize(file)).toEqual({ width: 1200, height: 630 });
  });

  it("is carried on a published meeting's card, whose openGraph replaces the layout's", () => {
    const md = buildMeetingMetadata({
      meeting: {
        id: "m1",
        title: "City Council",
        body_name: "City Council",
        published: true,
      } as Meeting,
      summary: null,
      isAdmin: false,
      baseUrl: SITE_URL,
    });
    const og = md.openGraph as Record<string, unknown> | undefined;
    const tw = md.twitter as Record<string, unknown> | undefined;
    expect(og?.images).toEqual([OG_IMAGE]);
    expect(tw?.images).toEqual([{ url: OG_IMAGE.url, alt: OG_IMAGE.alt }]);
  });
});
