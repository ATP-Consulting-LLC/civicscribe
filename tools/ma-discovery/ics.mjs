// Minimal iCalendar (RFC 5545) reading, plus the CivicPlus feed URLs that carry
// it. Kept dependency free and separate so it can be tested without a network.
//
// Why bother when the HTML is right there: on a CivicPlus site the calendar
// event page is 122KB of chrome and 1.8KB of text, and the event's own detail
// is not in the server-rendered HTML at all. A first pass scraped it and
// reported "no remote link anywhere in the Merrimack Valley", which was a
// parsing gap wearing the costume of a finding. The per-event .ics export is
// the published machine interface for exactly this data: it is small, it is
// structured, and it carries the one field a capture schedule cannot work
// without, a start time WITH its timezone.

/** Unfold RFC 5545 line continuations (a leading space continues the line). */
export function unfold(text) {
  return text.replace(/\r?\n[ \t]/g, "");
}

/** Decode the text escapes iCalendar uses inside property values. */
export function unescapeIcs(value) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * Parse the VEVENTs out of an ICS document.
 * Each event is { summary, location, description, url, start, timezone, raw }.
 * `start` is the literal DTSTART value; `timezone` is its TZID when present.
 */
export function parseEvents(icsText) {
  const text = unfold(icsText);
  const events = [];
  const blocks = text.split(/BEGIN:VEVENT/i).slice(1);

  for (const block of blocks) {
    const body = block.split(/END:VEVENT/i)[0];
    const event = { summary: null, location: null, description: null, url: null, start: null, timezone: null };

    for (const line of body.split(/\r?\n/)) {
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      const left = line.slice(0, colon);
      const value = unescapeIcs(line.slice(colon + 1).trim());
      const name = left.split(";")[0].trim().toUpperCase();
      if (value === "") continue;

      if (name === "SUMMARY") event.summary = value;
      else if (name === "LOCATION") event.location = value;
      else if (name === "DESCRIPTION") event.description = value;
      else if (name === "URL") event.url = value;
      else if (name === "DTSTART") {
        event.start = value;
        const tz = /TZID=([^;:]+)/i.exec(left);
        if (tz) event.timezone = tz[1].trim();
      }
    }
    if (event.summary || event.start) events.push(event);
  }
  return events;
}

/**
 * Turn an ICS DTSTART into { date, time, weekday } in its own timezone.
 * Deliberately does NOT convert to UTC: a capture schedule stores local time
 * plus an IANA zone, so converting here and back would only add a place for a
 * daylight-saving hour to go missing.
 */
export function localParts(start, timezone) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?/.exec(start ?? "");
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  const date = `${y}-${mo}-${d}`;
  const time = hh ? `${hh}:${mm}` : null;
  // Weekday from the calendar date itself, with no zone shift applied.
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return { date, time, weekday, timezone: timezone ?? null };
}

/** The per-event iCalendar export on a CivicPlus site, given a Calendar EID. */
export function civicPlusIcsUrl(origin, eid) {
  return `${origin}/common/modules/iCalendar/iCalendar.aspx?feed=calendar&eventID=${eid}`;
}

/** Pull the Calendar EID out of a CivicPlus calendar URL, or null. */
export function eidOf(url) {
  const m = /[?&]EID=(\d+)/i.exec(url);
  return m ? m[1] : null;
}

/**
 * The board and committee roster a CivicPlus site publishes on /rss.aspx.
 * Each AgendaCenter feed is named for one public body, so this enumerates the
 * bodies in a town without guessing: the roster is the addressable market in
 * that town, and it is also the list of chairs who must be notified before any
 * capture.
 */
export function parseBodyRoster(rssIndexHtml) {
  const bodies = new Map();
  const re = /RSSFeed\.aspx\?ModID=65&(?:amp;)?CID=([A-Za-z0-9-]+)/gi;
  for (const m of rssIndexHtml.matchAll(re)) {
    const slug = m[1];
    if (/^All-\d+$/i.test(slug)) continue;
    // "Conservation-Commission-12" is a name plus the platform's numeric id.
    const name = slug.replace(/-\d+$/, "").split("-").join(" ").trim();
    if (name) bodies.set(name.toLowerCase(), name);
  }
  return [...bodies.values()].sort();
}
