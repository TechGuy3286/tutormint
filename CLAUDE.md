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
3. Role lives in `profiles.role` (`'tutor' | 'parent' | 'admin'`). Parents have `profiles.account_type` (`'parent' | 'school'`). Never probe multiple tables to guess role.
4. Role gating is server-side in `app/tutor/layout.tsx`, `app/parent/layout.tsx`, `app/admin/layout.tsx` (server components via `@/lib/supabase/server`). Client components read the user for display only.
5. Every API route that writes calls `supabase.auth.getUser()` first and scopes writes to that user (copy the pattern from `api/parent/jobs`). Admin routes additionally check `profiles.role = 'admin'`.
6. Entitlements are enforced **server-side** (RLS + `lib/entitlements.ts`), never only by hiding a button.
7. No hardcoded secrets, emails, phone numbers, or mock data in shipped pages.
8. Read `node_modules/next/dist/docs/` before writing Next code. `middleware.ts` → `proxy.ts` per Next 16.
9. `npx tsc --noEmit` and `npm run build` must pass before any task is declared done.

## Canonical tables (Supabase)

`tutor_profiles` is canonical for tutors. `tutors`, `profiles` (old), `parents`, `parent_profiles` are legacy and get migrated then dropped.

- `profiles` — `id (= auth.users.id)`, `role`, `account_type`, `full_name`, `email`, `phone`, `whatsapp`, `phone_verified_at`, `city`, `province`, `address`, `cnic_number`, `cnic_image_path` (private bucket `identity-docs`), `cnic_verified_at`, `address_verified_at`, `avatar_url`, `profile_completion int`, `created_at`
- `tutor_profiles` — `id (= profiles.id)`, `slug unique`, `headline`, `bio`, `subjects text[]`, `class_levels text[]`, `degrees text[]`, `teaching_mode`, `online_platforms text[]`, `area`, `hourly_rate_pkr`, `experience_years`, `video_youtube_id`, `video_status ('none'|'uploaded'|'approved'|'rejected')`, `verification_status ('pending'|'verified'|'rejected'|'suspended')`, `rating_avg`, `rating_count`
- `plans` — seed rows (see matrix). `code`, `audience ('tutor'|'parent')`, `name`, `price_pkr`, `duration_days = 30`, `monthly_quota`, `displayed_quota text`, `can_view_contact`, `can_whatsapp`, `can_initiate_message`, `search_rank int`, `badges text[]`, `tag_label`
- `subscriptions` — `id`, `user_id`, `plan_code`, `starts_at`, `expires_at`, `status ('active'|'expired'|'cancelled')`, `payment_id`
- `payments` — `id`, `user_id`, `plan_code`, `amount_pkr`, `method ('jazzcash'|'easypaisa'|'bank'|'assanpay')`, `reference`, `screenshot_path`, `status ('pending'|'approved'|'rejected')`, `reviewed_by`, `reviewed_at`, `created_at`
- `usage_counters` — `user_id`, `period (YYYY-MM)`, `jobs_applied int`, `jobs_posted int`, `messages_initiated int`, unique(user_id, period)
- `jobs` — `id`, `job_tx_id` (keep existing human id), `parent_id`, `title`, `subjects text[]`, `class_level`, `city`, `area`, `teaching_mode`, `budget_pkr`, `description`, `status ('open'|'closed'|'hired')`, `hired_tutor_id`, `is_featured bool` (derived from parent plan at post time), `created_at`
- `applications` — `id`, `job_id`, `tutor_id`, `message`, `status ('applied'|'shortlisted'|'hired'|'rejected')`, `created_at`, unique(job_id, tutor_id)
- `messages` — `id`, `thread_id`, `sender_id`, `body`, `created_at`; `threads` — `id`, `job_id nullable`, `participant_a`, `participant_b`, `initiated_by`
- `reviews` — `id`, `tutor_id`, `parent_id`, `rating`, `comment`, `created_at`
- `phone_otps` — `phone`, `code`, `expires_at`, `consumed_at`, `attempts`
- `taxonomy_master` — keep as is (used by `lib/taxonomy.ts`)

Hired/closed status moves from localStorage into `jobs.status` + `jobs.hired_tutor_id`.

## Entitlements matrix (the product spec — implement exactly)

### Tutor plans
| Plan | PKR/mo | Badges shown | Apply quota (real / displayed) | View parent contact & WhatsApp | Send WhatsApp | Initiate in-app message | Search rank |
|---|---|---|---|---|---|---|---|
| verified | 199 | Verified | 10 / "10" | no | no | no — can only reply to messages received and apply via job application | 1 (low) |
| premium | 499 | Verified + Premium | 25 / "25" | no | yes | yes, any parent | 2 |
| featured | 999 | Verified + Premium + Featured (yellow tiny "Featured" tag on card) | 100 / "Unlimited" | yes | yes | yes | 3 (top) |

- Profile completion (100%) is mandatory before any badge shows or any paid plan activates. A tutor may pay first; the badge appears when completion hits 100% and admin verification passes.
- Unverified / incomplete tutors are **not listed** in `/browse/tutors`.

### Parent plans
| Plan | PKR/mo | Badge | Post quota (real / displayed) | View tutor contact & WhatsApp | Initiate message | Job ranking |
|---|---|---|---|---|---|---|
| parent_verified | free | Verified (after CNIC + address verified) | 5 / "5" | no | no — can reply only | standard |
| parent_featured | 999 | Verified + yellow tiny "Featured" tag on jobs | 100 / "Unlimited" | yes | yes, any tutor | top |

- Free parents see tutor results in standard rank order (featured/premium tutors still on top — that's what tutors pay for).
- Admin dashboard shows real quota usage vs the 100 cap for every "Unlimited" user.

### Enforcement
`lib/entitlements.ts` exports `getEntitlements(userId)` → `{ plan, quotaLeft, canViewContact, canWhatsapp, canInitiateMessage }`. Every gated API route calls it. Contact fields are **never** returned to the client unless `canViewContact` — filter them in the route/RLS, don't just hide them in JSX.

## Auth & verification flows

- **One `/login`** (email + password). After sign-in read `profiles.role` once → `/tutor/dashboard` | `/parent/dashboard` | `/admin`. `/parent/login` and `/tutor/login` become server redirects to `/login` (keep inbound links working).
- **One `/register`** with role choice: Tutor / Parent / School or Academy. Creates auth user + `profiles` row (+ `tutor_profiles` row with `verification_status='pending'` for tutors).
- **Email verification**: Supabase "Confirm email" is ON. Handle `/api/auth/callback` code exchange. Unconfirmed users see a "check your inbox" screen, can resend.
- **Phone/WhatsApp OTP** happens during profile completion, not signup. `POST /api/auth/otp` (send) and `/verify`. OTP must check `expires_at`, be single-use (`consumed_at`), max 5 attempts. In non-production, if `DEV_DEFAULT_OTP` env is set, that code always passes — so multiple test users can be verified. Never read `DEV_DEFAULT_OTP` when `NODE_ENV=production`.
- **Tutor video**: recorded/uploaded via `app/tutor/upload-youtube` → uploaded to the official channel as **private** → `tutor_profiles.video_youtube_id` + `video_status='uploaded'`. Admin reviews, then sets `video_status='approved'` and may switch the video to unlisted/public via YouTube API. Route must require auth + `role='tutor'`; `googleapis` declared in package.json; `YOUTUBE_*` env vars documented in `.env.example`.
- **Parent verification**: CNIC image → private bucket `identity-docs` (RLS: owner + admin only), address text. Admin approves → `cnic_verified_at`, `address_verified_at` → Verified badge.
- **Admin**: `profiles.role='admin'`, set via SQL for the owner's account. `app/admin/layout.tsx` server-gates. All hardcoded passwords and `adminAuth` localStorage removed.

## Pages to keep (canonical) and delete

Keep: `/`, `/browse/tutors` (+`/browse/tutors/[id]`), `/browse/tuitions`, `/tutor/[slug]` public profile, `/login`, `/register`, `/tutor/dashboard/*` (`settings`, `jobs`, `messages`, `notifications`), `/parent/dashboard/*`, `/chat/[jobId]`, `/admin/*`, `/about`, `/faq`, `/privacy`, `/terms`, `/support`, `/blog`, `/review`.
`/browse` → redirect to `/browse/tutors`. Homepage keeps the two buttons: **Find a Tutor** → `/browse/tutors`, **Find Tuitions** → `/browse/tuitions`.

Delete: the whole Mongo layer, `/parent/browse`, `/parent/post-job`, `/parent/signup`, `/tutor/settings`, `/tutor/jobs`, `/tutor/[username]`, `/tutor-profile`, `/faqs`, `/chat/[id]`, `app/browse/tutors/[id]` (keep `app/browse/[id]` content but move it to `app/browse/tutors/[id]`), `lib/lib/`, `lib.rar`, `New folder/`, `api/tutor/login`, `api/auth/parent-login`, old `/register`.

## Ordered task list (one PR each, stop after each)

- [x] **Build fix** — dynamic-segment conflicts, TutorCard props, declare `googleapis`.
- [ ] **T0 Cleanup** — every deletion above. Remove `mongoose` and `MONGODB_URI`. Rename `middleware.ts` → `proxy.ts`. Add `.env.example`.
- [ ] **T1 Schema** — SQL migration file in `supabase/migrations/` creating/altering tables above, seeding `plans`, RLS on everything, storage buckets `avatars` (public) and `identity-docs` (private). Migrate rows from legacy tables. Drop legacy tables last.
- [ ] **T2 Auth spine** — `proxy.ts` with `@supabase/ssr` session refresh + route protection; `lib/auth.ts` `getSessionUser()`; three server layouts; single `/login` + `/register`; email confirmation callback; sign-in-to-continue modal component with draft preservation.
- [ ] **T3 Verification** — profile completion % (`lib/profileChecklist.ts` exists — extend it), phone OTP with `DEV_DEFAULT_OTP`, CNIC upload, YouTube upload route hardened.
- [ ] **T4 Tutor side** — real `/tutor/dashboard` (completion, plan, quota left, matching open jobs), `/tutor/[slug]`, `/browse/tutors` listing only verified, ranked by plan.
- [ ] **T5 Parent side** — post job (quota-checked), job detail + applicants, hire flow writes `jobs.status`, `/browse/tuitions`, chat on `threads/messages`.
- [x] **T6 Packages** — `/tutor/packages`, `/parent/packages`, payment submission, `lib/entitlements.ts`, badges + Featured tag on `TutorCard` and job cards, contact-field filtering, `usage_counters`, expiry downgrade function (pg_cron or Vercel cron).
- [x] **T7a Admin, part 1** — /admin/team (owner only), reports & penalties queue, member directory + timeline, audit view, dashboard by role, video visibility toggle.
- [x] **T7b Admin, part 2** — advertisements with weighted rotation, social post generator, bulk tutor import with mobile login and claim flow, junk-user cleanup.
- [x] **T8a Launch hardening** — legacy retirement, RLS audit + CI gate, email/SMS delivery, unknown-input polish, Terms & Privacy, security headers, production readiness, backups.
- [ ] **T8b** — region migration to Mumbai `ap-south-1`, Turnstile, nonce-based CSP, WhatsApp delivery, legacy NOT NULL columns on `jobs`/`messages`.

## Design system & responsiveness (applies to every task)

**Mobile-first, always.** Write Tailwind base classes for a 360px viewport first, then add `sm:` / `md:` / `lg:` overrides. Test every page at 360, 390, 768, 1024, 1280 before calling it done. No horizontal scroll at any width. Tap targets ≥ 44px. Sticky bottom action bar on mobile for primary actions (Apply / Post Job / Send Message).

Reference mockups live in `design/reference/` (tutor card + badge set). They are references, not assets — do not embed the JPEGs.

### Brand colour system — the only permitted colours

Defined in `app/globals.css` under `@theme`, so each one becomes a full Tailwind
utility family (`bg-tm-red`, `text-tm-navy`, `border-tm-gold/30`, …).
**Supersedes `#d60008` and `#059669` and every other raw value.**

| Token | Hex | Use |
|---|---|---|
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
|---|---|---|---|
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
|---|---|---|---|---|
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

## Actual Supabase state (from Table Editor, 31 Aug 2026) — reconcile in T1

Existing tables: academy_affiliations, advertisements, demo_feedback, job_messages, jobs, messages, parent_jobs, parent_profiles, parents, penalties_log, phone_otps, profile_views, profiles, reviews, taxonomy_categories, taxonomy_levels, taxonomy_master, taxonomy_subjects, tuition_applications, tuitions, tutor_activities, tutor_applications, tutor_profiles, tutor_slots, tutor_trust_fees, tutors, user_blocks.

- **RLS is OFF ("Unrestricted") on `parents`, `phone_otps`, `profiles`.** Enabling RLS on every table is the first statement of the T1 migration, before anything else.
- Three job tables exist (`jobs`, `parent_jobs`, `tuitions`) and two application tables (`tutor_applications`, `tuition_applications`). Canonical: `jobs` and `applications`. Migrate rows from the others, then drop.
- Two message tables (`messages`, `job_messages`). Canonical: `threads` + `messages`.
- Keep and wire later: ~~`demo_feedback` → rename `demo_requests`~~ **superseded in T5**: `demo_requests` is the request and `demo_feedback` is the rating that follows one, joined by `demo_feedback.demo_request_id`. Both are canonical; neither was retired in T8a.
- Also keep and wire later: `tutor_slots` (availability — T4); `user_blocks` (T5 chat); `academy_affiliations` (school/academy accounts); `profile_views` (tutor dashboard stat); `penalties_log` (admin).
- `advertisements` — ask the owner what this was for before touching it.
- In T1, dump `information_schema.columns` for every table above into `supabase/schema-before.md` so the migration is written against real column names, not guesses.

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

## Member activity timeline (spec now; events logged from T3 onward; admin UI in T7)

- user_activity_log (id, user_id, event text, target_type, target_id, meta jsonb, created_at). Written via lib/activity.ts logActivity() from server code paths only. RLS: user reads own; admins (owner/manager/support) read all; no updates/deletes.
- Events: registered, login, otp_verified, profile_updated, completion_changed, subjects_changed, document_uploaded, video_submitted, job_posted/edited/closed, application_submitted/withdrawn, demo_requested/accepted/declined/completed, message_sent (thread id only — never message content), shortlist_added/removed, plan_purchased/expired, block/report given and received, verification decisions received.
- Every task from T3 onward MUST log its events through this helper as the feature is built (add to each task's checklist).
- Admin UI (T7): members list → member detail page = profile summary + verification state + plan/subscription history + filterable event timeline (newest first), alongside admin_audit_log entries targeting that member.
- Privacy line: message CONTENT is admin-readable only through the reports queue when a participant reports the thread; there is no general chat-browsing screen. Timeline shows message events, never bodies.
- Legacy tutor_activities is superseded; migrate/rename in T8.

## Member activity timeline (logging from T3.5; screen in T7)

- activity_log (id, user_id, event_type, target_type, target_id, metadata jsonb, created_at). lib/activityLog.ts logActivity() called from server code on: register, login, profile update, otp_verified, doc_uploaded, video_submitted (attempt #), subjects_changed, job posted/edited/closed, applied, application_withdrawn, hired/was_hired, message_sent (thread ref only — never message text in metadata), demo requested/accepted/completed, plan purchased/expired, payment submitted, report filed/received, block created/received, suspended/unsuspended. Every feature built after T3.5 MUST instrument its mutations.
- /admin/users/[id] (T7): profile summary + filterable event timeline + linked objects (their jobs, applications, payments, subscriptions, reports, admin_audit_log entries about them). Clicking a member anywhere in admin routes here.
- Message content never renders in the timeline; thread links only (thread content access stays governed by the reports/admin policy).
- Visibility: owner/manager/support full timelines; verifier and finance only via their queue contexts. RLS: inserts via server path; admins read; no update/delete.
- Legacy tutor_activities table: migrate any useful rows into activity_log in T7, then legacy_* rename in T8.

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

## Graceful handling of unknown input (T8 polish checklist)

- Branded app/not-found.tsx, app/error.tsx, global-error.tsx, and an offline state: friendly copy + links to /browse/tutors, /browse/tuitions, /. Suspended/unclaimed tutor slugs → 404 page with the same shell. No raw framework errors ever reach users.
- Empty states for every list (search results, jobs, applications, messages, notifications, demos, shortlists): a sentence + 1–3 concrete actions. Search no-results must offer: widen to whole city, include online tutors, post a job.
- Form validation: friendly inline messages stating the expected format (mobile 03xx-xxxxxxx, CNIC 5-7-1 digits, fee as number), input normalisation (strip spaces/dashes, "5k" → 5000 with confirmation), never lose typed content on error, Urdu text accepted in free-text fields.
- Help: /support rebuilt as FAQ-first (questions grouped for tutors/parents incl. "refunds" → no-refund policy + terms link, "how verification works", "why can't I hire") with a one-tap WhatsApp + email fallback. AI help bot is post-launch backlog, not built now.
- Unknown API input: every route validates with zod (or equivalent) and returns structured 400s with a human message; the UI renders that message.

## Register / login form rules (owner, 1 Sep)

- /register is minimal: role as two plain radio buttons "Tutor" / "Parent" at the top — NO mention of school or academy anywhere on auth forms (schools register as parents; only the FAQ explains this). Fields: full name, email, password, create button, "already have an account" link — nothing else. City (and every other detail) is collected in profile completion, never at signup. Card centred at all widths.
- Same minimal treatment for /login (email-or-mobile + password + forgot password + register link).
- Implemented in T8a. /register now: two radio buttons (Tutor / Parent), full name, email, password, a one-line terms + photo-consent acceptance, and the sign-in link. City removed — it is collected in profile completion. /login gained /forgot-password, which reports the same thing whether or not the address has an account (a reset form that says "no such account" is a membership oracle). **Password-reset delivery needs SMTP on the Supabase project, which is not configured yet** — see PRODUCTION_CHECKLIST.md.
- The one deviation from "nothing else": the terms acceptance stays. It is a checkbox, not a data field, and T8a scope item 6 requires the photo-use consent to be shown at tutor signup. Consent given by implication through a link nobody opens is not consent anybody would recognise having given.

## Legal entity (owner, 1 Sep 2026)

- Legal name: Tutor Mint (Private) Limited — short form "Tutor Mint (Pvt) Ltd". Brand/trading name everywhere users look: "TutorMint". Two-word legal form appears ONLY in legal contexts: footer copyright line, Terms, Privacy, receipts/invoices, payment merchant name, About/Contact.
- Registered office: 4th Floor, 37-M, Civic Center, Model Town, Lahore, Punjab, Pakistan. Official email support@tutormint.org. Business WhatsApp +92 321 5872222 (from app_settings, never hardcoded). Financial year end 30 June. Regulator: SECP, Companies Act 2017.
- Directors (public record): Mohson Raza (CEO & Director), Sabir Ali (Director). No other personal data from the incorporation form (CNICs, DOBs, home addresses, personal emails) may appear anywhere in the codebase, DB seeds, or UI.
- Placeholders until supplied by owner: SECP registration number (CUIN) → `{{COMPANY_REG_NO}}` in Terms/footer; NTN → `{{COMPANY_NTN}}` on receipts. Read both from app_settings so no code change is needed later.
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
