// Public identity of the site for link cards (LinkedIn, X, Slack, iMessage).
//
// SITE_URL is the live custom domain. It is the metadataBase, so every social
// URL (og:image, og:url) is emitted absolute on this host, whatever
// APP_BASE_URL says. LinkedIn drops a card whose og:image is relative, and a
// card pointing at the Railway host would advertise the wrong address.

export const SITE_URL = "https://civicscribe.us";

/** The shared 1200x630 link card, served from public/og.png.
 *  Regenerate with: node scripts/og-image/render.mjs */
export const OG_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: "CivicScribe: Find any word in any meeting.",
  type: "image/png",
} as const;
