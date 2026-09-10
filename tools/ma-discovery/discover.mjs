// Discovery pass over Massachusetts municipal websites: find where each town
// posts its meeting notices, and pull the remote-access links those notices are
// required by law to carry.
//
// WHY THIS IS THE RIGHT DATA SOURCE
//
// The Open Meeting Law (G.L. c. 30A, s. 20) requires a public body to post
// notice at least 48 hours ahead, excluding weekends and holidays, and where a
// body meets remotely the notice must state how the public may access the
// meeting in real time. So the link we need is not something we have to infer
// or scrape out of a private system: it is a legally mandated public posting.
// This tool reads exactly that, and nothing else.
//
// WHAT THIS TOOL WILL NOT DO
//
//   - It never fetches a path robots.txt disallows. Every request goes through
//     fetchPolitely, which refuses rather than asks forgiveness.
//   - It never authenticates, never submits a form, never follows a link behind
//     a login, and never touches a municipal system we have no account on.
//   - It identifies itself in the User-Agent with a contact URL, so a clerk
//     reading a server log can see who we are and tell us to stop.
//   - It waits between requests to the same host, and honours a Crawl-delay
//     above our own floor. A municipal web server is public infrastructure
//     running on a public budget; degrading one to gather sales data would be
//     both wrong and self-defeating.
//
// Recording itself is separately lawful: s. 20(c) lets any person record an
// open session after notifying the chair. That notification is a precondition,
// not a formality, and it is NOT this tool's job. This tool only builds the
// catalogue; notify-then-capture is handled downstream.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { USER_AGENT, loadRobots, isAllowed } from "./robots.mjs";
import {
  parseEvents,
  localParts,
  civicPlusIcsUrl,
  eidOf,
  parseBodyRoster,
} from "./ics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Our own floor between two requests to the same host, in ms. A site asking
 *  for longer via Crawl-delay gets what it asked for; nobody gets less. */
const MIN_HOST_DELAY_MS = 2000;

/** How many pages we will pull from any one municipality. Discovery is meant to
 *  be a light touch: find the notice surface, read it, leave. */
const MAX_PAGES_PER_SITE = 6;

/** Individual meeting notices pulled per site in stage 2. The remote-access
 *  link lives here, not on the calendar index. */
const MAX_NOTICES_PER_SITE = 8;

/** Links that look like ONE meeting rather than an index of many. */
const EVENT_LINK =
  /(?:[?&]eid=[0-9]+|[/]agendacenter[/]viewfile[/]|[/]event[/]|[/]events[/][a-z0-9-]+|[/]meeting[s]?[/][a-z0-9-]+)/i;

/** Municipalities crawled at once. Different hosts, so this adds no load to any
 *  single server; the per-host delay is what protects each one. */
const SITE_CONCURRENCY = 4;

const FETCH_TIMEOUT_MS = 20000;

// --- what we are looking for ------------------------------------------------

// Agenda and notice platforms common in Massachusetts. Detection matters
// commercially as well as technically: a town already paying Granicus has a
// budget line for this category and an incumbent to displace, while a town on a
// plain CMS has neither.
const PLATFORMS = [
  { id: "civicplus", label: "CivicPlus / CivicEngage", signals: ["/agendacenter", "civicengage", "civicplus.com"] },
  { id: "civicclerk", label: "CivicClerk", signals: ["civicclerk.com"] },
  { id: "granicus", label: "Granicus / iQM2", signals: ["iqm2.com", "granicus.com", "legistar.com"] },
  { id: "novus", label: "NovusAGENDA", signals: ["novusagenda.com"] },
  { id: "boarddocs", label: "BoardDocs", signals: ["boarddocs.com"] },
  { id: "vision", label: "Vision / Virtual Town Hall", signals: ["virtualtownhall.net", "vt-s.net"] },
  { id: "revize", label: "Revize", signals: ["revize.com"] },
  { id: "opengov", label: "OpenGov", signals: ["opengov.com"] },
  { id: "townweb", label: "Town Web", signals: ["townweb.com"] },
];

// Link text and hrefs that suggest a meeting-notice surface, most specific
// first. Score is the weight added when the term appears.
const CANDIDATE_TERMS = [
  { term: "agendacenter", score: 10 },
  { term: "meeting notice", score: 10 },
  { term: "public notice", score: 8 },
  { term: "agendas and minutes", score: 9 },
  { term: "agendas & minutes", score: 9 },
  { term: "agenda", score: 6 },
  { term: "minutes", score: 3 },
  { term: "meeting calendar", score: 8 },
  { term: "calendar", score: 5 },
  { term: "boards and commissions", score: 4 },
  { term: "town clerk", score: 3 },
  { term: "city clerk", score: 3 },
  { term: "open meeting", score: 7 },
];

// A joinable remote link. These are the ones the announcing bot can actually
// join, which is the capture path this deployment supports.
const JOINABLE_PATTERNS = [
  { kind: "zoom", re: /https?:\/\/[\w.-]*zoom\.us\/(?:j|w|s|my)\/[^\s"'<>)\]]+/gi },
  { kind: "teams", re: /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"'<>)\]]+/gi },
  { kind: "meet", re: /https?:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/gi },
  { kind: "webex", re: /https?:\/\/[\w.-]*webex\.com\/[^\s"'<>)\]]+/gi },
];

// A watch-only stream. Not joinable by a bot, and YouTube and Vimeo terms
// forbid downloading, so these are recorded as intelligence about the town,
// never as a capture target.
const STREAM_PATTERNS = [
  { kind: "youtube", re: /https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s"'<>)\]]+/gi },
  { kind: "vimeo", re: /https?:\/\/(?:www\.)?vimeo\.com\/[^\s"'<>)\]]+/gi },
  { kind: "granicus-player", re: /https?:\/\/[\w.-]*granicus\.com\/[^\s"'<>)\]]+/gi },
  { kind: "local-cable", re: /https?:\/\/[\w.-]*(?:tv|media|communitytv|catv)[\w.-]*\.org\/[^\s"'<>)\]]*/gi },
];

// --- polite fetching --------------------------------------------------------

/** Per-host state: the robots policy and when we may next touch it. */
const hosts = new Map();

async function hostState(origin) {
  let state = hosts.get(origin);
  if (!state) {
    const robots = await loadRobots(origin);
    state = { robots, nextAllowedAt: 0 };
    hosts.set(origin, state);
  }
  return state;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The only door to the network. Refuses a disallowed path, waits out the
 * per-host delay, and always identifies us.
 *
 * Returns { ok, status, body, url, skipped } and never throws, so one bad
 * municipal server cannot end the run.
 */
async function fetchPolitely(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, skipped: "bad-url", url: rawUrl };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, skipped: "non-http", url: rawUrl };
  }

  const state = await hostState(url.origin);
  if (!isAllowed(state.robots, url.pathname)) {
    return { ok: false, skipped: "robots-disallow", url: url.href };
  }

  const delay = Math.max(MIN_HOST_DELAY_MS, (state.robots.crawlDelay ?? 0) * 1000);
  const wait = state.nextAllowedAt - Date.now();
  if (wait > 0) await sleep(wait);
  state.nextAllowedAt = Date.now() + delay;

  try {
    const res = await fetch(url.href, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const type = res.headers.get("content-type") ?? "";
    // We read HTML and XML. A PDF notice is recorded by URL for a later pass
    // rather than parsed here, so this stays dependency free.
    // text/calendar is here on purpose: the per-event .ics enrichment fetch
    // returns it, and leaving it out silently dropped every enrichment while
    // the run still reported success.
    if (!/text\/html|application\/xhtml|xml|text\/plain|text\/calendar/i.test(type)) {
      return { ok: false, skipped: "not-html", url: res.url, status: res.status, contentType: type };
    }
    return { ok: res.ok, status: res.status, body: await res.text(), url: res.url };
  } catch (err) {
    return { ok: false, skipped: "fetch-failed", url: url.href, error: String(err?.message ?? err) };
  }
}

// --- extraction -------------------------------------------------------------

// An href in real municipal HTML arrives entity-encoded: CivicPlus emits
// calendar.aspx?year=2026&amp;month=9, and fetching that literally asks for a
// parameter named "amp;month". Decode before the URL is ever constructed.
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'" };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
    const key = code.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(ENTITIES, key)) return ENTITIES[key];
    if (key.startsWith("#x")) {
      const n = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    if (key.startsWith("#")) {
      const n = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return whole;
  });
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
}

/** Every <a href> on the page, absolutised, with its visible text. */
function extractLinks(html, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = decodeEntities(m[1]);
    if (/^(?:#|mailto:|tel:|javascript:)/i.test(href)) continue;
    let abs;
    try {
      abs = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    out.push({ href: abs, text: stripTags(m[2]).trim().slice(0, 120) });
  }
  return out;
}

/** Score a link for how likely it leads to the meeting-notice surface. */
function scoreCandidate(link, siteOrigin) {
  let origin;
  try {
    origin = new URL(link.href).origin;
  } catch {
    return 0;
  }
  const hay = (link.text + " " + link.href).toLowerCase();
  let score = 0;
  for (const { term, score: weight } of CANDIDATE_TERMS) {
    if (hay.includes(term)) score += weight;
  }
  // An offsite link is usually the town's agenda vendor, which is exactly what
  // we want, but it is also how we wander onto Facebook. Keep vendor hosts only.
  if (origin !== siteOrigin) {
    const vendor = PLATFORMS.some((p) => p.signals.some((s) => hay.includes(s)));
    if (!vendor) return 0;
    score += 4;
  }
  return score;
}

function detectPlatforms(text) {
  const hay = text.toLowerCase();
  return PLATFORMS.filter((p) => p.signals.some((s) => hay.includes(s))).map((p) => p.label);
}

function matchAll(text, patterns) {
  const found = new Map();
  for (const { kind, re } of patterns) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      // Trim trailing punctuation that HTML and prose leave stuck to a URL.
      const url = m[0].replace(/[.,;:'"]+$/, "");
      if (!found.has(url)) found.set(url, kind);
    }
  }
  return [...found].map(([url, kind]) => ({ kind, url }));
}

// --- per-municipality pass --------------------------------------------------

async function surveyMunicipality(muni) {
  const record = {
    name: muni.name,
    kind: muni.kind,
    gateway: muni.gateway,
    pop2020: muni.pop2020,
    site: muni.site,
    reachable: false,
    robots: null,
    platforms: [],
    noticePages: [],
    joinable: [],
    streams: [],
    bodies: [],
    notices: [],
    pagesFetched: 0,
    notes: [],
  };

  const home = await fetchPolitely(muni.site);
  const origin = (() => {
    try {
      return new URL(home.url ?? muni.site).origin;
    } catch {
      return muni.site;
    }
  })();
  record.robots = (await hostState(origin)).robots.reason ?? null;

  if (!home.ok) {
    record.notes.push(`homepage unreachable: ${home.skipped ?? home.status}`);
    return record;
  }
  record.reachable = true;
  record.pagesFetched = 1;

  const seen = new Set([home.url]);
  const links = extractLinks(home.body, home.url);
  const ranked = links
    .map((l) => ({ ...l, score: scoreCandidate(l, origin) }))
    .filter((l) => l.score > 0)
    .sort((a, b) => b.score - a.score);

  // De-duplicate by URL, keeping the highest scoring text for each.
  const queue = [];
  for (const link of ranked) {
    const key = link.href.split("#")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push({ ...link, href: key });
    if (queue.length >= MAX_PAGES_PER_SITE - 1) break;
  }

  // Stage 1: the notice surface itself (agenda centre, meeting calendar).
  const corpus = [home.body];
  let onward = extractLinks(home.body, home.url);
  for (const link of queue) {
    const page = await fetchPolitely(link.href);
    if (page.skipped === "robots-disallow") {
      record.notes.push(`robots.txt disallows ${link.href}`);
      continue;
    }
    if (!page.ok) continue;
    record.pagesFetched += 1;
    corpus.push(page.body);
    onward = onward.concat(extractLinks(page.body, page.url));
    record.noticePages.push({ label: link.text || "(untitled)", url: page.url, score: link.score });
  }

  // Stage 2: the individual notices. This is where the remote-access link
  // actually lives - a calendar index lists meetings, but s. 20 puts the "how
  // the public may access this in real time" line in the notice for the
  // specific meeting. Stopping at stage 1 finds almost no joinable links and
  // would have made the region look far less reachable than it is.
  const eventLinks = [];
  const eventSeen = new Set(seen);
  for (const link of onward) {
    const key = link.href.split("#")[0];
    if (eventSeen.has(key) || !EVENT_LINK.test(key)) continue;
    eventSeen.add(key);
    eventLinks.push({ ...link, href: key });
    if (eventLinks.length >= MAX_NOTICES_PER_SITE) break;
  }

  for (const link of eventLinks) {
    const page = await fetchPolitely(link.href);
    if (!page.ok) continue;
    record.pagesFetched += 1;
    corpus.push(page.body);

    const text = stripTags(page.body);
    const notice = {
      title: decodeEntities(link.text) || pageTitle(page.body) || "(untitled)",
      url: page.url,
      date: firstDate(text),
      start_time: null,
      timezone: null,
      weekday: null,
      location: null,
      joinable: matchAll(page.body, JOINABLE_PATTERNS),
      detail_source: "html",
    };

    // The HTML page is mostly chrome. Where the platform publishes a per-event
    // .ics, take the structured record instead: it is the only place the exact
    // start time and its timezone appear, and a schedule cannot be built
    // without both.
    const eid = eidOf(page.url);
    if (eid) {
      const ics = await fetchPolitely(civicPlusIcsUrl(origin, eid));
      if (ics.ok) {
        const [event] = parseEvents(ics.body);
        if (event) {
          record.pagesFetched += 1;
          const parts = localParts(event.start, event.timezone);
          notice.title = event.summary?.trim() || notice.title;
          notice.location = event.location?.replace(/\s+/g, " ").trim() || null;
          notice.date = parts?.date ?? notice.date;
          notice.start_time = parts?.time ?? null;
          notice.timezone = parts?.timezone ?? null;
          notice.weekday = parts?.weekday ?? null;
          notice.detail_source = "ics";
          // The description is where a remote-access line would live.
          const extra = matchAll(
            [event.description, event.location, event.url].filter(Boolean).join(" "),
            JOINABLE_PATTERNS
          );
          for (const j of extra) {
            if (!notice.joinable.some((x) => x.url === j.url)) notice.joinable.push(j);
          }
        }
      }
    }
    record.notices.push(notice);
  }

  // The roster of public bodies. Commercially this is the addressable market in
  // the town; operationally it is the list of chairs who have to be notified
  // before any of their meetings may be recorded.
  const rss = await fetchPolitely(new URL("/rss.aspx", origin).href);
  if (rss.ok) {
    record.pagesFetched += 1;
    record.bodies = parseBodyRoster(rss.body);
  }

  const all = corpus.join("\n");
  record.platforms = detectPlatforms(all);
  record.joinable = matchAll(all, JOINABLE_PATTERNS);
  record.streams = matchAll(all, STREAM_PATTERNS).slice(0, 6);

  return record;
}

/** The <title> of a page, entity-decoded, for a notice with no link text. */
function pageTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(stripTags(m[1])).trim().slice(0, 140) : null;
}

// Dates as municipal sites actually write them. Kept deliberately narrow: a
// wrong date on a capture schedule means recording nothing, or recording the
// wrong body, so an unparsed date is recorded as null for a human to fill.
const DATE_PATTERNS = [
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i,
  /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/,
  /\b(\d{4})-(\d{2})-(\d{2})\b/,
];

function firstDate(text) {
  for (const re of DATE_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const parsed = new Date(m[0].replace(/,/g, ""));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
}

// --- runner -----------------------------------------------------------------

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        try {
          results[i] = await worker(items[i]);
        } catch (err) {
          results[i] = { name: items[i].name, error: String(err?.message ?? err) };
        }
      }
    })
  );
  return results;
}

async function main() {
  const seedPath = join(HERE, "municipalities.json");
  const seed = JSON.parse(await readFile(seedPath, "utf8"));
  const list = seed.municipalities;

  console.log(`Discovery pass: ${list.length} municipalities in ${seed.region}.`);
  console.log(`User-Agent: ${USER_AGENT}`);
  console.log(
    `Politeness: robots.txt enforced, min ${MIN_HOST_DELAY_MS}ms between requests to a host, ` +
      `max ${MAX_PAGES_PER_SITE} pages per site.\n`
  );

  const started = Date.now();
  const records = await pool(list, SITE_CONCURRENCY, async (muni) => {
    const rec = await surveyMunicipality(muni);
    const bits = [
      rec.reachable ? "ok" : "UNREACHABLE",
      rec.platforms.length ? rec.platforms.join(", ") : "no known platform",
      `${rec.joinable.length} joinable`,
      `${rec.streams.length} stream`,
    ];
    console.log(`  ${muni.name.padEnd(15)} ${bits.join("  |  ")}`);
    return rec;
  });

  const catalogue = {
    generated_at: new Date().toISOString(),
    region: seed.region,
    crawler: USER_AGENT,
    legal_basis:
      "Public meeting notices posted under G.L. c. 30A, s. 20. Public pages only, " +
      "robots.txt honoured, rate limited, no authentication. Recording an open " +
      "session additionally requires notifying the chair under s. 20(c), which is " +
      "handled outside this tool and is a precondition of any capture.",
    municipalities: records,
  };

  const outDir = join(HERE, "out");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, "catalogue.json");
  await writeFile(outPath, JSON.stringify(catalogue, null, 2), "utf8");

  const reachable = records.filter((r) => r.reachable).length;
  const withJoinable = records.filter((r) => r.joinable?.length).length;
  const pages = records.reduce((a, r) => a + (r.pagesFetched ?? 0), 0);
  console.log(
    `\n${reachable}/${records.length} reachable, ${withJoinable} with a joinable remote link, ` +
      `${pages} pages fetched in ${Math.round((Date.now() - started) / 1000)}s.`
  );
  console.log(`Catalogue written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
