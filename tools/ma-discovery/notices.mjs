// Draft the G.L. c. 30A, s. 20(c) notice that must reach a public body's chair
// BEFORE any of its open sessions may be recorded.
//
// This generates drafts. It sends nothing. Sending is a person's decision and
// happens outside this tool.
//
// WHY THIS EXISTS AS A GATE RATHER THAN A COURTESY
//
// s. 20(c) reads "After notifying the chair of the public body, any person may
// make a video or audio recording of an open session". The notification is the
// precondition of the right, not an etiquette around it. Up to now CivicScribe
// has been pointed at meetings by a submitter, who attests to the lawful basis
// and carries that duty under the Terms. The moment CivicScribe points itself
// at a meeting it has found, CivicScribe is the person doing the recording and
// inherits the duty directly. So the notice comes first, and a capture without
// one is not a capture we may make.
//
// WHAT THE LETTER DELIBERATELY DOES NOT DO
//
// It does not sell anything. Mixing a pitch into a statutory notice invites a
// clerk to read the notice as marketing and bin it, and taints the record we
// would rely on if anyone ever asked whether notice was given. Commercial
// outreach is a separate letter to a separate person on a separate day.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// The reply-to a clerk sees. veravoss@ is the shared box that already reaches
// the right people; change this line if CivicScribe gets its own notice inbox.
const REPLY_TO = "veravoss@atpconsultingllc.com";
const SIGNER = "Vera Voss";
const SIGNER_TITLE = "Executive Assistant, CivicScribe";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "Monday, September 14, 2026" from an ISO date, with no timezone shift. */
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const [, y, mo, d] = m;
  const weekday = WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
  return `${weekday}, ${MONTHS[Number(mo) - 1]} ${Number(d)}, ${y}`;
}

/** "7:00 p.m." from "19:00". */
function clockTime(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const suffix = h < 12 ? "a.m." : "p.m.";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${m[2]} ${suffix}`;
}

// Words that mark a calendar entry as a meeting of a public body rather than a
// community event. A municipal calendar mixes both freely.
const BODY_WORDS = /\b(board|commission|committee|council|trustees|authority|selectmen|subcommittee|sub-committee|task force|district|assessors|registrars)\b/i;

/** Normalise a name for comparison against the roster. */
function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Is this calendar entry a meeting of a public body we may notice?
 *
 * Two gates, and the roster is the sharp one. A town's own /rss.aspx names
 * every board and commission it publishes agendas for, so a title that matches
 * the roster IS a public body by the town's own reckoning, and one that matches
 * nothing and carries no governance word is an event.
 *
 * This exists because the first run drafted a statutory notice of intent to
 * record the Apple Festival, a 9/11 remembrance ceremony and a blood pressure
 * clinic, and drafted notices for meetings the calendar had already marked
 * CANCELLED. Either would tell a clerk, correctly, that nobody read this before
 * sending it.
 */
export function isRecordableBody(title, roster = []) {
  const t = title.trim();

  // A cancelled meeting is not happening, whatever else the title says.
  if (/\bcancell?ed\b|\bpostponed\b|\brescheduled\b/i.test(t)) {
    return { ok: false, reason: "cancelled" };
  }

  // Positive identification comes FIRST. Running the event-word exclusion
  // ahead of it threw away Andover's 250th Anniversary Committee, which is a
  // committee that happens to have "anniversary" in its name.
  const n = norm(t);
  const matched = roster.some((b) => {
    const nb = norm(b);
    return nb.length > 3 && (n.includes(nb) || nb.includes(n));
  });
  // A roster match is strong but not decisive on its own. The town publishes
  // agendas under "Newbury Town Library", which made "Newbury Town Library's
  // 100th Anniversary" match the roster and draft a notice to record a birthday
  // party. When a matched title ALSO carries a celebration word, a person
  // decides.
  const CELEBRATION = /\bceremony\b|\bfestival\b|\bcelebration\b|\banniversary\b|\bheritage month\b|\bopen house\b|\bgroundbreaking\b|\bribbon.cutting\b/i;
  if (matched) {
    return CELEBRATION.test(t) && !BODY_WORDS.test(t)
      ? { ok: false, reason: "review" }
      : { ok: true, reason: "roster" };
  }
  if (BODY_WORDS.test(t) && !CELEBRATION.test(t)) {
    return { ok: true, reason: "governance-word" };
  }

  if (CELEBRATION.test(t) || /^announcement\b|\bclinic\b|\bfilm\b|\bsculpture\b/i.test(t)) {
    return { ok: false, reason: "not-a-meeting" };
  }

  // Neither clearly a body nor clearly an event. "Water Department" and
  // "Open Space Public Meeting #2" both landed here, and both could be real
  // open meetings. Silently dropping a real public meeting is the worse error
  // of the two, so these surface for a person to judge instead.
  if (/\bmeeting\b|\bhearing\b|\bsession\b|\bdepartment\b/i.test(t)) {
    return { ok: false, reason: "review" };
  }
  return { ok: false, reason: "not-a-meeting" };
}

/**
 * The exact instant of a wall-clock time in a named zone.
 *
 * Done through Intl rather than by assuming Eastern is UTC-4: the region's
 * meetings sit either side of the November clock change, and a schedule that
 * silently drifts an hour records the wrong hour of the wrong meeting. Take the
 * naive time as UTC, ask the zone what wall clock that instant shows, and
 * subtract the difference.
 */
export function zonedInstant(date, time, timeZone = "America/New_York") {
  const naive = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const p = Object.fromEntries(
    fmt.formatToParts(naive).filter((x) => x.type !== "literal").map((x) => [x.type, x.value])
  );
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  return new Date(naive.getTime() - (shown - naive.getTime()));
}

/**
 * How much warning the chair would get, and whether that is enough to send.
 *
 * The Open Meeting Law's own yardstick for adequate warning of a meeting is 48
 * hours, so it is the honest yardstick for warning of a recording too. Under 24
 * hours the notice cannot be relied on to have been read before the gavel, and
 * a capture made on it would rest on a notice nobody saw.
 */
export function sendability(date, time, timezone, now = new Date()) {
  const start = zonedInstant(date, time, timezone ?? "America/New_York");
  if (!start) return { hours: null, verdict: "unknown" };
  const hours = (start.getTime() - now.getTime()) / 3600000;
  if (hours < 0) return { hours, verdict: "past" };
  if (hours < 24) return { hours, verdict: "too-late" };
  if (hours < 48) return { hours, verdict: "tight" };
  return { hours, verdict: "sendable" };
}

/**
 * The notice itself.
 *
 * Every sentence states a fact about what will happen. There is no argument for
 * why the body should welcome it and no request for a decision, because a
 * statutory notice is not a negotiation: the right to record an open session
 * does not depend on the chair agreeing with us. The one thing we do invite is
 * the thing the statute actually gives the chair, which is the power to set
 * reasonable requirements on equipment.
 */
export function draftNotice({ town, body, date, time, timezone, location, joinable }) {
  const when = longDate(date);
  const at = clockTime(time);
  const zone = timezone === "America/New_York" ? "" : timezone ? ` (${timezone})` : "";

  const occasion = when
    ? `the open session of the ${body} scheduled for ${when}${at ? ` at ${at}${zone}` : ""}`
    : `open sessions of the ${body}`;
  // "2:00 p.m." already ends in a period; a sentence period after it reads as a
  // typo in a letter that is supposed to look careful.
  const endOccasion = occasion.endsWith(".") ? "" : ".";

  const how = joinable?.length
    ? "The assistant will join using the remote-access link published in the meeting notice. It appears in the participant list under the name CivicScribe and, on joining, states in the meeting that it is recording."
    : "Where the meeting is held in person, the recording is made by a single device placed with the clerk or at the back of the room. Nothing is attached to the body's own equipment.";

  const lines = [
    `To the Chair of the ${body}, care of the ${town} Clerk:`,
    "",
    `This is notice under G.L. c. 30A, s. 20(c) that CivicScribe intends to make an audio recording of ${occasion}${endOccasion}`,
    "",
    `CivicScribe produces a searchable transcript and captions of open public meetings, so that residents who could not attend, and residents who are deaf or hard of hearing, can read what was said. ${how}`,
    "",
    "The recording covers open session only. If the body votes to enter executive session, the recording stops and the assistant leaves before the executive session begins.",
    "",
    "Section 20(c) permits recording subject to reasonable requirements as to the number, placement and operation of equipment, so as not to interfere with the conduct of the meeting. If the Chair wishes to set any such requirements, or would prefer notice for future meetings in a different form or to a different address, reply to this message and we will follow that.",
    "",
    `A copy of this notice is retained with the recording.`,
    "",
    SIGNER,
    SIGNER_TITLE,
    REPLY_TO,
  ];

  return {
    subject: `Notice of intent to record an open meeting - ${body}, ${town}`,
    to: `${town} Clerk (for the Chair of the ${body})`,
    body: lines.join("\n"),
  };
}

async function main() {
  const cataloguePath = join(HERE, "out", "catalogue.json");
  const catalogue = JSON.parse(await readFile(cataloguePath, "utf8"));

  const today = new Date().toISOString().slice(0, 10);
  let targets = [];
  const skipped = [];
  for (const muni of catalogue.municipalities) {
    for (const notice of muni.notices ?? []) {
      // Only meetings we could actually schedule: a real body, a real date in
      // the future, and a start time. A notice we cannot pin to a time is not
      // one we can promise to record.
      if (!notice.date || notice.date < today || !notice.start_time) continue;
      if (/^\(untitled\)$/i.test(notice.title)) continue;

      // A municipal calendar mixes public-body meetings with community events.
      // Only the former get a s. 20(c) notice.
      const recordable = isRecordableBody(notice.title, muni.bodies ?? []);
      if (!recordable.ok) {
        skipped.push({ town: muni.name, title: notice.title, why: recordable.reason });
        continue;
      }

      targets.push({
        town: muni.name,
        body: notice.title.replace(/\s+/g, " ").trim(),
        date: notice.date,
        time: notice.start_time,
        timezone: notice.timezone,
        location: notice.location,
        joinable: notice.joinable,
        source: notice.url,
      });
    }
  }

  // One meeting, one notice. A CivicPlus calendar links the same event by two
  // URL forms (bare EID, and EID plus the month/day it was viewed from), which
  // produced two identical letters to the same chair about the same meeting.
  // De-duplicate on what identifies the MEETING, not on the URL that found it.
  const byMeeting = new Map();
  for (const target of targets) {
    const key = `${target.town}|${target.body.toLowerCase()}|${target.date}|${target.time}`;
    if (!byMeeting.has(key)) byMeeting.set(key, target);
  }
  targets = [...byMeeting.values()];

  targets.sort((a, b) => (a.date + a.time + a.town).localeCompare(b.date + b.time + b.town));

  const outDir = join(HERE, "out", "notices");
  await mkdir(outDir, { recursive: true });

  const index = [];
  for (const target of targets) {
    const draft = draftNotice(target);
    const send = sendability(target.date, target.time, target.timezone);
    // A draft for a meeting starting within the day is written but parked: it
    // is evidence of what we would have sent, not something to send now.
    target.lead_hours = send.hours === null ? null : Math.round(send.hours);
    target.verdict = send.verdict;
    const slug = `${target.date}-${target.town}-${target.body}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90);
    const file = join(outDir, `${slug}.txt`);
    await writeFile(
      file,
      [`To: ${draft.to}`, `Subject: ${draft.subject}`, "", draft.body, "", `Source notice: ${target.source}`].join("\n"),
      "utf8"
    );
    index.push({ ...target, subject: draft.subject, file: `${slug}.txt` });
  }

  await writeFile(join(outDir, "index.json"), JSON.stringify({ generated_at: new Date().toISOString(), drafts: index }, null, 2), "utf8");

  const by = (v) => index.filter((d) => d.verdict === v).length;
  const towns = new Set(index.map((d) => d.town));
  const joinable = index.filter((d) => d.joinable?.length).length;
  console.log(`${index.length} notice drafts across ${towns.size} municipalities.`);
  console.log(`  ${joinable} for meetings with a joinable remote link, ${index.length - joinable} in person.`);
  console.log(`  ready to send (48h+ lead): ${by('sendable')}  |  tight (24-48h): ${by('tight')}  |  too late (<24h): ${by('too-late')}`);
  const why = (reason) => skipped.filter((x) => x.why === reason);
  console.log(
    `  filtered out: ${why("not-a-meeting").length} not a public body, ` +
      `${why("cancelled").length} cancelled or postponed.`
  );
  const review = why("review");
  if (review.length > 0) {
    console.log(`\n  ${review.length} need a human call (could be a real open meeting):`);
    for (const item of review) console.log(`    ${item.town}: ${item.title}`);
  }
  await writeFile(
    join(outDir, "skipped.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), skipped }, null, 2),
    "utf8"
  );
  console.log(`Drafts written to ${outDir}`);
  console.log("\nNothing has been sent. Sending is a separate, deliberate step.");
}

// Only run the generator when invoked directly, so draftNotice stays importable.
if (process.argv[1] && process.argv[1].endsWith("notices.mjs")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
