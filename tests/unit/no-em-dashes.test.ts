// Long dashes are not allowed in any text CivicScribe shows the public. Stripping
// them once is not a guarantee: the next edit to a legal page, or a summariser
// prompt that stops forbidding them, puts them straight back with nothing failing.
// This test is the guard.
//
// It checks two different things, because there are two ways a dash reaches a page:
//   1. STATIC prose, written by us in the page sources.
//   2. GENERATED prose, written by the model into every published summary. That one
//      is only held back by an instruction in the system prompt, so assert the
//      instruction is actually present.
//
// Comments are stripped before the source check: a dash in a code comment is never
// rendered, and failing on those would train people to work around this test.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "@/lib/providers/real/anthropic";

const EM_DASH = "—";
const EN_DASH = "–";
const LONG_DASHES = new RegExp(`[${EM_DASH}${EN_DASH}]`);

const ROOT = path.resolve(__dirname, "../..");

/** Every source that renders text to a member of the public. */
const PUBLIC_SOURCES = [
  "src/app/page.tsx",
  "src/app/terms/page.tsx",
  "src/app/privacy/page.tsx",
  "src/app/library/page.tsx",
  "src/app/meetings/[id]/page.tsx",
  "src/app/meetings/[id]/live/page.tsx",
  "src/app/topics/page.tsx",
  "src/app/topics/[slug]/page.tsx",
  "src/app/tags/[slug]/page.tsx",
  "src/app/search/page.tsx",
  "src/components/legal/LegalPage.tsx",
  "src/components/meeting/MeetingView.tsx",
  "src/components/meeting/SummaryPanel.tsx",
];

/** Remove // line comments and block comments so only real content is checked. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

describe("no long dashes on public-facing pages", () => {
  it.each(PUBLIC_SOURCES)("%s has no em or en dash in rendered text", (rel) => {
    const src = stripComments(readFileSync(path.join(ROOT, rel), "utf8"));
    const offenders = src
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => LONG_DASHES.test(line));

    expect(
      offenders.map(({ n, line }) => `${rel}:${n}  ${line.slice(0, 120)}`),
      `use a comma, a colon, or " - " instead of a long dash`
    ).toEqual([]);
  });

  // The published summary is model output. Without this instruction the model
  // emits em dashes freely and they land straight on the public meeting page.
  it.each(["meeting", "course"] as const)(
    "the %s summariser prompt forbids long dashes",
    (kind) => {
      const prompt = buildSystemPrompt(kind === "course" ? "course" : undefined);
      expect(prompt.toLowerCase()).toContain("em dash");
      expect(prompt.toLowerCase()).toContain("en dash");
      expect(prompt).not.toMatch(LONG_DASHES);
    }
  );
});
