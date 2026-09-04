// Public topic browse (server component): every PUBLISHED meeting whose summary
// carries this topic slug, newest first. getTopicMeetings is published-only by
// construction, so an unpublished meeting can never surface here for anyone,
// admin or not. Reserved note: /topics is for Phase 3 synthesis; topic-tag
// browse lives under /tags.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { canonicalTopicBySlug } from "@/lib/topics/taxonomy";
import { getStore } from "@/lib/store";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";
import { LibraryMeetingGrid } from "@/components/library/LibraryMeetingGrid";

// The published set behind a slug changes as the admin curates; render fresh.
export const dynamic = "force-dynamic";

/** Every browsable slug is one of the fixed canonical buckets, so the heading is
 *  that bucket's real label ("Zoning & Land Use"), not a de-hyphenated guess.
 *  Returns "" for a slug outside the taxonomy, which the page 404s. */
function slugToLabel(slug: string): string {
  return canonicalTopicBySlug(slug)?.label ?? "";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const label = slugToLabel(decodeURIComponent(slug));
  if (!label) return { title: "Topic not found · Library" };
  return {
    title: `${label} · Library`,
    description: `Published civic meetings about ${label}.`,
  };
}

export default async function TagPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const label = slugToLabel(slug);
  // A slug outside the fixed taxonomy has no page. Before the taxonomy existed
  // any string rendered an empty, indexable results page.
  if (!label) notFound();

  const rows = await getStore().getTopicMeetings(slug);
  const meetings = rows.map((r) => r.meeting);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Breadcrumbs
          items={[
            { label: "Library", href: "/library" },
            { label },
          ]}
        />
        <h1 className="mt-4 text-3xl">{label}</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          {meetings.length === 0
            ? "No published meetings cover this topic yet."
            : `${meetings.length} published ${
                meetings.length === 1 ? "meeting covers" : "meetings cover"
              } this topic.`}
        </p>
        <p className="mt-3">
          <Link
            href={`/topics/${slug}`}
            className="rounded font-medium text-accent-strong underline decoration-accent underline-offset-4 hover:text-accent-strong hover:decoration-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
          >
            See the cross-meeting synthesis
          </Link>
        </p>
      </div>

      {meetings.length > 0 && <LibraryMeetingGrid meetings={meetings} />}
    </div>
  );
}
