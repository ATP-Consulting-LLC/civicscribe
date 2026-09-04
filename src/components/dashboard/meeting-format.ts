// Pure date/duration formatters shared by BOTH server components (the public
// library + tag grids, which render on the server) and client components (the
// operator MeetingCard / ReviewQueue).
//
// These deliberately live in their own plain module, NOT in MeetingCard.tsx.
// MeetingCard is a "use client" module, and any value imported from a client
// module into a server component becomes a client *reference* — calling it
// during a server render throws "Attempted to call formatDate() from the server
// but formatDate is on the client", which 500'd /library (and /tags, /study-
// notes) whenever the grid had at least one published meeting to format.

/** "42:17 min" under an hour, "1:23 hr" at an hour or more. */
/** Milliseconds from the start of a recording as H:MM:SS, the form people use
 *  when citing a moment in a meeting ("at 41:55 she said..."). Hours are only
 *  shown when there are any, since most clips are under an hour. */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h >= 1) {
    return `${h}:${String(m).padStart(2, "0")} hr`;
  }
  return `${m}:${String(s).padStart(2, "0")} min`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
