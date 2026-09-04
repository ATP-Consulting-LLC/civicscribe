// The public copy is written to a measured fifth-grade reading level, because
// the people reading it are mostly older residents and city staff. "Make it
// simpler" is not a measurement and neither is anyone's sense that a sentence
// reads easily: before this pass the copy FELT plain and measured as high as
// grade 14.3 ("Moderator review before anything is published").
//
// This test does two things, and it needs both to be worth anything:
//
//   1. Every recorded string scores at or under the target grade.
//   2. Every recorded string is STILL PRESENT in the source it came from.
//
// Without (2) the JSON is just a wish list: someone edits the page, the record
// goes stale, and the test happily keeps grading copy the site no longer shows.
// (2) is what ties the measurement to reality.
//
// The formula and the syllable heuristic are copied from plainspeak/fk.mjs so
// the number here is the same number that tool reports.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const TARGET_GRADE = 5.5;

/** Files the recorded strings are allowed to live in. */
const SOURCES = [
  "src/app/page.tsx",
  "src/app/layout.tsx",
  "src/app/library/page.tsx",
  "src/app/topics/page.tsx",
  "src/components/contact/ContactForm.tsx",
];

function syllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  w = w.replace(/^y/, "");
  const groups = w.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

function fkGrade(text: string): number {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.match(/[A-Za-z'][A-Za-z'-]*/g) ?? [];
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const wps = words.length / Math.max(1, sentences.length);
  const spw = syl / Math.max(1, words.length);
  return +(0.39 * wps + 11.8 * spw - 15.59).toFixed(1);
}

const copy: Record<string, string> = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "docs", "copy", "public-surfaces.json"),
    "utf8",
  ),
);

/** All source text, with JSX line wrapping collapsed so a string broken across
 *  lines in the markup still matches the single-line string in the record. */
const haystack = SOURCES.map((f) =>
  readFileSync(path.join(process.cwd(), f), "utf8"),
)
  .join("\n")
  .replace(/\s+/g, " ");

describe("public copy reading level", () => {
  const entries = Object.entries(copy);

  it("records a meaningful amount of copy, so the suite cannot pass on an empty file", () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  it.each(entries)("%s reads at or under grade 5.5", (_key, text) => {
    expect(fkGrade(text)).toBeLessThanOrEqual(TARGET_GRADE);
  });

  // A long sentence is what usually drags a grade up, and the average hides it.
  it.each(entries)("%s has no runaway sentence", (_key, text) => {
    const longest = Math.max(
      0,
      ...text
        .split(/[.!?]+/)
        .filter((s) => s.trim())
        .map((s) => (s.match(/[A-Za-z'][A-Za-z'-]*/g) ?? []).length),
    );
    expect(longest).toBeLessThanOrEqual(20);
  });
});

describe("the copy record matches the site", () => {
  // This is the half that stops the record rotting into fiction.
  it.each(Object.entries(copy))(
    "%s still appears in the source",
    (_key, text) => {
      const needle = text.replace(/\s+/g, " ").trim();
      expect(haystack).toContain(needle);
    },
  );
});
