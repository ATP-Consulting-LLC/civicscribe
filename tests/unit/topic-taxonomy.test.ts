// The topic browse surface must be FINITE. Before the taxonomy, every phrasing
// the model produced minted its own permanent /tags page, so a library of a few
// dozen meetings showed dozens of near-duplicate topics and no usable index.
//
// These tests pin the two properties that matter:
//   1. Boundedness: nothing outside CANONICAL_TOPICS can ever reach browse.
//   2. Collapse: the real-world phrasings that caused the sprawl land together.

import { describe, expect, it } from "vitest";

import {
  CANONICAL_TOPICS,
  OTHER_TOPIC,
  canonicalTopicBySlug,
  canonicalizeTopic,
} from "@/lib/topics/taxonomy";
import { aggregateTopics, topicMatchesSlug } from "@/lib/topics";

describe("canonical topic taxonomy", () => {
  it("has unique slugs and labels", () => {
    const slugs = CANONICAL_TOPICS.map((t) => t.slug);
    const labels = CANONICAL_TOPICS.map((t) => t.label);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("is small enough to browse", () => {
    // The whole point is a human-scannable index, not an unbounded cloud.
    expect(CANONICAL_TOPICS.length).toBeLessThanOrEqual(25);
  });

  it("every slug is URL-safe and resolvable", () => {
    for (const t of CANONICAL_TOPICS) {
      expect(t.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(canonicalTopicBySlug(t.slug)).toEqual(t);
    }
  });

  it("keeps Other last so it sorts to the end of a listing", () => {
    expect(CANONICAL_TOPICS[CANONICAL_TOPICS.length - 1]).toEqual(OTHER_TOPIC);
  });
});

describe("canonicalizeTopic", () => {
  it("NEVER returns a bucket outside the fixed set", () => {
    const wild = [
      "Rezoning of 12 Oak St from R-1 to R-2",
      "Quantum blockchain llama husbandry",
      "!!!",
      "",
      "a",
      "Some Very Long Topic Nobody Anticipated At All",
    ];
    const known = new Set(CANONICAL_TOPICS.map((t) => t.slug));
    for (const w of wild) {
      expect(known.has(canonicalizeTopic(w).slug)).toBe(true);
    }
  });

  it("collapses the phrasings that caused the sprawl", () => {
    const zoning = [
      "Downtown rezoning proposal",
      "Rezoning of 12 Oak St from R-1 to R-2",
      "Zoning variance request",
      "Site plan review",
      "Subdivision approval",
    ];
    for (const t of zoning) {
      expect(canonicalizeTopic(t).slug, t).toBe("zoning-land-use");
    }
    // one bucket, not five
    expect(new Set(zoning.map((t) => canonicalizeTopic(t).slug)).size).toBe(1);
  });

  it.each([
    ["Affordable housing overlay district", "housing"],
    ["Water main replacement on Elm", "water-sewer"],
    ["Stormwater drainage complaints", "water-sewer"],
    ["Police department staffing", "public-safety"],
    ["School committee budget hearing", "schools-education"],
    ["FY27 budget appropriation", "budget-taxes"],
    ["Sidewalk repair on Main Street", "transportation"],
    ["Liquor license transfer", "permits-licensing"],
    ["Council on aging van service", "social-services"],
    ["Historical commission demolition delay", "arts-culture-history"],
  ])("maps %j to %s", (topic, slug) => {
    expect(canonicalizeTopic(topic).slug).toBe(slug);
  });

  it("sends genuinely unmatched subject matter to Other, not to a new bucket", () => {
    expect(canonicalizeTopic("Quantum blockchain llama husbandry")).toEqual(
      OTHER_TOPIC
    );
  });

  it("does not let a short word match inside an unrelated word", () => {
    // "-tax-" must not fire on "taxi"; "-bus-" must not fire on "business".
    expect(canonicalizeTopic("Taxi medallion rules").slug).not.toBe("budget-taxes");
    expect(canonicalizeTopic("Business improvement district").slug).toBe(
      "economic-development"
    );
  });
});

describe("aggregateTopics over canonical buckets", () => {
  it("collapses many phrasings across meetings into few buckets", () => {
    const rows = [
      { meetingId: "m1", topics: ["Downtown rezoning proposal", "Sidewalk repair"] },
      { meetingId: "m2", topics: ["Rezoning of 12 Oak St", "Zoning variance request"] },
      { meetingId: "m3", topics: ["Site plan review"] },
    ];
    const out = aggregateTopics(rows);
    const zoning = out.find((t) => t.slug === "zoning-land-use");

    expect(zoning).toBeDefined();
    // three DISTINCT meetings, even though m2 contributed two zoning phrasings
    expect(zoning!.count).toBe(3);
    expect(zoning!.topic).toBe("Zoning & Land Use");
    // zoning + transportation, not five separate topics
    expect(out).toHaveLength(2);
  });

  it("still drops procedural items entirely", () => {
    const out = aggregateTopics([
      { meetingId: "m1", topics: ["Roll call", "Approval of minutes", "Adjournment"] },
    ]);
    expect(out).toEqual([]);
  });
});

describe("topicMatchesSlug against canonical buckets", () => {
  it("matches a specific topic to its bucket slug", () => {
    expect(topicMatchesSlug("Rezoning of 12 Oak St", "zoning-land-use")).toBe(true);
    expect(topicMatchesSlug("Rezoning of 12 Oak St", "housing")).toBe(false);
  });

  it("no longer matches the topic's own literal slug", () => {
    // This is the behaviour change that bounds the surface: the specific slug
    // is not a browsable page any more.
    expect(topicMatchesSlug("Downtown rezoning proposal", "downtown-rezoning-proposal")).toBe(false);
  });

  it("never matches a procedural topic", () => {
    expect(topicMatchesSlug("Roll call", "governance-elections")).toBe(false);
  });
});
