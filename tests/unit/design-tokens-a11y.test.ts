// The design tokens in globals.css carry accessibility promises that are easy to
// break by eye and impossible to notice in review: a colour nudged one shade
// lighter, a font size trimmed to make a heading fit, a tap target shrunk to
// tidy up a toolbar. CivicScribe's readers are mostly older people with poor
// vision, so those promises are load-bearing.
//
// This test reads the real globals.css and proves them:
//   - every text colour clears WCAG AAA (7:1) against the surface it sits on
//   - accent-bright clears AAA on dark AND is genuinely unusable on white,
//     which is why the CSS must never place it there
//   - the type scale keeps its 14px floor and its 1.25 ratio above the anchor
//   - interactive targets stay above the WCAG 2.5.5 minimum of 44px
//
// It fails on the VALUES, not on the presence of a comment, so it cannot be
// satisfied by editing the documentation around them.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  path.join(process.cwd(), "src", "app", "globals.css"),
  "utf8",
);

/** Pull a `--name: value;` declaration out of the stylesheet. */
function token(name: string): string {
  const m = CSS.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`token --${name} not found in globals.css`);
  return m[1].trim();
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`not a hex colour: ${hex}`);
  }
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1..21. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** rem string -> px, assuming the 16px root default. */
function rem(value: string): number {
  const m = value.match(/^([\d.]+)rem$/);
  if (!m) throw new Error(`expected a rem value, got: ${value}`);
  return parseFloat(m[1]) * 16;
}

const AAA = 7; // WCAG 1.4.6 enhanced contrast, normal text

describe("design tokens: colour contrast", () => {
  const paper = token("color-paper");
  const dark = token("color-dark");

  // Every colour we set text in, against the surface it is set on. AAA, not AA:
  // 4.5:1 is the minimum for a sighted adult, and this audience is not that.
  const onWhite: Array<[string, string]> = [
    ["color-ink", "primary body and headings"],
    ["color-ink-soft", "secondary body text"],
    ["color-ink-faint", "the faintest text allowed anywhere"],
    ["color-accent", "links and kickers"],
    ["color-accent-strong", "link hover"],
  ];

  it.each(onWhite)("%s clears AAA on paper (%s)", (name) => {
    const ratio = contrast(token(name), paper);
    expect(ratio).toBeGreaterThanOrEqual(AAA);
  });

  it("accent-bright clears AAA on the dark surface", () => {
    expect(contrast(token("color-accent-bright"), dark)).toBeGreaterThanOrEqual(
      AAA,
    );
  });

  // This is the trap the token comment warns about. accent-bright is a light
  // mint chosen to sing on the dark hero; on white it is close to invisible.
  // Asserting it FAILS on white is what makes the "never on white" rule real
  // rather than a note someone can miss.
  it("accent-bright is genuinely unusable on white, justifying the on-dark-only rule", () => {
    expect(contrast(token("color-accent-bright"), paper)).toBeLessThan(4.5);
  });

  // Scoped to the NEUTRAL ink ramp on purpose. The accent is a different hue and
  // is allowed to be lighter in luminance than ink-faint while still clearing
  // AAA - the earlier version of this test compared them and was simply wrong.
  it("the ink ramp descends, so no neutral text colour sneaks in below ink-faint", () => {
    const ramp = ["color-ink", "color-ink-soft", "color-ink-faint"].map((t) =>
      luminance(token(t)),
    );
    for (let i = 1; i < ramp.length; i++) {
      expect(ramp[i]).toBeGreaterThan(ramp[i - 1]);
    }
    // ink-faint is the light end of the ramp and still has to clear AAA.
    expect(contrast(token("color-ink-faint"), paper)).toBeGreaterThanOrEqual(AAA);
  });

  it("the raised-contrast override actually raises contrast", () => {
    // prefers-contrast: more redefines these; the override is pointless if it
    // does not beat the default it replaces.
    const block = CSS.match(/prefers-contrast:\s*more\s*\)\s*\{([\s\S]*?)\n {2}\}/);
    expect(block, "prefers-contrast block not found").toBeTruthy();
    const overrideInkSoft = block![1].match(
      /--color-ink-soft\s*:\s*([^;]+);/,
    )?.[1];
    expect(overrideInkSoft).toBeTruthy();
    expect(contrast(overrideInkSoft!.trim(), paper)).toBeGreaterThan(
      contrast(token("color-ink-soft"), paper),
    );
  });
});

describe("design tokens: type scale", () => {
  it("holds a 14px floor - nothing on the site may be smaller", () => {
    expect(rem(token("text-xs"))).toBeGreaterThanOrEqual(14);
  });

  // The two steps below the anchor exist only because the floor overrode the
  // ratio. Assert they really are above where the maths would have put them,
  // so a future edit cannot quietly "restore the ratio" and shrink them.
  it("keeps the sub-anchor steps above what the ratio would have given", () => {
    const base = rem(token("text-base"));
    expect(rem(token("text-sm"))).toBeGreaterThan(base / 1.25);
    expect(rem(token("text-xs"))).toBeGreaterThan(base / 1.25 / 1.25);
  });

  it("sets body text at 16px", () => {
    expect(rem(token("text-base"))).toBe(16);
  });

  // text-xs (14px) and text-sm (15px) are BOTH floor overrides, not ratio steps:
  // 1.25 downward from the 16px anchor would give 12.8px and 10.2px, and the
  // accessibility floor beats the arithmetic. The geometric ladder therefore
  // starts at the anchor and only runs upward.
  it("is geometric at ratio 1.25 from the 16px anchor upward", () => {
    const steps = [
      "text-base",
      "text-lg",
      "text-xl",
      "text-2xl",
      "text-3xl",
      "text-4xl",
      "text-5xl",
    ].map((t) => rem(token(t)));

    for (let i = 1; i < steps.length; i++) {
      const ratio = steps[i] / steps[i - 1];
      // Sizes are rounded to usable rem values, so allow a little drift.
      expect(ratio).toBeGreaterThan(1.2);
      expect(ratio).toBeLessThan(1.3);
    }
  });

  it("is strictly ascending", () => {
    const steps = [
      "text-xs",
      "text-sm",
      "text-base",
      "text-lg",
      "text-xl",
      "text-2xl",
      "text-3xl",
      "text-4xl",
      "text-5xl",
    ].map((t) => rem(token(t)));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    }
  });
});

describe("design tokens: interactive targets", () => {
  it("clears the WCAG 2.5.5 minimum of 44px", () => {
    expect(rem(token("size-target"))).toBeGreaterThanOrEqual(44);
  });

  it("gives primary controls more room than the minimum", () => {
    expect(rem(token("size-target-lg"))).toBeGreaterThan(
      rem(token("size-target")),
    );
  });

  it("keeps the focus ring thick enough to find", () => {
    const ring = CSS.match(/outline:\s*(\d+)px solid var\(--color-focus\)/);
    expect(ring, "focus ring rule not found").toBeTruthy();
    expect(Number(ring![1])).toBeGreaterThanOrEqual(3);
  });
});
