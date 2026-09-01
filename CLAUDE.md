@AGENTS.md

# TutorMint — Working Rules for Claude Code (v2, post-audit)

TutorMint (tutormint.org) connects verified tutors with parents and school/academy owners in Pakistan.
Stack: Next.js 16 App Router, TypeScript, Tailwind v4, **Supabase only** (Postgres + Auth + Storage). Vercel. YouTube Data API for tutor verification videos.
Design tokens already in use: primary red `#d60008` (brand doc says `#B3191F` — use `#d60008`, it's what the 75 pages use), headings `#0F172A`, text `#334155`, success `#059669`, page bg `#F8FAFC`. Keep this system; don't restyle.

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
- [ ] **T6 Packages** — `/tutor/packages`, `/parent/packages`, payment submission, `lib/entitlements.ts`, badges + Featured tag on `TutorCard` and job cards, contact-field filtering, `usage_counters`, expiry downgrade function (pg_cron or Vercel cron).
- [ ] **T7 Admin** — layout gate, tutor verification queue (video / CNIC / degrees), parent verification queue, payments approval, quota usage view, YouTube visibility toggle.
- [ ] **T8 Hardening** — RLS audit, `.env` on Vercel, remove every `techguy3286@gmail.com` / test phone fallback, `npm run build` clean.

## Design system & responsiveness (applies to every task)

**Mobile-first, always.** Write Tailwind base classes for a 360px viewport first, then add `sm:` / `md:` / `lg:` overrides. Test every page at 360, 390, 768, 1024, 1280 before calling it done. No horizontal scroll at any width. Tap targets ≥ 44px. Sticky bottom action bar on mobile for primary actions (Apply / Post Job / Send Message).

Reference mockups live in `design/reference/` (tutor card + badge set). They are references, not assets — do not embed the JPEGs.

### Badges (`components/badges/`)
Build as inline SVG React components, each accepting `size` (`'sm' | 'md'`) and `showLabel`. Circle background, white glyph, subtle diagonal shade like the reference.

| Component | Colour | Glyph | Earned by |
|---|---|---|---|
| `VerifiedBadge` | `#059669` green | check mark | tutor: verification passed + 100% profile; parent: CNIC + address verified |
| `PremiumBadge` | `#1E293B` navy | lightning bolt | tutor plan premium or featured |
| `FeaturedBadge` | `#F59E0B` gold | crown | tutor plan featured / parent plan featured |
| `FeaturedTag` | gold bg, dark text, `text-[10px]` pill | "Featured" | same as above — sits on the card corner |

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
- Keep and wire later: `demo_feedback` → rename `demo_requests`; `tutor_slots` (availability — T4); `user_blocks` (T5 chat); `academy_affiliations` (school/academy accounts); `profile_views` (tutor dashboard stat); `penalties_log` (admin).
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

## Homepage is LOCKED (partner-approved design)

- Reference: design/reference/homepage.png. app/page.tsx must match it: logo header, pill "PAKISTAN'S LARGEST VERIFIED TUTORS & TEACHERS NETWORK", green "HIRE", headline "Trusted, Degree-Verified Tutors/Teachers FREE" (FREE in brand red), red italic subline, the two large buttons (green "Find Tutors / Teachers" → /browse/tutors, blue "Find Tuitions / Jobs" → /browse/tuitions), dark footer with the four link columns + social icons + WhatsApp bubble.
- Permitted changes only: link targets, mobile responsiveness (stack the two buttons on <640px), generateMetadata/SEO, and accessibility fixes. NO new sections, no ads slot, no featured-tutor strip, no copy changes without an explicit owner instruction in the prompt.
- The earlier "homepage featured strip" idea is dropped; featured prominence lives on /browse/tutors ranking only.
