// Public topics index (server component): the cross-meeting synthesis surface.
// Synthesis only adds value across multiple meetings, so this lists only topics
// that span 2 or more PUBLISHED meetings. listTopics() is published-only by
// construction, so nothing unpublished can surface here for anyone. This page
// never generates anything, so there is no admin branch and no LLM call.

import type { Metadata } from "next";
import Link from "next/link";

import { getStore } from "@/lib/store";

// The published set + topic counts change as the admin curates; render fresh.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Topics",
  description:
    "Subjects that come up at more than one meeting, and what was said about them over time.",
};

export default async function TopicsPage() {
  const topics = (await getStore().listTopics()).filter((t) => t.count >= 2);

  return (
    <div className="flex flex-col gap-8">
      {/* No breadcrumb. This is the top of the section, and a "Topics" crumb
          directly above a "Topics" heading just says it twice. */}
      <header>
        <h1 className="text-3xl">Subjects that come up again</h1>
        <p className="mt-3 max-w-2xl text-lg text-ink-soft">
          Some things come up at more than one meeting. Open one to read what was
          said about it over time.
        </p>
      </header>

      {topics.length === 0 ? (
        <div className="max-w-2xl rounded-xl border border-line bg-tint p-8">
          <p className="text-lg">Nothing here yet.</p>
          <p className="mt-2 text-ink-soft">
            A subject shows up here once it has been talked about at two or more
            meetings.
          </p>
        </div>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {topics.map((t) => (
            <li key={t.slug}>
              <Link
                href={`/topics/${t.slug}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-accent bg-accent-soft px-5 font-medium text-accent-strong hover:bg-primary-soft"
              >
                <span>{t.topic}</span>
                <span
                  aria-label={`${t.count} meetings`}
                  className="rounded-full bg-accent px-2 py-0.5 text-sm font-semibold tabular-nums text-white"
                >
                  {t.count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
