// Public, unauthenticated endpoint behind the "for cities" form on the home
// page. Two jobs, in this order:
//
//   1. STORE the enquiry. This is the record. Email can bounce, be filtered, or
//      be deleted by whoever reads the inbox; a row cannot.
//   2. EMAIL the team inbox as a notification about that row.
//
// The order matters. If the email fails after the row is written we still have
// the lead and can tell the sender honestly that we have it. If we emailed
// first and stored second, a storage failure would leave a lead that exists
// only in someone's inbox.
//
// Being public and unauthenticated, it is rate limited per IP and carries a
// honeypot. Neither is a serious defence against a determined attacker; both
// stop the commodity form spam that otherwise buries a low-volume inbox.

import { NextResponse } from "next/server";
import { z } from "zod";

import { getStore } from "@/lib/store";
import { getProviders } from "@/lib/providers";
import { getConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE = 4000;

const schema = z.object({
  name: z.string().trim().min(1, "Please give your name.").max(200),
  email: z.string().trim().email("That email address does not look right.").max(320),
  organization: z
    .string()
    .trim()
    .min(1, "Please tell us which city or town.")
    .max(200),
  role: z.string().trim().max(200).optional().default(""),
  message: z
    .string()
    .trim()
    .min(1, "Please tell us what you want recorded.")
    .max(MAX_MESSAGE),
  // The honeypot. A real person never sees this field, so any value at all
  // means a bot filled the form in.
  website: z.string().max(0).optional(),
});

// Per-IP fixed window. In-process on purpose: this app runs as a single
// container with numReplicas pinned to 1 (see scripts/railway-start.mjs), so a
// shared store would be complexity with no benefit. If it is ever scaled out,
// this becomes per-replica and needs replacing.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);

  // Opportunistic sweep so the map cannot grow without bound.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
    }
  }
  return false;
}

/** Trust only the leftmost x-forwarded-for entry, which is what the Railway
 *  edge sets. Falls back to a constant so a missing header cannot be used to
 *  dodge the limit by making every request look unique. */
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // The honeypot is the one failure we do NOT explain, so a bot author gets
    // no signal about why it was rejected. It also gets a 200, so the spammer
    // sees success and does not retry.
    if (parsed.error.issues.some((i) => i.path[0] === "website")) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Please check the form." },
      { status: 400 }
    );
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many messages from here. Please try again later." },
      { status: 429 }
    );
  }

  const { name, email, organization, role, message } = parsed.data;

  // 1. The record.
  let enquiryId: string;
  try {
    const enquiry = await getStore().createContactEnquiry({
      name,
      email,
      organization,
      role,
      message,
      source_ip: ip === "unknown" ? null : ip,
      user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
    });
    enquiryId = enquiry.id;
  } catch (err) {
    console.error("[contact] failed to store enquiry", err);
    return NextResponse.json(
      { error: "We could not save that. Please try again." },
      { status: 500 }
    );
  }

  // 2. The notification. A failure here is logged loudly but NOT reported as a
  // failure to the sender: their enquiry is safely stored, and telling them it
  // failed would invite a duplicate submission for a lead we already hold.
  try {
    await getProviders().email.sendContactEnquiry(
      getConfig().contactInboxEmail,
      { name, email, organization, role, message }
    );
  } catch (err) {
    console.error(
      `[contact] enquiry ${enquiryId} was STORED but the notification email failed`,
      err
    );
  }

  return NextResponse.json({ ok: true });
}
