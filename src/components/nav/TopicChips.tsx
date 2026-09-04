// Render a summary's free-text topics as chips that link to the public
// /tags/[slug] browse surface. Server-safe (no "use client"): pure props.
//
// The chip SHOWS the model's specific wording ("Rezoning of 12 Oak St") because
// that is what tells a resident what actually happened, but it LINKS to the
// topic's canonical bucket (/tags/zoning-land-use). Linking to a slug of the
// specific wording is what made the tag surface infinite: every phrasing became
// its own permanent page of exactly one meeting.
//
// A topic that has no slug-able characters (topicSlug -> "") has no browse page,
// so it renders as a plain, non-interactive chip rather than a dead link.
// Chips that collapse to the same bucket are NOT merged: two different specific
// topics are both worth reading even though they browse to one page.

import Link from "next/link";

import { topicSlug } from "@/lib/topics";
import { canonicalizeTopic } from "@/lib/topics/taxonomy";

const baseChip =
  "inline-flex items-center rounded-full border px-3 py-1 text-base font-medium";

const linkChip = `${baseChip} border-accent bg-accent-soft text-accent-strong hover:bg-accent-soft hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2`;

const staticChip = `${baseChip} border-line bg-tint text-ink`;

export function TopicChips({
  topics,
  className,
}: {
  topics: string[];
  className?: string;
}) {
  if (topics.length === 0) return null;

  // De-duplicate on the exact wording, not on the destination: two distinct
  // topics that share a bucket should both still be shown.
  const seen = new Set<string>();
  const chips: Array<{ key: string; slug: string; label: string }> = [];
  for (const topic of topics) {
    const key = topicSlug(topic) || `static:${topic}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Unslug-able topics stay non-interactive; everything else browses to its bucket.
    const slug = topicSlug(topic) ? canonicalizeTopic(topic).slug : "";
    chips.push({ key, slug, label: topic });
  }

  return (
    <ul className={`flex flex-wrap gap-2 ${className ?? ""}`}>
      {chips.map(({ key, slug, label }) => (
        <li key={key}>
          {slug ? (
            <Link href={`/tags/${slug}`} className={linkChip}>
              {label}
            </Link>
          ) : (
            <span className={staticChip}>{label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
