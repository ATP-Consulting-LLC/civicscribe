// snippetAround: the front-page search panel showed three verbatim utterances
// of 686, 4633 and 2744 characters - a 2066px slab, taller than the hero and
// 41% of the whole page, in which the searched word was nowhere to be seen.
// A hit is evidence a word was said, not a reason to reprint the whole turn.

import { describe, expect, it } from "vitest";

import { snippetAround, tokenize } from "@/lib/text/highlight";

const LONG =
  "Before we get to that I want to thank the department for the work they " +
  "put in over the last several weeks on the culvert replacement and the " +
  "sidewalk survey which took longer than any of us expected it would. " +
  "The budget line we are discussing tonight covers the second half of the " +
  "fiscal year and I would ask members to hold questions until the end. " +
  "There is a lot of ground to cover and I do not want to lose the thread.";

describe("snippetAround", () => {
  it("returns short text untouched and reports no clipping", () => {
    const s = snippetAround("The budget passed.", tokenize("budget"));
    expect(s).toEqual({
      text: "The budget passed.",
      clippedStart: false,
      clippedEnd: false,
    });
  });

  it("caps a long utterance at the character budget", () => {
    const s = snippetAround(LONG, tokenize("budget"), 180);
    expect(LONG.length).toBeGreaterThan(400);
    expect(s.text.length).toBeLessThanOrEqual(180);
  });

  it("keeps the matched word inside the window", () => {
    // The match sits deep in the text: a head-of-string truncation would drop it.
    expect(snippetAround(LONG, tokenize("budget"), 180).text).toContain("budget");
    expect(snippetAround(LONG, tokenize("thread"), 180).text).toContain("thread");
    expect(snippetAround(LONG, tokenize("culvert"), 180).text).toContain("culvert");
  });

  it("finds the match by stem, the same rule the highlighter marks with", () => {
    // Postgres FTS matches "zoned" for a query of "zoning"; the window has to
    // agree, or it clips off the very word the panel exists to show.
    const text = "a".repeat(300) + " the parcel was zoned residential in 1974";
    const s = snippetAround(text, tokenize("zoning"), 120);
    expect(s.text).toContain("zoned");
    expect(s.clippedStart).toBe(true);
  });

  it("flags both cuts when the window sits in the middle", () => {
    const s = snippetAround(LONG, tokenize("budget"), 180);
    expect(s.clippedStart).toBe(true);
    expect(s.clippedEnd).toBe(true);
  });

  it("does not begin or end mid-word", () => {
    const s = snippetAround(LONG, tokenize("budget"), 180);
    expect(LONG).toContain(s.text);
    // Every word in the snippet is a whole word of the source.
    for (const word of s.text.split(/\s+/)) {
      expect(LONG.split(/\s+/)).toContain(word);
    }
  });

  it("falls back to the head of the text when nothing matches", () => {
    const s = snippetAround(LONG, tokenize("xylophone"), 180);
    expect(s.clippedStart).toBe(false);
    expect(s.clippedEnd).toBe(true);
    expect(LONG.startsWith(s.text)).toBe(true);
  });

  it("still fills the budget when the match is at the very end", () => {
    const s = snippetAround(LONG, tokenize("thread"), 180);
    // Re-anchoring must keep the window wide, not collapse it to a few words.
    expect(s.text.length).toBeGreaterThan(120);
    expect(s.clippedEnd).toBe(false);
  });
});
