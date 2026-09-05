# Repository state audit

Written at the close of **T0 Cleanup**, 2 Sep 2026, branch `rebuild`.

This file records what T0 found, because T0 turned out to be mostly an audit
rather than a deletion pass: the great majority of its checklist had already
been completed as a side effect of T2, T7b and T8a. It is a snapshot, not a
spec — where it disagrees with the code, the code is right.

## Why the ordered task list understates progress

`CLAUDE.md` marks **T0–T5 as unchecked**. That is stale bookkeeping, not an
accurate picture. The evidence:

- `supabase/migrations/` holds **29 applied migrations**, `01_enable_rls.sql`
  through `29_t_ui2_phone_gate.sql`. T1 is done, and so is everything through
  T8a and the mobile-first signup work.
- `proxy.ts` exists, `middleware.ts` does not, and `next build` reports
  `ƒ Proxy (Middleware)`. That is T2.
- The live schema carries `applications`, `threads`, `messages`, `children`,
  `demo_requests`, `shortlists`, `payments`, `subscriptions` and
  `usage_counters` with real rows in them. That is T4, T5 and T6.

Only **T8b** is genuinely outstanding: region migration to Mumbai
`ap-south-1`, Turnstile, nonce-based CSP, WhatsApp delivery, and the legacy
NOT NULL columns on `jobs`/`messages`.

Treat the checkboxes as unreliable and the migration list as the real ledger.

## What T0 actually had left to do

Everything below was already true when T0 started:

| Checklist item | State on arrival |
|---|---|
| Mongo layer removed | Done. No `mongoose` in `package.json`, no `MONGODB_URI`, no `lib/mongodb.ts`. |
| `middleware.ts` → `proxy.ts` | Done in T2. |
| `/parent/browse`, `/parent/post-job` | Already deleted. |
| `/tutor/settings`, `/tutor/jobs` | Already deleted. |
| `/tutor/[username]`, `/tutor-profile` | Already deleted; only `/tutor/[slug]` remains. |
| `/faqs`, `/chat/[id]` | Already deleted; `/faq` and `/chat/[jobId]` are canonical. |
| `lib/lib/`, `lib.rar`, `New folder/` | Already deleted. |
| `api/tutor/login`, `api/auth/parent-login` | Already deleted. |
| `app/browse/[id]` moved to `app/browse/tutors/[id]` | Already done. |
| `.env.example` | Present and near-complete. |

Three things were left, and T0 did them:

1. **Deleted `app/parent/signup`** — the last live entry on the delete list. It
   had become a six-line redirect to `/register` and had zero inbound
   references anywhere in the codebase.
2. **Documented `PSQL_PATH`** in `.env.example`. It was the only variable the
   code reads (`scripts/verify-schema.ts`) that was not listed.
3. **Refreshed this snapshot and `supabase/schema-before.md`.**

### Why `/tutor/register` was kept and `/parent/signup` deleted

Both were reduced to redirect stubs by earlier tasks, so the distinction is not
obvious. It comes from `CLAUDE.md` itself: the keep list explicitly preserves
`/parent/login` and `/tutor/login` **as server redirects**, while the delete
list names `/parent/signup` and does *not* name `/tutor/register`. Login paths
keep redirects; the one signup path that was named goes. `/tutor/register` is
additionally still linked from `/faq`.

## Documentation that disagrees with the database

**The activity table is `user_activity_log`, not `activity_log`.** `CLAUDE.md`
has a section headed "Member activity timeline — superseded" which states that
a `user_activity_log` table was an "earlier draft" and that the canonical name
is `activity_log`. The opposite is true in the running system: the live schema
has `user_activity_log` (130 rows) and has no `activity_log` at all, and
`lib/activityLog.ts:93` inserts into `user_activity_log`. The helper filename
(`lib/activityLog.ts`) matches the doc; the table name does not.

Under precedence rule 10 the built system wins. **Corrected in CLAUDE.md on
2 Sep 2026**: `user_activity_log` is named as canonical in both timeline
sections, `activity_log` is recorded as a name that never existed, and
`lib/activityLog.ts` keeps its filename — the helper and the table do not match,
and that is deliberate rather than a mistake to be tidied later.

## The referral links credit nobody

`components/TutorReferralBox.tsx` and `lib/tutorSharing.ts` build links of the
form `/tutor/register?ref=<tutorUniqueId>`. The whole mechanism is inert:

- `/tutor/register` is a bare `redirect('/register')`, which **drops the query
  string**.
- `/register` never reads a `ref` parameter.
- No migration defines `referred_by`, `ref_code` or any equivalent column, and
  nothing in the codebase credits a referrer.
- `tutorUniqueId` has no backing column anywhere in the schema.
- Neither `TutorReferralBox` nor `generateReferralLink` is rendered or called
  from anywhere — both are unreferenced pre-rebuild code.

So no referral link has ever been produced by the running application. This
corrects an earlier note in this task that described such links as already
circulating; the component that would mint them is not mounted.

**Retired on 2 Sep 2026** by owner decision. `components/TutorReferralBox.tsx`
and `generateReferralLink()` are deleted, and a referral programme is recorded
as v2 backlog in CLAUDE.md. `/tutor/register` stays as a redirect because
`/faq` links to it. `generateWhatsAppShareLink()` in `lib/tutorSharing.ts` was
left in place: it is also uncalled, but it is a share link rather than referral
machinery and was not part of the decision.

## Environment variables

Every `process.env` read in `app/`, `components/`, `lib/`, `scripts/`,
`proxy.ts`, `instrumentation.ts` and `next.config.ts` is now listed in
`.env.example`, except the three the platform sets itself: `NODE_ENV`,
`NEXT_RUNTIME` and `VERCEL_ENV` (the last is documented there anyway, because
which Vercel environment it holds decides whether the dev switches are live).

## Gates at the close of T0

`npx tsc --noEmit`, `npm run build` and `npm run check:contrast` (28 pairs at
WCAG AA) all pass.

One trap worth recording: deleting a route leaves a stale validator behind at
`.next/dev/types/validator.ts`, written by a previous `next dev` and **not**
regenerated by `next build`. It fails the type check with `TS2307: Cannot find
module '../../../app/<deleted route>/page.js'` long after the route is gone.
`rm -rf .next/dev` clears it.

## T-Search (2 Sep 2026) — what was built and the two traps in it

Migration 30 adds `pg_trgm`, a `taxonomy_aliases` table, `search_suggest()` and
`popular_subjects()`. `/api/search/suggest` is the only caller, and
`components/search/Typeahead.tsx` is the only search input on the platform —
`/browse/tutors`, `/browse/tuitions` and `/admin/users` all use it, and no
search button remains anywhere.

**The correlated lateral cost 12x.** The taxonomy branch was first written as
`join lateral (... union all ...) on true` over `taxonomy_master`, which reads
naturally and re-scans each of its four CTEs once per master row — roughly
3,600 CTE scans per keystroke. Every individual branch measured under a
millisecond while the whole function measured 130ms, which is the signature of
this mistake: profiling the parts tells you nothing. Rewritten as four plain
joins feeding a `group by`, it is **10ms**. Two earlier theories were wrong and
worth not repeating — scoring the 896-row master table rather than the four
name tables, and the forty repeated `(select t from q)` scalar subqueries.
Neither was material.

**The rate limit and the search run concurrently.** Both are round trips, and a
typeahead pays that latency on every debounce. Overlapping them is safe *here*
because `rateLimit()` fails open and the query reads nothing private: an
over-budget caller still gets the 429, having cost us one wasted query. That
reasoning does not transfer to a route that writes.

**`search_suggest()` is granted to `service_role` alone.** Granting EXECUTE to
anon would put a trigram scan one PostgREST call away from anyone holding the
publishable key, which is in every browser bundle, and the rate limit would be
guarding a door with no wall attached.

**Logging is collapsed, not per keystroke.** The typeahead re-renders the
results page on every debounced change, so the naive call site wrote one
`search_performed` row per pause. `logSearchPerformed()` skips an identical
filter set seen in the last 60s. This works cleanly only because the free-text
query has never been part of the recorded payload: refining the text changes
nothing to compare, so a burst collapses to one row, while changing an actual
filter is recorded as the separate search it is.

**Places come from live data, not `lib/locations.ts`.** Only cities and areas
that actually have listed tutors or open jobs are suggested. A suggestion that
leads to an empty page is worse than no suggestion.

Tested at 360 / 390 / 768 / 1024 / 1280: 40 checks covering no horizontal
scroll, 44px targets, no Search button, panel grouping, typo tolerance
("fizics" → Physics), keyboard navigation, Escape, overlay without layout
shift, and the URL updating with no Enter pressed.

## One Supabase project, and the guard that pointed the wrong way (2 Sep 2026)

**There is one Supabase project — `flhiraqouizzwnasuraj` — and it serves both
preview and production.** `PRODUCTION_CHECKLIST.md` says as much ("a preview
points at the same Supabase project"), and T8b's "seed-data cleanup" task is
the other half of the evidence: a dry run of `seed:cleanup` lists **15 live
`seed+*@tutormint.dev` accounts** sitting on the database tutormint.org reads
from.

**The guard on the two write scripts was inverted.** `seed-dev.ts` and
`seed-cleanup.ts` each hardcoded that ref as `DEV_PROJECT_REF` and refused to
run *unless the target matched it*. So the check that reads like a safety rail
was in fact a requirement to point at production, and `npm run seed:dev` — a
script whose first act is to delete accounts — was armed against live data
while appearing to protect against exactly that. The name was the whole bug:
nobody reading `if (ref !== DEV_PROJECT_REF) die()` stops to check which
project the constant holds.

Fixed in `scripts/target.ts`, which both scripts now share:

- `PRODUCTION_PROJECT_REF` is named for what it is.
- Every write script announces its target before acting — the API ref, the DB
  ref, and whether that is production in words.
- Production is refused outright unless `ALLOW_SEED_ON_PRODUCTION=1` is set for
  that one invocation **and** the operator types the project ref. Two steps
  because the env var is the decision and the typed ref is the proof somebody
  is still reading; either alone is muscle memory.
- The override in a non-interactive shell is refused rather than prompted. A
  prompt that cannot be answered either hangs a CI job or gets satisfied by
  whatever is on stdin.
- **Dry runs are allowed through.** `seed:cleanup` without `--apply` writes
  nothing, and refusing it would remove the one way of checking what the real
  run would do. A guard that makes the safe path harder than the dangerous one
  gets worked around.

**Audit of everything under `scripts/`:**

| Script | Touches the database | Target named |
|---|---|---|
| `seed-dev.ts` | **writes** — creates and deletes the seed cast | yes, and gated |
| `seed-cleanup.ts` | **writes** with `--apply`; dry run otherwise | yes, and gated |
| `rls-audit.ts` | read-only (writes are checked structurally against `pg_policies`, never probed) | yes |
| `verify-schema.ts` | read-only | yes |
| `backup.sh` | read-only (`pg_dump`) | yes |
| `contrast-check.ts` | no database access | n/a |
| `test-delivery.ts` | no database access | n/a |

## Backup taken 2 Sep 2026

`supabase/backups/full-20260902-114216.sql` — 13 MB, `--full` (every schema
including `auth.users`), 49 auth users, 186 `CREATE TABLE`/`COPY` statements.

That directory is gitignored and must stay so: a full dump carries CNIC
numbers, phone numbers and home addresses. It is on this machine only, so it
survives a bad migration and does **not** survive losing this machine — the
weekly `--full` job in `README.md` is what covers that.

Taken because migration 30 (T-Search) had already been applied to this project
without one. That migration was additive — `create extension`, `create table`,
`create index`, `create function`, plus grants; its only `drop` is `drop policy
if exists` on the table it creates three lines earlier — so nothing was at
risk, but the rule now written into CLAUDE.md was not yet in force when it ran.

## Suspension is one fact again (2 Sep 2026)

Two columns could express suspension and only one had a single writer:
`profiles.is_suspended` (written by `lib/moderation.ts`) and
`tutor_profiles.verification_status` (**also** written directly by the tutor
video queue). A tutor suspended through that queue was delisted but not
suspended, so `getEntitlements()` saw a normal member and the listing check
told them to "complete your profile" — at 100% completion. Exactly the failure
the check-ordering rule exists to prevent, arriving through the data instead of
through the code.

Fixed in three places, because any one alone would have left a hole:

- `/api/admin/tutors/moderate` now delegates suspend and unsuspend to
  `suspendMember()` / `unsuspendMember()`. `lib/moderation.ts` is the only
  writer of either column; the route still owns the video strike, which is its
  own business.
- `getEntitlements()` treats **either** column as suspended, so a row written
  before this cannot slip through a path that reads only one of them.
- Migration 31 reconciles rows already out of step. **One row was fixed**
  (`seed+suspended-omar@tutormint.dev`, delisted but not suspended). Where the
  two disagree the listing column wins and the profile flag is raised, because
  `verification_status='suspended'` is only ever set by a moderator making that
  decision — reinstating someone a moderator stopped, as a side effect of a
  migration, is the more expensive mistake. The migration asserts consistency
  at the end and fails rather than leaving a silent mismatch.

## The 199 funnel surfaces (2 Sep 2026)

All seven built. `lib/funnel.ts` holds the data and returns **no prices** —
that separation is the rule, not a coincidence.

**The teaser leads for a tutor with no plan.** "Who looked at you" now renders
above the notices and the plan card. It is the one thing a tutor actually wants
from a dashboard, and burying it under a completion meter is how a dashboard
gets closed. A paying tutor sees it in its original position; the funnel block
is not rendered for them at all, because showing somebody a pitch for what they
have already bought is noise.

**"Your position" reports the tutor's most competitive subject, not their
first.** The first taxonomy row is an arbitrary choice the database made, and it
is often something niche they are the only person teaching — which produces
"#1 of 1", a number that tells them nothing and reads as mockery. The widget
ranks each of their subjects (city first, then nationwide) and reports the one
with the largest real pool. It uses `rank_tutors()`, the same ranking the browse
page uses, so the number is the position a parent would actually see.

**Apply from the week strip routes through the upgrade sheet.** A disabled
button reading "Verified only" would say the same thing while giving the tutor
nothing to press, and a price printed on the dashboard would break the rule.
Pressing Apply *is* reaching for it.

**Hires are counted from `jobs.hired_at`, not from applications.**
`applications` has no `updated_at`, so the moment of hire is only recorded on
the job; counting application rows would have meant counting every hire ever
made and calling it this month's. A zero is hidden rather than dressed up.

**Expiry reminders are losses of visibility, not invoices.** "Your subscription
is due" is a billing email and reads as one. The facts are unchanged; the
subject line is now "You drop down the search results in N days".

**Checkout puts JazzCash and Easypaisa first.** Bank transfer was listed first
and needs an IBAN and a banking app — the least-used option was the default on
a two-tap checkout.

### Evidence, and the two data limits behind it

No price string renders on `/`, `/browse/tutors`, `/browse/tuitions`,
`/register`, `/login`, `/faq`, or the free tutor dashboard at any of 360 / 390 /
768 / 1024 / 1280. The check counts **plan** prices only: a tutor's hourly fee
and a parent's budget are rupee amounts too, and they are the marketplace
working rather than a paywall hint. The first version of that check flagged
"Rs. 12,000 / month" on a job card and had to be narrowed.

No single seed tutor could exercise every surface, and the reason is worth
knowing: `seed+free-nadia` has a ranking pool of 3 but **zero** matching open
jobs of any age, and `seed+free-hina` has 5 matching jobs but is the only listed
tutor for both her subjects, so her position widget correctly hides. Each
surface was therefore captured on the account that can show it. Both tutors were
temporarily moved to `status='expired'` to make them free, and both were
restored to `premium active` afterwards.

## Public CNIC scans secured (4 Sep 2026)

The tutor settings page had uploaded both sides of a CNIC through the same
helper as the avatar, into the **public** `tutor-media` bucket. Two members'
national identity cards were fetchable by URL with no credential at all
(confirmed with an anonymous curl: 200, image/png). The writer was removed on
4 Sep; `scripts/secure-public-cnic.ts` dealt with the four objects it left.

**Copied first, then deleted.** One member (Alishba, a real account) had her
CNIC images *nowhere* except the public bucket, so a delete-first would have
destroyed her only copies. The copy phase downloaded her two objects and stored
them exactly as `/api/documents/upload` would — original + watermarked preview
into private `identity-docs`, a `user_documents` row per side, and
`profiles.cnic_image_path` set to the front's original path. The copies were
verified through `/api/documents/<id>/preview`: an admin (verifier) got 200
image/jpeg on both; a signed-in non-owner, non-admin tutor got 404 on both. The
other member (Ali Raza, seed) already had a private `user_documents` row, so
nothing was copied for him.

**Deleted at 2026-09-04T11:14:57.417Z (UTC):**

```
public/tutor-media/a412120a-5cb0-4ab4-9749-4f67ff67df76-1787918126552.png   Alishba front
public/tutor-media/a412120a-5cb0-4ab4-9749-4f67ff67df76-1787918138684.png   Alishba back
public/tutor-media/535aada4-a04d-49c6-8a3d-b48c89c8f491-1788468632293.jpeg  Ali Raza front
public/tutor-media/535aada4-a04d-49c6-8a3d-b48c89c8f491-1788468638750.jpeg  Ali Raza back
```

`tutor_profiles.cnic_front_url` / `cnic_back_url` were cleared to NULL on both
rows in the same run. After deletion each URL returns `{"statusCode":"404",
"error":"not_found","code":"NoSuchKey"}` — Supabase wraps a storage 404 in an
HTTP 400 at the public endpoint, so the HTTP status reads 400 while the body is
an authoritative object-not-found. A brief window of 200s immediately after the
delete was Cloudflare edge cache of the exact original URL; a cache-busting
query returned `CF-Cache-Status: BYPASS` and the 404 body throughout, and the
bare URLs evicted within a minute.

Alishba's two objects were byte-identical (same sha256) — she uploaded one image
for both sides. Both labels were preserved as they were.

## Fabricated credentials cleared (migration 46, 4 Sep 2026)

The tutor settings page initialised its client state with sample content — an
"MS Mathematics — LUMS, Lahore (2021)" degree and a "Cambridge Certified
Educator" certificate — and the loader only overwrote a list when the row
already had one, so a tutor with none kept the sample and the next Save wrote it
as their own. Migration 46 removed those exact strings: `UPDATE 1` (Alishba's
LUMS degree) and `UPDATE 3` (the Cambridge certificate on Alishba plus two seed
tutors — one more than first counted; all three carried the identical
empty-`fileUrl` sample cert). Scoped by exact value so a genuinely typed
credential cannot match; idempotent.

Completion recomputed afterwards (`scripts/recompute-completion.ts`, using the
same pure checklist the app uses): Alishba **0 → 33** — the stored 0 was stale
and 33 is the truth; the clearing did not lower it, because `certifications` is
not a checklist item and her fake degree never counted (the degree item needs an
uploaded certificate document she never had). The two seed tutors stayed at 100,
confirming the fake cert never propped up their legitimate completion.

## The selfie became a private document (migration 45, 4 Sep 2026)

The verification selfie uploaded through the public `tutor-media` bucket — a
face photo held "for verification only" on a public URL. Zero rows carried a
`selfie_url`, so the writer was the whole defect. `user_documents.kind` was
widened to include `'selfie'`, and the tutor settings page now uploads it
through `/api/documents/upload` (private `identity-docs`, EXIF stripped, served
only to owner and admin through the authorising preview route). `selfie_url`
stays unread and unwritten, like the CNIC URL columns.

### Every upload writer and its bucket (audit, 4 Sep 2026)

| Writer | Bucket | Visibility | Content | Identity |
|---|---|---|---|---|
| `parent/dashboard/settings` avatar | `avatars` | public | avatar | no |
| `tutor/complete-profile` avatar | `avatars` | public | avatar | no |
| `tutor/dashboard/settings` avatar + cover | `tutor-media` | public | avatar, cover | no |
| `tutor/dashboard/settings` selfie | `identity-docs` (via `/api/documents/upload`) | **private** | selfie | **yes** |
| `api/documents/upload` → `lib/documents` | `identity-docs` | **private** | CNIC, degree, selfie | **yes** |
| `api/admin/ads` creative | `ads` | public | ad banner | no |
| `api/payments/manual` proof | `payment-proofs` | **private** | payment screenshot | no (financial) |
| `scripts/seed-dev` | `avatars` + `identity-docs` | mixed | avatars public, CNIC/degree private | mixed |

Every identity-related upload — CNIC, selfie, degree certificate — targets the
private `identity-docs` bucket and is served only through
`/api/documents/[id]/preview`. Degree certificates are readable by any signed-in
user through that route so a parent can see a tutor's qualifications, but the
bucket itself is private and anonymous requests are refused.

## Mobile polish, both roles (5 Sep 2026)

A UI pass over the dashboards, cards, packages and empty states. No migration;
no change to matching logic, entitlements or the seed cast.

- **Cross-city notification fix.** `notifyMatchingTutors` (`lib/jobs.ts`) now
  requires BOTH the job's mode and the tutor's own `teaching_mode` to allow
  online before notifying a cross-city tutor (was job-mode only). In-app
  notifications carry no per-kind preference on the platform, so this behaves
  like every other `notify()`.
- **Identity off the dashboards.** New `components/identity/IdentityStatusLine.tsx`
  (Verified / Pending review / Not submitted → Settings). The full `IdentityCard`
  stays only in `/tutor/dashboard/settings` and `/parent/verify`. A verified
  account never shows an upload prompt.
- **`lib/upsell.ts`** (`nextUpsell`, `planRank`) — the single "next higher plan
  or null" helper. Wired into `lib/ads.ts` `houseUpsellAd`, `components/ads/AdSlot.tsx`,
  `app/api/ads/inline/route.ts` (renders nothing at the top of the ladder), and a
  guard in `app/api/gate/route.ts`. Supersedes `lib/upgradePath.ts` `nextPlan`.
- **Expiry card** — `lapsedPlanRow` guard is now `if (ent.plan || ent.planPaused)`,
  so a live active OR paused plan suppresses the "plan ended" card.
- **Packages** — `PackagesTable` + `BuyButton`: Current plan / Upgrade to X /
  nothing below / "Verify to unlock" only when unverified. New `verified` prop.
- **`components/CardActions.tsx`** — one no-wrap row of icon+label buttons with a
  "More" overflow menu; used by `TutorCard` and `JobCard`.
- **`lib/display.ts`** `teachingMode()` "both" → "In person or online".
- **`TaxonomySelector`** `allowSelectAll` prop (off for post-a-tuition).
- **`components/EmptyState.tsx`** — one icon/sentence/action, wired into the weak
  and missing list empties across both roles.

## Tutor CV builder + settings/identity/shortlist fixes (5 Sep 2026)

A conversion feature plus three Minimal-UI fixes. No migration (shortlists and
the profile tables already exist).

- **Tutor CV builder** — `/tutor/dashboard/cv`. One pure data mapper
  (`lib/cv/model.ts` `toCvModel`) feeds both the HTML preview
  (`components/cv/CvPreview.tsx`) and the PDF (`lib/cv/pdf.tsx`, @react-pdf/renderer,
  Node runtime); `lib/cv/build.ts` reads the tutor's own profile into a CvRaw.
  Preview is free to every tutor; the PDF download is gated at Verified
  (`lib/cv/access.ts` `canDownloadCv`; `/api/tutor/cv/pdf` returns the gate for a
  free tutor, `application/pdf` for Verified+; logs `cv_downloaded`). New gate
  reason `cv_download` (verified) in `lib/gate.ts` + `/api/gate`. Font embedded
  as base64 (`lib/cv/font.ts`, Geist OFL); QR + avatar data URIs in
  `lib/cv/assets.ts`. Two templates (Classic/Minimal). Photo validated to avatar
  buckets — identity docs can never reach a CV. Dashboard card
  `components/tutor/CvCard.tsx` + a Settings link. Tests: `scripts/test-cv.ts`
  (`npm run test:cv`, 8 assertions — mapper omissions/contact toggle/identity-doc
  rejection, and the access gate). Deps added: `@react-pdf/renderer`, `qrcode`.
- **Settings add-rows** — subjects and availability rows rewrapped (input full
  width, radios own line, right-aligned `tm-red` button); no more overlap at the
  sm breakpoint.
- **Identity cards** — `FileUpload` `allowRemove` (false for CNIC front/back +
  selfie); Replace is the only action; `remove-image` client path + server
  branch deleted; filled row wraps (label no longer clipped); labels are now
  "Front CNIC" / "Back CNIC" / "Selfie".
- **Shortlist** — parent dashboard "Shortlisted tutors" section
  (`components/parent/ShortlistSection.tsx`) with `TutorCard` (new `hideShortlist`
  prop) + "Remove from shortlist" (confirm + toast) + `EmptyState`.
  `tutorCardsByIds` in `lib/browseTutors.ts`. No new table.

## Tutor dashboard cleanup (5 Sep 2026)

`app/tutor/dashboard/page.tsx`. No migration; seed cast untouched.

- **On-demand share card.** The always-present "You're verified" card (which
  rendered a satori image on every dashboard load) is replaced by
  `components/tutor/ShareVerifiedBadge.tsx` — a "Share your verified badge" text
  link in the header card (`IdentityBlock`'s new `extra` slot), listed tutors
  only, opening a dialog that renders the card + its three share buttons on
  click. Nothing renders before the click. `VerifiedShareCard.tsx` deleted;
  `/api/tutor/social/verified` route kept.
- **Order** (both widths): header → teaser → Needs you → identity line → CV →
  Activity → Your things. Teaser is first with nothing above it (reverses the
  "Needs you first" band order per owner instruction); free-only position +
  matching-jobs cards stay grouped under the teaser. Needs you now sits directly
  above the identity line — the empty gap between them is gone.
- **Badge/identity contradiction = seed-data gap, not a gate bug.** Badges are
  gated on `tutor_profiles.verification_status` (`tutorListed`/`ent.listed`); the
  identity line was reading `profiles.cnic_verified_at`/`verification_state`. For
  every listed verified seed tutor those disagree (verified + 100% but CNIC
  columns unset, despite uploaded CNIC docs). Display-only fix: a tutor's
  identity line reads "Verified" when `verification_status === 'verified'`
  (the admin decision IS the tutor's identity approval), mirroring the parent
  dashboard's override. Inconsistent seed rows reported to the owner in
  CLAUDE.md; the cast is not touched (`reset-seed-cast.ts` sets tutor CNIC
  columns for no one, so the gap persists across resets).

## Messaging part 2 + CV/seed fixes (5 Sep 2026)

Migration 53 (additive; backup `public-20260905-135040.sql` taken first, applied
via psql). RLS audit 168/168.

- **Schema**: `messages` + `reply_to`, `read_at`, `deleted_for uuid[]`,
  `attachment_{path,w,h,bytes}`. New tables `message_reports` (admin-read,
  message snapshot) and `tutor_quick_replies` (owner-scoped). New private bucket
  `message-media` (owner+admin storage read).
- **Realtime**: broadcast channel `thread:<id>` (`useThreadChannel`) carries
  signals only (msg/seen/typing), no content. New-message delivery, seen ticks
  (`read_at`) and the typing indicator ride it. Bodies still come only through
  the masked server render.
- **Per-message menu** (long-press / right-click): Copy · Reply (quotes, stores
  `reply_to`) · Report (reason picker → `message_reports` + a `reports` row with
  target_type='message'; admin sees only that message) · Delete for me
  (`deleted_for`, per-user, no delete-for-everyone).
- **Photo attachments** gated by `canViewContact` (`mayAttachPhoto`), JPG/PNG
  ≤5 MB, sharp-reencoded (EXIF stripped), private bucket, served participant-only
  via `/api/messages/media/[id]`. Disabled paperclip → `tutor_contact`/
  `parent_contact` upsell.
- **Tutor quick replies**: chips above the composer (insert, never send),
  edited in Settings (`QuickRepliesEditor`, max 6), route
  `/api/tutor/quick-replies`.
- **List**: server-formatted stamp (`messageListTime`), "Photo" preview.
- **Tests**: `test:messaging` (8), `test:seedcast` (4); `test:cv` now 12.
- **CV fixes**: monitor icon for teaching mode; Phone/WhatsApp merge via shared
  `cvContactRows`; singular level labels via `levelLabel` (shared with the public
  profile).
- **reset-seed-cast**: sets tutor CNIC-approval columns for verified seed tutors,
  clears stale `verification_state` on unverified-zain (`expectedIdentity`).
  Not run against production.

## Social templates v2 + CV/notification carry-overs (5 Sep 2026)

Migration 54 (notifications → supabase_realtime publication; backup taken).

- **Social v2**: 4 templates (spotlight/bold/success/announcement) × 3 formats,
  all 12 render zero-error. One text source `lib/social/copy.ts` (pure). Fixed
  brand band (`BrandBand`): one-word wordmark, tagline "No fee. No commission. No
  middleman." once, tutormint.org, @tutormint.official + FB/IG/YT/TikTok marks
  (`lib/social/marks.ts`, downscaled base64), "X: @TutorMint5", QR (cvQrDataUri).
  Richer body: subjects with singular level labels (`lib/social/data.ts` resolves
  from tutor_subjects — the view column is null), rating, experience, teaching
  chip (allowsOnline → "Suitable for online"), place, template CTA. Caption box
  from same data (`buildCaption`), Copy + Download toasts, live preview.
  `test:social` (7) asserts single-commission + band + caption. contrast-check
  extended to 83 pairs.
- **CV carry-over**: `cvSections`/`cvTextLines` in model.ts are the single text
  source for preview + PDF; `test:cv` (14) serialises the preview and asserts
  equality. PDF name bold (Geist Bold embedded), headline own line + line-height,
  bullets → react-pdf Svg icons matching the preview.
- **Notification carry-over**: badge caps 99→"99+"; Mark all read (bell + page,
  `/api/notifications/read-all`); live Realtime increment (postgres_changes on
  notifications, migration 54); count parity verified.
