// Search-query tokenizing and stem-aware match highlighting. No "use client"
// directive and no React: pure functions usable from server components, client
// components, and tests (node env). HighlightedText (transcript-utils.tsx) maps
// the segments to <mark>/<span>.

import stem from "wink-porter2-stemmer";

/** Lowercased whitespace-separated tokens of a search query. */
export function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when the text contains every token (case-insensitive). */
export function matchesAllTokens(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const lower = text.toLowerCase();
  return tokens.every((token) => lower.includes(token));
}

export interface HighlightSegment {
  text: string;
  marked: boolean;
}

// A run of letters/numbers is a "word"; everything else (spaces, punctuation)
// is passed through unmarked. The capturing group keeps the words in split().
const WORD_RUN = /([\p{L}\p{N}]+)/u;
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Split text into ordered segments, marking each word that matches any query
 * token. A word matches when it contains a token as a case-insensitive
 * substring (the literal behavior the old highlighter had) OR shares a stem
 * with a token, so Postgres FTS stemming — a query of "zoning" matching an
 * utterance that says "zoned" — is reflected in the highlight. Joining the
 * segment texts reconstructs the original text exactly.
 */
export function highlightSegments(
  text: string,
  tokens: string[]
): HighlightSegment[] {
  const cleaned = tokens.filter(Boolean).map((t) => t.toLowerCase());
  if (cleaned.length === 0) return [{ text, marked: false }];

  const tokenStems = new Set(cleaned.map((t) => stem(t)));
  const segments: HighlightSegment[] = [];

  for (const piece of text.split(WORD_RUN)) {
    if (piece === "") continue;
    const marked = HAS_WORD_CHAR.test(piece) && wordMatches(piece, cleaned, tokenStems);
    // Coalesce consecutive segments of the same marked-ness for tidy rendering.
    const last = segments[segments.length - 1];
    if (last && last.marked === marked) {
      last.text += piece;
    } else {
      segments.push({ text: piece, marked });
    }
  }

  return segments.length > 0 ? segments : [{ text, marked: false }];
}

function wordMatches(
  word: string,
  tokens: string[],
  tokenStems: Set<string>
): boolean {
  const lower = word.toLowerCase();
  if (tokens.some((t) => lower.includes(t))) return true;
  return tokenStems.has(stem(lower));
}

export interface Snippet {
  /** The windowed text. Feed this to HighlightedText, not the full utterance. */
  text: string;
  /** True when characters were dropped before/after the window. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * Cut a short window of text centred on the first token match.
 *
 * A search hit is evidence that a word was said, not a reason to reprint the
 * whole turn: the front page was rendering three verbatim utterances of 686,
 * 4633 and 2744 characters, a 2066px slab taller than the hero and 41% of the
 * page, in which the searched word was invisible. The window keeps the match
 * plus enough either side to read it in context.
 *
 * Boundaries are snapped outward to whitespace so a snippet never begins or
 * ends mid-word. If no token matches (the store's stemming is broader than
 * ours), the window falls back to the head of the text rather than to nothing.
 */
export function snippetAround(
  text: string,
  tokens: string[],
  maxChars = 180
): Snippet {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return { text: trimmed, clippedStart: false, clippedEnd: false };
  }

  // Reuse the highlighter so "where does the match start" answers with the same
  // stem-aware rule the <mark> uses. Two rules would drift and clip off the very
  // word the panel exists to show.
  let matchAt = -1;
  let offset = 0;
  for (const segment of highlightSegments(trimmed, tokens)) {
    if (segment.marked) {
      matchAt = offset;
      break;
    }
    offset += segment.text.length;
  }

  // Aim to show a little run-up to the match, then fill the rest of the budget.
  const lead = Math.floor(maxChars / 3);
  let start = matchAt < 0 ? 0 : Math.max(0, matchAt - lead);
  let end = Math.min(trimmed.length, start + maxChars);
  // Re-anchor when the window hit the end: keep it maxChars wide, not shorter.
  start = Math.max(0, Math.min(start, trimmed.length - maxChars));

  if (start > 0) {
    const space = trimmed.indexOf(" ", start);
    start = space === -1 ? start : space + 1;
  }
  if (end < trimmed.length) {
    const space = trimmed.lastIndexOf(" ", end);
    end = space > start ? space : end;
  }

  return {
    text: trimmed.slice(start, end).trim(),
    clippedStart: start > 0,
    clippedEnd: end < trimmed.length,
  };
}
