import Link from "next/link";
import Image from "next/image";

import { getStore } from "@/lib/store";
import MeetingList from "@/components/dashboard/MeetingList";
import { LiveNow } from "@/components/dashboard/LiveNow";
import ContactForm from "@/components/contact/ContactForm";
import { isStaff, currentUser } from "@/lib/auth/server";
import { formatTimestamp } from "@/components/dashboard/meeting-format";
import type { UtteranceSearchResult } from "@/lib/types";

// Role-aware + fresh per request: the visible meeting set depends on staff
// status, and statuses change as the worker runs.
export const dynamic = "force-dynamic";

/**
 * Find REAL search hits to show on the front page.
 *
 * The page's whole claim is "you can find any word in any meeting", so the
 * panel that demonstrates it has to be driven by the actual archive. Terms are
 * drawn from the archive's own topics first, then a couple of generic civic
 * words as a fallback. If nothing matches, the caller renders no panel at all -
 * an honest gap beats an invented transcript, and a fabricated excerpt on a
 * live public-records product would be indefensible.
 */
async function realSearchSample(): Promise<{
  term: string;
  hits: UtteranceSearchResult[];
} | null> {
  const store = getStore();

  // Ordinary civic words that actually occur in speech, most substantive first.
  // Topic labels are NOT used as search terms: they are summary tags the model
  // assigns ("Transportation & Roads"), and a full-text search for one returns
  // nothing because nobody says it out loud. Verified against the seed data.
  const candidates = [
    "budget",
    "zoning",
    "vote",
    "traffic",
    "public comment",
    "meeting",
  ];

  for (const term of candidates) {
    try {
      const hits = await store.searchUtterances(term, {
        publishedOnly: true,
        limit: 3,
      });
      if (hits.length > 0) return { term, hits };
    } catch {
      // Same: a search failure degrades to "no panel", never to a crash.
    }
  }
  return null;
}

function TileIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-7 w-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function Check() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

export default async function HomePage() {
  const isAdmin = await isStaff();

  // Staff land on their operator dashboard, not the sales pitch. Splitting these
  // is the point: the old page served a reader, a submitter and a moderator on
  // one scroll and served none of them well.
  if (isAdmin) {
    const user = await currentUser();
    const meetings = await getStore().listMeetings("civic");
    return (
      <div className="home">
        <LiveNow />
        <section className="home-section home-section--first">
          <div className="home-signedin">
            <p className="home-kicker">Staff</p>
            <h2>You are signed in{user ? ` as ${user.role}` : ""}.</h2>
            <p className="text-ink-soft">
              Review new meetings, publish them to the public library, and manage
              scheduled recordings.
            </p>
            <div className="home-links">
              <Link href="/review">Review queue</Link>
              <Link href="/meetings/new">Add a meeting</Link>
              <Link href="/schedules">Schedules</Link>
            </div>
          </div>
        </section>
        <section className="home-section">
          <p className="home-kicker">The archive</p>
          <h2>Your meetings</h2>
          <p className="mb-6 max-w-2xl text-ink-soft">
            Every recorded meeting, including ones still working and ones that
            failed, so you can moderate from here.
          </p>
          <MeetingList initialMeetings={meetings} kind="civic" isAdmin />
        </section>
      </div>
    );
  }

  const sample = await realSearchSample();

  return (
    <div className="home">
      {/* ------------------------------------------------------------------
          Hero. The photograph is carried over from the previous design at the
          owner's request. What is new is that it CONNECTS to the page below:
          the search panel straddles its bottom edge, and the dark surface
          returns further down, so it reads as part of the system rather than a
          slab bolted to the top.

          Copy here is written to a measured fifth-grade level. Re-measure with
          plainspeak/fk.mjs before changing any of it.
          ------------------------------------------------------------------ */}
      <section className="home-hero">
        <Image
          src="/hero/home-hero.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="home-hero__img"
        />
        <div className="home-hero__scrim" aria-hidden="true" />

        <div className="home-hero__inner">
          <div className="home-hero__copy">
            <p className="home-eyebrow">For cities and towns</p>
            <h1 className="home-display">Find any word in any meeting.</h1>
            <p className="home-lede">
              We record your meetings. We turn them into text you can search and
              read. Your staff say what goes public.
            </p>
            <div className="home-cta-row">
              <Link href="#contact" className="home-btn home-btn--primary">
                Talk to us
              </Link>
              <Link href="/library" className="home-btn home-btn--ghost">
                See a real meeting
              </Link>
            </div>
            <p className="home-note">
              Nothing to install. Works with Zoom, Teams, and Meet.
            </p>
          </div>
        </div>
      </section>

      {/* Real search hits from the real archive, straddling the hero edge.
          Omitted entirely when the archive cannot answer - see realSearchSample. */}
      {sample && (
        <div className="home-shot">
          <div className="home-frame">
            <div className="home-frame__bar">
              <div className="home-frame__dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <p className="home-frame__q">
                Search: <b>{sample.term}</b>
              </p>
            </div>
            <div className="home-frame__body">
              <p className="home-results__count">
                {sample.hits.length}{" "}
                {sample.hits.length === 1 ? "moment" : "moments"} found
              </p>
              <ul className="home-results">
                {sample.hits.map(({ utterance, meeting }) => (
                  <li key={utterance.id} className="home-result">
                    <p className="home-result__top">
                      <Link
                        href={`/meetings/${meeting.id}`}
                        className="home-result__title"
                      >
                        {meeting.title}
                      </Link>
                      <span className="home-result__stamp">
                        {formatTimestamp(utterance.start_ms)}
                      </span>
                    </p>
                    <p className="home-result__text">
                      <span className="home-result__who">
                        {/* Diarisation gives a bare label like "A" until someone
                            names the speaker. "Speaker A:" reads as a person;
                            "A:" reads as a bug. */}
                        {utterance.speaker_name ??
                          `Speaker ${utterance.speaker_label}`}
                        :
                      </span>{" "}
                      {utterance.text}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="home-results__more">
                <Link href="/search">Search the whole archive</Link>
              </p>
            </div>
          </div>
        </div>
      )}

      <LiveNow />

      <section className="home-section home-section--first">
        <div className="home-inner">
          <div className="home-shead">
            <p className="home-kicker">What people get</p>
            <h2>Three things from every meeting.</h2>
            <p className="home-sub">
              The tape is just the start. These are what people use.
            </p>
          </div>
          <ul className="home-tiles">
            <li className="home-tile">
              <div className="home-tile__icon">
                <TileIcon>
                  <path d="M4 6h16M4 12h16M4 18h10" />
                </TileIcon>
              </div>
              <h3>The full text</h3>
              <p>Every word, with who said it and when. Tap a line to hear it.</p>
            </li>
            <li className="home-tile">
              <div className="home-tile__icon">
                <TileIcon>
                  <path d="M9 11l3 3 8-8" />
                  <path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9" />
                </TileIcon>
              </div>
              <h3>A short recap</h3>
              <p>The main points in plain words. Two minutes, not three hours.</p>
            </li>
            <li className="home-tile">
              <div className="home-tile__icon">
                <TileIcon>
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-4.3-4.3" />
                </TileIcon>
              </div>
              <h3>One place to look</h3>
              <p>Search every meeting at once. Old ones too.</p>
            </li>
          </ul>
        </div>
      </section>

      {/* The dark surface returns here on purpose. It is what stops the hero
          reading as a stranger to the rest of the page. */}
      <section className="home-section home-section--dark">
        <div className="home-inner">
          <div className="home-split">
            <div>
              <div className="home-shead home-shead--left">
                <p className="home-kicker">You stay in charge</p>
                <h2>Nothing goes public until you say so.</h2>
                <p className="home-sub">
                  Every meeting waits for your staff. You choose what goes out.
                </p>
              </div>
              <ul className="home-checks">
                <li>
                  <Check />
                  Your staff check it first
                </li>
                <li>
                  <Check />
                  The bot joins where people can see it
                </li>
                <li>
                  <Check />
                  A clear way to take things down
                </li>
                <li>
                  <Check />
                  Set it up once and it runs each time
                </li>
              </ul>
            </div>
            <div className="home-panel">
              <p className="home-prow">
                <span>A meeting is recorded</span>
                <span className="home-badge home-badge--wait">Working</span>
              </p>
              <p className="home-prow">
                <span>Your staff read it over</span>
                <span className="home-badge home-badge--review">In review</span>
              </p>
              <p className="home-prow">
                <span>Your staff say yes</span>
                <span className="home-badge home-badge--ok">Published</span>
              </p>
              <p className="home-prow">
                <span>Anyone can read and search it</span>
                <span className="home-badge home-badge--ok">Public</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section home-section--tint" id="contact">
        <div className="home-inner">
          <div className="home-shead">
            <p className="home-kicker">For cities</p>
            <h2>Tell us about your meetings.</h2>
            <p className="home-sub">
              We will show you how it would work and what it would cost.
            </p>
          </div>
          <ContactForm />
        </div>
      </section>
    </div>
  );
}
