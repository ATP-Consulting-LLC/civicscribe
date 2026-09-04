// Phase 2 topic browse on MemoryStore: listTopics aggregates summaries.topics
// across PUBLISHED meetings only into { topic, slug, count } buckets, and
// getTopicMeetings returns the published meetings for a slug newest first.
// Unpublished meetings must never leak through either surface.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryStore } from "@/lib/store/memory";
import { canonicalizeTopic } from "@/lib/topics/taxonomy";
import type { MeetingSummaryContent } from "@/lib/types";
import { cleanupDataDir, makeTempDataDir } from "./helpers";

let dataDir: string;
let store: MemoryStore;

beforeEach(async () => {
  dataDir = await makeTempDataDir();
  store = new MemoryStore(dataDir);
});

afterEach(async () => {
  await cleanupDataDir(dataDir);
});

let urlSeed = 0;
function uniqueYoutubeUrl(): string {
  // 11-char ids the sourceKey extractor accepts, distinct per meeting so each
  // gets its own dedup key and they coexist.
  const id = `vid${String(urlSeed++).padStart(8, "0")}`;
  return `https://www.youtube.com/watch?v=${id}`;
}

function summary(topics: string[]): MeetingSummaryContent {
  return {
    overview: `Overview about ${topics.join(", ")}`,
    key_decisions: [],
    action_items: [],
    topics,
    full_markdown: "# md",
  };
}

/** Create a meeting + its summary; publish it unless published=false. */
async function seedMeeting(opts: {
  title: string;
  topics: string[];
  published?: boolean;
}) {
  const m = await store.createMeeting({
    title: opts.title,
    body_name: "City Council",
    source_type: "stream",
    source_url: uniqueYoutubeUrl(),
  });
  await store.createSummary(m.id, summary(opts.topics));
  if (opts.published !== false) await store.publishMeeting(m.id);
  return m;
}

describe("listTopics — published-only aggregation", () => {
  it("counts distinct published meetings per topic", async () => {
    await seedMeeting({ title: "A", topics: ["zoning", "budget"] });
    await seedMeeting({ title: "B", topics: ["zoning"] });
    await seedMeeting({ title: "C", topics: ["budget", "parks"] });

    // Topics aggregate into the FIXED canonical buckets, so key on the slug.
    const topics = await store.listTopics();
    const bySlug = new Map(topics.map((t) => [t.slug, t.count]));
    expect(bySlug.get("zoning-land-use")).toBe(2);
    expect(bySlug.get("budget-taxes")).toBe(2);
    expect(bySlug.get("parks-recreation")).toBe(1);
  });

  it("carries the canonical bucket slug and label for each topic", async () => {
    await seedMeeting({ title: "A", topics: ["Public Safety"] });
    const topics = await store.listTopics();
    const t = topics.find((x) => x.slug === "public-safety");
    expect(t).toBeDefined();
    // The slug is the BUCKET's, not a re-slug of the raw wording. Those coincide
    // here; assert against the taxonomy so the test still means something when
    // the raw topic is "Police department staffing".
    expect(t?.slug).toBe(canonicalizeTopic("Public Safety").slug);
    expect(t?.topic).toBe("Public Safety");
  });

  it("excludes topics that only appear on unpublished meetings", async () => {
    await seedMeeting({ title: "pub", topics: ["zoning"] });
    await seedMeeting({ title: "draft", topics: ["water main break"], published: false });

    const topics = await store.listTopics();
    expect(topics.map((t) => t.slug)).toContain("zoning-land-use");
    expect(topics.map((t) => t.slug)).not.toContain("water-sewer");
  });

  it("does not double-count a meeting that lists the same slug twice", async () => {
    // Two raw spellings that slugify to the same bucket on one meeting must
    // count as a single meeting for that slug.
    await seedMeeting({ title: "A", topics: ["Public Safety", "public-safety"] });
    const topics = await store.listTopics();
    const t = topics.find((x) => x.slug === "public-safety");
    expect(t?.count).toBe(1);
  });

  it("collapses case/punctuation variants across meetings into one bucket", async () => {
    await seedMeeting({ title: "A", topics: ["Public Safety"] });
    await seedMeeting({ title: "B", topics: ["public safety"] });
    const topics = await store.listTopics();
    const matching = topics.filter((x) => x.slug === "public-safety");
    expect(matching).toHaveLength(1);
    expect(matching[0].count).toBe(2);
  });

  it("orders by count desc, then label asc", async () => {
    // Three DISTINCT canonical buckets, so the ordering is actually exercised.
    await seedMeeting({ title: "A", topics: ["housing", "police"] });
    await seedMeeting({ title: "B", topics: ["housing", "police"] });
    await seedMeeting({ title: "C", topics: ["housing"] });
    await seedMeeting({ title: "D", topics: ["water"] });
    await seedMeeting({ title: "E", topics: ["water"] });
    // Housing=3; Public Safety=2 and Water & Sewer=2 share a count, so the
    // label tiebreak decides between them.
    const topics = await store.listTopics();
    expect(topics.map((t) => t.topic)).toEqual([
      "Housing",
      "Public Safety",
      "Water & Sewer",
    ]);
  });

  it("returns [] when nothing is published", async () => {
    await seedMeeting({ title: "draft", topics: ["zoning"], published: false });
    expect(await store.listTopics()).toEqual([]);
  });
});

describe("getTopicMeetings — published-only, newest first", () => {
  it("returns published meetings carrying the slug, newest first", async () => {
    const a = await seedMeeting({ title: "A", topics: ["zoning"] });
    const b = await seedMeeting({ title: "B", topics: ["zoning"] });
    const c = await seedMeeting({ title: "C", topics: ["budget"] });

    const rows = await store.getTopicMeetings("zoning-land-use");
    const ids = rows.map((r) => r.meeting.id);
    // Newest first: B was created after A.
    expect(ids).toEqual([b.id, a.id]);
    expect(ids).not.toContain(c.id);
  });

  it("matches case/punctuation variants of the slug", async () => {
    await seedMeeting({ title: "A", topics: ["Public Safety"] });
    const rows = await store.getTopicMeetings("public-safety");
    expect(rows.map((r) => r.meeting.title)).toEqual(["A"]);
  });

  it("never returns unpublished meetings", async () => {
    await seedMeeting({ title: "pub", topics: ["zoning"] });
    await seedMeeting({ title: "draft", topics: ["zoning"], published: false });
    const rows = await store.getTopicMeetings("zoning-land-use");
    expect(rows.map((r) => r.meeting.title)).toEqual(["pub"]);
  });

  it("carries the summary fields a card needs", async () => {
    await seedMeeting({ title: "A", topics: ["zoning", "budget"] });
    const rows = await store.getTopicMeetings("zoning-land-use");
    expect(rows[0].overview).toContain("zoning");
    expect(rows[0].topics).toEqual(["zoning", "budget"]);
  });

  it("returns [] for an unknown or empty slug", async () => {
    await seedMeeting({ title: "A", topics: ["zoning"] });
    expect(await store.getTopicMeetings("nope")).toEqual([]);
    expect(await store.getTopicMeetings("")).toEqual([]);
  });
});
