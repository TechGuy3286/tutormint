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
