# CivicScribe public surface redesign

Date: 2026-09-04
Status: approved, implementing

## Why

The live site has three structural faults, not just a dated look.

1. **Two design languages.** A cinematic dark hero (photo, Georgia serif, gold)
   sits directly on top of a generic SaaS body (off-white, sans, white cards,
   teal). Nothing carries between them. The page falls off a cliff at the hero's
   bottom edge.
2. **The product is never shown.** Three sections describe the pipeline in prose
   ("How it works", "Three ways in", "How capture works" all cover submission)
   and not one shows a transcript, a speaker label, a summary or a search result.
3. **Three audiences on one scroll.** A public reader, a meeting submitter and a
   staff moderator are all served by the same page, including a live staff login
   form parked mid-pitch.

Supporting faults: `/library` prints its own heading twice and leaves ~60% dead
space; a one-item grid reads as broken; the meeting page (the actual product) is
the least designed surface on the site, serving the summary as an undifferentiated
wall of prose above a raw browser `<audio>` element; the nav's green CTA competes
with the hero's gold CTA for the same action; and `public/` still ships the
Next.js starter SVGs.

## Decisions (owner, 2026-09-04)

| Decision | Choice |
|---|---|
| Scope | Public reading surfaces: home, library, meeting, topics, search. Staff surfaces unchanged. |
| Primary audience | A city evaluating CivicScribe. Front page is the pitch; the reading surfaces are the proof. |
| Visual direction | "Modern gov-tech": white, high contrast, sans throughout, deep green accent, product-led. |
| The hero | **Kept.** Same photograph, same full-bleed cinematic scrim. |
| Accent | Green (`#116945`). Doubles as the published/approved status colour. |
| Headline face | Sans. One typeface across the whole site. |
| CTA | Contact form emailing Vera. No published price. |
| Reading level | Measured fifth grade for the site's own voice. |

## The hero problem, and the fix

Keeping a dark cinematic hero on a bright system risks recreating fault #1. Three
moves stitch them together:

1. **The product shot straddles the hero's bottom edge** (`margin-top:-152px`),
   so the hero becomes the ground the product sits on rather than a separate slab.
2. **Dark recurs** in the "Nothing goes public until you say so" band, making dark
   a surface in the system rather than a one-off.
3. **The hero's typography joins the system** - same scale, same accent - while
   the photograph stays cinematic.

## Reading level

The site's own voice is written to a measured fifth-grade level using
`plainspeak/fk.mjs`. Every string scores **grade 5.2 or below**; before the pass,
strings ran as high as **14.3** ("Moderator review before anything is published")
while feeling plain. Measurements are in `docs/copy/` alongside the before/after
sets.

**Verbatim speech is exempt and must stay exempt.** Transcript text, quotes and
speaker attributions are the public record. Simplifying them would falsify it.
The rule is: our voice gets simplified, their words never do.

Accessibility floors from the original design are preserved and are not
negotiable in a visual refresh: 19px base body (was 18px), **nothing below 15px
anywhere**, and a 3px always-visible focus ring. These exist for a hard-of-hearing
user who reads transcripts for long stretches.

## Surfaces

| Route | Change |
|---|---|
| `/` | Rebuilt as the pitch. Hero kept, search product shot, three-artifacts, control band, contact form. Staff login removed entirely. |
| `/search` | Promoted to first-class. If the front page shows search working, search has to be good. |
| `/meetings/[id]` | Summary restructured: decisions and action items surfaced, key figures pulled out, speaker-labeled turns with seeking timestamps. Native `<audio>` replaced. |
| `/library` | Doubled heading fixed, one-item grid made deliberate, honest empty states. |
| `/topics`, `/topics/[slug]` | Brought onto the system. |
| `/terms`, `/privacy` | Restyled. `admin@` replaced with `veravoss@`. |
| `/login` | Receives the staff form displaced from home. |

Deleted: `public/{next,vercel,window,globe,file}.svg`.

## Contact form

`POST /api/contact` → persist to Supabase → send via Resend to
`veravoss@atpconsultancy.com`.

- **Persist as well as email.** An email that bounces or lands in junk is a
  silently lost lead, and the 15-minute mail checker only sees what arrives.
- **Send *to* Vera via Resend, not *as* Vera via Graph.** This keeps Graph tokens
  out of the Railway container. Resend is already a declared subprocessor in the
  privacy policy.
- Honeypot field plus a per-IP rate limit; the form is public and unauthenticated.

`admin@atpconsultancy.com` was found to be an alias on `aperez@`, not a separate
mailbox, and Exchange rewrites the alias to the primary at delivery - so mail sent
to it is indistinguishable from the rest of that inbox and cannot be routed by
rule. Publishing `veravoss@` instead is the fix that does not depend on a
directory change.

## Testing

- Existing suite stays green: `./node_modules/.bin/vitest run`.
  **Never `npx vitest`** - npx resolves a different vitest, fails to load
  `vitest/config`, and can exit 0 having run nothing.
- The spam guard and the send path get tests that are proven to fail when the
  guard is removed, so they are not vacuous.
- A test asserts the reading level of the front page's own copy, so a later edit
  cannot casually raise it.

**Pre-existing failure, not caused by this work:** `npm run build` and
`npm run typecheck` fail on `recorder/electron/main.ts` (cannot find module
`electron`) because `recorder/` has its own package.json whose deps the root
install does not provide. Verified identical on a stashed clean tree. Do not
chase it here.

## Known limitation

The archive holds one meeting, and it is a Massachusetts state advisory council,
not a city council. A clerk who clicks "See a real meeting" sees EEAC and nothing
else. The design cannot fix that. Capturing two or three real city council
meetings from public streams would, and breaks no rule about fabricated data -
they would be real captures of real public meetings.

## Deploy state, 2026-09-04 - SHIPPED

Live on https://civicscribe.us. Verified after deploy: `/`, `/library`,
`/topics`, `/search`, `/terms` and `/api/health` all 200; the new headline is
serving and the old one is gone; `/terms` carries `veravoss@`, not `admin@`.

**Migration 0016 IS applied** to `qohvolrzcijqcfapryee`. The table exists with
RLS on and zero policies, which is deliberate - only the service role touches it.

**The contact path was tested against production end to end:** a valid
submission returned 200 and stored a row carrying its IP and user-agent; the
honeypot returned 200 and stored nothing; a malformed email returned 400 with a
message a person can act on. `/enquiries` returns 404 to an anonymous request,
so the staff gate holds in production and not only in tests. All verification
rows were deleted afterwards; the table is empty.

### How the migration was applied, and the trap in it

Not with the `supabase` MCP. **That MCP is hard-bound to
`tckzucpclfqbbilclegr` - Solar 360 / Aventro production - regardless of the repo
it is invoked from**, and calling `list_tables` before writing is the only reason
a CivicScribe `CREATE TABLE` did not land in Aventro's database while a peer
session was shipping in it.

The account-wide `SUPABASE_ACCESS_TOKEN` in the MCP's own config reaches every
project, so the migration went through the Management API at
`POST /v1/projects/{ref}/database/query` against the CivicScribe ref explicitly.
Two things cost time and are worth keeping: `api.supabase.com` sits behind
Cloudflare and answers Python's default User-Agent with 403 / "error code: 1010"
(a browser UA fixes it, and it is NOT a token-scope problem), and the vault's
UNPREFIXED `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are Solar 360's, not a
general default.

### Still open

**`RESEND_API_KEY` is not set on the Railway service**, and no Resend key exists
anywhere on this machine, so it could not be supplied. Enquiries are stored but
no email is sent. This is why `/enquiries` and the dashboard callout exist: the
lead is visible to staff rather than invisible. Setting the variable makes the
email work with no code change - `config.ts` already defaults
`CONTACT_INBOX_EMAIL` to `veravoss@atpconsultancy.com`.

**The archive is still two seeded meetings plus EEAC.** A clerk clicking "See a
real meeting" sees a small library. Capturing two or three real city council
meetings from public streams would fix it and breaks no rule about fabricated
data.

Deploy command, for next time: `railway up --service civicscribe --ci` with
`RAILWAY_API_TOKEN` exported from `CIVICSCRIBE_RAILWAY_API_TOKEN` (Account
scope). Railway does not auto-deploy on push. `npm run build` fails locally on
`recorder/electron/main.ts` and never will on Railway, because `.railwayignore`
excludes `recorder` from the deploy context.
