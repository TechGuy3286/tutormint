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
