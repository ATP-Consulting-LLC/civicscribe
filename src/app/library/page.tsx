// Public library landing (server component). The PUBLIC entry point into the
// shared civic-knowledge library: a topic cloud (chips from listTopics) plus a
// grid of published meetings (governing bodies). Everything here is
// published-only by construction — listTopics and listLibrary both filter to
// published — so there is no admin branch and nothing unpublished can leak.
//
// Copy is written to a measured fifth-grade reading level (plainspeak/fk.mjs).
// Re-measure before changing any user-facing string here.

import type { Metadata } from "next";
import Link from "next/link";

import { getStore } from "@/lib/store";
import { LibraryMeetingGrid } from "@/components/library/LibraryMeetingGrid";
import { LiveNow } from "@/components/dashboard/LiveNow";

// Published set + topic counts change as the admin curates, so always render
// fresh rather than caching a stale library snapshot.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Library",
  description:
    "Read every public meeting we have recorded. Full text, a short recap, and search across all of them.",
};

export default async function LibraryPage() {
  const store = getStore();
  const [topics, meetings] = await Promise.all([
    store.listTopics(),
    store.listLibrary(),
  ]);

  return (
    <div className="flex flex-col gap-12">
      {/* No breadcrumb here. This IS the top of the library, and a "Library"
          crumb directly above a "Library" heading just says it twice. */}
      <header>
        <h1 className="text-3xl">Meetings you can read</h1>
        <p className="mt-3 max-w-2xl text-lg text-ink-soft">
          Read the full text of any meeting. Search all of them at once.
        </p>
      </header>

      {/* Live now: meetings currently streaming public live captions. Renders
          nothing when none is live. */}
      <LiveNow />

      <section aria-labelledby="topics-cloud-heading">
        <h2 id="topics-cloud-heading" className="text-2xl">
          Browse by subject
        </h2>
        {topics.length === 0 ? (
          <p className="mt-3 text-ink-soft">
            Subjects show up here once meetings are added.
          </p>
        ) : (
          <ul className="mt-5 flex flex-wrap gap-3">
            {topics.map((t) => (
              <li key={t.slug}>
                <Link
                  href={`/tags/${t.slug}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-accent bg-accent-soft px-5 font-medium text-accent-strong hover:bg-primary-soft"
                >
                  <span>{t.topic}</span>
                  <span
                    aria-label={`${t.count} ${
                      t.count === 1 ? "meeting" : "meetings"
                    }`}
                    className="rounded-full bg-accent px-2.5 py-0.5 text-sm font-semibold tabular-nums text-white"
                  >
                    {t.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="library-meetings-heading">
        <h2 id="library-meetings-heading" className="text-2xl">
          {meetings.length === 1 ? "One meeting so far" : "All meetings"}
        </h2>
        {meetings.length === 0 ? (
          // An honest empty state. Nothing is faked to make the shelf look full.
          <div className="mt-5 max-w-2xl rounded-xl border border-line bg-tint p-8">
            <p className="text-lg">No meetings yet.</p>
            <p className="mt-2 text-ink-soft">
              A city starts recording with us. Then every meeting shows up
              here. Anyone can read it.
            </p>
            <p className="mt-5">
              <Link
                href="/#contact"
                className="inline-flex min-h-12 items-center rounded-lg bg-accent px-6 font-semibold text-white hover:bg-accent-strong"
              >
                Talk to us about your city
              </Link>
            </p>
          </div>
        ) : (
          <div className="mt-5">
            <LibraryMeetingGrid meetings={meetings} />
          </div>
        )}
      </section>
    </div>
  );
}
