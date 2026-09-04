// topicSlug lives in its own module so both ../topics.ts and ./taxonomy.ts can
// use it without importing each other. topics.ts re-exports it, so every existing
// `import { topicSlug } from "@/lib/topics"` keeps working unchanged.

/** Slugify a free-text topic into a URL-safe slug: lowercase, non-alphanumeric
 *  runs collapsed to a single hyphen, leading/trailing hyphens trimmed.
 *  Returns "" for a topic with no slug-able characters (callers skip those). */
export function topicSlug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
