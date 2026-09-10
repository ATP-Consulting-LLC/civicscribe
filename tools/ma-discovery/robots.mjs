// robots.txt fetching and evaluation for the Massachusetts discovery crawler.
//
// This is the politeness guard, and it is the piece that has to be correct:
// everything downstream asks it "may I fetch this" and takes the answer as
// permission. A guard that only holds because somebody remembers to call it is
// not a guard, so discover.mjs routes EVERY request through fetchPolitely and
// there is no second door.
//
// Deliberate choices:
//   - A robots.txt we cannot read is treated as ALLOW, matching the RFC 9309
//     default (an unreachable or 404 robots.txt means unrestricted). A 5xx is
//     treated as DISALLOW, because the server is in trouble and hammering it is
//     exactly what we must not do.
//   - Longest-match wins between Allow and Disallow, per RFC 9309, so a site
//     that blankets Disallow: / and then re-opens Allow: /AgendaCenter works.
//   - Our own named group beats the wildcard group, and we never merge the two.

/** Identifies the crawler to any clerk reading a server log, with a way to reach us. */
export const USER_AGENT =
  "CivicScribeBot/1.0 (+https://civicscribe.us/about-the-crawler; meeting-notice discovery)";

/** The token we match ourselves against inside robots.txt. */
export const UA_TOKEN = "civicscribebot";

/**
 * Parse robots.txt into the rule groups that apply to us.
 * Returns { rules: [{allow, path}], crawlDelay } already narrowed to our agent.
 */
export function parseRobots(text, uaToken = UA_TOKEN) {
  const groups = new Map(); // agent -> { rules: [], crawlDelay: null }
  let current = [];
  let lastLineWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      const agent = value.toLowerCase();
      // Consecutive User-agent lines share one group of rules.
      if (!lastLineWasAgent) current = [];
      if (!current.includes(agent)) current.push(agent);
      for (const a of current) {
        if (!groups.has(a)) groups.set(a, { rules: [], crawlDelay: null });
      }
      lastLineWasAgent = true;
      continue;
    }
    lastLineWasAgent = false;
    if (current.length === 0) continue;

    for (const agent of current) {
      const group = groups.get(agent);
      if (field === "disallow") {
        // "Disallow:" with an empty value means allow everything, not block "".
        if (value !== "") group.rules.push({ allow: false, path: value });
      } else if (field === "allow") {
        if (value !== "") group.rules.push({ allow: true, path: value });
      } else if (field === "crawl-delay") {
        const n = Number.parseFloat(value);
        if (Number.isFinite(n) && n >= 0) group.crawlDelay = n;
      }
    }
  }

  // Our own group wins outright; only if we are unnamed do we fall to "*".
  return groups.get(uaToken) ?? groups.get("*") ?? { rules: [], crawlDelay: null };
}

/** Does a robots path pattern (with * and $) match this URL path? */
function patternMatches(pattern, path) {
  if (!pattern.includes("*") && !pattern.endsWith("$")) {
    return path.startsWith(pattern);
  }
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  // Escape each literal run, then restore "*" as ".*". RegExp.escape is used
  // rather than a hand-rolled character class: writing one through a shell
  // heredoc silently ate an escape here and the file would not parse.
  const source =
    "^" + body.split("*").map((part) => RegExp.escape(part)).join(".*") +
    (anchored ? "$" : "");
  return new RegExp(source).test(path);
}

/**
 * RFC 9309 longest-match evaluation. The most specific rule decides; a tie
 * between an Allow and a Disallow of equal length resolves to allow.
 */
export function isAllowed(group, pathname) {
  let best = null;
  for (const rule of group.rules) {
    if (!patternMatches(rule.path, pathname)) continue;
    if (
      best === null ||
      rule.path.length > best.path.length ||
      (rule.path.length === best.path.length && rule.allow)
    ) {
      best = rule;
    }
  }
  return best === null ? true : best.allow;
}

/** Fetch and parse a host's robots.txt. Never throws: it returns a policy. */
export async function loadRobots(origin, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(new URL("/robots.txt", origin).href, {
      headers: { "user-agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (res.status >= 500) {
      // The server is struggling. Back all the way off rather than add load.
      return { rules: [{ allow: false, path: "/" }], crawlDelay: null, reason: "5xx" };
    }
    if (!res.ok) return { rules: [], crawlDelay: null, reason: "no-robots" };
    return { ...parseRobots(await res.text()), reason: "parsed" };
  } catch {
    // Unreachable robots.txt is an allow under RFC 9309, but we still crawl at
    // the slow default rate, so an unreachable host is not hammered either.
    return { rules: [], crawlDelay: null, reason: "unreachable" };
  }
}
