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
