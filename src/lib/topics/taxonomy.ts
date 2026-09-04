// A FIXED set of canonical civic topic buckets.
//
// Why this exists: summaries carry free-text `topics: string[]`, and topicSlug()
// only collapses case and punctuation. So "Downtown rezoning proposal" and
// "Rezoning of 12 Oak St" slugify to two different, permanent browse pages. The
// tag surface therefore grew without bound: every meeting could mint new buckets
// forever, and a resident browsing /topics saw dozens of near-duplicates instead
// of a usable index.
//
// The fix follows the pattern already used for procedural topics in ../topics.ts:
// an instruction in the summariser prompt PLUS a deterministic backstop here. The
// backstop is what matters, because it also buckets every summary written before
// the instruction existed, with no LLM re-run and no migration.
//
// Specific wording is NOT thrown away. The per-meeting chips still show the exact
// topic the model wrote ("Rezoning of 12 Oak St"); only the browse surfaces
// (/topics, /tags/[slug]) collapse to these buckets, and a chip links to its
// bucket rather than to a page of one.

import { topicSlug } from "@/lib/topics/slug";

export interface CanonicalTopic {
  /** URL-safe slug: the join key for /tags/[slug]. */
  readonly slug: string;
  /** Display label for browse surfaces. */
  readonly label: string;
}

interface Bucket extends CanonicalTopic {
  /** Matched as a WHOLE hyphen-delimited segment. Use for short or ambiguous
   *  words where a substring match would be wrong ("tax" inside "taxi"). */
  readonly exact: readonly string[];
  /** Matched anywhere in the slug. Only distinctive stems belong here, so that
   *  "zoning" catches "rezoning" and "downtown-rezoning-proposal". */
  readonly contains: readonly string[];
}

// Order matters: the FIRST bucket that matches wins, so the more specific
// buckets are listed before the general ones (water before environment,
// schools before facilities).
const BUCKETS: readonly Bucket[] = [
  {
    slug: "zoning-land-use",
    label: "Zoning & Land Use",
    exact: ["lot", "plat", "acre", "acres"],
    contains: ["zoning", "zone-change", "variance", "setback", "subdivision", "land-use", "site-plan", "special-permit", "easement", "parcel", "comprehensive-plan", "master-plan"],
  },
  {
    slug: "housing",
    label: "Housing",
    exact: ["housing", "rent", "eviction"],
    contains: ["affordable-housing", "tenant", "landlord", "homeless", "shelter", "rental", "accessory-dwelling", "40b"],
  },
  {
    slug: "water-sewer",
    label: "Water & Sewer",
    exact: ["water", "sewer", "drainage", "flooding", "flood"],
    contains: ["stormwater", "wastewater", "water-main", "sewer-line", "septic", "drinking-water", "culvert"],
  },
  {
    slug: "transportation",
    label: "Transportation & Roads",
    exact: ["road", "roads", "street", "streets", "traffic", "parking", "transit", "bus", "sidewalk", "sidewalks", "paving", "bridge"],
    contains: ["pedestrian", "bicycle", "bike-lane", "intersection", "crosswalk", "speed-limit", "road-repair", "street-light", "snow-removal", "complete-streets"],
  },
  {
    slug: "public-safety",
    label: "Public Safety",
    exact: ["police", "fire", "ems", "crime", "safety", "ambulance", "dispatch"],
    contains: ["public-safety", "emergency-management", "fire-department", "police-department", "first-responder", "911", "animal-control"],
  },
  {
    slug: "schools-education",
    label: "Schools & Education",
    exact: ["school", "schools", "students", "teachers", "curriculum"],
    contains: ["school-committee", "school-district", "school-budget", "education", "student", "teacher", "kindergarten", "special-education", "enrollment"],
  },
  {
    slug: "budget-taxes",
    label: "Budget & Taxes",
    exact: ["budget", "tax", "taxes", "levy", "audit", "revenue", "bond", "bonds", "borrowing", "finance", "grant", "grants"],
    contains: ["appropriation", "fiscal-year", "tax-rate", "property-tax", "capital-budget", "free-cash", "stabilization-fund", "override", "procurement", "warrant-article"],
  },
  {
    slug: "parks-recreation",
    label: "Parks & Recreation",
    exact: ["park", "parks", "recreation", "playground", "pool", "trail", "trails"],
    contains: ["athletic-field", "ball-field", "open-space", "community-center", "youth-program", "conservation-land"],
  },
  {
    slug: "environment",
    label: "Environment & Energy",
    exact: ["environment", "climate", "energy", "solar", "trees", "recycling", "trash", "landfill", "compost"],
    contains: ["sustainability", "conservation", "wetland", "solid-waste", "emissions", "renewable", "electric-vehicle", "tree-removal", "green-"],
  },
  {
    slug: "public-health",
    label: "Public Health",
    exact: ["health", "clinic", "vaccination", "vaccine"],
    contains: ["public-health", "mental-health", "substance-use", "opioid", "food-safety", "board-of-health", "inspection-of-food"],
  },
  {
    slug: "permits-licensing",
    label: "Permits & Licensing",
    exact: ["permit", "permits", "license", "licenses", "licensing", "inspection", "inspections"],
    contains: ["liquor-license", "building-permit", "code-enforcement", "occupancy", "sign-permit", "vendor-license"],
  },
  {
    slug: "economic-development",
    label: "Economic Development",
    exact: ["business", "businesses", "downtown", "retail", "tourism", "jobs"],
    contains: ["economic-development", "redevelopment", "workforce", "small-business", "vacant-storefront", "chamber-of-commerce", "tax-increment"],
  },
  {
    slug: "infrastructure-facilities",
    label: "Infrastructure & Facilities",
    exact: ["construction", "renovation", "facility", "facilities", "building", "buildings"],
    contains: ["capital-improvement", "municipal-building", "town-hall", "city-hall", "public-works", "roof-replacement", "hvac", "feasibility-study"],
  },
  {
    slug: "personnel-appointments",
    label: "Personnel & Appointments",
    exact: ["appointment", "appointments", "hiring", "personnel", "resignation", "salary", "salaries", "union"],
    contains: ["collective-bargaining", "job-description", "civil-service", "town-administrator", "city-manager", "superintendent-search", "staff-vacancy"],
  },
  {
    slug: "technology",
    label: "Technology & Broadband",
    exact: ["technology", "broadband", "internet", "software", "cybersecurity"],
    contains: ["information-technology", "fiber-optic", "digital-equity", "website-redesign", "data-privacy"],
  },
  {
    slug: "social-services",
    label: "Seniors & Social Services",
    exact: ["seniors", "elderly", "veterans", "disability", "accessibility"],
    contains: ["council-on-aging", "senior-center", "social-service", "food-pantry", "veterans-services", "ada-compliance"],
  },
  {
    slug: "arts-culture-history",
    label: "Arts, Culture & History",
    exact: ["arts", "culture", "museum", "festival", "historic", "historical", "library", "libraries"],
    contains: ["cultural-council", "historic-district", "historical-commission", "public-art", "monument", "memorial"],
  },
  {
    slug: "legal-litigation",
    label: "Legal & Litigation",
    exact: ["lawsuit", "litigation", "settlement", "legal", "attorney", "claim", "claims"],
    contains: ["executive-session", "legal-counsel", "court-ruling", "consent-decree", "eminent-domain"],
  },
  {
    slug: "governance-elections",
    label: "Governance & Elections",
    exact: ["election", "elections", "ballot", "charter", "bylaw", "bylaws", "ordinance", "ordinances", "policy", "policies"],
    contains: ["town-meeting", "redistricting", "voter", "polling-place", "rules-of-order", "committee-formation", "home-rule"],
  },
];

/** Catch-all so a topic is never dropped from browse just because it is unusual.
 *  Kept LAST in CANONICAL_TOPICS so it sorts to the end of a listing. */
export const OTHER_TOPIC: CanonicalTopic = { slug: "other", label: "Other" };

/** The complete, finite set of browse buckets. Nothing outside this list can
 *  ever appear on /topics, which is the whole point. */
export const CANONICAL_TOPICS: readonly CanonicalTopic[] = [
  ...BUCKETS.map(({ slug, label }) => ({ slug, label })),
  OTHER_TOPIC,
];

const BY_SLUG: ReadonlyMap<string, CanonicalTopic> = new Map(
  CANONICAL_TOPICS.map((t) => [t.slug, t])
);

/** Look up a bucket by its slug; undefined for an unknown slug (404 the page). */
export function canonicalTopicBySlug(slug: string): CanonicalTopic | undefined {
  return BY_SLUG.get(slug);
}

function matches(paddedSlug: string, bucket: Bucket): boolean {
  // Whole-segment match for short/ambiguous words: "-tax-" never matches "taxi".
  for (const w of bucket.exact) {
    if (paddedSlug.includes(`-${w}-`)) return true;
  }
  // Substring match for distinctive stems: "zoning" catches "rezoning".
  for (const c of bucket.contains) {
    if (paddedSlug.includes(c)) return true;
  }
  return false;
}

/**
 * Map any free-text topic onto exactly one canonical bucket. First match wins,
 * in BUCKETS order, so more specific buckets are declared before general ones.
 * Anything unmatched lands in "Other" rather than minting a new bucket.
 */
export function canonicalizeTopic(topic: string): CanonicalTopic {
  const slug = topicSlug(topic);
  if (slug === "") return OTHER_TOPIC;
  const padded = `-${slug}-`;
  for (const bucket of BUCKETS) {
    if (matches(padded, bucket)) return { slug: bucket.slug, label: bucket.label };
  }
  return OTHER_TOPIC;
}
