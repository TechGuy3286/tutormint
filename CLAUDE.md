@AGENTS.md

# TutorMint — Working Rules for Claude Code (v2, post-audit)

TutorMint (tutormint.org) connects verified tutors with parents and school/academy owners in Pakistan.
Stack: Next.js 16 App Router, TypeScript, Tailwind v4, **Supabase only** (Postgres + Auth + Storage). Vercel. YouTube Data API for tutor verification videos.
Brand colours are defined once, in `app/globals.css`, and used only through Tailwind tokens — see "Brand colour system" below. The earlier ad-hoc values (`#d60008`, `#B3191F`, `#0F172A`, `#059669`) are retired and no longer appear anywhere in `app/` or `components/`.

## Product philosophy (drives every UX decision)

- **Feels free.** Browsing tutors and tuitions is fully public. Never ask anyone to sign up or log in until they attempt a *transactional* action: apply to a job, post a job, message someone, view contact details, buy a package. At that moment show a small "Sign in to continue" modal, preserve their draft, and return them to the action after auth.
- **Simple, self-explanatory UI.** No onboarding tours, no walls of text.
- **Revenue = memberships.** The only thing the platform ever sells is a package. No commissions, no per-lead fees.
- **Trust = verification.** Tutors: video + CNIC + degree audit. Parents: CNIC + address.

## Non-negotiable engineering rules

1. Supabase is the only backend. Mongo/Mongoose is deleted. Never re-add it.
2. Auth truth = Supabase cookie session. Never use `localStorage`/`sessionStorage` for login or role state. (`sessionStorage` may hold an unsaved draft only.)
3. Role lives in `profiles.role` (`'tutor' | 'parent' | 'admin'`). Institutions (schools/academies) are ordinary parent accounts — no separate role, label or flow. `profiles.admin_role` is set only when `role='admin'`. Never probe multiple tables to guess role.
4. Role gating is server-side in `app/tutor/layout.tsx`, `app/parent/layout.tsx`, `app/admin/layout.tsx` (server components via `@/lib/supabase/server`). Client components read the user for display only.
5. Every API route that writes calls `supabase.auth.getUser()` first and scopes writes to that user (copy the pattern from `api/parent/jobs`). Admin routes additionally check `profiles.role = 'admin'` and the `SCREEN_ACCESS` entry via `requireAdminRole` / `checkAdminRole`.
6. Entitlements are enforced **server-side** (RLS + `lib/entitlements.ts`), never only by hiding a button.
7. No hardcoded secrets, emails, phone numbers, or mock data in shipped pages. Contact details and pay details come from `app_settings` with env fallbacks.
8. Read `node_modules/next/dist/docs/` before writing Next code. `middleware.ts` → `proxy.ts` per Next 16.
9. `npx tsc --noEmit` and `npm run build` must pass before any task is declared done. `npm run check:contrast` and `scripts/rls-audit.ts` are CI gates, not suggestions.
10. **Precedence rule.** This document has grown by accretion. Where two sections conflict, the later-dated section wins, and an "As built" section beats any spec section. If you find a conflict that this rule does not settle, stop and ask the owner — do not pick one silently.
11. **Every mutation logs.** Member-facing mutations call `logActivity()` (`lib/activityLog.ts`); admin mutations additionally write `admin_audit_log`. This is part of each task's definition of done, not a later pass.
12. **No free-text subjects, ever.** Subjects and levels are `taxonomy_master` id references everywhere — profiles, jobs, filters, search, imports, landing pages.
13. **No search buttons.** Every search input on the platform is a typeahead (see "Instant search everywhere").

## Canonical tables (Supabase)

`tutor_profiles` is canonical for tutors. The ten pre-rebuild tables (`tutors`, `parents`, `parent_profiles`, `parent_jobs`, `tuitions`, `tutor_applications`, `tuition_applications`, `job_messages`, `tutor_activities`, and the old `profiles` shape) were **renamed to `legacy_*` in T8a, not dropped** — a forgotten caller must break visibly and the rows must remain findable.

- `profiles` — `id (= auth.users.id)`, `role`, `admin_role ('owner'|'manager'|'verifier'|'finance'|'support', null unless role='admin')`, `full_name`, `email`, `phone`, `whatsapp`, `phone_verified_at`, `phone_gate_required bool default false`, `city`, `province`, `address`, `cnic_number`, `cnic_image_path` (private bucket `identity-docs`), `cnic_verified_at`, `address_verified_at`, `avatar_url`, `profile_completion int`, `is_suspended bool`, `email_opt_out bool`, `welcomed_at`, `last_message_digest_at`, `must_change_password bool`, `created_at`
- `tutor_profiles` — `id (= profiles.id)`, `slug unique`, `headline`, `bio`, `class_levels text[]`, `degrees text[]`, `teaching_mode`, `online_platforms text[]`, `area`, `hourly_rate_pkr`, `experience_years`, `video_youtube_id`, `video_status ('none'|'uploaded'|'approved'|'rejected')`, `video_submissions int` (3-strike cap), `verification_status ('pending'|'verified'|'rejected'|'suspended')`, `is_featured bool`, `imported bool default false`, `claimed_at timestamptz`, `rating_avg`, `rating_count`
- **Subjects are join tables, not arrays.** `tutor_subjects(tutor_id, master_id)` and `job_subjects(job_id, master_id)` reference `taxonomy_master.id`. `tutor_profiles.subjects text[]` and `jobs.subjects text[]` are retired — any remaining column is legacy and must not be read.
- `plans` — seed rows (see matrix). `code`, `audience ('tutor'|'parent')`, `name`, `price_pkr`, `duration_days = 30`, `monthly_quota`, `displayed_quota text`, `can_view_contact`, `can_whatsapp`, `can_initiate_message`, `can_hire`, `search_rank int`, `badges text[]`, `tag_label`
- `subscriptions` — `id`, `user_id`, `plan_code`, `starts_at`, `expires_at`, `status ('active'|'expired'|'cancelled')`, `payment_id`, `reminded_at`
- `payments` — `id`, `user_id`, `plan_code`, `amount_pkr`, `provider`, `provider_ref` (idempotency key, unique per `(provider, provider_ref)`), `method ('jazzcash'|'easypaisa'|'bank'|'assanpay')`, `reference`, `screenshot_path` (private bucket `payment-proofs`), `status ('pending'|'approved'|'rejected')`, `reviewed_by`, `reviewed_at`, `created_at`
- `usage_counters` — `user_id`, `period (YYYY-MM, UTC calendar month)`, `jobs_applied int`, `jobs_posted int`, `messages_initiated int`, unique(user_id, period)
- `jobs` — `id`, `job_tx_id` (keep existing human id), `parent_id`, `child_id nullable`, `title`, `class_level`, `city`, `area`, `teaching_mode`, `budget_pkr`, `description`, `status ('open'|'closed'|'hired')`, `hired_tutor_id`, `is_featured bool` (cache of the parent's plan via `applyPlanFlags()`), `created_at`
- `applications` — `id`, `job_id`, `tutor_id`, `message`, `status ('applied'|'shortlisted'|'hired'|'rejected')`, `created_at`, unique(job_id, tutor_id)
- `threads` — `id`, `job_id nullable`, `participant_a`, `participant_b`, `initiated_by`; `messages` — `id`, `thread_id`, `sender_id`, `body` (stored raw; rendered masked when either side lacks contact rights), `created_at`
- `children` — `id`, `parent_id`, `name`, `class_level` (a parent dashboard supports multiple children; a job may reference one)
- `shortlists` — `(user_id, tutor_id)` unique. Replaces the `tutormint_saved_tutors` localStorage key.
- `demo_requests` — `id`, `parent_id`, `tutor_id`, `mode ('online'|'in_person')`, `scheduled_at`, `status`, `created_at`; `demo_feedback` — the rating that follows one, joined by `demo_feedback.demo_request_id`. **Both are canonical**; neither was retired.
- `reviews` — `id`, `tutor_id`, `parent_id`, `rating`, `comment`, `created_at`
- `phone_otps` — `phone`, `purpose ('verify'|'reset')`, `code`, `expires_at`, `consumed_at`, `attempts`
- `user_activity_log` — the member timeline (see that section). `admin_audit_log` — every admin mutation. `user_blocks`, `penalties_log`, `profile_views`, `academy_affiliations`, `tutor_slots` — kept and wired per their tasks.
- `advertisements` + `ad_events` — see the advertisements spec. `app_settings` — support contact, pay details, `{{COMPANY_REG_NO}}`, `{{COMPANY_NTN}}`.
- `taxonomy_categories` / `taxonomy_levels` / `taxonomy_subjects` / `taxonomy_master` — keep as is (used by `lib/taxonomy.ts`), plus an admin-editable alias table for Roman-Urdu spellings.

Views: `tutor_directory` ("is this tutor listed?" — browse, `rank_tutors()`, sitemap all read it) and `tutor_visible_profiles` ("may this URL render?" — adds unclaimed imports, granted to nobody, reached only via the SECURITY DEFINER `tutor_public_page()`).

Hired/closed status lives in `jobs.status` + `jobs.hired_tutor_id` — never localStorage.

## Entitlements matrix (the product spec — implement exactly)

### Tutor plans

| Plan | PKR/mo | Badges shown | Apply quota (real / displayed) | See who viewed your profile | View parent contact & WhatsApp | Send WhatsApp | Initiate in-app message | Search rank |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| verified | 199 | Verified | 10 / "10" | **yes** | no | no | no — can only reply to messages received and apply via job application | 1 (low) |
| premium | 499 | Verified + Premium | 25 / "25" | yes | no | yes | yes, any parent | 2 |
| featured | 999 | Verified + Premium + Featured (yellow tiny "Featured" tag on card) | 100 / "Unlimited" | yes | yes | yes | yes | 3 (top) |

- **Viewer identity is a Verified power (owner, 4 Sep 2026; migration 43).** It was premium-and-above until then, which meant the profile-view teaser — the tutor dashboard's primary upsell surface and the whole point of the 199 funnel — had to sell Rs 499. `plans.can_see_viewer_identity` is now true on verified, premium and featured, and `REQUIRES.tutor_viewer_identity` in `lib/gate.ts` reads `'verified'`. **Premium's reasons to upgrade are the three it still owns alone: 25 applications against 10, WhatsApp to parents, and search priority.** The column moved before the button did, because a gate must never offer a plan whose row does not carry the power.
- Profile completion (100%) is mandatory before any badge shows or any paid plan activates. A tutor may pay first; the badge appears when completion hits 100% and admin verification passes.
- Unverified / incomplete tutors are **not listed** in `/browse/tutors`.

### Parent plans

**This is the final model (1 Sep 2026). It supersedes every earlier parent table, including the "reply only" row.**

| Tier | PKR/mo | Requires | Browse | View full profile | Initiate message | Demo request | Post jobs | See contact / WhatsApp | Hire | Ranking |
|---|---|---|---|---|---|---|---|---|---|---|
| Unverified | — | signup | yes (public pages) | no | no | no | no | no | no | — |
| `parent_verified` | free | CNIC + address approved | yes | yes | **yes, any tutor** | yes | 5 / mo | no | **no** | standard |
| `parent_featured` | 999 | paid | yes | yes | yes | yes | 100 / mo, displayed "Unlimited" | yes, incl. `wa.me` with prefilled intro | **yes** | top |

- **Hire is the paid gate, not messaging.** The hire action is server-gated to `parent_featured`; free parents see "Upgrade to hire".
- Parents cannot post any job until CNIC + address are verified. The Verified badge is the reward for that, not a purchase.
- Free parents see tutor results in standard rank order (featured/premium tutors still on top — that is what tutors pay for).
- Tutor-side steering: job cards and applicant threads display parent status ("Featured parent — can hire" / "Verified parent"), plus a persistent tutor-dashboard notice that only Featured parents complete hires.
- Number masking: message bodies are scanned server-side for phone patterns; when either participant lacks contact rights the digits render masked with an upgrade chip. Store original, render masked, unmask automatically when rights exist.
- Admin dashboard shows real quota usage against the real 100 cap for every "Unlimited" user.

### Enforcement

`lib/entitlements.ts` exports `getEntitlements(userId)` → `{ plan, suspended, quotaLeft, canViewContact, canWhatsapp, canInitiateMessage, canHire }`. Every gated API route calls it. Contact fields are **never** returned to the client unless `canViewContact` — filter them in the route or the RLS policy, don't just hide them in JSX.

- `getEntitlements()` filters on `expires_at > now()`, so plan powers stop the instant a subscription lapses, whether or not the nightly sweep has run.
- A suspended member gets nothing back at all — posting, applying, hiring, contact and badges all close at once, including in routes written later.
- **Suspension is checked before tier.** `createJob`, `applyToJob` and `canStartThread` test `ent.suspended` *before* their tier and listing checks. Otherwise a suspended tutor at 100% completion is told to "complete your profile" and a suspended parent is offered an upgrade — both send someone to fix a thing that is not broken.
- Quotas (`lib/quota.ts`): `checkQuota(ent, kind)` before the work, `consumeQuota(userId, kind)` after it succeeds — deliberately two calls, because no transaction spans the counter and the row it guards.

## Auth & verification flows

**Signup is mobile-first — see "Mobile-first signup" and its "As built (T-UI2)" notes, which are canonical. The email-first flow described in earlier drafts is retired.** In short: `/register` creates the account from a mobile number (synthetic `<msisdn>@users.tutormint.org` when no email is given), signs the user in immediately, sends an OTP, and `proxy.ts` holds accounts with `phone_gate_required = true` and `phone_verified_at is null` on `/verify-phone`.

- **One `/login`**, accepting email **or** Pakistani mobile (mapped server-side through `lib/phone.ts` in `/api/auth/login`, which returns one identical message for every failure so the route is not a membership oracle). After sign-in read `profiles.role` once → `/tutor/dashboard` | `/parent/dashboard` | `/admin`. `/parent/login` and `/tutor/login` are server redirects to `/login`.
- **One `/register`** with two role radios: **Tutor** and **Parent / Institution**. Creates the auth user + `profiles` row (+ `tutor_profiles` with `verification_status='pending'` for tutors).
- **Email confirmation** applies only to accounts registered with an email and no mobile. Mobile-verified accounts never see it. `/api/auth/callback` handles the code exchange. Password-reset delivery needs SMTP on the Supabase project — see `PRODUCTION_CHECKLIST.md`.
- **Phone OTP**: `POST /api/auth/otp` (send) and `/verify`. Checks `expires_at`, single-use (`consumed_at`), max 5 attempts, and carries a `purpose` so a reset cannot eat a pending verification code. `DEV_DEFAULT_OTP` is non-production only, guarded three times (`devOtpCode()`, `assertOtpSafety()` at startup, and the route calling the helper rather than `process.env`), and requires that a code was actually requested. A real SMS provider is a hard go-live prerequisite.
- **Tutor video**: recorded/uploaded via `app/tutor/upload-youtube` → uploaded to the official channel as **private** → `tutor_profiles.video_youtube_id` + `video_status='uploaded'`. Max 3 submissions; each gets Approve | Hold | Suspend with a written reason; after the 3rd rejection the button locks and support contact is shown. Approving and publishing are different decisions with different permissions (verifier vs manager). Route requires auth + `role='tutor'`; `googleapis` declared; `YOUTUBE_*` documented in `.env.example`.
- **Degrees**: typed list + certificate image upload. Parents see watermarked, downscaled derivatives from the private bucket; the original is never exposed. Same treatment for CNIC previews (admin-only). Terms say "protected against casual copying", never "cannot be screenshotted".
- **Parent verification**: CNIC image → private bucket `identity-docs` (RLS: owner + admin only), address text. Admin approves → `cnic_verified_at`, `address_verified_at` → Verified badge and the ability to post jobs.
- **Admin**: `profiles.role='admin'` + `admin_role`, bootstrapped by SQL for the owner's account. `app/admin/layout.tsx` server-gates. All hardcoded passwords and `adminAuth` localStorage removed.

## Pages to keep (canonical) and delete

Keep: `/`, `/browse/tutors` (+`/browse/tutors/[id]`), `/browse/tuitions`, `/tutor/[slug]` public profile, `/login`, `/register`, `/forgot-password`, `/verify-phone`, `/tutor/claim`, `/suspended`, `/account/notifications`, `/tutor/dashboard/*` (`settings`, `jobs`, `messages`, `notifications`), `/parent/dashboard/*`, `/chat/[jobId]`, `/tutor/packages`, `/parent/packages`, `/pay/simulator/[ref]` (non-production), `/admin/*`, `/about`, `/faq`, `/privacy`, `/terms`, `/support`, `/review`. T9 adds `/tutors/[city]/[subject]` and `/tuitions/[city]/[subject]`.

`/browse` → redirect to `/browse/tutors`. Homepage keeps the two buttons: **Find Tutors / Teachers** → `/browse/tutors`, **Find Tuitions / Jobs** → `/browse/tuitions`.

**Redirect stubs that must survive** (T0, 2 Sep 2026): `/parent/login` and `/tutor/login` redirect to `/login`, and **`/tutor/register` redirects to `/register`** — `lib/tutorSharing.ts` and `components/TutorReferralBox.tsx` mint `/tutor/register?ref=` URLs that are already circulating on WhatsApp, so deleting it 404s live referral links. Any stub that is deleted later must be replaced by a redirect in `next.config.ts`, never left to 404.

Delete: the whole Mongo layer, `/parent/browse`, `/parent/post-job`, `/parent/signup`, `/tutor/settings`, `/tutor/jobs`, `/tutor/[username]`, `/tutor-profile`, `/faqs`, `/chat/[id]`, `app/browse/tutors/[id]` (keep `app/browse/[id]` content but move it to `app/browse/tutors/[id]`), `lib/lib/`, `lib.rar`, `New folder/`, `api/tutor/login`, `api/auth/parent-login`, old `/register`.

**`Dev Manual tutormint.md` is deleted** (T0). It documented Mongoose as "Completed Architecture & Current State", cited the retired brand red `#B3191F`, and described an `/api/tutor/register` route that no longer exists — it was the only file in the repository asserting that Mongo is current, which is the exact thing rule 1 exists to prevent. Anything in it that is still true belongs in `README.md`. This document is the only architecture reference.

## Ordered task list (one PR each, stop after each)

**The old checkbox list could not have been true**: T6, T7a, T7b and T8a were ticked while T0-T5 were not, and those later tasks describe schema, auth and entitlements that only exist if the earlier ones shipped. Step 0 settled it — `docs/STATE.md`, 2 Sep 2026. The ticks below record what has been verified against the applied migrations and the live schema, not what was claimed.

**The migration list is the ledger, not these checkboxes.** `supabase/migrations/` holds 29 applied migrations, `01_enable_rls.sql` through `29_t_ui2_phone_gate.sql`. When this list and that directory disagree, that directory is right and this list is stale again.

Shipped:

- [x] **Build fix** — dynamic-segment conflicts, TutorCard props, declare `googleapis`.
- [x] **Step 0 State audit** — `docs/STATE.md`, 2 Sep 2026. Route tree, applied migrations, fresh schema dump, and which of T0-T5 was genuinely outstanding. The answer was: only T0, and only three items of it.
- [x] **T0 Cleanup** — audit found most of it already done by T2, T7b and T8a. Remaining work: deleted `/parent/signup` (zero inbound references) and its two stale comments in `app/register/`, added `PSQL_PATH` to `.env.example`, corrected the `SUPABASE_DB_URL` comment (it feeds the RLS audit and backup, not only seed/verify). `/tutor/register` was deliberately kept — see the redirect-stub note above. `Dev Manual tutormint.md` deleted as a live contradiction of rule 1.
- [x] **T1 Schema** — migrations 01-13. RLS enabled first, canonical tables, taxonomy join tables (`tutor_subjects`, `job_subjects`) replacing the `text[]` columns, `children`, `shortlists`, `demo_requests`, seeded `plans`, storage buckets. The live schema has 51 tables, 2 views and 84 policies, RLS on 51/51.
- [x] **T2 Auth spine** — migration 14 plus `proxy.ts` (`next build` reports `ƒ Proxy (Middleware)`; `middleware.ts` is gone), `lib/auth.ts`, the three server layouts, single `/login` + `/register`.
- [x] **T3 Verification** — migration 15. Profile completion via `lib/profileChecklist.ts`, phone OTP, CNIC upload, degree certificates with watermarked derivatives, hardened YouTube upload route.
- [x] **T3.5 Admin-lite** — migrations 17-18. Server-gated `/admin`, tutor moderation queue, parent CNIC + address queue, manual plan grant/revoke, `lib/adminAuth.ts` `requireAdminRole()`, owner bootstrap, `admin_audit_log` and `user_activity_log` with `logActivity()` wired.
- [x] **T4 Tutor side** — migrations 16, 19-21. `/tutor/dashboard`, `/tutor/[slug]`, `/browse/tutors` reading `tutor_directory`, `rank_tutors()`, `tutor_slots`, the profile-view teaser.
- [x] **T5 Parent side** — migrations 22-23. Post job (verification- and quota-checked), job detail + applicants, hire gated to `parent_featured`, `/browse/tuitions`, chat on `threads`/`messages` with number masking, `user_blocks`, demos v1.
- [x] **T6 Packages & payments** — migration 24. `/tutor/packages`, `/parent/packages`, the provider adapter contract, `lib/entitlements.ts`, badges + Featured tag, contact-field filtering, `usage_counters`, expiry cron.
- [x] **T7a Admin, part 1** — migration 25. `/admin/team`, reports & penalties queue, member directory + timeline, audit view, dashboard by role, video visibility toggle.
- [x] **T7b Admin, part 2** — migration 26. Advertisements with weighted rotation, social post generator, bulk tutor import + claim flow, junk-user cleanup.
- [x] **T8a Launch hardening** — migrations 27-28. Legacy `legacy_*` renames, RLS audit CI gate, email/SMS delivery, unknown-input polish, Terms & Privacy drafts, security headers, backups.
- [x] **T-UI1** — homepage restore from `design/reference/homepage.png` + brand colour system + single `Footer`.
- [x] **T-UI2** — migration 29. Mobile-first signup, `/verify-phone`, the `phone_gate_required` flag, OTP purposes, number-change moves the synthetic auth email.
- [x] **T-Search Instant search everywhere** — migration 30. `pg_trgm`, `taxonomy_aliases` (Roman-Urdu spellings, admin-editable), `search_suggest()` and `popular_subjects()`, `/api/search/suggest`, and `components/search/Typeahead.tsx` on both browse pages and the admin member directory. No search button remains anywhere on the platform.

Outstanding — the only work left, build in this order:

- [ ] **T8b Launch remainder** — region migration to Mumbai `ap-south-1`, Cloudflare Turnstile, nonce-based CSP through `proxy.ts`, WhatsApp delivery, legacy NOT NULL columns on `jobs`/`messages`, Search Console + Bing + Google Business Profile, site-wide schema (9.2), **and turning preview mode off — see "Preview mode" below; it is a gate, not a tidy-up.**
- [ ] **T9 SEO & content system** — programmatic landing pages (9.1), blog CMS (9.3), content queue (9.4). May run parallel to T8b.

Backlog, not built:

- **Referral programme** — v2 backlog, not built. The `?ref=` links credited nobody: `/tutor/register` redirects and drops the query string, `/register` never read `ref`, and no column stored a referrer. `TutorReferralBox.tsx` and `generateReferralLink()` were deleted in T0; `/tutor/register` stays as a redirect because `/faq` links to it.
- **Demo recordings (demos v2)** — tutor uploads a recording of an online demo to YouTube unlisted, shown on the profile after admin approval.
- **Self-serve ad purchase** — v1 ad sales are manual, created by owner or manager after off-platform payment.
- **Direct social publishing** — the social generator downloads a PNG and a caption; posting to Meta/TikTok needs Meta app review.
- **Responsiveness ranking signal** — median reply time, once there is real messaging data.
- **AI help bot on `/support`** — post-launch.
- **Auto-generated blog post per tutor** — scaled-content risk. The social generator produces the tutor's banner and caption at 100% completion instead.

**Known build gotcha** (T0): after deleting a route, `npx tsc --noEmit` can fail on `.next/dev/types/validator.ts` still referencing it. That is a stale artifact from a previous `next dev` which `next build` does not regenerate — `rm -rf .next/dev` clears it.

## Design system & responsiveness (applies to every task)

**Mobile-first, always.** Write Tailwind base classes for a 360px viewport first, then add `sm:` / `md:` / `lg:` overrides. Test every page at 360, 390, 768, 1024, 1280 before calling it done. No horizontal scroll at any width. Tap targets ≥ 44px. Sticky bottom action bar on mobile for primary actions (Apply / Post Job / Send Message).

Reference mockups live in `design/reference/` (tutor card + badge set). They are references, not assets — do not embed the JPEGs.

### Brand colour system — the only permitted colours

Defined in `app/globals.css` under `@theme`, so each one becomes a full Tailwind
utility family (`bg-tm-red`, `text-tm-navy`, `border-tm-gold/30`, …).
**Supersedes `#d60008` and `#059669` and every other raw value.**

| Token | Hex | Use |
| --- | --- | --- |
| `tm-red` / `tm-red-hover` | `#C20202` / `#A10202` | primary actions, links, prices, danger |
| `tm-navy` / `tm-navy-hover` | `#151E6B` / `#0E1450` | headings, the Find Tuitions button, Premium badge |
| `tm-green-deep` / `-hover` | `#2E7D4F` / `#24633F` | the Find Tutors button, success, Verified badge |
| `tm-mint` | `#9AE899` | fill only, and the footer's headings on black |
| `tm-black` | `#0A0A0A` | footer and dark surfaces |
| `tm-gold` | `#F59E0B` | Featured badge and tag — **fill only** |
| `tm-gold-ink` | `#92400E` | the readable member of the gold family, for gold text |
| `tm-tint-red` / `-navy` / `-green` / `-gold` | `#FBEAEA` / `#E8EAF5` / `#EEFBEE` / `#FEF6E6` | alert, info, success and warning panels, each with dark text from its own family |
| `tm-bg` | `#F8FAFC` | page ground |

Rules:

1. **No raw hex in `app/` or `components/`.** `app/globals.css` is the only file
   that carries one. `npm run check:contrast` greps for the rest.
2. Tailwind's default grays (`slate-*`, `gray-*`) stay, for borders and muted
   text. They are not brand colours.
3. `tm-gold` and `tm-mint` are fills. Gold is 2.05:1 on the page ground and mint
   is lighter still — neither can be text. Gold text is `tm-gold-ink`; text on a
   gold or mint fill is `tm-black` or `tm-navy`. Mint never carries text at all.
4. `lib/brand.ts` mirrors the palette as JavaScript, for the four render targets
   that cannot read a CSS custom property: badge SVG `fill` attributes,
   `next/og` (satori), `app/global-error.tsx`, and the YouTube callback's HTML
   string. `check:contrast` fails if it drifts from `globals.css`.
5. **Every text-on-colour pair must clear WCAG AA** (4.5:1). The pairs are
   listed in `scripts/contrast-check.ts`; add a row when a new combination
   appears, and it is a CI gate, not a suggestion.

### Badges (`components/badges/`)

Build as inline SVG React components, each accepting `size` (`'sm' | 'md'`) and `showLabel`. Circle background, white glyph, subtle diagonal shade like the reference.

| Component | Colour | Glyph | Earned by |
| --- | --- | --- | --- |
| `VerifiedBadge` | `tm-green-deep` | check mark | tutor: verification passed + 100% profile; parent: CNIC + address verified |
| `PremiumBadge` | `tm-navy` | lightning bolt | tutor plan premium or featured |
| `FeaturedBadge` | `tm-gold` disc, `tm-gold-ink` label | crown | tutor plan featured / parent plan featured |
| `FeaturedTag` | `bg-tm-gold` + `text-tm-navy`, `text-[10px]` pill | "Featured" | same as above — sits on the card corner |

Badges render in the order Verified → Premium → Featured. A tutor on `featured` shows all three. Never show a badge the entitlements layer hasn't granted.

### `components/TutorCard.tsx` (rebuild to match `design/reference/` card)

Mobile layout: avatar 72px + name + stars on one row; badges row below (icons only at `sm`, icon + label at `md+`); then Subjects / Experience / Area / City with the book / briefcase / pin / building icons (use `lucide-react`); buttons stack 2×2 on mobile, one row on desktop.
Desktop layout: avatar 140px left, content right, four buttons in a row — exactly as the reference.

Buttons and their gating:

| Button | Style | Guest | Free/Verified parent | Featured parent |
| --- | --- | --- | --- | --- |
| View Profile | navy solid | open | open | open |
| Shortlist | red outline, heart | sign-in modal | saves to `shortlists` table (replace localStorage `tutormint_saved_tutors`) | same |
| Demo | red solid, play icon | sign-in modal | creates `demo_requests` row (wire the existing `api/demo/*`) | same |
| Send Message | green solid, mail | sign-in modal | shows "Upgrade to message tutors directly" upsell — can only reply | opens thread |

Contact number / WhatsApp are never rendered on the card. On the profile page they appear only when `canViewContact` is true; otherwise a locked row with an "Unlock with Featured" link.

Add `shortlists (user_id, tutor_id, unique)` and `demo_requests (id, parent_id, tutor_id, status, created_at)` to the T1 migration.

### Job cards (`components/JobCard.tsx`)

Same card language: title, subjects chips, class level, area/city, budget, posted-ago, parent's badges, `FeaturedTag` when `jobs.is_featured`. Primary button **Apply** (tutor, quota-checked) → sign-in modal for guests.

## SEO rule for public pages (T4 / T5)

`/browse/tutors`, `/browse/tuitions`, `/tutor/[slug]`, and job detail pages are the platform's organic-search surface. They must be **server components** that query Supabase during render so tutor/job data is present in the HTML. Client-side "Loading directory…" fetches are not acceptable on these pages. Use client components only for the filter bar, shortlist button, and modals. Each tutor profile and job page sets its own `generateMetadata` (title: "{Name} — {Subjects} tutor in {City} | TutorMint"). `app/sitemap.ts` must list every verified tutor slug and every open job.

## Academic taxonomy (global — the only source of subjects/levels)

Source of truth: the owner's "App Master Sheet – AcademicLevels". Seed files live in `supabase/seed/` (`seed_taxonomy.sql` + four CSVs). Structure:

- `taxonomy_categories` (13) — Pre-Primary, Primary, Middle, Matriculation, IGCSE, Intermediate, ADP, BS, MS/MPhil, Test Preparations, IB, Holy Quran, Sports & Games
- `taxonomy_levels` (133) — grade / programme under a category (e.g. IGCSE → O Levels, AS & A Levels)
- `taxonomy_subjects` (363) — deduplicated subject names, shared across levels
- `taxonomy_master` (896) — the allowed (category, level, subject) combinations. `leaf_type='level'` rows (Test Preparations, Sports & Games, Holy Quran) have no subject: the level itself is the selectable item.

Rules:

1. **No free-text subjects anywhere.** Tutor profiles, job posts, filters, and search all store `taxonomy_master.id` references (or slugs), never typed strings. Replace `tutor_profiles.subjects text[]` and `jobs.subjects text[]` with join tables `tutor_subjects(tutor_id, master_id)` and `job_subjects(job_id, master_id)`.
2. `components/TaxonomySelector.tsx` and `lib/taxonomy.ts` already exist — extend them, don't rewrite. Selector is a 3-step cascade: Category → Level → Subject(s) (skip step 3 for `leaf_type='level'`). Mobile: full-screen sheet with search.
3. Browse filters and matching (tutor ↔ job) compare on `master_id`, so "O Levels Physics" matches only "O Levels Physics".
4. `seed_taxonomy.sql` is idempotent — re-run whenever the owner updates the sheet. Never hand-edit taxonomy rows in the app.
5. Display names: use `name` columns as-is. Sorting inside a category follows `sort_order` (sheet order), subjects alphabetical.

## Supabase state — the 31 Aug 2026 audit and what has since been decided

Tables found in the Table Editor on 31 Aug 2026: academy_affiliations, advertisements, demo_feedback, job_messages, jobs, messages, parent_jobs, parent_profiles, parents, penalties_log, phone_otps, profile_views, profiles, reviews, taxonomy_categories, taxonomy_levels, taxonomy_master, taxonomy_subjects, tuition_applications, tuitions, tutor_activities, tutor_applications, tutor_profiles, tutor_slots, tutors, user_blocks.

Resolved since:

- **RLS was OFF ("Unrestricted") on `parents`, `phone_otps`, `profiles`.** Enabling RLS on every table is the first statement of the schema migration, before anything else. Two legacy tables (`parents`, `parent_jobs`) also carried a policy with no `TO` clause and `with check (true)` — the anon key could insert. **When the question is whether RLS allows something, probe it in psql, not over the REST API**: PostgREST returns 42501 for a permitted write whose `return=representation` has no SELECT policy, which looks refused and is not.
- Three job tables (`jobs`, `parent_jobs`, `tuitions`) and two application tables (`tutor_applications`, `tuition_applications`) existed. Canonical: `jobs` and `applications`. Two message tables (`messages`, `job_messages`). Canonical: `threads` + `messages`. Rows migrated, originals renamed `legacy_*` in T8a — **not dropped**.
- `demo_feedback` is **not** renamed to `demo_requests`. `demo_requests` is the request, `demo_feedback` is the rating that follows one; both are canonical.
- `advertisements` — resolved: it is the ad-slot table. See "Advertisements — revenue spec". No need to ask the owner.
- `tutor_activities` is superseded by `user_activity_log`. Useful rows migrate in T7; the table is renamed `legacy_tutor_activities` in T8. There is exactly one activity table and one helper — `lib/activityLog.ts`.
- Kept and wired: `tutor_slots` (availability — T4); `user_blocks` (T5 chat); `academy_affiliations` (free-text "teaches at X"); `profile_views` (tutor dashboard stat + upsell teaser); `penalties_log` (admin).
- Before writing any migration, dump `information_schema.columns` for every table into `supabase/schema-before.md` so the migration is written against real column names, not guesses. **Re-dump it now** — the schema has moved a long way since 31 Aug.

## Business rules — owner Q&A (31 Aug 2026). Overrides earlier sections where they conflict.

**Accounts & verification**

- Signup is auto-approved for everyone; no admin gate to get an account. The platform's job is to *push* completion: profile-completion widget everywhere, "complete your profile to get hired" prompts.
- A tutor appears in /browse/tutors when profile_completion = 100% (regardless of plan). Admin moderation is reactive: Approve | Hold | Suspend on any tutor; Suspend removes them from listings.
- Verified badge = 100% profile + active `verified` (or higher) plan. Badges are rewards, not gates.
- Tutor video: max 3 submissions. Each gets admin Approve | Hold | Suspend with a written reason. Irrelevant/abusive uploads → Suspend. After the 3rd rejection the upload button locks and support contact is shown.
- Degrees: typed list + certificate image upload. Parents see previews only: watermarked ("TutorMint" diagonal), downscaled derivative served from the private bucket; original never exposed; right-click/drag disabled. Same treatment for CNIC previews (admin-only) and it's understood screenshots can't be technically prevented — terms language says "protected against casual copying", never "cannot be screenshotted". Tutor signup terms include consent to use profile photo in TutorMint promotional ads.
- Parents: CANNOT post any job until CNIC + address are verified (admin queue). Verified badge is the reward.
- A parent dashboard supports multiple children (name + class level); a job can reference a child. Schools/academies are ordinary parent accounts — no separate label anywhere.
- Tutor profile gets a LinkedIn-style tagline/headline field; academy_affiliations = free-text "teaches at X" entries.

**Packages & payments**

- AssanPay gateway is in negotiation → when live, all local methods (cards, JazzCash, Easypaisa, bank) flow through it and plan activation is INSTANT on webhook confirmation. Until then: manual transfer + reference/screenshot + admin approval, copy says "usually activated within a few hours". Never promise "live/instant" for manual transfers.
- No refunds, ever. Stated on packages pages and in Terms; Terms linked in footer.
- Tutors can pay before profile completion — accept the money, hold the badge until 100%.
- Expiry: reminder at T-3 days via email + WhatsApp; at expiry immediate downgrade to free/none, NO grace period. Nothing is deleted: chats, shortlists, posted jobs, favourites all remain in the dashboard; only plan powers (contact visibility, quotas, tags, ranking) switch off. Featured jobs lose the tag but stay open.
- Application withdrawal: allowed, no quota refund.

**Messaging & contact (updated matrix)**

- ALL parents (free included) can initiate in-app messages to any tutor, with or without a job. parent_featured adds: view contact + WhatsApp, wa.me link with prefilled intro, priority ranking, 100/mo job quota.
- Tutor side unchanged: verified = reply-only + apply; premium/featured may initiate; featured sees parent contact.
- Block/Report: any user can block or report any user (user_blocks + a reports queue in admin). Blocked = no messages, no applications between the pair.

**Demos**

- v1 (T5): parent requests demo (online or in-person) → tutor accepts with a time → held off-platform (Zoom/Meet/WhatsApp/physical) → parent leaves demo_feedback. Free; one demo per parent-tutor pair.
- v2 (backlog, not now): tutor uploads recording of an online demo → YouTube (unlisted) → shown on profile after admin approval.

**Growth mechanics**

- Profile-view teaser: tutor dashboard shows anonymised viewer events from profile_views ("A parent searching O-Level Physics in <area> viewed your profile") with identity blurred; upgrading to premium/featured reveals viewer name/job link. This is the primary upsell surface.
- advertisements table stays. Admin-managed rotating ad slots: default = TutorMint house ads; future = paid academy/school ads and "top rated tutor" promos shown to parents. Build the rotation widget + admin CRUD in T7.

**Task reorder**

- NEW T3.5 (after T3, with badges/cards): admin-lite — server-gated /admin with (a) tutor moderation queue (video review 3-strike, Approve/Hold/Suspend), (b) parent CNIC+address verification queue. This unblocks realistic testing of T4–T6.
- T6 adds the payments-approval screen. T7 = full admin: reports queue, penalties, quota-usage view for "Unlimited" users, YouTube visibility toggle, advertisements CRUD, junk-user cleanup, stats.
- T8 additionally: region migration decision (owner choosing between Mumbai ap-south-1 / Singapore ap-southeast-1 / stay Sydney), junk auth-user deletion, professional rewrite of Terms & Privacy reflecting: no refunds, quotas incl. real 100-cap behind "Unlimited", manual + gateway payments, watermarked previews, photo-use consent, block/report policy.

## FINAL parent model + payments/region decisions (supersedes all earlier parent rules)

- Region: migrate to Mumbai ap-south-1 in T8 (Singapore ap-southeast-1 is the fallback if the owner objects before T8).
- Payments: gateway-first. Public packages UI = AssanPay checkout, instant activation on webhook. Manual-transfer flow exists only as an admin fallback screen (T6). Pre-launch testing: admin can grant/revoke any plan on any account (T3.5 admin-lite includes this).
- Parent tiers:
  - Unverified: browse public pages only.
  - Verified (free, requires CNIC + address approved): browse, view full tutor profiles, initiate in-app messages with any tutor, send demo requests, post jobs (5/mo). CANNOT hire; CANNOT see contact/WhatsApp.
  - Featured 999: everything incl. hire, contact + WhatsApp + wa.me, priority, Featured tag, 100/mo shown as "Unlimited".
- The hire action (marking an applicant hired / hire flow) is server-gated to parent_featured. UI for free parents shows "Upgrade to hire".
- Tutor-side steering: job cards + applicant threads display parent status ("Featured parent — can hire" / "Verified parent"); persistent tutor-dashboard notice that only Featured parents can complete hires.
- Number masking: message bodies are scanned server-side for phone-number patterns; when either participant lacks contact rights, matched digits render masked with an upgrade chip. Store original, render masked; unmask automatically when rights exist.

## Admin team hierarchy (owner requirement, 1 Sep 2026)

- `profiles.admin_role` (nullable, set only when role='admin'): 'owner' | 'manager' | 'verifier' | 'finance' | 'support'. Exactly one owner initially: techguy3286@gmail.com (bootstrap migration updates 08).
- Permissions (enforced in BOTH admin UI and RLS/API — a role must not be able to do via API what the UI hides):
  owner: everything + create/suspend staff accounts and assign admin_role (Team screen).
  manager: all operations except Team management.
  verifier: tutor moderation queue (video 3-strike, Approve/Hold/Suspend) + parent CNIC/address queue only.
  finance: payments approval, subscriptions, quota-usage view only.
  support: reports queue, user blocks, penalties, demo issues only.
- Staff accounts are created by owner from /admin/team (T7): name + email + admin_role → invite email via supabase auth admin API. Requires SUPABASE_SERVICE_ROLE_KEY as a server-only env var (added at T7; never NEXT_PUBLIC, never in client bundles, added to Vercel env at that point).
- T3.5 ships: admin_role column + owner bootstrap + permission helper (lib/adminAuth.ts: requireAdminRole(...roles)) + the two verification queues + manual plan grant/revoke. /admin/team screen itself is T7.
- A helper SQL function is_admin_with(role text[]) backs the RLS policies for admin-only tables (payments approval, penalties_log, advertisements, reports).

## Social post generator (T7, owner + manager)

- /admin/social (rebuilds the existing social-generator/social-share stubs; lib/tutorSharing.ts may be reused): pick tutor → pick template + format (1080x1080 square, 1080x1920 story, 1200x630 wide) → server renders a branded PNG via next/og ImageResponse from live profile data: photo, name, badges, subjects, area/city, rating, TutorMint logo/colours, "Hire verified tutors on tutormint.org" CTA. Manager may edit one headline line only; all other content comes from the profile.
- Output: PNG download + auto-generated caption (name, subjects, city, profile URL, hashtags e.g. #TutorMint #<City>Tutor #<Subject>) with copy button.
- v1 is generate/download/copy — posting is manual. Direct Meta/TikTok publishing is v2 backlog (requires Meta app review); do not build now.
- Photo-use consent is granted in tutor signup terms (already specified). Suspended tutors are excluded from the picker.
- Permission: owner + manager only (add to the admin matrix).

## Advertisements — revenue spec (expands the earlier note; T7)

- Slots (fixed): browse/tutors + browse/tuitions inline banner after every ~8 results; parent dashboard sidebar slot; tutor dashboard slot (house/promo ads only). No other placements.
- advertisements columns: title, image_path, target_url, audience ('parents'|'tutors'|'both'), starts_at, ends_at, weight, status, created_by + ad_events (ad_id, kind 'impression'|'click', occurred_at) or counter columns — admin analytics shows impressions/clicks per ad for advertiser reporting.
- Rotation: active ads for the slot's audience, weighted random; expired ads drop out automatically. Empty slot → TutorMint house ad (package upsell creatives).
- Every ad renders with a visible "Sponsored" label. Ads NEVER appear as tutor cards or inside search ranking — ranking is sold only via plans; ads are banners. This protects Featured-badge value.
- v1 sales are manual: owner/manager creates the academy's ad with an end date after off-platform payment. Self-serve ad purchase = v2 backlog.
- Permission: owner + manager (matrix updated).

## Search ranking algorithm (T4 — /browse/tutors and matching)

1. Eligibility filter (hard): profile_completion=100, not suspended, matches query filters (subject via taxonomy master_id exact, city, teaching_mode).
2. Tier (absolute, never blended): featured > premium > verified(paid) > free-complete. Sort key 1.
3. Within tier, sort by:
   a. location closeness: searched area match > same city > online-only.
   b. weighted rating (IMDb-style Bayesian): score=(n/(n+m))*tutor_avg+(m/(n+m))*platform_avg with m=10. Zero-review tutors start at platform average.
   c. tie rotation: stable daily shuffle for near-equal scores — order by md5(tutor_id || current_date) — so equal-tier tutors share top positions across days.
4. Excluded signals (deliberate): last-active recency, profile_views, message volume — nothing grindable or rich-get-richer. v2 backlog: responsiveness signal (median reply time) once real messaging data exists.
5. Jobs ranking (browse/tuitions): featured jobs first, then created_at desc.
   Implement as a SQL view or function (rank inputs computable in one query); the browse page must not rank client-side.

## Bulk tutor import (T7, owner + manager) + mobile-as-username login

- /admin/import: CSV/XLSX upload against a downloadable template (name, mobile, whatsapp, city, area, gender, subjects, levels, experience_years, expected_fee). Full-file validation BEFORE any insert: phone format (Pakistani mobile), subjects/levels resolved against taxonomy, duplicate mobile (in file and in DB) → per-row errors; only clean rows import.
- Each imported row: auth user with synthetic internal email <msisdn>@users.tutormint.org + random password (must_change_password=true, forced reset on first login), profiles row (role=tutor, phone), tutor_profiles row (imported=true, claimed_at NULL), slug generated.
- Results file returned to admin: name | username (mobile) | password | profile URL | status. Distribution happens over WhatsApp manually.
- Login form (/login) accepts email OR Pakistani mobile number; mobile input maps to the synthetic internal email server-side before signInWithPassword. No SMS-based auth (cost); the T3 profile OTP still verifies number ownership.
- Imported profiles: direct URL /tutor/[slug] renders, but EXCLUDED from search/browse until the tutor claims: first login + accept terms (incl. photo consent) + OTP-verify mobile + 100% completion. Sets claimed_at. Imported tutors start with plan=none — import never bypasses payment or verification rules.
- tutor_profiles gains: imported bool default false, claimed_at timestamptz, must-change-password handled at auth level.

## Security hardening additions (owner-approved)

- T3.5 addition: admin_audit_log (id, actor_id, actor_role, action, target_type, target_id, detail jsonb, created_at). EVERY admin mutation writes a row (verification decisions, plan grants/revokes, payment approvals, suspensions, staff changes, ad CRUD, imports). Read-only screen in T7 (owner + manager). Insert via server code path only; RLS: admins read, nobody updates/deletes.
- T8 checklist additions: Cloudflare Turnstile CAPTCHA on /login + /register via Supabase attack-protection integration; enable Supabase leaked-password protection; security headers in next.config.ts (CSP, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy); weekly scheduled pg_dump job documented in README (owner runs or schedules); admin session lifetime shorter than default.
- Owner personal actions (not code): 2FA on GitHub, Vercel, Supabase, and the underlying Gmail.

### Identity documents are private; sample data is never a form default (4 Sep 2026)

Two rules, learned from live defects, both CI-checkable in principle and both non-negotiable:

- **Identity documents live only in private buckets and are served only through an authorising route.** CNIC scans, the verification selfie, and degree certificates go to the private `identity-docs` bucket via `lib/documents.ts` (`storeDocument`) and are reachable only through `/api/documents/[id]/preview`, which decides rights per document kind (CNIC and selfie: owner or admin; degree: any signed-in user, so a parent can see qualifications). The bucket has no public URL, ever, and the route serves the watermarked derivative, never the original. A new `user_documents.kind` is private by default — the preview route's non-owner branch names `degree` explicitly and refuses everything else. The public buckets (`avatars`, `tutor-media`, `ads`) are for the avatar, the cover image and ad creatives — nothing that identifies a person off a photo of a document. This rule exists because the tutor settings page once uploaded both CNIC sides and the selfie to the public `tutor-media` bucket, where a real member's national identity card was fetchable by URL with no credential at all (secured 4 Sep 2026; see `docs/STATE.md`, migrations 45–46).
- **No sample or seeded data is ever used as a form default.** A form's initial state is empty, and a loaded value only ever comes from the member's own row. The tutor settings page once seeded its state with a plausible "MS Mathematics — LUMS" degree and a "Cambridge Certified Educator" certificate; because the loader overwrote a list only when the row already had one, a tutor with none kept the sample and Save wrote it as their own — a fabricated credential on a platform that sells degree-verified tutors. Empty defaults, unconditional load. This is rule 7 ("no mock data in shipped pages") applied to client state, which is where it gets forgotten.

## Member activity timeline — superseded

An earlier draft of this section named the table `activity_log` and the helper `lib/activity.ts`. **That version is retired, and it had the table name wrong.** No `activity_log` table was ever created. There is one table, `user_activity_log`, and one helper, `lib/activityLog.ts` — the helper filename does not match the table name, and that is fine. See the section below, which is what the T7a code actually calls.

## Member activity timeline (canonical — logging from T3.5; screen in T7)

- `user_activity_log` (id, user_id, event_type, target_type, target_id, metadata jsonb, created_at). `logActivity()` in `lib/activityLog.ts` is called from server code paths only, on: register, login, otp_verified, profile_updated, completion_changed, subjects_changed, document_uploaded, video_submitted (with attempt #), job posted/edited/closed, application_submitted/withdrawn, hired/was_hired, demo requested/accepted/declined/completed, message_sent (**thread reference only — never message text**), shortlist_added/removed, plan_purchased/expired, payment_submitted, report filed/received, block created/received, suspended/unsuspended, verification decisions received.
- Every feature built from T3.5 onward MUST instrument its mutations. It is part of the task's definition of done, not a later sweep.
- `POST /api/reports` writes both sides — `reported` on the reporter's timeline and `reported_by` on the reported member's — but never names the reporter in the reported member's metadata, because that timeline is admin-visible and naming them would turn the screen into a way to find out who complained.
- **The privacy line.** There is no chat-browsing screen. Message content is loaded only on `/admin/reports`, only for reports whose `target_type='thread'` with a `target_id`, and that page has no input that could request any other thread. The timeline shows `message_sent` with a thread reference and never a body.
- `/admin/users/[id]` (T7): profile summary + verification state + plan/subscription history + filterable event timeline (newest first) + linked objects (jobs, applications, payments, subscriptions, reports) alongside the `admin_audit_log` entries targeting that member. Clicking a member anywhere in admin routes here.
- Visibility: owner / manager / support see full timelines; verifier and finance only through their own queue contexts. RLS: inserts via the server path; admins read; no update or delete.
- `admin_audit_log` (id, actor_id, actor_email stored on the row rather than joined, actor_role, action, target_type, target_id, detail jsonb, created_at) is append-only by construction — a SELECT policy and no others. Every admin mutation writes one.

## Admin, part 2 (T7b) — growth tools

**Three ad placements exist and no more**: inline after every 8 browse results, the parent dashboard, the tutor dashboard (house creatives only — tutors are not sold to advertisers). The homepage carries none; it is partner-approved and locked, and an ad slot is not among the permitted changes. `AdSlot` takes the slot name as a required prop so a fourth placement cannot appear by accident.

Ads are BANNERS. They never render as a tutor card and never enter ranking — ranking is sold through plans, and a Featured tutor must not find an advertiser above them. A paid ad is labelled **Sponsored**; a house ad is labelled **TutorMint**, because calling our own upsell sponsored would be untrue. The label comes from the ad's own kind, not from a prop.

Selection is weighted random over active ads whose date window is open. Expiry is enforced by the RLS policy, not by an application filter — an expired ad is not returned to the anon key at all, so no code path can forget to exclude it. An empty pool falls back to a house creative rather than a hole.

`ad_events` has **no INSERT policy for anyone**: impressions and clicks are written by the server only. That is the whole reason the numbers are worth reporting to an advertiser. Clicks go through `/api/ads/click/[id]`, which counts, re-validates the destination (http/https only — an open redirect on a domain parents trust is worth more to a phisher than the slot is to us) and then redirects. `advertisements.created_by` is stripped from anon and authenticated by a **column privilege**: RLS cannot hide a column, and a table-level GRANT overrides a column-level REVOKE, so the table grant is withdrawn and the public columns re-granted individually.

**Social posts** take everything but one headline line from the live profile, so what we publish about a tutor and what the site says cannot diverge. Renders are **pixel-stable** — no clock, no randomness — so regenerating a post gives byte-identical output. The picker reads `tutor_directory`, which already excludes suspended tutors and unclaimed imports: we do not publish posts about people the site itself will not show. Photo-use consent comes from the signup terms, and for imported profiles from the claim flow. Generation is audited on download, not on preview.

**Imported tutors.** `tutor_directory` answers "is this tutor listed?" — browse, `rank_tutors()` and the sitemap all read it, so one condition (`imported = false or claimed_at is not null`) keeps an unclaimed import out of all three. `tutor_visible_profiles` answers a different question, "may this URL render?", and adds unclaimed imports: the import hands the tutor a link to their own profile over WhatsApp, and that link has to work or the claim flow starts with a 404. It is granted to nobody — `tutor_public_page()` is SECURITY DEFINER — so an unclaimed import is unreachable through a plain query.

The import validates the WHOLE file before writing anything. A half-applied import is the worst outcome available: twenty accounts created, an error on row twenty-one, and no way to tell which are real. `apply` re-validates from scratch rather than trusting verdicts the browser sends back. Subjects resolve to `taxonomy_master` ids — a spreadsheet is exactly where free-text subjects would otherwise creep in.

Claiming requires all three of: the temporary password replaced, terms accepted (including photo consent), and the mobile OTP-verified — the same number the account was created from, which is what proves it reached the right person. Claiming does **not** make anyone listable; completion must still reach 100%. Import never buys a shortcut past verification or payment.

**Mobile login.** `/login` takes an email or a Pakistani mobile; `lib/phone.ts` reduces every shape a human types to one MSISDN, and the import derives the synthetic address (`<msisdn>@users.tutormint.org`) from the same function — if the two derivations disagreed by a dash, the tutor could never sign in and nothing would say why. The mapping is server-side in `/api/auth/login` so a number can also resolve to a normally-registered account, and so that **every** failure returns one identical message: otherwise the route would answer "is this number registered on TutorMint?" for anyone who asked, one number at a time.

**Junk cleanup** is owner-only — the one admin action with no undo. The email heuristic decides what to SHOW; what decides deletion is the data check. Nothing is offered that is a seed fixture, staff, or has a job, application, payment, subscription, message, report, review or demo behind it. (`test.parent@tutormint.com` looks like junk and has twelve real jobs; a name-based rule would have deleted a working account.) The route recomputes the candidate list rather than trusting posted ids, and a typed DELETE is required.

## Admin, part 1 (T7a) — what is enforced where

**Permission matrix, in code.** `SCREEN_ACCESS` in `lib/adminAuth.ts` is the single list; the nav, every screen (`requireAdminRole`) and every mutation route (`checkAdminRole`) read the same entry. `team: []` means owner only — `roleSatisfies()` always admits the owner, so an empty list needs no special case. Added in T7a: `reports` and `users` (manager/support), `audit` (manager), `videoVisibility` (manager). Hiding a nav link is presentation; the screen and the route each re-check.

**Suspension is one fact with one enforcement point.** `profiles.is_suspended` is set by `lib/moderation.ts`, which is the only implementation — the reports queue and the member page both call it, so the same decision cannot produce two different states. It bites in four places: `getEntitlements()` returns nothing (closing posting, applying, hiring, contact and badges at once, including routes written later), the dashboard layouts redirect to `/suspended`, `sendMessage()` refuses, and `tutor_directory` excludes them. A suspended staff account also stops being an admin actor — `getAdminActor()` returns null — without losing its `admin_role`, so reactivating does not mean re-deciding what they were.

Nothing is deleted, ever. Jobs, applications, threads, reviews and subscriptions survive; reinstatement restores `verification_status` to `verified` and re-applies the plan's Featured flags via `applyPlanFlags()`, because suspension clears them and a tutor who is still paying must not silently lose what they bought.

**Suspension is never reported as a plan problem.** `createJob`, `applyToJob` and `canStartThread` check `ent.suspended` *before* their tier and listing checks. Otherwise a suspended tutor at 100% completion is told to "complete your profile", and a suspended parent is offered an upgrade — both send someone to fix a thing that is not broken.

**The privacy line on message content.** There is no chat-browsing screen. Bodies are loaded on `/admin/reports`, only for reports whose `target_type='thread'` with a `target_id`, and there is no input on that page that could request any other thread. A report about a profile or a job renders no messages at all. The member timeline shows `message_sent` with a thread reference and never a body — `lib/activityLog.ts` never puts one in `meta`.

**Report both sides.** `POST /api/reports` writes `reported` on the reporter's timeline and `reported_by` on the reported member's, because the admin member page has to show that someone has been reported, not only that they report others. The reporter is not named in the reported member's meta: their timeline is admin-visible, and naming them would turn the screen into a way to find out who complained.

**Staff invites.** `inviteUserByEmail()` is tried first and depends on the project having SMTP. When it fails, the account is created directly and a one-time temporary password is returned to the owner, shown once, never stored and never written to the audit log. Either way `must_change_password` is set. Claiming an email went out when the project has no SMTP leaves a colleague waiting for a message that will never arrive.

**Video visibility.** Approving a video and publishing it are different decisions with different permissions (verifier vs manager). Only an `approved` video can be made unlisted or public; going back to `private` is always allowed. Without `YOUTUBE_*` credentials the choice is recorded on `tutor_profiles` and the response says so in words — the audit entry carries `appliedOnYouTube: false`, so nobody later reads a row and assumes YouTube agreed. A genuine API failure is reported and nothing is written.

**Audit is append-only by construction.** `admin_audit_log` has a SELECT policy and no others, so there is no UPDATE or DELETE path even with the anon key. `actor_email` is stored on the row rather than joined, so an entry still says who acted after that staff account is deleted.

## Launch hardening (T8a) — what is enforced where

**The ten pre-rebuild tables are renamed, not dropped.** A dropped table takes
its rows with it and leaves no way to find out afterwards whether something was
still reading it. `legacy_*` answers both questions at once: a forgotten caller
breaks immediately and visibly, and the 47 `parent_jobs` rows are still there.
Two of them — `parents` and `parent_jobs` — carried a policy called "Enable
insert for authenticated users" with no `TO` clause and `with check (true)`,
which meant the anon key could insert. That was proven at the SQL layer before
it was fixed, because the same insert through PostgREST returns 42501 and looks
refused: `return=representation` needs a SELECT policy to echo the row back, and
the write itself was permitted. **When the question is whether RLS allows
something, probe it in psql, not over the REST API.**

**`scripts/rls-audit.ts` is the CI gate**, and it is deliberately two halves.
Reads are probed live with the publishable key, because that key is in every
browser bundle and "what does it see" has a real answer. Writes are checked
structurally against `pg_policies` and NOT probed: a live write probe passes
happily until the day the audit finally has something to catch, and that is the
day you least want a test suite inserting rows. The rule applied to policy text
is that a permissive write policy must name `auth.uid()` or an `is_admin`
helper — an expression that never looks at the caller cannot tell anon from
anybody. Everything public is on a hand-written allowlist with a reason
attached, so widening access is a diff a reviewer notices.

**One opt-out flag, not a matrix.** The matrix is the version where somebody
unticks the box that would have told them their plan expired. Each template in
`lib/notify/templates.ts` declares itself essential or not, and the essential
ones ignore `profiles.email_opt_out` — verification decisions, payment receipts,
plan expiry, being hired. `/account/notifications` says which those are rather
than showing a tick box that quietly does nothing.

**The message digest never contains the message.** An inbox is not somewhere we
control, and a forwarded "here is what the tutor said" email is exactly the leak
number-masking exists to prevent. Throttled to one an hour per person by
`profiles.last_message_digest_at` — a durable timestamp, because an in-process
timer on Vercel means one email per hour *per lambda*, which is not the promise.

**The welcome email is sent at email confirmation, not at sign-up.** At sign-up
the address is unproven, and mailing unconfirmed addresses is how a sending
domain's reputation is spent. `profiles.welcomed_at` is stamped *before* the
send, so a retry storm cannot mail somebody ten times; one lost welcome is a far
smaller problem than ten delivered ones.

**`DEV_DEFAULT_OTP` is guarded three times**, on the principle that the check
which matters is the one that survives a refactor of the other two.
`devOtpCode()` in `lib/sms/index.ts` is the only place in the codebase that
reads it and returns null in production; `assertOtpSafety()` **throws at server
startup** if the variable is present in a production build at all; and the OTP
route calls the helper rather than `process.env`. The throw is the point — a
variable set in production means somebody believes it works, and a warning in a
log is read after the incident it would have prevented.

**Nothing pretends to have sent.** Every adapter — Resend, Twilio, WhatsApp —
answers `isConfigured()` first and returns a stated failure rather than a
cheerful `ok:true`. In development a console adapter prints the message, and the
log line says CONSOLE. In production a missing key is never silently swapped for
the console: a deployment that thinks it is sending mail and is not is worse than
one that says it cannot.

**Validation speaks to the person.** `lib/validate.ts` is one `parseBody()` and
one 400 shape (`{ error, fields }`) across every route, so a form can render
both without knowing what it called. Zod's own text never reaches a member —
`isZodDefault()` recognises it and `humanise()` replaces it, because
`issue.message || humanise(issue)` never falls through: Zod always populates
`message`. Ids use `z.guid()`, **not** `z.uuid()`: Zod 4 enforces the RFC
variant bits and the seed cast's ids (`11111111-…`) do not carry them, so
`uuid()` would reject rows the database itself issued. Fees accept "8000",
"8,000", "8k" and "Rs 8000" — a parent who writes "8k" has not made a mistake.

**Rate limits live in the database.** On Vercel an in-memory counter limits each
lambda separately, which is not a limit. `consume_rate_limit()` does the
increment and the test in one statement, because read-then-write lets two
concurrent requests both see "one left". It **fails open**: a database wobble
must not lock everybody out of a platform whose password check is still the
actual control.

**Admin re-authentication instead of a short admin session.** A short session
logs a moderator out mid-queue, and the predictable result is that the queue
stops being worked — it punishes the diligent admin and inconveniences an
attacker for twenty minutes. So the session stays and the four actions that
cannot be undone (suspend/reinstate, staff changes, junk deletion, payment
approval) ask for the password again if the last confirmation is over 12 hours
old. `adminFetch()` handles the `{ reauth: true }` 401 in one place so a screen
written later cannot forget to. Reversible actions are not gated: a prompt on
every action is a prompt people learn to type through.

**The CSP has a known gap, written down.** `script-src` carries
`'unsafe-inline'` because Next's App Router emits inline bootstrap scripts, and
closing it properly needs a per-request nonce threaded through `proxy.ts` —
its own change, with its own testing, not something to bundle into a pass that
touches eleven other things. What it already stops is the step that turns an XSS
into exfiltration: no script from an unnamed origin, no connection to an unnamed
origin, no framing. The reasoning is in `next.config.ts` so nobody later reads
`'unsafe-inline'` and assumes it was an oversight.

**`/support` lost its contact form.** It set a state variable and told the
member "Your support ticket has been received" — nothing was sent, no ticket
existed, nobody was going to reply. It is now FAQ-first with a real WhatsApp
link and a real email address, both read from `app_settings` with env fallbacks
so rule 7 holds, and a channel with nothing configured is not shown at all.

**Terms and Privacy cite no statute.** Pakistan's data-protection legislation has
been in draft for years; naming an act that may not be in force, or
misdescribing one that is, would be worse than describing our actual practice
plainly. Both files carry a DRAFT FOR OWNER REVIEW header naming the sections a
lawyer should read first. Every commitment in them matches something the code
enforces — where the two disagree, the code is the bug.

## Payments — the adapter contract (T6)

Finishing the AssanPay integration is a fill-in job, not a rewrite. Everything that depends on their documentation is marked `TODO(assanpay)` in `lib/payments/assanpay.ts`; the shape around it is settled and shared with the other providers.

**The interface** (`lib/payments/provider.ts`)

- `isConfigured()` — false when its env vars are missing. An unconfigured provider is never selected, so a half-configured deploy falls back rather than sending a member to a checkout that cannot complete.
- `createCheckout(intent)` → `{kind:'redirect', url}` or `{kind:'manual'}`. The intent carries our own `reference`, the plan, the amount (read from `plans`, never from the request) and the request origin.
- `verifyWebhook(request, rawBody)` → a `WebhookEvent`, or **null** when the request is not ours or the signature fails. The route answers 401 on null — never "ignored", which would hide an attack. The raw body is passed through untouched; re-serialising parsed JSON changes the bytes and breaks every signature.

**Provider selection** (`getProvider()`): simulator (non-production only) → assanpay (when all four `ASSANPAY_*` vars exist) → manual. Manual is the floor, so there is always something to sell through.

**The simulator is not a mock.** With `NODE_ENV != production`, `PAYMENTS_SIMULATOR=true` and `PAYMENTS_SIMULATOR_SECRET` set, `/pay/simulator/[ref]` renders a fake gateway whose buttons post an HMAC-signed callback to the real `/api/payments/webhook` over HTTP. Signature checking, idempotency and activation are the production code path. There is no default secret anywhere — a signature check that passes without one is not a check.

**Activation happens in exactly one place**: `lib/payments/activate.ts`. Two callers reach it — a verified webhook, and an audited approval on `/admin/payments`. A bank-transfer member therefore ends up with the identical subscription row, badge, notification and activity event as a card member; the only difference is that the human decision writes an `admin_audit_log` entry. Idempotent by construction: an already-approved payment returns `alreadyActive` and changes nothing, so a replayed callback cannot mint a second month.

**Idempotency key** is `payments.provider_ref` — our reference, generated at checkout, unique per `(provider, provider_ref)`. Nothing is trusted from the payload except the reference and the outcome: a callback claiming `plan=featured` cannot upgrade anyone, and a gateway reporting less than the plan price leaves the payment pending for a human rather than half-activating.

**Upgrade path**: buying a different plan cancels the current subscription and runs a fresh `plans.duration_days` from now. No proration, no partial credit — and the packages page says so in those words.

**Expiry** (`lib/payments/expiry.ts`, run by `/api/cron/subscriptions` daily via `vercel.json`, protected by `CRON_SECRET`): reminder at T-3 guarded by `subscriptions.reminded_at`; at zero, `status='expired'` plus the denormalised Featured flags off. The cron is not what enforces expiry — `getEntitlements()` filters on `expires_at > now()`, so powers stop the instant a plan lapses whether or not the sweep has run. Nothing is deleted: chats, applications, shortlists and posts all stay; a featured job loses its tag and stays open. Email and WhatsApp delivery attach at `deliverExpiryReminder()` in T8.

**Featured flags** (`tutor_profiles.is_featured`, `jobs.is_featured`) are a cache of the plan, shared by purchase and admin grant through `applyPlanFlags()`. Renewal re-tags the parent's OPEN jobs — expiry strips the tag, so without that a parent who renewed would have permanently lost promotion on jobs they paid to feature.

**Manual transfer**: account details live in `app_settings` (`pay.bank_name`, `pay.account_title`, `pay.iban`, `pay.jazzcash`, `pay.easypaisa`) with `MANUAL_PAY_*` env fallbacks, so an admin changes them without a deploy and rule 7 is not broken. A channel with no details configured is not offered rather than shown blank. Receipts go to the private `payment-proofs` bucket and are served only through `/api/payments/proof/[id]` to the owner or an admin who may work the payments queue. Copy never says instant: "usually activated within a few hours".

**Quotas** (`lib/quota.ts`): one vocabulary — `checkQuota(ent, kind)` before the work, `consumeQuota(userId, kind)` after it succeeds. Deliberately two calls: there is no transaction spanning the counter and the row it guards, so spending first would cost a member an application whose insert then failed. The period key is a UTC calendar month, not 30 days from purchase.

**Admin**: `/admin/payments` (queue + subscription ledger) and `/admin/payments/usage` (real counts against the real 100 cap, including for plans that advertise "Unlimited") are owner / manager / finance. Verifier and support get neither — a verifier who could approve a payment could hand out plans. The subscription "source" column is derived from `payments.provider`, not stored: that is where the fact lives, and storing it twice is how two answers start disagreeing.

## Homepage is LOCKED (partner-approved design)

- Reference: design/reference/homepage.png. app/page.tsx must match it: logo header, pill "PAKISTAN'S LARGEST VERIFIED TUTORS & TEACHERS NETWORK", green "HIRE", headline "Trusted, Degree-Verified Tutors/Teachers FREE" (FREE in brand red), red italic subline, the two large buttons (`tm-green-deep` "Find Tutors / Teachers" → /browse/tutors, `tm-navy` "Find Tuitions / Jobs" → /browse/tuitions), dark footer with the four link columns + social icons + WhatsApp bubble.
- Permitted changes only: link targets, mobile responsiveness (stack the two buttons on <640px), generateMetadata/SEO, and accessibility fixes.
- The brand-colour migration (1 Sep 2026) was authorised by the owner explicitly for this page: the greens, the blue-to-navy change and the footer black come from the token table above. Layout and copy stay locked.
- Built from design/reference/homepage.png, not recovered from git: the approved design was never committed to this repository and production has never served it. See the T-UI1 note below. NO new sections, no ads slot, no featured-tutor strip, no copy changes without an explicit owner instruction in the prompt.
- The earlier "homepage featured strip" idea is dropped; featured prominence lives on /browse/tutors ranking only.
- **Hero pill text colour is `tm-navy` (#151E6B).** Explicit owner authorisation dated 2 Sep 2026, and the only permitted change to this page in that pass. The pill's background (`tm-tint-green`) and border (`tm-green-deep/20`) are unchanged. Recorded here so it is not reverted as a stray edit to a locked file.

## Graceful handling of unknown input (T8 polish checklist)

- Branded app/not-found.tsx, app/error.tsx, global-error.tsx, and an offline state: friendly copy + links to /browse/tutors, /browse/tuitions, /. Suspended/unclaimed tutor slugs → 404 page with the same shell. No raw framework errors ever reach users.
- Empty states for every list (search results, jobs, applications, messages, notifications, demos, shortlists): a sentence + 1–3 concrete actions. Search no-results must offer: widen to whole city, include online tutors, post a job.
- Form validation: friendly inline messages stating the expected format (mobile 03xx-xxxxxxx, CNIC 5-7-1 digits, fee as number), input normalisation (strip spaces/dashes, "5k" → 5000 with confirmation), never lose typed content on error, Urdu text accepted in free-text fields.
- Help: /support rebuilt as FAQ-first (questions grouped for tutors/parents incl. "refunds" → no-refund policy + terms link, "how verification works", "why can't I hire") with a one-tap WhatsApp + email fallback. AI help bot is post-launch backlog, not built now.
- Unknown API input: every route validates with zod (or equivalent) and returns structured 400s with a human message; the UI renders that message.

## Register / login form rules — as built (T8a), superseded on labels

**The role labels and the mobile-first flow in this section are superseded by "Register form" and "Mobile-first signup" below.** What still stands:

- `/register` is minimal and centred at all widths: role radios at the top, full name, password, consent checkbox, and the sign-in link. **No mention of school or academy on any auth form** — institutions register as parents; only the FAQ explains this. City and every other detail are collected in profile completion, never at signup.
- Same minimal treatment for `/login`: identifier + password + forgot-password + register link.
- `/forgot-password` reports the same thing whether or not the address has an account — a reset form that says "no such account" is a membership oracle.
- The one deviation from "nothing else": the terms + photo-consent acceptance stays. It is a checkbox, not a data field, and consent given by implication through a link nobody opens is not consent anybody would recognise having given.
- **Password-reset delivery over email needs SMTP on the Supabase project, which is not configured yet** — see `PRODUCTION_CHECKLIST.md`. The mobile OTP reset path works.

## Legal entity (owner, 1 Sep 2026)

- Legal name: Tutor Mint (Private) Limited — short form "Tutor Mint (Pvt) Ltd". Brand/trading name everywhere users look: "TutorMint". Two-word legal form appears ONLY in legal contexts: footer copyright line, Terms, Privacy, receipts/invoices, payment merchant name, About/Contact.
- Registered office: 4th Floor, 37-M, Civic Center, Model Town, Lahore, Punjab, Pakistan. Official email support@tutormint.org. Business WhatsApp +92 321 5872222 (from app_settings, never hardcoded). Financial year end 30 June. Regulator: SECP, Companies Act 2017.
- **Directors are NOT shown in the UI** (owner, 4 Sep 2026). They are public record at SECP and naming them on /about, /terms and /privacy put three people's names on three marketing pages to no purpose — nothing on the site depends on knowing who the directors are, and the company itself is already named. The line was removed from `entitySection()`, which supplies all three pages at once. Directors' names may appear in nothing the site renders. As before, no other personal data from the incorporation form (CNICs, DOBs, home addresses, personal emails) may appear anywhere in the codebase, DB seeds, or UI.
- **A missing company number renders as no row at all**, never as a placeholder. The SECP registration number (CUIN) and the NTN are seeded in `app_settings` as `{{COMPANY_REG_NO}}` and `{{COMPANY_NTN}}` (migration 38), and `lib/company.ts` reports `regNoPending` / `ntnPending` when a value is still one of those. Every surface that shows a company number hides its row while the flag is true — printing `{{COMPANY_REG_NO}}` to a visitor reads as an unfinished page, not as a fact we do not have. Each row starts appearing the moment an admin fills the value in, with no deploy.
- Footer line: "© 2026 Tutor Mint (Pvt) Ltd. All rights reserved." (no trademark claim unless the mark is registered).

## Conversion rules — the 199 funnel (owner, 1 Sep 2026)

- Business focus: the PKR 199 tutor Verified plan is the primary conversion. Every tutor-facing surface after signup should make the value of Verified visible.
- HARD RULE: never signal "paid platform" to anyone who has not signed up or has not chosen to open a packages page. No prices, no "activate for 199", no paywall hints on public pages, on signup, or as welcome banners. Prices live only on /tutor/packages and /parent/packages, reached by the user's own click. The dropped idea: a Verified-activation banner at 100% completion — do NOT build it.
- Build these attractions (all show the tutor something they want; the price only appears when they reach for it):
  1. Profile-view teaser at the TOP of the free tutor dashboard (anonymised viewer + subject + area).
  2. "Your position" widget: rank for their main subject/city with "Verified tutors appear above you".
  3. "Jobs matching you this week" strip on the free dashboard: real matching jobs, Apply leads to /tutor/packages?plan=verified.
  4. Matching-job notification: "New <subject> job in <area> — Verified tutors can apply."
  5. Packages page: their own card rendered with vs without the Verified tick; live social proof "<n> tutors hired this month" from applications.status='hired'; framing lines "less than one hour of tuition", "one hire pays for a year"; no-refund line stays.
  6. Checkout: two taps, no re-entry, JazzCash/Easypaisa first-class.
  7. Expiry reminders worded as loss of visibility, not as invoices.

## T9 — SEO & content system (post-launch, can run parallel to T8b)

**No WordPress.** Everything below lives in Next.js + Supabase + the existing admin.

### 9.1 Programmatic landing pages

- Routes: /tutors/[city]/[subject] and /tuitions/[city]/[subject] (subject = taxonomy slug incl. level-type leaves). Generated only where listed tutors (or open jobs) ≥ 3; below threshold → 404 and excluded from sitemap.
- Page content: data-built H1 ("O Level Physics tutors in Lahore"), intro paragraph from a template with REAL numbers (count, fee range, modes, areas), ranked TutorCards via rank_tutors, filters, Post-a-job CTA, neighbour links (other subjects same city, same subject other cities, parent category), ItemList schema, generateMetadata with the brand line.
- Built once, ISR-revalidated every few hours; sitemap includes all live pages. Templates must produce differing content per page (numbers/lists), never copy-pasted paragraphs.

### 9.2 Site-wide schema & snippet control (schema part can ship with T8b — no NTN dependency)

- Organization (legal name, brand, logo, address, phone, email, sameAs social links, slogan "No fee, no commission, no middleman") + WebSite with SearchAction on the homepage.
- Person/Service on tutor profiles, JobPosting on tuition jobs, FAQPage on /faq, Article on posts, ItemList on landing pages, BreadcrumbList site-wide.
- Title template: "<page> — verified, no commission | TutorMint". Description template ends with "…on TutorMint, Pakistan's verified tutors network. No fee, no commission, no middleman."
- Ops (T8b): Google Search Console + Bing Webmaster with sitemap submitted; Google Business Profile for the Model Town office; consistent NAP in footer.

### 9.3 Blog CMS (/admin/blog)

- Tables: posts (title, slug immutable after publish, cluster, audience 'parents'|'tutors'|'both', language 'en'|'ur', body rich text/markdown, cover_path, cover_alt required, seo_title ≤60, seo_description ≤155, related_landing_pages[], status draft|reviewed|scheduled|published|unpublished, publish_at, author_id, reviewed_by, views, cta_clicks), post_revisions.
- Content map (fixed clusters): Cost & hiring; Boards & exams; Subject guides; City guides; Tutor career; Safety & trust; Urdu versions of the top 10. Target ~40 evergreen posts, then refresh cycle + monthly roundups.
- Article generation: manager enters title + 3–5 fact notes → "Generate draft" calls Claude API (server-side, ANTHROPIC_API_KEY) with a fixed brief: brand voice (plain, warm, Pakistan-specific, no corporate filler), 900–1,400 words, answer-first, H2 sections, table where useful, FAQ block, audience CTA, links to relevant landing pages, NEVER invent statistics (use the notes or say "typically"). Publish button disabled until a human has saved an edit and ticked "reviewed".
- Cover/banner: auto-rendered via next/og ImageResponse in 1200x630 (OG) + 1080x1080 (social) from title + cluster using brand colours; 3–4 templates rotate by cluster; manager may upload an image instead (auto-resized; alt text mandatory).
- Metadata: seo_title/description generated with the draft and editable in a Google-preview box; alt text auto from title/cluster for generated covers; canonical; Article schema (author = Tutor Mint (Pvt) Ltd); OG/Twitter cards; unpublish returns 410 (never a blank page); sitemap + Search Console ping on publish.
- Public: /blog index with cluster filters; /blog/[slug] server-rendered with reading time, TOC, related posts, audience CTA, share buttons, live tutor-card/job-card embed blocks; RSS; Urdu posts RTL with proper font.
- Roles: owner/manager create-edit-publish; support draft only; audit-logged. Analytics: views + CTA clicks per post.
- Roundups: a post type regenerated monthly from data ("New verified tutors in <city> — <month>", "Most-hired <subject> tutors this month"), still human-reviewed before publish.
- NOT built: auto-generated blog post per tutor (scaled-content risk). Instead: at 100% completion the social generator auto-produces the tutor's banner + caption, queued for the manager AND shown to the tutor with WhatsApp/Facebook/Instagram share buttons.

### 9.4 Content queue — the system suggests what to publish

- Signals: (1) on-site search_performed events with low/zero results by subject×city; (2) Google Search Console API queries at positions 8–20; (3) built-in Pakistani academic calendar (board registration Dec–Jan, Matric/Inter exams Mar–May, O/A Level May–Jun & Oct–Nov, results Jul–Aug, admissions Aug–Sep, Ramadan) → suggest 6 weeks ahead and yearly refresh; (4) content-map coverage gaps vs landing pages with ≥10 tutors; (5) support/FAQ questions and report reasons.
- Each suggestion: proposed title, cluster, audience, language, priority score (demand × rank proximity × seasonality × gap age), and visible evidence lines. Actions: Generate draft (pre-filled brief), Snooze, Dismiss with reason (re-suggested only if evidence changes materially).
- Weekly Monday digest to managers: top 3 to publish + posts due for refresh. Nothing auto-publishes.
- Same engine emits "recruitment gap" cards (high searches, few tutors) routed to the import/bulk-onboarding manager.

## Instant search everywhere (owner, 1 Sep 2026)

- No search button anywhere on the platform. Every search bar (homepage/browse tutors, browse tuitions, admin member/tutor/payment searches, taxonomy pickers, blog) is a typeahead: results update as the user types.
- Behaviour: debounce ~250 ms, minimum 2 characters, cancel in-flight requests on new keystrokes, show a compact suggestion panel under the input with grouped results (Subjects / Levels, Cities & areas, Tutors, Tuition jobs — only groups with hits), keyboard navigation (↑ ↓ Enter Esc), "Show all results for '…'" as the last row, and the full results grid/list also refreshes live as the query changes.
- Server-side: one /api/search/suggest route backed by a Postgres function using trigram (pg_trgm) + prefix matching over tutor names/taglines, taxonomy names (incl. Urdu/Roman-Urdu aliases where present), cities/areas, and job titles; respects listing rules (only listed tutors, open jobs) and never returns contact fields. Results limited per group; rate-limited; anon-safe.
- Typo tolerance: trigram similarity threshold so "fizics" still finds Physics; common Roman-Urdu spellings mapped as aliases on taxonomy rows (alias table, admin-editable).
- Mobile: full-width panel, 44 px rows, no layout shift; the on-screen keyboard's "search" key selects the highlighted suggestion.
- Empty typed query shows recent searches (local, per device) and popular subjects for the user's city.
- Logging: search_performed events keep firing (feeds the T9 content queue).

## Register form — supersedes the earlier "Register / login form rules" label wording

- Role radios at the top read exactly: **Tutor** and **Parent / Institution**. Helper text under the second: "Parents, schools and academies looking for tutors." Institutions are ordinary parent accounts with identical rights and plans — no separate entity, role, label, or flow anywhere else in the platform.
- Everything else from the mobile-first signup section stands: full name, mobile number, password, optional email, consent checkbox; no city at signup.

## Mobile-first signup (owner, 1 Sep)

- /register: role radios "Tutor" and "Parent / Institution" (helper: "Parents, schools and academies looking for tutors"), full name, mobile number (Pakistani format, normalised to E.164), password, terms/consent checkbox. Email optional ("for receipts and reminders"). No city.
- Signup creates the auth user (synthetic internal email <msisdn>@users.tutormint.org when no email is given; the real email otherwise), profiles row, tutor_profiles for tutors, signs the user in immediately, and sends an OTP to the mobile.
- Gate: while profiles.phone_verified_at is NULL, proxy.ts redirects every /tutor/*, /parent/* and /admin/* request to /verify-phone (the only reachable authenticated page besides logout). Public pages stay public.
- /verify-phone: 6-digit input, resend with 60s cooldown, 5 attempts, change-number link. On success set phone_verified_at, log otp_verified, redirect straight to the role dashboard — never to /login.
- /login unchanged (mobile or email + password). /forgot-password: mobile → OTP → new password (email path stays for email-only accounts).
- Email confirmation applies only to accounts registered with an email and no mobile; mobile-verified accounts never see it.
- A real SMS provider is a hard go-live prerequisite; DEV_DEFAULT_OTP serves preview/dev only.

### As built (T-UI2) — the three places the spec had to be made precise

**The gate needs its own flag.** Written as `phone_verified_at is null` alone,
it would also catch every account that predates it: 21 of the 28 profiles that
existed had no verified number, including all nine parents and all five admin
accounts. `profiles.phone_gate_required` (migration 29, default false) records
what is actually true — this account was created under mobile-first signup —
so existing members, bulk-imported tutors (whose gate is the claim flow) and
email-invited staff are untouched. Backfilling `phone_verified_at = now()` was
rejected: that column feeds profile completion and the Verified badge, so it
would hand out verification nobody earned in order to route around a redirect.

**The gated list is enumerated, not prefixed.** `/tutor/*` cannot be gated as a
prefix because `/tutor/[slug]` is the public tutor profile and the platform's
main organic-search surface; gating it would put the marketing pages behind a
login. `/tutor/claim` is excluded for the same class of reason — an imported
tutor has to be able to reach it. The gate reads the profile only on those
paths, so public pages cost no extra query.

**OTP codes carry a purpose.** One table now serves "prove this number is
yours" and "reset a forgotten password while signed out", and both consume the
newest unconsumed code for a number. Without `phone_otps.purpose` a reset would
silently eat a pending verification code, and a code minted for one flow would
be spendable in the other. The dev bypass also now requires that a code was
actually requested — accepting it against an empty table was harmless when
every flow already needed a session, but for a signed-out reset it would have
meant anyone could reset any account on a preview deployment.

**Changing the number changes the login identifier.** An account registered
with no email signs in at `<msisdn>@users.tutormint.org`. The "wrong number?"
link on /verify-phone therefore moves the auth email with the number — and only
for synthetic addresses; a real one the member chose is never touched.
Otherwise a mistyped digit at signup is unrecoverable: the code goes to a
stranger's handset and the member is held on a page they can never pass.

**E.164, minus the plus.** `lib/phone.ts` has one canonical form,
`923001234567`, and the bulk import, /api/auth/login and now signup all derive
the synthetic email from that same function. Storing `+92...` instead would be
a second convention for one fact, which is exactly the drift lib/phone.ts was
written to prevent. `/api/auth/login` still resolves all three shapes a human
might type, and `formatPkMobile()` renders `0300 1234567` for display.

## T-UI1 — homepage restore + brand colour system (1 Sep 2026)

**The approved homepage was never in this repository.** `app/page.tsx` was
byte-identical on `origin/main` and `rebuild`, `git log --all -S"Middleman"` and
`-S"Degree-Verified"` returned nothing on any ref, and a live fetch of both
`tutormint.org` and `www.tutormint.org` returned the older "Find Verified &
Trusted Tutors FOREVER FREE" page with the white footer. So there was no commit
to bring across; `app/page.tsx` and `components/Footer.tsx` were rebuilt from
`design/reference/homepage.png`, with the reference's own pixels sampled to
confirm each element's intent before the brand tokens replaced them.

`design/reference/TutorMint-Brand-Colours.pdf` is likewise not in the repo. The
palette came from the owner's message; the two derived tokens (`tm-gold-ink`,
`tm-tint-gold`) and the four hover shades were forced by the contrast gate and
are documented where they are defined.

**The footer is one component.** `/about`, `/blog` and `/faq` each carried their
own stale copy, comment-labelled "Global Footer", predating
`components/Footer.tsx`; every page was rendering two footers, and the stale
ones still said "© 2026 TutorMint" rather than the legal entity. They are gone.

**Social links are environment-configured** (`SOCIAL_FACEBOOK`, `_INSTAGRAM`,
`_YOUTUBE`, `_X`, `_TIKTOK`). The icons exist in `public/`, but no real profile
URL exists anywhere in the repo, and a guessed handle sends members to a
stranger's account. An unset profile renders no icon.

**The footer reads env, not the database.** `getSupportContact()` goes through
the cookie-backed Supabase client, and a `cookies()` read in a component the
root layout renders makes every route in the app dynamic — including the static
legal pages. `supportContactFromEnv()` exists for that one reason; `/support`
still uses the app_settings-backed version.

## Deployment reality (owner, 1–2 Sep 2026)

- **Production serves the `rebuild` branch.** tutormint.org shows what is on `rebuild`, not `main`. A push to `rebuild` is a release to real visitors — there is no staging buffer. Treat every PR on this branch as production, and never run a data migration on it without a backup taken first.
- The mobile-first register form and OTP gate are already live to real visitors.
- Resolved and correct as built: the "Institution" mention lives in the FAQ only, and `no-store` on the phone-gate check is the intended trade.

This supersedes the observation in "T-UI1" below that a live fetch of tutormint.org returned the older homepage. That was true on 1 Sep, before `rebuild` began being served; the rest of the T-UI1 finding — that the approved design was never committed to this repository — still stands.

## Sequence to launch (owner, 2 Sep 2026)

1. Part 3 UI work — admin on brand, hero pill, conversion pass, upgrade sheet, legal identity + schema, banner and avatar fixes. (Instant search shipped in 4ccb1f1.)
2. Preview URL + `NEXT_PUBLIC_SITE_URL` set → partner testing.
3. T8b: SMS provider, seed-data cleanup, merge `rebuild` → `main`, Mumbai `ap-south-1` migration, CUIN and NTN filled into app_settings.

## Instant search — deliberate limits (T-Search, 4ccb1f1)

**As built. Under precedence rule 10 this beats the "Instant search everywhere" spec section above wherever the two differ.**

- `/admin/users` uses the typeahead with `suggest={false}`. The public index contains only listed tutors and open jobs, so it is blind to parents, staff, suspended accounts and unclaimed imports — the exact rows an admin opens that screen to find. A panel there would answer a different question from the one being asked. Admin tutor and payment searches follow the same rule.
- The blog index is not wired. There is no blog until T9; wire it when 9.3 ships.
- Aliases attach to a taxonomy slug, not a `taxonomy_master` id, so one alias row makes a subject findable at every level it exists at.
- `search_performed` is collapsed to one row per identical filter set per 60s, not one per keystroke. This is safe only because the free-text query is never in the payload.
- `lib/locations.ts` still drives the filter dropdowns while search derives places from live data. Two place lists exist on purpose — search must not suggest an empty city.
- **The homepage has no search bar and did not get one.** The spec section above lists "homepage/browse tutors" among the search surfaces, but the homepage is LOCKED and a new input is not among the permitted changes. Adding one needs an explicit owner instruction, not this rule.

## Open owner decisions (blocking launch)

- **SMS provider — undecided.** Twilio (card required, fast to set up) vs a Pakistani gateway (cheaper per message, slower to set up). Mobile signup on the live site cannot deliver codes until one exists. This is the hardest blocker.
- SMTP on the Supabase project — not configured; password-reset email cannot send.
- AssanPay — in negotiation.
- CUIN and NTN — placeholders in Terms and receipts awaiting real numbers.

All four are already described where they bite, and this list is the index rather than a fifth copy: the SMS prerequisite in "Auth & verification flows" and "Mobile-first signup", SMTP in "Auth & verification flows", "Admin, part 1 (T7a)" (staff invites) and the register/login form rules, AssanPay in the owner Q&A and "Payments — the adapter contract", and the two company numbers in "Legal entity". Fix one, check the others.

## One database (2 Sep 2026)

One Supabase project serves both preview and production. There is no separate dev database. Any script that writes must name its target and refuse production unless explicitly overridden. Migration 30 was applied to it during T-Search before this rule existed — additive only, no backup taken.

The mechanism is `scripts/target.ts`: `guardWrites()` announces the target, refuses production unless `ALLOW_SEED_ON_PRODUCTION=1` is set for that one invocation and the operator types the project ref, and refuses the override outright in a non-interactive shell. A dry run that writes nothing is allowed through — a guard that makes the safe path harder than the dangerous one gets worked around.

This replaces an inverted guard. `seed-dev.ts` and `seed-cleanup.ts` each hardcoded the live project's ref as `DEV_PROJECT_REF` and refused to run *unless the target matched it*, so `npm run seed:dev` was armed against production while reading as though it protected against exactly that. The full audit of every script under `scripts/`, and the backup taken on 2 Sep, are in `docs/STATE.md`.

## Brand rendering rules (owner, 2 Sep 2026)

- The brand is written "TutorMint" — one word, no space — in every surface: UI, wordmarks, social banners, emails, captions, receipts, schema. "Tutor Mint" (two words) appears ONLY inside the legal name "Tutor Mint (Pvt) Ltd" in legal contexts (footer copyright, Terms, Privacy, receipts, merchant name).
- The admin panel follows the same brand-token-only colour rule as the public site. No non-token colours anywhere, including admin.
- Homepage hero pill text colour: tm-navy (#151E6B). This is an explicit owner authorisation dated 2 Sep 2026 and is the only permitted change to the locked homepage in this pass — recorded in the "Homepage is LOCKED" section above so it is not reverted later.

### As built (2 Sep 2026) — what the admin brand pass actually found

The admin panel was already almost entirely on tokens: Suspend was `tm-red`, Warn was `tm-gold-ink` on `tm-tint-gold`, headings were `tm-navy`, and there was no raw hex anywhere in `app/` or `components/`. Three real defects came out of auditing it rather than assuming:

- **`text-tm-red` on `bg-tm-black` is 3.11:1 and fails AA.** The admin header wordmark rendered "Mint" in brand red on the black bar. On a dark surface the brand's readable member is `tm-mint` (13.55:1), which is what the footer already does. Red is a light-surface colour.
- **`text-gray-400` is 2.54:1 on white and 2.43:1 on the page ground — it can never be text.** It was carrying empty-state copy, table headers, timestamps and field labels in 140 places, all of them small text, so the large-text allowance did not apply either. Replaced with `text-gray-500` (4.83:1 / 4.62:1). The contrast script now fails the build if `text-gray-400` reappears, because a rule that is only in prose gets re-introduced by the next person who wants a lighter grey.
- Modal scrims used `bg-black/50` rather than `bg-tm-black/50`. Cosmetically identical, but "no non-token colours anywhere" is easier to enforce than to argue about.

`npm run check:contrast` now covers the admin pairs explicitly and greps for the forbidden grey. Admin screens were audited at 360 and 1280: no horizontal scroll on any of them.

## Homepage — second owner authorisation (2 Sep 2026)

- A Login button in the top-right of the header is authorised. When signed in it becomes a Dashboard button routing by role (tutor / parent / admin). This and the hero-pill navy are the only permitted changes to the locked homepage; layout, copy and the two large buttons stay as approved.

## Global UI rules (owner, 2 Sep 2026)

- Breadcrumbs on every page except the homepage, using BreadcrumbList schema, so a member can always get back one level or to the homepage.
- Job cards show the posting parent's avatar. Avatars everywhere fall back to an initials disc in brand colours — never a solid placeholder circle. Parent contact details remain hidden; the picture is not contact information.

### As built (header, breadcrumbs, avatars, banners) — 3 Sep 2026

**The header now costs every page its static prerendering, and that is the
trade the "no flicker" requirement buys.** `components/Navbar.tsx` was a client
component that fetched the user in `useEffect`, so every page painted "signed
out" and corrected itself a beat later — on a header whose whole job is to say
Login or Dashboard, that flash tells a signed-in member they are signed out. It
is a server component now, and a `cookies()` read in something the root layout
renders opts the whole application out of static generation: 17 routes were
`○ Static` before this change and 2 are now (`robots.txt` and `sitemap.xml`).

Two things make that acceptable rather than a regression, and both are worth
knowing before anyone "fixes" it:

- `proxy.ts` already calls `supabase.auth.getUser()` on every non-asset
  request, homepage included. The auth round trip was being paid on each of
  those hits already; what is new is an RSC render of pages that are small.
- `getSessionUser()` is wrapped in React's `cache()`, so the header, the area
  layout and the page share **one** auth call and one `profiles` read per
  request — a dashboard page used to make that call twice on its own. An
  anonymous visitor stops at `getUser()` returning null and never reads
  `profiles` at all.

The way to have both is `cacheComponents` (Next 16's PPR) with the header in a
Suspense boundary: a static shell with a dynamic hole. That flag changes caching
semantics for the entire application and belongs in its own change, on the T8b
list — not bundled into a header button.

**The homepage logo is no longer centred on mobile.** It was `mx-auto sm:mx-0`,
which only works when nothing sits to its right. A top-right button and a
centred logo cannot both be true; the button is the authorised change, so the
logo is left-aligned at every width. Layout, copy and the two large buttons are
untouched.

**Breadcrumbs come from three places, not forty-five.** Most pages pass their
own trail, because the last crumb is usually a real thing with a name — a
tutor, a job, a conversation. `/terms` and `/privacy` get theirs from
`components/LegalDoc.tsx`, and **all of admin from `app/admin/layout.tsx`** via
`components/admin/AdminBreadcrumbs.tsx`, which derives the trail from the path.
Admin earns the exception: its sections are a fixed list with fixed labels,
seven of its screens are one-line delegations to a client component with no
markup of their own, and a screen added next month would otherwise ship without
one.

Home is prepended by the component, never passed in, so no caller can ship a
trail with no way back to the start. Below 640px the middle of the trail
collapses to an ellipsis, leaving Home, the immediate parent and the current
page — the two destinations the rule asks for — and the current label truncates
rather than wrapping. The JSON-LD always carries every level regardless of what
is displayed.

**Nineteen bespoke back links were replaced, not supplemented.** Two ways back
to the same page is one more than anyone needs, and only one of them was in the
`BreadcrumbList`. `/tutor/dashboard/settings` had a hand-rolled trail with no
Home entry and no structured data.

**Three pages were rendering two sticky headers.** `/about`, `/blog` and `/faq`
each carried their own wordmark bar at `top-0`, the same duplication T-UI1 found
and removed for the footer; with a real header above them they stacked. The
FAQ's two calls to action were kept and moved into the page — `/tutor/register`
is only still routed at all on the grounds that this page links to it — and its
"Browse Tutors" button, which pointed at `/parent/dashboard`, now points at
`/browse/tutors`.

**`lib/siteUrl.ts` exists because three things have to agree**: `metadataBase`,
the absolute URLs in `BreadcrumbList`, and the links in outgoing email. A
BreadcrumbList whose items sit on a different host from the page's own canonical
is not read as that page's trail. It resolves to **www**, which corrected
`lib/notify/templates.ts`: it defaulted to the apex, and `next.config.ts`
permanently redirects the apex to www, so every link in every email was going
through a redirect hop.

**`components/Avatar.tsx` is the only avatar.** The fallback is initials on a
brand tint, picked deterministically from the seed so the same person keeps the
same colour on every screen. The colour carries no meaning — not a role, not a
plan, not a status; it exists so a list of avatars is scannable. Three real
defects came out of consolidating rather than assuming:

- The admin tutor queue's fallback was an `api.dicebear.com` URL. It sent every
  tutor's real name to a third party as a query string, and `img-src` in our own
  CSP does not name that host — so in production it rendered nothing at all.
- `/tutor/dashboard/settings` rendered `<img src="">` when a tutor had no photo,
  because `profileImage` starts as `''`. Every browser draws that as a broken
  image, on the screen a tutor opens to add their photo.
- The packages preview used a solid navy disc with a single white letter, which
  matched no other avatar on the site.

The four tint/ink pairs live in `lib/brand.ts` as `AVATAR_TINTS`, not in the
component, because `next/og` needs them as literal hex while React needs
Tailwind class names. Splitting them would mean a tutor whose avatar is green on
the site and navy on the social post we publish about them.

**Job cards show the parent's avatar**, and `lib/jobFeed.ts`'s service-role
lookup now returns it alongside first name, badges and can-hire. A photo is not
contact information — it cannot be dialled, messaged or looked up — and phone,
WhatsApp and email stay behind `canViewContact` exactly as before.

**The social banner was publishing the legal name.** "Tutor" and "Mint" were
siblings of a flex row with `gap: 12`, which put a 12px space between them: every
post we generated read **"Tutor Mint"**, the two-word form reserved for
`Tutor Mint (Pvt) Ltd` in legal contexts. Also fixed there: the rating used the
`★` glyph, which satori renders with the fonts it is given and which is not in a
plain sans-serif face — it came out as a blank box or vanished depending on the
host, so it is an inline SVG path now; and the avatar fallback was a grey disc
with one red letter, now the shared initials disc.

**Making satori render one word took more than deleting a gap.** Satori
inserts a word-space between adjacent text runs — measured at 12px for the 44px
face, about 0.27em. Removing the row's `gap: 12` changed the output by zero
bytes; so did nesting the two halves in their own row, `display: flex` on each,
and `<span>`. A single text node renders correctly but cannot carry two
colours, so the join is a negative margin of one space, scaled with the type and
verified against a single-run control at all three formats. **If the font ever
changes, re-measure** — the constant is that font's space advance, not a magic
number. The measurement is `scratchpad/inkgap.py`'s method: decode the PNG and
find the last dark column and the first red one.

**The banner render is now its own file** (`app/api/admin/social/image/render.tsx`).
The route decides who may generate a post and looks the tutor up; the render
decides what the picture looks like. They were one function, which meant the only
way to see a layout change was to sign in as an admin with a live listed tutor to
point at — so in practice nobody looked at the three formats side by side, and
that is how a 12px gap sat in the wordmark publishing the legal name on every
post.

**The dark template had never been looked at.** Rendering it revealed the
Premium badge drawn as `tm-navy` on the `tm-navy` ground: no pill, just floating
white text, which reads as a missing badge rather than a styled one. On a navy
ground it now inverts to navy ink on white, keeping navy as the colour that
identifies Premium either way.

**`api.dicebear.com` is out of the CSP** now that nothing requests it.

**One deviation from the instruction, deliberately.** The wordmark rule given
was "Tutor in tm-black, Mint in tm-red", and that is exactly what the light
template does. On the dark `bold` template it cannot: `tm-black` is invisible on
`tm-navy` and `tm-red` is 2.2:1 against it. That template uses the pairing the
footer and the admin header already use on dark surfaces — white with `tm-mint`
— which is the same rule the 2 Sep brand pass applied when it found
`text-tm-red` on `bg-tm-black` failing AA. For the same reason the rating text
is `tm-gold-ink` on light and plain `tm-gold` on navy; the star itself is filled
gold on both. The site's own auth-card wordmarks were left on `tm-navy` rather
than retrofitted to `tm-black`: both clear AA, and changing eight files on an
inference is not what was asked.

## Homepage — third owner authorisation (3 Sep 2026)

- Vertical spacing and footer density on the locked homepage are authorised for change. Layout order, copy and the two large buttons stay as approved. Simplicity and minimal UI is the platform's stated philosophy — dead space, wasted scroll and heavy chrome are defects, not neutral choices, on every page.

## No pagination (owner, 3 Sep 2026)

- Lists use infinite scroll, never numbered pagination. On the public browse pages the first page must still be server-rendered and `?page=N` URLs must still resolve server-side, because those pages are the platform's organic-search surface.

### As built (infinite scroll, homepage spacing, compact footer) — 3 Sep 2026

**Two access patterns, one ordering.** A scrolling list and a crawlable list
want opposite things from a database, and the requirement is both at once. So
every converted list keeps `p_offset` AND gains a keyset cursor, and the caller
picks by which question it is answering:

- **`?page=N`** — a crawler following `rel=next`, or a shared link, arriving
  cold with no row to continue from. OFFSET is the only thing that can answer
  that, and it is correct for it: a crawler reads one page and leaves.
- **Load more** — a reader who already holds the last row on their screen.
  OFFSET is wrong here. Between two requests a tutor is verified, a rating
  moves, a plan lapses, a job closes; every row above the window shifts, and the
  reader sees the same tutor twice or never sees one at all.

Migration 32 rewrote `rank_tutors()` for this. It now **returns** every
component of its own sort key — tier, location score, rounded score and the
daily rotation hash — because a cursor the caller cannot see is a cursor the
caller cannot send back. The hash is what makes the key TOTAL: md5 of a uuid is
unique, so no two rows compare equal and nothing can be straddled. The same
reasoning added `id` as a tiebreaker to the jobs, audit and member queries:
`created_at` alone is not unique, and two rows in the same millisecond are
ordinary on a busy board or an admin working a queue.

**`count(*) over ()` had to go.** It was correct while the only narrowing was
LIMIT/OFFSET — window functions run before LIMIT — but it silently starts
counting "rows left below the cursor" the moment a WHERE is added, so page two
would have reported a smaller directory than page one. The total is now a
subquery over the eligible set, taken before the cursor applies.

**The Load more button is not decoration.** An IntersectionObserver fires on
scroll, and a keyboard or screen-reader user may never generate one — for them a
scroll-only list simply ends early with nothing saying so. The button is the
accessible path, the observer is the convenience, and both call the same loader.
The end of a list is stated in words: running out of content with no message is
indistinguishable from a list that broke.

**Scroll restoration is sessionStorage, and that is allowed here.** CLAUDE.md
rule 2 forbids localStorage/sessionStorage for login or role state; a list's
scroll offset and its already-loaded rows are neither. Keyed by the filter set,
so returning to a *different* search never restores the previous one's rows, and
skipped entirely above 400KB rather than filling the quota and breaking every
list in the tab.

**Ads had to grow a client path or quietly stop being delivered.** `AdSlot` is
an async server component and cannot render inside the client list, so without
`/api/ads/inline` the second and later windows of /browse would carry no ads at
all — halving an advertiser's delivered impressions on the page they bought. The
two things that make the numbers reportable stay on the server: the ad is
**chosen** there (weighted rotation, expiry enforced by RLS) and the impression
is **recorded** there. `ad_events` still has no INSERT policy for anyone. The
viewer's role comes from the session, never the query string, so nobody can
label their own impressions as a tutor's. `components/ads/AdView.tsx` is the
shared markup, so the Sponsored/TutorMint label rule has one implementation.

**What was converted, and what was not.** Three lists had real pagination and
all three are done: `/browse/tutors`, `/browse/tuitions`, `/admin/audit`.
`/admin/users` had no pagination but a hard cap whose own heading read "First
100 matches" — truncated and honest about it, which for a directory is useless,
so it scrolls too. **Still capped, and not converted in this pass:**
`/admin/tutors`, `/admin/parents`, `/admin/payments`, `/admin/reports`,
`/admin/ads`, `/admin/social`, `/admin/plans` (100–200 rows each) and the member
timeline on `/admin/users/[id]` (300). None is near its cap on 28 accounts, and
each needs its own cursor key and route; the mechanism is now in place, so they
are mechanical. `listThreads()` and the applicant list have no cap and no paging
at all — there is nothing there to replace.

**The homepage was not short of space above the fold; it was spending it.** Both
buttons already fitted at 390x844 and 1280x800 — the second finished 79px short
of a laptop's bottom edge — so the fix was rhythm, not rescue. Padding and
margins only: no copy, no order, no type size, no button changed. The document
went from 2150px to 1488px at 390 wide.

**The footer was 1376px tall on a phone** — taller than the viewport it sat
under, and 64% of the whole homepage document. One column, four link lists
stacked into a strip, each link a 44px touch target. They sit in a 2-column grid
below `sm` now (`lg:contents` hands them back to the approved 5-column desktop
layout untouched), which halves the height **without shrinking a single tap
target**: 1376px → 802px on mobile, 397px → 327px on desktop. Every link, the
social icons and the legal line are unchanged.

**Browse results start 112px higher on a laptop.** The desktop filter panel was
three rows of fields; at `lg` the three groups now flatten into one five-column
grid via `contents`, so nine filters take two rows. Below `lg` they keep their
own rows, because the cascade reads as a cascade — category, then level, then
subject — and flattening it on a phone would put "Subject" beside "City". First
result at 1280x800: 557px → 445px.

**The solid-colour discs on /browse/tutors are seed data, not a fallback
regression.** Five of the six listed tutors have a real `avatar_url` pointing at
a flat PNG the seed script uploaded, so `Avatar` correctly renders the photo it
was given. Bilal Ahmad, who has none, correctly renders "BA" on a brand tint.
Seed-data cleanup is already on the T8b list.

## Navigation and notifications (3 Sep 2026)

- The header's signed-in control is an avatar + name dropdown whose items come from `profiles.role`. One source of truth, `lib/userMenu.ts` — never two hand-maintained copies for desktop and mobile.
- A notification bell in the header carries the unread count from `notifications`, opens a panel of recent items, and marks read on open. `/account/notifications` is the full list with filters.
- Notifications are never manufactured. Every row corresponds to a real event; a missing event type is fixed by adding the `notify()` call, not by writing rows.

### As built

**Two finished features were unreachable, and that was the whole point.**
`/parent/dashboard/messages` and `/tutor/dashboard/messages` were built, wired
and linked from nothing — reachable only by typing the URL. `notifications` held
**49 real rows, all unread**, written since T5 by applications, jobs, messaging,
demos, payments and moderation, with no screen in the product that could display
one. Neither needed building; both needed a way in.

**The menu is plain data resolved on the server.** `lib/userMenu.ts` returns
`{label, href, icon}` where `icon` is a STRING key, because the header is a
server component and every prop crossing to the client has to survive
serialisation. That file also imports nothing server-only: `SCREEN_ACCESS` lives
in `lib/adminAuth.ts`, which reaches for `next/navigation` and the cookie-backed
client and cannot be bundled for the browser — so the header filters the admin
screens and passes the result in. A manager's menu therefore shows Tutor
moderation, Parent verification, Payments, Reports and Members, and **no Team
entry**, because `SCREEN_ACCESS.team` is owner-only. The menu must never offer a
door that is locked.

**`OR is_admin()` meant RLS could not answer "my notifications".** The SELECT
policy is `(user_id = auth.uid()) OR is_admin()`, added so admin screens can
investigate an account. Leaning on it put **another member's message
notifications in a manager's bell, with their own unread count**, on the first
test run — 24 unread for an account with none. Every read in
`lib/notificationFeed.ts` now filters `user_id` explicitly and the policy is the
backstop it was written to be. This is CLAUDE.md's own rule ("filter them in the
route or the RLS policy, don't just hide them in JSX") in the direction people
forget: the policy was *broader* than the feature wanted.

**The panel marks read only what it displayed.** The route returns 20 and the
panel renders 8; marking all 20 would clear a dozen notifications nobody saw.
One `PANEL_LIMIT` drives both, because two numbers is how they diverge. And
"mark everything unread" was rejected outright: a notification that lands while
the panel is open is exactly the one most likely to say somebody hired you.

**The verification decision was the missing `notify()`.** Both queues —
`/api/admin/tutors/moderate` and `/api/admin/parents/verify` — sent an email and
wrote `logActivity`, and put nothing in the product. So the single most
consequential message the platform sends, "you are verified" or "here is why you
were not", was the one a member could not find by opening the site. Two kinds
added (`verification_approved`, `verification_rejected`); no migration, because
`notifications.kind` is `text` with no CHECK constraint.

**Mark-read is deliberately NOT in `logActivity`, and that is a departure from
rule 11.** It is a read receipt, not a state change: logging it would add a
timeline row every time somebody opens the bell, and a timeline that records
opening the bell is a timeline nobody can read the hires out of. The rule exists
for accountability over consequential changes. Flagged rather than done
silently — overrule it and it is one line.

**`/account/notifications` was the email settings page.** The list took that URL
because it is what a member clicking "Notifications" is looking for; settings
moved to `/account/notifications/settings`, and every inbound link moved with
it — two in `/privacy` and the footer of every outgoing email in
`lib/notify/templates.ts`. A settings link that lands on a list is a link that
has stopped working.

**Empty states name the next real step, per role.** A tutor is told to complete
their profile, a parent to browse tutors, an admin that their own account is
quiet and the queues are in the admin panel — telling a manager that
"notifications arrive when a tutor applies to your job" describes somebody
else's product to them. A *filtered* empty is a different situation from an
empty inbox, and offers clearing the filter instead. The two message-list empty
states already did this work and were left alone.

**Timestamps carry an explicit `timeZone`.** `toLocaleString('en-PK')` with no
zone formats in the runtime's: UTC on the server, Asia/Karachi in the browser —
different text for the same instant, which is React error #418. That bug is live
on `/parent/dashboard` today via `DemoInbox`; the new components do not repeat
it.

### Homepage and footer, second pass

The first pass stopped short. The two hero buttons were `min-h-[176px]` with the
icon pinned top-left and the label bottom-left: **350px of vertical space to say
eight words.** Icon and label are one row now and the height follows the
content. The footer's separate copyright band was merged into the single band,
line height and column gaps tightened.

**At 1280x800 the whole page including the footer now fits with no scroll:
document height 800px against an 800px viewport.** It was 1214px before any of
this work and 1040px after the first pass. At 390x844 the document is 1272px
(from 2150px), with the pill, HIRE, headline, subline and both buttons above the
fold; the remaining scroll is footer, which cannot compress further without
dropping below 44px touch targets on thirteen links. No copy changed and no type
size was reduced — every change is a padding, a margin or a flex direction.

## `/blog` is withdrawn until 9.3 (3 Sep 2026)

`app/blog/` rendered two hardcoded articles — "Why Camera Verification Matters
for Home Tutors" and "Top 5 Tips for Preparing Your Child for O/A-Level Exams",
both with invented August 2026 dates and neither corresponding to anything
anybody wrote. That is mock data on a live public page, which rule 7 forbids,
and it was worse than a placeholder: it made a factual claim about how the
platform verifies tutors ("live video verification") on a page a parent could
reach from the footer of every screen.

The route is deleted, so `/blog` now 404s through the branded not-found page.
Its footer link and its `sitemap.ts` entry are gone with it, so nothing on the
site points at it and nothing invites a crawler to.

**It returns when 9.3 ships**, not before. The blog CMS in that task brings
`posts`, `post_revisions`, `/admin/blog`, and a `/blog` index reading real rows;
at that point restore the footer link and the sitemap entry in the same change
that makes the route real. Until then a 404 is the honest answer — an empty
"coming soon" page is another thing to keep true, and a redirect would send
somebody looking for articles to a page that has none.

This is deliberately NOT covered by the "redirect stubs that must survive" rule
above. That rule protects `/tutor/register` and the two login stubs because live
WhatsApp referral links point at them; no such link points at `/blog`.

## Tutor dashboard band order — resolved, do not re-litigate (3 Sep 2026)

Two rules in this document met head-on and both are still true as written:

* the conversion rules say the profile-view teaser sits at the **top** of a free
  tutor's dashboard, because it is the primary upsell surface;
* the dashboard restructure says **NEEDS YOU** is the first band and always
  renders, even when it is empty.

The resolved order is **NEEDS YOU first, the profile-view teaser immediately
below it**, and it is what `app/tutor/dashboard/page.tsx` does.

The reasoning, so it is not reopened: NEEDS YOU is short — one line per item —
and for a free tutor the item it almost always holds is "your profile is N%
complete, parents cannot find you". That is the *same argument* the teaser
makes, except actionable, and it is the thing that has to be fixed before the
teaser's promise can pay off at all. The teaser keeps the highest position any
band can have below it, which is as close to the letter of the conversion rule
as the two allow.

Neither rule was edited to fit. If the owner would rather have the teaser
literally first, that is a one-line move in that file — but it needs to be an
instruction, because it silently costs the blocking item its position.

## Landing pages, as built (T9.1, 4 Sep 2026)

City × subject landing pages — `/tutors/[city]/[subject]` and
`/tuitions/[city]/[subject]` — are how the directory wins search: one page per
real combination, built from real data. What was decided in building them:

- **The threshold is one constant.** `LANDING_THRESHOLD = 3` in `lib/landing.ts`.
  A page exists only where at least three listed tutors (or open tuitions) share
  the combination; below it the route is a 404 and the page is absent from the
  sitemap. The page, the sitemap, the admin view and the link helper all read
  that one number — they cannot disagree about where a page exists.

- **The enumerator is the `landing_combinations` view** (migration 48): listed-
  tutor and open-tuition counts per (city, master_id), a `security_invoker`
  view so anon sees only listed tutors and open jobs — counts, no personal data.
  `lib/landing.ts` maps master_id ↔ a subject slug derived from the level+subject
  display names (so the URL and the H1 are the same words) and city ↔
  `citySegment()`.

- **No two pages share a paragraph.** Every visible string is built from the
  combination's own numbers — count, the fee/budget band actually present, the
  modes offered, the areas represented — as a sentence, not a stat row
  (`buildIntro`). The title/description come from the 9.2 templates with the
  real count in the lead. A template that produced the same paragraph on two
  pages would defeat the whole point; the intro is data or it is nothing.

- **Revalidation.** The combination set is cached under the `landing` tag
  (`unstable_cache`, revalidate every 3 hours). It is revalidated on demand —
  `revalidateLanding()` → `revalidateTag('landing', 'max')` — whenever a listing
  changes that can open or close a page: a tutor crossing 100% or a moderation
  decision (`recomputeCompletion`, the moderation route, `goLive`), and a
  tuition opening or closing (`createJob`, `closeJob`, `hireApplicant`). The
  ROUTES are dynamic, not fully static ISR: the ranked list runs through the
  cookie-scoped client and `rank_tutors` rotates daily on purpose, so the page
  re-renders per request while the combination set — what decides existence, the
  sitemap and the link helper — is the ISR-cached, on-demand-revalidated part.

- **Preview mode is honoured through the existing single flag.** While
  `NEXT_PUBLIC_PREVIEW_MODE` is on, `app/layout.tsx` sets robots noindex on every
  page (landing pages included) and `app/sitemap.ts` withholds them; when it is
  off, the sitemap lists every live landing page once. Nothing landing-specific
  was added to the preview mechanism.

- **Landing pages are the canonical target for subject and city links.** A
  subject mention anywhere — tutor profiles, tutor and job cards, the tuition
  detail — links to the landing page when it exists and falls back to the browse
  filter when it does not. One helper decides: `getLandingLinker()` in
  `lib/landing.ts`, wired into the card data layer (`browseTutors`'
  `withSubjectLinks`, `jobFeed`'s `decorate` attach a computed `href` to each
  `subject_links` entry) and the two server profile/detail pages. Nothing links
  to a page that is not there. City-only mentions (a bare `?city=`, the FAQ city
  links) have no landing to point at — there are no city-only landing pages —
  and stay on the browse filter; the browse filter bars remain the browse
  controls, not landing links.

- **No ads on landing pages.** CLAUDE.md permits exactly three ad placements;
  a landing page is not one. The ad-injecting `MoreTutors`/`MoreJobs` are
  deliberately not reused — `components/landing/MoreLanding*.tsx` render the same
  cards from the same endpoints without ads.

- **`/admin/seo/landing`** (owner/manager, read-only) lists every live page with
  its count and sitemap status, and the combinations sitting one short of the
  threshold — where recruiting one more tutor opens a page. It reads the view
  uncached, so an admin sees the true current counts.

- **The tuitions landing shares the tuition-detail route.** Next forbids two
  param names at one position, so `/tuitions/[city]/[subject]` cannot be its own
  route beside `/tuitions/[city]/[slug]`. The detail route checks whether the
  segment is a known subject slug (a landing) or a tuition `public_slug` (a
  detail); the namespaces do not collide because a `public_slug` always carries
  a hash suffix. The tutors landing is a clean new route (`/tutors/` is plural,
  distinct from `/tutor/[slug]`).

## Preview mode — comes OFF before launch (3 Sep 2026)

The whole site is `noindex` and `robots.txt` disallows every crawler, and a
quiet strip under the header tells visitors the platform is in preview while
tutors are being onboarded.

**Why.** The public directory is currently almost entirely seed accounts with
invented ratings, invented fees and tutors who will never reply. Letting Google
index those now makes them the pages that rank later, and the first real tutor
to finish a profile would compete with a fixture for their own name. Ranking is
slow to earn and slow to correct; not being indexed for a few weeks costs
nothing that cannot be recovered.

**One flag.** `NEXT_PUBLIC_PREVIEW_MODE`, read only through `lib/preview.ts`,
and only in three places: the `robots` metadata in `app/layout.tsx`,
`app/robots.ts`, and `components/PreviewBanner.tsx`. Turning it off is setting
the variable to `false` in Vercel and redeploying. Nothing else changes and
nothing has to be found first — that is the whole reason the condition is not
scattered.

**It defaults ON.** An unset variable means preview. Forgetting to turn it off
costs some indexing time; forgetting to turn it *on* means Google indexes the
fixtures, which is the expensive direction. It has to be switched off
deliberately, by somebody who has looked at the directory.

**`robots.ts` also withholds the sitemap while preview is on.** Offering a map
of pages we have just asked nobody to crawl is a mixed signal, and some
crawlers weight the sitemap more heavily than the disallow.

**T8b GATE.** Preview mode comes off only when real, verified tutors are listed
— not when the code is ready, and not as part of a deploy that happens to be
going out. It belongs with Search Console and the Business Profile in T8b,
because submitting a sitemap and being `noindex` at the same time is the
contradiction that wastes the launch.

## The seed cast is a fixed cast, and it is asserted (4 Sep 2026)

The demo accounts are a *cast*: each `seed+<role/plan>-<name>` is named for the
role and plan it demonstrates, so an evidence screenshot lands on the right kind
of account. The canonical definition is `scripts/seedCast.ts`; the readable copy
with the shared password is `docs/SEED_CAST.md`.

**Any evidence step that changes a seed account's plan, status or completion
restores it in the same run, and asserts the restore.** This is a rule, not a
hope: the cast drifts precisely because a run flips an account to Featured to
photograph a Featured surface and either forgets to restore it or restores it to
the wrong baseline. On 4 Sep 2026, five of nine cast members had drifted this
way — two free tutors carrying Premium, the Premium and Verified tutors both on
Featured, a "verified, no plan" parent holding parent_featured, an "unverified"
parent with an approved CNIC. The residue of earlier evidence runs, every one of
them a restore that did not happen or went to the wrong place.

Two tools hold the line, and both must stay green:

- `npm run reset:seedcast` (`scripts/reset-seed-cast.ts`) reports drift against
  the cast and, with `--apply`, puts every account back. Idempotent. It never
  writes `profile_completion` — completion is derived, and forcing a number is
  the fabrication trap; a cast member below its expected completion is warned,
  not papered over.
- `npm run smoke` (`scripts/smoke.ts`) creates one tutor and one parent through
  the real signup API, deletes them, and asserts the cast snapshot is identical
  before and after. Creating a member must never touch a seed row; a drift fails
  the run.

Badges follow the cast: a listed tutor with a plan shows the plan's badges; a
free tutor at 100% is listed with **no** badge; a paid plan on an unlisted tutor
shows none (see the badge/listing rule).

## A badge means LISTED, and the plan month starts at go-live (4 Sep 2026)

**A paid plan alone never draws a badge.** A tutor's badge appears only when
they are LISTED — the `tutor_directory` rule: 100% complete, not suspended,
verification not rejected/suspended, and claimed if imported. The gate is one
pure function, `tutorListed()` in `lib/planBadges.ts`; the public surfaces
(profile, browse, social) are listed by construction because they read views
that encode the rule, and the tutor's own dashboard reads `ent.listed` from
`getEntitlements`, which computes it the same way. Before this, the dashboard
gated the badge on completion alone, so a tutor at 100% but delisted (e.g.
rejected) with a plan wrongly saw a badge on their own dashboard.

An unlisted tutor who has a plan (active on a delisted profile, or paused) sees,
in the identity block: **"&lt;Plan&gt; plan active · your badge appears when your
profile reaches 100%."** — so the missing badge explains itself.

**The plan month starts the day the tutor goes live, not the day they pay.** A
tutor who buys while under 100% gets an *activated-but-paused* subscription
(`subscriptions.status = 'paused'`, `expires_at` NULL — no clock). It confers no
powers and no badge. `lib/payments/goLive.ts` `activatePausedIfListed()` flips
it to active with a fresh 30-day window the day the tutor becomes listed, and is
called from the two choke points where listing can change:
`recomputeCompletion()` (reaching 100%) and the admin tutor-moderation approve.
`getEntitlements` treats a paused sub as no plan (powers off) but surfaces
`planPaused`/`pausedPlanName` for the dashboard; the expiry sweep already filters
`status='active'`, so it leaves paused rows alone. The packages page and checkout
carry the line **"Your month starts the day you go live."**

**Under 100%, buying is never hard-blocked.** The upgrade sheet, for a tutor
under 100%, leads with *"Your profile is N% complete. Your badge and listing
start the moment you reach 100%."* — **Finish profile first** as the primary
button and **Buy anyway** as the secondary (`Gate.secondary`, built in
`lib/gate.ts`). The plan card stays, so buying early is a choice, not a wall.

## Seed data reaching real visitors (3 Sep 2026)

Three defects on the public board, repaired in migration 34 — a data repair, in
the ledger so it is reviewable, idempotent, and scoped so it cannot touch a real
member's row. **No seed account was deleted or deactivated**: the directory
stays populated until the owner says otherwise.

- Four open tuitions ended their description "Seeded row for development.", and
  four more had a description of the single character `x`.
- **The Finance chip on an O Level Physics post was one bad row, not a broken
  join.** `decorate()` reads `job_subjects` and resolves through
  `taxonomy_master` correctly; the row pointed at `master_id 504`
  (`bs-4-years-semester-1-8` / `finance`) while both its siblings pointed at
  `249` (`igcse-o-levels` / `physics`) and always rendered right. Worth
  recording because "every card is wrong" and "one row is wrong" are very
  different bugs and the symptom looks identical.
- Six seed tutors had a 600×400 PNG of one flat colour — `#0F172A` and
  `#D60008`, both retired in the brand pass — which read as broken images on
  `/browse/tutors`. Cleared, so `components/Avatar` falls back to initials.
  Scoped by `email like 'seed+%'`: the three real members with pictures store
  them as base64 `data:` URIs, so a rule written about the image file would have
  caught the wrong rows.

## The subject picker showed a grade it had not chosen (3 Sep 2026)

**The posting blocker, diagnosed.** Subject search on `/parent/dashboard/post-job`
returned nothing: Level "Middle / Lower Secondary", Grade "Grade 6 to 8", type
"math", empty box. It was **none of the three obvious causes** — the taxonomy
has 54 subject rows at that grade including Mathematics (`master_id 108`), all
896 `taxonomy_master` rows reach the browser uncapped, and the filter was
already case-insensitive substring matching.

**It was a DOM/React divergence in a listbox.** `<select size={4}>` is a
listbox, and a listbox whose React `value` is `''` matches no `<option>` — so
the browser selects and *renders* the first one anyway. Choosing a level called
`setSelectedGrade('')`, which left every parent looking at a screen showing a
level AND a grade selected while the component believed no grade was chosen at
all. `availableSubjects` was therefore `[]`, and typing filtered an empty array
and stayed empty. It happened on a plain page load too: the mount effect picks
the first level and nothing picked a grade.

No `change` event fires when the browser does this — nothing user-initiated
happened — so React never finds out on its own. The sync has to be explicit,
and it selects the first grade rather than clearing the display: the component
already auto-picks the first LEVEL, so a parent has every reason to read the
grade beside it as chosen too.

**The subject box is never silently empty now.** A blank bordered box is
indistinguishable from a broken one, which is exactly what this was. Each empty
case names itself: no grade yet, a level-leaf with no subject list, or
`No subjects match "math" at Grade 6 to 8 — try another spelling or grade.`

**The quota line leaked the real cap.** "98 of Unlimited posts left this month"
counted down against the 100 that CLAUDE.md sells as Unlimited. A plan whose
displayed quota IS a number counts down honestly; one advertising Unlimited
says Unlimited and nothing else. The out-of-quota panel had the same leak
(`ent.quota`, the true figure) and now shows `displayedQuota`. The cap is still
enforced, and admin still sees the real numbers on `/admin/payments/usage`.

## Relative times go through `<TimeAgo>` (3 Sep 2026)

The intermittent React #418 on `/browse/tuitions` was `postedAgo()` reading
`Date.now()` at both server render and hydration. Whenever the gap crosses a
boundary — 59m to 1h, 23h to 1d — the two strings differ. Intermittent by
construction, which is why it appeared once and not in the two sweeps after.

`components/TimeAgo.tsx` renders the **absolute date** on the server and in the
browser's first render — deterministic, because `formatDate` pins the timezone
— and swaps to the relative form in an effect, when there is no server output
left to disagree with. It also re-ticks every minute, so a list left open stops
saying "2m ago" for an hour.

**Four client components had the same bug**, three of them with their own
private copy of the arithmetic: `JobCard`, `NotificationBell`,
`ConversationList`, `ActivityCard`. All four go through the one component now.
Any new relative timestamp must too — `Date.now()` in a client component's
render is the bug, not the formatting.

## Every member name is a link (3 Sep 2026)

Tutor names go to `/tutor/[slug]`. Parent names go to `/parent/[id]`, a new
minimal public page: name, avatar, badges, member since, open tuitions. It is
what a tutor sees before spending one of ten monthly applications.

**What is deliberately not on it**: phone, WhatsApp, email, address, CNIC — and
the children. The first group is what a Featured plan buys, and putting it on a
public URL would give away what the platform sells. The children are excluded
on a stronger principle: they are minors who signed up for nothing, and a page
naming a child and their grade is a page about a child.

`lib/publicParent.ts` selects a **named allowlist of columns**, never the row.
`profiles` carries all of the above on the same row, and the safe way to keep
them off a public page is to not fetch them — a column added next year is
excluded by default rather than included by accident.

**It is `noindex`.** A tutor profile is a marketing surface a tutor chose to
publish; this is a reference card a tutor lands on from a job. Reachable by
link, not put in a search index without asking every parent first.

**In admin a name goes to the admin member page**, with "View public profile"
as a separate explicit link — so nobody clicks a name expecting moderation
tools and lands on a marketing page, or the reverse.

## Admin can see the tuitions (3 Sep 2026)

`/admin/jobs` and `/admin/jobs/[id]`. There was no jobs screen at all: admin
could see tutors, parents, payments, reports and members, and had no way to
look at a job — the object every one of those screens is ultimately about.
"Why has nobody applied to my tuition" could not be answered without a database
client.

Unlike `/browse/tuitions` this shows **closed and hired jobs, and jobs from
suspended parents** — the ones somebody opens the screen to find. It reads
through the service role for that reason; permission is enforced once at the
route, and again at the load-more API, which re-checks rather than trusting the
screen.

**`SCREEN_ACCESS.jobs` is manager + support; `jobsMutate` is manager only.**
Support has to be able to answer "why can nobody see my job", which needs
reading it. Closing or removing one takes its applications out of the parent's
reach, which is not a first-line action. Verified: support gets 200 on the list
and 403 on the action.

**Every action does three things** — changes the row, writes
`admin_audit_log`, notifies the parent — and the route does all three, so a
screen added later cannot do two of them. A reason is required to remove:
"removed" with no stated cause is the version a parent cannot argue with and
support cannot explain.

**Nothing is deleted.** Remove closes the tuition and drops the Featured tag;
the row, its applications and its threads stay. A mistaken removal has to be
recoverable, and an application a tutor spent quota on is theirs.

Job references elsewhere in admin link here, with the `job_tx_id` beside the
title — that reference is the string a parent quotes in a support message.

## Tutor signup was broken by migration 35 — the lesson (3 Sep 2026)

**A CHECK constraint validates existing ROWS and says nothing about the
column's DEFAULT.** Migration 35 normalised `tutor_profiles.teaching_mode` and
added `CHECK (teaching_mode is null or in ('in_person','online','both'))`. It
converted all 17 rows correctly and `ALTER TABLE ... ADD CONSTRAINT` reported
nothing wrong, because at that instant every row satisfied it. The column
default was still `'Physical'::text`.

`handle_new_user()` inserts a `tutor_profiles` row for every tutor who signs
up, without naming `teaching_mode`. The default applied, the CHECK rejected it,
the trigger raised, and the member saw:

```
Database error creating new user
```

**Every tutor registration failed** from the moment migration 35 was applied
until migration 39 dropped the default. Parent registration was unaffected —
the trigger only writes `tutor_profiles` for tutors — which is exactly why the
smoke test missed it: every check signed in as an existing seed account and not
one of them created a new tutor. Zero accounts were lost, and that is luck
rather than mitigation.

Two rules come out of it, both cheap:

- After adding a constraint, check the column's **DEFAULT**, its triggers, and
  any function that writes it. The rows are the easy half.
- A smoke test that only signs in as existing fixtures cannot see a broken
  signup. **Creating an account is part of smoke-testing a deploy**, for both
  roles, because the two roles run different code in the same trigger.

Migration 39 drops the default rather than replacing it: migration 35's own
reasoning says the column stays nullable because teaching mode is a
profile-completion item, so "not answered yet" is a state a new tutor is
entitled to. Defaulting them would invent an answer and tick a checklist item
nobody completed.

## SEO foundations, part 1 (3 Sep 2026)

**Legal identity.** `lib/company.ts` reads the entity from `app_settings`
(migration 38) with the placeholders as fallbacks. `/terms`, `/privacy` and
`/about` all render the same block from one definition — `entitySection()` in
`components/LegalDoc.tsx` — because two copies is how a Terms page and a
Privacy page end up naming different registered offices. The SECP number and
NTN render as `{{COMPANY_REG_NO}}` and `{{COMPANY_NTN}}` until an admin fills
the row in, with no deploy. Neither document cites a statute; both describe
actual practice.

The **cost** of that: the three pages read `app_settings` through the
cookie-backed client, so they are dynamic rather than static now. With the
Navbar already having made 71 of 73 routes dynamic, this changes nothing
material — but it is why they are not prerendered.

**Schema.** `lib/seo.ts` is the one place: `pageTitle()`, `pageDescription()`,
and the Organization / WebSite / Person+Service / FAQPage builders.

- `name: "TutorMint"` and `legalName: "Tutor Mint (Private) Limited"` are
  deliberately different — that is the brand rule, expressed in the vocabulary
  a search engine already has for it.
- **`identifier` is emitted only once the CUIN is real.** A placeholder is
  honest on a page a person reads and dishonest in a machine-readable claim.
- **`sameAs` carries only the profiles that exist.** X and TikTok emit nothing.
  A `sameAs` pointing at a guessed handle is an identity claim about a
  stranger's account.
- Person + Service assert nothing the profile does not hold: no
  `aggregateRating` without real reviews, no `offers` without a rate.
- The FAQ's questions and answers come from `lib/faqContent.ts` so the JSON-LD
  and the visible page are **literally the same strings**. Structured data that
  says what the page does not is a manual-action risk, and it is how a promise
  nobody made reaches a search result.

**The title carries the promise**, not the description: a title is shown almost
always and a description is frequently rewritten. Applied to the public
surfaces only — dashboard titles are tab labels for members who have already
converted, and "verified, no commission" on "My applications" is an
advertisement aimed at the wrong person.

**THE WORDING RULE, for the FAQ, both packages pages and the upgrade sheet:**

> We put tutors in front of parents searching for their subject in their area.
> We never say "we will get you tuitions".

With no refunds, "we will get you tuitions" is a promise we cannot keep for
every tutor who pays — and the ones it fails are exactly the ones who will ask
for their money back and be told no. Visibility is what is sold, so visibility
is what is described.

The comparisons are stated in rupees because "great value" persuades nobody
doing arithmetic: an academy keeping half of a Rs 20,000 first month is
Rs 10,000, against Rs 999; a boosted post in one city costs more in a week than
Rs 199 does in a month. The upgrade sheet carries it **once, keyed on
audience**, rather than pasted into ten gate bodies — and only when a plan is
actually being offered, because an academy's cut on a suspension notice reads
as a sales pitch aimed at somebody who has just been told their account is
closed.

**/about and /faq were describing a product we do not have.** A "live 60-second
video introduction" (it is uploaded and reviewed, not live), a "matching and
support team" that connects parents to tutors (nobody does that), and "starting
bonus application credits" (there are none). Rule 7 forbids mock data in
shipped pages; an invented product claim is the same defect wearing a suit, and
a help page that describes the wrong product is worse than none.

### UTM, first-touch (migration 38)

Captured in `proxy.ts` on the first request, **only when the cookie is absent**.
Last-touch would credit the brand search somebody makes after an ad has already
done its work, which is how brand search comes to look like the best channel.
30 days, httpOnly, first-party; no third-party pixel.

Written to `profiles` **once at signup and never updated**, and copied onto
`payments` at checkout — read from the profile, not the cookie, because the
cookie expires in 30 days and a tutor may upgrade months later. Two columns
answer two questions: where did this person come from, and what was the
attribution on the money we banked.

`/admin/payments` and `/admin/users/[id]` both show it. **Verbatim**, not
title-cased: `Meta · Cpc · Tutors-Lahore-Sep` is not a campaign anybody can
search for, and an admin comparing the screen to a spend report would find
nothing. That is why `Fact` grew a `verbatim` prop.

### The masking finding — not a failure

`+92 300 1234567` rendered unmasked in the Ali ↔ Ayesha thread, and **that is
correct**. Ayesha Siddiqui sent it; she is on `parent_featured` and Ali Raza is
on tutor `featured`, so both rows have `can_view_contact = true` on active
subscriptions. `pairMayShareContact()` therefore returns true. The rule is
about the PAIR, not the reader, and this pair has bought exactly this. Masking
was left alone.

## AI-assisted job posting (3 Sep 2026)

`/parent/dashboard/post-job` is one card with three numbered steps, not four
boxed sections. The parent SELECTS — level, grade, subjects, city, area, mode,
budget band, days, times — and writes nothing. **"Write this for me"** turns
those selections into a title and a description through
`POST /api/parent/jobs/generate`, which calls the Claude API server-side.

**It is an assist, not a gate.** The title and description are ordinary
editable fields. A parent who would rather type their own never presses
Generate; a parent who does can rewrite every word; nothing posts that they
have not seen. Posting itself is unchanged — still blocked until CNIC and
address are verified, still quota-checked, still writes `job_subjects`, still
`logActivity`.

**Generation spends no job quota**, and that is not a detail: pressing Generate
twice, reading both and posting neither has cost the parent nothing. Quota is
consumed in `createJob`, when a job exists. What generation does spend is
money, so it has its own rate-limit bucket, `ai_generate` (20/hour/user, sized
like `otp_send` rather than like `apply` for the same reason — each call is
billable). No migration was needed for that: `rate_limits.bucket` has no CHECK.

### As built — the parts that needed a decision

**`ANTHROPIC_API_KEY` is protected by a build error, not by a convention.**
`lib/ai/anthropic.ts` imports `server-only`, so a client component importing it
fails the build rather than shipping a billable credential into every browser
bundle. That is the one dependency this change adds: 1KB, zero runtime, and
published for exactly this.

**An instruction in a prompt is a request, not a guarantee.** So the generated
text is VERIFIED against the selection set before a parent ever sees it.
`unsupportedFacts()` scans for **numbers** the parent did not select, because
almost every way this could embarrass someone is numeric — an exam grade, a
percentage, a fee, a number of sessions, a child's age. Those read as specific
and checkable, and a reader will believe them. A number in the output and in
none of the selections was invented, and that is decidable rather than a
judgement call. It does NOT catch invented prose ("she is a bright girl"); the
prompt argues against that, the 60–100 word ceiling leaves little room for it,
and the parent reads everything before it posts. The limit is stated at the
function rather than left for someone to discover.

**The fallback is a first-class path, not an error branch.** With no key, a
failed call, unparseable JSON, the wrong length, or a figure that fails the
verifier, `composeJobCopy()` builds the same two fields deterministically from
the selections and the form says so in words — "We put this together from your
choices." A composed fallback presented as a generation is a small lie that
costs trust the first time somebody notices the change in tone. **Nobody is
ever blocked from posting because a generation call failed.**

**The pure half is its own file.** `lib/ai/jobBrief.ts` holds the composer and
the verifier; `lib/ai/jobCopy.ts` holds the API call. The split exists because
`server-only` refuses to load in a test runner, and the composer and verifier
are the two parts most worth testing — `npm run test:jobcopy`, 11 assertions,
same reasoning as `lib/feedGrouping.ts`.

**Subjects are resolved server-side from `taxonomy_master` ids**, never taken
as names from the request body. The ids are what the parent selected; a name in
a request is a string somebody could put anything in, and it would end up in
copy published under that parent's name on a public board.

**Generation is NOT gated on verification**, deliberately. It writes nothing
and publishes nothing, and a second gate here would refuse a parent who is
mid-way through their CNIC review and drafting a post to have ready. The gate
lives where the job is created. Suspension does close it, with everything else.

### The budget band (migration 37)

The budget is now the same five bands `/browse/tuitions` filters by, because a
free number asks a parent to know what a tutor costs before they have seen one.
A band has two ends and `jobs.budget_pkr` is one integer, so **`budget_min_pkr`
and `budget_max_pkr` were added** — additive, nothing existing changed meaning,
and a job posted before the migration has them NULL, which reads correctly as
"we only have the one number for this job".

`budget_pkr` is still written, as the band's lower bound (or its upper bound for
the band with no lower one). That is chosen so **every band round-trips through
the existing `>=` / `<=` filter unchanged** — the table is in the migration —
which is why no query, index or card had to be rewritten to find jobs posted
through the new select. What did change is the *label*: `budgetLabel()` renders
the range, because showing only the lower bound would under-state a band-posted
job by up to ten thousand rupees.

### Two things fixed on the way

`components/TaxonomySelector.tsx` rendered its Level, Grade and Subjects
sections as three bordered, tinted panels — three boxes inside one step of one
card, which is the exact thing this pass exists to remove. They are quiet
groups now. Its three search inputs were also 30–34px tall, under the 44px
rule, on a form that is otherwise all taps.

**What is NOT proven: the Claude path itself.** `ANTHROPIC_API_KEY` is set in
no environment — not `.env.local`, not Vercel — so every generation to date has
returned the composed fallback, which is what production serves until a key is
added. The verifier and the composer are tested; the model's own output is not.

## Messaging is a two-pane inbox (3 Sep 2026)

`/parent/dashboard/messages` and `/tutor/dashboard/messages` are one inbox with
two panes — conversations on the left, the selected conversation on the right —
plus deep links at `/{role}/dashboard/messages/[threadId]`. One implementation,
`components/messages/InboxShell.tsx`, serves both roles: they differ in the
breadcrumb, the empty state's suggestions, the upgrade link and the reply-only
tutor notice, and in nothing else. Two copies would be two places for the
masking rule to drift apart.

### As built — the five things that needed deciding

**Unread comes from `notifications`, not a read marker on `threads`.** The rows
already existed and are already what the header bell counts, so the dot in the
list and the number on the bell cannot disagree — they are the same rows. It
also means "opening a thread marks its notifications read" is the write the
bell already performs rather than a second bookkeeping system to keep in step.
Mark-read is a POST from the browser on mount, **not** a write during the
page's render: Next prefetches links, and clearing the dot for a conversation
somebody merely hovered over is worse than clearing it a beat late. It is
deliberately not in `logActivity` — same read-receipt reasoning, and the same
flagged departure from rule 11, as the bell's own mark-read.

**`/messages/[threadId]` stays, as a redirect.** It is what `notify()` writes
into every message notification's href and what `markThreadRead` matches on, so
it is the id of a conversation as far as `notifications` is concerned — 49 rows
already carry it. It is also the right shape for that job: at the moment a
message is sent the notification is being written for the *other* person, and
their role is not something the sender's code path should have to look up. So
the href is role-neutral and the route resolves the role once and forwards. The
conversation view that used to live there is deleted rather than kept.

**The dashboards' "N unread" tile was always zero.** It computed from
`ThreadSummary.unread`, which `listThreads` hard-coded to `false` — so a member
with two dozen unread messages was told "0 unread", on every dashboard, always.
`unreadMessageCount()` counts the real rows. `listThreads` is gone.

**`useInfinite` gained an optional `scrollRoot`.** The conversation list is a
pane with its own `overflow-y`, and a sentinel at the bottom of a clipped pane
never intersects the *viewport* — the observer would simply never fire and the
list would end at page one with nothing saying so. Passing the pane makes it
the observer root and the thing whose offset is remembered. The Load-more
button remains the accessible path, as everywhere else.

**Searching the inbox is a different list, not a filtered one.** `useInfinite`
only ever appends — deliberately, because it exists to serve server-rendered
first pages — so the searched list remounts under a new key rather than
teaching the hook to throw rows away. `suggest={false}`, the same call
`/admin/users` makes: the public suggestion index holds listed tutors and open
jobs and knows nothing about who this member has talked to. Search matches the
other person's name (through the service role — `profiles` is self-read only)
and the job a conversation is about.

**The selected row is the page ground with a navy bar, not a tint fill.**
`tm-tint-navy` darkens the row enough that the timestamp (gray-500, 4.03:1) and
the job title (tm-green-deep, 4.21:1) both fall under AA on it.
`check:contrast` rejected both, which is what moved the selection to `tm-bg`.

**The suspended composer is unreachable today, and stays anyway.** Both
dashboard layouts redirect a suspended member to `/suspended` before the inbox
renders, and `POST /api/messages` answers 403 regardless — both verified. The
composer's suspended branch is therefore not live UI. It stays because a
suspended member's threads are already readable, so read-only access is the
natural next step for that state, and this is the difference between a composer
that explains itself and one that silently refuses. Flagged in the file so it
is not deleted as dead code.

## teaching_mode is one spelling (3 Sep 2026)

Canonical everywhere: **`'in_person' | 'online' | 'both'`**, lowercase snake,
with a CHECK constraint on all three columns that hold one (migration 35).
`lib/display.ts` stays the only thing that turns one into words, and
`TEACHING_MODES` in `lib/locations.ts` carries values only — every dropdown
labels them through `teachingMode()`, so a filter, a job card and a tutor
profile cannot drift into calling the same value three different things.

**The visible cost was fifty-one invisible jobs.** `jobs.teaching_mode` held
`'Physical'` (6), `'in_person'` (1) and NULL (51), and the filter compares one
spelling — so a parent narrowing to "In person" saw seven jobs out of
fifty-eight, with nothing saying the other fifty-one existed.

**How the NULLs were decided, since it is the part that cannot be guessed.**
Nothing in the table argued for `'online'`: across all 58 jobs, title,
description and timings contain zero occurrences of online, zoom, remote or
virtual. The 51 fell into exactly two groups:

- **46** (`JOB-TRK-%`, the pre-rebuild import) each have a description reading
  "Looking for an experienced and camera-verified **home tutor** in `<area>`,
  `<city>`." The row states in-person in its own words → `'in_person'`.
- **5** (`SEED-JOB-%`) say nothing about mode anywhere. Rather than invent one,
  they take the meaning the posting form already gives an unset mode — its
  select offers "Any" as the empty option, and "Any" is `'both'`. That asserts
  only what is true of a row with no value, and it is the permissive choice, so
  they appear under every filter instead of none.

`jobs.teaching_mode` is now NOT NULL with `default 'both'`, and `lib/jobs.ts`
coerces an unset mode at both write sites — an explicit NULL in an INSERT skips
a column default, so without that the bug could walk straight back in.
`tutor_profiles.teaching_mode` stays nullable: mode is on the completion
checklist, so "not answered yet" is a state a half-finished profile is entitled
to. `demo_requests.mode` stays nullable and permits only `'online'` and
`'in_person'` — a demo happens once, in one place, so "either" is not an answer
to that question, and the single NULL row is an unmade choice rather than a
missing value.

**Two writers had to be fixed, or the constraint would have broken them.**
`app/tutor/dashboard/settings` wrote `teachingModes.join(', ')`, so a tutor
ticking two boxes stored the string `'Physical, Online'` — a spelling no filter
matched and no display helper understood, and one the new CHECK would turn into
a 500 on a routine save. It now derives one value through `canonicalMode()`.
And `parseMode()` translates the retired spellings arriving in a URL, because
`?mode=Physical` links are already out in the world and an exact-match filter
on that spelling returns nothing at all.

**One condition was left behind by the rename and is fixed:**
`/browse/tutors`' no-results state tested `mode !== 'Online'`, which after the
rename was always true — so it offered to include online tutors to somebody who
had already filtered to exactly that.

## Enum values never render raw (3 Sep 2026)

`in_person` reached a live job card. `jobs.teaching_mode` holds `'Physical'`
(6 rows), `'in_person'` (1) and NULL (51); `tutor_profiles.teaching_mode` holds
`'Physical' | 'Online' | 'Both'`; `demo_requests.mode` holds `'online'`. A
column with two spellings will always leak whichever one nobody thought about.

`lib/display.ts` is now the only thing that turns a stored value into words —
`teachingMode`, `demoMode`, `applicationStatus`, `jobStatus`, `demoStatus`,
`verificationStatus`. The helpers are **total**: an unrecognised value is
title-cased rather than dropped, so a status added by a future migration reads
as "Under review" instead of disappearing from the card.

Normalising the columns themselves is still worth doing and is not done — it
needs a decision about which spelling wins. Until then the display layer accepts
every spelling, so the fix holds whichever way that decision goes.

## Blog CMS, part 1 — editor, publishing, public pages (T9.3, 4 Sep 2026)

Restores `/blog`, withdrawn on 3 Sep for want of real content. Under precedence
rule 10 this supersedes "`/blog` is withdrawn until 9.3" — the route now renders
real, reviewed rows from the database, and the footer link and sitemap entry are
back. Migration 49.

**Two tables, service-role writes.** `posts` and `post_revisions` (migration
49). `posts` has ONE public SELECT policy — `status = 'published' or is_admin()`
— and no write policy at all: every mutation is an audited admin route holding
the service key, exactly like `advertisements` and `notifications`. So there is
no write policy for the RLS audit to scrutinise, and an anon key sees published
posts and nothing else. `post_revisions` is admin-read only (one SELECT policy,
`is_admin()`), server-written. `posts` is on `rls-audit`'s PUBLIC_READ with that
reasoning.

**Clusters are a fixed set**, CHECK-enforced in the column and mirrored in
`lib/blog.ts` (`POST_CLUSTERS`): Cost & hiring, Boards & exams, Subject guides,
City guides, Tutor career, Safety & trust, Urdu. A typo cannot invent a cluster
the index has no filter for.

**Markdown is rendered by our own constrained renderer** (`lib/markdown.ts`),
not a library. Every character of source is HTML-escaped first and the only tags
in the output are ones the renderer emits from a fixed whitelist — there is no
path by which source text becomes a tag, so there is no XSS to sanitise after,
which is what a Markdown+sanitiser pair would spend two dependencies achieving.
Links are validated (http/https/mailto/relative only; `javascript:` drops to
plain text). `parseMarkdown` returns ordered segments (HTML runs + embed
markers) plus the headings (one source of truth for the TOC) and reading time.
Tested in `scripts/test-blog.ts` (`npm run test:blog`) — the "source can never
become a tag" guarantee is exactly what a unit test should pin.

**Embeds.** A line that is exactly `{{tutor:slug}}` or `{{job:public-slug}}`
becomes a live card, rendered server-side from current data (`BlogEmbedTutor`
reads `tutor_directory` via `tutorCardBySlug`; `BlogEmbedJob` reads
`jobByPublicSlug`). A delisted tutor or a closed job renders nothing rather than
a dead reference — what a post says about a tutor cannot drift from what the
directory shows.

**The publish gate is the stored state.** `canPublish()` in `lib/blog.ts` is
read by BOTH the editor button and the server route: publish is allowed only
when a human has saved at least one edit (`edited_by_human`) AND ticked reviewed,
and the post has title, slug, body and — if a cover is set — cover alt text. The
editor disables Publish while there are unsaved changes, because the server
judges the LAST SAVED row and the two must agree. Save + review is manager or
support (support drafts); publish, schedule, unpublish and delete stop at
manager (`SCREEN_ACCESS.blog` vs `blogPublish`). Every save writes a
`post_revisions` row (a fuller record than one audit line); publish / schedule /
unpublish / delete additionally write `admin_audit_log`.

**Slug is immutable after publish** (`slug_locked`), set true at first publish;
the editor locks the field. A draft can still be renamed.

**Scheduling** rides the existing daily subscription cron
(`/api/cron/subscriptions` → `publishDuePosts()` in `lib/blogPublish.ts`),
idempotent: it only flips rows still `scheduled` whose `publish_at` has passed,
and sets `published_at` once.

**Unpublish returns a branded 404, not 410, and here is why.** The spec asked
for 410; Next 16's page-level status interrupts stop at 401/403/404
(`ALLOWED_CODES`), and an unpublished row is invisible to edge middleware under
RLS while the service-role key must never run at the edge — so a true 410 with a
branded body is not cleanly reachable in this stack. `/blog/[slug]/not-found.tsx`
is a friendly page (never blank, links to /blog); the URL leaves the sitemap on
unpublish, which is the signal a crawler actually acts on. A middleware 410
could only be a blank body, which the spec forbids.

**Search-engine notify is best-effort and honest.** `notifySearchEngines()`
runs only when preview mode is OFF (pinging while noindex is the opposite
signal), and only pings IndexNow when `INDEXNOW_KEY` is set. Google retired its
sitemap-ping endpoint in 2023; Search Console submission is a launch step
(T8b). Nothing here fabricates a "pinged Google".

**Analytics.** `views` and `cta_clicks` are incremented server-side only, via
the SECURITY DEFINER `increment_post_metric()` granted to `service_role` alone
(atomic, published-rows only). The view beacon fires once per browser session
(sessionStorage-guarded); the CTA beacon fires on the reader CTA. Not
rate-limited — a view count is a low-stakes vanity metric, unlike `ad_events`.

**Public pages.** `/blog` (server-rendered first window, cluster-filter links,
infinite scroll), `/blog/[slug]` (reading time, TOC from H2s, related posts,
audience CTA with no price, share buttons, Article + BreadcrumbList JSON-LD, OG
/ Twitter cards; Urdu posts render `dir="rtl"`), and `/blog/feed.xml` (RSS 2.0).
Every public page honours preview mode through the existing global flag — the
root layout's robots meta and `robots.ts` cover the blog like everything else,
and the sitemap withholds posts while preview is on.

**Related landing pages link through the live set.** The author picks them in
the editor from `liveLandingPages()`; `RelatedLanding` resolves them against the
live set again at render, so a page that has dropped below the threshold is not
shown. This is how "a subject or city mention links through the landing helper"
is realised on a post — through the picker, not by scanning prose, because a
mislinked auto-detected word is worse than none.

**The a/an article helper** (`lib/article.ts`) picks "a"/"an" by SOUND: acronyms
and single capitals by their spoken first letter ("an O Levels", "an IGCSE", "a
GCSE"), a curated consonant-sound set for vowel-letter words ("a university"),
then the plain vowel-letter rule with a silent-h set. It fixes the landing-page
CTA that read "a O Levels" and is used wherever a subject name follows an
article.

## Feedback: toasts, confirms, no all-caps buttons (4 Sep 2026)

Three platform-wide UI rules, each with one shared implementation.

**Every mutation shows a toast.** `components/ui/Toast.tsx` is the one toast —
`useToast()` gives `success(msg)` / `error(msg)`. Bottom-centre on a phone,
bottom-right on a laptop; success green, failure red WITH THE REASON; a 44px
dismiss; auto-clears (4s success, 7s error, paused on hover); announced to
screen readers via `role="status"`/`"alert"` in an aria-live region. It is
mounted once in `app/layout.tsx`. Wired into every member-facing mutation:
identity number-save / image-upload / image-remove / submit / reopen, shortlist,
demo request, message send, in-app report, block, apply, application withdraw,
child add/remove, tuition close, applicant shortlist/decline/hire, and the admin
plan grant/revoke; degrees and certifications toast through CredentialEditor.
Inline notices were kept only where they add field-specific context (a CNIC
format hint under its field); the toast is the transient confirmation.

**Every destructive action confirms first**, through the one dialog
(`components/ui/ConfirmDialog.tsx`, `useConfirm()` → `Promise<boolean>`): the
destructive button is `tm-red`, Escape and a backdrop click cancel, focus moves
to Cancel on open (a destructive action is never one stray Enter away) and
returns to the trigger on close, Tab is trapped. It replaced the bespoke inline
confirms that had grown per-feature (withdraw, close job). Wired to: remove a
CNIC image, withdraw an application, delete a child, close a tuition, and block
someone. ("Sign out of all devices" is named in the same breath in the feedback
but is not a feature on the platform today; when it is added it uses this
dialog.)

**No all-caps buttons.** A button's label is title/sentence case as written —
"Send for checking", never "SEND FOR CHECKING". The `uppercase tracking-wider`
idiom was removed from every button and link across the app (22 across 14
files); it stays only on micro-labels and chips (a `<dt>`, a table header, a
status pill), which are not buttons. `check:contrast` already forbids the other
button sins; this one is enforced by review and the grep in the evidence.

**Two supporting fixes from the same pass.**

- **Remove on the identity card did nothing, and now deletes.** `FileUpload`'s
  Remove only ever cleared a locally-picked file; with a STORED document
  (`currentPreview` set) it cleared nothing and left the document on screen and
  on disk — and it made no server request, so there was nothing in the
  silent-failure log either (the diagnosis was the absence). `FileUpload` gained
  an `onRemove` callback; the identity card wires it to a new `remove-image`
  action on `/api/identity` that deletes the `user_documents` row and its
  storage objects (service role, because `identity-docs` has no owner-delete
  storage policy), behind the confirm dialog and with a toast. Replace was
  already correct (it uploads a new side).

- **Uploaded-file tiles say what the file IS, not its name or size.** The wide
  `FileUpload` tile reads the semantic label ("Front of your CNIC") and a status
  word ("Uploaded" / "Uploading…" / "Removing…"); the truncated file name and
  the "130 KB" are gone. The degrees and certifications cards are one row per
  credential now (`components/tutor/CredentialEditor.tsx`): thumbnail, summary,
  Edit (expands the fields inline), Remove — the field group flex-wraps onto two
  lines inside the card at every width, and no byte count appears anywhere.

## Blog CMS, part 2 — AI drafting and generated covers (T9.3, 4 Sep 2026)

On top of part 1. **The human gate is untouched:** nothing publishes without a
saved human edit and the Reviewed tick (`canPublish`). This adds a drafting aid
and a cover generator, both first-class fallbacks, both audited. Migration 50 —
three additive columns on `posts` (`source_notes`, `confirmed_figures`,
`cover_square_path`) and `source_notes` on `post_revisions`. Nothing existing
changes shape.

**The brief is fixed and server-side.** `lib/ai/blogCopy.ts` (`generateBlogDraft`)
calls the Claude API through `lib/ai/anthropic.ts` (which imports `server-only`,
so a client importing it is a build error, not a leaked credential): plain,
warm, Pakistan-specific; answer-first; H2 sections; a Markdown pipe table where
it helps; an FAQ block; the audience CTA with **no price** (the conversion
rules); internal links **only** to the live landing set it is handed, never an
invented URL; and the hard rule — **NEVER invent a statistic**, use the notes or
say "typically". Roman-Urdu when the language is `ur`. The manager enters a
title and 3–5 fact notes and presses Generate; the draft lands as an ordinary
editable body. It **saves nothing and never ticks Reviewed** — generating is not
publishing.

**The verifier is the guarantee the prompt is not.** `lib/ai/blogBrief.ts` is
the pure half (no `server-only`, so it runs in the editor, on the server, and in
the test runner — same split as `jobBrief.ts`). `unsupportedFigures()` extends
the job-posting verifier: it flags **numbers** in the body that appear in
neither the notes nor the title nor the confirmed list, because a numeric
invention on a blog — a pass rate, a fee, a percentage — reads as researched
fact and is quoted back at us. It does **not** catch invented prose; that is the
accepted limit (the prompt argues against it and a human reads every word).

**The figure gate.** `figureGate()` is **active only when there are notes** — a
hand-written part-1 post with no notes is not blocked, or every "5 tips" and
"Grade 10" in it would need confirming, a regression of a shipped flow. With
notes present, every figure must trace to them or be **confirmed with a written
source** (`confirmed_figures`, `{figure, source}`); until each flagged figure is
edited out, added to the notes, or confirmed, **Reviewed cannot be ticked**. The
editor shows the flags live and disables the Reviewed box; the save route
(`/api/admin/blog`) re-runs the same gate and **refuses a save that ticks
Reviewed while figures are untraced** — the browser is never the only thing
holding the line. Publish is transitively gated because it already requires
Reviewed.

**SEO fields are generated with the draft.** `seo_title` ≤60, `seo_description`
≤155 ending with the brand line via `withBrandTail()` — both editable, both in
the Google-preview box.

**Covers via `next/og`.** `app/api/admin/blog/cover-image/render.tsx`
(`renderCover`) draws a **1200×630** (post + OG) and a **1080×1080** (social)
from title + cluster — brand tokens only (literals; satori resolves no Tailwind
or var()), navy title on a tinted ground, a simple cluster glyph, the one-word
`TutorMint` wordmark (the same negative-margin trick the social banner
documents). **Four templates rotate by cluster** so the index is not uniform.
Pixel-stable: no clock, no randomness. `GET /api/admin/blog/cover-image` renders
a live preview; `POST .../generate-cover` renders both sizes, uploads them to
the public `blog` bucket, and **derives the alt text** (a generated picture of
the title can describe itself; an uploaded cover still needs alt by hand). An
upload replaces the generated pair and drops the square variant.

**Rate limit + audit.** Generation is owner + manager only
(`SCREEN_ACCESS.blogGenerate = ['manager']`, NOT support — it spends money and
speaks in our voice), rate-limited through `consume_rate_limit` on the new
`ai_blog` bucket (sized like `ai_generate`; no migration — `rate_limits.bucket`
has no CHECK), and audited as `blog.generate` with the **note size** (chars and
lines) and the **model** — never the note text, which is the manager's working
material. Cover generation sits on `SCREEN_ACCESS.blog` (it carries no
invented-fact risk).

**The fallback is a first-class path.** No `ANTHROPIC_API_KEY`, a failed call,
unparseable JSON, or a too-short reply all return `composeBlogDraft()` — a plain
draft built from the notes (each note line a talking point, a structural FAQ and
CTA, and **no number the notes do not carry**, so it can never fail its own
verifier). The editor says so in words ("we composed this from your notes"). The
button never spins forever and the editor is never blocked.

**Tables in the renderer.** `lib/markdown.ts` gained GFM pipe-table support so
the brief's comparison tables render — cells are escaped and run through
`inline()` like everything else, so a cell cannot become a tag (tested). Wide
tables scroll inside their own box, not the page.

**What is proven.** The verifier, the composer, the SEO tail, the exemptions and
the table renderer are unit-tested (`npm run test:blog`, 27 assertions). The
Claude path is proven end to end on production: a live generation returns
`source: 'claude'` with a ~1,000-word answer-first draft, a real SEO title and a
brand-line description. Covers render without a key.

### The failing-call diagnosis (4 Sep 2026)

The first live runs fell back to the composed draft, and the cause was found by
surfacing the verbatim API error (status + body — never the key, which is only
ever a request header) to the admin editor and the `blog.generate` audit row,
and, on a real failure, the accessible model list from `GET /v1/models`. Two
causes, in order:

- **`temperature` is deprecated for `claude-sonnet-5`.** The model answered
  `400 invalid_request_error` for a parameter every call carried, which is why
  **both** blog drafting and AI job-post copy were silently composing instead.
  `complete()` no longer sends `temperature`. The model id was never wrong —
  `claude-sonnet-5` is on the key's model list — so the model lives in **one**
  exported constant in `lib/ai/anthropic.ts`, changed nowhere else.
- **The 20s timeout was too short for long-form.** A job advert fits in 20s; a
  900–1,400 word post does not, and timed out into the fallback. `complete()`
  now takes a per-call `timeoutMs`; blog drafting uses 55s under a 60s route
  `maxDuration`, and still falls back cleanly if it runs over.

If the error had been authentication or billing, that is an owner-side fix and
the diagnostic says so plainly; it was neither. Whatever the cause, the editor
now shows it in words: **"AI drafting is unavailable: &lt;reason&gt;."**

**The figure gate learned two non-statistics.** A digit that is part of a real
landing page's own **title** is exempt when the body links to that page (using
the page's canonical label, so a stat smuggled into a link label is still
flagged); and an **ordered-list enumerator** ("1.", "2.") is stripped before the
scan, because a numbered list is not a set of statistics. Everything else stays
strict — a bare number in prose that is not in the notes is still flagged.

## Blog CMS, part 3 — content queue, editor toolbar, slug auto-fill (T9.4, 5 Sep 2026)

The system suggests what to publish. Migration 51 — one table,
`content_suggestions`; the signals read tables that already exist.

**Five signals, each a small module returning candidates with evidence**
(`lib/contentQueue/build.ts`):

- **Search gaps** — the collapsed `search_performed` events over 30 days (no
  free-text query is ever stored), grouped by subject × city, paired with the
  tutors listed for each now. "40 searches for O Levels Physics in Lahore, 3
  listed tutors."
- **Academic calendar** (`lib/contentQueue/core.ts`, pure) — the fixed
  Pakistani schedule: board registration Dec–Jan, Matric/Inter exams Mar–May,
  O/A Level May–Jun and Oct–Nov, results Jul–Aug, admissions Aug–Sep, Ramadan
  (movable, dated per year). Suggested six weeks ahead; the fingerprint carries
  the year, so the same topic refreshes yearly.
- **Coverage gaps** — a live landing page with 10+ listed tutors and no
  published post linking to it: a page we can already rank, waiting for its
  article.
- **What people ask** — open report reasons over 60 days, clustered into trust
  topics. (There is no support-ticket table yet — /support is FAQ + WhatsApp —
  so reports are the only "what people ask" source; the module extends when one
  exists.)
- **Search Console 8–20** — built but **dormant**: `searchConsoleStatus()`
  returns "Not connected" with the setup steps and **no candidates** until
  `GSC_SERVICE_ACCOUNT_JSON` + `GSC_SITE_URL` exist. It never fabricates data.

**Priority is explainable, never a bare number.** `priority = demand ×
rankProximity × seasonality × gapAge`, and every component is stored on the row
(`priority_components`) and shown on the card. `gapAge` rises one step per
fortnight (capped at 4), so an old unfilled gap gets louder.

**A dismissed topic returns only on a MATERIAL change.** `evidenceHash()` is a
coarse, log-bucketed hash of the evidence figures: 40 → 44 searches is the same
hash and stays dismissed; 40 → 120 crosses a bucket and resurfaces. A dismissed
row's hash is frozen (never refreshed by a rebuild) so the next change is
compared to the dismissal snapshot. `drafted` and `dismissed` are decisions and
survive rebuilds; a `suggested`/`snoozed` row whose evidence vanishes is pruned.

**Rebuilt nightly by the existing cron** (`/api/cron/subscriptions` →
`rebuildContentQueue`), de-duplicated against posts already written (a content
topic whose landing page a published post already links to is dropped).

**Monday digest** (`lib/contentQueue/digest.ts`): top three topics + posts
published 12+ months ago, to owner and manager, on the same daily cron — it
sends only on Monday (Asia/Karachi) and only once a day, guarded by an
`app_settings` timestamp. Nothing auto-publishes; the email points at the queue.

**`/admin/blog/queue`** (manager + support): content cards (title, cluster,
audience, language, the priority with its breakdown, evidence in plain words)
with **Draft this** (opens the editor at `/admin/blog/new?suggestion=<id>`
pre-filled — title, cluster, audience, language, and the evidence as the fact
notes, so part 2 writes it), **Snooze** (2 weeks) and **Dismiss** with a reason.
A second card type, **recruitment gaps** ("Faisalabad: 210 searches, 2 tutors"),
is routed to Bulk import, not the blog. Opening a draft threads the suggestion
id through; the first **save** marks the suggestion `drafted` so it leaves the
queue — tied to real work existing, not merely to opening the editor.

**Editor toolbar** — a formatting bar above the Markdown body inserts at the
cursor: heading, bold, italic, list, link, image, embed tutor card, embed
tuition card. Storage is unchanged (still Markdown); a manager who has never
seen Markdown can write a post. **Slug auto-fills from the title as it is
typed**, until it is hand-edited (then it stops tracking) or the post is
published (then it is locked) — an emptied slug resumes tracking the title.

## Mobile polish, both roles (5 Sep 2026)

A pass over the two dashboards, cards, packages and empty states. No migration.

**The cross-city notification now checks BOTH modes.** The Growth PR's
`notifyMatchingTutors` cross-city fan-out gated on the JOB's mode only, so an
in-person-only tutor in another city was notified for an online job. It now also
requires the tutor's own `teaching_mode ∈ {online, both}` (read from
`tutor_directory`). In-app `notify()` is not gated by any preference for any
kind (`email_opt_out` governs email only, and `job_matched` sends no email), so
this notification respects preferences exactly as every other in-app one does.

**The identity form is off the dashboards.** Both dashboards embedded the full
identity card (CNIC front/back, selfie, "Request a change"); it now lives only
in Settings → Identity (tutor `/tutor/dashboard/settings`, parent
`/parent/verify`). The dashboards show one compact `IdentityStatusLine`:
Verified / Pending review / Not submitted → Complete in Settings (link). A
Verified account shows only "Verified" — never "FRONT Not uploaded · BACK Not
uploaded"; the documents are retained privately and there is nothing to prompt.
The parent line reads Verified only when BOTH CNIC and address are approved (a
partial approval is Pending review).

**Upsell never offers the held plan or a lower one.** `lib/upsell.ts`
(`nextUpsell`, `planRank`) is the one answer to "what higher plan do we offer?",
returning the next rung or null at the top — superseding the never-null
`lib/upgradePath.ts` `nextPlan`. The main leak was the house ads (`lib/ads.ts`):
they ignored the viewer and pitched `house-parent-featured` to Featured parents
and `house-tutor-featured`/`-premium` to Featured/Premium tutors. `houseUpsellAd`
picks the lowest creative strictly ABOVE the held plan, or null; `AdSlot` and
`/api/ads/inline` render nothing when null, but only filter when the viewer's
audience matches the slot's. `/api/gate` gained a belt-and-braces guard: a gate
whose offered plan is at or below the held plan returns `{ gate: null }`.

**The stale expiry card is gone.** `lapsedPlanRow` (`lib/needsYou.ts`) guarded
only `ent.plan`; a PAUSED plan has `ent.plan === null` while `ent.planPaused`,
so a live paid plan showed "your plan ended" beside its own tile. The guard is
now `if (ent.plan || ent.planPaused) return null` — `ent` is the computed
authority; the raw `subscriptions` read (which can hold a stale expired row from
a previous plan) is only reached when there is genuinely no live plan.

**Packages state is per-tier and per-role** (`PackagesTable`, `BuyButton`):
"Current plan" (disabled) on the held tier, "Upgrade to X" on higher tiers,
nothing on lower tiers (no downgrade offers), and "Verify to unlock" only when
identity is actually not verified. Tier order comes from `search_rank`; a new
`verified` prop gates the parent free tier (a parent holds any plan only once
verified, so `!!ent.plan` is the verified fact).

**Card actions are one row at every width** (`components/CardActions.tsx`): the
primary actions stay visible and the rest fold into a "More" overlay menu — no
button wraps to a second row, labels always stay, icon+label throughout. Tutor
cards (View Profile, Send Message, Demo, Shortlist) show two primaries + More on
mobile; tuition cards (View details, Apply) fit in one row with no More.

**"Either" is now "In person or online"** everywhere (filters, cards, profile,
job form, notifications) via the one `lib/display.ts` `teachingMode()` helper.
Stored values are unchanged.

**Post-a-tuition drops "Select all"** — `TaxonomySelector` gained
`allowSelectAll` (default true; false only from the job form). Nobody posts one
tuition for every subject.

**Empty states** (`components/EmptyState.tsx`): one icon, one sentence, one
action. Wired into the applicant list, activity band, demo inbox, the tutor
open-tuitions list, the free-tutor matching-jobs strip, the parent my-tuitions
list, and the notification empties (bell + full page). There is no parent
"saved tutors" list page in the product, so "saved" has no empty state to add.

## Growth pass — social templates, anon search, mobile footer, chip (5 Sep 2026)

Six changes, migration 52 (additive: `anon_search_events`, `notifications.meta`).

**Two new social templates** in the existing generator (`app/api/admin/social/image/render.tsx`),
brand tokens only, one-word wordmark, star as inline SVG, pixel-stable:
- **success** — a "Congratulations" card (script-style italic greeting, bold
  occasion, the portrait in a rounded frame on a `tm-tint-green` panel, three
  facts in a soft card, badges where earned). Used for "You're Verified" and
  "Hired".
- **announcement** — navy ground, oversized headline, circular portrait with
  name + role, a `tm-gold` date block, a detail/venue strip. Used for roundups
  and events.
The renderer now dispatches by template through shared helpers (`Wordmark`,
`Portrait`, `BadgePills`, `StarRating`, `Fact`, `CtaStrip`) so the wordmark trick
and the badge/rating rules live once. `BannerTutor` gained `experience_years`.
The admin route passes `subhead`/`date` (announcement only). The **"You're
Verified" card is tutor-facing and automatic**: `/api/tutor/social/verified`
renders the success card for the authenticated tutor's OWN listed profile (reads
`tutor_directory` keyed on their id, so they can only render their own, and only
when LISTED — the same condition their badge appears under), and
`components/tutor/VerifiedShareCard.tsx` shows it on the dashboard with WhatsApp
/ Facebook / Save-for-Instagram buttons. It sits below NEEDS YOU and the teaser,
respecting the fixed band order. WhatsApp and Facebook share the profile LINK
(their web intents take a URL, not a file); Instagram has no web intent, so its
button downloads the PNG to post manually.

**The two admin pickers use the platform typeahead** (`suggest={false}`, like
`/admin/users`): the social generator's tutor picker (searches name, area,
subject over the loaded list) and `/admin/plans`' account picker (name, email).
A plain `<select>` stops working past a few dozen names.

**Anonymous searches are logged.** `search_performed` (member timeline) needs a
user id, so guest searches — most of the demand on a "feels free" site — were
invisible to the content queue. They now go to `anon_search_events`, a SEPARATE
table (so "never on a member timeline" holds by construction), keyed on a random
per-device uuid in a first-party httpOnly cookie (`tm_anon`, set in `proxy.ts`
beside the UTM cookie — no IP, no fingerprint, no PII). Collapsed like the member
path, rate-limited on the session id (`anon_search` bucket). Admin-read RLS, no
write policy (server writes via service role). The content queue's search-gap
signal (`lib/contentQueue/build.ts`) reads BOTH sources into one demand count.

**The mobile footer is two bodies.** Below 768px: logo, one social row, four
tap-to-open sections (native `<details>`, so no JS and the footer stays a server
component), the legal line — dropping "Empowering education across Pakistan".
The desktop body (`hidden md:block`) is the approved layout, unchanged. Signed-in
members see no Sign Up / Login (in both bodies — showing a signed-in visitor a
login link is a wart); a link in both the Tutors and Parents sections (Sign Up,
Login) is deduped to appear once on mobile. `signedIn` comes from the
React-`cache()`d `getSessionUser()` the Navbar already calls, so no extra auth
round trip.

**Admin mutations toast and confirm.** Every remaining admin approve / reject /
suspend / grant / revoke / delete / close now shows a `useToast` toast, and the
three `window.confirm` calls (ads delete, job remove, blog delete) plus the
no-confirm destructive actions (tutor suspend, parent reject, staff role change +
suspend, import apply, blog unpublish) go through `useConfirm`. Files that already
confirmed via a required-reason input or a type-DELETE gate kept that and only
gained toasts (payments, reports, member actions, cleanup, slug).

**Cross-city "Suitable for online" chip** (`lib/matchChip.ts`, one rule for all
three surfaces). A tuition in a DIFFERENT city from the tutor is a match only if
it can be taught online; when it is, a `tm-tint-navy` chip appears beside the
mode. In-person cross-city is NOT a match and is dropped from the curated match
surfaces. Wired into: the dashboard "jobs matching you" strip (`jobsThisWeek`
loosened to include cross-city online and exclude in-person cross-city), the
browse `JobCard` (new `viewerCity` prop, fetched for signed-in tutors on
`/browse/tuitions` and the tutor jobs board; guests have no city so no chip), and
the matching-job notification (`notifyMatchingTutors` now also fans out to a
bounded set of cross-city online tutors, flagged via `notifications.meta.online_suitable`,
which `NotificationBell` renders as the chip).

## Roadmap — remaining (4 Sep 2026)

The state of the world as of this date, so the next session starts from the plan
rather than rediscovering it. Nothing here is built yet; the sections above
describe what is.

### Code, in order

1. **Blog CMS part 2 — AI drafting.** A manager enters a title and 3–5 fact
   notes and presses "Generate draft"; the server calls the Claude API
   (`ANTHROPIC_API_KEY`, server-side) with the fixed brand brief (plain, warm,
   Pakistan-specific; 900–1,400 words; answer-first; H2 sections; a table where
   useful; an FAQ block; audience CTA; links to relevant landing pages; NEVER
   invent statistics). Publish stays disabled until a human edits and ticks
   reviewed — the part-1 gate is unchanged. Covers are auto-rendered via
   `next/og` `ImageResponse` (1200×630 + 1080×1080) from title + cluster in brand
   colours, 3–4 templates rotating by cluster, with a manual-upload override
   (alt text mandatory). **The fallback when `ANTHROPIC_API_KEY` is absent is a
   first-class path, not an error branch** — the same discipline as the
   AI-assisted job posting (`lib/ai/`): no key, a failed call, unparseable JSON
   or the wrong length composes a plain draft from the notes and says so in
   words. The verifier that catches invented numbers (`unsupportedFacts`) is
   reused. No key is set in any environment today, so every generation returns
   the composed fallback until one is added.

2. **Blog CMS part 3 — the content queue (9.4).** The system suggests what to
   publish from: on-site `search_performed` events with low/zero results by
   subject×city; Google Search Console API queries at positions 8–20; the
   built-in Pakistani academic calendar (board registration Dec–Jan, Matric/Inter
   exams Mar–May, O/A Level May–Jun & Oct–Nov, results Jul–Aug, admissions
   Aug–Sep, Ramadan) suggesting six weeks ahead; content-map coverage gaps; and
   support/FAQ/report reasons. Each suggestion carries a proposed title, cluster,
   audience, language, a priority score and visible evidence lines, with Generate
   / Snooze / Dismiss-with-reason. A Monday email digest to managers lists the
   top 3 to publish plus posts due for refresh; nothing auto-publishes. The same
   engine emits **recruitment-gap cards** (high searches, few tutors) routed to
   the import/bulk-onboarding manager.

3. **Growth — social templates + typeahead pickers.** Success-story and
   announcement social templates built from the owner's reference artwork, added
   to the existing `next/og` social generator (`/admin/social`). And the
   instant-search typeahead (`components/search/Typeahead.tsx`) on the two admin
   pickers that still use a plain input: the social generator's tutor picker and
   `/admin/plans`' account search — with `suggest={false}` like `/admin/users`,
   because those screens need parents, staff and unlisted rows the public
   suggest index does not carry.

4. **Moderation — offensive-word filter.** English / Urdu / Roman-Urdu, matched
   server-side, that can block or warn on a message; the word list is
   admin-editable (a table, not a constant). Three blocks against one member in a
   day auto-files a report into the existing reports queue. It sits in the same
   server path as number-masking (`lib/masking.ts` neighbourhood) so message
   bodies are scanned once.

5. **T8b — launch remainder.** Cloudflare Turnstile on `/login` and `/register`
   via Supabase attack-protection; the nonce-based CSP threaded through
   `proxy.ts` that closes the `'unsafe-inline'` gap documented in
   `next.config.ts`; WhatsApp delivery of the T-3 expiry reminder
   (`deliverExpiryReminder`, currently email-only); the region migration to
   Mumbai `ap-south-1`; seed-data cleanup **on explicit owner instruction** (the
   directory stays populated until then — see the seed-data notes); and the merge
   of `rebuild` → `main`. Preview mode coming off is the launch gate, not a T8b
   code task — see below.

### Owner actions blocking launch (not code)

- **SMS provider** — undecided (Twilio vs a Pakistani gateway). Mobile signup on
  the live site cannot deliver OTPs until one exists. The hardest blocker.
- **SMTP** on the Supabase project — not configured; password-reset email and
  staff invites cannot send.
- **AssanPay go-live** — in negotiation; until then manual transfer + admin
  approval is the only paid path.
- **CUIN and NTN** into `app_settings` (`company.reg_no`, `company.ntn`) — until
  filled, every company-number row hides itself and the schema omits the
  identifier, by design.
- **Vercel Production Branch → `rebuild`** so a release is a normal deploy rather
  than the manual `vercel redeploy --target production` used throughout.
- **Logo artwork as one word** ("TutorMint") — the header and footer logo images
  render "Tutor Mint" (two words); the brand rule wants one word everywhere a
  member looks. New artwork is an owner/design task, not code.
- **`ANTHROPIC_API_KEY`** in Vercel — without it the AI drafting (item 1) and the
  AI-assisted job posting both serve their composed fallbacks.

### Launch day

Preview mode off (`NEXT_PUBLIC_PREVIEW_MODE=false` in Vercel, redeploy) — the one
flag that flips noindex off and lets the sitemap list tutors, tuitions, landing
pages and blog posts. Submit the sitemap to Google Search Console and Bing.
Create the Google Business Profile for the Model Town office. Do this only once
real, verified tutors are listed — submitting a sitemap while noindex is the
contradiction that wastes the launch.

### Ideas not yet decided

- **Tutor-facing search-performance panel** — "you appeared for these searches,
  at these positions". Post-launch, and it needs the Search Console API wired
  first (part 3 brings that in).
- **Meta-ads landing pages** — dedicated campaign entry pages, separate from the
  organic city×subject landing pages. Not scoped; needs an ads decision first.
