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
14. **Nothing is deleted — with one exception:** personal data erased at the member's own request (owner, 27 Oct 2026; see "Close account and erase personal data"). Every other "nothing is deleted" rule in this file stands.

## Canonical tables (Supabase)

`tutor_profiles` is canonical for tutors. The ten pre-rebuild tables (`tutors`, `parents`, `parent_profiles`, `parent_jobs`, `tuitions`, `tutor_applications`, `tuition_applications`, `job_messages`, `tutor_activities`, and the old `profiles` shape) were **renamed to `legacy_*` in T8a, not dropped** — a forgotten caller must break visibly and the rows must remain findable.

- `profiles` — `id (= auth.users.id)`, `role`, `admin_role ('owner'|'admin'|'supervisor'|'operations'|'tuitions_staff'|'partner', null unless role='admin')` (migration 150 added 'partner' — view-only; migration 198 added 'supervisor'), `former_staff_at` / `former_staff_role` / `former_staff_by` (migration 198 — staff access removed in the clean-up; the account stays an ordinary member; read back by the Owner's "Restore staff access"), `full_name`, `email`, `phone`, `whatsapp`, `phone_verified_at`, `phone_gate_required bool default false`, `paused_by_user_at timestamptz` (migration 151 — the member paused their own account; separate from `is_suspended`/`is_banned`; cleared by their next sign-in), `address_status ('pending'|'approved'|'rejected')` + `address_reason` + `address_reviewed_by` + `address_reviewed_at` (migration 152 — a parent's typed address reviewed on its own; the CNIC keeps `verification_state`), `phone_verified_via ('otp'|'bridge'|null)` (migration 58 — how the number was proved; 'bridge' = the BRIDGE_OTP stopgap, no plan/badge until re-verified), `city`, `province`, `address`, `cnic_number`, `cnic_image_path` (private bucket `identity-docs`), `cnic_verified_at`, `address_verified_at`, `avatar_url`, `profile_completion int`, `is_suspended bool`, `is_banned bool default false` + `banned_at` + `banned_reason` + `banned_by` (migration 58 — a PERMANENT status distinct from suspend), `email_opt_out bool`, `welcomed_at`, `last_message_digest_at`, `must_change_password bool`, `is_team_account bool default false` (migration 63 — the one team-operated TutorMint parent account that admin-posted jobs belong to; public surfaces render the TutorMint identity for it), `linked_account_id uuid` (migration 154 — the member's second-role account on the same mobile, linked both ways; at most one tutor + one parent per mobile, unique index on (phone_number, role)), `is_test_name bool` (migration 154 — GENERATED: name contains the whole word "test" or is exactly "New User"; such accounts work but never reach Browse, search, landing pages, the sitemap or Overview counts), `profile_pic_rereview_at timestamptz` (migration 157 — the member changed an APPROVED photo; stamped by the `profiles_photo_rereview` trigger on any member-side avatar change; the photo waits for review while `profile_pic_status` stays 'approved'), `created_at`
- `tutor_profiles` — `id (= profiles.id)`, `slug unique`, `headline`, `bio`, `class_levels text[]`, `degrees text[]`, `teaching_mode`, `online_platforms text[]`, `area`, `hourly_rate_pkr`, `experience_years`, `video_youtube_id`, `video_status ('none'|'uploaded'|'approved'|'rejected')`, `video_submissions int` (3-strike cap), `verification_status ('pending'|'verified'|'rejected'|'suspended')`, `verified_fee_paid_at timestamptz` (migration 86 — the ONE-TIME Rs 199 verification fee; set = the tutor is listed on the free Basic tier; NULL = unverified, not listed), `under_review bool default false` + `review_reason` (migration 58 — a reported profile; delisted from `tutor_directory` but still renders via `tutor_visible_profiles`), `is_featured bool`, `imported bool default false`, `claimed_at timestamptz`, `rating_avg`, `rating_count`
- **Subjects are join tables, not arrays.** `tutor_subjects(tutor_id, master_id)` and `job_subjects(job_id, master_id)` reference `taxonomy_master.id`. `tutor_profiles.subjects text[]` and `jobs.subjects text[]` are retired — any remaining column is legacy and must not be read.
- `plans` — seed rows (see matrix). `code`, `audience ('tutor'|'parent')`, `name`, `price_pkr`, `duration_days = 30`, `monthly_quota`, `displayed_quota text`, `can_view_contact`, `can_whatsapp`, `can_initiate_message`, `can_hire`, `can_see_viewer_identity`, `search_rank int`, `badges text[]`, `tag_label`, `active boolean default true` (migration 86 — false hides a row from the purchasable tiers; the old tutor `verified` row is kept `active=false` as the one-time-fee marker that `payments.plan_code`/`subscriptions.plan_code` FKs still need). Tutor rows: `basic` (free), `premium` (499), `featured` (999); `verified` (199, active=false) is the fee, not a plan a tutor holds.
- `subscriptions` — `id`, `user_id`, `plan_code`, `starts_at`, `expires_at`, `status ('active'|'expired'|'cancelled')`, `payment_id`, `reminded_at`
- `payments` — `id`, `user_id`, `plan_code`, `amount_pkr`, `provider`, `provider_ref` (idempotency key, unique per `(provider, provider_ref)`), `method ('jazzcash'|'easypaisa'|'bank'|'assanpay')`, `reference`, `screenshot_path` (private bucket `payment-proofs`), `status ('pending'|'approved'|'rejected')`, `reviewed_by`, `reviewed_at`, `created_at`, `return_to` (migration 174 — a same-site path to send the tutor back to after paying the Verification Fee: the tuition they tapped Apply on; server-written through `lib/returnTo` `paymentReturnTo`, CHECKed), `checkout_closed_at` / `checkout_close_reason` (cancelled_by_member | expired | already_paid | already_has_it | no_valid_checkout | paid_another_way — migration 189) / `checkout_closed_by` (migration 185 — a pending checkout MARKED closed; status unchanged, so a late PayPro payment still activates; reopened when the checkout is reused or a receipt is attached)
- `usage_counters` — `user_id`, `period (YYYY-MM, UTC calendar month)`, `jobs_applied int`, `jobs_posted int`, `messages_initiated int`, unique(user_id, period)
- `jobs` — `id`, `job_tx_id` (keep existing human id), `parent_id`, `child_id nullable`, `title`, `class_level` (a collapsed display string, e.g. "Grade 1–5"), `class_levels text[]` (migration 79 — the multi-select levels; `class_level`/`grade` mirror the collapsed run), `city`, `area`, `teaching_mode`, `budget_pkr`, `description`, `status ('open'|'closed'|'hired')`, `hired_tutor_id`, `is_featured bool` (cache of the parent's plan via `applyPlanFlags()`), `under_review bool default false` + `review_reason` (migration 58 — a reported tuition; stays visible with an amber sticker, Apply paused), `self_paused_at` (migration 151 — paused by the parent's own "Pause my account"; reopened with one tap), `hidden_at` / `hidden_prev_status` / `hidden_reason` and status `'hidden'` (migration 198 — the poster's account is hidden, test, suspended or banned; a trigger on profiles keeps it in step and un-hiding restores the status each tuition had), `created_at`
- `applications` — `id`, `job_id`, `tutor_id`, `message`, `status ('applied'|'shortlisted'|'hired'|'rejected')`, `created_at`, unique(job_id, tutor_id); `stage ('applied'|'forwarded'|'contacted'|'demo'|'hired'|'not_selected'|'no_response')` + `stage_changed_at` / `stage_changed_by` / `stage_changed_by_name` (migration 192 — staff application tracking; only the service role changes them, a trigger refuses any signed-in token; a stage never changes the tuition); `worked_at` / `worked_by` / `worked_by_name` (migration 193 — the last staff or parent activity: a stage change, a WhatsApp check-in tap, a forward; same trigger lock)
- `application_stage_events` (migration 192) — every stage change: `application_id`, `job_id`, `tutor_id`, `from_stage`, `to_stage`, `staff_id`, `staff_name`, `created_at`. Admin-read RLS, service-role writes.
- `tuition_owners` (migration 192) — the staff member responsible for a tuition's applications (the one who posted it, else its city owner): `job_id` (pk), `staff_id` (null = Unassigned), `source ('poster'|'reassigned'|'city')` ('city' migration 193), `posted_by` (migration 193 — the staff poster, never changed by a reassign; null = no staff poster), `assigned_by`, `assigned_by_name`, `assigned_at`. A DEDICATED table because `jobs` is public-read. No row = Unassigned. Admin-read RLS, service-role writes; only the Owner reassigns. `job_applied_counts(uuid[])` (SECURITY DEFINER, anon-callable) returns `(job_id, applied)` — a count only.
- `application_follow_ups` (migration 194) — every Applications follow-up: `application_id`, `job_id`, `tutor_id`, `stage`, `kind` (follow_up | tutor_update), `recipient` (parent | tutor — the TYPE, never a number), `message_key`, `staff_id`, `staff_name`, `created_at`, `undone_at` / `undone_by` (Undo stamps, never deletes), `forward_id` + `restore` (migration 195 — the forward an Applied message made, and the stage fields it replaced, for its Undo). Admin-read RLS, service-role writes. `applicant_forwards` gained `undone_at` / `undone_by` (migration 195 — a forward taken back by that Undo; every reader filters `undone_at is null`).
- `city_owners` (migration 193) — `city` (pk), `staff_id` (null = no owner → the site Owner), `updated_by`, `updated_by_name`, `updated_at`: who owns each city's tuitions that no staff member posted. Admin-read RLS, service-role writes; only the site Owner edits (Tuitions → City owners). Seeded from the owner's 22 Oct 2026 list.
- `threads` — `id`, `job_id nullable`, `participant_a`, `participant_b`, `initiated_by`; `messages` — `id`, `thread_id`, `sender_id`, `body` (stored raw; rendered masked when either side lacks contact rights), `created_at`
- `children` — `id`, `parent_id`, `name`, `class_level` (a parent dashboard supports multiple children; a job may reference one)
- `shortlists` — `(user_id, tutor_id)` unique. Replaces the `tutormint_saved_tutors` localStorage key.
- `demo_requests` — `id`, `parent_id`, `tutor_id`, `mode ('online'|'in_person')`, `scheduled_at`, `status`, `created_at`; `demo_feedback` — the rating that follows one, joined by `demo_feedback.demo_request_id`. **Both are canonical**; neither was retired.
- `reviews` — `id`, `tutor_id`, `parent_id`, `rating`, `comment`, `created_at`; migration 204 added `status ('pending'|'approved'|'rejected')`, `application_id` (unique — one review per hire), `decided_by`, `decided_at`, `decision_reason`. Only approved rows are public or counted in the rating.
- `do_not_use_numbers` / `contact_withdrawals` (migration 207) — the Do not use list: `number_hash` (sha256 of `tm-do-not-use:<msisdn>`, never the number), `masked` (0300 •••• 123), `reason`, `source` (withdraw | manual), `added_by` / name / at, `removed_at` / by / name / reason (stamped, never deleted; one live row per hash). `contact_withdrawals`: one row per "Withdraw a contact" — hash, masked, reason, who, when, `summary` (tuition ids, counts). Both RLS on with NO policies: service role only; the Owner reads them through a server route. `jobs.hidden_reason` may be `'contact_withdrawn'`.
- `tuition_consents` (migration 208) — ONE row per tuition (`job_id` pk): `status` (recorded | not_recorded), `method` (phone | whatsapp | in_person | parent_posted — set exactly when recorded), `recorded_by` / `recorded_by_name` / `recorded_at`, optional `note`. A parent's own post is written "Recorded — Parent posted it themselves" by the AFTER INSERT trigger `jobs_tuition_consent`; a staff (team account) post starts Not recorded and createTeamJob records the consent the form required. A DEDICATED table because `jobs` is public-read. Admin-read RLS, service-role writes. `app_settings` 'privacy.hide_unconsented_numbers' (default 'true').
- `account_erasures` (migration 203) — a "Close account and erase data" request: `member_id`, `role`, `status` (scheduled | cancelled | done | failed), `source` (owner | member), `requested_by` + name, `reason`, `identity_check`, `requested_at`, `due_at` (7-day grace), `cancelled_at` / `cancelled_by`, `done_at`, `error`, `slug_hashes` (sha256 of old tutor addresses), `city`, `summary`. Admin-read RLS, service-role writes. `phone_otps.purpose` may also be `'erase'`; `jobs.hidden_reason` may be `'parent_erased'`.
- `phone_otps` — `phone`, `purpose ('verify'|'reset')`, `code`, `expires_at`, `consumed_at`, `attempts`
- `pending_signups` (migration 75) — the draft of an UNVERIFIED mobile signup, held until the code verifies so NOTHING is persisted (no auth user, no `profiles` row, no synthetic `<msisdn>@users.tutormint.org`) for a signup that never completes: `token` (pk, also in the httpOnly `tm_pending_signup` cookie), `role`, `full_name`, `mobile`, `password_hash` (BCRYPT, never plaintext — the account is created with GoTrue admin `password_hash`), `code`, `utm`, `attempts`, `created_at`, `expires_at` (`created_at + 10 min`). Service-role only: RLS on with NO policies (the `phone_otps` pattern). Read/written via `lib/pendingSignup.ts`; the account is created from this row by `verifyPendingSignup()` on `/api/auth/register/verify`, and the session is minted with a magic-link token so no plaintext is needed. The duplicate-mobile check at signup reads real `profiles`, never this table.
- `user_activity_log` — the member timeline (see that section). `admin_audit_log` — every admin mutation. `user_blocks`, `penalties_log`, `profile_views`, `academy_affiliations`, `tutor_slots` — kept and wired per their tasks.
- `advertisements` + `ad_events` — see the advertisements spec. `app_settings` — support contact, pay details, `{{COMPANY_REG_NO}}`, `{{COMPANY_NTN}}`.
- `admin_messages` (migration 58) — the official TutorMint Team ↔ member channel: `id`, `member_id`, `direction ('out'|'in')`, `admin_id` (who sent an 'out'; never shown to the member), `template_key`, `body`, `read_at`, `created_at`. A DEDICATED store, deliberately NOT `threads`, so the "no chat-browsing screen" line holds by construction. Read at `/admin/inbox` and, for the member, in the role inbox's pinned Team row (Part 5). RLS: `member_id = auth.uid() or is_admin()`; every write is a server path.
- `admin_message_templates` (migration 58) — owner/manager-editable templates seeded with cnic_unclear, address_untraceable, job_under_review, video_rerecord, profile_completion_nudge, payment_received, payment_approved, and (migration 64) the three abandoned-signup outreach templates signup_email_unconfirmed, signup_mobile_unverified, signup_profile_unfinished, and (migration 65) seeded_tuition_live (a `{tuition_url}` placeholder joins `{name}`): `key`, `title`, `subject`, `body` (`{name}`/`{job_title}`/`{reason}`/`{tuition_url}` placeholders). Admin-read RLS.
- `job_contacts` (migration 65, extended migration 76) — the real poster's contact for a seeded (admin-posted) tuition, keyed 1:1 by `job_id` (cascade): `contact_name`, `contact_phone`, `contact_whatsapp`, `contact_email`, `contact_address`, `contact_social` (migration 76), `created_by`, `created_at`. All optional; only what was filled is stored. A DEDICATED table, NOT columns on `jobs`, because `jobs` has a public row-read policy and RLS cannot hide a column — so a contact on the jobs row would be one `select('*')` away from a public, indexed page. Admin-read RLS (`is_admin()`), service-role writes only (createTeamJob); no anon/member read. Normalised/validated by `buildJobContact()` (`lib/jobContactCore.ts`) before write — phone and WhatsApp to canonical MSISDN, email shape-checked, address/social free text — and read via `loadJobContact()`. Rendered only for a signed-in tutor on the job page and on `/admin/jobs/[id]`, both via the service role; never in metadata, JSON-LD, OG or the sitemap.
- `posts.cover_prompt text` (migration 171) — the scene prompt a post's cover was made from, saved with the cover so it can be made again. Shown in the admin editor; no public page selects it. NULL for covers set before 14 Oct 2026.
- `finance_alerts` (migration 200) — Finance → Needs attention items that are not money: `kind` (paypro_late | email_unreadable | email_unverified | mailbox_locked | email_unclear | reader_failing), `ref` (unique with kind — an order number, a Message-ID, 'reader:<since>'), `title`, `detail` (plain words — never a body, account number, email address or phone), `amount_pkr`, `happened_at`, `resolved_at` / `resolved_by` ("Mark as dealt with", never deleted). Admin-read RLS, service-role writes (`lib/financeAlerts.ts`).
- `bank_reader_state` (migration 200) — ONE row (id 1): the Faysal Bank email reader's Owner switch `enabled` (default false), `status` (off | running | locked | error), `last_run_at`, `last_success_at`, `last_error` (a plain category, never a host/user/secret), `error_since`, `backfill_done`, `emails_read`, `credits_added`, `ignored_count`, `updated_by/at`. Admin-read RLS, service-role writes. `bank_transfers` gained `source 'email'`, `channel` (raast | ibft) and `message_id` (unique; the alert email's Message-ID, never its body); `app_settings` gained `pay.paypro.cutoff` (YYYY-MM-DD, Pakistan time) and `pay.raast_id` (optional, shown only when set).
- `member_merges` / `member_duplicate_dismissals` / `view_as_sessions` (migration 201) — `member_merges`: `kept_id`, `merged_id`, `merged_by`, `status` (applying | done | failed), `error`, `log` (every moved record with its old values, for an exact Undo), `undone_at` / `undone_by`. `member_duplicate_dismissals`: "Not a duplicate" — one row per pair (`a_id < b_id`), `dismissed_by/at`. `view_as_sessions`: the sessions minted for "View as" — `owner_id`, `member_id`, `session_id` (unique; what `is_view_as_session()` checks), `expires_at`, `ended_at`, `end_reason`. All admin-read RLS, service-role writes. `profiles.merged_into` / `merged_at` / `secondary_phone` (the merged account, and the other account's phone kept as a secondary contact; not member-writable) and `tutor_profiles.status_card_dismissed_at` (the one-time status-image card dismissed). Every public table with RLS and storage.objects carry three RESTRICTIVE `view_as_no_*` policies.
- `email_sends` / `email_runs` (migration 183) — the email log, written by `lib/email/send.ts` for every message: `email_sends` = `mode` (one | bulk), `job`, `template`, `recipient` (the address), `status` (sent | failed | skipped), `attempts`, `http_status`, `error` (Resend's text), `provider_id`, `run_id`; `email_runs` = one row per bulk send (`job`, `started_at`, `finished_at`, `attempted`, `delivered`, `failed`, `skipped`, `requests`). Never a message body. Deleted after 90 days by the daily cron. Both admin-read RLS, service-role writes.
- `sms_sends` / `sms_alerts` (migration 172) — the SMS log and the "SMS may not be sending" alert history. `sms_sends`: one row per verification-code request or SMS send — `purpose` (signup | verify | reset | test | alert), `to_masked` (0321•••••22, never the full number), `provider`, `outcome` (sent | failed | reused | not_sent), `message_id` or scrubbed `error`, `actor_id` (test sends). Never a code or message body. Deleted after 90 days by the daily cron. `sms_alerts`: `reasons`, `last_success_at`, `message`. Both admin-read RLS, service-role writes.
- `staff_join_links` / `staff_referral_visits` / `staff_signup_credits` / `staff_signup_claims` (migration 175) — sign-ups by staff. `staff_join_links`: one `slug` (/join/<slug>, the first name) and `code` per participating staff member, kept when they leave. `staff_referral_visits`: the server record of a first-touch credit (`source` link | code, `expires_at` = +30 days); the browser keeps only its id in the httpOnly `tm_staff_ref` cookie. `staff_signup_credits`: ONE row per credited account, ever (`member_id` primary key), `staff_id`, `member_role`, `source` (link | code | claim | direct — migration 198: a sign-up with no valid staff link, credited to Admin, `staff_id` null; only 'direct' rows have a null staff_id). `staff_join_links.deactivated_at` (migration 198): a former staff member's link — it still opens the site and credits Admin. `staff_signup_claims`: `member_id`, `staff_id`, `note`, `status` (pending | approved | rejected), `reason`, `decided_by/at`; one pending claim per account. All four staff-read RLS, service-role writes.
- `staff_target_months` (migration 179) — `month` (YYYY-MM, pk), `counting_starts` date, `set_by`, `updated_at`: the day pace, status, "Needed per day" and the chart line count from (no row = the 1st). Seeded 2026-10 → 15 Oct. Staff-read RLS, service-role writes; the Owner sets it in Set targets.
- `location_run_reviews` (migration 182) — the Owner's decision on each row the 16 Oct 2026 "Approve all suggestions" run wrote: `kind` (area | alias | ignored), `ref_id` (the location_areas / location_area_aliases / location_ignored id), `decision` (keep | merge | split | not_area | rematch | actually_area | same_as), `detail`, `decided_by`, `decided_at`; unique (kind, ref_id), a later decision overwrites (each is also in admin_audit_log). Admin-read RLS, service-role writes. Migration 182 also narrowed the read policy of the four staff sign-up tables (migration 175) to `staff_id = auth.uid()` or `public.sees_all_staff_signups()` (Owner, Project Managers, Admin).
- `jobs.area_landmark` (migration 180) — the "Block / landmark" split off a staff-typed area ("Clifton Block 1" → area Clifton, landmark "Block 1"), shown as "Clifton (Block 1)". Display only; jobs.area keeps its saved text.
- `staff_monthly_targets` / `staff_target_list` (migration 177) — monthly paid sign-up targets. `staff_monthly_targets`: `(staff_id, month 'YYYY-MM')` primary key, `target` (0–10000), `set_by`, `updated_at`; a past month keeps its own rows. `staff_target_list`: one `on_list` flag per staff member (seeded: Aseer Ul Hassan, Mahnoor Amin, Zubia Bashir, Qasim Shahid). Both staff-read RLS, service-role writes; only the Owner changes them (server-checked, blocked-attempt alert), every change audited.
- `site_visit_counts` (migration 173) — the daily sign-up funnel's counts: `day` (Pakistan time), `kind` (`public_page` | `register_page` | `signup_tutor` | `signup_parent`), `count`. A number per day per kind — no visitor id, no IP. Written only through the service-role `bump_site_visit()`; admin-read RLS. `member_follow_ups.source` may also be `documents` (the WhatsApp after a tutor's documents are approved).
- `one_off_emails` (migration 170) — a send-once record for a one-time email to a member: `user_id`, `email_key`, `sent_at`, unique (user_id, email_key). The row is written BEFORE the email leaves, so a second run cannot send again. Admin-read RLS, service-role writes. First use: `switched_tutor_signin_2026_10_13` (lib/switchedTutorEmailCore).
- `search_unmet` (migration 154) — every search that found nothing: `query` (masked), `surface`, parsed `city`/`subject`/`level`/`school`, `role`, `created_at`. Admin-read RLS, server writes. Feeds the Overview to-do "Unmet searches this week".
- `profiles.email_pending_confirm bool default false` (migration 169) — true ONLY while a tutor who signed up with an email has not clicked our own confirmation link; blocks nothing; no other email goes to the address meanwhile. `location_areas` gained `created_by`, `created_by_name`, `created_at` (an area staff added while posting a tuition; NULL for the owner's list) and `removed_at` / `removed_by` (a staff-added area merged into an existing one — retired, never deleted; every reader filters `removed_at is null`). `search_unmet_done.kind` may also be `school`.
- `location_area_aliases` (migration 166) — a typed area that COUNTS AS a curated one: `city_id`, `raw` (as typed; compared lower-case, trimmed), `area_id`, `created_by`, `created_by_email`, `created_at`, `removed_at` + `removed_by` (taken back, never deleted); unique live (city, raw). World-readable reference data, service-role writes. Read through `lib/areaAliases.ts`; SQL `public.area_canon()` / `public.area_same()` (used by `rank_tutors`).
- `location_ignored` (migration 166) — a typed area value marked "Not an area": `city`, `raw`, `reason ('school'|'address'|'online'|'junk')`, who/when, `removed_at`. Admin-read, service-role writes. Hidden from Admin → Locations only; the saved text is untouched.
- `tutor_search_alerts` (migration 167) — "Notify me when a matching tutor joins": `channel ('sms'|'email')`, `contact`, `consent_at`, `query`, `city`, `area`, `master_ids int[]`, `label`, `known_tutor_ids uuid[]` (already matched when asked — never "new"), `user_id`, `created_at`, `expires_at` (+60 days), `notified_at`, `matched_tutor_id`, `closed_at`, `close_reason ('notified'|'expired'|'send_failed')`; one open request per contact per search. Admin-read, service-role writes (`lib/tutorAlerts.ts`).
- `taxonomy_levels.title_name` / `taxonomy_subjects.title_name` (migration 167) — the short name a suggested blog title uses; optional, edited in Settings → Subjects. `search_unmet_done.kind` (`done` | `ignored` | `synonym` | `subject`).
- `indexing_queue` (migration 154) — Google Indexing API notices (`url`, `kind` URL_UPDATED|URL_DELETED, `sent_at`, `last_error`). Sent within 200 a UTC day (`drainIndexingQueue`); the rest wait for the next nightly run. Admin-read RLS. Migration 178 added `priority` (2 new post, 1 status change/edit, 0 batch), `attempts`, `next_attempt_at` (retry with backoff; a quota refusal waits for the next PACIFIC midnight), and `indexing_attempts` (`queue_id`, `url`, `kind`, `attempted_at`, `ok`, `error`) — one row per request made to Google; "sent today" counts these since midnight Pacific time (Google's quota day). Admin-read RLS, server writes. Migration 181 added `skipped_at` + `skip_reason` (`not_tuition` | `old_address` | `superseded`): a notice that is not sent is MARKED (sent_at = the 1970 marker, last_error = "Not sent — not a tuition page" / "Not sent — old address"), never deleted.
- `jobs.pause_source` (migration 154) — who paused a tuition: `'auto'` (7-day rule), `'backlog'` (the 150-a-night backlog), `'admin'`, `'self'` (Pause my account), `'poster'`; cleared on resume. Marketplace → Paused tuitions lists `auto` + `backlog`.
- `user_documents.photo_dhash` / `same_as_profile_photo` (migration 190) — a selfie's perceptual hash and whether it looks the same as the profile picture (a staff warning only; null = not checked).
- `user_documents.status` — `'active'` (on record) | `'paused'` (hidden, kept) | `'review'` (migration 157 — a new upload of an APPROVED CNIC side or selfie, waiting for staff; the approved file stays on record until they decide). Every list/count read filters `status='active'`. Members may insert/delete only `degree` rows themselves (migration 158); CNIC/selfie rows are written by `/api/documents/upload` through the service role. Migration 160 added `rotation` (0/90/180/270 — a staff DISPLAY setting applied by the preview route; the file is never changed) and `cnic_read_status` / `cnic_read_number` / `cnic_read_at` (the CNIC number read from a front photo — a SUGGESTION only, never the confirmed number).
- `document_unlocks` (migration 157; `item` gained `'photo'` in migration 186) — the Owner's "Unlock for re-upload" on an approved, locked CNIC, selfie or profile photo: `user_id`, `item ('cnic'|'selfie'|'photo')`, `unlocked_by`, `unlocked_by_email`, `unlocked_at`, `used_sides text[]`, `closed_at`, `close_reason ('used'|'approved'|'rejected')`; one open unlock per (user, item). Member + admin read, service-role writes.
- `member_follow_ups` (migration 159) — the ONE shared staff follow-up record for Overview "Stuck in onboarding", People → Unpaid signups and Abandoned signups: `member_id`, `channel ('whatsapp'|'call'|'email')`, `template_key`, `source ('stuck'|'unpaid'|'abandoned')`, `staff_id`, `staff_email`, `staff_name`, `created_at`, `undone_at` + `undone_by` (Undo stamps, never deletes). Admin-read RLS; written only by `/api/admin/follow-ups` (and `/api/admin/follow-ups/tutor`). Rules in `lib/followUpCore.ts`. Migration 196 added `reason` (why a tutor was messaged — lib/followUpTemplatesCore FollowReason) and `progress` (the tutor's progress snapshot at the tap — lib/tutorFollowUpTabsCore progressKey).
- `member_notes` (migration 196) — "Log a call or note" on a member's Activity tab: `member_id`, `kind ('call'|'whatsapp'|'note')`, `body`, `staff_id`, `staff_name`, `created_at`, `withdrawn_at` / `withdrawn_by` / `withdrawn_by_name` / `withdrawn_reason`. A trigger refuses editing what was written and any direct DELETE (a cascade from deleting the account still runs); a note is only withdrawn, once, with a reason. Admin-read RLS, service-role writes (`lib/journey.ts`).
- `tutor_profiles.converted_to_parent_at` / `converted_to_parent_by` (migration 196) — the account was changed to a parent account (Convert account type); the tutor profile is kept, hidden, and its address 301s to Browse tutors for the city via `converted_tutor_redirects()` (SECURITY DEFINER, anon-callable, slug + city only).
- `follow_up_dismissals` (migration 191) — "Not interested" on Follow-ups: `member_id`, `reason ('not_interested')`, `note`, `staff_id`, `staff_name`, `created_at`, `undone_at` + `undone_by` + `undone_by_name` (Undo stamps, never deletes); one live mark per member (partial unique index). Admin-read RLS; written only by `/api/admin/follow-ups/not-interested` (`lib/followUpDismissals.ts`).
- `reconciliation_rows` / `bank_transfers` / `settlement_links` (migrations 142, 144, 162) — the settlement check. `reconciliation_rows`: ONE current row per (gateway, order number) from the PayPro Orders export (`is_current`, unique index; a re-upload updates in place), the eight PayPro columns plus `gateway`, `method` (JazzCash / Easypaisa / Card), `fee` (amount − MerchantShare), `updated_at`. `bank_transfers`: a bank credit — `transferred_on`, `transferred_time`, `amount_pkr`, `reference` (unique for hand-entered rows), `sender_name`, `sender_bank`, `note`, `source`, `gateway` (`paypro` = a PayPro payout, `manual` = a member's own bank transfer). `settlement_links`: the owner's manual link of one credit to orders / receipts (`kind` order | receipt | none, `target`, `note`, soft removal); automatic matches are computed, never stored. All admin-read, service-role writes.
- `signup_blocklist` (migration 58) — a banned account's `mobile` (normalised MSISDN) and `cnic_hash` (sha256 of the digits, NEVER the CNIC in the clear), plus `reason`, `source_user_id`, `created_by`. Checked at signup and at claim; admin-read RLS, service-role writes.
- `taxonomy_categories` / `taxonomy_levels` / `taxonomy_subjects` / `taxonomy_master` — used by `lib/taxonomy.ts`, plus an admin-editable alias table for Roman-Urdu spellings. **Migration 80 replaced the whole taxonomy with the owner's corrected dataset (`supabase/seed/taxonomy-2026.csv`: 13 categories · 29 grades · 480 subjects · 1,475 combinations, loaded VERBATIM), superseding migration 79.** The prior taxonomy was miscategorised and its subjects were fanned mechanically across levels; the new dataset is per-grade. `taxonomy_levels.legacy boolean`: **every level minted before migration 80 is `legacy=true`** — still VALID on existing `job_subjects`/`tutor_subjects` (they render by id via `labelsForMasterIds` and match by master-id intersection), but hidden from every picker and re-picked on next edit. `lib/taxonomy.ts` builds the TREE and every picker (`fetchLevels`, `fetchGradesForLevel`, `fetchSubjectsForGrade`, `fetchAllSubjects`, `isLevelLeaf`, `resolveMasterIds`, `selectionForMasterIds`) from **non-legacy rows only** — the tree keys by display name, so this is what stops a retired grade colliding by name with a live one; `labelsForMasterIds` alone reads all rows (by id) so retired rows still render. Level is MULTI-select; matching is unchanged. There are NO level-leaves in the new dataset (Test Preparations / Sports & Games / Holy Quran are each one grade with many subjects). The generator is `scripts/build-taxonomy-2026.ts` (reproducible; commit the CSV, the SQL and the generator together). **Migration 153 added a 14th level, Admission Test Prep, with NO GRADE** — `taxonomy_categories.no_grade = true` (default false for every other level); it carries one implicit grade row of the same name that every picker auto-selects and never shows (no "None" option), so saving with no grade is valid for this level only; its 10 choices (Aitchison College … Cadet College Hasanabdal, Other last) keep their authored order in the pickers (`orderSubjectsForPicker`), all other levels stay alphabetical.
- `location_cities` (migration 73) — `id`, `name unique`, `sort_order int default 100` (Lahore/Karachi/Islamabad/Rawalpindi pinned 1–4, rest 100 → `order by sort_order, name`). `location_areas` (migration 73) — `id`, `city_id -> location_cities`, `name`, `unique(city_id, name)` (area is dependent on its city; `order by name`). The owner's 23-city / 249-area dataset, stored VERBATIM; migration 184 (17 Oct 2026) added Sheikhupura, Jhang and Rahim Yar Khan (Punjab, sort_order 100, no areas) — 26 cities; migration 188 (20 Oct 2026) added 396 more from GeoNames (every Pakistani city and town, sort_order 100, no areas) — 422. A city row is still only its name; province, district, coordinates, population and aliases live in the generated `lib/pkCityData.ts` (see "Every Pakistani city and town"). Reference data: world-readable, admin-writable (the taxonomy pattern). Read via `lib/cityAreas.ts` (client, cached) or `lib/locationsAdmin.ts` (admin). `jobs.city|area`, `profiles.city|area`, `tutor_profiles.city|area` stay PLAIN STRINGS — a value not in these tables is free text, preserved as-is and surfaced by `unmappedLocations()` for review; promoting one is an insert here.
- `job_titles` (migration 77) — `id`, `name unique`, `sort_order int`. The Job Type value set: the owner's 19 job titles ("Home Tutor", "Online Tutor", "O Levels Teacher", … "Principal") in a fixed order, stored VERBATIM. Reference data: world-readable, admin-writable (the location_cities pattern) — adding a title is an INSERT. Read via `lib/jobTitles.ts` (client, cached) or `lib/jobTitlesServer.ts` (server). `jobs.teaching_mode` (a job's single title) and `tutor_profiles.job_types text[]` (a tutor's multi-select) hold the TITLE TEXT itself — the stored value IS the label, so display is identity. `teaching_mode` KEEPS its name (the deferred rename still stands) and stays the mirror of `job_types[0]`. There is NO CHECK constraint on the value columns (a fixed-array CHECK would contradict "adding a title is an insert") — the UI offers only titles from the table, exactly as cities are offered. The one title the "online is city-agnostic" rule pivots on is `'Online Tutor'` (`lib/jobTitlesCore.ts` `ONLINE_JOB_TITLE`, the same literal in `rank_tutors`).

Views: `tutor_directory` ("is this tutor listed?" — browse, `rank_tutors()`, sitemap all read it) and `tutor_visible_profiles` ("may this URL render?" — adds unclaimed imports, granted to nobody, reached only via the SECURITY DEFINER `tutor_public_page()`).

Hired/closed status lives in `jobs.status` + `jobs.hired_tutor_id` — never localStorage.

## Entitlements matrix (the product spec — implement exactly)

### Tutor plans — ONE-TIME FEE + THREE PLANS (owner, 15 Sep 2026; migration 86). SUPERSEDES every earlier tutor-plan table and the "viewer identity is a Verified power" note below.

**Rs 199 is a ONE-TIME PROFILE VERIFICATION FEE, not a plan, tier or subscription.** No expiry, no renewal, never "/month". Every tutor pays it once to become verified and listed; there is no downgrade-on-expiry and no "expiring this week" for it. It is recorded DISTINCTLY from plan purchases (`tutor_profiles.verified_fee_paid_at` + a `payments` row with `plan_code='verified'` that creates NO subscription), so it counts as revenue but never as a renewal/re-subscription. After the fee the tutor is on the free **Basic** plan; **Premium** and **Featured** are optional monthly upgrades.

| Plan | PKR | Badges | Apply quota (real / displayed) | In-app message parent | View parent contact/email | Direct WhatsApp | See who viewed | Top-ranked | Matched → WhatsApp | Matched → email | Incoming hiring/demo cap | Search rank |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (fee) verified | 199 one-time | — (marks fee paid) | — | — | — | — | — | — | — | — | — | — |
| basic | free | Verified | 10 / "10" | yes | **no** | **no** | **no** | no | no | no | 10/month (enforced on the PARENT's send path) | 1 (low) |
| premium | 499/mo | Verified + Premium | 100 / "Unlimited" | yes | yes | yes | yes | no | no | yes | Unlimited | 2 |
| featured | 999/mo | Verified + Premium + Featured (gold "Featured" tag) | 150 / "Unlimited" | yes | yes | yes | yes | **yes** | **yes** | yes | Unlimited | 3 (top) |

- **CV download: all three plans (Basic included) — free.** Only an unverified (no-fee) tutor is gated (the Verify gate).
- **Basic gets ZERO contact views** — the contact row shows it exists but is not readable, with upgrade as the way through, no counter.
- **100 / 150 are real server-enforced caps displayed as "Unlimited".** Admin sees the real numbers.
- **Viewer identity / contact / WhatsApp are Premium+ powers** (Basic NO). `plans.can_see_viewer_identity` and `can_view_contact`/`can_whatsapp` are true on premium+featured only; `REQUIRES.tutor_viewer_identity` and `.tutor_contact` in `lib/gate.ts` read `'premium'`. This supersedes the migration-43/57 "viewer identity is a Verified power" decision — there is no longer a `verified` PLAN.
- **LISTING = the one-time fee + real, non-fixture content** (`tutor_directory`/`tutor_visible_profiles`; migration 87): `verified_fee_paid_at` set + mobile verified + verification not suspended/rejected + not suspended/banned/under-review + claimed if imported + **NOT a fixture (`is_seed`/`is_team_account`) + at least one `tutor_subjects` row + a non-blank `city`**. Completion decides RANKING and INDEXING only. `computeEntitlements`/`tutorListed()` know only the fee-and-precondition half; the authoritative directory rule (with the subjects/city/fixture gates) is `lib/tutorListingStatus.ts` `directoryBlockers()`, mirrored 1:1 by the view SQL and read by the dashboard (`lib/directoryStatus.ts`) and the admin tutor list. `computeEntitlements` synthesises the free `basic` plan from the fee (the free-parent pattern); Premium/Featured come from an active subscription.
- Prices appear only on the packages page + the upgrade/verify sheet — never before signup, on a public page, or as a banner.
- The Verified badge is additionally degree-gated for tutors (a reviewed degree on file); Premium/Featured are plan-tier and not degree-gated.

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

**SUPERSEDED by "Auth & trust decisions" (Sunday 6 Sep), "Part 5 decisions" (8 Sep) and "Part 8 decisions" (9 Sep) — the signup FIELD is a single "Mobile number or email" identifier, and BOTH PATHS ARE LIVE (Part 8): digits → OTP delivered on WhatsApp; an address → Supabase confirmation link over Resend. The Part 5 email gate was lifted once SMTP was configured. The mobile-first mechanics below (synthetic email, phone gate, OTP) still stand; the "email-first is retired" note is stale — email-first was never the flow, but email signup does now create an account.**

**Signup is mobile-first — see "Mobile-first signup" and its "As built (T-UI2)" notes, which are canonical. The email-first flow described in earlier drafts is retired.** In short: `/register` creates the account from a mobile number (synthetic `<msisdn>@users.tutormint.org` when no email is given), signs the user in immediately, sends an OTP, and `proxy.ts` holds accounts with `phone_gate_required = true` and `phone_verified_at is null` on `/verify-phone`.

- **One `/login`**, accepting email **or** Pakistani mobile (mapped server-side through `lib/phone.ts` in `/api/auth/login`, which returns one identical message for every failure so the route is not a membership oracle). After sign-in read `profiles.role` once → `/tutor/dashboard` | `/parent/dashboard` | `/admin`. `/parent/login` and `/tutor/login` are server redirects to `/login`.
- **One `/register`** with two role radios: **Tutor** and **Parent / Institution**. Creates the auth user + `profiles` row (+ `tutor_profiles` with `verification_status='pending'` for tutors).
- **Email confirmation** applies only to accounts registered with an email and no mobile. Mobile-verified accounts never see it. `/api/auth/callback` handles the code exchange. **SMTP is configured (Resend, `noreply@tutormint.org`; Part 8), so confirmation links and password-reset email now deliver.**
- **Phone OTP**: `POST /api/auth/otp` (send) and `/verify`. Checks `expires_at`, single-use (`consumed_at`), max 5 attempts, and carries a `purpose` so a reset cannot eat a pending verification code. `DEV_DEFAULT_OTP` is non-production only, guarded three times (`devOtpCode()`, `assertOtpSafety()` at startup, and the route calling the helper rather than `process.env`), and requires that a code was actually requested. A real SMS provider is a hard go-live prerequisite.
- **Tutor video**: recorded/uploaded via `app/tutor/upload-youtube` → uploaded to the official channel as **private** → `tutor_profiles.video_youtube_id` + `video_status='uploaded'`. Max 3 submissions; each gets Approve | Hold | Suspend with a written reason; after the 3rd rejection the button locks and support contact is shown. Approving and publishing are different decisions with different permissions (verifier vs manager). Route requires auth + `role='tutor'`; `googleapis` declared; `YOUTUBE_*` documented in `.env.example`.
- **Degrees**: typed list + certificate image upload. Parents see watermarked, downscaled derivatives from the private bucket; the original is never exposed. Same treatment for CNIC previews (admin-only). Terms say "protected against casual copying", never "cannot be screenshotted".
- **Parent verification**: CNIC image → private bucket `identity-docs` (RLS: owner + admin only), address text. Admin approves → `cnic_verified_at`, `address_verified_at` → Verified badge and the ability to post jobs.
- **Admin**: `profiles.role='admin'` + `admin_role`, bootstrapped by SQL for the owner's account. `app/admin/layout.tsx` server-gates. All hardcoded passwords and `adminAuth` localStorage removed.

## Pages to keep (canonical) and delete

Keep: `/`, `/browse/tutors` (+`/browse/tutors/[id]`), `/browse/tuitions`, `/tutor/[slug]` public profile, `/login`, `/register`, `/forgot-password`, `/verify-phone`, `/verify-email` (the email-path confirmation screen; the email path is LIVE again — Part 8, SMTP configured), `/tutor/claim`, `/suspended`, `/account/notifications`, `/tutor/dashboard/*` (`settings`, `jobs`, `messages`, `notifications`), `/parent/dashboard/*`, `/chat/[jobId]`, `/tutor/packages`, `/parent/packages`, `/pay/simulator/[ref]` (non-production), `/admin/*` (incl. `/admin/inbox`, the Team ↔ member channel — migration 58), `/about`, `/faq`, `/privacy`, `/terms`, `/support`, `/review`. T9 adds `/tutors/[city]/[subject]` and `/tuitions/[city]/[subject]`. **`/account/messages` is now a redirect** into the role inbox's Team pane (`/{role}/dashboard/messages/team`) — Part 5 unified official messages into the one inbox.

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

**Nothing pretends to have sent.** Every adapter — Resend, SendPK —
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
- **Three more changes were approved by the owner on 13 Oct 2026** — the H1 text, the "For parents" / "For tutors" cards under the two buttons, and the balanced link block. They are listed exactly in "Homepage — fourth owner authorisation (13 Oct 2026)" near the end of this file. Nothing else on the page is unlocked by it.
- **The pill's TEXT was approved for change by the owner on 14 Oct 2026** — this element only, same styling. It no longer reads "Pakistan's Largest Verified Tutors & Teachers Network"; it shows the computed brand line (`brandLine()` in `lib/brandClaims.ts`): under 100 tutors holding the Verified badge "Pakistan's fast-growing tutor network", 100 or more "100+ verified tutors across Pakistan" (rounded down to the nearest 50). See "Homepage — fifth owner authorisation (14 Oct 2026)" near the end of this file.
- **"HIRE" above the H1 was removed, and the site header's "Join free" button shows here as on every page** — owner-approved on 15 Oct 2026. Nothing else on the page changed. See "Homepage — sixth owner authorisation (15 Oct 2026)" near the end of this file.
- **Hero line reads "Free to Join • No Commission • No Middleman • Live Demo"** (was "No Fee • …"). Explicit owner authorisation dated 8 Oct 2026 (the tagline change, confirmed for the locked hero). Recorded here so it is not reverted as a stray edit to a locked file.

## Graceful handling of unknown input (T8 polish checklist)

- Branded app/not-found.tsx, app/error.tsx, global-error.tsx, and an offline state: friendly copy + links to /browse/tutors, /browse/tuitions, /. Suspended/unclaimed tutor slugs → 404 page with the same shell. No raw framework errors ever reach users.
- Empty states for every list (search results, jobs, applications, messages, notifications, demos, shortlists): a sentence + 1–3 concrete actions. Search no-results must offer: widen to whole city, include online tutors, post a job.
- Form validation: friendly inline messages stating the expected format (mobile 03xx-xxxxxxx, CNIC 5-7-1 digits, fee as number), input normalisation (strip spaces/dashes, "5k" → 5000 with confirmation), never lose typed content on error, Urdu text accepted in free-text fields.
- Help: /support rebuilt as FAQ-first (questions grouped for tutors/parents incl. "refunds" → no-refund policy + terms link, "how verification works", "why can't I hire") with a one-tap WhatsApp + email fallback. AI help bot is post-launch backlog, not built now.
- Unknown API input: every route validates with zod (or equivalent) and returns structured 400s with a human message; the UI renders that message.

## Register / login form rules — as built (T8a), superseded on labels

**SUPERSEDED by "Auth & trust decisions" (Sunday 6 Sep) — the "Register form"/"Mobile-first signup" sections it points forward to are themselves superseded on the identifier field: `/register` now has ONE "Mobile number or email" field, not separate mobile + optional email. Login gained "Remember me" and every password field a show/hide eye. The rest below still stands.**

**The role labels and the mobile-first flow in this section are superseded by "Register form" and "Mobile-first signup" below.** What still stands:

- `/register` is minimal and centred at all widths: role radios at the top, full name, password, consent checkbox, and the sign-in link. **No mention of school or academy on any auth form** — institutions register as parents; only the FAQ explains this. City and every other detail are collected in profile completion, never at signup.
- Same minimal treatment for `/login`: identifier + password + forgot-password + register link.
- `/forgot-password` reports the same thing whether or not the address has an account — a reset form that says "no such account" is a membership oracle.
- The one deviation from "nothing else": the terms + photo-consent acceptance stays. It is a checkbox, not a data field, and consent given by implication through a link nobody opens is not consent anybody would recognise having given.
- **Password-reset delivery over email now works** — SMTP is configured on the Supabase project (Resend; Part 8). The mobile OTP reset path also works, and stays the default because most members register with no inbox.

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

**SUPERSEDED by "Auth & trust decisions" (Sunday 6 Sep) on the identifier — the two fields "mobile number" + "optional email" are now ONE "Mobile number or email" field. The role radios and no-city-at-signup still stand.**

- Role radios at the top read exactly: **Tutor** and **Parent / Institution**. Helper text under the second: "Parents, schools and academies looking for tutors." Institutions are ordinary parent accounts with identical rights and plans — no separate entity, role, label, or flow anywhere else in the platform.
- Everything else from the mobile-first signup section stands: full name, mobile number, password, optional email, consent checkbox; no city at signup.

## Mobile-first signup (owner, 1 Sep)

**SUPERSEDED on two points by "Auth & trust decisions" (Sunday 6 Sep): (1) the signup identifier is ONE "Mobile number or email" field, not "mobile number + optional email" — and BOTH paths now create an account (Part 8: the Part 5 email gate was lifted once SMTP was configured; the mobile code is delivered on WhatsApp); (2) the /verify-phone resend cooldown is FIVE MINUTES with a visible mm:ss countdown, not 60s. Everything else here — synthetic email, the phone gate, OTP purposes, the SMS-provider prerequisite — still stands.**

- /register: role radios "Tutor" and "Parent / Institution" (helper: "Parents, schools and academies looking for tutors"), full name, mobile number (Pakistani format, normalised to E.164), password, terms/consent checkbox. Email optional ("for receipts and reminders"). No city.
- Signup creates the auth user (synthetic internal email <msisdn>@users.tutormint.org when no email is given; the real email otherwise), profiles row, tutor_profiles for tutors, signs the user in immediately, and sends an OTP to the mobile.
- Gate: while profiles.phone_verified_at is NULL, proxy.ts redirects every /tutor/*, /parent/* and /admin/* request to /verify-phone (the only reachable authenticated page besides logout). Public pages stay public.
- /verify-phone: 6-digit input, resend with 60s cooldown, 5 attempts, change-number link. On success set phone_verified_at, log otp_verified, redirect straight to the role dashboard — never to /login.
- /login unchanged (mobile or email + password). /forgot-password: mobile → OTP → new password (email path stays for email-only accounts).
- Email confirmation applies only to accounts registered with an email and no mobile; mobile-verified accounts never see it.
- A real SMS provider is a hard go-live prerequisite; DEV_DEFAULT_OTP serves preview/dev only.

### As built (T-UI2) — the three places the spec had to be made precise

**Still canonical, with ONE clause superseded: the signup FORM now presents a single "Mobile number or email" identifier field (Auth & trust decisions, Sunday 6 Sep), not a separate mobile field with an optional email. Everything below — `phone_gate_required`, the enumerated gate list, OTP `purpose`, the synthetic-email login identifier, and the E.164 convention — still holds exactly as written.**

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

- **Production Supabase is Mumbai `yhekiqtelsictqkfxrfj` (ap-south-1), and Vercel functions run in `bom1` (Mumbai).** Migrated from Sydney `flhiraqouizzwnasuraj` (ap-southeast-2) on **5 Sep 2026** — a full dump/restore of roles, schema, data (auth users + password hashes, storage bucket/object metadata) and every storage object's bytes; row counts, bucket bytes, a 5% SHA-256 sample, 112 RLS policies, the realtime publication and the 977-column schema all verified identical, `rls:audit` 168/168 on Mumbai. `scripts/target.ts` `PRODUCTION_PROJECT_REF`, `scripts/backup.sh` and `vercel.json` `regions` name Mumbai now; the app reads the Supabase host from `NEXT_PUBLIC_SUPABASE_URL` (Vercel env), so no code hardcodes a ref. **The old Sydney project is retained, untouched, until the owner deletes it** (a few days of normal use first); rollback is env-only — see `docs/migration/README.md`. One thing the migration could NOT copy: the custom SMTP block (`smtp_pass` is API-redacted), so email delivery on Mumbai needed the Resend SMTP settings re-entered by hand in the dashboard (Auth → SMTP) — **done (Part 8, 9 Sep): SMTP is configured on Mumbai and email delivers.** Everything else in Auth (site URL, allow-list, confirm-email, branded subjects + templates) was copied and diffed identical.
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

- **SMS provider — DECIDED: SendPK is the only provider** (owner, 14 Oct 2026; see "SendPK is the only SMS provider" and "SMS health"). It sends only the approved verification-code template. The earlier WhatsApp provider was removed from the chain in PR5a and its module deleted in PR5b. BRIDGE_OTP stays as a backstop until real codes are confirmed arriving.
- SMTP on the Supabase project — **configured** (Resend, `noreply@tutormint.org`; Part 8). Confirmation, password-reset and staff-invite email deliver. No longer a blocker.
- AssanPay — in negotiation.
- CUIN and NTN — **filled** (owner, 9 Sep 2026, from the FBR taxpayer certificate):
  `company.reg_no = 0353636` (SECP CUIN), `company.ntn = J833612`, set in
  `app_settings`. `lib/company.ts` no longer reports `regNoPending`/`ntnPending`,
  so the SECP-number clause on Terms/Privacy, the NTN row on Terms/Privacy/About,
  and the Organization JSON-LD `identifier` all render. No longer a blocker.

All four are already described where they bite, and this list is the index rather than a fifth copy: the SMS prerequisite in "Auth & verification flows" and "Mobile-first signup", SMTP in "Auth & verification flows", "Admin, part 1 (T7a)" (staff invites) and the register/login form rules, AssanPay in the owner Q&A and "Payments — the adapter contract", and the two company numbers in "Legal entity". Fix one, check the others.

## One database (2 Sep 2026)

One Supabase project serves both preview and production. There is no separate dev database. Any script that writes must name its target and refuse production unless explicitly overridden. Migration 30 was applied to it during T-Search before this rule existed — additive only, no backup taken.

The mechanism is `scripts/target.ts`: `guardWrites()` announces the target, refuses production unless `ALLOW_SEED_ON_PRODUCTION=1` is set for that one invocation and the operator types the project ref, and refuses the override outright in a non-interactive shell. A dry run that writes nothing is allowed through — a guard that makes the safe path harder than the dangerous one gets worked around.

This replaces an inverted guard. `seed-dev.ts` and `seed-cleanup.ts` each hardcoded the live project's ref as `DEV_PROJECT_REF` and refused to run *unless the target matched it*, so `npm run seed:dev` was armed against production while reading as though it protected against exactly that. The full audit of every script under `scripts/`, and the backup taken on 2 Sep, are in `docs/STATE.md`.

## Brand rendering rules (owner, 2 Sep 2026)

- The brand is written "TutorMint" — one word, no space — in every surface: UI, wordmarks, social banners, emails, captions, receipts, schema. "Tutor Mint" (two words) appears ONLY inside the legal name "Tutor Mint (Pvt) Ltd" in legal contexts (footer copyright, Terms, Privacy, receipts, merchant name).
- The admin panel follows the same brand-token-only colour rule as the public site. No non-token colours anywhere, including admin.
- Homepage hero pill text colour: tm-navy (#151E6B). This is an explicit owner authorisation dated 2 Sep 2026 and is the only permitted change to the locked homepage in this pass — recorded in the "Homepage is LOCKED" section above so it is not reverted later.
- **Brand story (for /about + social bios).** TutorMint = where genuine tutors are *minted* — like a mint certifies every coin, we verify every tutor (degrees, CNIC, video) before they carry the badge; the logo's two figures are a tutor and a parent in direct conversation, no middleman. Taglines: **"Genuine tutors, minted daily."** / **"Every tutor, certified genuine."** (added by the owner, Part 3, 7 Sep 2026.)

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

**Superseded 5 Sep 2026 — the teaser is now literally first.** The owner gave
the instruction the last paragraph asked for: the "Who looked at you" teaser
sits immediately below the header card, with nothing above it, and NEEDS YOU
moves below it. See "Tutor dashboard cleanup, as built (5 Sep 2026)". The
conversion rule wins the tie now; the blocking-item argument stands but the
owner chose the upsell surface's position over it deliberately.

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

## Blog part 4 — suggested titles + composed covers (T9.3/9.4, 5 Sep 2026)

Covers are now COMPOSED from a committed brand asset library — no external image
API, anywhere. And the content queue reaches into the editor: a new post can
start from a suggested title, and a draft can be written from a title alone.
Migration 55 (additive; backup taken first), applied to the one database.

**The asset library is white-keyed PNGs, and the catalogue is the source of
truth.** `public/covers/` shipped with 33 owner-made 2K JPEGs (skylines, people,
motifs; navy/mint/red on white). `scripts/covers-build.ts` processes them ONCE
and is committed: it maps each file to a short content slug, keys pure white to
transparent (a soft 225–245 min-channel ramp, so edges are clean), trims the
margins, downscales per kind (cities ≤1600w, people ≤1200h, motifs ≤800), writes
`public/covers/<slug>.png`, deletes the JPEG, and regenerates
`lib/covers/catalog.ts` from what is on disk. The catalogue — slug, kind
(`city | person | motif`), tags, natural size — is the SOURCE OF TRUTH:
`scripts/test-covers.ts` asserts every catalogued file exists and every PNG on
disk is catalogued, both ways. The build is re-runnable (with the JPEGs gone it
just rebuilds the catalogue). The 8 cities are Lahore/Karachi (skylines),
Islamabad (Faisal Mosque), Rawalpindi/Peshawar (skylines), Faisalabad (clock
tower), Multan (shrine) and a Pakistan map (the fallback); a book-on-a-rehal maps
to `quran`. There is no external image API in the cover feature — the library is
the whole source.

**The composer is deterministic and pure/render-split, like the social banner.**
`lib/covers/select.ts` (PURE — no next/og, no fs) decides everything a cover
shows from the post: city → its silhouette (fallback pakistan-map); subject → its
motif (fallback book); audience → person (parents→parent-child, tutors→a teacher
alternating, else student); cluster → a second motif (cost-hiring→wallet,
safety-trust→shield, boards-exams→certificate, else search); two motifs deduped.
`lib/covers/compose.tsx` (next/og, brand LITERALS, NO server-only — so it renders
under the test runner) paints a 1200×630 with the title (auto-sized, ≤3 lines,
navy on light / white on navy), the city silhouette across the bottom, the person
bottom-right and the motifs in soft cards, on one of three grounds (white / mint
tint / navy). The navy ground lays a light "stage" band so the navy skyline reads
against it. `lib/covers/assets.ts` (server-only) loads each asset fs-first, CDN
second, into a data URI (satori embeds data URIs; public/ is not on the Vercel
lambda's fs); `lib/covers/render.ts` (server-only) orchestrates. The **seed**
picks the ground (0/1/2 = white/mint/navy) and the layout; **Shuffle** advances
the seed by three, rotating the ground under the whole trio and re-rolling the
teacher and motif order — a visibly different trio, still deterministic per seed.
Every title/ground pair is on `check:contrast`.

**Editor: three composed variants, pick one, or Shuffle.** `POST
generate-cover` commits the chosen seed to the `blog` bucket (a single wide
image; `cover_square_path` is cleared, as an upload does) and derives its alt
text ("Illustration: the Lahore skyline, a parent and child, an atom and a
wallet."); `GET cover-compose` is the live preview the editor points three
`<img>` at (debounced 500ms so live-typing does not fire a satori render per
keystroke). The old title+cluster template renderer is gone. Upload-your-own
stays. Posts gained optional **city** and **subject** fields (native-typeahead
datalists over `CITIES` and the taxonomy), used by the composer and appended to
the post's JSON-LD `about`/`keywords` when present (emitted only from what the
post carries — never invented).

**Start from a suggested title.** The New-post editor shows a panel of the open
content queue (search box, per-item Dismiss with confirm+toast → the same
`/admin/blog/queue` route the queue screen uses). Picking one fills title, slug,
cluster, audience, city and subject (the last two parsed from the suggestion's
fingerprint via `listEditorSuggestions`) and links `post.suggestion_id`. The
first **save** marks the suggestion `drafted`; **publishing** marks it `done`
(migration 55 widened the status CHECK); **deleting the draft** reopens it to
`suggested`. This supersedes the queue-only `?suggestion=` flow, which still
works and now routes through the same enriched list.

**Draft from a title alone.** Fact notes are optional now. With notes, behaviour
is unchanged. With NO notes the model is told to write with no figures at all,
and if it slips one in the draft falls back to the figure-free composed draft, so
title-only generation always passes the figure gate. In `unsupportedFigures`, a
four-digit **year (1900–2099) is never a statistic**, and a non-year **title
number is credited only when there are notes** — so a title-only draft's only
allowed numeral is a year, matching the rule that a figure-free post is the point
of the no-notes path. The persistent `figureGate` stays notes-gated, so the
part-1 hand-written flow is unblocked exactly as before. The before-publishing
checklist gained a "Cover set" line (advisory — a cover is not a publish gate).

Gates at close: tsc 0 · build 0 · check:contrast 89 · rls:audit 168/168 ·
test:covers 16 · test:blog 35 · test:social 7 · test:cv 14 · test:messaging 8 ·
test:seedcast 4 · test:jobcopy/grouping/delivery all pass.

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

## Tutor CV builder — as built (5 Sep 2026)

The conversion feature: most tutors pay a net café to compose a CV, and the
platform already holds every fact. `/tutor/dashboard/cv` renders a print-ready
CV from the live profile. No migration — nothing is stored as a separate CV
record; the profile is the source, edited only in Settings.

**One data mapper feeds two renderers.** `lib/cv/model.ts` is PURE (`toCvModel`,
no server-only, no DB) so the on-screen preview and the PDF are built from the
same function and cannot diverge — `lib/cv/build.ts` reads the tutor's OWN
profile into a `CvRaw` (base tables, NOT `tutor_public_page`, which returns
nothing for a tutor under 100%; every tutor sees their own preview), and the
mapper turns it into the `CvModel` both consume. Three rules live in the mapper,
each unit-tested (`npm run test:cv`): a section with no data is omitted; the
contact block obeys its "Include my contact details" toggle (default on — it is
their CV); and the photo is a validated avatar or nothing — `isOurStorageUrl`
allows only our avatar buckets, so an identity-docs object (a CNIC or selfie), a
`data:` URI or a foreign host is rejected and can never reach a CV.

**The preview is free; the PDF download is gated at Verified.** Every tutor,
free included, sees a live on-screen preview (HTML, `components/cv/CvPreview.tsx`,
no watermark) in either template. Download hits `/api/tutor/cv/pdf`, which
enforces the gate server-side: `canDownloadCv(ent)` (`lib/cv/access.ts`, pure)
is Verified-and-above; a free tutor gets the `cv_download` gate response, a
Verified+ tutor gets `application/pdf`. The dashboard card and the download
button offer the next plan via the upsell (`UpgradeTrigger reason="cv_download"`
→ the `/api/gate` short-circuit and planRank guard), never a lower one. A
successful download toasts and logs `cv_downloaded`.

**The PDF is pure JS, no headless browser.** `@react-pdf/renderer`
(`lib/cv/pdf.tsx`, Node runtime, `maxDuration=60`), A4 portrait, brand tokens as
literals from `lib/brand.ts` the way next/og needs them. The font is embedded:
Geist Regular (OFL, the face Next ships) as a base64 data URI in `lib/cv/font.ts`
— carried in the PDF's own bytes, so it prints identically at any shop with no
font file to trace or fetch; emphasis is size + colour, not a second weight. The
avatar is fetched into a data URI (`lib/cv/assets.ts`, bounded) so the render
never depends on a live image request, and the footer QR of the profile URL is
generated with `qrcode`. Two templates: **Classic** (navy header band, photo
left, mint accent rule) and **Minimal** (white, name over a thin red rule).
Sections with no data are absent; the footer — "Verified tutor on TutorMint" +
profile URL + QR — is on both.

**One build/test note.** `@react-pdf/renderer` cannot be imported under the
`tsx --test` runner — its `@react-pdf/hyphenate` dependency's export map has no
require/CJS condition — so the tests cover the pure mapper and the access gate;
the PDF bytes are proven by the build (the route compiles), a local run
(200 · `application/pdf` · `%PDF-`) and the live smoke. Next's bundler resolves
the dependency fine, so nothing goes in `serverExternalPackages`.

## Settings, identity cards, shortlist — as built (5 Sep 2026)

Three Minimal-UI fixes alongside the CV builder.

**The inline add-rows wrap and use the primary button.** The subjects add-row on
the tutor settings page forced a `sm:grid-cols-3` that slid the "Add subject"
button over the "Advance" radio between ~640 and 768px, and the button was
`bg-tm-black`. It is now a wrapping layout — input full width, level radios on
their own line, the button right-aligned — with the `tm-red` primary style. The
availability add-row (same forced grid) got the same rework. The degree /
certification rows (`CredentialEditor`) already wrapped; areas and experience are
plain inputs, no add-row.

**Identity documents are replaced, never removed.** `FileUpload` gained
`allowRemove` (default true; false on the CNIC front/back and the selfie), so
those cards show only **Replace** — the file is retained privately either way,
and "delete then re-upload before you can submit" was a worse flow. The
`remove-image` action and its client path (`IdentityCard.removeSide`) are gone,
including the server branch in `/api/identity` (no admin used it). The filled
`FileUpload` row now wraps cleanly (thumbnail, the "Uploaded" label beside it,
Replace) instead of clipping the label under the thumbnail on a phone. Each card
names its own document — **Front CNIC**, **Back CNIC**, **Selfie** — where all
three read "Front CNIC" before.

**The shortlist finally has a home.** Cards everywhere offer Shortlist, but a
parent could never see the list — it was write-only. The parent dashboard now
has a **Shortlisted tutors** section (`components/parent/ShortlistSection.tsx`):
the same `TutorCard`/`CardActions` row with the in-card Shortlist toggle hidden
(`hideShortlist`), plus one explicit **Remove from shortlist** with a confirm and
a toast that drops the card. An `EmptyState` shows when there are none.
`tutorCardsByIds` (`lib/browseTutors.ts`) loads the cards from `tutor_directory`
— so a tutor who has since unlisted drops out — ordered by the shortlist's own
`created_at`. No new table: `shortlists` (RLS `user_id = auth.uid()`) already
existed.

## Tutor dashboard cleanup, as built (5 Sep 2026)

Three fixes to `app/tutor/dashboard/page.tsx`. No migration; the seed cast is
untouched.

**The "You're verified" share card is on demand now, not on every load.** It
was an always-present section whose `<img src="/api/tutor/social/verified">`
fired a **satori image render on the server on every dashboard load** — a real
cost paid on each visit for a conversion surface almost nobody used, and no
Claude API is involved either way. It is now a small text link,
`components/tutor/ShareVerifiedBadge.tsx` ("Share your verified badge", Share2
icon), rendered in the header card (`IdentityBlock`'s new optional `extra` slot)
beside "View your public profile" and only for a **listed** tutor. Clicking
opens a dialog that renders the card and its three buttons at that moment — the
image element mounts only while the dialog is open, so nothing is generated
before the click. `VerifiedShareCard.tsx` is deleted; the
`/api/tutor/social/verified` route stays (it now serves the on-demand dialog).
The dialog carries the same accessibility contract as `ConfirmDialog` (Escape
and backdrop close, focus into the dialog on open and back to the trigger on
close).

**Dashboard order, both widths:** header card → "Who looked at you" teaser →
Needs you → Identity status line → CV card → Activity → Your things. The teaser
sits immediately below the header with **nothing above it** — this reverses the
"NEEDS YOU first" band order (see that section, now superseded); the owner chose
the primary upsell surface's position over the blocking-item argument. The
free-only funnel siblings (the "Your position" and "Jobs matching you this week"
cards) stay grouped directly under the teaser, since they are the same 199
funnel and "nothing above the teaser" puts the funnel at the top. Needs you now
sits directly above the identity status line — no card between them — which
removes the empty gap the owner saw there.

**The badge / identity-line contradiction was a seed-data gap, not a gate bug.**
A listed seed tutor (e.g. Ali Raza = `seed+featured-ali`) showed Verified +
Premium + Featured badges while the identity line read "Not submitted". The
badge is correctly gated on `tutor_directory`'s rule via
`tutorListed()`/`ent.listed`, which keys on `tutor_profiles.verification_status`
— NOT on the CNIC columns. The identity line, however, was reading
`loadIdentity`'s state, which comes from `profiles.cnic_verified_at` /
`verification_state`. For every listed verified seed tutor those two facts
disagree: `verification_status='verified'` and completion 100 (so badges show),
but `cnic_verified_at` is null and `verification_state='none'` (so the line said
"Not submitted") — even though they have uploaded CNIC docs (`cnic_number`,
`cnic_image_path` and ≥1 `user_documents` cnic row all present). In production
the two move together through the moderation flow; the seed set
`verification_status` directly and never advanced the CNIC columns.

The fix is display-only and does not touch the seed: for a **tutor**, the
identity line reads "Identity: Verified" whenever
`tutor_profiles.verification_status === 'verified'` — the admin's verification
decision IS the identity approval for a tutor (video + CNIC + degree audit) —
regardless of the separate CNIC column or image presence; below 'verified' the
CNIC-derived `loadIdentity` state stands. This mirrors the parent dashboard,
which already overrides the same line from its own approval facts (CNIC +
address). Only the tutor dashboard's identity line was affected; no badge
surface (profile, browse, social, dashboard) was changed, because none was
wrong.

**Inconsistent seed rows reported to the owner (not touched — the cast stays):**
every listed verified seed tutor carries `verification_status='verified'` with
`profiles.cnic_verified_at` null and `verification_state='none'` despite having
uploaded CNIC —
`seed+featured-ali`, `seed+premium-sara`, `seed+verified-usman`,
`seed+free-nadia`, `seed+free-hina` (and `seed+suspended-omar`, which shows no
badge anyway). Separately, `seed+unverified-zain` (meant to be an unverified,
browse-only parent) carries `verification_state='approved'` while
`cnic_verified_at` and `address_verified_at` are both null — harmless in the UI
(the parent line keys on cnic+address, so it reads "Pending review", not
Verified), but a stale value. `scripts/reset-seed-cast.ts` sets
`cnic_verified_at` for parents only, so this tutor gap persists across resets;
the owner can decide whether to seed the tutor CNIC-approval columns.

## Messaging part 2 — as built (5 Sep 2026)

WhatsApp-familiar messaging on the existing two-pane inbox, and two small CV /
seed fixes alongside it. Migration 53 (additive; backup taken first). Not built
(out of scope, named so nobody assumes they were missed): stories, communities,
calls, reactions, and the offensive-word filter (its own Moderation PR).

**One migration, additive.** `messages` gains `reply_to`, `read_at`,
`deleted_for uuid[]`, and `attachment_{path,w,h,bytes}`. New tables
`message_reports` (admin-read only; a reported message with a `message_snapshot`
so the admin sees exactly it) and `tutor_quick_replies` (owner-scoped, `tutor_id
= auth.uid()`). New private bucket `message-media` (owner + admin storage read;
served only through the participant-checked route). RLS audit **168/168** — the
new public tables carry scoped/admin policies, nothing anon-readable, no
allowlist edit needed.

**Delivery moved to Realtime, still masked at the source.** New-message delivery
was a plain `router.refresh()` after send; it now rides a Supabase **broadcast**
channel `thread:<id>` (`components/messages/useThreadChannel.ts`). The channel
carries only SIGNALS — `msg` (pull the new message by refreshing the RLS-scoped
server render), `seen` (refresh so a sent tick turns double), and `typing`
(debounced, never persisted) — and **no content**, so a guessed channel leaks
"someone is typing", never a body. Bodies still come only through the
server-rendered, `renderMessageBody`-masked path; broadcast is not enabled for
`postgres_changes`, so nothing replicates message rows to clients.

**Seen + typing.** `read_at` is stamped on the OTHER party's messages when a
member opens the thread (`markThreadRead`, service role, participant-checked —
`messages` has no member UPDATE policy, so a receipt is a server write). The
sender's own bubbles show a single tick (sent) or double green tick (seen). "Ali
is typing…" comes from the `typing` broadcast, auto-clearing after 3.5s.

**Per-message menu** (long-press on touch, right-click on desktop): Copy · Reply
· Report · Delete for me. **Reply** quotes the message above the composer and
stores `reply_to`; the quoted snippet is masked and clipped. **Report** opens a
reason picker (the confirm step) and writes BOTH a `message_reports` row (with
the snapshot) and a `reports` row with `target_type='message'`, `target_id=<the
message>`, so the admin reports queue shows **only the reported message** —
`loadReportQueue` loads that one message by id, never the rest of the thread
(stricter than a thread report). Toast "Reported. Our team will review it."
**Delete for me** confirms first, then appends the id to `deleted_for` (the row
is never removed — there is no delete-for-everyone); the read path filters it out
for the deleter only, and it stays for the other participant.

**Photo attachments, gated by the SAME rule as contact.** The paperclip is
enabled only when `ent.canViewContact` (`mayAttachPhoto`) — no new entitlement;
others get the disabled paperclip and the standard `tutor_contact`/`parent_contact`
upsell (never a lower plan). JPG/PNG ≤ 5 MB, re-encoded through `sharp` (strips
EXIF, gives real dimensions), stored in the private `message-media` bucket at
`<uid>/…`; `sendMessage` re-checks the path prefix and the gate before attaching.
Served only through `/api/messages/media/[id]`, which returns the bytes only to a
participant of the message's thread (`attachmentPathFor`) and 404s everyone else.
A bare photo previews as "Photo" in the list, and notifications never say more
than that. Identity documents never touch this path — a different bucket, a
different route.

**Tutor quick replies.** A row of chips above the tutor's composer, tap to insert
(never to send). Editable in Settings → **Quick replies** (`QuickRepliesEditor`,
max 6, plain text, its own save route `/api/tutor/quick-replies`). Defaults live
in `lib/messagingRules.ts` and show as the empty-state starting point; nothing is
stored until Save.

**List + header unchanged in shape**, refined per spec: the conversation-list
stamp is server-formatted (today → time, this week → weekday, else date, via
`messageListTime` in `lib/datetime.ts` — computed server-side so there is no
client re-derivation to mismatch); the preview shows "Photo" for a bare
attachment. Unread pill, header bell and the dashboard Messages tile still read
the same `notifications` rows, so they agree.

**Pure rules are unit-tested** (`npm run test:messaging`, 8 assertions,
`lib/messagingRules.ts`): a message deleted-for-me is invisible to the deleter
and no one else; only a thread participant may view an attachment; the paperclip
follows `canViewContact`; JPG/PNG ≤ 5 MB; quick replies trimmed/capped; "Photo"
preview. The end-to-end wiring (routes, RLS, Realtime) is proven by the live
smoke.

### CV + seed fixes shipped in the same PR

- **CV teaching-mode icon** is now a monitor, not the address pin
  (`components/cv/CvPreview.tsx`). **Phone / WhatsApp collapse to one line** when
  they are the same number, via a shared `cvContactRows` mapper used by both the
  HTML preview and the PDF (`lib/cv/model.ts`) — one mapper, no divergence.
  **Level labels are singular** ("O Level", not "O Levels") through a new
  `levelLabel` helper in `lib/display.ts`, used by BOTH the CV mapper and the
  public tutor profile's subjects section — again one mapper. `npm run test:cv`
  now 12 assertions.
- **`scripts/reset-seed-cast.ts`** sets the tutor CNIC-approval columns
  (`cnic_verified_at`, `verification_state`) for every seed tutor whose
  verification is 'verified', and clears the stale `verification_state` on
  `seed+unverified-zain`. The decision is a pure helper `expectedIdentity`
  (`scripts/seedCast.ts`) with a consistency invariant (verified ⟺ state
  'approved'), unit-tested in `npm run test:seedcast` (4 assertions). Script
  change only — NOT run against production in this PR.

## Social templates v2 — as built (5 Sep 2026)

Every social creative is now recognisably ours. Four templates (Spotlight light,
Bold dark, Success-story green panel, Announcement navy) × three formats
(square/story/wide), plus the tutor's on-demand "Share your verified badge" card
— all twelve render with zero satori errors.

**One text source.** Every word on a creative comes from `lib/social/copy.ts`
(pure — no next/og, no DB), so the render module (`app/api/admin/social/image/render.tsx`)
and the caption box read the SAME strings and cannot diverge. `scripts/test-social.ts`
(`npm run test:social`) scans it: the word **"commission" appears exactly once**
on every template (the tagline), the fixed band text is present on every
template, subjects carry singular level labels capped at three, the teaching
chip follows the online rule, and the caption carries the tagline once + URL +
handles + five hashtags.

**The fixed brand band** (`BrandBand` in render.tsx) rides all four templates,
all three formats, and the tutor card: the one-word wordmark; the tagline **"No
fee. No commission. No middleman." exactly once** (and "commission" appears
nowhere else on the creative); `tutormint.org`; the handle line
`@tutormint.official` with the Facebook/Instagram/YouTube/TikTok marks
(`lib/social/marks.ts` — the `public/` PNGs downscaled to 72px and base64-embedded,
the same no-fs-on-Vercel discipline as the CV font) and **"X: @TotorMint5"**
separately; and a **QR of the tutor's public profile** (the `qrcode` package,
`cvQrDataUri`, the same helper the CV uses). Placement adapts per format (bottom
strip on square/wide, lower block on story); content is identical.

**Richer body from the live profile.** Photo (or initials disc), name + badges,
rating + count when present, up to three subjects with singular level labels
(`lib/display.ts` `levelLabel`, resolved from `tutor_subjects` because
`tutor_directory.subjects` is null — `lib/social/data.ts`), years of experience,
a teaching-mode chip ("Suitable for online" when `allowsOnline`), area · city,
and a template-specific CTA (Spotlight/Bold "Hire verified tutors on
tutormint.org"; Success "Congratulations — verified on TutorMint" / "— hired
through TutorMint" by the occasion toggle; Announcement the admin's headline).
Sections with no data are omitted. Templates stay visually distinct; the band is
the constant. Brand tokens only (hex literals for satori); `check:contrast`
covers every text/background pair across the templates (83 pairs).

**Caption box.** Built from the same `SocialData` by `buildCaption` — one line
about the tutor, the tagline once, the profile URL, the handles, five hashtags
(#TutorMint · city tag · subject tag · two evergreen); the announcement caption
leads with the headline. "Copy caption" and "Download PNG" both toast. The admin
preview still updates on every template/format switch via `<img key={url}>` — no
full reload. The tutor's own contact details never appear on a creative.

## Carry-overs shipped in the same PR (5 Sep 2026)

**CV PDF ↔ preview parity.** Every heading and line's text now comes from
`cvSections()`/`cvTextLines()` in `lib/cv/model.ts` — the preview
(`components/cv/CvPreview.tsx`) and the PDF (`lib/cv/pdf.tsx`) build NO string of
their own. `scripts/test-cv.ts` serialises the preview (react-dom/server) and
asserts it equals `cvTextLines`; the PDF renders the same lines by construction
(it cannot be imported under tsx — the @react-pdf/hyphenate CJS gap — so its
equality rests on reading the same functions + the smoke). The PDF **name is
genuinely bold** (Geist Bold embedded in `lib/cv/font.ts` — react-pdf has no
faux-bold), the **headline sits on its own line** with its own line-height (no
overlap in either template), and the **bullets are the same icons as the
preview** (react-pdf `Svg` paths in the neutral the preview uses, not "•").

**Notification bell.** The badge caps at **99 → "99+"** (was 9 → "9+").
**"Mark all read"** exists now — a bell-panel button and a full-page button
(`markAllRead` + `/api/notifications/read-all`) that zero the count. A **new
notification increments the badge live** without a reload: `notify()` broadcasts
a contentless `new` signal to `notify:<userId>` (Supabase's HTTP broadcast
endpoint, service role) and `NotificationBell` subscribes and bumps the count.
Broadcast, not `postgres_changes` — the transport the messages system already
uses on production, with no RLS-on-the-socket subtlety, and carrying no data so
a guessed channel leaks nothing; the exact count re-syncs from the authenticated
route on panel open. (Migration 54 added `notifications` to the
`supabase_realtime` publication as a belt-and-braces option; the live path is the
broadcast.) Opening the panel still marks the shown unread read and drops the
badge; the count equals `/account/notifications` (same `unreadCount`). The
dashboard "Messages" tile remains a deliberate `message_received`-only subset of
the bell's total — it reads the same rows, so it agrees on messages; it is not
meant to equal the bell's all-kinds total.

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

- **SMS provider** — **SendPK, the only provider** (`SENDPK_*`). The owner
  removes `BRIDGE_OTP`/`BRIDGE_OTP_EXPIRES` once real codes are confirmed
  arriving. No longer a code blocker.
- **SMTP** on the Supabase project — **configured** (Resend, `noreply@tutormint.org`;
  Part 8). Confirmation links, password-reset email and staff invites deliver.
- **AssanPay go-live** — in negotiation; until then manual transfer + admin
  approval is the only paid path.
- **CUIN and NTN** — **DONE** (owner, 9 Sep 2026): `company.reg_no = 0353636`,
  `company.ntn = J833612` set in `app_settings` from the FBR certificate. The
  company-number rows and the schema `identifier` now render.
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

## Part 3 — brand-complete UI, instant search, conversion, legal identity (as built, 7–8 Sep 2026)

The pass that made the site brand-complete for partner testing. Most of it was
verification — much was already built and correct — so this records the deltas
and the decisions, not a re-description of what already stood.

**Viewer identity moved back to Premium (migration 56). — SUPERSEDED 8 Sep 2026,
see "Viewer identity unlocks at Verified" below; migration 57 reverts this and
the copy in this paragraph no longer describes the code.** Migration 43 had made
"see who viewed your profile" a Verified (199) power to drive the 199 funnel;
Part 3 briefly reversed it to Premium via migration 56, then the owner reversed
that reversal. The live rule is Verified and above.

**Avatars never break again (defensive, on top of the data fix).** The live
breakage was a stale Sydney `avatar_url` against the Mumbai-derived CSP
`img-src` — a host the CSP does not name renders nothing. The region task
rewrote the six rows; this added `normalizeStorageSrc()` in
`components/Avatar.tsx`, which rewrites any `https://<ref>.supabase.co/storage/…`
origin to the current `NEXT_PUBLIC_SUPABASE_URL` origin at render time, so a
future host change cannot resurface the bug. The shared `<Avatar>` still falls
back to the initials disc — never a broken-image icon.

**Instant search reached the last three admin lists.** Browse tutors, browse
tuitions and the member directory were already typeaheads; this wired the admin
**tutor** and **payment** queues, the two the T-Search "deliberate limits" note
named as still owing it. `components/admin/QueueSearch.tsx` is the shared input —
`Typeahead` with `suggest={false}`, the same rule the member directory follows:
the public suggest index holds only listed tutors and open jobs, and is blind to
the pending, suspended and unclaimed rows an admin opens a queue to find, so
there is no panel, only a live-refreshing server query. `loadTutorQueue` gained
an `.or()` over name/email/city/headline/slug; `loadPaymentQueue` resolves payer
ids by name/email and OR's them with the payment's own references (a receipt's
reference is what a payer quotes). Both thread `search` through the shared
load-more route (`app/api/admin/queues/[kind]/route.ts`) and the clients' storage
keys, so a searched window never restores an unsearched one's rows. No search
button was added anywhere.

**The conversion sweep — two nudges the 199 funnel wanted
(`lib/conversionSweep.ts`, on the daily cron).** The per-view `profile_viewed`
notification already existed (per-day, no upsell); this added the WEEKLY
`viewer_weekly_teaser` — "N parents viewed your profile this week", body sells
Premium, `→ /tutor/packages?plan=premium` — capped at one a week, never sent on a
zero-view week, and only to tutors who cannot already see viewer identity (a
Premium/Featured tutor is never pitched what they hold). And `quota_nudge` at 80%
of the month's allowance, once a period — only for a plan whose displayed
allowance is a real number, so a plan advertising "Unlimited" never has its real
100-cap surfaced to the member. Both caps are the notification itself: "did we
already nudge this week / this period" is a query for the last one of that kind,
no new column, exactly as `profile_viewed` and `rank_dropped` throttle. Both are
post-signup and land in the bell, so the "no price before signup" rule holds by
construction.

**The upgrade sheet took the inbox's last plain link.** The system was already
wired into apply, hire, contact, CV and parent-jobs (all through
`postGated`/`UpgradeTrigger`). The one remaining plain `<Link>` to a packages
page — the "phone numbers are hidden, Upgrade" chip in `Conversation.tsx` — now
opens the sheet via `UpgradeTrigger reason={contactReason}`, the same reason the
paperclip already used, so no price ships in the HTML. The dead `upgradeHref`
prop was retired from `Conversation` and `InboxShell`.

**Legal identity + SEO.** The Terms/Privacy entity paragraph, the /about brand
story, the homepage Organization + WebSite JSON-LD, the site-wide BreadcrumbList
(per-page + `LandingView` + `LegalDoc` + the admin layout — every public surface,
the two landing routes included), and the title/description templates
("…verified, no commission | TutorMint" / "…on TutorMint, Pakistan's verified
tutors network. No fee, no commission, no middleman.") were confirmed in place;
`components/LegalDoc.tsx` folds the SECP number inline and Terms carries the
messaging-consent paragraph.

**Member directory: mobile column + filtered CSV export.** Each member row shows
the mobile with a `CopyButton` (a stretched-link card, the button `relative
z-10` and stop-propagation so it copies without navigating).
`/api/admin/users/export` streams a CSV honouring the active q/role/status
filters — Name, Role, Mobile (92… WhatsApp-ready via `normalisePkMobile`),
WhatsApp, City, Plan, Verification, Joined — owner + manager only
(`SCREEN_ACCESS.usersExport`), CSV-injection-safe, UTF-8 BOM, and every download
writes an `admin_audit_log` row (`member.export`, with the filter set and row
count).

**Ads admin lists each ad's live placements.** Each card carries a "Showing on:"
line derived from the ad's audience and the fixed slot rules (parent dashboard,
browse tutors/tuitions after every 8 results), so an advertiser's placement is
readable without cross-referencing the spec.

Gates at close: tsc 0 · build 0 · check:contrast 89 · rls:audit 168/168 ·
test:blog 35 · test:covers 16 · test:cv 14 · test:delivery 14 · test:jobcopy 11 ·
test:grouping 8 · test:messaging 8 · test:social 7 · test:seedcast 4 — all pass.

## Viewer identity unlocks at Verified (owner, 8 Sep 2026) — SUPERSEDES everything above

**This is the locked decision. Under precedence rule 10 it beats every earlier
statement on viewer identity — the migration-43 spec text, the entitlements
matrix, and the Part 3 migration-56 paragraph — wherever they differ.**

- **"Who looked at you" — the viewer's NAME and photo — unlocks at Verified (199)
  and above.** `plans.can_see_viewer_identity` is true on verified, premium and
  featured (migration 57 restores it on verified, reverting migration 56).
- **Only free / no-plan tutors get the anonymised teaser** — the parent photo
  blurred, the seed-based disc, the searched subject and area but no name. Their
  CTA points at **`plan=verified`** (the 199-funnel entry), never premium.
- `REQUIRES.tutor_viewer_identity` in `lib/gate.ts` reads **`'verified'`**; the
  gate body and `ViewsCard` / `app/(site)/tutor/dashboard/views` sell Verified;
  `lib/conversionSweep.ts`'s `viewer_weekly_teaser` sells Verified with
  `plan=verified` and reaches only tutors who cannot already see identity (now
  free/no-plan).
- Why: seeing who viewed you is the primary reward of the 199 funnel and the
  tutor dashboard's main upsell surface — so it must sell the 199 plan, not the
  499 one. This was the migration-43 intent; migration 56 briefly moved it to
  Premium and was reversed. **The row moved before the label** each time (the
  column via migration, then the gate), so a button never offered a plan whose
  row did not carry the power.
- Premium's exclusive reasons to upgrade remain the three it owns alone: 25
  applications against 10, WhatsApp to parents, and search priority. Featured
  adds parent contact details on the profile.

## Auth & trust decisions (owner, Sunday 6 Sep)

- Signup identifier is ONE field, Facebook-style: "Mobile number or email" — digits → mobile path (OTP), address → email path (confirmation link). Email/mobile can be added later in settings; the register form stays five things: role radios, full name, identifier, password, consent.
- OTP: 6 digits, 10-min validity, 5 attempts; Resend sits behind a visible 5-minute countdown and auto-reactivates.
- Bridge OTP: until the owner's third-party OTP API is enabled, env BRIDGE_OTP (allowed in production, separate from DEV_DEFAULT_OTP whose production guard stays) makes that code verify any signup. Accounts verified this way are tagged phone_verified_via='bridge' (visible in admin + a column in the CSV export). When the real provider lands: remove BRIDGE_OTP, bridge-verified users re-verify once on next login.
- Login: "Remember me" checkbox (checked = persistent session as now; unchecked = session cookie only) and show/hide-password eye on EVERY password field platform-wide.
- No silent successes: every completed action shows explicit confirmation (toast or screen) — password reset, profile step saved, job posted, application sent, message sent, payment submitted, verification submitted, OTP verified.
- Admin → member messaging: "Send message" on member pages and queue drawers; delivers as an official in-app notification + thread from "TutorMint Team" (system-styled) + email. Template library (owner/manager editable) seeded with: CNIC unclear, address untraceable, job reported/under review, video re-record ({reason}), profile-completion nudge, payment received/approved. Placeholders auto-fill ({name}, {job_title}); body editable before send; every send audit-logged + on the member timeline; member replies land in an admin support inbox view.
- Report-driven states: a job (or tutor profile) with an open report flips to "Under Review" — amber sticker on card + detail, applications paused (Apply disabled with "This job is under review", NOT an upgrade sheet), profile temporarily delisted from search. Auto-trigger: 1 report from a verified member or 2 from anyone. Resolution either clears (reopen + canned notification) or upholds (remove/penalise via existing flows). False reporters accumulate penalties.
- Fraud bans: status 'banned' distinct from 'suspended' (banned = permanent, owner/manager only, audit-logged, shows on timeline). Banned login is refused with: "Your account has been banned due to fraudulent activities. Please contact support." + support link; no session created. The banned account's mobile and CNIC go on an internal blocklist checked at signup and at claim. Terms gain the clause: fraud, scams, impersonation, fake documents, or payment deception → immediate permanent termination without prior notice, active plan forfeited without refund; TutorMint may preserve evidence and cooperate with law enforcement.

### As built (Part 4, 8 Sep 2026)

Migration 58 (additive; applied to the one database, backup of the view defs
taken first). Gates at close: tsc 0 · build 0 · check:contrast 89 · rls:audit
**174/174** · all suites pass.

**Single-identifier signup.** `/register` is five fields: role, full name, one
"Mobile number or email" identifier, password, consent. `/api/auth/register`
branches: digits → the mobile/OTP path exactly as before (synthetic email,
`phone_gate_required`, first code, `/verify-phone`); an address → `supabase.auth
.signUp` (unconfirmed, no session, no phone gate) and `/verify-email`, a
"check your inbox" screen. The email path's confirmation link needs SMTP on the
project (the same open owner item password-reset email waits on) — the account
is created and the screen is honest, but the link cannot arrive until SMTP is
set. The register form's helper text adapts as you type.

**OTP: 5-minute resend, mm:ss.** `RESEND_COOLDOWN_MS` is 5 minutes; the button
shows a live `m:ss` countdown and re-enables at zero, on `/verify-phone` and the
parent settings mobile card. 10-minute validity and 5 attempts unchanged.

**Bridge OTP.** `BRIDGE_OTP` (`lib/sms.ts` `bridgeOtpCode()`) is a SEPARATE env
from `DEV_DEFAULT_OTP` and is DELIBERATELY allowed in production — it fills the
gap until a real SMS provider exists. `verifyOtp` accepts it and returns
`bridged: true`; the OTP route then tags `profiles.phone_verified_via = 'bridge'`
(else `'otp'`). `sendOtp` skips the (unconfigured) provider while the bridge is
live. `DEV_DEFAULT_OTP`'s three production guards are untouched — `assertOtpSafety`
inspects only that variable, so the bridge does not trip the boot guard.
Bridge-verified accounts are visible in admin (a chip) and the CSV, and the login
route re-raises the phone gate for a bridge-verified account once `BRIDGE_OTP` is
removed, so they re-verify once with a real code.

**Remember me + password eyes.** `lib/sessionCookies.ts` + a `tm_persist=0`
flag cookie: unchecked remember-me strips maxAge/expires from the sb-* auth
cookies (session cookies), honoured at login AND on every refresh
(`lib/supabase/server.ts` + `proxy.ts`), so it survives token refresh.
`components/ui/PasswordInput.tsx` is the one show/hide field — on register,
login, forgot-password and the forced-change screen (and the tutor settings
change-password block).

**No silent successes.** Added explicit confirmation to the four hard silent
flows — forced password change, job posted, payment submitted, OTP verified —
and the two borderline ones (parent avatar auto-save, `ApplyFromStrip`). The
inline-banner flows (tutor/parent settings save, tutor video submit, parent
verify) already confirmed and were left.

**Admin → member messaging (dedicated store).** `admin_messages` +
`admin_message_templates`, NOT the member↔member `threads` table — that keeps
the "no chat-browsing screen" privacy line true by construction: `/admin/inbox`
only ever reads official Team↔member messages. `sendAdminMessage` does the three
things the spec names — an `admin_message` notification, the thread, and an email
(`admin_message` template, essential) — plus an audit row (`member.message`) and
a member-timeline entry (`admin_message_received`). Seven templates seeded
(`{name}`/`{job_title}`/`{reason}` placeholders), owner/manager editable in the
inbox; the body is editable before send. The member reads and replies at
`/account/messages`; replies land in `/admin/inbox`. No fake system auth user
exists — the member always sees "TutorMint Team", never the acting admin.

**Report-driven Under Review.** `jobs.under_review` / `tutor_profiles.under_review`
booleans (not a new enum value). `lib/underReview.ts` flips a target to under
review when a report crosses the trigger (one VERIFIED reporter, or two of
anyone), notifies the owner, and the two listing views exclude under-review
tutors from browse/search (a job stays visible with an amber sticker; a tutor is
delisted). Apply is paused server-side in `lib/applications.ts` with a plain
message and NO gate (not an upgrade sheet). Resolving the report clears the flag:
a dismiss reopens + notifies + records a `report_penalty` against the reporter
(false reporters accumulate penalties); an uphold clears it while the sanction
carries on. Ban is a queue action too (owner/manager).

**Ban system.** `profiles.is_banned` quartet, mirroring `is_suspended`.
`banMember`/`unbanMember` in `lib/moderation.ts`: ban is owner/manager with a
typed-"BAN" confirmation, adds the mobile + hashed CNIC to `signup_blocklist`,
and is refused at login with the exact message and NO session (the login route
signs out again). `getEntitlements` short-circuits a banned account to nothing.
Unban is owner only and clears the blocklist rows. `signup_blocklist` is checked
at signup and at claim. CNIC is stored as a sha256 hash, never in the clear.

**Terms.** The fraud clause (permanent termination, plan forfeited without
refund, evidence preserved, blocklist) is in the "Warnings, suspension and
closing accounts" section; the messaging-consent line was already present.

## Index now, banner stays (owner, 8 Sep 2026) — SUPERSEDES "Preview mode comes OFF before launch"

**The owner decided to index the public pages NOW, while the "launching soon"
banner stays up.** Under precedence rule 10 this supersedes the T8b GATE in
"Preview mode — comes OFF before launch (3 Sep 2026)", which said indexing must
wait until real verified tutors are listed. Production's `robots.txt` was
blocking every crawler (GSC live test: "Blocked by robots.txt"); that is the
concrete cost this fixes.

- **`NEXT_PUBLIC_PREVIEW_MODE` now controls only the banner** (`components/
  PreviewBanner.tsx`). It no longer drives any SEO behaviour — the three-places
  design in `lib/preview.ts` is decoupled.
- **`app/robots.ts`** always serves the public rules: `Allow: /` with disallows
  only for `/admin`, `/api`, the dashboards, `/parent/verify`, `/tutor/complete-profile`,
  `/tutor/claim`, `/account`, `/verify-phone`, `/verify-email`, `/messages`,
  `/chat`, `/pay`, `/suspended`, `/dev`, the auth forms, and the `?`-filtered
  browse variants. `Sitemap:` and `host` are **www** (the apex 301s to www).
- **`app/layout.tsx`** sets no site-wide noindex. Authenticated/admin pages keep
  their own per-page `robots: { index: false }` and are robots-disallowed +
  auth-gated, so only the public surface becomes indexable.
- **`app/sitemap.ts`** always lists tutors, tuitions, landing pages and blog
  posts (the preview withholding is gone).
- There is no `X-Robots-Tag` header anywhere; the only noindex was the layout
  meta removed here.
- The seed-directory concern the old gate raised (fixtures ranking for a real
  tutor's name later) is a known, accepted trade the owner made deliberately.

## Part 5 decisions (owner, 8 Sep 2026 — later than "Index now, banner stays")

Later-dated than both "Viewer identity unlocks at Verified" and "Index now,
banner stays", so under precedence rule 10 these win over anything above them
they touch.

- **Under review delists, it does not unpublish.** `under_review` removes a tutor
  from `tutor_directory` — browse, `rank_tutors()`, search and the sitemap — and
  nothing else. `tutor_visible_profiles` still renders the profile, with a plain
  amber notice in place of the contact and apply affordances. A single report
  from one verified member must not be able to 404 the SEO asset a tutor pays 199
  a month for. Banned and suspended accounts are unchanged: out of both views,
  branded 404 shell per "Graceful handling of unknown input". Jobs stay as built —
  visible, amber sticker, Apply paused with the plain message.
- **Email signup is gated until SMTP.** The identifier field still accepts an
  address, but the route stops before creating the account and returns: "Email
  signup isn't available yet. Please sign up with your mobile number." No account,
  no dead confirmation screen. This reverses the Part 4 behaviour deliberately:
  the public pages are now indexed, so real strangers can reach /register, and an
  account whose only verification path cannot deliver is a member with no way in
  and no way out. Re-enable the email branch in the same PR that configures SMTP —
  it is the same open owner item password-reset email waits on.
- **BRIDGE_OTP is time-boxed, rate-limited, and buys nothing.** It requires
  `BRIDGE_OTP_EXPIRES` (a date) in env; past that date it stops verifying whether
  or not the code is still set. While active: signup is rate-limited per IP, and
  every admin screen carries an amber banner reading "Bridge OTP is active —
  remove when the SMS provider lands." A `phone_verified_via='bridge'` account
  cannot activate a paid plan and cannot hold the Verified badge until it
  re-verifies with a real code. Mobile verification is one of the four things
  "Trust = verification" rests on; a shared code proves nothing, and with the site
  now indexed an unbounded bypass is a bulk fake-account vector aimed at the only
  thing the platform sells.
- **One member inbox.** Official "TutorMint Team" messages appear in the existing
  `/{role}/dashboard/messages` inbox, system-styled, alongside member threads. The
  dedicated `admin_messages` store stays — it is what keeps the "no chat-browsing
  screen" line true by construction, and that reasoning is correct.
  `/account/messages` becomes a redirect into the role inbox, the same treatment
  `/messages/[threadId]` already gets. Two message screens is a place official
  messages go unread.
- **The Canonical tables section is part of the definition of done.** Every
  migration that adds a table or a column updates it in the same PR. A future
  session reads that list as the schema reference; migration 58's three tables and
  its new columns were absent from it.

### As built (Part 5, 8 Sep 2026)

NO migration — every change is app-level (envs, view behaviour was already
correct). Gates at close: tsc 0 · build 0 · check:contrast 89 · rls:audit
**174/174** · test:authtrust 15 · test:delivery 15 · every other suite green.

**Verifications, first.** Migration 58's view redefinitions were confirmed
provably additive against the pre-58 backup: identical column lists in both
views, only added WHERE predicates (`is_banned` on both, `under_review` on
`tutor_directory` only), and 0 differing rows vs. the pre-58 logic against the
live tables (directory=6, visible=8). And the under-review question was settled:
an under-review tutor's public URL **renders** (via `tutor_visible_profiles` →
`tutor_public_page`) while being delisted from browse/search/sitemap — the
As-built paragraph was right, the Part 4 report's "both listing views exclude
under-review" was wrong. `lib/underReview.ts`'s doc comment carried the same
error and was corrected.

**Under review.** `app/(site)/tutor/[slug]/page.tsx` reads `under_review` via the
service role (it is not in `tutor_public_page`'s fixed allowlist) and, when set,
shows an amber notice and suppresses the Contact section and the sticky
`ProfileActions`. `npm run demo:underreview -- --on [key]` / `--off` is an opt-in
demo, SEPARATE from seed-dev/reset-seed-cast so the asserted cast does not drift.

**Email gate.** `/api/auth/register`'s email branch returns the exact copy above
before creating anything; the register form's helper adapts. Accounts created
down the old email branch since Part 4: **0** (queried live), so nothing to
dispose of; delete nothing stands regardless.

**BRIDGE leash.** `lib/sms` `bridgeStatus()`/`bridgeOtpCode()` require
`BRIDGE_OTP_EXPIRES` and go dead past it (a missing/invalid expiry ⇒ off, so it
cannot be left on by omission). A tighter `register_bridge` per-IP cap (3/hour)
applies only while active. `components/admin/BridgeBanner.tsx` shows the amber
strip on every admin screen while active. The plan/badge lock lives in
`computeEntitlements` (bridge ⇒ no plan, no badge, `bridgeLocked`, listing kept),
`goLive` (a bridge account's paused plan does not start its clock) and `activate`
(a bridge purchase is recorded but paused). **Interaction with "A badge means
LISTED":** they compose cleanly — a bridge tutor stays LISTED (still in
`tutor_directory`, still in browse), but a badge additionally needs a plan, and
the bridge lock withholds the plan, so the tutor is listed-without-badge (the
same state a free tutor at 100% is in). The lock does not delist; it removes the
plan and thus the badge. `login` already forces one re-verification when
`BRIDGE_OTP` is removed.

**Inbox unification.** The Team channel is a pinned system row in the role inbox
(`InboxShell`), opened at the reserved thread id `team` → `TeamPane` (reads
`admin_messages` via `loadConversation`, marks read on open, replies via
`/api/account/messages`). `/account/messages` redirects to
`/{role}/dashboard/messages/team`. `unreadMessageCount` (the dashboard tile) now
adds `teamUnreadCount`. The dedicated store is unchanged, so the no-chat-browsing
line still holds.

**Ban from the reports queue.** `ReportQueue` gained a Ban button (owner/manager
only, `canBan` from the page) with the same typed-"BAN" confirmation as the
member page; the route already supported the action.

**Tests (item 1).** Pure decision cores were extracted so the logic is genuinely
unit-tested without touching the one shared DB: `bridgeStatus`/`otpMatch`/
`resendWaitSeconds` (lib/sms, lib/otp), `applySessionPersistence` (lib/
sessionCookies), `hashCnic`/`blocklistHit` (lib/blocklistCore), `crossesReview
Threshold` (lib/underReviewCore), and `computeEntitlements` (lib/entitlements —
getEntitlements is now an I/O wrapper around it). `scripts/test-auth-trust.ts`
(15 assertions) covers bridge verify/expiry, the resend countdown, remember-me
session cookies surviving a refresh, blocklist mobile+CNIC matching, the report
threshold, and computeEntitlements for banned / suspended / bridge / active /
free-parent. `test-delivery.ts` gained the bridge-allowed-in-production case
alongside the existing DEV_DEFAULT_OTP-refuses-in-production one. What is genuine
DB-integration (the login 403, the phone_verified_via write, the live blocklist
read, the under_review flip) is proven by its pure core plus code review — no
browser was driven, as in Part 4.

**Correction (Part 6, 9 Sep):** the sentence above originally read "pure core
plus the live smoke". That overstated it. Part 5's only live-database access was
READ-ONLY: the psql verification SELECTs (view row counts, the pre-58
symmetric-diff, a `tutor_public_page` spot check, the email-branch and
bridge-account counts) and `rls:audit`'s read probes. `scripts/smoke.ts` was NOT
run in Part 5, and Part 5 wrote NOTHING to the one production database — the
right call, the same one Part 4 made. The DB-integration paths rest on their
pure-core unit tests and code review, not on an executed end-to-end run.

## Part 6 decisions (owner, 9 Sep 2026 — later than the Part 5 block)

Later-dated than the Part 5 block, so under precedence rule 10 these win over
anything above them they touch. Small gaps, no new systems: no table, no
migration.

- **An under-review profile renders but is never indexed.** Keeping the URL alive
  (Part 5) was to protect the tutor's page from a single report, not to publish a
  notice to Google. While `under_review` is true the page sets
  `robots: { index: false }` per-page, dropped the moment the flag clears. It is
  already out of the sitemap and out of `tutor_directory`; this closes the last
  path in. This is a per-page exception to "Index now, banner stays" — the same
  shape as the authenticated/admin pages that already carry their own per-page
  noindex, not a reversal of it.
- **The bridge banner counts down.** `BridgeBanner` reads `BRIDGE_OTP_EXPIRES` and
  shows days remaining: "Bridge OTP is active — 6 days remaining. Remove when the
  SMS provider lands." Fail-closed on a missing expiry is correct, but a deadline
  that arrives silently closes signup silently, and the public pages are indexed
  now — so once expired the banner stays up with different copy rather than
  vanishing.
- **`/verify-phone` is not a dead end.** Until a real SMS provider exists, a member
  who cannot receive a code has no route forward. The screen gains an honest line
  and the WhatsApp + email fallback from `app_settings`, the same pattern
  `/support` uses: "Not receiving the code? Message us and we'll verify you." No
  invented delivery time, no promise about how fast. This comes out when the
  provider lands.

### As built (Part 6, 9 Sep 2026)

NO migration, NO new table — three targeted gaps closed. Pure cores extracted so
the new behaviour is unit-tested without the one shared database.

- **Under-review noindex.** `app/(site)/tutor/[slug]/page.tsx` gained a shared
  `tutorUnderReview(id)` (service-role read — the flag is not in
  `tutor_public_page`'s fixed column allowlist), used by BOTH `generateMetadata`
  (adds `robots: { index: false, follow: false }` only while under review, so a
  resolved profile returns no robots key and is indexable again immediately) and
  the page body (the amber notice). `force-dynamic` means no caching to stale the
  flag. `app/sitemap.ts` and the `tutor_directory` exclusion are UNCHANGED —
  under-review tutors were already absent from both (the sitemap reads
  `listed_tutor_slugs()` → `tutor_directory`); this only closed the direct-URL
  index path.
- **Bridge countdown.** The pure `bridgeBanner(status, now)` in `lib/sms`
  (`{ show, expired, message }`): while active, `Math.max(1, ceil(daysLeft))` with
  the owner's exact copy; past expiry (`codeSet && expired`), a red "has expired —
  new signups can no longer verify" strip that stays up; absent only when a bridge
  was never configured. `components/admin/BridgeBanner.tsx` renders it on every
  admin screen it already appeared on (the shell banner slot). Tested in
  `test-auth-trust.ts` (6-day count, singular "1 day", past-expiry, never-set).
- **/verify-phone fallback.** The page reads `getSupportContact()` (app_settings
  first, env fallback, never hardcoded — CLAUDE.md rule 7) and renders a "Not
  receiving the code?" block with WhatsApp and/or email, each shown only when that
  channel is actually configured (a `wa.me/` or `mailto:` with nothing behind it
  is worse than no button). No invented delivery time.
- **/verify-email left alone, and why.** It is unreachable through the app now:
  `/api/auth/register`'s email branch returns a 400 before creating anything and
  never hands back `next: '/verify-email'`, so `RegisterForm` never navigates
  there. The route file remains (a "check your inbox" screen for a flow that
  cannot start), reached only by typing the URL. It needs no fallback; it comes
  back into use in the same PR that ungates the email branch (when SMTP lands).
  **(Part 8, 9 Sep: SMTP landed — the email branch is ungated and /verify-email
  is reachable again. This paragraph is a historical record of the Part 6 state.)**

## Part 8 decisions (owner, 9 Sep 2026 — later than the Part 6 block)

Later-dated than every block above, so under precedence rule 10 these win over
anything they touch — in particular they LIFT the Part 5 email gate and correct
every "email path unavailable / SMTP unconfigured" note above to past tense.

SMTP is now configured on the Supabase project (Resend, sender
`noreply@tutormint.org`). The Part 5 gate on the email branch was explicitly
conditional on this ("re-enable the email branch in the same PR that configures
SMTP"), so this restores it.

- **Both signup paths are live.** The single "Mobile number or email" identifier
  field accepts either and the user chooses. Digits → OTP (delivered on WhatsApp,
  see below). An address → Supabase confirmation link over Resend, created
  UNconfirmed with no session, finished by clicking the link (which lands on
  `/api/auth/callback`). The Part 5 gate — the 400 "Email signup isn't available
  yet" that created no account — is removed. This restores the Sunday 6 Sep
  decision as originally written.
- **OTP is delivered on WhatsApp, not SMS.** (Superseded: since PR5a/5b the code
  goes by SMS through SendPK, the only provider.) The provider of the time sent the
  code as a WhatsApp message from an approved business number; SMS on the same
  account did not deliver. `/register` and `/verify-phone` say so plainly ("code
  on WhatsApp") so nobody signs up with a WhatsApp-less number and waits for a
  message that cannot arrive; the /verify-phone support fallback (Part 6) is the
  route for anyone without WhatsApp. SMS may be added later as a SECOND channel —
  the send layer is to grow a new implementation behind the existing `SmsProvider`
  interface, not surgery on the OTP flow. **BRIDGE_OTP is untouched by this PR**
  and stays until real codes are confirmed arriving on the live site.

### As built (Part 8, 9 Sep 2026)

NO migration, NO new table. Gates at close: tsc 0 · build 0 · check:contrast 89 ·
rls:audit 174/174 · suites green.

- **Email branch restored.** `/api/auth/register`'s `if (asEmail)` block is the
  Part 4 branch again (duplicate-email check → `supabase.auth.signUp` with
  `emailRedirectTo=/api/auth/callback` → UTM copy → `next: /verify-email?to=`).
  The confirmation link resolves end to end through `/api/auth/callback`
  (`exchangeCodeForSession` → `sendWelcomeOnce` → redirect). The mobile path is
  byte-unchanged (still `/verify-phone`).
- **Copy.** Register adaptive helper: mobile → "code on WhatsApp", email → "email
  a confirmation link", unknown → "either works … mobile gets its code on
  WhatsApp". `/verify-phone` says the code is sent on WhatsApp and the Part 6
  fallback is retitled "No WhatsApp on this number?". `/verify-email` is honest
  (mail sends now) and gained a **Resend** button (`ResendEmail.tsx`, browser
  client `auth.resend({type:'signup'})`) that surfaces Supabase's 60-second
  per-user minimum as a live countdown rather than failing silently — no oracle
  concern, it is the address the member just typed.
- **Password reset over email** already worked in code (`resetPasswordForEmail`
  in `ForgotPasswordForm`, browser client → `/api/auth/callback?next=/account/password`);
  it was only waiting on SMTP. Removed the stale "SMTP is not configured yet"
  comment; mobile stays the default because most members have no inbox, not
  because email cannot deliver.
- **Stale-copy sweep.** Corrected the current-status SMTP/email notes: this file's
  Auth-flows and Pages-to-keep lines, the register-form-rules and Mobile-first
  superseded banners, and the two "Open owner decisions / Roadmap blocking-launch"
  SMTP bullets; `PRODUCTION_CHECKLIST.md`'s SMTP item is ticked. Historical dated
  As-built paragraphs (Part 4/5/6) are left as records with a Part-8 pointer where
  they would otherwise read as current.
- **Not touched:** the WhatsApp send-layer wiring itself (Part 7 stage 1,
  probe-only) and BRIDGE_OTP. The copy tells the truth about the intended
  channel; the bridge remains the live delivery stopgap until real WhatsApp codes
  are confirmed arriving.

## Part 7 stage 2 — OTP delivery, wired (9 Sep 2026) — SUPERSEDED

The WhatsApp OTP provider wired here was taken out of `getSmsProvider()`'s chain
in PR5a and its module deleted in PR5b; SendPK is the only SMS provider (owner,
14 Oct 2026 — see "SendPK is the only SMS provider"). What still stands from this
part: delivery is reported as ACCEPTED, never as delivered; the support fallback
is always visible on `/verify-phone`; a number cannot open two accounts; and
BRIDGE_OTP is a backstop whose handover is `needsBridgeReverify()` (once
`BRIDGE_OTP` is unset, a `phone_verified_via='bridge'` account re-verifies once
at next login). The per-number send caps were later replaced by "one OTP per
number" (11 Sep 2026).

## The auth trigger, restored (9 Sep 2026) — migration 59

The `on_auth_user_created` trigger on `auth.users` — which runs
`public.handle_new_user()` to write the `profiles` row (and `tutor_profiles` for
a tutor) from signup metadata — was silently **dropped by the 5 Sep Sydney →
Mumbai region migration** and never reapplied: that migration was a
public-schema dump/restore, and an auth-schema trigger is not carried by a
public dump. The function survived (it is in `public`); the trigger binding did
not. From 5 Sep until this fix, **every** account-creating path was broken —
`/api/auth/register` (no profile row → no role → parent default + a
profile-less dashboard redirect loop), `lib/staff.ts` (`.update()` hit zero
rows), and `lib/import.ts` (`.update()` hit zero rows, then the `tutor_profiles`
FK failed). Migration 59:

- **Restores only the trigger binding, not the function.** The live
  `handle_new_user()` is NEWER than migration 14 (it also writes a
  `user_activity_log 'registered'` row); recreating migration 14's body would
  regress it. Verified before attaching that the live function does not error
  against the current schema — the migration-35-class trap.
- **Backfilled 11 real orphaned accounts** (all `raw_user_meta_data.role =
  'tutor'`) from their metadata: `profiles` + `tutor_profiles`. The one
  synthetic-email (mobile) account among them was reconstructed with
  `phone_gate_required = true`; the ten real-email accounts with
  `phone_gate_required = false`. **13 accounts were deliberately left** and
  reported to the owner: 5 `@example.com` tests, 5 typo/garbage addresses, 3
  with no role in metadata (no role invented).
- **ensureProfile stays** in the register route as belt-and-braces — with the
  trigger back it is a harmless idempotent no-op (verified). **`lib/staff.ts`
  and `lib/import.ts` still rely on the trigger alone** and were NOT hardened in
  this PR (out of the "verify" scope); if the trigger is ever lost again they
  break silently again — recommended follow-up is to give them the same
  authoritative upsert the register route has.
- **The phone gate is one pure predicate now** (`lib/phoneGate.ts`
  `needsPhoneGate`), shared by `proxy.ts` and `/verify-phone` so they cannot
  disagree. An email-path account with no mobile (`phone_gate_required = false`)
  is never gated — it reaches its dashboard, and adding a mobile is a Settings
  action, not a gate. Unit-tested in `scripts/test-auth-trust.ts`.

**A public-only dump does not carry auth-schema triggers.** Any future region
move or restore must re-verify `on_auth_user_created` exists on `auth.users`
afterwards, because nothing in a public dump will recreate it.

## Verification comes before the dashboard (owner, 9 Sep 2026)

Later-dated than every block above, so under precedence rule 10 this wins over
anything it touches. Two rules, and a sweep.

**1. A member is never signed into a USABLE session before their identifier is
verified.** No landing on a dashboard first and verifying later.

- **Verification follows the identifier they chose.** Registered with an email →
  they verify the email (a confirmation link). Registered with a mobile → they
  verify the mobile (an OTP). They are never asked to verify a channel they did
  not give, and never gated on one they do not have. Adding the second channel
  later is a **Settings** action, never a gate.
- **The email path creates no session** until the link is clicked — the account
  is unconfirmed, and `/verify-email` is the landing (with Resend). **The mobile
  path signs in but the session reaches only `/verify-phone`** (the proxy phone
  gate holds it there); that is the verification screen, not a usable session,
  and it is where the OTP is entered. Neither leaves anyone signed in with no
  reachable page.
- **Logging in before verification is refused with a PLAIN message naming what
  is outstanding, never a generic failure.** Email: an unconfirmed sign-in
  returns *"Please confirm your email address to sign in"* with a Resend button
  on the login screen. Mobile: an unverified sign-in routes straight to
  `/verify-phone` (no dashboard bounce), which states what is needed and has
  Resend — the session is required there to send/enter the code, so it is held
  at verification rather than refused on the login form. The email-unconfirmed
  message is the ONE non-generic login answer, and it is safe: Supabase only
  returns "not confirmed" when the password is otherwise correct, so it is never
  a membership oracle for a stranger guessing.
- **After registering, the member lands on the screen that completes
  verification, with a clear next action.**

**2. No silent transitions.** Every step in the signup/verification chain states
itself: account created, verification sent and to which address or number, what
to do now, and an EXPLICIT confirmation when verification succeeds. Nobody is
moved between states without being told. As swept and wired:

- **Register → verify screen:** `/verify-email` and `/verify-phone` both open by
  acknowledging the account exists and naming the exact address/number the
  code/link went to, and the one action to take.
- **Verification success is confirmed on screen.** Mobile: `VerifyPhoneForm`
  toasts *"Number verified."* before routing. Email: the confirmation link's
  callback lands on the dashboard with `?verified=email`, and a one-time toast
  (`components/VerifiedToast.tsx`, mounted once under the root `ToastProvider`)
  says *"Your email is confirmed."* — the previously silent step.
- **Login refusals name the outstanding step** (rule 1), never "could not sign
  you in".

**Belt and braces on every auth-user-creating path.** `lib/ensureProfile.ts` is
the one authoritative profile upsert, used by `/api/auth/register`,
`lib/staff.ts` (invites) and `lib/import.ts` (bulk import). Every one of them
previously relied on the trigger's row existing and would break silently if it
were lost again (staff/import ran that way, undetected, from 5 Sep). The upsert
supplies every NOT-NULL-without-default column, so it creates the row whether or
not the trigger fired. Migration 60 backfilled two more owner-confirmed real
tutors (`javeriafiaz76@`, `gullfatima5868@`) left over from the 59 backfill.

## Admin actions tell the member (owner, 9 Sep 2026)

Any admin decision that changes what a member can do MUST notify them, on the
channels they have, using the existing template library, audit log and member
timeline. Verifying a tutor and having them receive nothing is the bug this
closes. The sweep, and what it found:

- **Already told (in-app + email):** tutor video approve/hold
  (`/api/admin/tutors/moderate`), parent CNIC/address approve/reject
  (`/api/admin/parents/verify`), payment approve (`lib/payments/activate.ts`).
- **Already told (in-app):** suspend / unsuspend (`lib/moderation.ts`), payment
  reject.
- **Was SILENT, now fixed:**
  - **Plan grant** (`/api/admin/plans`) — a granted plan changes what a member
    can do and said nothing (this is what "verified a tutor, received nothing"
    was: granting the Verified plan). Now an in-app notification AND a warm
    `plan_granted` email: it congratulates, names what the plan unlocks, and —
    per the conversion rules — never promises tuitions or income and never
    mentions a price. `listed` decides whether a tutor's badge is already live or
    waits on 100%, so the copy is accurate either way.
  - **Plan revoke** — now notifies (worded as loss of visibility, nothing
    deleted).
  - **Report resolved** — the reporter got a timeline row but no notification;
    now they are notified their report was reviewed, WITHOUT disclosing the
    outcome (telling a reporter the other member was suspended turns moderation
    into a scoreboard).
  - **Ban** — a banned account has no session, so in-app is unreachable; the ban
    is communicated at the login attempt (the exact message) and now ALSO by a
    neutral `account_banned` email, the one channel a banned member can still
    reach.

Two new email templates: `plan_granted` (warm, no price) and `account_banned`
(neutral). Both are essential (ignore the opt-out).

## Tutor dashboard band order — status and completion first (owner, 9 Sep 2026)

**Refines "Tutor dashboard cleanup, as built (5 Sep 2026)", which put the
"Who looked at you" teaser literally first. Under precedence rule 10 this wins:
status and what-to-do-next now sit ABOVE the teaser.** The owner's reason: the
most important things — is my identity verified, what is still missing on my
profile — were below the fold, and completion was shown twice.

Order now, both widths: header card (name, badges, avatar, completion RING only)
→ **Identity status line** (Verified / Pending / Not submitted) → **completion
checklist** (the one completion surface: what is done, what is not, each
incomplete item a direct link, via `ProfileCompletionWidget`, shown only under
100%) → the 199 funnel (teaser, then the free-only position and matching-jobs
cards) → Needs you → CV → **Saved tuitions** → Activity → Your things.

**One completion surface, not two.** The header ring is a glance (no text
prompt — `IdentityBlock showCompletionLink={false}` on the tutor dashboard; the
parent header keeps its prompt, having no checklist card of its own). The
completion row was REMOVED from `tutorNeeds` — Needs you keeps only the other
blocks (a rejected video, a shortlist waiting, an expiring plan). The teaser is
still the primary upsell and still above every other funnel surface; it simply
sits below the member's own status, which is the thing they open the dashboard
to check.

## Tutors can save tuitions (owner, 9 Sep 2026)

The mirror of the parents' `shortlists`. `saved_jobs (user_id, job_id)`
(migration 62), RLS scoped to the owner exactly like shortlists. Saving is FREE
and needs no plan — it is per-account state, so it lives in the database and
follows the tutor across devices. Every job card carries a heart for a signed-in
tutor (`/api/saved-jobs`, optimistic); the tutor dashboard has a "Saved
tuitions" section (`SavedJobsSection`, open jobs only, newest-saved first) with
an empty state that points at the jobs board. Wired on the tutor jobs board and
`/browse/tuitions` (first window + load-more).

## Admin can post a job — DECISION, implementation blocked on the recipient (owner, 9 Sep 2026)

Owner decision, recorded as instructed:

- An admin-posted job is a TRUSTED post: it carries the platform's own
  verification, not a CNIC-verified parent's, and is marked "Posted by
  TutorMint", visibly, so it is never mistaken for an unverified listing.
- It uses the same job form, taxonomy and fields as a parent post. No second job
  shape.
- It is audit-logged with the admin who created it and, where known, its source.
- Applications, messaging and hiring against it must work.

**Implementation is BLOCKED on the recipient question, and per the owner's own
instruction ("if that flow has a gap, describe it and stop rather than inventing
a recipient") it was NOT built in this PR.** The gap, precisely:

`jobs.parent_id` is **NOT NULL** and a foreign key to `auth.users`, and the
entire application machinery is built around it — `applyToJob()` notifies
`job.parent_id` and makes them the thread participant, `setApplicationStatus()`
requires `job.parent_id === the caller`, and hire is server-gated to
`parent_featured`. So an admin-posted job is FORCED to name a real account as
its parent, and there is no clean one:

- **The posting admin** is a real account, but an `admin` role cannot open the
  parent dashboard (it is role-gated), cannot hire (not `parent_featured`), and
  has no member-thread inbox (the admin Team inbox is a separate store,
  deliberately, to keep the "no chat-browsing screen" line true). So a tutor's
  application/message would reach an account with no UI to work it.
- **A dedicated "TutorMint" parent account** would make everything work through
  the normal parent flows — but creating one is exactly "inventing a recipient",
  which the owner said to flag rather than do unilaterally.

So this needs an owner decision on the recipient model before it is built. The
recommendation is a **real, team-operated parent account** (a genuine signup,
granted `parent_featured`), which every existing flow already supports — but that
is the owner's call to make, not mine to invent.

## Admin can post a job — recipient decided, BUILT (owner, 9 Sep 2026)

**Supersedes the blocked decision immediately above.** Under precedence rule 10
this wins: the owner chose the recommended recipient model, so the feature is
built on it. The decision, as instructed:

- **Admin-posted jobs belong to a real, team-operated parent account, granted
  `parent_featured`.** It is a genuine signup on a mobile number or email the team
  controls — NOT a synthetic row — so applications, threads, shortlisting and
  hiring all work through the ordinary parent flows with no special-casing
  anywhere. `jobs.parent_id` points at this real `auth.users` id like any other
  job; nothing in `applyToJob` / `setApplicationStatus` / hire had to change.
- **The job is marked "Posted by TutorMint"** wherever a job is displayed — card,
  detail page, public tuition page. A tutor can always tell it is a team-posted
  tuition, and it carries the platform's own vetting rather than a CNIC-verified
  parent's. The marker is derived from the job's parent being the team account,
  not a new column on `jobs` (no second job shape).
- **Same job form, taxonomy and fields** as a parent post. No second job shape,
  no second table — the admin form calls the same `createJob` path.
- **Every admin-posted job is audit-logged** with the admin who created it and,
  where known, its origin (support, referral, external) via `admin_audit_log`.
- **The team account's own public parent card shows the TutorMint identity**,
  never a person's name.

**How the team account is created — READ THIS, owner action required.**
See the "As built" section for exactly how the account is provisioned and what
the owner must supply (a real mobile or email the team controls).

### As built (admin job posting, 9 Sep 2026)

Migration 63 (additive): one column, `profiles.is_team_account boolean not null
default false`. NO new column on `jobs` and no second table — "Posted by
TutorMint" is derived from the job's parent being the team account. Every profile
stays `false` until the provisioning script sets exactly one `true`.

- **The mechanism is fully built; the account is provisioned by an owner-run
  script.** `scripts/provision-team-parent.ts` (`npm run provision:team`) creates
  the real parent account from an identifier the OWNER supplies — `--email=<addr>`
  (an inbox the team controls; created with `email_confirm`, so no mail is sent
  and the printed temp password / a later reset is the way in) or `--mobile=<pk>`
  (a synthetic `<msisdn>@users.tutormint.org` login, phone gate off). It NEVER
  invents an identifier: with no `--email`/`--mobile` it refuses. It marks the
  account `is_team_account=true`, `full_name='TutorMint'`, CNIC+address verified
  and `profile_completion=100` (so it may post and hire and its jobs carry the
  Featured tag), and grants an active `parent_featured` subscription
  (`source='admin_grant'`, far-future expiry). It refuses if that email/mobile
  already has an account or if a team account already exists (exactly one).
  Production writes go through `guardWrites` (backup first).

  **PROVISIONED (owner, 9 Sep 2026):** the team account is live as
  `jobs@tutormint.org` (a real Hostinger mailbox on the domain, owner-supplied),
  `is_team_account=true`, `parent_featured` active — user id
  `03db2d7c-158f-4794-8e2a-e7b421792cc3`. Confirmed end to end: the public
  `/parent/[id]` card and every job card / detail page render "TutorMint" with no
  person name and the parent badges dropped, and a job posted by it resolves
  `posted_by_team=true` (the "Posted by TutorMint" pill). The team operates
  applications by signing into that mailbox's account (a temp password was set at
  provisioning; a password reset to the inbox also works). To re-provision on a
  fresh DB or move the identifier, run
  `ALLOW_SEED_ON_PRODUCTION=1 npx tsx scripts/provision-team-parent.ts --email=<addr> --apply --confirm=yhekiqtelsictqkfxrfj`
  (or `--mobile=`). When not provisioned, `/admin/jobs/new` shows a plain "team account not
  set up yet" panel and posting is disabled — pointed at no invented recipient.

- **Posting reuses the one job shape.** `createTeamJob(input, actor, origin)` in
  `lib/jobs.ts` posts for the team account through the **service-role client**
  (the RLS insert CHECK is `parent_id = auth.uid()`, and the caller is the admin,
  not the team account — this is the ONLY thing that differs from a parent post).
  It writes the same `jobs` row shape, the same `job_subjects`, stamps
  `is_featured` from the team account's own entitlements, and skips the parent
  verification/quota gates (a team post carries the platform's own vetting and is
  not rate-limited against a member's monthly cap). Everything downstream —
  `applyToJob`, `setApplicationStatus`, hire — is UNCHANGED, because `parent_id`
  names a real `parent_featured` account.

- **The form is the same fields.** `/admin/jobs/new` (`AdminJobForm`, manager +
  support via `SCREEN_ACCESS.jobsPost`) uses the same `TaxonomySelector`, the same
  city/area/mode/budget-band fields and the SAME `/api/parent/jobs/generate`
  "Write this for me" call as the parent form, plus an ORIGIN select (support /
  referral / external) for the audit. It POSTs to `/api/admin/jobs/create`.

- **The trust marker is everywhere a job shows.** `lib/jobFeed.ts`'s `decorate`
  sets `posted_by_team` (and shows the name as "TutorMint", drops the parent
  badges) for every reader — browse, the tutor board, matching, saved, the public
  tuition page — so a "Posted by TutorMint" navy pill renders on the card
  (`JobCard`) and the detail page, the hire line reads as a team tuition, the
  JobPosting JSON-LD says "Posted by the TutorMint team", and the team's own
  `/parent/[id]` card shows "Official TutorMint account", never a person's name.

- **Audit + timeline.** Every team post writes `admin_audit_log` (`job.post`,
  with the acting admin and the origin) and a `job_posted` timeline row on the
  team account flagged `adminPosted`.

## robots.txt and sitemap.xml, reconciled (owner, 9 Sep 2026)

**Refines "Index now, banner stays (owner, 8 Sep 2026)", which set the current
robots rules.** Under precedence rule 10 this refinement wins where it touches
the sitemap; the robots public-crawl rules from 8 Sep are unchanged.

The contradiction: the sitemap advertised `/register`, `/tutor/packages` and
`/parent/packages`, while `robots.txt` disallows `/register` (and `/register`
also carries its own `robots: index:false`). Submitting a URL you have blocked
is a Search Console error ("Submitted URL blocked by robots.txt") and wastes the
crawl. Resolved in ONE direction — **remove them from the sitemap** — and here is
the reasoning per page:

- **`/register`** — excluded from the sitemap; the robots `Disallow` and its
  page-level `index:false` stay. A signup page with no unique content is not an
  organic-search target. The owner sends traffic there by direct link and ads,
  not via Google, so it belongs in neither the sitemap nor the index. Removing
  the sitemap entry is what clears the contradiction; the block stays.
- **`/tutor/packages`, `/parent/packages`** — removed from the sitemap. They are
  price/conversion pages reached by a member's own click, not organic content,
  so they are not submitted. They stay **crawlable** (no robots block added —
  they are not sensitive), just not advertised.
- **`/login`, `/forgot-password`** — already absent from the sitemap; the robots
  `Disallow` on both is correct and unchanged.
- **Sweep result:** after the removal, NO path appears in both the sitemap and
  the robots `Disallow` list. `/register` was the only collision.

**And the reverse error — a listed page that then refuses to be indexed — was
LIVE and is fixed.** Every open tuition detail page and every tuition *landing*
page (`/tuitions/[city]/[slug]` and `/tuitions/[city]/[subject]`, one shared
route) carried a leftover `PREVIEW_MODE ? { robots: index:false }` block. Because
`NEXT_PUBLIC_PREVIEW_MODE` defaults on, **every tuition page in the sitemap was
noindex in production** — the exact "listed but refuses indexing" error, in the
other direction, and inconsistent with the tutor landing pages (which never had
the block). The blocks are removed; a closed/missing tuition keeps its own 404
noindex and an under-review job stays visible with a sticker (it is not
delisted), so nothing indexable is suppressed. Stale "site-wide noindex" comments
in the tutor-landing page, the blog index, and the false "preview is ON — every
page is noindex" message on `/admin/seo/landing` were corrected in the same pass.

**Everything the sitemap lists is now genuinely indexable**, confirmed surface by
surface: tutor profiles come from `listed_tutor_slugs()` → `tutor_directory`
(excludes under-review, suspended, incomplete and unclaimed imports) and the
profile page separately noindexes an under-review tutor; open tuitions and tutor
landing pages carry no noindex; blog URLs come from `publishedSlugs()`
(`status='published'` only, so no draft leaks). No page in the sitemap carries a
per-page noindex.

## Link previews, favicon, Your-things, honest OTP result, abandoned-signup outreach (9 Sep 2026)

Migration 64 (additive — three template rows; backup taken first, applied live).

**Link previews (Open Graph / Twitter).** Next does NOT deep-merge `openGraph` /
`twitter`: a route that set `openGraph` without `images` shipped a bare link
preview, which is why WhatsApp showed no image on several pages. `lib/seo.ts`
gained `socialMeta()` (and `ogImages()`) — a COMPLETE OG + large-image Twitter
block, absolute URLs, image always present. Wired into the homepage, tutor
profiles, public tuition pages (both the job and the landing branch), the
tutors/tuitions city×subject landing pages, and the blog index. Blog posts were
already complete (cover or branded default) and were left. Pages with their own
imagery use it (blog cover; a tutor's avatar); pages without fall back to the
branded 1200×630 default (`/tutormint-logo1200x630.png`). **Privacy:** the tutor
card is neutralised (no name, no photo, branded default) for an under-review OR
unclaimed-import tutor (`tutorMetaFlags`); tuition cards carry only the job
title/place/public description — never the posting parent's account name; parent
pages are unaffected (no name in OG). Correct WhatsApp/Facebook dimensions
(1200×630 on the default; a provided image's size is left for the scraper).

**Favicon.** The served `app/favicon.ico` was the Next scaffold default (from
"Initial commit from Create Next App") — never replaced, which is why no
TutorMint icon rendered; the 167 KB root `favicon.ico` sat in a directory Next
never serves (root is not `app/` or `public/`) and was removed. Regenerated from
`public/tutormint-logo-1080x1080.png` (via sharp; the throwaway generator was
deleted): a real `app/favicon.ico` (16/32/48, RGBA — Turbopack's ICO decoder
requires RGBA), `app/icon.png` (512), `app/apple-icon.png` (180), and
`public/icons/icon-192.png` + `icon-512.png` referenced by a new `app/manifest.ts`
(theme navy, background the page-ground). The build serves `/icon.png`,
`/apple-icon.png`, `/manifest.webmanifest` and `/favicon.ico`.

**"Your things" redesign + the "Unlimited" fix.** `components/dashboard/YourThings.tsx`
(shared by both dashboards, so they cannot drift) is now a stat-tile grid: a
larger icon in a tinted chip, the number as the loud element (`text-3xl`
proportional), its label quiet beneath — real card separation, 2/3-column grid.
The plan tile showed "Featured plan — 99 applies left"; the platform sells that
cap as **"Unlimited"**, which is correct (`plans.displayed_quota` + CLAUDE.md).
`isUnlimitedDisplay()` in `lib/entitlements.ts` is the one predicate both
dashboards and the tutor jobs-page header ("… of Unlimited applications left" →
"Unlimited applications") read, so a plan advertising Unlimited says Unlimited
and never surfaces the real 100-cap countdown.

**Honest OTP result + logging.** `lib/otp.ts` `SendResult` now carries an explicit
`channel: 'provider' | 'bridge' | 'dev-bypass'` on success, so the bridge
do-nothing path (BRIDGE_OTP active, no provider) can never masquerade as a
delivered code — the bug behind a signup that produced a code row, no WhatsApp,
and no error. Every outcome is now logged (`[otp] send … channel=… provider=…
ok=…`) at info/warn — the path had NO logging at all before, which is why the
last diagnosis could not say what the provider returned. `provider=none` is the
"no provider and no bridge" case. NEVER a full number (masked via `maskMsisdn`,
tested) or the code. Consumers unchanged (the response JSON still carries
`codeSent`/`devBypassActive`).

**Abandoned-signup outreach.** `/admin/signups` (manager + support,
`SCREEN_ACCESS.signups`) lists accounts stuck at one of three stages — an email
signup that never confirmed (`auth.users.email_confirmed_at` null, via the Auth
admin API), a mobile signup that never verified (`phone_gate_required && !phone_verified_at`),
and a verified account under 100% completion — with the stage, role, channel,
signup date and a masked contact (`lib/abandonedSignups.ts`; fixtures, banned,
suspended and the team account excluded). From it an admin messages them on the
channel they GAVE — email (in-app + email) for an email signup, WhatsApp for a
mobile one, never the other way — through the existing `sendAdminMessage`
(template-driven, editable before send, audit-logged, on the member timeline).
`sendAdminMessage` now also refuses to email a SYNTHETIC address (belt-and-braces
so a mobile account is never emailed at `<msisdn>@users.tutormint.org`). Three
templates seeded (migration 64), no price on any of them.

**Report — shared contact mobile numbers (read-only, not changed).** Across 45
profiles, 21 carry a contact number (24 have none), all 21 normalise to distinct
MSISDNs: **0 accounts currently share a contact mobile number.** So enforcing
uniqueness today would break nothing and needs no data cleanup. The open design
question (not implemented): the signup duplicate-check already blocks a second
account CREATED from a mobile, but `whatsapp`/`phone_number` are free-text and a
member can enter any number, so uniqueness would need to (a) choose which
column(s) it covers, (b) normalise through `lib/phone.ts` before comparing (the
same number lives in three shapes), and (c) decide the legitimate-sharing cases
— a parent and their tutor spouse, a family landline as WhatsApp — that a hard
unique constraint would wrongly reject. Recommendation left with the owner: a
soft check (warn/flag on collision) over a hard DB constraint, since there is no
existing violation to force the issue and a constraint would reject real families.

## Admin-posted tuitions can carry a real parent's contact (owner, 9 Sep 2026)

Owner decision, recorded before implementing. To fill the marketplace before there
is supply on both sides, the owner posts real tuitions gathered through support
and outreach, and tutors contact those parents directly rather than applying.

- An admin-posted tuition can carry the REAL parent's name and contact number.
  The admin enters them on `/admin/jobs/new`; they are stored **with the job, not
  on a profile** — these people have no account. (As built: a dedicated 1:1
  `job_contacts` table keyed by `job_id`, NOT columns on the anon-readable `jobs`
  row — see the reasoning in the As-built section: it is the only way to guarantee
  the number can never leak through the public jobs feed.)
- Where contact details are present, the job page shows them **openly to any
  signed-in tutor** — no plan gate, no application flow required. Deliberate for
  launch, to get real tuitions moving; it will tighten later.
- The job still carries "Posted by TutorMint" and the team account remains the
  owner, so applications and messaging keep working for tutors who prefer them.
- Contact details are **never** shown to another parent, **never** indexed,
  **never** in structured data, an OG image, or a sitemap entry. (Enforced by
  construction: the contact lives in a locked, admin-read-only table read only via
  the service role, and is rendered only for a signed-in tutor — an anonymous
  crawler's render omits it entirely.)
- Every such post is audit-logged with the admin who created it and the origin
  already on the form.
- After posting, the admin can send that parent a WhatsApp message with a link to
  their tuition, inviting them to register to post their own next time — template-
  driven, audit-logged, timelined. The message promises no tutor, no outcome, no
  timeframe, and mentions no price.

### As built — tinted Your-things tiles + seeded tuitions with parent contact (9 Sep 2026)

Migration 65 (additive: the `job_contacts` table + the `seeded_tuition_live`
template; backup taken first, applied live).

**Tinted Your-things tiles.** `components/dashboard/YourThings.tsx` gives each
tile one of five light tints — navy, deep green, red, gold, mint — so the grid
reads as distinct at a glance instead of one grey block. Restrained by
construction: the CARD is a pale tint, the icon chip is a plain white disc, and
only the number and icon carry the family ink; the label is gray-700 over the
tint. The tone is deterministic per concept (keyed on the icon, so both
dashboards match and adjacent tiles differ); a highlighted tile always goes red.
The fifth tint needed a new token — `--color-tm-tint-mint` (#D5F5E3) in
globals.css, mirrored in `lib/brand.ts` — because the palette had only four
tints; the mint tone uses navy ink (its tint is the most saturated). Eleven new
pairs in `scripts/contrast-check.ts` (five ink-on-tint values, five gray-700
labels, the white note pill), all AA/AAA — check:contrast is 100 pairs.

**Seeded tuitions can carry a real parent's contact.** An admin posting on
`/admin/jobs/new` may add the real parent's name and mobile (optional). Stored in
the locked `job_contacts` table (see Canonical tables for WHY not on `jobs`),
normalised through `lib/phone.ts` so the links are clean; a number that will not
normalise is rejected rather than stored. `createTeamJob` writes it via the
service role and records `hasContact` on the `job.post` audit row.

- **Kept out of all public metadata, by construction.** The contact never
  touches the anon-readable jobs feed — it lives in a service-role-only table and
  is read only via `lib/jobContact.ts` (`loadJobContact`). On the public tuition
  page it is rendered ONLY in the signed-in-tutor branch, so a guest, a parent
  and a crawler never receive it: it is absent from the HTML they get, and it is
  never in `generateMetadata`, the JobPosting JSON-LD, the OG image or the
  sitemap (none of which read it). Shown openly to any signed-in tutor with a
  Call (tel:) and WhatsApp (wa.me) button and no plan gate; Apply still works
  through the team account for tutors who prefer it.
- **Notify the parent (item 3).** `/admin/jobs/[id]` shows the seeded contact to
  admins with a "Message parent (WhatsApp)" button → `POST /api/admin/jobs/[id]/notify`
  → `messageSeededParent` builds a wa.me link from the `seeded_tuition_live`
  template (filling `{name}` and `{tuition_url}`), audit-logs `job.contact_message`
  and timelines `seeded_contact_messaged` on the team account (the only member in
  the loop — the seeded parent has no account), and returns the link for the
  admin to send. The message promises no tutor, no outcome, no timeframe, and no
  price.

**What a tutor sees, seeded vs ordinary (item 4).** The posting form now records
who the tuition belongs to via `contact_name`, so a seeded job is no longer
anonymous under the team account. Side by side:

| | Ordinary parent-posted job | Seeded (admin-posted) job |
|---|---|---|
| Poster shown | the parent's first name + avatar + their plan badges, linking to `/parent/[id]` | **"Posted by TutorMint"** navy pill + shield; the "Posted by" card reads "TutorMint", no person's name and no badges |
| Contact number | hidden — a Featured-plan power; a free/Verified parent's number is never on the page | **shown openly** to any signed-in tutor: the real parent's name + a Call and WhatsApp button, no plan gate |
| To engage | Apply (quota-checked) or message in-app; hiring needs a Featured parent | contact the parent directly, OR Apply through the team account — both work |
| The real parent's name | is the account name | is on `job_contacts` (tutor-visible on the page, admin-visible on `/admin/jobs/[id]`), never in the public "Posted by" card, metadata or sitemap |

## Staff invite set-password flow — fixed (9 Sep 2026)

The first real staff invite (a manager) arrived, but the link dropped the person
on `/login` with no way to set a password. No migration.

**Root cause.** `lib/staff.ts` used `inviteUserByEmail(email, { redirectTo:
'/login' })`. That did two wrong things: it sent **Supabase's default** invite
email, and its link consumed the one-time token and redirected to a **bare
`/login` form** — there was no set-password step wired into the redirect, and
neither `/api/auth/callback` nor `proxy.ts` inserted one. The only thing that
ever forced the password change was `must_change_password` being caught by the
login POST handler, which only fires if the person types credentials — which a
freshly invited member does not have.

**The fix — the flow now matches the promise:**
- `createStaff` uses `admin.auth.admin.generateLink({ type: 'invite' })` (creates
  the user, sends NO email) and sends TutorMint's OWN email (`staff_invite`
  template, house style, essential) with a link to
  `/api/auth/callback?token_hash=…&type=invite&next=/account/password?next=/admin`.
- `/api/auth/callback` gained a `token_hash` + `type` branch that verifies with
  `supabase.auth.verifyOtp(...)` instead of `exchangeCodeForSession`. This is
  required for an ADMIN-ISSUED link: it is generated server-side, so the
  recipient's browser holds no PKCE code_verifier and the code exchange cannot
  work; verifyOtp verifies the hashed token directly and sets the session. The
  `code` path (browser-initiated email signup + self-service reset) is unchanged.
- The link therefore lands the invitee, signed in, on `/account/password` (whose
  copy is now staff-aware — "Welcome to the TutorMint team … set a password to
  finish setting up your <role> account"), they choose a password, and go
  straight to `/admin` with their role. A toast confirms; no silent transition.
- `welcomed_at` is stamped at staff creation so the confirm callback does not
  also send the member "welcome" email to an admin.

**Resend (item 4).** `/admin/team` has a Resend invite button per pending/expired
staff → `resendStaffInvite` mints a FRESH one-time link via `generateLink({ type:
'recovery' })` (the account exists) and re-sends the house email. Audit action
`staff.invite_resend`.

**Invite state on /admin/team (item 5).** Replaces the single "not signed in yet"
badge with three states derived from `must_change_password` + `auth.users.
last_sign_in_at`: **accepted** (password set, flag cleared), **invited** (sent,
never opened, link still within its 24h life), **invite expired** (needs
reissuing — either the link's life passed OR it was clicked and consumed but
never completed, i.e. signed-in yet must-change still true). This is what tells
an unopened invite apart from a broken one.

**Email (item 6).** The invite is now the app's own `staff_invite` template
(TutorMint wordmark, house chrome), not the Supabase default, and it says what to
expect before the click (one-time link → choose a password → admin panel).

**If the email can't be sent** (no Resend), `createStaff`/`resendStaffInvite`
return the one-time invite LINK to the owner to pass on — replacing the old
temp-password fallback with something that still lands on the set-password
screen. The temp-password path remains only if link generation itself is
unavailable.

**Rai Mohsin Raza (item 7).** His account exists: `role=admin`,
`admin_role=manager`, `must_change_password=true`, and `auth.users` shows both
`email_confirmed_at` and `last_sign_in_at` set — his invite link was **already
clicked and its single-use token consumed**, but he never reached a set-password
screen (the old `/login` redirect). So his ORIGINAL link is dead; the code fix
cannot revive a spent token. He now shows as **"invite expired"** on
`/admin/team`, and the owner clicks **Resend invite** — that mints a fresh
recovery link, emails it in the house template, and on click takes him to the
set-password screen and then `/admin` as manager. The account was NOT deleted.

This supersedes the T7a note that `inviteUserByEmail` is tried first with a
`/login` redirect and a temp-password fallback.

## Preview banner removed — the site presents as live (9 Sep 2026)

**Supersedes "Preview mode — comes OFF before launch (3 Sep 2026)" and the
preview clause of the T9.1 landing note.** Indexing was already decoupled from
the flag ("Index now, banner stays", 8 Sep); this removes the "launching soon"
banner and the flag entirely. No migration.

- `components/PreviewBanner.tsx` and `lib/preview.ts` are **deleted**; the
  `<PreviewBanner/>` render and import are gone from `components/SiteChrome.tsx`.
  Nothing on the public site tells visitors it is in preview — it presents as live.
- **Swept for other preview keys, not just the banner** (the earlier tuition
  noindex bug came from a stale `PREVIEW_MODE` branch). The ONLY other
  behavioural use was `lib/blogPublish.ts` `notifySearchEngines()`, gated
  `if (PREVIEW_MODE || …) return` — it skipped the IndexNow ping "while noindex".
  The site is indexed now, so the `PREVIEW_MODE` condition is removed (the ping
  fires; still IndexNow-only, still `INDEXNOW_KEY`-gated, still best-effort). No
  other code keyed off preview: `app/layout.tsx`, `app/robots.ts`, `app/sitemap.ts`
  and `lib/seo.ts` were already decoupled and read it nowhere.
- `NEXT_PUBLIC_PREVIEW_MODE` is no longer read anywhere; removed from
  `.env.example`. The owner can unset it in Vercel. The `robots.ts` header comment
  was updated (it referenced the deleted files).

**Video upload return-shape bug fixed (with YOUTUBE_* now set).** With all four
`YOUTUBE_*` set in Vercel the 503 (`missingEnv`) branch no longer fires — but the
route then read `result.id ?? result.data?.id` while `uploadVideoToDrafts`
returns `{ success, videoId }`, so `videoId` was always `null` and EVERY
successful upload fell through to a 502 "YouTube did not return a video id",
recording nothing. The route now reads `result.success` / `result.videoId` and
surfaces the provider's real error on failure. The refresh-token→access-token
exchange happens in `googleapis` at runtime (implicit on the first API call) and
can only be confirmed by a real upload on the live site; the config resolution
and the shape fix are code-verified.

## New brand favicon (9 Sep 2026)

The icon set was regenerated from `assets/favicon-source.png` — the two-figure TM
monogram in the brand palette, no wordmark — replacing the set previously derived
from the square logo. Same five paths: `app/favicon.ico` (16/32/48, RGBA — the
ICO decoder rejects RGB), `app/icon.png` (512), `app/apple-icon.png` (180), and
`public/icons/icon-192.png` + `icon-512.png` behind the existing `app/manifest.ts`.

Two source properties drove the generation, both checked against a magnified
render before shipping: the source has a **transparent background and a dark
mark** (mean luminance ~72/255), so a transparent icon's core (the navy "TM")
disappears on a dark browser tab / iOS — every size is therefore flattened onto
**solid white**, visible on light and dark chrome alike. And the monogram is
already **edge-to-edge** (~1% margin), so a tighter crop for the 16px entry buys
nothing; `contain` fills the square without clipping and the mark stays legible
at 16px. The throwaway generator was deleted, as before.

## Invented ratings removed, square dashboard cards (9 Sep 2026)

With the preview banner gone and the site indexed, the seed directory's
fabricated figures became a live breach of the "no invented facts, no made-up
statistics or reviews" guardrail. Migration 66 (data repair, no schema change,
idempotent, backup taken first, applied live) recomputes `rating_avg` /
`rating_count` for every `tutor_profiles` row from the actual `reviews` table —
the same computation `recompute_tutor_rating()` does per-review, applied in
bulk. So a rating survives ONLY where real review rows exist: 4 of the 6 listed
tutors (ali, hina, nadia, bilal) fell to 0/0 ("New tutor" / "No reviews yet",
which the card, profile and JSON-LD already render honestly), and the two with
real rows are untouched (usman 4.50/2, sara 5.00/1). It is computed, not an
email list, so it cannot touch a genuinely-rated tutor and self-corrects any
future drift. **The 3 surviving review rows are themselves seed-authored** (seed
parents, seeded comments) and shown on usman/sara profiles — reported to the
owner, not purged, since the owner named them the real baseline and keeps seed
accounts listed.

`hiresThisMonth()` (packages-page social proof) now excludes fixture and
team-account hirers (`seed+`/`@tutormint.dev`/`dummy.`/`test.`/`is_team_account`):
every hire in the database today is seeded, so the "N tutors were hired this
month" line correctly shows nothing until a genuine member hires someone. The
caller already hid a zero. Swept the rest: no hardcoded social-proof numbers on
the marketing pages; `profile_views` is own-dashboard/admin only, never
stranger-visible; landing/browse counts are truthful counts of listed rows.

**Bilal Ahmad (reported, not changed).** An imported+claimed, phone-verified,
`verified` mobile account listed at a STORED `profile_completion = 100` that the
checklist does not compute — `lib/profileChecklist.ts` requires a tagline
(headline) and an "About you" (bio), both blank on his row, so the 100% is a
forced/seeded value, not earned. Left listed (empty > fabricated, and it asserts
nothing untrue); the honest fixes — recompute completion (would delist until a
real headline+bio are added) or add genuine content (which only the owner or the
tutor can supply; inventing it is the fabrication we are removing) — await the
owner's word.

**Square dashboard cards.** Both dashboard bands now share one square
category-tile shape — `components/dashboard/StatTile.tsx`: a light white card, a
coloured icon centred in a soft tint chip at the top, a short centred label
beneath, the count under the chip (icon leads, number is quieter), roughly
square, two to a row at 360px and up to four on a laptop. `YourThings` renders
it directly; `ActivityCard` renders it per feed group (family colour, the event
sentence as the label, the time as the note, the unread dot preserved). One
shared component so the two dashboards cannot drift. Grouping is kept and still
lossless (the count is in the sentence); a grouped run links to the itemised
timeline (`/account/notifications`) rather than silently to its newest row, and
`ActivityBand`'s "See all" still reaches the full list — the one behaviour delta
is that a grouped run no longer expands inline. Every colour pair is already in
`scripts/contrast-check.ts` (tint chips + ink-on-white + gray on white).

## Honest ratings, prominent teaching mode, job-form polish (10 Sep 2026)

Follows "Invented ratings removed…" (9 Sep). Migration 67 (data repair, no
schema change, idempotent, backup taken first, applied live) finishes the job
and three UI passes accompany it.

**No rating until a real one arrives.** The 3 review rows migration 66 kept were
themselves seed-authored (seed parents, seeded comments on seed tutors) and,
banner gone, the only ratings on an indexed site. Migration 67 deletes them
(scoped to fixture reviewers), which fires `recompute_tutor_rating()` per row, so
usman and sara fall to 0/0 automatically. **Verified: every one of the 31
`tutor_profiles` is now 0/0** — no tutor shows a rating anywhere until a real
parent leaves one. The card ("New tutor"), profile ("No reviews yet") and JSON-LD
(no `aggregateRating`) already render that honestly.

**Bilal Ahmad recomputed and delisted.** His stored `profile_completion = 100`
was never earned: the real checklist (`lib/profileChecklist`, 15 items, floored)
scores him 9/15 = **60%** — missing photo, headline, bio, degrees+certificate,
CNIC and video (six items, not the two first thought). Migration 67 sets 60,
scoped to his id, so he leaves `tutor_directory` (100%-only) until he genuinely
completes it. No content invented; a later profile edit re-runs
`recomputeCompletion()` and keeps it honest. Seeded `experience_years`/
`hourly_rate` were LEFT (self-declared attributes, not platform statistics —
owner-confirmed).

**Teaching mode is now prominent and consistent.** It was buried: on the card
only the Area line's fallback (invisible whenever a tutor had an area), on the
profile a "· In person or online" tail on the city line. `components/
TeachingModeChip.tsx` is one chip (icon + `teachingMode()` label — Users/Wifi/
MonitorSmartphone for in_person/online/both) used on both the card (its own
element, always shown when set) and the profile (below the rating). Browse and
search already filtered mode through the same `teachingMode()` vocabulary, so
one wording holds everywhere. `bg-tm-tint-navy`/`text-tm-navy`, an existing pair.

**Job form polish, shared so the two forms cannot drift.** `components/forms/
WhereHowWhen.tsx` is the six-select "Where, how and when" row (city, area, mode,
budget, days, times), used by BOTH the parent post-a-tuition form and the admin
team-post form. Each select carries a recognising left icon (Building2, MapPin,
MonitorSmartphone, Wallet, Calendar, Clock) beside its own text — never
icon-only — and a short placeholder that is the field's noun ("City" not "Choose
a city", "Budget"/"Days"/"Time"); the sr-only label keeps it named for a screen
reader. One component, one set of icons and placeholders for both forms.

**Level and Grade collapse once chosen.** `components/TaxonomySelector.tsx`'s two
`size={4}` listboxes now collapse to the chosen value with a **Change** button
(and a **Done** to close without changing); picking a value auto-collapses.
Default is collapsed (a level and grade auto-pick on mount), so "What is needed
taught?" opens compact instead of two four-row listboxes — the win is largest at
360px. Selecting a new level resets and re-collapses the grade beneath it.

## Job Type replaces teaching mode (owner, 10 Sep 2026) — DECISION

Supersedes "teaching_mode is one spelling" and "Enum values never render raw"
wherever they describe the three values. The concept is renamed and its domain
changed; under precedence rule 10 this wins.

- **The field is "Job Type"** everywhere a person reads it, with exactly three
  mutually-exclusive options: **Home Tuition**, **Online Tuition**, **School
  Job**. There is no "both" — that value is retired.
- Applies identically on all three sides: a TUTOR's Job Type is the single kind
  of work they want (home, online, or a school post); a JOB's Job Type is the
  single kind of engagement (a family wanting a home tutor, an online tutor, or
  a school hiring a teacher). A tutor set to School Job is signalling they want
  school posts, and matching uses that signal — no separate opt-in flag.
- **Stored values become `home` / `online` / `school`.** Existing `both` maps to
  `home` (five seed tutors and some fixture jobs; no real member data). The
  legacy spellings still parse through the display/parse helpers.
- **The physical column stays named `teaching_mode`** on `tutor_profiles` and
  `jobs` — deliberately NOT renamed. Renaming it would touch the two public
  directory views (`tutor_directory`, `tutor_visible_profiles`) and 30+ untyped
  `.select('teaching_mode')` strings that the type-checker cannot verify, so a
  missed reference would be a SILENT production break of the public directory.
  The column keeps its name; its VALUES and every human-facing label, code
  constant (`JOB_TYPES`), type (`JobType`), helper (`jobType()`), and component
  (`JobTypeChip`) are Job Type. A missed VALUE is caught loudly by the CHECK
  constraint; the naming is documented here so `teaching_mode='school'` is not a
  surprise. `demo_requests.mode` is a different concept (a demo's location) and
  is untouched.
- **A School Job is posted by an ordinary Parent / Institution account.** No
  third role, no separate entity, no institution-specific verification — same
  CNIC + address verification, same posting flow, same rights as any parent.
- **Matching is Job-Type-aligned.** A job matches a tutor only when their Job
  Types are equal; `online` is city-agnostic, `home` and `school` are
  location-bound (same city). The old cross-city "Suitable for online" chip
  survives for an online job in a different city from an online tutor.
- **Structured data unchanged (reported, not extended).** `JobPosting` already
  emits `employmentType: 'CONTRACTOR'` and `hiringOrganization` = the platform
  for every open tuition; no fields were added for School Job in this PR (owner
  asked to report, not add). See the report for the per-type recommendation.

### As built (Job Type, 10 Sep 2026)

Migration 68 (backup taken first, applied live): `teaching_mode` values migrated
to home/online/school, CHECK swapped, `jobs` default → 'home'. Verified: 62 jobs
→ home, tutors 17 home / 1 online / 13 null; the two directory views still
resolve (they keep the column name). Gates: tsc 0 · build 0 · check:contrast 100
· rls 179/179 · all suites pass (test-cv/test-social updated for the new labels).

Surfaces touched (one vocabulary via `jobType()` / `JobTypeChip` / `JOB_TYPES`):
`lib/locations` (JOB_TYPES, JobType, parseMode; `canonicalMode` removed —
single-choice now), `lib/display` (`jobType()`; `demoMode` split out, since a
demo's location is a separate concept), `lib/matchChip` (Job-Type-aligned
matching; `matchVisibility(jobType, jobCity, tutorType, tutorCity)`,
`isOnlineType`), the new `components/JobTypeChip`, the tutor card and public
profile (prominent chip), `components/JobCard` (chip + `viewerJobType`), both
browse filters (Job Type / Any Job Type), the shared `WhereHowWhen` used by the
parent AND admin job forms (the select where "Mode" was, Briefcase icon, "Job
Type" label — item 3), tutor **settings** (a single-choice radio group, was
checkboxes) and **complete-profile** (Job Type select), `lib/jobs.ts`
(default→home, Job-Type-aligned notify fan-out), `lib/funnel.ts` `jobsThisWeek`
(+tutorType), `lib/social/copy` (chip), `lib/ai/jobBrief`, `lib/cv/model`
(display only; the internal field stays `teachingMode`), the admin tutor/job
detail and the parent/tuition public pages, the `viewerJobType` threading
through the browse and tutor-jobs lists, and the `/dev` showcase mocks.

**Item 2 — Level and Grade are custom selects.** `components/forms/Select.tsx`
is a keyboard-accessible custom listbox (button shows the value; a searchable
list opens beneath; Enter/Space/↓ open, ↑/↓ move, Enter chooses, Esc closes;
combobox/listbox roles) styled to match the "Where, how and when" fields
(border, height, left icon, chevron). `TaxonomySelector` uses it for Level
(Layers icon) and Grade (GraduationCap icon), replacing the `size={4}` listboxes
and the collapse panel — so the whole form is one set of controls.

**JobPosting structured data (reported, unchanged).** `jobPostingJsonLd` still
emits `employmentType: 'CONTRACTOR'` and `hiringOrganization` = the TutorMint
platform for every open tuition, regardless of Job Type; no fields were added.
See the report for the per-type recommendation (School Job is the one that would
most benefit from a real `hiringOrganization` and a different `employmentType`).

## Gated subjects, retired-tagline sweep (10 Sep 2026)

**Subjects appear only after Level and Grade are chosen.** `TaxonomySelector` no
longer auto-selects a level on mount or auto-picks a grade — the form opens with
both empty so the person actually chooses. Until both are set, the subjects grid
is hidden and one short dashed line stands where it would be ("Choose a level and
grade above, and the subjects will appear here"); no empty box, no dead space.
The old grade auto-pick existed only to paper over the `<select size={4}>`
listbox divergence, which is gone now that Level/Grade are custom Selects that
show a placeholder at empty. Applies to the parent job form, the admin job form
AND tutor complete-profile (all share the component). **Nothing depended on the
default:** the "Write this for me" brief is gated behind `hasSelection` (button
stays disabled until a real choice), matching reads the SAVED `job_subjects`, and
submit already throws a friendly "Choose a level, a grade and at least one
subject" on empty — so removing the auto-select only removed an unearned default.

**Retired "0% commission" removed.** The footer brand blurb read "…Verified
Tutors Network. 0% commission." (both the mobile and desktop bodies); it now
carries the current tagline "No fee. No commission. No middleman." — one
"commission" per rendered footer. Swept every surface: no other "0% commission"
variant survives.

**Other retired claims — checked.** "Exact Academic Matching": not present
anywhere. Retired hex: `lib/notify/templates.ts` (the email button + wordmark)
carried the retired `#d60008`/`#0F172A`; corrected to `#C20202`/`#151E6B`, and
`scripts/seed-dev.ts`'s placeholder-image colours (`#d60008`/`#0F172A`/`#059669`)
to `#C20202`/`#151E6B`/`#2E7D4F`. No retired hex remains in app/, components/,
lib/ or scripts/ (the only mention left is the documentation comment in
`app/globals.css` that lists them AS retired). The "TutorMint takes 0% of what
you earn" copy on /about, /tutor/packages and the FAQ is the intentional
academy-comparison prose (CLAUDE.md "conversion rules"), not the retired slogan,
and was left. The one place the slogan appears twice on a page is the homepage —
its locked, partner-approved hero already carries it and so does the footer; that
predates this pass and the hero is locked, so it was not touched.

## Selected-subject chips, homepage footer tagline (10 Sep 2026)

**Chips.** `TaxonomySelector` shows the ticked subjects as a `flex-wrap` row of
brand-red (`bg-tm-red`, white text — a registered contrast pair) chips directly
above the subjects grid, each with an × that removes it. The chip row and the
grid checkboxes both read and write the one `selectedSubjects` array, so they
stay in sync in both directions with no extra state; unticking a box drops its
chip and clicking a chip's × unticks the box. The row does not render at all when
nothing is selected (no empty container), and it wraps cleanly above the
`max-h-48` scrollable grid at 360px. Live in all three consumers — the parent job
form, the admin job form, and tutor complete-profile.

**Homepage footer tagline suppressed.** The footer's "…No fee. No commission. No
middleman." line is now a small client component, `components/FooterTagline`,
that renders on every page EXCEPT `/`. The locked homepage hero already carries
the slogan, so this keeps "commission" to once per page there while every other
page keeps the footer line. It reads `usePathname()` (a client hook) rather than
a header, because the (site) layout the Footer sits in is not re-rendered on a
client navigation and a header-based path read would go stale — the bug
SiteChrome documents.

## A tutor offers MULTIPLE Job Types (owner, 10 Sep 2026) — DECISION

Revises "Job Type replaces teaching mode" (10 Sep), where a tutor held a single
Job Type. Under precedence rule 10 this wins on the tutor side; the job side is
unchanged.

- **A tutor selects any combination** of Home Tuition, Online Tuition and School
  Job — one, two or all three (checkboxes, not a radio). At least one is required
  (the completion checklist's Job Type item now needs a non-empty set).
- **A job still keeps exactly one Job Type** — a family wants a home or an online
  tutor, a school posts a school job. That side did not change.
- **Matching is CONTAINMENT, not equality:** a job is shown to a tutor when the
  tutor's set includes the job's type. Geography is unchanged — online is
  city-agnostic, home and school are same-city.
- **Existing tutors kept what they had** as a single-item set; nothing was lost.

### As built (migration 69 — schema change, backup first, applied live)

**Storage: a new array column `tutor_profiles.job_types text[]`**, mirroring the
table's existing text[] columns (class_levels, degrees, online_platforms) — not
a join table, because the value set is a fixed three, every read is one row, and
containment is one `= any()`. `CHECK (job_types <@ {home,online,school})`.
`teaching_mode` is KEPT as the PRIMARY mirror (job_types[0]), written on save, so
the two public views and every untyped `.select('teaching_mode')` keep working
and only the multi-aware surfaces read the array.

**The real, careful part:** the array had to reach the two public directory views
and both SECURITY DEFINER functions, since the browse filter ranks in SQL. So the
migration recreates all four — `tutor_directory` / `tutor_visible_profiles` gain
a trailing `job_types` (create-or-replace, non-breaking for the dependent
`landing_combinations`); `rank_tutors` (drop+recreate — its RETURNS changed) now
filters by containment (`p_teaching_mode = any(job_types)`) and computes the
online location bonus from the array; `tutor_public_page` (drop+recreate) returns
`job_types`. EXECUTE was re-granted to anon/authenticated/service_role and
re-REVOKEd from PUBLIC to match the originals exactly. Verified after apply:
value distribution migrated 1:1, both views resolve, `rank_tutors('home')`
filters, `tutor_public_page` returns the array, grants identical, rls:audit
179/179.

**Every tutor-side surface reads the set:** the profile chip and the tutor card
use a new `components/JobTypesChip` (one type → the single labelled chip; two or
three → ONE chip reading "Home · Online · School", so all three read cleanly, not
as three cramped chips); browse cards/filter through `rank_tutors`+the view;
settings and complete-profile are multi-checkbox; the CV via `jobTypesLabel`; the
admin tutor detail; the completion checklist. Matching (`matchVisibility`,
`jobsThisWeek`, `notifyMatchingTutors`) takes the tutor's array and does
containment; `viewerJobTypes` is threaded through the browse and tutor-jobs
lists. `demo_requests.mode` is untouched (a demo's location, a separate concept).

## Subjects grid collapses when the person moves on (owner, 10 Sep 2026)

Once focus leaves the subjects section for the next field, the grid collapses to
its red-chip summary and a **Change** button reopens it — the same shape level
and grade have. **The trigger is focus LEAVING the selector, not a raw blur:**
`TaxonomySelector`'s root `onBlur` reads `relatedTarget` — null (a scrollbar
click or empty space) does nothing, an element inside the selector (tabbing
between its own controls) does nothing, and only an element OUTSIDE it (the city
field is the next focusable thing below the component) collapses it, and only
when there is a selection to summarise. Emptying the selection (changing the
grade, or removing the last chip) reopens the grid so it is never a dead end.

## Subjects-grid collapse trigger, fixed (owner, 10 Sep 2026)

The previous pass used the selector root's `onBlur` + `relatedTarget` to detect
"focus left the section", and reported it checked — but it does NOT work: mouse
users, and clicking a native `<select>` (the city field) does not reliably set
`relatedTarget` across browsers, so focus leaving by mouse never registered and
the grid stayed expanded. Corrected to the reliable shape the owner specified: a
DOCUMENT-level `pointerdown` listener that collapses when the press target is
outside the selector root (`lib/outsidePointer.ts`, `onOutsidePointerDown`),
attached only while at least one subject is chosen. A press inside the root — a
subject checkbox, the grid's own scrollbar, the Change button — is ignored via
`root.contains(target)`; selecting the first subject cannot collapse (there is
nothing to collapse to yet); emptying the selection or Change reopens it.

Level and Grade were CHECKED, not assumed: their custom `Select`
(`components/forms/Select.tsx`) already closes its popover on a document
`mousedown` + `contains` — the same reliable click-outside pattern, never
`relatedTarget` — so they did not share the flaw and were left.

**How this was verified, honestly.** This environment has no browser and no
jsdom, so I did NOT click City and watch the grid collapse. The document is
injected into `onOutsidePointerDown` so the mechanism is unit-tested in node
(`npm run test:outsidepointer`, 6 assertions): it subscribes to `pointerdown`
(not focus/blur), collapses on an outside target, ignores an inside target, a
null target and a missing root, and unsubscribes. That proves our code uses the
reliable pattern correctly; it cannot prove the browser dispatches pointerdown on
a real click — that is a browser guarantee, and the reason the pattern is chosen.

## Launch polish — masking shape test, packages noindex + auth gate, 308 stubs (10 Sep 2026)

Four small fixes. No migration.

**Masking is a SHAPE test, not a length test.** `lib/masking.ts`'s
`LONG_DIGIT_RUN` (10+ digits with the separator class) matched every hyphenated
fee range ("15000-20000"), space-separated price list ("2000 2500 3000") and run
of years ("2019 2020 2021") — the most common numbers in a parent-tutor thread —
so the reader saw a mask + upgrade chip that read as the other side smuggling a
number. Replaced with a CANDIDATE run whose WHOLE cleaned form (separators
stripped) must match a Pakistani mobile `^(?:00|\+)?(?:92)?0?3\d{9}$` or a CNIC
`^\d{13}$` (13 digits, grouped 5-7-1) to mask; anchored, so a range never
matches. The structural `PATTERNS` are kept unchanged — they still fire on a
mobile embedded in a longer sentence (a number wedged between two prices is
caught even though the whole run is not a phone number). `npm run test:masking`
(18 assertions) covers every shape in the owner's MASKED list and every NOT case.

**Both packages pages carry `robots: { index: false, follow: true }`.** The
sitemap already excluded `/tutor/packages` and `/parent/packages`, but
`Footer.tsx` links both sitewide and `/about` links them in prose, so a crawler
reaches them regardless — the exclusion alone was never the control. They stay
crawlable (no robots.txt block) and reachable by a member's click, just never
indexed. The sitemap comment now says so.

**Both packages pages redirect a signed-out visitor to `/login?next=<path>`.**
`getViewerEntitlements()` returns null for anon traffic and `VerifiedPreview`
fell back to "Your name", so a stranger saw a mock of their own tutor card. Both
paths are in `PHONE_GATED` in `proxy.ts`, but that block is guarded by `if (user
&& …)`, so anonymous traffic passed through — the page now checks the session
itself.

**The three legacy redirect stubs are permanent (308).** `/tutor/login`,
`/parent/login` and `/tutor/register` used `redirect()` (307); their own comments
call them permanent legacy paths still linked from the homepage and /faq, so they
now use `permanentRedirect()`.

## Profile completion no longer gates listing (owner, 10 Sep 2026) — SUPERSEDES the completion-lists rule

**The listing gate is now a PLAN, not 100% completion.** Under precedence rule 10
this beats every earlier statement that ties listing to `profile_completion = 100`
— the 31 Aug owner Q&A line "a tutor appears in /browse/tutors when
profile_completion = 100% (regardless of plan)", the "A badge means LISTED"
section's completion premise, `tutorListed()`, and the search-ranking
"eligibility filter". Migration 70.

**LISTED = an active paid tutor plan + mobile verified (`profiles.phone_verified_at`)
+ verification `'verified'` + not suspended/banned/under-review + claimed if
imported.** Completion is not in the predicate at all. A paid, verified tutor at
40% is listed, searchable, and can apply.

- **"CNIC verified" for a tutor is `tutor_profiles.verification_status = 'verified'`**,
  NOT `profiles.cnic_verified_at`. That column is a PARENT column and is null for
  every tutor (confirmed on the live DB); the tutor's CNIC is checked as part of
  the admin identity audit (video + CNIC + degree) that sets `verification_status`.
  Using the literal column would have listed zero tutors.
- **This is pay-to-be-listed.** A free or cancelled-plan tutor at 100% is no longer
  listed — confirmed effect on apply: the live directory went from the old 100%
  set to the three tutors holding an active paid plan (ali/sara/usman); the two
  seed tutors on cancelled plans (hina, nadia) dropped. The owner chose this
  explicitly over "verified lists, plan only gates apply/badge".
- **`tutor_directory`** (browse / search / `rank_tutors` / sitemap) and
  **`tutor_visible_profiles`** (may the URL render) carry the new rule; the latter
  still renders an under-review tutor (amber notice) and an unclaimed import (claim
  flow). `tutor_public_page` and `listed_tutor_slugs` inherit it. The TS mirror is
  `lib/planBadges.ts` `tutorListed()` / `tutorListablePrecondition()`, consumed by
  `computeEntitlements` (`ent.listed`) — SQL and TS share one rule.

**Completion becomes a RANKING signal and an INDEXING gate, nothing else.**
- **Ranking:** `rank_tutors` sorts `tier → completion → location → Bayesian rating
  → daily rotation`. Completion sits just below plan tier (complete profiles rank
  above incomplete at the same tier); the keyset cursor gained a matching
  `completion` component so load-more paging stays stable.
- **Indexing:** a listed tutor under 100% is `noindex` on their public profile and
  withheld from the sitemap (`listed_tutor_slugs` keeps the `>= 100` filter;
  `tutorProfileNoindex()` drives the page). At 100% both lift automatically — one
  threshold, no second field list. Fully listed and applying throughout; only
  Google is held back.

**The Verified badge is degree-gated for tutors (unchanged in meaning, newly
enforced).** A listed tutor without a reviewed degree on file (`tutor_profiles.degrees`
non-empty) shows their plan-tier badges but NOT Verified — `badgesForPlan(plan,
gate, hasReviewedDegree)`, threaded through the browse card (`rank_tutors` returns
`has_degree`), the public profile, the dashboard (`ent`), and the verified share
card. Premium/Featured are plan-tier and not degree-gated; parents are unaffected
(their Verified is CNIC + address). Secondary badge surfaces (the inbox, the hired
list, job-card parent badges) still gate on completion `>= 100`, which is
conservative — a 100% tutor has a degree, so no false Verified appears; they only
under-show badges for a sub-100% listed tutor.

**The blocking Apply modal is gone (owner rule 5).** `applyToJob` no longer blocks
on completion and `lib/gate.ts` no longer has the `tutor_complete_profile` gate or
the under-100% "Finish profile first / Buy anyway" override. Applying still
requires being listed: a no-plan tutor hits the quota gate → packages; a tutor who
HOLDS a plan but is not yet verified/mobile gets a plain "your profile is still
being verified" message (never an upgrade sheet). In its place the dashboard shows
quantified, non-blocking prompts (`lib/needsYou.ts`), each shown only when its
number is real: "N tuitions in <city> match nothing on your profile"
(`cityJobsMatchingNothing`, the dashboard job query minus the subject filter),
"Your profile is not on Google yet — it appears in search once it reaches 100%"
(listed tutors under 100% only), and "Add a degree to earn your Verified badge"
(paid tutors without one). The profile-view teaser (`ViewsCard`) already existed.

**Go-live rewired.** Because listing now requires an active plan, `activatePayment`
and `activatePausedIfListed` can no longer ask `tutor_directory` "are you listed?"
to decide when a paused, paid plan starts its clock — the plan being started is
what the directory waits on. They ask the PRECONDITION instead (`lib/payments/listable.ts`
`isTutorListable` = listing minus the plan). Admin plan grants still create an
active sub directly, so the owner's "grant a plan" tool lists a verified+mobile
tutor immediately. BRIDGE_OTP and plan entitlements were not touched.

**Copy sweep.** The blanket "Degree-Verified" claim about all tutors is retired
(a paid tutor may be listed without a reviewed degree): the homepage `<title>` and
hero, the WebSite JSON-LD description, and the tutor-page fallback description drop
"degree" and keep "verified"; `/about`'s "every tutor uploads … degree
certificates before the tutor is listed" is corrected to make the degree the
badge's requirement, not a listing gate. Badge-scoped and process claims (the
Verified-badge explainer, the verification process, an individual profile's own
reviewed degree) are still true and were left.

## Seed fixtures are noindexed, not delisted (owner, 10 Sep 2026)

The seed cast and the fixture tuitions render on-site but must stay OUT of Google:
an indexed fixture tutor competes with a real tutor for their own name, and an
indexed fixture tuition (which carries JobPosting structured data) can surface in
Google's jobs listings as a real vacancy. This is search-engine-only — nothing is
delisted, deleted, or banner-flagged. Migration 71.

- **Identity is a stored fact: `profiles.is_seed`** (migration 71), backfilled
  from the `@tutormint.dev` seed email domain — every account on it is a fixture
  and nothing else uses it (15 rows: 7 seed tutors + 8 seed parents). Chosen over
  a slug list (goes stale) and over reading the email at each call site (one
  indexed fact, four surfaces, admin-flippable for a future fixture on another
  domain).
- **Seed tutor profile:** `robots noindex` regardless of completion —
  `tutorProfileNoindex()` gained an `isSeed` arg and **seed wins** over the
  migration-70 completion rule (a seed tutor at 100% is still noindex).
- **Tutor sitemap:** `listed_tutor_slugs()` excludes seed tutors (now
  `>= 100 AND NOT is_seed`). All three currently-listed tutors are seed, so the
  tutor sitemap is empty until a real paid tutor is listed.
- **Fixture tuitions:** `isFixtureTuition()` (`lib/fixtures.ts`, pure, mirrored by
  the SQL) — a tuition is a fixture when NOT a team post AND (parent `is_seed`, OR
  `job_tx_id` starts `JOB-TRK` [bulk import] or `SEED-JOB`). A fixture tuition is
  `noindex`, out of the sitemap, and emits **no JobPosting JSON-LD**. The genuine
  team posts (`is_team_account`, `jobs@tutormint.org` — 7 of them) stay fully
  indexable.
- **Tuition sitemap:** new `indexable_job_slugs()` SECURITY DEFINER function
  encapsulates the fixture rule — `jobs` is public-read but `profiles` is not, so
  the sitemap (publishable key) cannot itself tell a fixture from a real post.
  `app/sitemap.ts` calls it instead of a direct `jobs` select.
- Verified after apply: is_seed 15, tutor sitemap 0, tuition sitemap 7 (all team
  posts), `rls:audit` 179/179. Tests: `test:authtrust` covers a seed tutor at 100%
  being noindex + out of the sitemap, a real tutor at 100% indexable + present, and
  the fixture-tuition rule (no JobPosting).

**As built.** Migration 70 (backup `public-20260910-225122.sql` taken first,
applied live in one transaction). Verified after apply: directory 3, visible 5
(3 listed + 2 unclaimed imports), sitemap 3, `rank_tutors` returns `completion`/
`has_degree`, `tutor_public_page` resolves for a listed tutor and an unclaimed
import, `rls:audit` 179/179. Gates: tsc 0 · build 0 · check:contrast 100 ·
test:authtrust 31 (adds the paid-under-100 listed, free-100 not-listed, plan-but-
unverified not-listed, no-degree no-Verified cases, and the pure listing/noindex/
sitemap/badge helpers) · every other suite green.

## One shared post-a-tuition form + optional gender preference (owner, 11 Sep 2026)

**One form, two callers.** `/admin/jobs/new` and the parent's post-a-tuition page
were near-duplicate client forms that had already drifted (two step titles, two
"composed" notes, two submit labels). They are now one implementation,
`components/forms/PostTuitionForm.tsx` (the parent version is the reference — its
layout and copy win). The two files that remain (`post-job/JobForm.tsx`,
`admin/jobs/new/AdminJobForm.tsx`) are thin adapters that pass only what differs
as PROPS, never a forked form:
- parent-only: `children` (the "For which child?" selector), `mode`/`initial`
  (edit + masterId reverse-lookup), `useDraft` (the sign-in draft round-trip), and
  a GATED `onSubmit` (postGated → upgrade sheet, PATCH/POST to `/api/parent/jobs`);
- admin-only: `teamBanner` ("Posted by TutorMint"), `adminExtras` (the ORIGIN
  select + the parent-contact block → `job_contacts`), and a plain `onSubmit`
  POST to `/api/admin/jobs/create`.
Everything else — the taxonomy cascade, "Write this for me", where/how/when, the
gender field, title and description — is shared. `test:posttuition` server-renders
both variants and diffs the field labels: the shared fields appear in both, the
child selector only in the parent, and the banner/origin/contact only in admin.

**Optional tutor-gender preference on a tuition** (migration 72 —
`jobs.gender_preference` text, CHECK male/female/trans or NULL). No preference is
the default and behaves exactly as before.
- **The job stays visible to everyone.** The preference is shown plainly on the
  card and the detail page ("Parent is looking for a female tutor."). Matching,
  ranking and notifications are UNCHANGED — only Apply is gated.
- **Apply is gated to a matching tutor, server-side** (`lib/applications.ts`,
  before the quota check): a tutor whose `tutor_profiles.gender` differs is
  refused with that sentence — a PLAIN message, no upgrade sheet. On the detail
  page the refusal offers similar tuitions (the closed-tuition pattern), so it is
  never a dead end. The card's Apply surfaces the same server message.
- **An unset tutor gender is never blocked** (unset = no check, not a mismatch),
  and it uses the existing profile gender — no second gender field.
- The rule is one pure function, `lib/genderPref.ts` `genderApplyBlocked`, shared
  by the API, the card, the detail page and the tests. `GENDER_PREFS` drives the
  form select (No preference / Male / Female / Trans). Editing a job preserves its
  preference (the edit page reads `gender_preference` into `initial`).
- Gates: tsc 0 · build 0 · check:contrast 100 · rls:audit 179/179 ·
  test:posttuition 10 (male-blocked, female-ok, unset-any, no-pref-unaffected,
  trans, plus the shared-form render diff) · every other suite green.

## Cities and areas are data, not a hardcoded array (owner, 11 Sep 2026)

The city/area lists moved out of `lib/locations.ts` into the database (migration
73), the same shape the academic taxonomy uses — adding a city or area is now an
INSERT, not a code change and a redeploy.

- **Two tables** (see Canonical tables): `location_cities` (23, `sort_order`
  pins the big four then alphabetical) and `location_areas` (249, dependent on
  its city, sorted by name). Seeded VERBATIM from the owner's dataset — nothing
  added, corrected or "improved" ("PECHS", "Gulshan-e-Iqbal", "Federal B Area",
  "6th Road" as given). Reference data: world-readable, admin-writable.
- **One source, read two ways.** `lib/cityAreasCore.ts` is the pure core
  (ordering, area-dependent-on-city, the curated/free-text test);
  `lib/cityAreas.ts` `useCityAreas()` fetches the whole set once through the
  browser client and caches it (like `lib/taxonomy.ts`); `lib/locationsAdmin.ts`
  reads it server-side. `lib/locations.ts` keeps ONLY `JOB_TYPES` / `GENDERS` /
  `parseMode` and no client/Supabase import (the server imports `parseMode`).
- **Free-text fallback, everywhere a locality is ENTERED.** 23 cities do not
  cover Pakistan, so `components/forms/LocationInput.tsx` (and datalist inputs on
  the tutor/parent settings and complete-profile screens) suggest the curated
  names but ACCEPT free text — a member whose locality is not listed types their
  own and it round-trips as a plain string, never blocked. Browse filters stay
  selects (they narrow results and write the URL) but source their options from
  the same tables. Used by the shared `PostTuitionForm` (parent + admin job
  forms), tutor complete-profile and settings, parent settings, both browse
  filter bars, and the admin blog city field — one source, no second list.
- **Columns stay strings; nothing existing becomes invisible.** `jobs.city|area`
  / `profiles.city|area` / `tutor_profiles.city|area` are unchanged plain text
  (ranking still compares with `lower()`), so every current value resolves
  exactly as before. A value not in the curated tables is FREE TEXT by
  construction; `unmappedLocations()` (and `/admin/seo/locations`, owner/manager,
  read-only) lists them live for review — computed from the real columns so it
  can never miss a write path or drift; promoting one is an insert into the
  curated table, after which it drops off the list. Nothing is discarded.
- **Migration report (existing rows that did not map — all preserved as free
  text):** area "DHA" under Lahore (7) and Karachi (1) — the dataset has "DHA
  Lahore" / "DHA Karachi"; area "DHA Phase 5" under Lahore (3) — the DHA
  phase-level entries the owner flagged as omitted; city "Nankana Sahib" (1) —
  not among the 23. "LAHORE" resolves case-insensitively to Lahore.
- **Not built, reported (owner's note):** the dataset caps Lahore and Karachi at
  20 areas each and omits DHA phase-level entries; that gap was left as-is, not
  filled.
- **cityFromSegment / cityFromSlug dropped their `CITIES` dependency** — every
  curated city round-trips through slug → title-case, so the landing/slug helpers
  stay pure string transforms with no table read.

Gates: tsc 0 · build 0 · check:contrast 100 · rls:audit 185/185 · test:locations
6 (city sort; every city → its own areas; unknown city → empty; case-insensitive
resolve; curated vs free-text; free-text round trip) · every other suite green.

## One OTP per number, nothing persisted until verified (owner, 11 Sep 2026)

At 4.80 PKR a message, resends are real money, so the old flow (create the
account first, hold it at /verify-phone, resend every 5 min / 5 an hour / 6 a
day) is replaced. Migration 75.

- **A mobile signup persists NOTHING until the code verifies.** `/api/auth/register`
  (mobile branch) creates no auth user, no `profiles` row and no synthetic
  `<msisdn>@users.tutormint.org` — it stores the draft (name, role, BCRYPT-hashed
  password, mobile, utm) in a short-lived `pending_signups` row keyed by an
  httpOnly `tm_pending_signup` cookie, and sends exactly ONE SMS. The account is
  created only when the code is entered, by `verifyPendingSignup()` on
  **`/api/auth/register/verify`**. Until then the number is free and
  re-registering is allowed. The email branch and the confirmation-link flow are
  UNCHANGED (that account is still created unconfirmed at register).
- **The password is never stored in the clear.** It is bcrypt-hashed at register
  (`lib/pendingSignup.ts`, `bcryptjs`) and the account is created with GoTrue's
  admin `password_hash`; the session is then minted with a magic-link token
  (`generateLink({type:'magiclink'})` → `verifyOtp({token_hash})`, the staff-invite
  mechanism), so the plaintext is needed nowhere after the register form. All
  three — createUser(password_hash), signInWithPassword against the hash, and the
  magic-link session — were verified against the live project (create + delete).
- **ONE SMS PER NUMBER PER ATTEMPT, no resend button.** A live code (unconsumed,
  unexpired) for a number means one is outstanding: a second attempt sends
  nothing and says *"We already sent a code to this number. Please use it."* The
  per-number cooldown/hour/day caps are GONE — the 10-minute code TTL IS the
  resend interval: when it lapses the row is dead (every read filters on
  `expires_at`), the number is free, and starting over sends one new SMS. This
  rule is shared: `sendOtp` (signed-in verification, `phone_otps`) and
  `startPendingSignup` (pre-auth, `pending_signups`) both apply it, and
  `deliverCode()` in `lib/otp.ts` is the one dev-bypass/bridge/provider dispatch.
  The per-IP caps (`otp_send`, `otp_verify`, `register`) still stop one actor
  burning the balance across many numbers.
- **The fallback is EMAIL, not a resend.** `/verify-phone` (pending mode) offers
  *"Sign up with your email instead"* — a free path that already works — plus the
  note that a mobile can be added and verified later from Settings, and is only
  required to be LISTED in search. The human WhatsApp/email support fallback
  stays alongside it (a code can still fail to arrive).
- **/verify-phone serves two modes.** PRE-AUTH pending signup (reads the cookie,
  no session; `PendingVerifyForm`, no resend, email fallback, "start over" on an
  expired/locked code) and the AUTHENTICATED gate (a legacy mobile-first account,
  or a bridge account re-verifying once the provider lands; `VerifyPhoneForm`,
  now with no client cooldown-on-load so a code can be requested immediately and
  the one-SMS rule surfaced as "already sent").
- **The pure decisions are unit-tested** (`lib/pendingSignupCore.ts`,
  `test:authtrust`): `codeStillLive`, `pendingSendDecision` (a live code is
  reused / an expired one frees the number), `classifyPendingVerify` (match →
  create, wrong → count down, cap → locked, expiry → start over). The DB
  integration (insert/verify/create-once, the per-IP cap) rests on those cores
  plus the live create/login/magic-link check and code review — no browser was
  driven.
- **Consequences handled.** `/admin/signups` loses its "mobile never verified"
  category (`lib/abandonedSignups.ts` — those rows no longer exist); email-not-
  confirmed and verified-but-under-100% are unchanged. Draft preservation across
  signup still works (the final redirect honours `next`; sessionStorage survives
  the client navigations). Mobile-verify-from-settings (an email account adding a
  number, via `/api/auth/otp` / `/api/auth/phone`) follows the same one-SMS rule.
  Expired pending rows are swept on the daily cron (`expirePendingSignups()`),
  and are dead by time regardless. `pending_signups` is on rls-audit's
  NO_POLICY_OK (service-role only).

Gates: tsc 0 · build 0 · check:contrast 100 · rls:audit 187/187 · test:authtrust
35 · test:delivery 22 · every other suite green.

## More contact fields on admin-posted tuitions (owner, 11 Sep 2026)

Admin copies tuitions from public hiring ads (school/academy Facebook posts,
WhatsApp statuses), where the poster's details are the institution's own, openly
published — not a private household's. The admin-only contact block on
`/admin/jobs/new` now records four more optional fields beside name and phone:
**WhatsApp number, Email, Address, Social handle**. Migration 76.

- **All of them live in `job_contacts`, never on the jobs row** — the same reason
  name and phone already do (migration 65): `jobs` has a public row-read policy
  and RLS cannot hide a column, so anything on the jobs row is one `select('*')`
  from a public, indexed page. `buildJobContact()` (`lib/jobContactCore.ts`, pure)
  normalises and validates before the service-role write: phone and WhatsApp
  through `normalisePkMobile` to canonical MSISDN, email shape-checked
  (`looksLikeEmail`), address and social free text (no invented format). An
  invalid phone/WhatsApp/email is a clean 400 named by field, before anything is
  created; empty fields are stored as null.
- **Visibility is unchanged** — shown to signed-in tutors only, no plan gate, via
  the service-role `loadJobContact()`, rendered ONLY in the tutor branch of the
  job page (Call + WhatsApp buttons as before; email a `mailto:`; a social handle
  that is a URL is linked, else plain text; address plain text). Never to a guest,
  a parent or a crawler; never in metadata, JSON-LD, OG or the sitemap. `/admin/jobs/[id]`
  shows the full block to admins. **Only filled fields render** — a job with an
  email and no address shows no empty row and no stray label.
- **The parent-facing post form is untouched** — the block is gated behind
  `adminExtras` on the shared `PostTuitionForm`; a parent posting their own
  tuition has their contact on their account.
- Tests (`test:jobcontacts`, 6): the six fields round-trip through the
  `job_contacts` record shape; a partial block yields only the filled fields; an
  empty block is not a contact; invalid phone/WhatsApp/email are rejected by
  field; and the `JobPosting` JSON-LD builder cannot carry any contact field (it
  takes only job fields). `test:posttuition` updated: the four new fields are
  admin-only.

Gates: tsc 0 · build 0 · check:contrast 100 · rls:audit 187/187 (job_contacts
anon-read denied, admin-read policy) · test:jobcontacts 6 · test:posttuition 10 ·
every other suite green.

## Job Type becomes 19 job titles, field 1, composed job-card title (owner, 11 Sep 2026)

The three-value Job Type (home / online / school) is replaced by 19 job titles,
stored as DATA in `job_titles` (migration 77, the location_cities pattern —
adding a title is an INSERT). The 19, in the owner's fixed order: Home Tutor,
Online Tutor, Early Years Teacher, Primary Teacher, Middle School Teacher, High
School Teacher, O Levels Teacher, A Levels Teacher, IB PYP Teacher, IB MYP
Teacher, IB Diploma Teacher, College Lecturer, Visiting Teacher, Sports Teacher,
Music Teacher, STEM Teacher, Robotics Teacher, Vice Principal, Principal.

- **Stored VERBATIM as the label** (like a city), so `jobs.teaching_mode` and
  `tutor_profiles.job_types[]` hold the title text and display is identity. No
  CHECK on the value columns (dropped) — the closed set is enforced by the UI
  offering only table rows, exactly as cities are. `teaching_mode` keeps its name
  and stays the mirror of `job_types[0]`. `lib/jobTitlesCore.ts` (pure) +
  `lib/jobTitles.ts` (client hook) + `lib/jobTitlesServer.ts` (server) are the one
  source; `jobType()` returns the stored label verbatim (no title-casing, so "IB
  PYP Teacher" survives), mapping only the RETIRED short codes for old `?mode=`
  links.
- **POSITION.** Job Type is field 1 of the shared `PostTuitionForm` (a
  single-select from the 19), before "What do you need taught?" — same on the
  admin variant. It moved out of `WhereHowWhen` (now five selects).
- **TUTOR PROFILE.** Multi-select from all 19 into `tutor_profiles.job_types`;
  matching stays containment (a job shows to a tutor whose set includes its
  title), one rule in `lib/matchChip.ts`.
- **EMPTY SELECTION = no filter** (owner item 4). An empty `job_types` is "no
  TYPE constraint", so the tutor sees every job — the browse board shows all open
  jobs regardless, and the curated surfaces (jobsThisWeek, the matched-job notify
  fan-out) go through `matchVisibility`, which treats an empty set as included
  (the LOCATION rule still applies: a home job in another city is still not a
  match). The ONE place empty = excluded is `rank_tutors` — but that is the
  OPPOSITE direction (a parent FILTERING tutors by a title), where a tutor who
  offers nothing correctly should not appear; that is not "he sees all jobs" and
  is left as-is.
- **ONLINE IS CITY-AGNOSTIC** re-pointed from the value 'online' to the title
  'Online Tutor' (`ONLINE_JOB_TITLE`), in `matchChip`, the notify fan-out, and the
  `rank_tutors` location bonus (recreated from its exact live definition with that
  one literal changed). Home and school titles stay same-city.
- **JOB CARD TITLE** is composed (`lib/jobDisplayTitle.ts`, pure) in
  `lib/jobFeed.ts` `decorate`: `Job Title | Gender | Subject | Level | Area | City
  | Budget`, dropping every missing optional segment and its separator (no stray
  pipes). This one string is the card title, the tuition page `<title>` and the
  JobPosting structured data (the `${where}` appends that would double the city
  were removed). The stored `jobs.title` is no longer the display title — search
  (`browseJobs` `filters.q`) still matches the stored column.
- **MIGRATION.** `Home Tuition`→`Home Tutor` (60 jobs, 16 tutors), `Online
  Tuition`→`Online Tutor` (2 jobs, 1 tutor). `School Job` LEFT RAW and reported —
  2 jobs still carry `teaching_mode='school'` (`JOB-TX-5MCHM5U` "Early Years
  Teacher Required" · Roots International; `JOB-TX-M6MXVCD` "…English Language
  Teacher…" · Beacon House), 0 tutors — the owner picks which of the 17 school
  titles each meant; nothing was guessed. `teaching_mode` still mirrors
  `job_types[0]` (unchanged write logic).

Gates: tsc 0 · build 0 · check:contrast 100 · rls:audit 190/190 (job_titles
world-read, admin-write) · test:jobtitles 8 (order, verbatim round-trip of all 19,
online pivot, containment, empty-array = no filter, composed-title omission,
legacy parseMode) · test:posttuition 10 · test:cv 14 · test:social 7 · every
other suite green.

## Composed title on the card, human headline on the page (owner, 11 Sep 2026)

Refines the section above: the composed `Job Title | Gender | Subject | Level |
Area | City | Budget` string is right for the compact CARD but reads as a
database row in a browser tab and a Google Jobs result. So:

- **The CARD keeps the composed string** — `JobCard` renders `job.title`, still
  the composed field list from `decorate`. Unchanged.
- **The PAGE surfaces use the stored human headline** — the tuition page
  `<title>`, its `<h1>`, breadcrumb and `ApplyPanel`, and the JobPosting JSON-LD
  now use `jobs.title` (the headline the form's "Write this for me" produces and
  the admin edits), via `preferHumanTitle(stored, composed)`. `decorate` carries
  the raw stored headline as `JobCardData.headline` alongside the composed
  `title`; `preferHumanTitle` falls back to the composed string only when the
  stored title is empty. **0 of 64 jobs currently have an empty stored title**,
  so the fallback is defensive today.
- The form's Title field and the "Write this for me" generator are untouched —
  they were producing the right thing all along.
- **The two School Job tuitions are set** (migration 78, from their own ad
  headlines, not a guess): `JOB-TX-5MCHM5U` "Early Years Teacher Required" (Roots
  International) → `teaching_mode = 'Early Years Teacher'`; `JOB-TX-M6MXVCD`
  "…English Language Teacher | Grade 4" (Beacon House) → `'Primary Teacher'`
  (Grade 4 is primary). Jobs carry only `teaching_mode`; `job_types[]` is a
  tutor-profiles column. No `teaching_mode='school'` rows remain.

Gates: tsc 0 · build 0 · check:contrast 100 · rls:audit 190/190 · test:jobtitles
11 · test:posttuition 10 · test:cv 14 · test:social 7 · every other suite green.

## Split the 12 lumped taxonomy levels; Level becomes multi-select (owner, 11 Sep 2026)

Twelve `taxonomy_levels` lumped several stages into one row ("Grade 1 to 5"), so
a parent could not say "Grade 4". Migration 79 splits each into its granular
levels (the owner's exact list — not added to, renamed or reordered) and makes
the grade step a MULTI-select. Every already-granular level (Test Preparations 64,
Sports & Games, Holy Quran, IGCSE Core, O Levels) is untouched.

- **Split + fan-out.** 36 new levels; every SUBJECT master on a lumped level is
  copied to each split level (mechanical — Grade 1…5 each inherit the full "Grade
  1 to 5" subject list; verified 57 = 57 for Grade 4). The 12 lumped rows are kept
  `legacy=true`, hidden from the pickers but valid on existing rows. `sort_order`
  100+ slots the splits after any already-granular level in the category (only
  IGCSE has one).
- **Level multi-select.** `TaxonomySelector`'s grade step is now a searchable
  checkbox grid with chips (mirrors subjects), on the job form AND the tutor
  profile. `lib/taxonomy.ts`: `resolveMasterIds(category, levels|level, subjects)`
  fans across levels; `selectionForMasterIds` returns a `levels[]`;
  `fetchGradesForLevel` excludes legacy; `fetchLegacyLevelNames()` lets the picker
  show a pre-selected legacy level (edit) as a checked, re-pickable option.
- **jobs.class_levels text[]** is the explicit multi-level store (parallel to
  `tutor_profiles.class_levels`); `class_level` (+ the legacy `grade` mirror) hold
  the COLLAPSED run written by `lib/jobs.ts`. The card-title Level segment is
  collapsed by `lib/levelDisplay.ts` `collapseLevels` — a contiguous same-suffix
  grade run reads "Grade 1–5", not "Grade 1 | Grade 2 | …". The stored human title
  still drives the page `<title>` and JobPosting (preferHumanTitle).
- **MATCHING is unchanged, and that is the answer to "is it awkward".** Matching
  is entirely master_id based (`job_subjects` ∩ `tutor_subjects`), and because
  subjects fan out per split level, master_id intersection ALREADY realises level
  containment (a Grade 1–3 Physics job matches a Grade 2 Physics tutor). A
  separate level-array containment would double-filter with the master matching,
  so none was added; `tutor_profiles.class_levels` was never a matching input and
  the tutor's levels stay stored via master_ids (now multi-level).
- **Nothing invisible, nothing guessed** (migration item 3). A job/tutor on a
  lumped level keeps its lumped master_ids (legacy), renders and matches, and is
  re-picked on next edit — NOT auto-migrated. **41 jobs and 8 tutor profiles sit
  on legacy levels today.**

Gates: tsc 0 · build 0 · check:contrast 100 · rls:audit 190/190 · test:levels 8
(the contiguous-run collapse) · test:posttuition 10 · every other suite green.
The split (subjects resolving under each new level, legacy hidden but valid, only
the 12 flagged — Test Prep 64 untouched) is verified live in psql; no browser was
driven for the multi-select UI (its logic rests on the pure tests + the build).

## Replace the taxonomy with the owner's corrected dataset (owner, 12 Sep 2026)

The live taxonomy was wrong two ways: levels were miscategorised, and migration
79 had fanned subjects mechanically across split levels (Grade 1 and Grade 5
carried identical lists). `supabase/seed/taxonomy-2026.csv` is the owner's
authoritative, per-grade dataset and is loaded VERBATIM — nothing renamed,
reordered, merged or split. **Supersedes migration 79.** Migration 80.

- **Counts, exact:** 13 categories · 29 grades · 480 subjects · 1,475
  combinations. (The PR prose said BS = 132; the file pairs BS "Semester 1 - 8"
  with **124** subjects and the file is authoritative — loaded verbatim.) The
  live non-legacy triples are byte-identical to the CSV (0 missing, 0 extra),
  verified in psql.
- **Generated, reproducible.** `lib/taxonomySeed.ts` parses the CSV (quoted
  comma fields, verbatim names); `scripts/build-taxonomy-2026.ts` emits
  `supabase/migrations/80_taxonomy_2026.sql`; `scripts/test-taxonomy.ts`
  (`npm run test:taxonomy`, 6 assertions) asserts the counts and that each grade
  carries exactly its CSV subjects and nothing from another grade. The CSV, the
  SQL and the generator are committed together.
- **The retire-and-replace mechanism.** The migration flags **every prior
  `taxonomy_level` legacy** (scoped `where slug not like 'x80g-%'` so a re-run
  can't retire the new rows), then inserts the new taxonomy under collision-proof
  `x80…` slugs: categories reused by EXACT name (10 of 13; the 3 with no
  name-match — "Pre - Primary / Pre - School", "Matriculation / Secondary",
  "Teaching of Holy Quran" — inserted fresh, the old "Pre-Primary / Pre-School" /
  "Matriculation" / "Holy Quran" rows fall out of the pickers once their grades
  are all legacy, so categories need no legacy flag), subjects reused by EXACT
  name (363 of 480; 117 new — reuse keeps a subject's search aliases), grades and
  master always fresh. No master row is deleted, so existing ids stay valid.
- **The name-collision trap, and the fix.** `lib/taxonomy.ts`'s tree keys by
  display NAME, and a retired "Grade 1" would otherwise merge its subjects with
  the new "Grade 1". So the tree and EVERY picker are built from non-legacy rows
  only (`resolveMasterIds` too — else a fresh pick would drag retired master ids
  into every new post via a shared grade name). Only `labelsForMasterIds` reads
  all rows (by id), so a retired row still renders its saved labels.
  `selectionForMasterIds` returns non-legacy only, so a retired job's edit form
  opens the taxonomy step CLEAN (re-pick) rather than pre-filled with a category
  that no longer exists. `TaxonomySelector` dropped its legacy-grade handling
  (the tree is already non-legacy). `fetchLegacyLevelNames` was removed (no
  callers).
- **Nothing invisible, nothing guessed** (migration item 5). **50 jobs and 11
  tutor profiles** sit entirely on legacy today; they render, they match, and
  they are re-picked on next edit. An edit that leaves the (now-retired) taxonomy
  step untouched fails the existing "choose at least one subject" validation on
  save — the honest consequence of retiring the whole taxonomy — so the person
  re-picks then; the card keeps working until they do.
- **Follow-up (reported):** the 117 newly-inserted subjects carry no Roman-Urdu
  search aliases yet (`taxonomy_aliases` are admin-editable and attach by subject
  slug); the 363 reused subjects keep theirs. Substring search works regardless.

Gates: tsc 0 · build 0 · check:contrast 100 · rls:audit 190/190 · test:taxonomy 6
· test:levels 9 · test:posttuition 10 · every other suite green. The multi-select
cascade UI rests on the pure tests + the build; the data (per-grade triples,
retired rows still rendering/matching) is verified live in psql. No browser was
driven.

## The taxonomy picker showed only one category — the 1000-row cap (owner, 13 Sep 2026)

After migration 80 the Level dropdown showed only "Primary" while 13 categories
have active (non-legacy) levels. **Root cause: the PostgREST max-rows cap (1000).**
`taxonomy_master` is now 4,588 rows (1,475 live + the retired taxonomy kept valid
for existing jobs); `lib/taxonomy.ts` `load()` did a plain `.select()` with no
paging, so Supabase returned an arbitrary 1,000-row slice and the tree — built
from whichever non-legacy rows landed in it — collapsed to one category. Latent
since migration 79 pushed master past 1,000; migration 80 made it visible. NO
migration, NO data change.

- **The fix is pagination.** `lib/taxonomyBuild.ts` (new, pure of the browser
  client) holds `fetchTaxonomyTables(client)` — pages every taxonomy table with a
  stable `order` + `.range()` until a short page, defeating the cap — and
  `buildTaxonomy(tables)`, the tree/rows derivation. `lib/taxonomy.ts` `load()`
  now calls both; a failed fetch is NOT cached. `TaxonomyNode`/`TaxonomyRow` moved
  there (re-exported from `lib/taxonomy.ts`, so callers are unchanged). A client
  `limit` cannot beat max-rows — only paged `range` can.
- **Same bug fixed in two more full-table readers the growth exposed:**
  `lib/import.ts` `validateRows` (its `.limit(2000)` was still capped at 1000, so
  bulk-import subject/level resolution saw a truncated, mostly-retired master set)
  and `lib/landing.ts` `loadSubjectIndex` (its bare full-master select truncated
  the master→subject-slug index, so a listed row on a higher master id resolved to
  no landing link). Both now call `fetchTaxonomyTables`. Every OTHER taxonomy read
  is bounded by `.in('slug'|'id', …)` on a row's own few masters — well under the
  cap, left as-is.
- **Live test.** `scripts/test-taxonomy-live.ts` (`npm run test:taxonomy:live`,
  skips without an anon key) fetches the real DB through the same code and asserts
  the picker sees **13 categories and 29 grades**, that master paginated to
  >1,000 rows, and that the retired duplicate categories resolve for legacy rows
  yet never appear in the picker — so a cap regression cannot pass silently.
- **The three orphaned duplicate categories are LEFT, not removed.** Migration 80
  inserted "Pre - Primary / Pre - School", "Matriculation / Secondary" and
  "Teaching of Holy Quran" as fresh rows (the CSV names differ from the old
  "Pre-Primary / Pre-School" / "Matriculation" / "Holy Quran"), leaving those
  three old category rows with 0 active levels. They do NOT leak into the picker
  (the tree is non-legacy only, and they have no non-legacy level). They are KEPT
  because: (a) `taxonomy_levels.category_slug` is an FK to them and their retired
  levels are still there; (b) existing jobs/tutors point at master rows under
  those categories, and `buildTaxonomy` drops any master whose category name can't
  resolve — deleting the category would break `labelsForMasterIds` rendering for
  those legacy rows. Deleting them buys nothing (3 tiny hidden rows) and would
  violate the "existing rows still render" guarantee. Retire, don't delete —
  consistent with migration 80.

Gates: tsc 0 · build 0 · check:contrast 100 · rls:audit 190/190 · test:taxonomy 6
· test:taxonomy:live 1 (13 cats / 29 grades, live) · test:levels 9 · every other
suite green.

## The corrected taxonomy cascade on every entry surface (owner, 13 Sep 2026)

Every surface where a MEMBER enters their taxonomy now renders the one shared
`TaxonomySelector` (Level → Grades multi-select chips → Subjects), so all resolve
the same 13 categories / 29 grades from migration 80. Migration 81 (two function
recreations, no table/data change).

- **Tutor dashboard settings — converted.** It held a FREE-TEXT "specialty"
  picker (`{subject, level-of-proficiency}` typed strings joined into a
  `specialty_subjects` column) — never the taxonomy (rule 12), and it could not
  edit the tutor's real `tutor_subjects` at all. Replaced with `TaxonomySelector`
  writing `tutor_subjects` via `/api/profile/save` `{subjectMasterIds}`, the SAME
  path complete-profile uses. Saved subjects (incl. retired-taxonomy picks) show
  as green chips via `labelsForMasterIds` (by id, so they still render); the
  cascade REPLACES them on Save only when it resolves a fresh pick — an untouched
  cascade preserves them, so nobody's selection is silently cleared. The free-text
  `specialty_subjects`/`specialty_list` writes are gone (columns left in place,
  unread).
- **Already used it (no change):** tutor complete-profile Subjects step and the
  shared `PostTuitionForm` (parent + admin job posts). **Parent settings** enters
  no taxonomy (verified — nothing to convert); a child's `class_level` is a
  free-text grade, not the subject cascade, and is out of scope. The admin blog
  editor's subject datalist reads `fetchAllSubjects` (already non-legacy).
- **Browse filter bars — repointed, shape unchanged.** `/browse/tutors` and
  `/browse/tuitions` keep their exact controls (a searcher can still filter by
  subject via the typeahead without choosing a level). Their cascade selects
  already read `lib/taxonomy` (non-legacy since migration 80). The one remaining
  leak was the **typeahead + popular list**: `search_suggest()` and
  `popular_subjects()` scanned `taxonomy_master` with no legacy filter, so a
  retired subject could still be suggested. Migration 81 recreates both from their
  live definitions with a single added filter — the master's level must be
  non-legacy (`search_suggest`'s `tax_best` joins the level and drops legacy;
  `popular_subjects` gains `and not l.legacy`). Verified live: `physics`
  suggestions 0 legacy, popular 0 legacy, and the retired "Grade 1 to 5" lump no
  longer appears.
- **Tests.** `test:taxonomy` gained a source-scan (all three entry surfaces
  import + render `TaxonomySelector`; tutor settings holds no bespoke free-text
  subject copy). `test:taxonomy:live` gained: a retired selection still renders by
  id, and the browse RPCs (`search_suggest`, `popular_subjects`) never return a
  legacy master. The shared component means "same 13/29 on every surface" holds by
  construction (all read the one paginated `load()`).

Gates: tsc 0 · build 0 · check:contrast 100 · rls:audit 190/190 · test:taxonomy 7
· test:taxonomy:live 2 · test:posttuition 10 · every other suite green. The
member UIs rest on the shared component + the pure/live tests + the build; no
browser was driven.

## The job card title reads as a phrase, not a pipe row (owner, 13 Sep 2026)

The composed card title was `Job Title | Gender | Subject | Level | Area | City |
Budget` — two lines of pipes where every segment already appears elsewhere on the
same card (subjects as chips, level/location/budget as their own rows, gender as
its own labelled line). It repeated the card and added nothing. Replaced with a
natural phrase: **`[Gender] [Job Title] for [Level] in [Area], [City]`** →
"Female Home Tutor for Grade 1–5 in Johar Town, Lahore". No migration.

- **One pure function**, `jobDisplayTitle` in `lib/jobDisplayTitle.ts`, rewritten.
  Every segment is optional and drops its preposition with it, so nothing reads
  "for in" or trails a comma — a title-and-city-only job is "Home Tutor in
  Lahore". Gender is capitalised as a leading adjective even when handed in
  lowercase (the caller passes `genderPrefWord` = "female") and is omitted
  entirely for No preference — never lowercase mid-sentence. Job Title is verbatim
  from the 19. **Subjects and budget were REMOVED from the type and the caller** —
  both are already on the card and the seven-spelled-out subjects were the whole
  problem.
- **Level reads as prose.** `collapseLevels` (`lib/levelDisplay.ts`) gained an
  optional `{ conjunction: true }` that joins the last two parts with " and "
  ("Grade 2 and Grade 5"; "Grade 1–5, Grade 8 and O Levels"). The contiguous-run
  collapse ("Grade 1–5") is unchanged. `decorate` (`lib/jobFeed.ts`) uses the
  conjunction form for the TITLE and the default comma form for the `class_level`
  BODY row — same source (`class_levels`), so they never disagree on which levels,
  only on the connective. The body row, chips and every other card row are
  untouched.
- **The page/JobPosting split stays.** The tuition page `<title>`, its `<h1>`,
  breadcrumb and the JobPosting JSON-LD still use the stored human headline via
  `preferHumanTitle(job.headline, job.title)` — that is correct and was not
  changed. The composed phrase is only the fallback when there is no stored title
  (0 of 64 jobs today), and it reads better there too.

Gates: tsc 0 · build 0 · test:jobtitles 12 (the full example composes exactly;
no-preference omits gender; no area → "in Lahore"; non-contiguous levels read
naturally; title-and-city only → no stray prepositions; subjects and budget never
appear) · test:levels 10 (adds the conjunction-mode list) · test:posttuition 10 ·
test:cv 14 · test:social 7 · every other suite green.

## Job reference IDs, tutor onboarding flow, admin dashboard rework (owner, 14 Sep 2026)

Three pieces in one PR. Migrations 82 (job ref), 83 (admin roles). Gates at close:
tsc 0 · build 0 · check:contrast 100 · rls:audit 190/190 · test:onboarding 6 ·
test:jobtitles 12 · test:levels 10 · test:posttuition 10 · every other suite green.

### Part 1 — Job reference IDs (migration 82)

Every job now carries `jobs.ref_id` (TM-1001, TM-1002, …) — short enough to read
over a phone, distinct from the opaque internal `job_tx_id`. Generated
SERVER-SIDE and never editable: a column DEFAULT driven by a sequence
(`job_ref_seq`), so EVERY insert path (createJob, createTeamJob, anything added
later) gets one and no request body can set it. All 64 existing jobs backfilled
in `created_at` order from TM-1001; the sequence advanced past the max so new
jobs continue the run (next TM-1065). NOT NULL + unique. Displayed on the job
card meta row, the public tuition page header, the admin tuition list row (navy
chip) + detail header, and the application_progress email. Admin search matches
`ref_id` with or without the TM- prefix.

### Part 2 — Tutor onboarding flow

A new tap-only, bilingual funnel at `/tutor/onboarding` — the screen that turns a
Meta-ad signup into a real profile (every production tutor had 0 subjects). New
tutors are routed here after they verify: `register/verify` sends a tutor with no
explicit `next` to `/tutor/onboarding`; the path is in proxy PROTECTED +
PHONE_GATED. The full editor at `/tutor/complete-profile` is untouched.

- Nothing typed, nothing read: every answer is a chip/tile tap; the only keyboard
  is the optional Other/More search on city/area/subjects. Labels are two or three
  words, English over Urdu (`lib/onboarding/copy.ts` `L`), one question per
  screen, progress dots, a back arrow, 360px-first.
- The counter (`lib/openJobCounts.ts`, POST `/api/onboarding/counts`): a fixed
  header showing the live count of open tuitions, re-queried and re-animated after
  each answer — national then in-city then in-area then matching-you. The FLOOR
  RULE holds: a scope that narrows below 3 never shows a lonely small number or a
  bare zero — it always appends the next-broader fallback. The count is of ALL
  open jobs, never seed/team-filtered.
- Steps, in order: City, Area (chips ordered by open-job demand, Other opens
  search, single-select) · Subjects (taxonomy_subjects, demand-ordered, MULTI,
  More full search) · Level (non-legacy taxonomy_levels, MULTI) · Gender (two
  tiles) · Experience (bands, lower bound to experience_years) · Fee (the real
  demand bands from lib/feeBands, representative value to hourly_rate_pkr) · Photo
  (capture=environment, camera-first + smaller gallery) · Selfie (capture=user,
  no gallery). No Skip until the subjects step is passed.
- Tagline + bio COMPOSED from the tutor's own taps (never empty fields), shown in
  a card with Looks good / Edit. composeHeadline/composeBio (pure,
  test:onboarding) invent nothing and pick one of five bio patterns
  deterministically by hashing the tutor id so SEO pages do not all read the same.
- Submit (POST `/api/tutor/onboarding`) writes city to profiles; area/gender/
  experience/fee/headline/bio to tutor_profiles; resolves chosen subjects x levels
  to taxonomy_master ids (falls back to subject-at-any-level when a level is
  skipped) and rewrites tutor_subjects; recomputes completion; lands the tutor on
  the tuition list matching their answers.
- Profile photo component: FileUpload already collapses to the filename row when a
  file exists and never shows a dropzone above an uploaded photo — verified
  already-fixed, not changed.

### Part 3 — Admin dashboard

- 3.1 Overview is money: removed the queue tiles and the Needs attention block.
  Tiles: Revenue this month, Monthly re-subscribed (bought this month via purchase
  AND held an earlier subscription; admin grants excluded), Tutors, Parents, Open
  tuitions (all open, not seed/team-filtered). Then a Tips block (`lib/adminTips.ts`)
  of real clickable worklists (0 shown, never faked): Unpaid tutors, Listed but
  unpaid, Signed up never filled, Never verified (expired pending_signups).
- 3.2 Members: the filter chips are one single-select group now (role and status
  were independent, so Everyone + Suspended-only both stuck), and a real total
  count with singular/plural.
- 3.3 Orphaned accounts folded into Abandoned signups as a second section; nav
  item gone, `/admin/orphans` redirects; orphans get a Create-missing-profile
  button (POST `/api/admin/orphans/create`, via ensureProfile, audit-logged, a
  role never invented).
- 3.4 Roles: Finance DELETED (payments/plans manager-only); Verifier RENAMED to
  Operations (= Verifier's screens + posting tuitions). Migration 83 reassigned
  live rows and swapped the admin_role CHECK.
- 3.5 Staff: removed Ali Bhai (waystosky@gmail.com) — role revoked, account kept.
  Suspension is now Remove from team (revoke role, back to ordinary member; no
  suspended cards, no Reactivate). Staff mutation failures surface the real status
  + message.
- 3.6 Payments: Approve/Reject only for provider=manual; a pending gateway payment
  shows activates-automatically and no buttons.
- 3.7 Plans: a short explainer (grant when activation failed, revoke an error;
  grants are admin_grant, excluded from revenue/re-subscription).
- 3.8 Tuitions split into two tabs — Posted by parents / Posted by admin (by the
  team account); both rows show the TM- reference.
- 3.9 Landing pages / Locations: unchanged.

No browser was driven — the tap flow rests on the pure test:onboarding +
check:contrast + the passing build; the migrations, backfill, role reassignment
and Ali-Bhai removal are verified live in psql.

## Role tree, tutor routing into onboarding, level default, monthly fee, social posts, blog (owner, 14 Sep 2026)

Follow-up to d80526a. Migrations 84 (role tree), 85 (onboarding flag + level
backfill). Gates: tsc 0 · build 0 · check:contrast 100 · rls:audit 190/190 ·
test:onboarding 6 · test:blog 38 · every other suite green.

### Part 1 — role tree (migration 84)

Exactly three roles: **owner** (unchanged, DB-only transfer), **admin** (renamed
from `manager` — full access EVERYWHERE except the Team screen), **operations**
(office staff: posting tuitions, verifying, assisting, marketing, SEO — absorbed
the deleted Support role). `AdminRole` is now `'owner' | 'admin' | 'operations'`;
the `profiles.admin_role` CHECK is `{owner, admin, operations}`. Migration 84
renamed manager→admin, folded support→operations (no live support account
remained), and removed `seed+finance@tutormint.dev` from the team (staff role
revoked, member account kept — its profiles email did match; the auth metadata
name was "Finance Admin"). SCREEN_ACCESS rewritten so every screen except `team`
includes `admin`; operations holds the office subset (tutors, parents, jobs,
jobsPost, reports, inbox, users, orphans, signups, seo, ads, social, import,
blog/queue/publish/generate) but NOT money (plans, payments), irreversible ops
(jobsMutate, cleanup, videoVisibility, tutorSlug), audit or CSV export.
**Team stays `[]` (owner-only), enforced server-side** — an Admin gets 403 on the
team route, so cannot add staff, change a role, or promote another Admin. Labels
updated (Team ROLES list, dropdowns, badges); ASSIGNABLE_ROLES = [admin,
operations]; seed-dev staff = [admin, operations]; the stale "verifier" comments
in ReportQueue / TutorModerationClient / tutors/[id] cleaned up.

### Part 2 — routing tutors into onboarding (migration 85: onboarded_at)

`lib/onboardingGate.ts` `needsOnboarding(userId)` is the ONE predicate: a tutor
with `tutor_profiles.onboarded_at` null AND (no `tutor_subjects` rows OR no city)
is routed into onboarding. The tutor **dashboard page** redirects on it (the
universal catch for every sign-in path); the **email-confirmation callback**
routes an email-signup tutor there directly; the **onboarding page** redirects
out once `onboarded_at` is set (loop guard). Onboarding finish AND an "I'll do
this later" dismiss both stamp `onboarded_at`, so nobody is trapped. The
dashboard checklist (`ProfileCompletionWidget` `showKeys`) now lists only the
three things onboarding does NOT collect — **degree certificate, introduction
video, CNIC** — the typing-heavy tagline/about/subjects rows are gone; the
percent and count still reflect all items.

### Part 3 — level default (migration 85 backfill)

Skipping the Level step now writes **NO** tutor_subjects rows (subjects are
stored as subject×level master ids; with no level there is no honest row), so a
tutor never appears in level-filtered searches they did not choose — they are
prompted for a level later. The subjects×levels cross-product stands when levels
ARE chosen. Backfill removed the old "subject at every level" skip-path rows,
identified by a (tutor, subject) fanned across 6+ levels. **Reported: 0 rows
removed** — the live table was 24 rows / 11 tutors and the worst (tutor, subject)
spanned only 2 levels, so no skip-path artifact existed (the onboarding flow had
not been used with a skipped level in production). Before = after = 24 rows / 11
tutors.

### Part 4 — monthly fee labels

Every visible render of `hourly_rate_pkr` already read monthly ("/ month" on the
card and profile, "Expected monthly fee" on the form) — no "per hour"/"/hr"
label existed in the UI. The one imprecision, the tutor JSON-LD Offer presenting
the monthly figure as a bare `price`, is now an explicit `UnitPriceSpecification`
with `unitText: 'MONTH'` so a rich result cannot read it as per-session. Column
not renamed (as instructed).

### Part 5 — social posts

The generator lists **every real tutor** — `is_seed` and `is_fixture` excluded
always, in the query, no override (fixtures carried unearned Verified/Premium/
Featured badges and these cards go to Facebook/Instagram). Each picker row shows
**Listed** or **Not listed · blank: <fields>** (the card fields that would render
empty) and the **real earned badges** only. The image route now sources the real
profile (renders an unlisted tutor too, for preview), refuses seed/fixture (403),
and computes badges with the real gate (`listed`) and real degree — not the old
hardcoded `true`, so an unlisted tutor shows no badge and Verified needs a real
reviewed degree.

### Part 6 — blog

- **6.1** After publish, the full absolute URL `https://www.tutormint.org/blog/<slug>`
  shows with a Copy button — in the editor (a green Live-URL bar) and in the post
  list (a clickable link + Copy).
- **6.2** Admin URLs are clickable, new-tab: blog post URLs (list + editor),
  landing pages (already), the tuition public page from `/admin/jobs/[id]` (now
  `target=_blank`), tutor public profile (already).
- **6.3** `BLOG_MIN_WORDS` = 1200 (max 1800). The prompt demands 5–7 distinct H2
  sections, each answering a specific question a Pakistani parent/tutor would
  type, with concrete specifics, length from coverage not padding, and to ask for
  more notes rather than invent material. The editor shows a **live word count**
  and warns under 1200; a short claude draft comes back flagged (`short`) with a
  "add more fact notes" message rather than padded. Figure-tracing is unchanged
  (still enforced).
- **6.4** Publish is blocked while the AI **scaffold** remains in the body —
  `scaffoldViolations()` (pure, `test:blog`) detects the composed-draft
  instruction lines ("Edit it into shape before publishing", "Explain the steps
  in order…", "Add the key points here"), and `canPublish()` names the offending
  line. Enforced server-side on both publish and schedule.

No browser was driven — the flows rest on the pure tests + check:contrast + the
build; the migrations, the role reassignment, the seed-finance removal and the
0-row level backfill are verified live in psql.

## Rs 199 one-time verification fee, three tutor packages, onboarding fixes, apply-gate CNIC + Verify, team grant-to-existing (owner, 15 Sep 2026)

Follow-up to 9daafe1. Migration 86 (backup taken first, applied live). Gates at
close: tsc 0 · next build 0 · check:contrast 100 · rls:audit 190/190 ·
test:authtrust 36 · test:cv 14 · test:blog 44 · test:social 7 · test:messaging 8 ·
test:seedcast 4 · test:delivery 22 · every other suite green.

### Part 1 + 2 — the fee and the packages (migration 86)

The tutor-plan model is rebuilt. See the **Entitlements matrix › Tutor plans**
section above (this PR rewrote it) for the spec; what shipped:

- **Migration 86** adds `plans.active boolean default true` and
  `tutor_profiles.verified_fee_paid_at timestamptz`; keeps the old `verified`
  row as the fee marker (`active=false` — `payments`/`subscriptions` FKs need
  it, so it cannot be deleted); inserts the free `basic` tier; updates `premium`
  (100/"Unlimited", contact+WhatsApp+viewer TRUE, rank 2) and `featured`
  (150/"Unlimited", rank 3); backfills `verified_fee_paid_at=now()` for every
  `verification_status='verified'` tutor and anyone who held the old 199 sub;
  cancels active/paused `verified` subs; and CREATE-OR-REPLACEs
  `tutor_directory`/`tutor_visible_profiles` swapping the active-paid-plan EXISTS
  for `verified_fee_paid_at is not null` (verification `<> suspended/rejected`).
  `rank_tutors` needs no change — it reads `tutor_directory` and tiers by active
  subscription, so a free Basic tutor (no sub) is tier 0, below Premium/Featured.
  Verified after apply: directory 3→7, plans correct, 0 live `verified` subs.
- **`lib/planBadges.ts`** — `tutorListed({feePaid, ...precondition})` (was
  `hasActivePaidPlan`); the precondition no longer requires `verification='verified'`,
  only excludes suspended/rejected (the fee is what verifies). `TUTOR_PLANS`
  gains `basic`; `badgesForPlan` maps `basic`/`verified` to Verified.
- **`lib/entitlements.ts`** — `PlanCode` swaps `verified` for `basic`; `tutorRow`
  carries `verified_fee_paid_at`; `computeEntitlements` synthesises the free
  `basic` plan from the fee (the free-parent pattern), Premium/Featured from a
  sub; `listed` reads the fee.
- **`lib/gate.ts`** — `tutor_apply_no_plan` becomes **`tutor_verify`** (kind
  `'verify'`, bilingual body, the exact line "Verified tutors are shown to
  parents first.", href `/tutor/verify`, the Rs 199 fee row for its price).
  `tutor_contact` and `tutor_viewer_identity` become `'premium'`. `cv_download`
  becomes the verify flow (CV is free to all plans; only an unverified tutor is
  gated). `applyToJob`'s no-plan branch now builds `tutor_verify`.
- **`lib/payments/activate.ts`** — a `plan_code='verified'` payment is the fee:
  stamps `verified_fee_paid_at`, creates NO subscription, logs the distinct
  `verification_fee_paid` event (not `plan_purchased`), and starts any paused
  Premium/Featured plan. `isTutorListable` (go-live) now requires the fee.
- **`lib/upsell.ts`** ladder `['basic','premium','featured']`;
  **`lib/upgradePath.ts`** default upgrade to `premium`; **`lib/cv/access.ts`**
  any plan (basic+) downloads; **`lib/conversionSweep.ts`** + **`ViewsCard`** the
  weekly teaser sells Premium (`plan=premium`), reaching Basic/no-plan tutors;
  **`lib/display.ts`** `planLabel` adds `basic`; **`PackagesTable`** / tutor
  packages page filter `active=true`, show the one-time-fee banner, "Get verified
  · Rs 199" on the Basic card; **`api/gate`** + **`api/admin/plans`** updated
  (granting `verified`/`basic` comps the fee with no sub; a granted Premium/Featured
  stamps the fee so the tutor lists); FAQ copy corrected (199 is one-time,
  never "/month").
- **adminOverview** unchanged and correct: the fee creates no subscription, so it
  is auto-excluded from the re-subscription metric while its payment counts in
  revenue.

### Part 3 — onboarding defects (real, observed on device)

- **3.1 tiles show the ACTUAL photo, not a green tick.** `OnboardingClient`'s
  `PhotoStep` gained `previewUrl`; the profile-photo tile shows the uploaded
  avatar, the selfie tile a local object-URL preview. The apply-gate CNIC tiles
  (Part 4) show the captured image too.
- **3.2 selfie upload — FINDING, then fix.** Confirmed from data, not guessed:
  the `avatars` and `identity-docs` buckets have NO `file_size_limit` and NO
  `allowed_mime_types`, and the `identity_docs_owner_write` RLS policy is correct
  — so storage size/MIME/RLS is NOT the cause. identity-docs' largest object is
  2.87 MB while `avatars` holds a 5.18 MB object: files above ~4.5 MB never
  reached identity-docs. The selfie/CNIC POST through the Next/Vercel API route
  (`/api/documents/upload`), whose serverless request-body cap (~4.5 MB) a raw
  Android camera photo (4-8 MB) exceeds, so a platform 413 is returned BEFORE the
  route runs, surfacing as the opaque "Upload failed." The avatar path uploads
  browser to Supabase directly (no route), which is why a 5.18 MB avatar
  succeeded. Fix: `lib/imageCompress.ts` `compressImage` is wired into the
  onboarding photo + selfie AND the apply-gate CNIC uploads (resize to 1600px max
  edge, re-encode JPEG); and the real status is surfaced (a 413 now says the photo
  was too large).
- **3.3 counter floor rule.** `OnboardingClient`'s `withFloor` was keeping the
  narrow (0/small) count as the headline. Now: when the narrow scope matches
  under 3, the headline becomes the nearest broader count that is at least 3 (else
  the broadest known — national), and the narrow match drops to a secondary detail
  shown ONLY when positive — so a "0 matching you" headline or a "· 0 matching
  you" taunt can never appear.
- **3.4 "View your public profile" 404.** The Navbar read the slug off
  `tutor_profiles` regardless of visibility, so a just-onboarded (unlisted) tutor
  got a dead link. It now reads `tutor_visible_profiles` (what the public page
  renders); when not visible and the fee is unpaid the menu offers "Get verified"
  to `/tutor/verify` instead. The dashboard's "View your public profile" link is
  gated on `ent.listed`.

### Part 4 — the apply gate: CNIC + Verify

An unverified tutor tapping Apply now meets the Rs 199 CNIC-verify flow, not the
old upgrade popup. `components/upgrade/TutorVerifyGate.tsx` (rendered by
`UpgradeSheet` for a tutor `kind:'verify'` gate, and standalone at `/tutor/verify`):
bilingual heading/body; CNIC FRONT and BACK inline, two camera opens
(`accept="image/*" capture="environment"`), each a preview thumbnail once taken
so he can retake; images compressed and saved to the private identity-docs bucket
via `/api/documents/upload` (kind `cnic`, sets `cnic_image_path` — never
re-uploaded elsewhere, never public); one primary "Verify" button (enabled once
both sides are in) that starts checkout for the fee; the exact line "Verified
tutors are shown to parents first." and no other outcome language.

### Part 5 — grant a role to an EXISTING member

`lib/staff.ts` `searchGrantCandidates` (name/email) + `grantStaffToExisting`; a
GET search and a `grant` action on `/api/admin/team` (owner-only; search is not
behind requireFreshAuth, the grant is); the Team screen gained a "Grant a role to
an existing member" search + role picker. A LISTED tutor triggers a
dual-identity confirmation before granting (they keep the public profile AND get
the admin panel on one login); an EMPTY never-completed tutor account has the
tutor role dropped and its empty `tutor_profiles` row removed. Every grant is
audit-logged (`staff.grant_existing`) and timelined.

### Part 6 — blog figure detector false positives

`lib/ai/blogBrief.ts` `unsupportedFigures` now strips, before the digit scan:
markdown link targets (keeping the label), bare http/https URLs, slug-like
hyphen-joined tokens that contain a letter (`grade-1-to-5-mathematics`; a pure
number range like `8000-15000` is left for the scan), and "Grade N"/"Grades N to
N". Real statistics (percentages, counts of people, money) are still flagged;
`test:blog` covers each exemption and the still-flagged cases (44 assertions).

### Part 7 — Resend transactional email templates

`lib/notify/templates.ts` `shell()` rebuilt as a full `<!doctype html>` document
(the HTML is sent verbatim to Resend): tables + inline styles only, palette-only
(#C20202, #151E6B, #9AE899, #EEFBEE, #0A0A0A — no slate, no #0F172A, no #d60008),
`<meta name="color-scheme" content="light">` + `bgcolor` on the button/ground
cells so Gmail dark mode does not recolour, a full-width tap-target button, and
the footer copyright "(c) 2026 Tutor Mint (Private) Limited" (the two-word legal
form). The wordmark is TEXT (no image), so no logo.png dependency —
`https://tutormint.org/logo.png` was verified to serve `image/png` (apex 308 to
www 200) regardless. No literal double-asterisk markdown in any template;
`/forgot-password` exists (and is a Supabase auth template's concern, not these —
the Supabase auth templates were NOT touched). Added the `verification_fee_paid`
receipt template (and registered `plan_granted`/`account_banned` in `TemplateId`).

### Not verified / left as-is (stated plainly)

- **No browser was driven** — the tap flows, the apply-gate modal, the packages
  UI and the email rendering rest on tsc + next build + the pure unit suites +
  check:contrast; the migration, the plan rows, the view row counts and the
  selfie-upload finding are verified live in psql / storage queries.
- **`scripts/seed-dev.ts`** still seeds a tutor with `plan:'verified'` and would
  create a now-meaningless `verified` subscription if run — it is dev-only,
  guarded from production, compiles, and was NOT run in this PR. `seedCast.ts` /
  `reset-seed-cast.ts` WERE updated to the fee model (Basic = fee, no sub;
  verified-usman becomes Basic; a not-fee-paid tutor added), but
  `reset-seed-cast.ts` was NOT run against production here.
- The email restyle is code-verified (structure, palette, meta, footer) but the
  rendered result was not sent through Resend to an inbox.

## Public directory listing bar — not-fixture, has-subject, has-city (owner, 15 Sep 2026) — migration 87

Migration 86 keyed public listing on the one-time fee alone, which let SEED
fixtures (badges they never earned) and empty profiles (0% complete, no city and
NO subjects, so unsearchable) into `tutor_directory`. Migration 87 adds three
gates to BOTH public views, identically:

- **not a fixture** — `COALESCE(p.is_seed,false)=false AND COALESCE(p.is_team_account,false)=false`.
  `profiles` has NO `is_fixture` column (that is a tuition-only concept,
  `lib/fixtures.ts`); the tutor-side fixture signals are `is_seed` (migration 71)
  and the one team account (`is_team_account`, migration 63). Reported to the
  owner: the PR named `p.is_fixture`, which does not exist — `is_seed` + team is
  the faithful equivalent.
- **at least one subject** — `EXISTS (SELECT 1 FROM tutor_subjects ts WHERE ts.tutor_id = tp.id)`.
- **a city** — `tp.city IS NOT NULL AND btrim(tp.city) <> ''`.

Purely additive — every migration-86 condition is kept, columns/order unchanged.
The two views share these three gates and the suspended/banned/verification
conditions IDENTICALLY; they differ ONLY where they always have — `tutor_directory`
excludes under-review tutors and requires the fee (a flat AND), while
`tutor_visible_profiles` renders under-review tutors (amber notice, Part 5) and
keeps its unclaimed-import branch (`imported AND claimed_at IS NULL`) so a claim
link resolves (owner chose to KEEP this branch, 15 Sep). The three gates apply to
that import branch too.

**Effect (verified live after apply):** directory 2→1, visible 4→3. Bilal Ahmad
(real, fee-paid, subject+city) stays listed; **Javeria Fayaz** (fee paid but no
subjects and no city) is now correctly excluded — the "real 0% profile" the PR
flagged; the two unclaimed imports (Junaid Khan, Sana Riaz) still render in
visible via the import branch (both pass the three gates). Seed rows now carry the
`fixture` blocker, so they stay out **even if their fee flag is restored** — the
owner's hand-null stopgap is no longer load-bearing. Counts do NOT match by design
(visible = directory + the 2 gate-passing unclaimed imports).

**The TS mirror + "why not listed".** `lib/tutorListingStatus.ts` (pure,
unit-tested in `test:authtrust`) is `directoryBlockers(facts)` → the reasons in
the view's own order (`banned`, `suspended`, `under_review`, `verification_rejected`,
`fixture`, `fee_unpaid`, `phone_unverified`, `unclaimed_import`, `no_subjects`,
`no_city`); empty = listed. It must stay in lockstep with 87's SQL.
`lib/directoryStatus.ts` `loadDirectoryStatus(userId)` fetches the facts for one
tutor. The **tutor dashboard** reads it (not `ent.listed`, which is only the
fee-and-precondition half) for "Listed tutor / Not listed yet", the "View your
public profile" link (only when actually in the directory — else it 404s), the
header badge, and the "Share your verified badge" card; and shows
`NotListedNotice` — the fee-paid-but-not-listed tutor's fixable reasons
(subjects → complete-profile, city → complete-profile, mobile → verify-phone),
each one tap from its screen, visibility only, no promise of tuitions. The **admin
tutor list** (`loadTutorQueue`) computes the same blockers in a batch (one
subjects-count query, facts already loaded) and shows "Listed in search" or
"Not listed · <reasons>" per row.

Gates: tsc 0 · next build 0 · check:contrast 100 · rls:audit 190/190 ·
test:authtrust 41 · every other suite green.

**Not verified / stated plainly:** no browser was driven — the dashboard and admin
surfaces rest on the pure `directoryBlockers` unit tests + the build; the view
change, counts, and per-tutor in/out listing are verified live in psql. The seed
rows keep the owner's hand-nulled `verified_fee_paid_at` (the `fixture` gate now
makes that moot; restoring the fee flag would not relist them). `ent.listed` /
`tutorListed()` are intentionally NOT extended with the subjects/city/fixture
gates — they answer "can apply / fee+precondition", a related but distinct
question from "in the public directory"; the dashboard reads the directory rule
for anything that claims the tutor is live.

## Apply-gate popup slimmed; fee price moves to the payment page (owner, 15 Sep 2026)

Refines the "Part 4 — apply gate" as-built. No migration, no DB write — copy and
layout only.

- **No price in the apply-gate popup or on the packages page.** The Rs 199 fee
  card is removed from `TutorVerifyGate` and the "One-time verification — Rs. 199"
  banner from `/tutor/packages` (replaced by a price-free "Get verified" prompt +
  Verify button); the Basic card's link is "Get verified" (was "· Rs. 199"); the
  packages framing copy no longer names the fee amount. Plan-card prices
  (Premium/Featured) stay — the packages page is where PLAN prices live; only the
  FEE price moved.
- **The fee price + the one-time/non-refundable line now live on the payment
  page** (`/pay/manual/[ref]`), which is fee-aware: for `plan_code='verified'` the
  header reads "Profile verification · Rs. N · one-time" (not "…plan … for 30
  days") and carries "This is a one-time fee. It is non-refundable." in the header
  — above the fold on a 360px phone, before the tutor pays.
- **The popup is minimal**: heading (bilingual, from `gate.title`), one line
  ("Upload your CNIC, front and back." + Urdu), the two CNIC boxes, one small
  privacy line ("Only our verification team sees it. Never on your profile."), the
  one permitted claim ("Verified tutors are shown to parents first." + Urdu), and
  Not now · Verify. The long bilingual paragraphs, the fee card and the
  "add both sides" helper are gone. `TutorVerifyGate` no longer takes a `gate`
  prop (all copy is fixed; checkout is `planCode:'verified'`).
- **CNIC boxes**: unchanged capture/compress; the box now fills with the actual
  photo and the green ✓ tick overlay is removed (the photo is the confirmation —
  "not a tick, not a filename"). Both sides POST to the SAME `/api/documents/upload`
  (`kind='cnic'`) that the settings identity card (`lib/identity.ts`) and the admin
  verification queue read (`user_documents` kind='cnic' + `profiles.cnic_image_path`,
  private identity-docs bucket, served only via the owner/admin-gated preview
  route) — so a CNIC uploaded here appears in settings and the staff queue and
  nowhere else, and is never re-requested.
- **No outcome promise anywhere** — popup, packages prompt, payment page: the
  only claim is visibility.

Gates: tsc 0 · next build 0 · check:contrast 100. No browser was driven — the
popup/packages/payment surfaces rest on the build; the CNIC storage path is
code-verified (same route + `user_documents`/`cnic_image_path` the settings card
and admin queue already read). A live payment gateway (AssanPay) is not enabled,
so `/pay/manual/[ref]` IS the payment page today; if a gateway is turned on, the
one-time/non-refundable line would need a pre-redirect interstitial (out of scope,
noted).

## Tuitions auto-pause after 15 days, and keep a real public page (PR27 + PR28)

**PR27 (migration 96, 18 Sep 2026).** Every tuition auto-pauses 15 days after it
was posted or last resumed. `jobs` gained `paused_at` and `resumed_at`; the
15-day clock runs from `coalesce(resumed_at, created_at)`. A paused tuition has
`status = 'paused'` (there is no CHECK on `jobs.status`) and is excluded from
browse, search, matching, the sitemap, landing pages and Apply — all of which
filter `status = 'open'`. The daily sweep is `pauseStaleTuitions()` in
`lib/tuitionPause.ts`, riding `/api/cron/subscriptions` (`0 3 * * *`, Vercel Cron,
bom1); it notifies the poster in-app and by email (`tuition_paused` template).
The poster resumes from the tuition page or `/parent/dashboard/job/[id]`
(`/api/parent/jobs/resume` → `resumeJob`, fresh 15-day clock); admins pause/resume
any tuition from `/admin/jobs/[id]` with a reason logged to `admin_audit_log`.
Closed and hired tuitions are never touched.

**PR28 — no tuition URL ever 404s because of status (migration 97, owner, 18 Sep
2026).** PR27's pause exposed a flaw: `jobs_public_read_open` hid any non-open
job from the public, so a paused/closed/hired tuition page 404'd for anon — and
an auto-paused indexed URL flapped 200↔404 on every pause/resume, on a page that
carries JobPosting data. That is a dead end and a bad de-listing signal.

- **RLS.** `jobs_public_read_open` USING is now `true` — anon may read a tuition
  in ANY status. This does not widen the column shape: anon already received the
  whole `jobs` row for an open job, and there is NO contact/phone/CNIC/address on
  it (that lives in `job_contacts`, admin-only). Admin/owner read/write policies
  are unchanged; `USING(true)` subsumes the old parent/admin OR.
- **The page always renders 200** for open, paused, closed and hired. 404 is
  reserved for a slug that does not exist. `lib/tuitionStatus.ts`
  `tuitionPublicState(status)` is the one rule the route, its metadata and the
  guard test read: only **open** is indexable, emits JobPosting JSON-LD and is
  sitemap-eligible; **paused/closed/hired** are 200 + `noindex`, emit no
  JobPosting and stay out of the sitemap (`indexable_job_slugs()` still filters
  `status='open'`, unchanged) — the correct de-listing that reverses on resume.
  A plain banner states the state (paused → not accepting applications right now;
  closed → this tuition is closed; hired → a tutor has been hired). The word
  "expired" never appears; the vocabulary stays paused/closed/hired.
- **No dead end.** A non-open page shows the tuition, then similar OPEN tuitions
  (same city, then same subject — `similarOpenTuitions()` in `lib/jobFeed.ts`,
  reusing `JOB_COLUMNS`/`decorate`) and the browse links.
- **Apply stays server-gated:** `applyToJob` refuses a non-open job; the page
  hides the Apply panel for non-open as well.
- **Poster/admin:** the poster's own paused tuition shows an inline Resume
  (`ResumeInline` → `/api/parent/jobs/resume`); an admin gets a link to
  `/admin/jobs/[id]`. On an OPEN tuition the poster/admin see "pauses in N days"
  (from `coalesce(resumed_at, created_at) + 15`, derived at read time —
  `daysUntilPause()`), and the same on the poster's dashboard row.
- Guard: `npm run test:tuition` (`scripts/test-tuition-status.ts`) asserts the
  state rules, the banner copy, the never-negative clock, that `jobByPublicSlug`
  has no status branch (identical anon columns for open and paused), and that the
  sitemap RPC still filters open only.

### As built — the pause cycle was exercised end-to-end (PR29, 18 Sep 2026)

The 15-day auto-pause had never actually run in production (0 rows were due), so
PR29 proved it on a throwaway team-owned tuition and fixed the read/write clock
mismatch.

**Cycle exercised (temporary team tuition, TM-1098, then deleted).** A team-owned
open tuition was created (a zero-tutor subject, so `notifyMatchingTutors` pinged
nobody) and its clock base backdated 20 days by id. `pauseStaleTuitions()`, run in
the production environment via the daily cron, paused **exactly that one row and
nothing else** (`{paused:1, ids:[…]}`) and sent the `tuition_paused` email to the
poster address **jobs@tutormint.org**. Verified live: `status='paused'` +
`paused_at` set; the public URL 200 with the "not accepting applications right
now" banner, `noindex` present, no JobPosting JSON-LD, and the "Similar open
tuitions" section; the slug absent from `indexable_job_slugs()` and from the
served `/sitemap.xml`. A second sweep was a no-op on that row. Resume reversed
every signal (status open, `resumed_at` set, noindex gone, JobPosting emitted,
slug back in the RPC). The temporary tuition was then **deleted**.
`indexable_job_slugs()` reflects a change immediately; the served `/sitemap.xml`
is ISR `revalidate = 3600`, so it lags by up to ~1 hour. Apply/message/demo
refusal for a non-open job is server-side (`applyToJob` checks `status='open'`)
and asserted by the guard, not re-proven by an authenticated POST (no browser).
The HTTP `createTeamJob` and `/api/parent/jobs/resume` routes themselves were not
driven (they call `cookies()` / need a session, impossible browserless); the row
was created and resumed with the service-role client in the identical shape and
state transition, and those routes are unchanged and covered by their own PRs.

**Clock mismatch fixed (PR29 §B).** The sweep and the poster's "pauses in N days"
now derive from ONE expression, `pauseDueAtMs(base) = coalesce(resumed_at,
created_at) + 15 days` (`lib/tuitionStatus.ts`): the sweep pauses on `isPauseDue`,
the display reads `pauseCountdownLabel`, both built on `pauseDueAtMs`. The label
never renders 0 or a negative — under a day left, and the past-due-but-not-yet-
swept window (cron runs 03:00 bom1), read **"pauses today"**, and the tuition
still takes applications until the sweep actually pauses it. `daysUntilPause` (the
old numeric helper that could return 0) is gone.

**First-batch count (PR29 §C, live SQL, 18 Sep 2026).** Open tuitions by days
since the clock base: 47 in 0–7 days, 1 in 8–14, none at 15+. Because the clock
starts at `created_at`, the oldest cross the line together: **3 open tuitions**
become due within a day of each other, the first batch, on **~2026-09-24** (the
earliest base is 2026-09-09). They were NOT paused in this PR — the daily cron
will pause them on/after that date.

### As built — pause notifies the poster only; admin reads status from a badge (PR30, 18 Sep 2026)

Owner decision: **admin staff get NO notification when a tuition pauses.** Admin
learns it from the visible status badge wherever a tuition is shown, and acts
from there.

- **Nothing to remove.** A pause already notified only the POSTER: the cron
  sweep (`pauseStaleTuitions`) and the manual admin pause
  (`/api/admin/jobs/action` action `pause`) each `notify({ userId: parent_id })`
  + (sweep) `deliverEmail` the `tuition_paused` template to the poster, and write
  `admin_audit_log`. No admin-directed notification, digest or staff email fired
  on pause today, so there was none to strip. The audit row stays — it is a
  record, not a notification.
- **The poster's notification and email are unchanged**, including for a
  team-posted tuition: the poster there is the team account
  (jobs@tutormint.org), a real mailbox worked by whoever handles that tuition's
  applications — proven receiving it live in PR29 — and it is NOT suppressed as
  "an admin email".
- **Admin reads status from the shared badge.** The `/admin/jobs` list already
  rendered `components/admin/StatusChip`; the `/admin/jobs/[id]` detail used a
  bespoke grey pill and now uses `StatusChip` too, so every state (open / paused
  / closed / hired) shows the real status on both. `statusTone` maps `paused →
  'info'` (navy `tint-navy`/`navy`, a registered contrast pair) — an "inactive"
  state like closed, distinguished by its word and the status filter, never by
  colour alone. Gold stays the Featured tag's; the paused chip is not gold.
- **The admin jobs list status filter gained a "Paused" option**, so staff can
  pull every paused tuition in one view (the list already filters `.eq('status',
  …)` generically).
- **No migration** — this is display + notification-routing only; jobs.status
  already carries 'paused' (migration 96) with no CHECK to change.

## Dashboard & Browse polish, test-account pause, orphan messages (owner, 5 Oct 2026)

Nine items in one PR (commit 671ade6 + the docs follow-up). NO migration. Gates at
close: tsc 0 · next build 0 · check:contrast 118 pairs · every offline suite green
except one PRE-EXISTING failure (test:pr106e "file-and-approved gating" scans
`lib/badgeFacts.ts` for `picOk`/`selfieOk`, which HEAD before this PR already did
not contain — untouched here, reported). No browser was driven; the live checks
were HTML fetches of tutormint.org.

- **#56 completion label.** `TutorHeaderCard`: under 100% a brand-red
  "Complete your profile · NN%" link (the Urdu line is gone); at 100% a
  deep-green "✓ 100% Completed" line in its place. `test:pr106e` updated to the
  new rule.
- **#57 tiles in phone dark mode.** PR34's `prefers-color-scheme: dark` override
  for the `--color-tm-tile-*` tokens is REMOVED from `app/globals.css`; the tile
  tokens have one value. `TILE_BOX` (`lib/tileTones.ts` — every dashboard tile
  and the Settings tiles) and the admin Overview card carry `[color-scheme:light]`
  so the browser cannot recolour them either. The nine dark pairs left
  `scripts/contrast-check.ts` (127 → 118 pairs).
- **#94 header Messages icon.** `HeaderMessages` lost its `lg:hidden`: the icon
  with its unread count now sits beside the bell on phone AND desktop. Still
  rendered only for a signed-in tutor/parent (`Navbar` gates on role) — never in
  admin (own bar) or signed out. The desktop messages dock is unchanged.
- **#46 one name formatter.** `lib/formatName.ts` `formatName()` — every word
  capitalised, the rest lower case ("ali RAZA" → "Ali Raza"; hyphen/apostrophe
  parts each capitalised; "tutormint" keeps "TutorMint"; Urdu passes through).
  `properName` (lib/display) now delegates to it, which CHANGES its old rule —
  internal caps are no longer preserved ("McAli" → "Mcali"); `test:labels`
  updated. Applied on every WRITE path (register, ensureProfile, profile save,
  parent profile, pending signup, bulk import, staff invite, tutor settings,
  parent verify) and at every display MAPPING point (getSessionUser, browse
  cards, job-feed parent facts, messaging, public parent, member/audit/admin
  queues, notifications + email `name`, CV, admin pages, social card). Stored
  names are NOT rewritten; slugs/URLs are untouched.
- **#55 "Spam Free Platform Fee".** `FEE_LABEL` in `lib/display.ts` is the one
  member-facing name of the Rs 199 fee; `planLabel('verified')` returns it.
  Changed strings: `lib/paymentsHistory.ts` (dashboard "Payments & refunds" row),
  `lib/adminQueues.ts` (admin Payments queue + subscription ledger plan name),
  `lib/notify/templates.ts` (fee receipt body ×2 + the re-upload line),
  `lib/payments/activate.ts` (fee-paid notification), `app/api/payments/checkout`
  (two refusal messages), `components/tutor/VerifyBenefitsDialog.tsx` (badge
  pop-up body + "Pay Spam Free Platform Fee" button, Urdu line too),
  `components/PackagesTable.tsx` ("After the one-time Spam Free Platform Fee"),
  `app/(site)/pay/manual/[ref]` (header + non-refundable line),
  `app/admin/payments/settings/SwitchesForm.tsx`, `app/admin/users/[id]` (Fact
  label), `app/admin/view-as/[id]`, and `app/(site)/terms` (a new fee paragraph in
  "Memberships, prices and quotas" — the page used to claim memberships were the
  only thing sold — and the no-refund sentence now names the fee). The Complete
  Your Verification screen and its Verify button still show no amount. **PayPro:**
  the create-order payload (`lib/payments/paypro.ts`) has NO description field —
  only OrderNumber/Amount/dates/customer — so there is no bill description to
  set; nothing changed there.
- **#101 online tutors' tuition order.** `lib/jobFeed.ts` ranked default feed:
  for a tutor whose Job Types include Online Tutor, own-city tuitions first
  (area match first, then subject match — the existing priority), then online
  tuitions in other cities; featured/newest/id after. `cityRank()` returns 0 for a
  non-online tutor, so in-person ordering is byte-for-byte what it was; the
  gender filter narrows the set and is untouched. The ranked path now also runs
  for an online tutor with no subjects yet (it used to need subjects).
- **#102/#103 loading + layout.** `PopularLandingLinks` sits directly under the
  filter bar on both Browse pages (confirmed in the live HTML: nav before the
  first real card). Every "Loading…"/"Loading x…" string is gone from app/,
  components/, lib/. `components/Skeletons.tsx` (TutorCard / JobCard / list-row /
  tile / text / chip / filter-bar skeletons) and `components/LogoLoader.tsx` (the
  monogram, `tm-breathe` keyframes in globals.css, reduced-motion safe) are the
  two implementations. `InfiniteFooter` gained a `skeleton` prop (all six
  callers pass one). New loading boundaries: `app/(site)/loading.tsx` (logo),
  `browse/tutors` + `browse/tuitions` (filter bar + 3 cards), both dashboards
  (header card + tiles), both inboxes (rows). Consequence worth knowing: with a
  boundary, Browse now STREAMS — the first bytes carry the skeleton shell and the
  real cards follow in the same response (`$RS` swap), so a raw-HTML grep sees
  the skeleton `<article>`s first; the content is still server-rendered in the
  one document.
- **Step 8 — test accounts: STOPPED, nothing paused.** The gate was "exactly 6:
  Test Parent ×2, Test Tutor, Test Ali, Test Tutor 2, New User". The SELECT
  (case-insensitive, trimmed) matched FIVE: only one row is named "Test Parent"
  (`22222222-…`); the other test parent is stored as **"Test Parent (Tariq)"**
  (`11111111-…`), and "Test Tutor 2" is ALREADY paused (suspended, 26 Sep). The
  script `scripts/dataop-pause-test-accounts.ts` refused by design. Also seen,
  not in the owner's list: "Tutor Test 5" (3 Oct) and "Test Tutor 6" (4 Oct) are
  live and the latter is in Browse. "Pause" here is the platform's reversible
  account pause (`is_suspended`, mirroring `suspendMember`) + the tuition pause
  state for their open tuitions — the script implements exactly that, audited
  under the owner, when the owner confirms the sixth account.
- **Step 9 — orphan messages: DONE, 5 deleted.** `messages` also carries the
  legacy text columns `sender`/`recipient` (emails/display names, not ids); the
  recipient of a canonical message is the thread's other participant. The rule
  applied: sender_id not in auth.users, OR thread present and its other
  participant missing. Exactly five August-2026 rows matched (ids b0ef514d,
  7c5814ec, 9d1b285e, 7bf7cdbc, d14cf3be — all "sender missing", their thread
  rows also gone); deleted by id in one transaction; the re-run SELECT returns 0.
  A sixth row (2d10e51c, 25 Aug) has a sender who is still a member and only a
  missing thread row — not an orphan under "sender or recipient no longer
  exists" — and was left alone. `scripts/dataop-remove-orphan-messages.ts`.

## Dashboard counts, Apply-button clarity, popular searches, verified banner, city de-duplication (owner, 5 Oct 2026)

Seven items. Migration 135 (additive: `tutor_profiles.verified_banner_seen_at`,
applied live BEFORE the deploy, backfilled for every already-verified tutor).
Gates at close: tsc 0 · next build 0 · check:contrast 118 · every offline suite
green except the PRE-EXISTING `test:pr106e` "file-and-approved gating" failure
(untouched `lib/badgeFacts.ts`, see the previous section). No browser was
driven; live checks were HTML fetches.

- **1 Verified banner, once.** `lib/verifiedBanner.ts` `firstVerifiedVisit()`
  reads `verified_banner_seen_at` through the service role; null + verified →
  the dashboard renders `components/tutor/VerifiedOnceBanner.tsx` (3 s, then a
  350 ms fade, then the space collapses over 300 ms) and `after()` stamps the
  column once the response is sent — so a second device never sees it. A failed
  select (column absent) reads as "seen", so nothing repeats if the migration
  were missing. Tutors verified before the migration were backfilled and never
  see it.
- **2 Popular searches at the END of both Browse pages** — after the list and
  the load-more footer; directly under the search bar there is only the list
  (or the skeleton cards). This reverses the previous PR's placement on the
  owner's instruction.
- **3 One unread number.** `unreadMessageCount` (lib/messaging, React-cached per
  request) now counts from `messages` — in the member's threads, sent by someone
  else, `read_at` null, not deleted-for-me, not withheld — AND only when the
  sender still exists and is neither paused (suspended) nor banned; plus the
  Team channel's unread. The header icon, the dashboard Messages tile's BIG
  NUMBER (was the conversation count) and its red badge all read it; at 0 the
  tile shows 0 and no badge/dot anywhere. Both dashboards. `conversationCount`
  stays exported but is no longer the tile's number. **Read-only SELECT (step
  3):** there are TWO "Ali Sabeer" tutor accounts (`bbf2587a…`,
  alisabeer3286@gmail.com; `8127b7c1…`, info2khan@gmail.com); both had **0**
  unread peer messages and 0 Team unread; nothing changed.
- **4 Applications tile subline.** "N applied · M number(s) viewed" — N =
  applications created this UTC month (withdrawn ones included; no refund), M =
  `contact_reveals` rows this month; "N applied" alone when M = 0. The big number
  and the quota rule (`quotaCounter`, the Get-more link, `ent.quota*`) are
  untouched.
- **5 Why Apply is inactive.** One pure rule, `lib/applyBlock.ts`
  `applyBlockFor()` — applied → quota → doc-rejected → closed, first wins — and
  one server loader, `lib/applyBlockServer.ts` `applyBlocksFor()`, used by the
  Browse first window + its load-more route, the tutor jobs board + its route,
  the saved-tuitions list and the tuition page. `components/ApplyReasonLine.tsx`
  renders the line (English + Urdu): "You applied on <date>" (formatDate, the
  cards' format), "You've used all N for this month · Upgrade" (the existing
  upgrade sheet via `UpgradeTrigger reason="tutor_apply_quota"`, no price; an
  "Unlimited" plan never surfaces its real cap), "Re-upload your document to
  apply again" (link to the re-upload screen), "This tuition is closed". The
  card and the panel pass `applyBlock`; after a successful apply in-session the
  line reads today's date. Note: the tuition page already hides the Apply panel
  for a non-open tuition and shows its own status banner, so the "closed" line
  mostly appears on a stale load-more window.
- **6 "Applied" readability.** `CardActions` no longer forces `disabled:opacity-60`
  on every action; an action may set `solidDisabled` and keep its own disabled
  colours. The Apply action (card) and the panel button use `bg-gray-200` +
  `text-slate-800` when disabled (≈12.6:1, AA), so "Applied" and its icon read in
  daylight. Other actions keep the 60% dim.
- **7 Never repeat the city.** `lib/place.ts` `placeLabel(area, city)` strips a
  trailing city from the area ("Bahria Town Lahore" + Lahore → "Bahria Town,
  Lahore"; a lone direction/qualifier remainder such as "North Karachi" is kept
  whole). Used by `jobDisplayTitle` (card titles), the card's location row, the
  tuition page "Where" fact, both applications pages, the tuition-match
  notification + email, the AI composer's `placePhrase`, and the AI prompt now
  says never to repeat the city. Tested in `npm run test:place`. **Data step:**
  36 stored tuitions carried "<City>, <City>" in the title or description (the
  23 curated cities, case-insensitive); the exact doubled form was replaced by
  the single city in those rows only (`scripts/dataop-dedupe-city.ts`), and the
  re-run SELECT returned 0 rows. Slugs/URLs untouched. (No curated area, job
  area or tutor area ends with its own city, so the builder change alters no
  stored location field — only how text is composed from now on.)

## Blog publishing settings and blog SEO (owner, 5 Oct 2026)

Blog only — tuition, tutor-profile and Browse SEO untouched; no post deleted or
unpublished. Migration 136 (additive: `posts.approved_at`, `approved_by`,
`numbers_checked`, `review_by`; applied live BEFORE the deploy; the four already-
published posts backfilled as approved; the O/A Level Oct–Nov 2026 post given
Review by 30 Nov 2026). Gates at close: tsc 0 · next build 0 · check:contrast
118 · test:blogapproval 6 · test:blog 58 · the pre-existing `test:pr106e`
failure only. No browser was driven; live checks were HTML fetches and a
database-scheduled test post.

**Audit (read-only, production, 5 Oct 2026).** Four posts, all published, none
scheduled or draft: cost-hiring "Grade 9 & 10 - Science English tutors in
Lahore…" (359 words, 5 internal links, 9 Sep); safety-trust "Keeping messages
useful…" (305 w, 0 links, 14 Sep); cost-hiring "Grade 9 & 10 - Science Physics
tutors in Islamabad…" (595 w, 4 links, 20 Sep); boards-exams "O and A Level
October–November exam prep, 2026" (629 w, 5 links, 25 Sep). Search Console's 11
URLs = these 4 + /blog + the cluster filter pages. **Near-duplicate pair
(reported, unchanged):** the Lahore/English and Islamabad/Physics posts differ
only by city + subject. **Publishing flow as it was:** `SCREEN_ACCESS.blog` and
`blogPublish` both admitted admin AND operations, so operations could publish;
publish required a saved human edit + the Reviewed tick (`canPublish`); AI
drafts land as `draft` and never auto-publish; scheduling existed but the
due-post sweep ran only in the 03:00 daily cron.

- **2 Cluster pages.** `/blog?cluster=…` still works; its metadata canonicalises
  to `/blog` and carries `robots: noindex, follow`. The sitemap never listed a
  `?cluster=` URL (only `/blog` and the post URLs) — confirmed, nothing to remove.
- **3 Approval on the server.** `blogPublish` is `['admin']` (owner implicit) and
  a new `blogApprove: ['admin']`; operations keeps `blog` (draft/save/Reviewed)
  only; `tuitions_staff` is in none, so every blog route 403s it. The route's
  `publishProblems()` prepends "A manager or owner must approve this post first"
  when `approved_at` is null, so publish AND schedule refuse without approval
  regardless of the UI. `approve` requires Reviewed + `numbersChecked: true` and
  writes `approved_at/approved_by/numbers_checked` + `blog.approve` audit. A save
  of a non-live post clears approval (the approver approved the words they read).
  `publishDuePosts()` only publishes scheduled rows with `approved_at`.
- **4 Scheduling + cadence.** Editor: "Publish now" and "Schedule (date and time,
  Pakistan time)"; the field is typed in Asia/Karachi and converted by
  `pakistanLocalToIso`, whatever the browser zone. The 5-minute PayPro cron now
  also runs `publishDuePosts()` (independent of PayPro config), so a scheduled
  post goes live within ~5 minutes; the daily cron keeps its call. Sitemap:
  `publishedSlugs()` is `status='published'` only, so scheduled posts appear
  only once live. Admin blog page: "Published this week: N" (Pakistan-time week,
  Monday start) and, when published + scheduled in the week reach 3, the warning
  "Two posts a week works best for Google." — also returned by publish/schedule
  and shown in the editor. Warn only.
- **5 Near-duplicate warning.** `lib/blogApproval.ts` `similarPosts()` strips
  city names (location_cities), subject names (taxonomy_subjects) and grade
  words, and compares the skeleton; the save and approve responses carry
  `similar: [{id,title,slug}]`, which the editor shows naming the post. Warn only.
- **6 No invented numbers.** Both branches of the AI figure rule now end "NEVER
  invent fees, statistics, counts or percentages." The editor's "Numbers in this
  draft" panel (`numberClaims()`: every Rs/PKR amount, percentage, and
  "N tutors / tuitions / parents…" claim, with context) sits above the
  publishing checklist; "Numbers checked" must be ticked to Approve and the server
  refuses `approve` without it.
- **7 Review by.** Optional date in the editor sidebar; `needsReview()` (past the
  date, Pakistan time) shows a "Needs review" badge in the admin list. The post
  stays live. Set to 30 Nov 2026 on the exam-prep post by the migration.
- **8 Open tuitions in every post.** `components/blog/OpenTuitionsBlock.tsx`
  after the CTA: up to 3 open tuitions by city+subject → city → subject →
  newest 3 (never an empty block; renders nothing only if the whole board is
  empty), then "See all open tuitions in <city>" → `/browse/tuitions?city=`.
  Cards use the existing gated Apply (`applyBlocksFor` for a tutor); no plan
  prices anywhere.
- **9 Structured data.** `articleJsonLd` now emits `mainEntityOfPage` as a
  WebPage and an inline publisher `{Organization "TutorMint", url, logo
  ImageObject 1200×630}`; headline, description, image, datePublished,
  dateModified (updated_at) and the existing Organization author credit are
  unchanged; BreadcrumbList kept; the canonical is self-referencing. Sitemap post
  `lastmod` is `updated_at` (was published_at).
- **10 Cluster balance.** A plain list of published posts per cluster on the admin
  blog page (all seven clusters, no targets).

**Live checks (HTML fetches, 5 Oct 2026).** `/blog?cluster=tutor-career` serves
`<link rel="canonical" href="https://www.tutormint.org/blog">` and
`robots: noindex, follow`; `/blog` keeps its own canonical with no noindex. The
sitemap has 0 `?cluster=` URLs and the four post entries carry `lastmod` =
`updated_at` (the exam-prep post: 2026-09-25T16:05:23Z, its last edit, not its
16:02 publish). The exam-prep post's Article JSON-LD carries headline,
description, image, datePublished, dateModified, `mainEntityOfPage` (WebPage),
the Organization author and the inline TutorMint publisher with logo;
BreadcrumbList has 3 items; the canonical is self-referencing. The open-tuitions
block renders "Open tuitions in Lahore" + `/browse/tuitions?city=Lahore` on the
Lahore post and "Newest open tuitions" + `/browse/tuitions` on the non-city
exam-prep post. **Scheduling, end to end:** a test post was inserted as
approved + scheduled for 10:48:17Z; at 10:48:19Z the live 5-minute cron
(`/api/cron/paypro-reconcile`, called with the cron secret) published it, its URL
returned 200 and it appeared in the sitemap; it was then set back to `draft`
(row kept, as instructed) — after which its URL renders the branded "not found"
shell with `noindex` and no content, but with HTTP **200**, a pre-existing
behaviour of `/blog/[slug]/not-found.tsx`, reported not fixed. Google's Rich
Results Test was NOT run (no browser here); the JSON-LD was parsed and checked
locally. The admin-only surfaces (Approve, Numbers checked, the cadence,
near-duplicate and Needs-review warnings, and a Tuitions-staff 403) rest on the
unit tests, the role matrix and the route gates — no admin session was driven.

## Hotfix — Message button on tutor cards and the tutor profile (owner, 5 Oct 2026)

No migration. The card already carried four actions (View Profile · Message ·
Demo · Shortlist, a 2×2 `CardActions` grid at every width); what changed is
the look, the gating, and the round trips.

- **Card (`components/TutorCard.tsx`).** Row 1 View Profile (black) | Message
  (navy `tm-navy`, `MessageCircle` icon); row 2 Demo (red) | Shortlist (outline).
  `messageAllowed` = the surface's `showMessage` AND viewer not a tutor (another
  tutor's card or their own) AND the tutor not under review / suspended (two new
  optional card fields; directory rows never carry them). Profile page
  (`ProfileActions`) got the same navy button with the chat icon; it already hid
  for a tutor viewer (`canMessage`) and for an under-review tutor (the page
  suppresses the whole bar).
- **Gating — same shape as Demo, one change.** Signed out → the existing
  `AuthGateModal('message')`, which keeps the draft `{tutorId}` and returns to
  the page after sign-up; on return the ONE card (or the profile) the draft names
  reopens the message flow (`peekDraft`/`clearDraft` — a list of cards peeks and
  only the matching card consumes it). Signed-in parent NOT verified →
  `canStartThread` now returns the existing `parent_verify` gate (this supersedes
  PR25 §4.1 for messaging only; demos unchanged) with its CTA pointing at
  `/parent/verify?next=/tutor/<slug>?message=1`; the verify page remembers the
  return target, shows "Back to your message" once approved (and auto-returns on
  a later visit when approval has landed), and the profile page's `?message=1`
  reopens the composer flow once. Verified parent → `/api/messages/thread`
  (find-or-create, unchanged) → the inbox thread, and the composer is focused via
  a one-shot `FOCUS_COMPOSER_KEY` flag the thread page consumes. Number masking
  untouched.
- **Limits stated.** Approval is a staff action later; the "back to your
  message" return therefore relies on the same browser session (sessionStorage)
  or the link on the verify page — the approval notification itself was not
  changed. No browser was driven: the signed-in flows rest on tsc + build +
  `test:messaging`/`test:authtrust`; the live checks are HTML fetches.

## Own card locked, Demo needs a verified parent, city rule on tutor cards and profiles (owner, 5 Oct 2026)

Items 1–7 of this instruction had already shipped earlier the same day (see
"Dashboard counts, Apply-button clarity, popular searches, verified banner, city
de-duplication" above — migration 135, commits 39db31b/d86d643) and were
re-verified live rather than redone; the read-only SELECTs were re-run: both
"Ali Sabeer" tutor accounts have 0 unread messages; the repeated-city SELECT
returns 0 (36 rows were fixed earlier); `demo_requests` holds 0 rows, so there
are 0 existing demo requests from unverified parents. NO migration here.

- **7, extended.** `areaWithoutCity()` now also shapes the area labels on the
  tutor card and the public tutor profile ("Bahria Town Lahore" under Lahore
  reads "Bahria Town"); the browse-filter hrefs keep the stored area value, so
  no link changes.
- **8 Own card locked.** `CardViewer` gained `id`; the Browse page and the
  parent-dashboard shortlist set it. When the signed-in viewer IS the card's
  tutor, `lockOwn()` renders all four actions (View Profile, Message, Demo,
  Shortlist) greyed out and disabled (`bg-gray-200 text-slate-600`, View Profile
  becomes a dead button) with "This is your profile, as parents see it." under
  the grid. The public profile's own-view bar (`ProfileActions`, `isSelf`) does
  the same for Shortlist / Request demo / Message instead of hiding the bar.
  Server rules: shortlist and message already refused self; the demo route now
  refuses `tutorId === user.id` too. Other tutors' cards are unchanged. Landing
  pages render cards as a GUEST (ISR), so a tutor's own card there is not
  locked in the UI; the server still refuses every self-action.
- **9 Demo requires a verified parent.** `/api/demo/request` returns the
  `parent_verify` gate (403) for a parent without the free `parent_verified`
  plan, with the CTA `/parent/verify?next=/tutor/<slug>?demo=1` — the same shape
  as Message. Both the card and the profile call it through `postGated`, so the
  verification sheet opens; a signed-out visitor gets the sign-in sheet with the
  `demo` draft kept and the one card/profile the draft names resumes the request
  after sign-up; `?demo=1` resumes it after verification; the verify page says
  "Back to your demo request" for that return. Verified parents are unchanged.
  Existing demo requests from unverified parents are untouched (there are none).

**Follow-up (54a89d5) and live checks.** The first deploy exposed one case the
builder had kept: an area whose own name ends with the city ("North Karachi")
rendered "North Karachi, Karachi" on a new tuition (TM-1654). `placeLabel()` now
shows such an area ALONE ("North Karachi"), never with the city; `test:place`
pins it, and the data step was re-run after the deploy: 1 row (TM-1654)
updated, 0 remain. Live, by HTML fetch: popular searches sit after the list and
the footer on both Browse pages; no repeated city on any tuition card; the
tutor card renders View Profile | Message (navy, chat icon) | Demo | Shortlist;
the profile's area list reads "Bahria Town" under Lahore; the demo route refuses
a signed-out POST with 401; `/parent/verify?next=…demo=1` serves. Not driven
(no browser or test accounts here): the own-card and own-profile locked view, a
signed-in parent's demo gate and return, the dashboard counts and the verified
banner — these rest on tsc, the build and the passing suites.

## Browse tutors cleanup — viewer-specific buttons, upsell audience, test-account pause, "Find tutors", rejected tutors hidden (owner, 5 Oct 2026)

Five items. Migration 137 (views + rank_tutors recreated from the LIVE
definitions, no column, no data change; applied live BEFORE the push, dry-run
first in a rolled-back transaction). Gates at close: tsc 0 · next build 0 ·
check:contrast 118 · test:authtrust 52 · every other offline suite green except
the PRE-EXISTING `test:pr106e` "file-and-approved gating" failure (untouched
`lib/badgeFacts.ts`, reported in the previous sections). No browser was driven
and no test account was signed in; live checks were HTML fetches.

- **1 Tutor viewing another tutor.** `TutorCard`: `otherTutorViewer` (signed in,
  role tutor, not own card) renders the View Profile action ALONE, and
  `CardActions` lays a single action out full width (`grid-cols-1`; two or more
  keep the 2-up grid). The profile page renders no `ProfileActions` bar for a
  tutor viewer who is not the owner (the own-profile locked bar stays). Server:
  `/api/shortlist` refuses a tutor account (403 "Tutor accounts cannot shortlist
  tutors."); `canStartThread` refuses a tutor → tutor pair before any plan or
  verification gate (403, no upgrade sheet); `/api/demo/request` already refused
  non-parents. Parents, signed-out visitors and the own-card lock are unchanged.
- **2 Upsell box audience.** The "See tutor contact details instantly … See
  parent packages" box is the parents-audience house creative of the
  `browse-inline` slot. `AdSlot` and `/api/ads/inline` now return nothing for a
  signed-in tutor on a parents-audience slot (decided where the ad is chosen, so
  no impression is recorded), and `MoreTutors` renders no inline box at all for a
  tutor viewer — no replacement. Parents and guests see it as before; the
  tutors-audience slot on /browse/tuitions is untouched.
- **3 Test accounts — SELECT, then pause.** Whole-word "test" (PostgreSQL
  `~* '\mtest\M'`) or exactly "New User" matched NINE: Test Parent (Tariq)
  11111111-…, Test Parent 22222222-…, Test Tutor 461016fc-…, New User 3487fd66-…,
  Test Ali 021c5cae-…, Test Tutor 2 cd4ba382-… (already paused 26 Sep),
  Tutor Test 5 d69aa5e8-…, Test Tutor 6 e48e5f40-…, Parent Test 6 8692d9c0-…
  (created 5 Oct). **Two have a successful payment and were SKIPPED, left
  active: Tutor Test 5 and Test Tutor 6** (both verified, fee paid, on Browse).
  `scripts/dataop-pause-test-accounts.ts` now matches the pattern, skips and
  lists paid accounts, and pauses the rest with the existing reversible pause
  (`is_suspended` + session revoke + tutor `verification_status='suspended'` +
  penalties/audit/timeline rows, open tuitions → `paused`), audited under the
  owner. RESULT (applied after the deploy, as ordered): the first --apply rolled back on a parameter-type error in the timeline insert (`$1` used as both uuid and text; fixed to a third parameter), nothing written; the re-run paused all SIX unpaid, not-yet-paused accounts — Test Parent (Tariq), Test Parent, Test Tutor, New User, Test Ali, Parent Test 6 — with 0 open tuitions to pause (none had any); the re-run SELECT shows 7 paused, 2 active (the two paid), nothing deleted.
- **4 Heading, subline, order, metadata.** `/browse/tutors` reads "Find tutors"
  (a subject filter keeps "<Subject> tutors"); the subline keeps the live count
  and appends "free to browse, no account needed" only for a signed-out visitor.
  Title "Find tutors in Pakistan | TutorMint" (or "Find <Subject> tutors …"),
  description "Find home and online tutors … Verified tutors listed first — real
  profiles, identity checks, video introductions …" — no claim that every tutor
  is verified. ORDER: `rank_tutors` tiers on the Verified-BADGE rule
  (`lib/badgeRule` mirrored in SQL: fee paid + CNIC/photo/selfie submitted + none
  blocked by a rejection), +10, so badge-holders lead and verification-in-
  progress follows, each group keeping the previous order (plan rank →
  completion → location → rating → daily rotation). The keyset cursor is the same
  shape. `rank_tutors` now RETURNS `fee_paid` and `verified_ok`; the card's
  "Not verified" chip reads `fee_paid` instead of inferring it from the tier.
  Dry run: SQL `verified_ok` agreed with the TS rule for 45 of 45 ranked rows.
- **5 Rejected tutors hidden.** Read-only SELECT before the change: TWO tutors
  carried a staff rejection — **Tanveer Hassan** (6ffe2384-…, CNIC + profile
  picture + selfie all rejected) and **Fareeha Jawed** (a936a093-…, selfie
  rejected); both were in the directory. Migration 137 adds to `tutor_directory`
  `verification_state / profile_pic_status / selfie_status <> 'rejected'`, so
  Browse, `rank_tutors`, `search_suggest`, the city × subject landing pages,
  the blog embed, the shortlist cards and `listed_tutor_slugs` (the sitemap) all
  drop them from the one view; `tutor_visible_profiles` keeps its WHERE (the
  page renders) and the page's existing noindex rule already holds (a rejected
  document is not approved). Both views return NO `avatar_url` while
  `profile_pic_status = 'rejected'`, so every public surface shows the initials
  avatar; `hiddenAvatarTutorIds` applies the same rule to the direct readers
  (inbox counterpart, social banner, CV). Reverses by itself when the re-upload
  is approved. Own dashboard/Settings and admin views read the base tables and
  are unchanged; the admin tutor list shows "Not listed · A document was
  rejected" via the new `document_rejected` blocker (`directoryBlockers`, fed by
  entitlements, directoryStatus and the admin queue). Directory 47 → 45 on
  apply; 0 rejected rows remain listed.

**Live checks (HTML fetches, 5 Oct 2026).** `/browse/tutors` signed out: `<title>Find tutors in Pakistan | TutorMint</title>`, description "Find home and online tutors in Pakistan. Verified tutors listed first …", `<h1>` "Find tutors", subline "45 tutors · free to browse, no account needed", no "Verified tutors" heading; the first cards are Ali Sabeer then Annie (both Verified-badge holders, tier 10) and the first card still carries View Profile | Message | Demo | Shortlist; the parents house box ("See tutor contact details instantly") is present and `/api/ads/inline?audience=parents` returns it for a guest. Test accounts: Test Parent, Test Tutor, Test Ali, New User, Parent Test 6 absent from Browse; Tutor Test 5 and Test Tutor 6 (paid, skipped) still listed. Rejected: Tanveer Hassan and Fareeha Jawed absent from Browse; `/sitemap.xml` lists 1 tutor URL and neither of them (and no test-account slug); `/tutor/tanveer-hassan-tutor` is HTTP 200 with `robots: noindex, follow`, the branded default og:image, no `<img>` and the "TH" initials disc; `/api/search/suggest?q=tanveer` returns no suggestions. Signed-out POSTs to `/api/shortlist` and `/api/messages/thread` answer 401. **Not driven (no browser, no test session):** a signed-in tutor's view of another tutor's card (View Profile only, full width), the absent profile action bar, the absent upsell box, the count-only subline, and the 403s for a tutor's shortlist/message — these rest on tsc, the build, the role-gated code paths and the unit tests.

**Reported, not changed.** The TypeScript listing mirror (`directoryBlockers`)
still lists the step-1 gates (mobile, city, area, subjects, gender) that
migration 124 removed from the view, and does not know `hidden_from_public`
(migration 126) — pre-existing drift; the dashboard's "listed" flag reads the
view itself, so it is cosmetic in the fix list only.

## Hotfix — forgot password by SMS code, email optional in onboarding (owner, 5 Oct 2026)

No migration. Gates at close: tsc 0 · next build 0 · check:contrast 118 ·
test:authtrust 55 · test:completion 5 · test:tutorflow 11 · test:delivery 19 ·
every other offline suite green except the PRE-EXISTING `test:pr106e`
"file-and-approved gating" failure. No browser was driven; the live checks
were HTML fetches and signed-out POSTs to the reset route with a NON-MEMBER
number (so no SMS could be sent).

- **1 "Forgot password?" on sign-in.** A small right-aligned link under the
  password field (`LoginForm`), replacing the centred "Forgot your password?"
  line that sat below the Sign in button. The screen keeps heading, fields and
  buttons only.
- **2 Reset by SMS code — three screens, separate rules.** `/forgot-password`
  (mobile, the default; the email tab stays and both options are always
  offered, because the form cannot know an account's channels without first
  being told who they are): (1) Mobile number → Send code; (2) "Enter the code
  sent to your mobile" with the shared `OtpCodeEntry` boxes → Continue; (3) New
  password + Confirm password → Save password. `/api/auth/reset` has three
  actions — `request`, `check` (validates WITHOUT consuming, so the code stays
  good for screen 3 inside its 10 minutes) and `confirm` (consumes, sets the
  password, clears `must_change_password`, calls `revoke_user_sessions` so every
  other session on the account is signed out, then mints a session for this
  browser with the admin magic-link token the signup verify route uses). The
  form toasts "Password changed" and routes to the role dashboard; if a session
  could not be minted it says so and links to sign in.
  **Rules, in `lib/otp.ts`, keyed on purpose = 'reset' and touching nothing on
  the signup/verify path** (one code for life, no resend — unchanged):
  10-minute expiry (`RESET_CODE_TTL_MS`); 5 wrong tries lock it
  (`MAX_ATTEMPTS`, same as signup) but a locked reset code is replaced by
  requesting a new one; at most 3 reset codes per mobile per day
  (`RESET_DAILY_MAX`, every row counts); a new code consumes the old row first
  (the partial unique index needs that). Codes stay sha256-hashed.
  **Never a membership oracle.** A code is SENT only to a mobile that is
  VERIFIED on an account (`phone_verified_at` set); for any other number
  `sendOtp({ silent: true })` stores a DECOY row (`user_id` null, random hash)
  and dispatches nothing (`channel=decoy` in the log), so screen 2 and every
  error — wrong, expired, too many tries, daily limit — read identically for a
  member and a stranger, and a stranger's handset never receives anything.
  Every error is plain English + Urdu (`RESET_MESSAGES`); the daily-limit one
  carries a "Contact support · 0321 5872222" WhatsApp button. The existing
  per-IP buckets (`otp_send` 8/h, `otp_verify` 10/15 min) still apply.
- **3 Email optional in onboarding.** The tap flow's email screen reads
  "Email (optional)" (no Urdu); Next with the box empty continues (already the
  behaviour), a typed address is format-checked and gets the existing
  confirmation link, and the tutor continues without verifying. The gap flow's
  field label dropped its Urdu line (`FieldLabel` now takes an optional `ur`).
  **Email DID count before this change:** `calculateTutorCompletion` carried a
  16th item "Email address" (PR29 §4), so a mobile-only tutor who finished
  everything else was held at 93% and the dashboard checklist asked for an
  email. The item is REMOVED for tutors (15 items; `test:completion` pins that a
  complete tutor with only the synthetic mobile address is 100% and that a real
  email changes nothing). The Verified badge (`lib/badgeRule`: fee + CNIC +
  photo + selfie) and listing (`tutor_directory`) never read an email. The
  PARENT checklist still carries its email item (7 items) — outside this
  hotfix's scope, reported. Mobile remains required.

**Live checks (5 Oct 2026).** `/login` (mobile UA): exactly one "Forgot password?" link, placed between the password input and "Remember me"; the old centred line is gone; no explanation text. `/forgot-password`: heading "Reset your password", both tabs (By mobile / By email), a Mobile number field and "Send code", the old explanation paragraph and the "If that number has an account…" box gone. Screens 2 and 3 are client-rendered after a request, so they were not fetched as HTML; the three server actions behind them were driven live with a NON-MEMBER number (03001112233 — 0 profiles, confirmed by SELECT first), so no SMS could be sent: request → `{success:true}` 200 (the same next screen); five wrong codes → 4,3,2,1 attempts left, then 429 "Too many wrong tries. Please request a new code." with Urdu, and a sixth try stays locked; a new request cancels the locked code (the next wrong try is 400 with 4 left again); the fourth request in the day → 429 "You have reached today’s limit of 3 codes…" with Urdu and the wa.me/923215872222 support link. Expiry: an expired decoy row planted for a second non-member number → `check` answers 400 "This code has expired. Please request a new one." with Urdu. Every row the test left had `user_id` null (decoys — nothing dispatched; `channel=decoy`); all four test rows were deleted afterwards. **Not driven:** a real member's reset end to end (no SMS can be driven here) — the confirm path (password set, other sessions revoked, magic-link sign-in, dashboard toast) rests on tsc, the build and the identical mechanism the signup verify route uses live; the email tab was not changed and an email-only account's link is the same `resetPasswordForEmail` call as before; the onboarding email screen needs a tutor session, so its "Next with email empty" rests on the unchanged `submitEmail` (empty → `next()`) and the completion % on `test:completion`.

## Google Jobs and indexing, real 404s, sitemap cleanup, email optional for parents, one listing source (owner, 5 Oct 2026)

Migration 138 (additive: an `updated_at` trigger on `tutor_profiles`; applied
live before the push). Gates at close: tsc 0 · next build 0 · check:contrast
118 · EVERY offline suite green — 57 suites including `test:pr106e` — plus the
new live `test:directory:live` (68 accounts, 0 disagreements). No browser was
driven; live checks were HTML fetches.

**Audit (read-only, 5 Oct 2026, before any change).**
- Tuitions: open 582 · paused 48 (all 48 carry `paused_at`; 1 by an admin
  action, the rest by the daily auto-pause sweep — the data-op pause touched 0)
  · closed 34 · hired 0. Live pages: the open one (TM-1683) was 200, no robots
  tag, JobPosting present with `datePosted` and `validThrough` = +15 days; the
  closed (TM-1034) and paused (TM-1097) ones were 200, `noindex, follow`, no
  JobPosting. Item 2 was therefore already as specified (PR28/PR89): confirmed,
  not rewritten.
- Tutors (66 tutor-role accounts): 100% complete 1 · fee paid 5 · CNIC approved
  13 · photo approved 12 · selfie approved 12 · all three approved 11 · ALL
  conditions (100% + fee + three approvals) 1 · in the directory 45. Sitemap
  `/tutor/` URLs: 1, none noindex.
- Sitemap: 938 URLs — static 9 · tutor 1 · tuition detail 582 · tuition landing
  223 · tutor landing 119 · blog 4. Fetching every URL: 0 non-200; 11 noindex,
  all tuition landing pages (`/tuitions/lahore/grade-4-…`, `grade-5-…`) — the
  cached combination set said ≥ 3 while the page's own count had dropped below
  it after the auto-pause sweep.
- Landing combinations (live view): tutors 551 (1–2 results: 432 · 3+: 119);
  tuitions 642 (1–2: 358 · 3+: 284). There is no 0 bucket — the view only holds
  combinations with at least one listing.
- Noindex emitters: the auth/dashboard/account/admin surfaces (per-page robots),
  `/parent/[id]`, cluster-filtered `/blog`, `/membership-plans`, the two
  not-found pages, and conditionally the tutor profile (under review / not
  indexable), the tuition page (not open / fixture / thin) and the blog post
  (missing).
- SOFT 404s, the real finding: a fake tutor slug, a fake tuition slug and a
  missing blog post all returned HTTP **200** with `noindex` and the branded
  not-found body. Cause: `app/(site)/loading.tsx` (PR1's logo loader) is a
  Suspense boundary over every (site) page, so the response streamed as 200
  before `notFound()` ran (Next: "once streaming has started the status can't
  change"). The owner's draft blog post row no longer exists (only the 4
  published posts remain), so its URL is simply a missing post.

- **2 JobPosting only on live tuitions** — verified as built: `tuitionPublicState`
  emits JobPosting (with `datePosted` and `validThrough` = `coalesce(resumed_at,
  created_at)` + 15 days, plus hiringOrganization / employmentType / jobLocation /
  baseSalary) only for `open`; paused/closed/hired render 200, noindex, no
  JobPosting, with similar open tuitions; resuming restores it with a fresh
  validThrough. **Non-open tuitions are not in the sitemap at all** (item 6), so
  "lastmod updates on the status change" has nothing to update — the Indexing
  API notification (item 3) is the recrawl signal; reported, not altered.
- **3 Indexing API** — `lib/googleIndexing.ts`: `notifyUrlUpdated(url)` posts
  `URL_UPDATED` through `googleapis` with a service-account JWT, and
  `queueIndexingUpdate(job)` runs it in `after()` (detached outside a request),
  so no user action ever waits on Google. Wired at every status change:
  `createJob`, `createTeamJob` (published), `closeJob`, `resumeJob`,
  `hireApplicant`, the daily `pauseStaleTuitions` sweep (auto-paused) and the
  admin close/pause/resume action. Without credentials every call is skipped
  and ONE log line says so per process. **Setup for Alee:** (1) in Google Cloud
  enable the "Web Search Indexing API"; (2) create a service account and a JSON
  key; (3) in Search Console add the service account's email as an OWNER of the
  www.tutormint.org property; (4) in Vercel set `GOOGLE_INDEXING_CLIENT_EMAIL`
  (the service account email) and `GOOGLE_INDEXING_PRIVATE_KEY` (the JSON key's
  `private_key`; literal `\n` is accepted) and redeploy.
- **4 Real 404s** — `app/(site)/loading.tsx` is removed (the per-route
  skeletons for Browse, the dashboards and the inboxes stay), so `notFound()`
  returns a real 404 with the branded page and noindex for a missing/unpublished
  blog post, a non-existent tuition slug and a non-existent tutor slug. Retired
  tutor slugs keep their 308. A PAUSED (suspended), banned, hidden or unclaimed
  tutor whose slug still exists renders the branded not-found body with **200 +
  noindex** explicitly (`tutorSlugExists`), as before; a rejected tutor renders
  normally with noindex.
- **5 Tutor profile indexing rule** — unchanged and confirmed:
  `tutorProfileIndexable` (100% + fee + CNIC/photo/selfie approved, never seed
  or under review) drives both the page's robots and `listed_tutor_slugs()` (the
  sitemap); paused tutors are out of the views; rejected documents delist
  (migration 137); test accounts are seed/hidden/paused. **Lastmod:**
  `tutor_profiles.updated_at` was never maintained (no trigger, no app write),
  so lastmod equalled created_at — migration 138 stamps it on every update.
- **6 Sitemap = indexable 200s only** — landing pages: a city × subject with
  fewer than 3 results now RENDERS (no more 404) with `noindex, follow` and is
  left out of the sitemap; at 3 it is indexable and listed, automatically. Both
  the page and the sitemap read the LIVE combination set
  (`resolveLandingAny` / `liveLandingPagesUncached`), which removes the cache
  mismatch behind the 11 noindex sitemap URLs. The cached set still serves the
  link helper and the blog block. Sitemap before: 938 (static 9 · tutor 1 ·
  tuition 582 · tuition landing 223 · tutor landing 119 · blog 4). After:
  940 (static 9 · tutor 1 · tuition detail 584 · tuition landing 223 · tutor landing 119 · blog 4) — every one of the 940 fetched after the deploy returned 200 with no noindex (0 exceptions). The 11 noindex landing URLs are gone from the list; the sitemap grew only by the two tuitions posted since.
- **7 Email optional for parents** — the parent checklist drops its email item
  (6 items; a mobile-only complete parent is 100%, pinned in `test:completion`);
  the shared `EmailCard` heading reads "Email (optional)" (no Urdu) for parents
  and tutors alike. Confirmed by code: posting (`createJob`) gates on CNIC +
  address, messaging and demo requests on the free verified plan (`ent.plan`),
  and the parent Verified badge on `cnic_verified_at` — none reads an email.
- **8 One listing source** — `directoryBlockers` now mirrors the
  `tutor_directory` view condition for condition (role tutor, not suspended,
  not banned, not under review, verification not suspended/rejected, claimed if
  imported, not seed/team, not `hidden_from_public`, no rejected document);
  the step-1 items migration 124 removed from the view (mobile, subjects, city,
  area, gender) moved to `profileGaps`, a separate function, so no surface can
  mistake a nudge for a listing reason. Callers aligned: entitlements (`visible`),
  `loadDirectoryStatus` (blockers + gaps), the admin tutor queue, the plan clock
  (`isTutorListable` = view + no gap + fee), the onboarding verdict and fix list,
  and the admin moderation client no longer invents a listing blocker after
  clearing a mobile. `npm run test:directory:live` compares the mirror with the
  view for every account that has a tutor_profiles row and fails on any
  difference (68 checked, 0 differ).
- **9 test:pr106e** — the failing "file-and-approved gating" test grepped
  `picOk` / `selfieOk`, two locals PR106-H4 deleted when it moved the badge rule
  into the shared `lib/badgeRule` + `lib/tutorDocStatus` (and, by owner
  decision, dropped the approval requirement). The test now pins the rule where
  it lives — a status with no file reads as 'none', `docSubmitted` requires a
  present file, and the badge is fee + submitted + not rejected — without
  weakening it. Three more source scans still asserted pre-hotfix wording from
  earlier today ("Forgot your password?", "Your email", the verified line that
  moved into `VerifiedOnceBanner`) and were updated to the owner's new wording.

**Live checks (5 Oct 2026).** Open tuition TM-1683: 200, no robots tag, JobPosting with validThrough 2026-10-20 (posted 5 Oct + 15 days). Closed TM-1034 and paused TM-1097: 200, `noindex, follow`, no JobPosting. Fake tutor slug, fake tuition slug, a missing blog slug and the former scheduling-test post slug: HTTP **404** with noindex and the branded page. Rejected (Tanveer Hassan) and paused (Test Tutor) profiles: 200 + `noindex, follow`. Indexable tutor (Ali Sabeer) is the one `/tutor/` URL in the sitemap; Tanveer is absent. Landing pages with 2 results (`/tuitions/islamabad/nursery-kg-ii-urdu` and three siblings): 200 + `noindex, follow`, absent from the sitemap; `/tuitions/lahore/grade-4-mathematics` (back at 3+ live) is indexable and listed. The full sitemap (940 URLs, a sample far beyond 50) fetched: 940 × 200, 0 noindex. Parent completion without email: `test:completion` pins 100%. Full suite: every offline suite green including `test:pr106e`; `test:directory:live` 68/68 agree. **Not driven:** a real Indexing API call (no credentials are set — the skip-and-log path is what runs today), a real status change end to end through the UI, and the onboarding/Settings screens (no session).

## Google Indexing API — activation attempt (owner, 5 Oct 2026)

No migration. `lib/googleIndexingCore.ts` (pure, `npm run test:indexing`, 6
tests): `normalisePrivateKey` turns literal `\n` into real line breaks, leaves
real line breaks alone, strips wrapping quotes, and keeps only the PEM block
when a fragment of the JSON line (`private_key": "…",`) was pasted;
`normaliseClientEmail` extracts the address from the same paste shape;
`describeKeyShape` reports lengths, line count and PEM markers only — never
key material. `GET /api/internal/indexing-health` (Bearer CRON_SECRET, 401
otherwise; JSON only; no writes) reports `configured`, `token` ("ok" or a
short plain word), `metadata` (read-only getMetadata status for the newest
open tuition URL), `publish` (one URL_UPDATED, only with `?publish=1`), the
URL, Google's message, and — on a token failure — the key SHAPE.

**Result on the live site (three deploys, 153627a → 5d6db1d → the shape
diagnostic):** `configured: true`; the email variable held the JSON-line
fragment `client_email": "tutormint-indexing@…"` (now parsed to the bare
address); `token: "invalid key"` with `error:1E08010C:DECODER
routines::unsupported`; the key variable is **40 characters, one line, no
BEGIN/END markers** — not a PEM at all. A Google service-account JSON's
`private_key_id` is exactly a 40-character hex string, so the value pasted
into `GOOGLE_INDEXING_PRIVATE_KEY` is almost certainly `private_key_id`, not
`private_key`. **Stopped before `?publish=1`** (a token failure cannot
publish; the daily quota was not spent). Nothing to fix in code: once the
real `private_key` value (the long `-----BEGIN PRIVATE KEY-----…` string,
literal `\n` or real line breaks both fine) is set in Vercel and the project
redeployed, the same health URL proves it. No tuition status changed between
the first deploy (16:46Z) and this check, so no real notification path ran;
with both variables present the "skipped, no credentials" log line no longer
applies — a real call would log a warn with the same decoder error until the
key is corrected. Site smoke: `/`, one tuition page and `/browse/tutors` all
200.

### Indexing API — ACTIVE (5 Oct 2026, later the same day)

Alee's new service-account key file was read locally (never copied into the
repo) and both Production variables were replaced through the Vercel CLI with
the values on stdin (`vercel env add … production --force --sensitive`); an
empty commit rebuilt the site. The health check then answered `configured
true · token "ok" · metadata 404` (no notification history yet for the sample
URL) and, called once with `?publish=1`, `publish 200` — one URL_UPDATED
accepted by Google for an open tuition. The Indexing API is live: every
tuition status change now notifies Google through `queueIndexingUpdate`. The
used key file was deleted from Downloads. Site smoke: `/`, one tuition page
and `/browse/tutors` all 200.

## Tutor index rule = paid + approved; hard-delete of two test accounts (owner, 5 Oct 2026)

Migration 139 (applied live before the push): `listed_tutor_slugs()` drops the
100% requirement; `payments.user_id` becomes nullable and `payments.note text`
is added. Gates at close: tsc 0 · next build 0 · every offline suite green
(58 suites, including test:pr106e) · live `test:directory:live` 2/2 (68 accounts agree with the view;
68 tutors agree with the sitemap rule).

- **1 Index rule.** `tutorProfileIndexable` (lib/seo/indexable — the one shared
  rule the profile page's robots tag, `tutorProfileNoindex`,
  `tutorSitemapEligible` and the sitemap all read) is now fee paid AND staff-
  approved CNIC + profile photo + selfie; `completion` is accepted and ignored.
  Never indexable: seed/test fixtures and under-review profiles (the rule), and
  everything the directory view excludes — paused/suspended, banned, hidden, any
  rejected document (the sitemap is built on `tutor_directory`). The SQL mirror
  `listed_tutor_slugs()` matches, and `scripts/test-directory-live.ts` gained a
  second live test: for every tutor, `in tutor_directory AND
  tutorProfileIndexable(facts)` must equal membership in `listed_tutor_slugs()`.
  The dashboard's "Your profile is not on Google yet" prompt now keys on the
  approvals (not 100%) and points at the identity section. The Indexing API
  path is untouched and still receives tuition URLs only (`queueIndexingUpdate`
  is called with job rows alone). **Indexable tutors before: 1** (Ali Sabeer).
  **After the migration: 4** — Ali Sabeer (100%), Nabeel Anthony (62%), Test
  Tutor 6 (87%), Tutor Test 5 (87%); after the deletion below: **2** (Ali
  Sabeer, Nabeel Anthony).
- **2 Hard delete (one-time, approved by Alee).** Read-only SELECT first: exactly
  two accounts matched — Tutor Test 5 (d69aa5e8-…, mobile …203, created 3 Oct,
  active) and Test Tutor 6 (e48e5f40-…, mobile …501, created 4 Oct, active),
  both fee-paid with CNIC/photo/selfie on file and NO intro video. Linked rows:
  payments 2 (one Rs 199 PayPro fee each, approved), applications 1, messages/
  threads 0, shortlists 0, demo requests 0, uploads 11 `user_documents` (CNIC +
  selfie; no degree) and 24 storage objects (2 avatars, 22 identity-docs
  originals/previews), slug history 0, notifications 8, plus activity events
  53 / sessions 11, tuition access 4, usage counters 1, OTP 1, profile views 2,
  field history 27, member-timeline rows 80 (+53 target references), areas 9,
  subjects 46, auth identities 2 / session 1 / refresh token 1.
  `scripts/dataop-delete-test-tutors.ts` refuses unless exactly those two
  names match; with `--apply` it removes the storage objects through the
  Storage API, then in one transaction sets the two payments' `user_id` to null
  with `note = 'deleted test account'` (amount, `provider_ref` and dates
  untouched), deletes every other linked row explicitly, then deletes the two
  auth users. `admin_audit_log` rows naming the ids are KEPT (append-only by
  construction; 6 rows). The admin Payments queue shows a payment whose account
  is gone with the note in place of the name and "account deleted" in place of
  the email; revenue sums `payments` alone, so finance totals are unchanged.
  **Applied after the deploy:** 24 storage objects removed (2 avatars, 22 identity-docs); the 2 payments kept with `user_id` null and the note; 1 application, 11 documents, 8 notifications, 53 activity events, 11 sessions, 4 tuition-access rows, 1 usage counter, 1 OTP, 2 profile views, 27 field-history rows, 80 timeline rows, 9 areas, 46 subjects, the 2 tutor profiles and the 2 profiles deleted; both auth users deleted. Re-run SELECT: 0 accounts match the names and the only rows still naming the ids are the 6 kept audit-log entries. Kept payments after the change: TM-20261004093245-24066C and TM-20261004124851-86B1EB, Rs 199 each, PayPro, approved, dated 4 Oct 2026, note "deleted test account". Payment totals before and after are identical (approved 6 / Rs 1,194; pending 51 / Rs 10,949; rejected 2 / Rs 1,198; this month approved 6 / Rs 1,194).

**Live checks (5 Oct 2026).** The sitemap lists exactly two tutor URLs — Ali Sabeer and Nabeel Anthony — and both profiles return 200 with no robots tag. Annie (paid, not approved) and Esha Asghar (approved, not paid): 200 + `noindex, follow`, absent from the sitemap. `/tutor/tutor-test-5` and `/tutor/test-tutor-6`: HTTP 404, absent from the sitemap, Browse and the search suggestions. `/` and `/browse/tuitions` 200. **Not driven:** the admin Payments screen itself (no admin session here) — the note rendering rests on `loadPaymentQueue` (name falls back to the note, email reads "account deleted") and the build; the totals were verified by SQL.


## Payments label, site speed and images, Browse LCP, blog AI writer, SEO audit (owner, 6 Oct 2026)

Migration 140 (additive: `content_suggestions.source` CHECK gains `'career'`;
applied live before the push). Gates at close: tsc 0 · next build 0 ·
check:contrast 118 · every offline suite green (59 suites, incl. the new
`test:contentmix`, 9 assertions). No browser was driven; the live checks are
HTML fetches, `curl` header reads, two CRON_SECRET harness routes and mobile
Lighthouse 13.5 (headless Chrome, simulated 4G) run from this machine against
production.

**Read-only SEO audit (before any change; 975 URLs = the 940-URL sitemap +
`/`, `/browse/tutors`, `/browse/tuitions`, `/blog`).** All 975 returned 200,
none noindex. Titles/descriptions: 0 missing anywhere; duplicates only among
tuition details (25 title groups / 54 pages, 26 description groups / 59 pages —
the same family re-posting the same tuition, e.g. three "Home Tutor Required |
Grade 6 | Civil Lines, Karachi" posts) and nowhere else; every tuition detail,
landing page and tutor profile title is over 60 chars (the "— verified, no
commission | TutorMint" suffix) and every tuition detail description is over
155 chars (the whole public description). H1: every page has exactly one.
Heading order: broken on BOTH Browse pages, ALL 119 tutor landing pages, ALL 253
tuition landing pages and `/blog` (h1 → h3: the card headings) — fixed below;
clean on tuition details, tutor profiles, blog posts, static pages.
Canonicals: 972/975 self-referencing, 0 pointing elsewhere, 3 missing
(`/terms`, `/support`, `/privacy` — reported, not changed). Structured data
(975 pages): BreadcrumbList 973 instances, 0 errors; JobPosting 587 — 0
required-field errors, recommended `identifier` and `jobLocationType` absent on
all 587 and `baseSalary` on 16 (no budget); Article 4 — complete; FAQPage 1 —
complete; ItemList 372 — complete; Organization/WebSite — complete; Person 2 —
`jobTitle` absent on 1; Service 2 — no `name`/`description` (uses
`serviceType`; reported). Internal links (inbound from the crawled set): tutor
landing avg 54 (9 with 0), tuition landing avg 10.6 (74 with 0), tuition detail
avg 6.6 (155 with 0), blog post avg 1.5, tutor profile avg 1.5; the 20 most
linked are the chrome pages (974 each) then three team tuitions (~415 each,
via the "Newest open tuitions" blocks) and the Lahore Grade 7 landing pages
(~170); the 20 least linked are Lahore tuition landing pages at 0 (Robotics,
STEM, ICT, Art, Geography, History across grades). Landing overlap: 253 tutor
landing pairs share ≥80% of their cards (70 pairs 100% identical; 116 of 119
pages are in at least one such pair — the early-years grades of one city list
the same 4–8 tutors), 160 tuition landing pairs (20 pairs 100%; 126 of 253
pages). Blog: 4 posts, 1,029–1,787 words, 18–30 links each, all with complete
Article schema; the Lahore/English and Islamabad/Physics posts are a
near-duplicate pair. Fonts: the site loads NO web font (system stack), so there
is nothing to preload or swap. Legacy JavaScript: 0 items (Next 16's default
browserslist is already chrome/edge/firefox 111, safari 16.4). The one JS
finding: the 246 KB Supabase realtime client was in the initial scripts of
EVERY public page and 100% unused when signed out.

**1 Payments.** `PaymentsRefunds` heading reads "Payments" on both dashboards;
the "Refund sent: Rs … to your … — date" line is gone and a refunded payment
shows one small `Refunded` / `Partly refunded` tag (the existing `refundLabel`)
beside its name. Admin "Mark as refunded" is untouched. The no-refund POLICY
wording on Terms, FAQ, the packages page and the refund email is not the
dashboard label and was left (reported).

**3 Speed.** (a) `lib/supabase/clientLazy.ts` — the browser Supabase client is
a dynamic `import()`; `lib/taxonomy`, `lib/cityAreas`, `lib/jobTitles`,
`NotificationBell`, `UserMenu`, `ChatRequestButton` and the messages dock's
`useThreadChannel` load it on demand. The first deploy missed the thread hook
(the dock is in the (site) layout, so its static import kept the 252 KB chunk on
every page); the second deploy removes it. (b) The two Browse `loading.tsx`
boundaries are removed: with a boundary, Next streamed the page's metadata into
the BODY (Lighthouse SEO 92 — "no meta description" in head) and painted a
skeleton before the cards (the LCP swap). Without them the metadata is in
`<head>` and the cards are the first paint; the load-more skeletons and the
dashboard/inbox boundaries stay. (c) `browserslist` written explicitly in
package.json (chrome 111, edge 111, firefox 111, safari 16.4 — Next's default,
now visible). (d) Heading order: `TutorCard`, `JobCard`, `PostCard` and
`AdView`/`AdSlot`/`InlineAd` take `headingLevel`; Browse (first window + load
more), both landing kinds (first window + load more) and the blog index pass
`h2`; cards inside a titled section (tuition detail's "More open tuitions", a
post's "Newest open tuitions", dashboards) keep h3. Fonts/CSS: nothing to do
(no web font; one 15 KB stylesheet).

**4 Images.** `next.config.ts` `images`: remotePatterns = the Supabase host's
`/storage/v1/object/public/**` only, formats AVIF then WebP, `minimumCacheTTL`
31 days, `imageSizes` + 160 and 320. `components/Avatar.tsx` renders a PUBLIC
storage photo through `next/image` with `px` (largest drawn size), `sizes` and
`priority`; a data: URI, signed URL or foreign host keeps a plain `<img>` (never
handed to the optimiser). Card avatar 140 px (72 on phones), profile 144, the
dashboards' header 80, job-card parent 28; the first card on Browse tutors and
landing pages, the profile hero, the dashboard header and the public parent
card carry `priority` (preloaded). Blog cover (`[slug]`) is `next/image`
1200×630 with `priority` + `sizes` (reserves the box — CLS 0.145 → 0);
`PostCard` covers `fill` the fixed 16:9 box, first card `priority`. Live: the
optimised avatar answers `image/avif`, `Cache-Control: public, max-age=2678400,
must-revalidate`, srcset 16…1920w. Rejected photos stay hidden exactly as
before (the view returns no `avatar_url`).

**5 Browse tuitions LCP.** The first page was already server-rendered; the
boundary removal, the JS cut and the h2 cards are what move it. Mobile Lighthouse (13.5, simulated 4G, one run per page, before → after the second deploy): /browse/tuitions LCP **2.7 s → 2.2 s** (TBT 530 → 280 ms, SEO 92 → 100, a11y 98 → 100, perf 83 → 93). **The ≤ 2.0 s target is NOT met — 2.2 s, 0.2 s short**, reported honestly. The LCP element is the first card title (text); after the fixes the remaining delay is document weight: the first window is ~300 KB of HTML (176 KB markup — roughly 11 KB per card, most of it inline lucide SVG icons — plus 125 KB of React flight data that duplicates the card props), and on simulated 4G that download, competing with the page scripts, is what holds the first paint. The next lever is an icon sprite (one <svg><use>) for the cards and trimming the card props handed to the client, both outside this PR. Full table:
| page | perf | a11y | SEO | LCP | TBT | CLS | JS KB | images KB |
|---|---|---|---|---|---|---|---|---|
| / | 80 → 95 | 100 → 100 | 100 → 100 | 2.0 → 1.4 s | 770 → 260 ms | 0 → 0 | 259 → 196 | 10 → 8 |
| open tuition | 89 → 93 | 93 → 93 | 100 → 100 | 2.1 → 2.0 s | 290 → 180 ms | 0.121 → 0.121 | 283 → 219 | 10 → 8 |
| /browse/tuitions | 83 → 93 | 98 → 100 | 92 → 100 | 2.7 → 2.2 s | 530 → 280 ms | 0 → 0 | 275 → 277 | 10 → 2 |
| /browse/tutors | 81 → 91 | 98 → 100 | 92 → 100 | 2.6 → 2.4 s | 610 → 320 ms | 0 → 0 | 277 → 280 | 1545 → 22 |
| tutor profile | 98 → 100 | 92 → 92 | 100 → 100 | 1.8 → 1.4 s | 130 → 90 ms | 0 → 0 | 264 → 201 | 187 → 12 |
| blog post | 78 → 97 | 96 → 96 | 100 → 100 | 4.2 → 2.0 s | 150 → 150 ms | 0.145 → 0.006 | 282 → 219 | 107 → 19 |
| landing page | 96 → 93 | 98 → 100 | 100 → 100 | 2.0 → 2.1 s | 200 → 270 ms | 0 → 0 | 281 → 283 | 253 → 10 |
The Browse pages' JS did not fall because their filter bars still fetch cities, job titles and the taxonomy through the (now lazily loaded) client on mount — the chunk is off the critical path but still downloaded during the page load; the landing page's 2.0 → 2.1 s and 96 → 93 are within single-run variance (same JS, same images). The open-tuition page's CLS 0.121 is unchanged (the <dl> facts block; its cause is not an image) and pre-existing.

**6 Blog AI writer.** (a) Live test, on production, through
`/api/internal/blog-draft-test` (CRON_SECRET; the same `buildBlogBrief`,
`generateBlogOutline`/`generateBlogSection`, `sanitizeDraft` and
`collectBlogProblems` the editor runs, because no admin session exists here):
title "How to become a home tutor in Pakistan: a step-by-step start", cluster
tutor-career, audience tutors, no notes. Result: works — outline + 6 sections
in 78 s wall-clock (sections 6–10 s each), **1,608 words, 7 H2 sections, 5
internal links** (`/browse/tuitions`, three `/tuitions/karachi/…` landing
pages, one blog post), 0 untraced figures; the "Before publishing" list it
would show: one fact contradiction in the FAQ ("Can I message parents
directly?" — basic tutors reply only) and three link-TEXT rule hits (the
tuition-landing links read "Grade 3 Mathematics" instead of "… tuitions"). The
editor's own flow regenerates a contradicting section once; the harness does
not. Saved as DRAFT (not reviewed, not approved; author = the owner account;
audited `blog.generate_test` naming the harness): `/admin/blog/f7870866-c3d6-4a75-b746-ca29f0b2a370`.
(b) Search Console: `lib/contentQueue/gsc.ts` reads the last 28 days of
query×page rows for `https://www.tutormint.org/` with the Indexing service
account under the read-only Search Console scope; rows at position 8–20 with
≥3 impressions become topics (`lib/contentQueue/mix.ts` — cluster/audience
inferred from the words, the query as the title, the figures as evidence never
as notes). **Live: the API call is refused — "Google Search Console API has not
been used in project 440435768327 before or it is disabled"**; the queue falls
back to its other sources and logs once, as specified. OWNER ACTION: enable the
Google Search Console API for that Cloud project (the service account is
already an owner of the property); the next nightly rebuild then picks it up.
(c) Mix: `lib/contentQueue/careerTopics.ts` — 20 evergreen tutor-career titles
(distinct skeletons, numberless notes, audience tutors, source `career`);
`balanceMix` keeps every career topic and caps the rest so career ≈40% of the
content queue. (d) Dedupe: `dedupeTitles` drops any candidate whose
`titleSkeleton` (city/grade/subject words stripped — the editor's existing
near-duplicate rule) matches an existing post or suggestion, and keeps the
first of each shape among candidates; the search-gap and coverage templates are
therefore blocked by the rows already in the table. (e) Data step (after the
deploy): the 29 open "… tutors in <City>: fees and how to choose" rows set to
`dismissed`, reason `template variant` (SELECT first: 29; after: 0 open, 29
dismissed; nothing deleted). A rebuild then produced 20 career suggestions and
0 others (every search-gap candidate was a template variant; no calendar window
is within 42 days; Search Console unavailable). (f) Links: `linkRuleViolations`
requires 3–5 links each once, ≥1 to a live tuition/landing page
(`/tutors|tuitions/<city>/<x>`), ≥1 to another post or an indexable tutor
profile (`/blog/<slug>` or `/tutor/<slug>` — the sitemap's `listed_tutor_slugs`
set, offered in the Link picker and to the AI); `/membership-plans` is no
longer required, offered or steered to (still a valid page); `/faq` optional.
`sanitizeDraft` adds the two required links when missing (`landingLinkText`
builds text that passes the text rule). (g) Related landing pages: ranked by
match with the post's city and subject (both, then subject, then city, then by
listings — never alphabetical) in the editor picker and the public post block
(`rankLandingOptions`). (h) Length: `BLOG_MIN_WORDS` 900, `BLOG_MAX_WORDS`
1,500, `BLOG_WARN_WORDS` 800 — the editor shows an amber "under 800 — aim for
900–1,500" beside the live count (warning, never a block); sections are asked
for 150–250 words. (i) Audience: the Tutors option already existed; choosing
the Tutor career cluster now sets it, and the brief carries an explicit
AUDIENCE rule (tutor-facing "you"). The figure rules are unchanged (NEVER
invent fees, statistics, counts or percentages).

**Live checks (6 Oct 2026).** Every Browse, landing and blog page now carries h1 → h2 …; tuition details, tutor profiles and posts keep h1 → h2 → h3; the meta description is in <head> on all nine checked public pages (it was streamed into the body on both Browse pages before) and no skeleton markup is served. An optimised avatar on Browse tutors answers image/avif with Cache-Control public, max-age=2678400, must-revalidate and a 16–1920w srcset including 160w and 320w; the blog cover and the profile avatar are preloaded; the first Browse card's avatar is eager. The 252 KB Supabase realtime chunk is absent from the homepage and the Browse pages' initial scripts (deploy 2). Status codes: the nine public pages 200 on phone and desktop UAs, a fake tutor slug 404. The content queue: 29 templated rows dismissed, 20 tutor-career topics suggested (100% career until Search Console is enabled — nothing else qualified), 0 pruned. The draft test left ONE draft (above). Not driven (no member/admin session here): the "Payments" heading and the Refunded tag on a member's dashboard, the editor's ranked related-landing list, the word warning, the Tutors audience default and the publish checklist — these rest on the source, tsc, the build and the unit suites.

**Reported, not changed.** The Google Search Console API is disabled in the
Cloud project (owner action above). Tuition detail a11y 93 (`<dl>` with wrapper
`<div>`s) and tutor profile a11y 92 (contrast/target size on existing controls)
are pre-existing and outside this PR's items. `/terms`, `/support`, `/privacy`
carry no canonical. Tuition titles/descriptions exceed Google's display lengths
by construction (the suffix / the full description). The landing-page overlap
figures above are the directory's real state (few tutors per early-years grade),
not a bug.

## Inbox cleanup, city tuition-jobs pages, plain messages, PayPro reconciliation, SEO fixes, duplicate tuitions merge + prevention (owner, 6 Oct 2026)

Sixteen items in one PR (commit ff62877, follow-up 64928e4). Migrations 141 (`jobs.merged_into`,
`merged_at`, `refreshed_at`, `bumped_at` — backfilled from
`coalesce(resumed_at, created_at)`, 0 nulls of 690 — `duplicate_of`,
`duplicate_reason`) and 142 (`reconciliation_imports`, `reconciliation_rows`,
`bank_transfers`; admin-read RLS, service-role writes), both applied live
BEFORE the deploy. Gates at close: tsc 0 · next build 0 · check:contrast 118 ·
all 61 offline suites green (new: test:duplicates 6, test:reconciliation 9;
test:pr106e repointed at the removed Quick-replies block). No browser was
driven; live checks were HTML fetches, signed-out API calls, a full sitemap
crawl and mobile Lighthouse.

**Order followed, as instructed:** read-only checks → code → additive
migrations → deploy → the data step (item 15) against production.

### 1–5 Inbox

`components/messages/InboxShell.tsx` + `ConversationList.tsx`: the Quick
replies block (and its editor import) is gone and the composer receives an
empty list; the search bar is the first thing in the pane, above every row;
the **TutorMint Team** thread is an ordinary row pinned first under the search
bar, inside the scroll pane, and counted (`empty = rows.length === 0 &&
!showTeam`), so "No conversations yet" appears only when there is truly
nothing; the black "Find tuitions to apply for" button and the "Check your
profile is complete" card are removed (a verified tutor's empty state has no
actions; an unverified one keeps only "Get verified"). Source-verified only
(an inbox needs a session).

### 6 City pages — `/tuition-jobs/[city]`

`lib/cityJobs.ts` (server-only; `CITY_PAGE_THRESHOLD = 3`) reads every open
tuition (paged past the 1000-row cap) and derives, per city, the count and the
variants: `/female` (gender preference female), `/online` (job title Online
Tutor), `/[area]` (one per area with 3+). **`/part-time` was NOT built** — no
field on `jobs` records part-time reliably (days/times are free text), so the
page would have been a guess; reported, not invented. Rendered by
`components/tuitionJobs/CityJobsView.tsx`: H1 "Tuition jobs in <City>" (variant
headings "Female tutor jobs in …", "Online tuition jobs in …", "Tuition jobs in
<Area>, <City>"), an intro that states the LIVE count in a sentence, variant
chips, every open tuition newest-first (`bumped_at`) with Load more
(`MoreJobs`, no ads — `adEvery` is unreachable), ItemList + BreadcrumbList
JSON-LD, self canonical, `seoTitle` ≤60 / `seoDescription` ≤155, `socialMeta`.
Under 3 results the page renders with `noindex, follow` and is left out of the
sitemap; 0 results → 404. **Linked from** the footer "For Tutors" column (up
to 5 "Tuition jobs in X"), the `/browse/tuitions` header strip, the homepage
under the two buttons ("Tuition jobs by city" — link targets only, the locked
layout untouched), and every tuition page's breadcrumb (the city crumb now
points at `/tuition-jobs/<city>`). Live: `/tuition-jobs/lahore` 200, H1
"Tuition jobs in Lahore", ItemList present, canonical self, in the sitemap;
`/tuition-jobs/gujranwala` (2 open) 200 + `noindex, follow`, absent from the
sitemap; sitemap carries **57 city-page URLs** (Karachi, Lahore, Islamabad,
Rawalpindi + their female/online/area variants).

### 7 Plain messages (44 files)

Every vague error, toast, empty state and blocked message a member can see is
plain English with a short Urdu line (`Toast` renders `whitespace-pre-line`
so the Urdu sits on its own line). Before → after:

| Before | After (Urdu line follows each) |
|---|---|
| "Something went wrong. Please try again." | "That did not save. Please try again, or message us on WhatsApp 0321 5872222." |
| "That did not work. Please try again." | "That did not go through. Please try again, or message us on WhatsApp 0321 5872222." |
| "Network error. Try again." / "Could not reach the server." | "We could not reach TutorMint. Check your internet connection and try again." |
| "Sign in first." / "You must be signed in." | "Please sign in first, then try again." |
| "Server is not configured." | "This is not working right now. Please try again in a few minutes, or message us on WhatsApp 0321 5872222." |
| "Unknown action." | "That request was not understood. Reload the page and try again." |
| "Invalid request." | "Something in that request was missing. Reload the page and try again." |
| "Something went wrong." (demo inbox) | the "did not save" line above |
| "Not found." (conversation) | "This conversation is not available. It may have been removed, or it is not yours. Go back to your inbox." |
| "Not allowed." (bank QR) | "Bank transfer is not open for your account yet. Use the payment page instead." |
| "Not found." (bank QR) | "The bank QR code is not available right now. Use the account details on the payment page." |
| "Not allowed." (receipt) | "Only the person who sent this payment, or an admin, can open its receipt." |
| "Not found." (receipt) | "This receipt is not available. It may not have been uploaded yet." |

New messages added by this PR (duplicate check, Refresh limit, merge refusal)
were written bilingual from the start. Left as they were, being already plain:
"Sign in to apply." and the receipt route's "Sign in required.".

### 8 PayPro reconciliation — admin → Payments → Reconciliation

`lib/reconciliationCore.ts` (pure, `test:reconciliation` 9) + `lib/reconciliation.ts`
(I/O) + `/api/admin/payments/reconciliation` + `/admin/payments/reconciliation`
(linked from the Payments header). Upload the PayPro Orders export (.xlsx sheet
"Orders" or .csv); the eight columns are found BY NAME whatever the case or
spacing (Order-Number, Transaction Status, Payment Via, Order-Amount,
MerchantShare, Date Paid, Settle-Date, Settle-Status); the totals row is
skipped; rows match our `payments.provider_ref` on Order-Number (trimmed,
case-insensitive). Flags: **PAID in PayPro but not approved here**, **approved
here but not PAID in PayPro**, **amount differs**. Bank transfers are recorded
by hand (date, amount, reference, last 4 digits only) or by CSV. The period
summary shows collected (sum of PAID Order-Amount), expected (sum of PAID
MerchantShare), transfers received, and the difference owed — red when PayPro
owes us. It **never changes a payment status** and **stores no customer name,
mobile or email** (only the eight columns). **Roles:** the instruction said
"owner and finance" — the finance role was deleted on 14 Sep (migration 83),
so the screen is `SCREEN_ACCESS.reconciliation = ['admin']` (owner implicit);
reported. The sample `scripts/fixtures/paypro-sample.csv` (5 orders + a totals
row, two real TM order numbers) is what the tests parse; the screen itself was
not driven (admin session).

### 9–11 Canonicals, title/description limits, structured data

- `/terms`, `/support`, `/privacy` each carry a self canonical (live-checked).
- `lib/seo.ts`: `TITLE_MAX = 60`, `DESCRIPTION_MAX = 155`; `seoTitle()` drops
  "— verified, no commission" everywhere and appends "| TutorMint" only when
  it fits, else word-clamps; `tuitionDescription()` builds the description from
  FIELDS only (level, subjects, area, city, job title, budget band), never the
  free text. Applied to tuition details, both landing kinds, tutor profiles
  and the new city pages. Crawl of every sitemap URL: titles over 60 **961
  → 0**, descriptions over 155 **623 → 2 (/about and /faq, static pages outside item 10's scope)** (of 975 →
  722 indexable pages).
- JobPosting gains `identifier` (`PropertyValue`, name TutorMint, value the TM
  number); an Online Tutor tuition gains `jobLocationType: TELECOMMUTE` +
  `applicantLocationRequirements` (Country Pakistan); `baseSalary` wherever a
  budget band exists. **16 open tuitions have no budget band and so no
  baseSalary:** TM-1200, 1233, 1295, 1377, 1389, 1390, 1391, 1392, 1393, 1396,
  1397, 1454, 1556, 1560, 1566, 1595. Person gains `jobTitle` (the headline,
  else "<Subject> tutor"); Service gains `name` ("<Subject> tutoring in
  <City>") and `description`; the tutor JSON-LD is a two-node `@graph`.
  Live-checked on TM-1710 (identifier) and an online Karachi tuition
  (TELECOMMUTE).

### 12 Similar tuitions on every tuition page

`similarOpenTuitions()` now fills up to 6 by city → city + level
(`class_levels` overlap) → subject, on every tuition page (open or not). The
breadcrumb city crumb and the Similar block together give every tuition page
inbound links from other tuition pages. It is NEIGHBOUR linking: the tuition just newer and just older in the same city (by `bumped_at`) are always included, then same city + level, then the rest of the city, then subject (follow-up commit 64928e4). Indexable tuition pages with **0
inbound links from crawled pages: 155 → 0** (target 0).

### 13 Near-duplicate landing pages

`lib/landingOverlapCore.ts` (pure, tested) + `lib/landingOverlap.ts`: two
landing pages of the same kind in the same city whose results are ≥80%
identical → the NARROWER (fewer results; ties by smaller master id) is
`noindex, follow` and out of the sitemap; the broader stays. Computed from live
listings on every request, so it re-checks itself. The read-only "before"
estimate was 112 of 119 indexable tutor landing pages and 120 of 188 tuition
landing pages affected — and that is what shipped: sitemap landing pages
**tutors 119 → 7, tuitions 188 → 67**. This is the owner's rule applied
exactly; the magnitude is reported so it can be revisited (most city×subject
pages in a two-city directory share the same few tutors).

### 14 CLS and LCP

CLS on the open tuition page was the unsized footer logo (`<img>` with no
dimensions); `Footer.tsx` and `Navbar.tsx` logos now carry width/height
classes. `public/icons.svg` (25 lucide symbols, 5.4 KB, built by
`scripts/build-icon-sprite.mjs`) + `components/Icon.tsx` replace inlined icon
paths on the tutor and job cards; `slimForCard()` trims card descriptions to
220 chars on list pages. Mobile Lighthouse (median of what ran):

| page | before | after (run 1) | after (run 2) |
|---|---|---|---|
| open tuition TM-1683, CLS | 0.121 | 0 | 0 |
| open tuition TM-1683, LCP | 2.0 s | 2.7 s | 1.8 s |
| open tuition TM-1683, perf | 93 | 92 | 96 |
| /browse/tuitions, LCP | 2.2 s | 2.0 s | 2.2 s |
| /browse/tuitions, perf | 93 | 95 | 94 |

CLS 0.121 → 0 met — the real cause was not the logo but the header `TimeAgo` swapping the server date for "2d ago" after hydration, which rewrapped the meta line at 360px; it now sits in a fixed-width box (follow-up commit 64928e4). **/browse/tuitions LCP ≤2.0 s: at the line, not reliably met** (2.0 s, then 2.2 s on back-to-back clean runs).

### 15 Merge of the duplicate tuitions (data step, production)

`scripts/dataop-merge-duplicate-tuitions.ts` read the xlsx "Repeats" sheet
(46 pairs), fetched facts read-only, applied `shouldMerge` (same title → merge;
combination-only with a different job-title segment → skip), and posted to
`/api/internal/merge-duplicates` (CRON_SECRET) — dry run first, then
`--apply`. **Search Console impressions could not be read: the Search Console
API is disabled in Cloud project 440435768327** (owner action to enable), so
every survivor is the OLDEST of its pair, as the rule specifies. **35 merged**
(repeat → survivor, reason):

- TM-1155 → TM-1153 (same title; survivor oldest)
- TM-1162 → TM-1143 (same title; survivor oldest)
- TM-1163 → TM-1143 (same title; survivor oldest)
- TM-1302 → TM-1296 (same title; survivor oldest)
- TM-1311 → TM-1308 (same title; survivor oldest)
- TM-1319 → TM-1307 (same title; survivor oldest)
- TM-1322 → TM-1142 (same title; survivor oldest)
- TM-1336 → TM-1175 (same title; survivor oldest)
- TM-1375 → TM-1193 (same combination; survivor oldest)
- TM-1377 → TM-1197 (same title; survivor oldest)
- TM-1397 → TM-1304 (same title; survivor oldest)
- TM-1420 → TM-1400 (same combination; survivor oldest)
- TM-1480 → TM-1459 (same title; survivor oldest)
- TM-1483 → TM-1482 (same title + same combination; survivor oldest)
- TM-1487 → TM-1367 (same title; survivor oldest)
- TM-1488 → TM-1464 (same title; survivor oldest)
- TM-1506 → TM-1441 (same title + same combination; survivor oldest)
- TM-1515 → TM-1476 (same title; survivor oldest)
- TM-1524 → TM-1284 (same combination; survivor oldest)
- TM-1559 → TM-1295 (same title; survivor oldest)
- TM-1561 → TM-1556 (same title; survivor oldest)
- TM-1563 → TM-1308 (same title; survivor oldest)
- TM-1564 → TM-1508 (same title; survivor oldest)
- TM-1566 → TM-1143 (same title; survivor oldest)
- TM-1576 → TM-1540 (same title; survivor oldest)
- TM-1584 → TM-1367 (same title; survivor oldest)
- TM-1605 → TM-1473 (same title; survivor oldest)
- TM-1631 → TM-1469 (same title; survivor oldest)
- TM-1647 → TM-1638 (same title; survivor oldest)
- TM-1650 → TM-1649 (same title + same combination; survivor oldest)
- TM-1651 → TM-1639 (same title + same combination; survivor oldest)
- TM-1664 → TM-1579 (same title; survivor oldest)
- TM-1666 → TM-1454 (same title; survivor oldest)
- TM-1668 → TM-1463 (same title; survivor oldest)
- TM-1673 → TM-1577 (same title; survivor oldest)

Each repeat: `status = closed`, `merged_into`, `merged_at`, out of Browse and
the sitemap, its URL a **308 permanent redirect** to the survivor
(`permanentRedirect()` — Next emits 308, the method-preserving permanent code
Google treats like a 301), Indexing API URL_DELETED queued. Each survivor: one
refresh — `resumed_at`/`bumped_at`/`refreshed_at` = now (fresh 15 days, pauses
21 Oct), URL_UPDATED queued. 35 `admin_audit_log` `job.merge` rows. Nothing
deleted: open 610 → 575, closed 34 → 69, paused 48 unchanged. **11 skipped** —
10 because the titles describe different jobs (combination-only matches):
TM-1297/1191, 1250/1172, 1253/1172, 1245/1215, 1268/1240, 1401/1258,
1402/1259, 1403/1260, 1481/1363, 1661/1653; and TM-1690/1641 is not a repeat
under the rule. **0 skipped for applications** (no repeat had any).

### 16 Prevention

- **Duplicate check at Post a tuition** (parents AND staff, the shared
  `PostTuitionForm`): `createJob`/`createTeamJob` call `findExistingDuplicate`
  (open or paused, same title or same city+area+level+subjects+gender+budget
  band) and answer 409 with the existing tuition; the form shows it with
  **Reopen this one** (default — resumes it if paused and goes to it) and
  **Post anyway** (staff must type a one-line reason, stored in
  `duplicate_reason` with `duplicate_of`).
- **Refresh** (`RefreshInline` on the tuition page for the poster/admin, plus
  the parent dashboard and admin job actions): top of Browse (`bumped_at`),
  fresh 15 days, same URL, URL_UPDATED; at most once per 3 days
  (`refreshAllowed`, 429 with a bilingual message naming the next date).
- **Safety net:** a repeat of an older open tuition emits no JobPosting and its
  canonical points at the original (`repeatOfOlderOpen`).
- **Admin → Duplicates** (`/admin/jobs/duplicates`, admin + operations;
  merging is admin): repeats grouped per staff for 7/30/90 days with one-tap
  "Merge into original" (refused when the repeat has applications). Staff
  activity shows "Repeated tuitions this week: N" per person.
- Browse ordering is now `bumped_at` (keyset cursor unchanged in shape).

### Not verified / stated plainly

No browser or test session was driven: the inbox, the duplicate modal, the
Reconciliation screen, the Duplicates view and the Refresh buttons rest on tsc,
the build, the unit suites and the live API refusals. The Indexing API calls
were queued through `after()`; a real URL_DELETED/URL_UPDATED acceptance was
not read back. `/tuition-jobs/<city>/part-time` was not built (no field).

## Tuition posting, Staff activity for Tuitions staff, Payment gateways (owner, 6 Oct 2026)

Commits c5e83e8 + 7d501ad. Migration 143 (additive, applied live before the
push): `gateway_events` (admin-read, server-written) and four `app_settings`
rows inserted only if missing. Gates at close: tsc 0 · next build 0 ·
check:contrast 118 · rls:audit 217/217 · all 63 offline suites (new:
test:tuitionpost, test:gateways; test:pr106g4b and test:pr106h2 repointed at
the new rules they replace). No browser or member/staff session was driven.

**17 Tuition posting (shared form, staff and parents).**
- Per-grade chips: `TaxonomySelector` `perGradeBulk` (the form passes it) shows
  "Select all" / "Clear all" for each selected grade; the rule is
  `lib/gradeSubjectBulk.ts`. Subjects are chosen BY NAME, so a subject offered by
  two selected grades (English in Grade 1 and Grade 2) is one choice — clearing
  it for one grade clears it for both, as unticking by hand always has.
- Title: `lib/tuitionTitle.ts` `buildTuitionTitle` →
  "Post type | Class | School or area | City" (post type = gender + Job Type +
  "Required", grades collapsed, city never repeated). "Write this for me"
  always uses it; Claude writes only the description now. An optional
  "School or academy name" field was added to the form; it is used to write the
  title and is not stored on its own.
- Page title: `tuitionPageTitle` keeps `<title>`/og:title ≤ 60 (drops the
  longest non-class middle parts — the school/area in the standard format —
  then shortens the post type; never mid-word). The H1 keeps the full title.
  Live: all 596 open tuition pages ≤ 60.
- Duplicate check: a same-title match counts only when the city AND area also
  match (`samePlace` in `lib/duplicatesCore.ts`); the combination rule already
  included the area. Read-only on production: 0 open/paused pairs share a title
  today, so this rests on the unit tests.

**18 Staff activity for Tuitions staff.** The role already had the menu entry.
It now sees every staff member's tuition-posting actions only — post, edit,
reopen, refresh, close, merge, and "Posted anyway after a duplicate warning"
with the reason (from `jobs.duplicate_of/duplicate_reason`) — via
`loadTuitionActivity`, whose audit-log query is bounded to
`TUITION_ACTIVITY_ACTIONS`. Its detail URLs redirect to the feed. Owner and
admin views are unchanged. **Aqsa Mughal's role is Operations, not Tuitions
staff** (the only Tuitions staff account is Nabeel), and Operations has no
Staff activity screen — reported, role not changed.

**19 Payment gateways** — `/admin/payments/settings/gateways`, owner only
(`SCREEN_ACCESS.paymentGateways = []`; the route answers 401/403 to everyone
else; fresh password required; every change audit-logged as
`payments.gateway`).
- Active gateway: PayPro; AssanPay shows "Not configured" and the server
  refuses to activate an unconfigured gateway. Switching asks for confirmation.
- Ways to pay: PayPro's API has no payment-method field, so **JazzCash,
  Easypaisa and card switch on and off together** as "Online payment on
  PayPro"; bank transfer (our own page) is separate; "Pay later" is its own
  toggle. At least one way to pay must stay on. Seeded to today's state:
  online on, bank transfer off, Pay later off. These switches are now the one
  authority for bank transfer and Pay later on every checkout surface (verify
  gate, upgrade sheet, onboarding fee step, membership plans, order page),
  replacing the staff-onboarding switch for that purpose; the checkout route
  refuses a switched-off method.
- Health per gateway: connected (env vars present), last successful payment,
  last error (recorded checkout failures, wrong-credential callbacks, or a
  declined payment), last callback (recorded from this deploy on), payments
  pending over 1 hour.
- Service fee: shown as "Set by PayPro" — PayPro's create-order API has no
  fee-bearer field; it only reports `IsFeeApplied` per order, which the screen
  shows from the latest order.

**Not driven (no session):** the chips, the AI title through the form, a
Tuitions-staff view, the owner screen's toggles and their audit rows, and the
server refusal of a switched-off method for a signed-in member — these rest on
tsc, the build, the unit suites and signed-out route checks.

## Clear form on Post a tuition; settlement check per payment gateway (owner, 6 Oct 2026)

Commit 0467b6f. Migration 144 (additive, applied live before the push):
`gateway_deductions` (admin-read, server-written, soft removal) and a
`gateway` column (default 'paypro') on `bank_transfers` and
`reconciliation_imports`. Gates: tsc 0 · next build 0 · check:contrast 118 ·
rls:audit 219/219 · all 64 offline suites (new: test:settlement 7; Clear form
added to test:tuitionpost).

- **Clear form** — a button at the top of the shared `PostTuitionForm` (create
  mode, so both /admin/jobs/new and the parent form) asks "Clear all fields?"
  (Clear / Cancel), then resets every field to `EMPTY`, clears the time slots,
  the saved draft (`clearFormDraft`) and any sign-in draft (`takeDraft('post')`).
  "Discard draft" stays. Nothing posted is touched.
- **Settlement check** — on each connected gateway card at
  `/admin/payments/settings/gateways` (owner only; `/api/admin/payments/
  settlement` and `/settlement/export` gate on `SCREEN_ACCESS.paymentGateways`).
  Rules in `lib/settlementCore.ts`, I/O in `lib/settlement.ts`:
  - TutorMint collected = approved payments for the gateway whose APPROVAL day
    (Pakistan time; `reviewed_at`) is in range; .xlsx download of date, TM
    reference, amount, method (PayPro's `paymentVia`) — no member details.
  - Gateway reported = MerchantShare of PAID rows (Date Paid in range) in the
    gateway's latest uploaded file (the existing PayPro importer); flags
    paid-not-approved, approved-not-paid, amount differences — listed only.
  - Deductions: per payment, the line in effect on that payment's day — per
    NAME, the latest effective date on or before it — so a new rate from a later
    date never rewrites earlier periods. Removal is soft (stops applying
    everywhere; row kept). Add/remove ask for a fresh password and are audited
    (`settlement.deduction_add/remove`).
  - Expected in bank = TutorMint collected − total deductions. Difference =
    bank transfers − expected; red when negative (money missing).
- **Reconciliation moved** — `/admin/payments/reconciliation` permanently
  redirects to the gateways screen; the nav item is gone; the Payments header
  link reads "Settlement check"; `SCREEN_ACCESS.reconciliation` is now owner
  only (it was admin + owner), and the old API route follows it. Its tables are
  kept (they held 0 imports and 0 transfers at the move).

**Live check, 1–6 Oct 2026:** 6 approved PayPro payments, Rs 1,194 (5
JazzCash, 1 Easypaisa); no gateway file or bank transfer stored yet, so the
difference shows Rs 1,194 missing. With the sample PayPro file (in memory, not
stored): reported Rs 1,549.09, 2 paid-not-approved (the sample's invented
orders), 5 approved-not-paid. A test line "Smoke test fee 3% + Rs 2" was added
(deductions Rs 47.82, expected Rs 1,146.18), then removed (back to Rs 1,194);
both in the audit log. A test transfer was computed in memory only — a stored
transfer cannot be removed and would count as real money in every later check.
No owner/admin/staff browser session was driven.

**Audit finding (item 3, read only):** "Bank transfer" was switched ON at
2026-10-06 13:37:02 UTC (18:37 PKT) and "Show a Pay later link" ON at 13:37:14
UTC (18:37 PKT), both by the owner account techguy3286@gmail.com ("Admin",
role owner). Both are still on.

## "Paid this month" tile; subjects per grade on Post a tuition (owner, 7 Oct 2026)

Commits b397da5 + 59fdd20 + bf4ce05. Migration 145 (additive, applied live
before the code): `jobs.grade_subjects jsonb` = `[{grade, masterIds}]`. Gates
at close: tsc 0 · next build 0 · check:contrast 118 · rls:audit 219/219 · all
64 offline suites (test:tuitionpost now 11).

- **Paid this month** replaces "Monthly re-subscribed" on Overview (same
  `payments` screen gate as the revenue tile). Distinct tutors whose fee
  (`plan_code='verified'`) was approved (`reviewed_at`) this Pakistan-time
  month; refunded rows and deleted accounts (`user_id` null) excluded; subline
  "N in the last 7 days". Rules in `lib/feePayersCore.ts`. It opens
  `/admin/payments/payers`: newest first, one row per tutor — name (→
  `/admin/users/[id]`), date paid, TM reference, document status (approved /
  waiting / rejected from CNIC + photo + selfie) and "Review documents" (→
  `/admin/tutors/[id]`). October at the time: **4** (Rida Saeed, Annie — paid
  twice, counted once — Nabeel Anthony, Ali Sabeer), all 4 in the last 7 days.
- **Subjects per grade** (`lib/gradeSubjects.ts`). In the shared form each
  selected grade gets its own section (search, chips, Select all, Clear all);
  removing a grade drops its list; every grade needs a subject (form, and the
  server in `lib/jobs` `prepareGradeSubjects`). Each grade's names resolve to
  that grade's own taxonomy ids; `job_subjects` = their UNION, written on every
  save, so matching, notifications, Browse, landing/city pages, JobPosting,
  Similar tuitions are unchanged. Display (`components/SubjectsByGrade`): card
  (4 per grade + "+N more"), tuition page (all), admin job detail;
  identical grades merge once ("Grades 1–3: …", natural order; a non-adjacent
  list reads "Grade 1, Grade 4: …"). A tuition with no per-grade data shows the
  flat chips as before. The AI description lists subjects per grade; the title
  format is unchanged. The duplicate check compares per grade when BOTH
  tuitions have it. Edit loads per-grade subjects by grouping the tuition's ids
  by their own grade. The id limit on posting routes rose 30 → 300 so "Select
  all" on a large grade (Grade 1 has 57 subjects) posts.
- **Backfill** (`scripts/dataop-backfill-grade-subjects.ts`, run after the
  deploy): **759** tuitions filled (14 with no subjects left NULL) by grouping
  each tuition's current ids by grade. Titles, URLs, statuses, dates and
  `job_subjects` (5,082 rows) were fingerprinted before and after: identical.
- **Live checks:** test tuition TM-1794 (Grades 1–3; Grade 1 Select all = 57,
  Grade 2 Mathematics, Grade 3 General Science — Grade 3 needed one because a
  grade with none is refused) was created directly as the team account in the
  form's saved shape (to avoid notifying real tutors), shown grouped on the
  card (+53 more) and page at phone and desktop widths, edited (English added
  to Grade 2 only), then closed (200, closed banner, noindex). Five backfilled
  tuitions (TM-1710, 1711, 1789, 1785, 1119) return 200 at unchanged URLs
  with grouped subjects; four have listed tutors sharing a subject id. No admin
  or parent session was driven, so the Overview tile and the form's chips were
  not seen in a browser.

## "Main subjects" chip; core subjects per level; Settings → Subjects (owner, 7 Oct 2026)

Commit 9c448e1. Migration 146 (additive, applied before the code):
`taxonomy_master.is_core boolean default false` — a flag on the
subject-per-level link, so one subject can be core at one level and not
another. Seeded by EXACT name on non-legacy levels: Pre-primary ×3 → 5;
Grades 1–8 → 7; Grade 9/10 - Science → 8; Grade 9/10 - Arts → 5; O Levels → 6;
FSC Part I & Part II → 7; AS & A Levels → 6 (116 flags). Skipped (name not at
that level): Arts — Physics, Chemistry, Biology, "Islamiat / Islamic Studies";
Science — "Islamiat / Islamic Studies" (taxonomy: "Islamiyat / Islamic
Studies"); O Levels — English, Urdu, Islamiat ("English Language", "Urdu as a
First/Second Language", "Islamiyat"/"Islamic Studies" exist); AS & A Levels —
English. "FSc / Intermediate" was read as the FSc level only; FA, ICS and
I Com have no defaults. 13 levels have none and hide the chip.

- `lib/taxonomyBuild` loads `is_core` and builds a `core` map beside the tree
  (`fetchCoreTree()` in lib/taxonomy). Each grade's "Select all" chip in the
  per-grade picker is now **"Main subjects"**: it adds that grade's core
  subjects (only ones the grade offers) to that grade only, and is hidden when
  the grade has none. Clear all and one-by-one selection are unchanged.
- **Admin → Settings → Subjects** (`/admin/settings/subjects`,
  `SCREEN_ACCESS.subjectsCore = ['admin']` — owner + admin, enforced by
  `/api/admin/taxonomy/core`): pick a level, tick "Main subject" per subject,
  save. `lib/subjectsCore.ts` only updates `taxonomy_master.is_core` (no add,
  rename or delete) and audits `taxonomy.core` with the added/removed names.
- Live checks: Grade 1's chip adds the 7 primary subjects to Grade 1 with
  Grades 2–3 untouched; Grade 9 - Science adds 8, Grade 9 - Arts 5; IGCSE Core,
  FA, ICS, I Com hide it. A Settings toggle (Art & Drawing on Grade 1) moved
  the chip to 8 then back to 7, with two audit rows. job_subjects (5,142) and
  every jobs.grade_subjects were fingerprinted identical before and after. No
  browser session was driven; the operations/staff 403 rests on the role test
  and the route's role check.

## Blog writer follows its own checklist — facts sheet, smarter checker, self-check, Fix with AI (owner, 7 Oct 2026)

Migration 147 (additive: `posts.self_check jsonb`, applied live before the push). Gates: tsc 0 · next build 0 · check:contrast 123 · rls:audit 219/219 · 67 suites, all green except the stale `test:taxonomy:live` (expects 29 grades; migration 95 added I Com and ICS, so the live count is 31; not touched here).

- **One facts sheet, built live.** `lib/ai/factsSheet.ts` (pure) turns the plan rows into the sheet; `lib/ai/factsSheetServer.ts` `loadPlatformFacts()` reads `plans` at request time (falls back to `DEFAULT_PLANS`). It states: signup free; Browse once mobile verified + city/area/subjects/gender set; the fee is always the "Spam Free Platform Fee" and no amount is ever written; Verified badge = fee + CNIC + photo + selfie, degree/certificates/intro video optional; plans Basic/Premium/Featured named, never priced; who can apply, reply and start a conversation, and the search order, all from the plan flags; parents verify CNIC + address free before posting, messaging or demos; no commission, no promises, no refunds. The editor shows it read-only as "Facts the writer uses". The old hard-coded `PLATFORM_FACTS_TEXT` and `VERIFIED_BADGE_MEANING` (degree-gated badge, "verification fee") are gone; `PLATFORM_FACTS_TEXT` is now the sheet built from the default rows.
- **Live plan note.** `plans.basic.can_initiate_message` is TRUE, so the sheet says every fee-paid tutor can start a conversation. The owner's regression case ("Only Premium and Featured tutors can start a conversation" must NOT flag) holds because the messaging rule flags only OVER-claims (a plan said to start conversations when its row says it cannot); restrictive sentences are never flagged. Whether Basic should start conversations is the owner's call on the plan row, not the checker's.
- **The writer gets every rule up front** (`lib/ai/blogCopy.ts`): the live sheet and the full checklist in the outline, section, retry and fix prompts; the closing CTA must link `/apply` (tutors, now a valid blog route), `/browse/tutors` (parents) or `/browse/tuitions` (both); SEO title ≤ 60 and meta ≤ 155 written for the post, never the tagline (`withBrandTail` is no longer called; `fitSeoDescription` cuts at a word).
- **Smarter checker** (`lib/ai/platformFacts.ts`, `lib/ai/blogChecker.ts`): sentence-level rules, each quoting the sentence, one flag per kind per sentence, curly apostrophes normalised so "doesn’t" denies; fee-name flags carry the corrected sentence ("Suggested: …"). New checks: any Rs/PKR/rupee amount; a closing paragraph with no link; the tagline or a contradiction in the meta description; SEO lengths; links to noindex pages (landing pages under 3 listings, city pages under threshold) with the `/tuition-jobs/<city>` page to use instead (`loadLinkIndexing()`); `/membership-plans` links. Link text: only generic text ("click here", "this page", "a related guide", "read more") is flagged; `/tuition-jobs/<city>` counts as the live tuition/city link. `BlogProblem` gained `kind`, `match`, `field`, `suggestion`.
- **Fixer** (`sanitizeDraft`): swaps noindex links to their replacement, unlinks `/membership-plans`, uses the post title (or tutor name) as text for an added link, and links the closing CTA to the audience's page.
- **Self-correction** (`lib/ai/selfCheck.ts`, shared by the editor and the harness): after a draft, up to 2 rounds of "fix only these passages" (`fixBlogPassages`, generate route step `fix`, purpose `self_check`); recorded on `posts.self_check` and shown as "Self-checked: N rounds, M issues left".
- **Fix with AI** (editor): each "Before publishing" content item has "Fix with AI", plus "Fix all"; the writer returns before/after edits (`lib/ai/passageEdits.ts`), shown in a panel; Accept applies them to the editor (then Save), Reject discards; nothing is applied without Accept. Rate-limited (`ai_blog_fix`, 60/h) and audited (`blog.fix_ai`, counts and kinds only). Reviewed, Numbers checked and Approve are unchanged.
- **Harness** (`/api/internal/blog-draft-test`): new `check` and `fix` steps (no writes); `save` runs the same self-check loop.

**Live results (7 Oct 2026).** Regression on production: the degree + intro-video badge sentence flags (quoted); "Only Premium and Featured tutors can start a conversation with a parent." does not flag; "one-time verification fee" flags with "Suggested: … one-time Spam Free Platform Fee …". (The home-tutor post itself never says "verification fee"; it says "one-time verification unlocks", which is not a fee name. The exact phrase is in the exam-prep post, which flags.) Fix with AI on the home-tutor badge sentence returned one before/after edit; the post's body and SEO fields in the database stayed byte-identical. Test draft "How to write a tutor profile that parents in Pakistan trust" (`/admin/blog/abf0ecc7-02a3-42ec-8e9a-ae81f196a9b3`, left as a draft, not reviewed or approved): 0 self-check rounds (clean on first check), 0 issues, 1,704 words (over the 1,500 target; length is not a checker item), 5 links, CTA → `/apply`, SEO title 47, meta 132, fee always named correctly, badge rule correct, no price. Not driven (no browser or admin session): the editor's Fix with AI buttons, Accept/Reject panel and facts card. They rest on tsc, the build, `test:blogfacts` (15) and the same server route the harness exercised.

## Membership Plans page is the single source of truth (owner, 7 Oct 2026)

Commits 8841774 + e140500. Migration 148 (applied live before the push): `plans.premium.displayed_quota` 'Unlimited' → '100', audited as `plan.settings`. Gates: tsc 0 · next build 0 · check:contrast 123 · all 67 suites (test:taxonomy:live now reads the grade count from the taxonomy: every non-legacy level with subjects must reach the picker, at least 31).

- **Settings vs `/membership-plans` (read-only comparison first).** Matched the page: Basic apply 10 / contact views 10 (the shared pool, "View Contact Number = 1 Apply") / in-app messaging (`can_initiate_message` true) / CV / incoming 10; Premium 100 applications + contact views (pool) / WhatsApp / who viewed / incoming 100 / matched email; Featured top rank / WhatsApp / who viewed / incoming unlimited / matched email; parent Verified (5 posts, message, demo) and Featured (contact, WhatsApp, hire, jobs first). **Mismatch fixed:** Premium's display value was "Unlimited" (dashboards, countdowns) while the page says 100 — the real limit was already 100. **Mismatches NOT fixable by a setting (reported):** Featured "Matched tuitions on your WhatsApp" has no sender at all (matched alerts are in-app + email only; 0 tutors hold Featured today); Featured's "unlimited" applications/contact views are a real 300 cap and the parent Featured "unlimited" posts a real 100 cap — the platform's standing display convention, limits not changed.
- **Facts sheet** (`lib/ai/factsSheet.ts`) now reads `displayed_quota`, `can_whatsapp`, `can_see_viewer_identity` and states: every verified tutor, Basic included, can message parents in the app; per-plan allowances (applications, parent phone & email, incoming requests) from the page's own numbers, described in words in posts; WhatsApp and who-viewed for Premium/Featured; matched alerts; the parent plans. It no longer says only Premium/Featured see parent numbers.
- **Plans page:** the activation line is "Online payments (JazzCash, Easypaisa, card) activate automatically. Bank transfers are confirmed by our team, usually within a few hours." with an Urdu line, whatever the active gateway; the heading lost its "*" (prices and footnotes keep theirs).
- **Copy sweep** (verification rule + page): FAQ (badge meaning, how checks work, refunds incl. the fee, what verification gives, Premium 100 not unlimited, why not in search — EN and Roman Urdu), Support (package, listing, pay-before-complete), Terms (verification paragraph, pay-before-complete), About (×2), plans preview, the badge pop-up's three lines, upgrade-sheet gates (quota body, viewer-identity body, the chat contact gate now "Numbers in messages need Premium"), plan-grant notifications/emails (Premium 100), the Premium house ad (was "Message parents first"), the needs-you "add a degree to earn your Verified badge" row (removed), the fee name in the dashboard checklist, Settings copy, the member timeline and the admin tip, the Browse tutors meta description, a content-queue brief.
- **Blog checker false positives fixed:** a question in a body is not a claim; a commission denial anywhere earlier in the sentence counts; sentences about browsing / signing up / posting being free are correct.
- **The 5 published posts** (owner-approved, `scripts/dataop-fix-published-posts.ts`, exact-match edits, a `post_revisions` row and a `blog.fix_published` audit row each): badge/degree/video claims corrected, the fee renamed, "no fee" lines → "TutorMint takes no commission on any tuition.", the home-tutor FAQ messaging answer set as given, every closing CTA linked (/apply, /browse/tutors, /browse/tuitions for both-audience posts), "a related guide" → the post title, /membership-plans links removed, the 4 dead links + the noindex link → /tuition-jobs/lahore (linked once; repeat mentions kept as plain words), Keeping messages useful given 4 internal links, a meta description ≤155 without the tagline on each. URL, title, publish date, approval and headings unchanged; updated_at set. Live checker: **0 issues on all 5**; every link 200 (/apply 307 → /register).

**Reported, not changed:** the site tagline "No fee." (footer on every page, the About heading) is flagged by the blog rule but is the site's brand line; "free demo" on /faq, /terms, /support; example tuition fees (Rs 20,000 academy example, Rs 5,000–20,000 filter bands) on /faq and /about — tuition amounts, not TutorMint prices. Not driven (no session): a Basic tutor's message POST end to end — `getEntitlements` for a real Basic tutor returns `verified true, canInitiateMessage true`, which is every gate `canStartThread` applies.

## Overview redesign, outreach tabs, settlement per order, Urdu subject names, wording (owner, 8 Oct 2026)

Migration 149 (additive, applied live before the code): `taxonomy_subjects.name_ur`
(seeded for the 13 main subjects), `tutor_contact_logs`, `featured_whatsapp_sends`
(unique per tutor + tuition). Both new tables are admin-read, server-written.

- **Hover lift, site-wide.** One rule in `app/globals.css` (`@layer components`):
  every `rounded-2xl`/`rounded-3xl` + `border` box lifts 2px with a soft shadow
  on hover, and shows the shadow while pressed on touch. Outermost card only;
  dialogs, fixed/sticky bars and form fields excluded; reduced motion respected.
  transform + box-shadow only — no layout shift, no JavaScript.
- **Verified badge** no longer carries the Urdu label "تصدیق شدہ" (green tick +
  "Verified" stay). Full Urdu sentences elsewhere are unchanged.
- **Tagline** is "Free to join. No commission. No middleman." (`SLOGAN`,
  `TAGLINE`, `SEO_BRAND_TAIL`, footer, manifest, homepage meta + hero — see the
  dated authorisation in "Homepage is LOCKED"). The blog checker still flags the
  RETIRED "No fee, no commission" (it contradicts the fee) and allows the new one.
  "Free demo" is "demo lesson" everywhere. The /faq parents' academy fee example
  (Rs 20,000 first month, English + Roman Urdu) is removed; the fee bands and the
  tutor-side academy/ad-spend comparisons stay.
- **Admin → People → Unpaid signups** (`/admin/users/unpaid-signups`) and
  **Featured WhatsApp** (`/admin/users/featured-whatsapp`):
  `SCREEN_ACCESS.unpaidSignups` / `featuredWhatsapp` = owner, admin, Operations
  AND Tuitions staff (the only People screens tuitions_staff opens). Rules in
  `lib/staffOutreachCore.ts`, I/O in `lib/staffOutreach.ts`. Unpaid = tutors
  joined in the last 30 days without the fee, paused/test accounts out (test =
  whole-word "test" or "New User"); "Stopped at" reuses `stoppedAtByTutor`; the
  outcome log writes `tutor_contact_logs` + `admin_audit_log`. Featured
  WhatsApp matches with `tutorMatchesJob` — the same rule as the in-app/email
  match alerts — against tuitions posted after the tutor's last send (first
  time: 7 days) up to the day's 10:00 PKT cut-off (computed, no cron). The send
  is recorded BEFORE wa.me opens; the unique (tutor, tuition) pair refuses a
  second send. The message has up to 5 tuitions (title, area, city, link), no
  parent contact.
- **Settlement per order:** when the PayPro file has Settle-Dates, PAID orders
  are grouped by settle date and each group's MerchantShare total is matched to
  the nearest unused bank transfer within ±2 days, preferring on/after (owner
  decision, 8 Oct — the written "on or after" rule contradicted the owner's own
  5 Oct / 6 Oct sample). Short by ≤ Rs 2 = "bank charge"; PAID but unsettled =
  "Due from PayPro" with age, red after 3 days (`settleByDate`).
- **Urdu subject names** show under the English name on the onboarding chips,
  and are editable per subject in Settings → Subjects (audited
  `taxonomy.urdu_name`).
- **Overview:** the 5 cards stay; Signups by role, Revenue by plan (components
  deleted) and Tutors to nudge are gone. "Today's to-do" (`lib/adminTodo.ts`)
  rows each carry their screen key and are hidden at 0; "Signup to payment"
  (7/30 days) counts real tutors through Signed up → Mobile verified →
  Onboarding done → Paid (nested) with % lost.
- **Data (item 8):** Rida Saeed and Ayesha Waqar Khan — every step done, fee
  paid, `onboarded_at` empty after the 6 Oct save error — set onboarded. The
  sweep found no others.

## Partner role, staff badge, owner-only areas, Finance, counts that match lists (owner, 8 Oct 2026)

Migration 150 (additive, applied before the code; dry-run first, the pre-change policy definitions saved). Gates: tsc 0 · next build 0 · check:contrast 123 · rls:audit 223/223 · all 70 offline suites (new: test:partnerfinance 10) · live test:overview:live 6.

- **Partner (`admin_role='partner'`) is view-only.** `roleSatisfies()` admits the Partner to every screen (like the owner), so every page and nav item the owner sees opens. Writes are refused on the SERVER: `proxy.ts` stamps the real HTTP method on every request (`x-tm-method`, overwritten, so a client cannot fake it) and `checkAdminRole()` answers **403 "Partner accounts are view-only."** to a Partner on anything but GET/HEAD. Downloads are GETs and stay allowed. The Partner's own two-factor routes use `checkAdminSelf()` (the only Partner writes). Two-factor is ALWAYS required for a Partner (no grace window): the layout shows the existing setup/verify screen, and `checkAdminRole` refuses a Partner API call from a session that is not AAL2. **Database side:** `public.is_admin_writer()` = `is_admin()` minus the Partner; every write policy that admitted `is_admin()` now admits `is_admin_writer()` (FOR ALL policies got a FOR SELECT twin with the original expression, so reads are unchanged), and the four storage write policies exclude the Partner — a Partner's own token used directly against PostgREST cannot write. `is_admin_with(array[...])` policies never named 'partner'. **Presentation:** `components/admin/ReadOnly.tsx` (`useAdminReadOnly`, `<WriteOnly>`, `ViewOnlyNotice`) hides write controls across the admin screens, a fetch guard turns any missed non-GET `/api/admin` call into the same 403 in the browser, and a navy "View-only Partner account" strip sits under the header. `test:partnerfinance` pins that every `/api/admin` write route calls `checkAdminRole`/`checkAdminSelf`.
- **Staff badge.** `roleBadge()` (`lib/adminAccessCore.ts`): Owner → "Owner", Partner → "Partner", every other staff role → **"Admin"** (header, Overview, Staff activity, People). The real role shows only to the owner and the Partner (Team page, and `roleBadge(role, viewer)`). Rights never depend on the word.
- **Owner-only areas** (`[]` in SCREEN_ACCESS = owner changes, Partner views, everyone else 403 + no menu item): `finance`, `revenue` (the Overview revenue card), `paymentAmounts`, `plans`/`plansMutate`, `paymentGateways`, `reconciliation`, `team`, `audit`, `paymentsRefund` (marking refunded moved from admin to owner). **Payments** opened to admin AND operations for the STATUS only: `withoutAmounts()` (lib/adminQueues) removes every rupee figure on the server, on the page and in the load-more route. Approving a transfer stays admin. This CHANGES rights for admin (loses plans, audit, revenue, refunds) — item 3 is more specific than item 2's "rights do not change", which was read as "the badge does not change rights".
- **Admin → Finance** (`/admin/finance`, `lib/financeCore.ts` pure + `lib/finance.ts`): totals all-time / this month / last month / this year; month by month (collected · PayPro deductions · expected in bank · received in bank · due from PayPro); by type (Spam Free Platform Fee · Premium · Featured · Parent plans) and by method (JazzCash · Easypaisa · Card · Bank transfer); refunded and deleted-account payments in their own lists, never in a total; .xlsx download for any range (`/api/admin/finance/export`, no member contact details). Dated by approval, Pakistan time. Counted = approved, account kept, never refunded. The bank columns follow the money (every approved PayPro payment, as the settlement check). **The settlement check moved** to `/admin/finance/settlement` with its data unchanged; `/admin/payments/reconciliation` and the gateways page with `?from&to` redirect there; Payment gateways keeps settings + health only. (The old gateways page's date regex lacked its backslashes, so a chosen range never applied — fixed by the move.)
- **Counts match their lists** (`lib/overviewItemsCore.ts` + `lib/overviewItems.ts`): every Overview card, to-do row and funnel step — and each step's "lost" figure — is one item with ONE loader; the Overview shows that list's length (revenue: its sum) and `/admin/overview/<key>` renders the same rows with a header like "6 tutors paid the Spam Free Platform Fee this month (1–31 Oct 2026)", plus a link to the working screen. `lib/adminOverview.ts` and `lib/adminTodo.ts` are deleted. `test:overview:live` checks every item, the funnel differences and independent SQL counts. The revenue card now uses the Finance rule (PKT month, refunded payments left out, not netted).
- **Payments waiting over 1 hour** = pending, started in the last 24 hours, waiting more than 1 hour (`isWaitingPayment`); older pending payments are abandoned and stay visible only on Payments.
- **"Stopped at"** gained two stops before the flow (`stoppedAtLabel(facts, { emailConfirmed })`): **"Email not confirmed"** (an email signup that never clicked its link — read from auth.users) and **"Mobile not verified"**. Before this, both read as "Gender" (the flow's first step), which is why 27 tutors looked stuck there. Mobile-unverified tutors therefore show in Unpaid signups as "Stopped at: Mobile not verified" for staff to call and verify through the existing member-page action.

## "Paid today" card, "Pause my account" for members (owner, 8 Oct 2026)

Migration 151 (additive, dry-run then applied before the code). Gates: tsc 0 · next build 0 · check:contrast 123 · rls:audit 223/223 · 71 offline suites (new: test:selfpause 9) · live test:selfpause:live (opt-in, SELF_PAUSE_LIVE=1), test:overview:live, test:directory:live.

- **Paid today** replaces "Paid this month" as the second Overview card (key `paid-today`, same `payments` visibility, same teal tone): tutors whose Spam Free Platform Fee was approved since 00:00 Pakistan time, refunded and deleted-account payments left out, each tutor once (`feePayersSince` in lib/overviewItemsCore). Subline "N this month · N in the last 7 days" from the same rows. Shows 0, never hidden. `/admin/overview/paid-today` lists exactly those tutors: name → admin page, time paid, document status, "Review documents".
- **Pause my account** (Settings → Account; tutors next to Change password, parents after Email — parents have no Change password tile). `lib/selfPause.ts` + pure `lib/selfPauseCore.ts`, route `/api/account/pause`. Pausing sets `profiles.paused_by_user_at` (never `is_suspended`/`is_banned`), pauses a parent's OPEN tuitions with `jobs.self_paused_at`, revokes every session (`revoke_user_sessions`) and signs this browser out. `tutor_directory` excludes a self-paused tutor, so Browse, search, landing pages, the shortlist and the sitemap drop them; the profile URL still renders, noindex and without structured data (folded into the under-review input of the index rule, no amber notice). New conversations, messages and demo requests to a paused member are refused: "This member is not available right now." (+ Urdu). Nothing is deleted. A plan's days keep running.
- **Restore** on the next successful sign-in — password login, mobile password reset, and email links all call `restoreSelfPauseOnSignIn` — only when staff have not suspended or banned the account (and a suspended account cannot self-pause). Toast "Welcome back, your profile is live again." + Urdu. A parent's self-paused tuitions stay paused and get a one-tap **Reopen** band on the parent dashboard (resumeJob clears `self_paused_at`).
- **Admin:** "Paused by user · date" chip on the member page and in People; `member.self_pause` / `member.self_restore` in the Audit log (actor_role `member`), plus the member timeline.

## Parent documents approved in admin (owner, 8 Oct 2026)

Migration 152 (additive, dry-run then applied before the code). A parent's verification is two items reviewed SEPARATELY: the CNIC (front + back images; status = `verification_state` + `cnic_verified_at`) and the typed home address (status = `address_status` + `address_verified_at`). **There is no address-proof upload in the product** — the address is text, reviewed as text. Verified = both approved (`cnic_verified_at` AND `address_verified_at`), the same two columns entitlements read for `parent_verified` (message + demo + post), so approval takes effect at once.

- **Rules** pure in `lib/parentDocsCore.ts` (`test:parentdocs`); I/O in `lib/parentDocuments.ts` — `loadParentDocs`, `parentsAwaitingReview` (oldest submission first; fixtures/banned/suspended/team out) and `reviewParentDocument`, the ONE writer, behind `/api/admin/parents/document-review` (`SCREEN_ACCESS.parents` = owner, admin, operations; Partner refused by `checkAdminRole`). Approve is refused over a missing side or an empty address; reject needs a reason (short list per item + "Other"). Every decision writes `admin_audit_log` (`parent.verify.approve/reject`, detail.item), the member timeline, an in-app notification, and on reject the `verification_rejected` email (parent variant, link `/parent/verify`); the decision that completes both sends "You are verified" + the approval email. The UI offers the pre-written "Send on WhatsApp" link, as for tutors. The old combined `/api/admin/parents/verify` route is deleted.
- **Member page** (`/admin/users/[id]`): a Documents box (`id="documents"`) right under the summary — parents get `ParentDocumentReview`, tutors the existing `TutorDocumentReview`; "Documents" in the summary links to it.
- **Verification → Parents**: "Awaiting review" = `parentsAwaitingReview()` (not a page of `verification_state='submitted'`); the drawer renders the same `ParentDocumentReview`, so both places post to one route. "Verified" tab = both columns set. Sidebar badge on Parents.
- **One list:** `lib/approvalQueue.ts` appends waiting parents, so the Overview "Documents to approve" count, its `/admin/overview/todo-docs` list and the People "Approval needed" badge all include them (noun now "members").
- **Images** are served only through `/api/documents/[id]/preview` (owner or staff, `Cache-Control: private, no-store`) — an authorising route, deliberately NOT a signed URL (a signed URL is a bearer link anyone holding it can open). `isDocumentStaff()` (`lib/documentAccess.ts`) now refuses Tuitions staff and suspended staff; before this, any `role='admin'` account could open a CNIC preview by id.
- **Parent side:** `/api/parent/verify` keeps an approved CNIC approved on re-submit and sets the address back to `pending`; `/parent/verify` shows "Verified" only when both are approved (`parentShownState`) and names which item was rejected.

## Admission Test Prep — a level with no grade (owner, 8 Oct 2026)

Migration 153 (additive, idempotent). See the taxonomy entry under Canonical tables and `docs/STATE.md`. `taxonomy_categories.no_grade` is the rule's one source: `buildTaxonomy()` exposes `noGrade`, and `TaxonomySelector`, `TutorFilterBar` and `JobFilterBar` hide the grade selector and auto-select the level's single implicit grade when the chosen level is in it. The onboarding / complete-profile / Subjects editors already fold grades in, and keep the level's authored order. A future no-grade level is a data change only (set the flag, add one implicit grade).

## Parents need a verified mobile only; 7-day tuitions; smart search; 1,000-row fix; second-role accounts (owner, 8 Oct 2026)

Later-dated than everything above, so under precedence rule 10 it wins where it touches them — in particular it SUPERSEDES the "Parent plans" table's `Requires: CNIC + address approved` row, the 5 Oct "Demo/Message require CNIC + address" hotfixes, and PR27's 15-day tuition life. Migrations 154 + 155 (additive; applied before the code — 155 restores `security_invoker` on `landing_combinations`, which 154's CREATE OR REPLACE had reset, and reads the test-poster fact through the SECURITY DEFINER `is_test_account()`).

- **Parents: a verified MOBILE is all it takes** to post, message tutors and request demos. `computeEntitlements` synthesises the free `parent_verified` plan from `profiles.phone_verified_at` (not CNIC + address); `createJob`, `canStartThread` and `/api/demo/request` refuse only an unverified mobile, with `PARENT_MOBILE_GATE_MESSAGE` (lib/parentGate.ts) and a link to `/parent/dashboard/settings?open=mobile`. CNIC and home address are OPTIONAL: approved both, they earn the green Verified badge (`verifiedOk` = cnic AND address) and nothing else. The parent checklist marks them `optional` (they never count toward the % and are never "missing"); /parent/verify still requires every field to SUBMIT them.
- **Tuitions pause 7 days** after posted / last resumed (`PAUSE_AFTER_DAYS = 7`; JobPosting `validThrough`, the countdown and the Overview "pausing in 2 days" all read it). The backlog (every open tuition already due when the rule went live, `BACKLOG_CUTOFF_MS` = 8 Oct 2026 20:40 UTC — 378 at the time) is paused **150 a night, oldest first** by the 03:00 UTC cron (`lib/tuitionPauseCore.planPauseBatch`); a tuition that crosses day 7 after the cutoff is an ordinary pause the same night. Indexing API notices go through `indexing_queue`, never more than 200 a day. **Marketplace → Paused tuitions** (`/admin/jobs/paused`, `SCREEN_ACCESS.pausedTuitions` = every role that posts): auto-paused tuitions newest first, filters (city, this week/older, with/without applications), Resume one or "Resume selected" — fresh 7 days, back on Browse, same URL, URL_UPDATED queued, poster notified, `job.resume` audit (Staff activity). Header line: "Backlog: N left · next batch <date> 03:00 UTC".
- **One smart search** (`lib/smartSearchCore.ts` pure, `lib/smartSearch.ts` server): every public search bar (Browse tutors/tuitions — which the landing and city pages and the tutor jobs board use — the typeahead, and the subject pickers on Post a tuition / onboarding / profile editors via `lib/searchWords.ts`) reads a sentence into City · Level · Subject/School (removable chips, `components/search/SearchChips`), with Search words (Settings → Subjects, owner + admin, audited `taxonomy.search_words`, stored in `taxonomy_aliases`) and typo tolerance. A school with a level named is context, not a filter. **Nothing found** → `lib/searchFallback.ts`: broader subject → nearest level → online first then nearby cities with "N km away" on each card; never an unrelated subject. Every miss is logged (`search_unmet`) → Overview to-do "Unmet searches this week". The homepage has no search bar (locked) and did not get one. Admin member search gained typo tolerance only.
- **The 1,000-row cap**: every whole-list read goes through `lib/pageAll.ts` (`pageAll` / `pageAllIn`, stable order + `.range`); subject filters on jobs are an inner join (`js_match:job_subjects!inner`), never an id list. `npm run test:pagecap` fails on any `.limit(>1000)` and checks the known readers.
- **City names** are canonical on save (`public.canon_city()` + a BEFORE trigger on jobs/profiles/tutor_profiles/tutor_areas); landing combinations fold case variants into one page.
- **Second-role accounts** (`lib/secondRole.ts`): owner/Admin create the other role's account from the member page (`SCREEN_ACCESS.secondRole`, reason in the Audit log `member.second_role`) on the same, already-verified mobile, linked both ways; login address `<msisdn>+<role>@users.tutormint.org`. Sign-in (password or SMS reset) then asks "Continue as Tutor or Parent?" (`/api/auth/switch-role` mints the linked session server-side). Normal sign-up still refuses a used mobile with the "contact support … 0321 5872222" line.
- **Test-named accounts** (`profiles.is_test_name`) are excluded from `tutor_directory` (so Browse, search, landing, sitemap), noindexed, out of the Overview counts and funnel; their tuitions are out of Browse, landing pages and the sitemap.
- **Migration 156**: the old `uniq_verified_mobile` (one verified mobile across ALL accounts) became `uniq_verified_mobile_per_role` — one tutor and one non-tutor account per verified mobile — so the linked second-role account can exist.
- **Indexing queue drain**: the nightly sweep only queues notices; the 5-minute cron (`/api/cron/paypro-reconcile`) and the daily cron drain them, time-boxed, within 200 a UTC day, and a Google quota error puts the notice back and stops until the quota resets (Google counts its day in Pacific time and includes notices sent outside the queue). The daily cron's `maxDuration` is 300 s; pause notifications go 10 at a time.
- **Change password** is ONE shared card (`components/account/ChangePasswordCard`) for tutors and parents and asks for the CURRENT password — the Supabase project requires it ("Current password required when setting new password"); the old tutor card without it failed in production.
- UI: parents get the shared Change password card before "Pause my account"; toasts sit top-centre under the header, newest on top, 4 s, never over the Messages dock; the whole tutor card opens the profile and View Profile is a small outline button.

## Approval queue matches the review card; Overview lists as cards (owner, 9 Oct 2026)

No migration. Read-only reports first (`scripts/report-approval-queue.ts`, `scripts/report-duplicate-members.ts`), no data changed.

- **One rule for "waiting".** `lib/tutorDocQueueCore.ts` (pure, `npm run test:approvalqueue`) — `tutorCardStatuses()` is what the review card shows (lib/tutorDocuments `loadDocumentStatuses` now returns it) and `tutorWaiting()` lists an item only when the card shows it Pending AND a file is on file to decide on. `lib/approvalQueue.ts` reads it, so the Overview "Documents to approve" count and list, People "Approval needed" and the sidebar badges (`/admin/tutors` now = tutors in that list, no longer a raw `verification_state='submitted'` head-count) all agree with the card. **The bug:** the queue read raw `verification_state`; the card reads the derived CNIC status (approval marker `cnic_verified_at` + documents). Esha Asghar's CNIC was approved 1 Oct; a re-upload on 3 Oct set `verification_state='submitted'` but kept `cnic_verified_at`, so the card said Approved and the queue said "Waiting: CNIC". She was the only member in that state. Consequence: re-uploading after an APPROVAL does not re-queue (the card still says Approved); a re-upload after a REJECTION still does.
- **One-sided CNIC.** Both review cards show "Front side missing" / "Back side missing" (`cnicSideNote`) and nothing is blocked. The tutor approve check already needed only a CNIC image (any side) + number; the parent check (`canApproveParentItem`) now accepts one side too.
- **Overview lists are cards** (`components/admin/OverviewCardGrid.tsx`): 1/2/4 per row, search on the page, "Show more" in steps of 48 (all rows are on the page, so after showing all the card count equals the header). Member rows (`OverviewRow.memberId`) get photo/initials, name + badges, role, city, joined, completion %, "Stopped at" while onboarding is unfinished, paid / not paid for tutors, and Open / WhatsApp / Call; document lists add Review (`reviewHref`). Facts come from `lib/overviewCards.ts` `loadMemberCards()` (chunked), which adds to the loader's rows and never drops one. Tuition / payment / search lists render as plain cards with Open.

## Approved documents are locked; hidden CNIC fronts restored (owner, 9 Oct 2026)

Migrations 157 (applied before the code) and 158 (applied after the deploy — it refuses member CNIC/selfie row writes, which the old code made). Nothing deleted anywhere.

- **Restored CNIC sides.** `scripts/dataop-pause-dup-documents.sql` (PR106-H3) kept the newest CNIC photo per MEMBER, not per side, so the front of most cards was hidden. `scripts/report-hidden-cnic-sides.ts` (read-only) found 23 members (all tutors) each with a hidden front and no visible front; `scripts/restore-hidden-cnic-sides.ts --apply` un-hid the newest hidden upload of each side with no visible upload (23 files, one `document.restore_side` audit row each, actor "system: restore CNIC sides"; review statuses and approval dates untouched; a second run restores nothing). Queue 11 → 11; queued tutors showing "Front side missing" 8 → 0. The SQL clean-up now groups by side (CNIC front / back / selfie; degrees are never de-duplicated); the same rule is `duplicatesToHide()` in `lib/docLockCore.ts`, tested.
- **The lock** (`lib/docLockCore.ts` pure, `lib/docLocks.ts` I/O). A CNIC side is locked when the CNIC is approved and that side is on record; the selfie when approved. `/api/documents/upload` answers 403 with "Approved ✓ Locked. To change this document, contact support on WhatsApp 0321 5872222." (+ Urdu); `/api/identity` refuses reopen and a changed number on an approved CNIC (the same number is a no-op) and never puts an approved CNIC back to 'submitted'. Every member upload control reads `/api/documents/locks` (`useDocLocks`): the shared `CnicCapture`/`CnicCameraField` (Settings identity card, parent verify, apply gate), the onboarding CNIC sides and selfie step, the complete-profile selfie step, Settings selfie card and `IdentityDocsStatus`. A side missing from an approved CNIC stays uploadable (it waits for review).
- **Unlock** — "Unlock for re-upload" next to each locked document on the member's admin page (`components/admin/UnlockDocButton`, `/api/admin/documents/unlock`, `SCREEN_ACCESS.documentUnlock` = owner/admin/operations; the Partner is refused by `checkAdminRole`; audited `document.unlock` with who/when; the member is notified). One upload per locked part (one selfie, or one front + one back). That upload is stored as `status='review'`: the approved file stays on record, so the Verified badge and indexability do not move; the queue (`tutorWaiting` / `parentWaiting` — `hasCnicReview`, `hasSelfieReview`) lists it, so Overview "Documents to approve", People "Approval needed" and the sidebar badges count it. Approve → the newest waiting file per part becomes the record, the old one is hidden, the document locks again (`planReviewDecision`). Reject → the waiting file is hidden and the old approved file stays on record. Any decision closes the open unlock.
- **Profile photo is not locked.** The Settings lock on an approved photo and the DB avatar lock in `lock_tutor_profile_fields` (158) are gone; a member's change after approval stamps `profile_pic_rereview_at` and enters the queue as "Changed photo — waiting", with `profile_pic_status` still 'approved' (badge and indexability unchanged). Approve clears the stamp; reject is the ordinary photo rejection.
- **CNIC number on approval.** Approving a tutor CNIC with no number now says "CNIC number not entered. Type the 13-digit number in the CNIC number box on this page, then approve." (`cnicApprovalProblem`), and the card scrolls to and highlights the new number box (`components/admin/AdminCnicNumberBox`) — type with or without dashes, Save, stored as 42101-1234567-1; a number on file shows heavily masked with "Change".

## One-tap WhatsApp follow-up for stuck sign-ups (owner, 9 Oct 2026)

Migration 159 (additive, applied before the code). There is no paid WhatsApp API: staff send by hand from their own WhatsApp through a `wa.me` link with the text prefilled.

- **The text** is the existing `profile_completion_nudge` template ("Finish your profile"), used as stored. It has one placeholder, `{name}`, filled with the tutor's first name. The template has no link placeholder, so the continue link `https://www.tutormint.org/tutor/onboarding` goes on its own line after it (the proxy sends a signed-out visitor to `/login?next=/tutor/onboarding`). A future template with `{link}` gets it in place. Rules: `followUpText` / `followUpWaLink` in `lib/followUpCore.ts`. The number is WhatsApp first, then the mobile (`92…`).
- **Tabs.** A member followed up in the last 7 days (`FOLLOW_UP_HOLD_DAYS`) sits in "Follow-up sent" with "Follow-up sent 2 days ago by Aqsa" and a **Send again** button. Still stuck 7 days after the last follow-up, they return to the main tab tagged "Followed up once / twice / N times". Paying or finishing onboarding drops them out of the list's own loader, so out of both tabs. The Overview "Stuck in onboarding" number is the Stuck tab's length (`todo-stuck`); `todo-stuck-sent` is the second tab's list page and never an Overview row.
- **Clicks.** WhatsApp opens the chat AND records a follow-up (channel whatsapp, template key). The card leaves at once and an "Moved to Follow-up sent" toast offers **Undo** (the toast's new optional action; Undo stamps `undone_at`). Call still only dials; "Mark as followed up" records a Call follow-up, and is also on cards with no number. Every record writes `admin_audit_log` (`member.follow_up` / `member.follow_up_undo`) and the member timeline (`follow_up_sent` / `follow_up_undone`); neither event is in the member's own dashboard feed.
- **Same rule on all three lists** (`components/admin/FollowUpActions.tsx`). Unpaid signups gained a "Follow-up sent" filter (its WhatsApp keeps its own built-in help text, recorded as `unpaid_help_message`); Abandoned signups gained Stuck / Follow-up sent tabs, and sending its Message records a follow-up. Access is unchanged: `/api/admin/follow-ups` checks the list's own SCREEN_ACCESS (`unpaidSignups` or `signups`); a Partner sees both tabs and no WhatsApp, Call or Mark button, and `checkAdminRole` refuses their POST.

## Settings and Logout always visible in the member header (owner, 9 Oct 2026)

No migration. Tutors and parents no longer have the avatar dropdown. **Supersedes "Navigation and notifications (3 Sep 2026)"** on the member menu: the signed-in member header (`components/Navbar.tsx`, tutor/parent branch) is the avatar + first name as a plain link to the dashboard (no chevron, no menu), then Messages, Notifications, **Settings** (gear) and **Logout** (red), all visible. `components/MemberHeaderNav.tsx` holds Settings + Logout: below `sm` each is an icon with a 9px label underneath; from `sm` icon and label sit side by side in the bell's 44px bordered style. Logout is the same flow as before (signOut → `/` → refresh). To fit one row at 320px the member header alone shrinks the logo (72px below 360, 88px below 400) and the gaps, and the Messages icon and bell are 40px wide below `sm` (`NotificationBell compact`); the signed-out header keeps its sizes. Unread counts are untouched. **Help & Support** moved to the dashboard profile cards: `components/dashboard/AccountLinks.tsx` (Settings + Help & Support outlined buttons) under "View your public page" (tutor) / "View your public card" (parent). Admins (and a role-less session) on the site header keep `UserMenu`; `lib/userMenu.ts` no longer has tutor/parent entries. The admin bar is unchanged. `npm run test:memberheader`.

### The crash it caused, and the fix (9 Oct 2026)

7d953fa took down every signed-in tutor/parent page (`GET /tutor/dashboard`, `GET /` and every other page while signed in, 16:35 UTC onward; Vercel: `TypeError: Cannot destructure property 'auth' of 'a' as it is undefined`, digest 2445384852). Cause: `MEMBER_SETTINGS_HREF` was a plain object exported from the `'use client'` file `components/MemberHeaderNav.tsx` and read by the SERVER Navbar. On the server a value imported from a client module is a client-reference proxy, not the object; `MEMBER_SETTINGS_HREF[role]` reached the client render as `undefined`, and `<Link href={undefined}>` threw inside Next's URL formatter (`const { auth, … } = url`). tsc, `next build` and the unit test (which imported the file outside RSC) all passed. Fix: the constant lives in the plain module `lib/memberNav.ts`; the member header's right side is `components/MemberHeader.tsx` (no server-only import, rendered by Navbar inside its Shell). **`npm run check:server-imports` now also fails when server code imports any non-component (non-PascalCase) value from a `'use client'` .tsx module** (`findValueImports`); it flags 7d953fa and passes the fix. `test:memberheader` renders the header for a tutor with/without photo, a member with no or a blank name, and a parent, and the profile cards for a tutor mid-onboarding, a complete tutor and a parent.

**Error page** (`components/AppErrorView.tsx`, both error boundaries): heading "Something went wrong at our end", one English line "Please try again. If it keeps happening, contact us on WhatsApp.", one Urdu line at normal size; navy "Try again" and "Contact support on WhatsApp" (0321 5872222, with the reference); "Go to the homepage" as a plain text link; "Get help" removed; the reference number still shows. `ErrorShell` renders no actions block when given none.

## Infinite lists never show an id twice (owner, 10 Oct 2026)

No migration. "Sehar Arif" appeared twice on /browse/tutors — ONE account (`f696795a…`, slug `sehar-arif-tutor`; no second account by name, photo, mobile/WhatsApp or email). Live paging was clean (72 tutors over 7 pages, 655 tuitions over 55 pages, no repeated id): both orders are already total — `rank_tutors` ends on `md5(id || date)` and the tuition feed on `bumped_at, id` — so no SQL change was made. The cause was `lib/useInfinite.ts`: it restored rows saved in sessionStorage by an earlier "Show more" UNDER a freshly server-rendered first window, and appended pages, without ever comparing ids. Sehar's documents were approved at 06:42 UTC on 9 Oct and she saved her profile at 07:02 (the tagline), so she moved up to #12 — the first window — while browsers still held an older copy of her (no tagline) in their saved rows. Fix (`lib/infiniteMerge.ts`, pure): `mergeUnique` drops any id already shown (server window, earlier pages, within a page) on every append and restore; `snapshotUsable` refuses a saved snapshot that overlaps the server window (the ranking moved — rows and cursor are stale) and the list continues from the server's own cursor; `uniqueById` is the render guard on the first window. `useInfinite` takes `serverIds`; /browse/tutors, /browse/tuitions, both landing kinds and the /tuition-jobs city pages pass them; the tutor and tuition storage keys were bumped (v4 / v3) to drop snapshots already saved. `npm run test:infinitemerge`. `scripts/report-duplicate-members.ts` now matches name, photo, mobile/WhatsApp or email local part within 14 days, says what matched and marks pairs NEW since `--since` (its SQL is `String.raw` — the old template literal turned `'\s+'` into `'s+'`).

## Duplicate-report actions (owner, 10 Oct 2026)

No migration; data only (`scripts/dataop-duplicate-report-actions.ts`, guarded: it re-checks every reported fact and stops on any difference; facts from the read-only `scripts/report-dup-action-facts.ts`, which counts rows in every column with a foreign key to the member). Applied 9 Oct 20:11 UTC, audited under the owner (`member.delete`, `member.suspend` ×2, `member.hide_public` ×2, detail `dataop: duplicate-report-actions`). **Sidra Aziz** — the empty email-signup account `039b07dd…` (0%, one `registered` row, nothing else) DELETED as an owner-approved exception to "never delete": its activity row, tutor_profiles, profiles and auth user; it held no storage. Its audit row is kept. `/tutor/sidra-aziz-tutor` now 404s; her mobile account `aa2ae8cd…` (slug `sidra-aziz-tutor-fe7d`) is unchanged and listed. **Tehreem Sohail** — the newer account `52152470…` paused (`is_suspended`, the `suspendMember` effects); the older `4ffcb86c…` untouched. **Ali Sabeer `8127b7c1…` and Ehtasham Abbasi `bb803138…`** are test accounts: `hidden_from_public = true` (the test-account flag, migration 126) on both; Ehtasham paused; Ali was already paused and his payments are untouched. (A second "Ali Sabeer", `bbf2587a…`, was already `hidden_from_public` and was not part of this.) A fingerprint of every other profiles/tutor_profiles row was identical before and after; Browse went 72 → 69. `report-duplicate-members.ts` no longer reports a pair where BOTH accounts are test (`hidden_from_public` or `is_test_name`).

## Grey gender-based default avatar (owner, 10 Oct 2026)

No migration. **Supersedes the "initials disc in brand colours" avatar fallback** (Global UI rules, 2 Sep; "As built (header, breadcrumbs, avatars, banners)", 3 Sep) for members. A member with no photo gets one of three static greyscale silhouettes — `public/avatars/male.svg`, `female.svg` (dupatta outline), `neutral.svg` — each under 2 KB, three greys only. One rule, `lib/defaultAvatar.ts` (`defaultAvatarKind`): `male` → male, `female` → female, everything else (Trans, null, an unknown value) → neutral. `components/Avatar.tsx` is still the only avatar: a real photo renders exactly as before; with no photo it renders the default as a plain `<img>` with the same size classes, round shape and ring (alt = the member's name; empty when decorative). It takes `gender`; the `seed` prop and the initials/tint fallback are gone. Gender exists for tutors only (`tutor_profiles.gender`), so parents always get the neutral one. Where a surface loads a member from `profiles` alone, `lib/memberGender.ts` (`tutorGenders` / `tutorGender`, tolerant) supplies it: the member header (Navbar, read beside the unread counts), the inbox list and thread header (`otherGender` on `ThreadSummary` / `ThreadHeader`), admin Overview cards. A hidden or rejected photo, which used to fall back to initials, now falls back to the gender default. **Never an og:image or structured-data image** — those read `avatar_url` themselves and keep the site default. NOT changed (reported): the admin social banner (`next/og`) and the CV preview/PDF keep their initials box; the anonymised "who viewed you" blur disc is unchanged. `lib/brand.ts` `AVATAR_TINTS` stays (the social banner and `lib/activityFamily.ts` use it). `npm run test:defaultavatar`; `scripts/report-avatar-defaults.ts` (read-only) gives the counts.

## Plain default avatars; tutor areas shown once (owner, 10 Oct 2026)

No migration, no data change. **Supersedes the "female with dupatta" drawing** in the section above: `public/avatars/male.svg` (short hair) and `female.svg` (long hair in two locks to the shoulders, open under the chin) are plain silhouettes with no religious or cultural clothing; `neutral.svg` is unchanged. All three share the same background, head circle (48, 38, r 16) and shoulders, the same three greys, each under 1 KB. `components/Avatar.tsx` appends `?v=<DEFAULT_AVATAR_VERSION>` (now 2) to the default file so a redraw is fetched at once — bump it whenever a drawing changes. The rule (`lib/defaultAvatar.ts`) is untouched. `test:defaultavatar` pins the shared head/shoulders and that the female hair is drawn in absolute path commands with nothing above the head top, nothing under the chin and nothing wider than the head + 6.

**Areas.** Zuha Qasim's card read "DHA, DHA +1 more" because she has both "DHA" and the curated "DHA Lahore" saved under Lahore, and the card strips the city from each label. `lib/place.ts` `distinctAreaLabels(areas, mainCity, { cities, areaCities })` is the ONE rule for listing a tutor's areas (`TutorCard` — so Browse, landing pages, shortlist, blog embed — and the public profile): the same name in the same city is shown once, the same name in two cities reads "DHA (Lahore)" / "DHA (Karachi)", and "+N more" is counted on the distinct list. An area's city is the explicit one when given, else whichever of the tutor's cities its own name ends with, else the main city; each label links to the Browse filter for its own city with the first saved value. The public views return area names without their city, so `lib/tutorAreaCities.ts` `withAreaCities()` reads `tutor_areas` (service role, city + area only) ONLY for a tutor whose list repeats a name exactly — nobody today — and is tolerant. Read-only `scripts/report-duplicate-tutor-areas.ts`: 0 tutors have an exact duplicate area saved, 0 have one name under two cities, 5 of 68 have two saved values that read as the same label (all "DHA" + "DHA Lahore"). `npm run test:place`.

## Document review — steady viewer, rotate, CNIC number read from the photo (owner, 10 Oct 2026)

Migration 160 (additive, dry-run then applied before the code): `user_documents.rotation smallint default 0` (CHECK 0/90/180/270) and `cnic_read_status` (`reading` | `found` | `none`), `cnic_read_number`, `cnic_read_at`. No policy change (user_documents has no member UPDATE policy; every write is a server path). `npm run test:docreview`.

- **Why the full-size view shook.** The old viewer (`components/admin/Lightbox.tsx`, deleted) was `position: fixed` but rendered INSIDE the review card, and every `rounded-2xl border` card lifts on hover with `transform: translateY(-2px)` (globals.css, 8 Oct). A transformed ancestor is the containing block of a fixed descendant, so the overlay was laid out against the card while the pointer was over it, then against the screen when it was not, in a loop. Diagnosed from the code, not seen in a browser. **`components/admin/DocumentViewer.tsx` is the ONE admin viewer** and renders through a portal into `<body>`. Also: the picture is sized from the viewport (vw / dvh — nothing is measured, so no resize loop and no shift on load), no CSS transition on its transform, the stage is `touch-action: none` with its own two-finger pinch, closing is a `click` (a touchstart close let the follow-up click reopen the thumbnail), and the scrollbar width is held while the page is locked. Any new admin document image must open in this viewer (`ViewerThumb`, or `components/admin/DocumentThumb.tsx` from a server component). Used by: `TutorDocumentReview` (member page, tutor page), `ParentDocumentReview` (member page, Verification → Parents), `TutorModerationClient` (Verification → Tutors, incl. degree certificates and earlier uploads), `TutorFieldHistory` (via DocumentThumb).
- **Rotation is a display setting.** "Rotate left ⟲" / "Rotate right ⟳" / "Save rotation" in the viewer, for a stored document only (the profile picture has no document record and cannot be rotated). `POST /api/admin/documents/rotate {documentId, delta}` → `lib/docRotationServer.ts`, whose only write is the `rotation` column; audited `document.rotate` with old and new rotation. `SCREEN_ACCESS.documentRotate` = owner, admin, operations; the Partner is refused by `checkAdminRole`. Not behind the approved-document lock. **The preview route applies it** (`/api/documents/[id]/preview` turns the bytes with sharp as it serves them), so every screen — staff and the member's own — gets the picture the right way up with its true aspect; the stored original and preview are never modified. After a save the viewer raises `tm:doc-rotated` and every `SecureDocumentPreview` of that document refetches.
- **CNIC number read from the photo** (`lib/cnicReaderCore.ts` pure, `lib/cnicReader.ts` server, `completeWithImage` in `lib/ai/anthropic.ts` — same key and model). Only the CNIC FRONT image is sent; the reply must be exactly 13 digits (5-7-1, dashes or spaces optional) or it is "not found"; the number and image are never logged; one read per uploaded image (cached on the document row; a failed call caches nothing). **A read is a SUGGESTION only** — nothing on this path writes `profiles.cnic_number`; the existing Save / Approve / Next paths do, when a person presses them.
  - Staff: "Read number from photo" in `AdminCnicNumberBox` (`POST /api/admin/documents/read-cnic`, `SCREEN_ACCESS.cnicRead` = owner, admin, operations; `cnic_read` bucket 10 a minute per staff member). An empty box is pre-filled from a suggestion already on file (action `cached`, no API call).
  - Members: `/api/documents/upload` reads a CNIC front in the background (`after()`) when the member has no number; `GET /api/identity/cnic-suggestion` + `lib/useCnicSuggestion.ts` pre-fill the shared `CnicCapture` number box (onboarding, complete-profile, Settings, parent verify) with an English + Urdu "check it matches your card" line. `CnicCapture` saves the number before a photo, so this reaches members who uploaded photos another way (the apply gate, older accounts).
  - Duplicate: staff see "This CNIC number is already on another account: Name" with a link (`CnicDuplicateWarning`; the parent card uses `SavedCnicDuplicate`). A warning, never a block. Members are told nothing about another account by these routes (the member save-number route's existing "already registered" refusal is unchanged).
  - Backlog: `scripts/suggest-cnic-numbers.ts` picks approval-queue members with a front and no number and calls the CRON_SECRET-protected `/api/internal/suggest-cnic-numbers` once per document (the API key exists only in production); the console shows the last 4 digits only. `--all` widens it to every member; `--run` reads.

## Applicants to forward, "Verification Fee", profile-photo rotate, viewer fixes (owner, 10 Oct 2026)

Migration 161 (additive, dry-run then applied before the code): `applicant_forwards`, `applicant_forward_outcomes`, `avatar_rotations` (admin-read RLS, service-role writes) and the `applicants_forward` message template. `npm run test:applicantforwards`.

- **The tutor fee is the "Verification Fee"** (`FEE_LABEL`, lib/display). **Supersedes "Spam Free Platform Fee" (5 Oct) everywhere** — member and staff screens, emails, notifications, FAQ, Terms, admin labels and reports; Urdu `تصدیقی فیس`. Amounts, plan ids, columns, payment logic and "our own screens do not show the amount" are unchanged. The blog checker's fee-name rule is inverted: "Verification Fee" is right; "Spam Free Platform Fee", "platform fee", "registration fee" and the like are flagged with the corrected sentence. The old name survives only where it must: that rule, the scripts that find or replace it, and records of what was said at the time (sent notifications, post revisions, audit log, migrations, this file's dated sections above). `scripts/report-fee-name.ts` (read-only) and `scripts/dataop-rename-fee.ts` (posts and templates, exact name swap, a revision + audit row per post).
- **Marketplace → Applicants to forward** (`/admin/jobs/applicants`, `SCREEN_ACCESS.applicantForwards` = owner, admin, operations, tuitions staff; the Partner sees every card and no action, and `checkAdminRole` refuses their POSTs). Rules pure in `lib/applicantForwardCore.ts`, I/O in `lib/applicantForwards.ts`. ONE card per tuition that a PAID tutor applied to or viewed the number of. Paid = `verified_fee_paid_at` set and not paused, banned or a test/hidden account. Applied = an `applications` row not withdrawn; Viewed number = a `tuition_access` row with no application (or a `contact_reveals` row for the tuition's seeded contact). The parent shown is the tuition's own contact: `job_contacts` for a team-posted tuition, the posting account otherwise. Tabs: To forward (a paid tutor not yet included in a forward) · Forwarded ("Forwarded 2 days ago by Aqsa (3 tutors)", tagged "Check with parent" after 3 days with no outcome) · Outcome (Hired / Demo arranged — which tutor — Not interested / No answer, optional note). A new paid applicant on a forwarded tuition returns the card to To forward tagged "New applicant", with only the new tutors pre-selected and earlier ones marked "already sent". The WhatsApp text is built from the `applicants_forward` template (`{parent_name}`, `{tuition_title}`, `{area}`, `{tutor_list}` = one line per tutor, name and public profile link; phone-like runs are stripped, so it never carries a number). The template is edited with the others in Team inbox → Templates — there is no separate "Settings → Message templates" screen. `POST /api/admin/applicant-forwards/forward` and `/outcome`; both write `admin_audit_log` with `target_type='job'`, so they appear in the tuition's admin page history. Nothing is shown to tutors or parents (no notify, no member timeline). Sidebar badge = the To forward count. Read-only `scripts/report-applicant-forwards.ts`.
- **Profile-photo rotate.** A profile photo is fetched straight from public storage by next/image, crawlers, link previews, the social banner and the CV, so a rotation cannot be applied on the way out as a document's is. `lib/avatarRotationCore.ts` (pure) + `lib/avatarRotation.ts`: the rotation is saved as a setting in `avatar_rotations` (rotation, the uploaded original, the turned copy); a turned COPY is stored as a NEW object beside the original (`upsert: false`) and `profiles.avatar_url` points at it; rotation 0 points back at the original. The uploaded file is never modified, moved or removed. Every surface reads `avatar_url`, so the photo is the right way up everywhere at once, og:image and structured data included. A member's next upload replaces `avatar_url`, after which the saved row no longer applies. `POST /api/admin/profile-photo/rotate {memberId, delta}`, `SCREEN_ACCESS.documentRotate`, audited `profile_photo.rotate` with old and new rotation. Photo review status is untouched (the member-side triggers do not fire on a staff write).
- **Viewer fixes** (`components/admin/DocumentViewer.tsx`): the backdrop is opaque `bg-tm-black`, full screen (`fixed inset-0 h-dvh w-screen`, z-[99] — above the page, below toasts), so nothing behind shows through; the picture is sized from its STAGE with container units (`container-type: size`, `100cqw` / `100cqh`, swapped for a quarter turn) so it always fits between the bars at any aspect; a tap on the dark margin around the picture closes; the rotate buttons read "Rotate left" / "Rotate right" with the lucide rotate icons (no ⟲ ⟳ glyphs).
- **First real CNIC read:** `suggest-cnic-numbers.ts --all --run` read the one member with a front and no number: not found (stored as the suggestion "none"; staff type it).

## Payment choice screen — JazzCash (PayPro) or bank transfer with a receipt (owner, 11 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **bank transfer details are shown to members again**, and **the amount is shown on the choice screen only** (this supersedes "the fee price lives on the payment page `/pay/manual/[ref]`", 15 Sep, and the direct-to-PayPro buttons of PR106-G4b). Everywhere else on our own screens stays without the amount.

- **`/pay/choose?plan=<code>`** (`app/(site)/pay/choose`) is where EVERY paid checkout goes before any redirect — the Verification Fee and Premium / Featured / parent Featured. Entry points that used to start a checkout now only navigate there: `TutorVerifyGate` (Verify), the onboarding final screen (`GetVerifiedStep`), `GetVerifiedValueCard`, `BuyButton`. The page reads the package and its price from `plans` (`priceLine()` — "one-time fee Rs 199" / "Rs 499 / month"), applies the checkout's own rules by redirect (fee already paid → dashboard; a tutor plan before the fee → the verify step), and renders `PayChoice`: **JazzCash (PayPro)** → the unchanged `/api/payments/checkout` through `useVerifyCheckout(planCode)` (same order creation, callbacks, automatic activation); **Other method: bank transfer** → the bank panel.
- **Bank panel.** Details come from `app_settings` (`pay.bank_name`, `pay.account_title`, `pay.account_number`, `pay.iban` via `manualInstructions()`), each with a Copy button, plus the amount. `loadBankPanel()` (`lib/payments/receipt.ts`) returns null — and "Other method" is absent, and the receipt route refuses — when the owner's switch (`pay.method.bank_transfer`, "Show bank transfer to members") is off OR the details are not filled in (`bankDetailsComplete`: bank + account title + account number or IBAN). The owner enters them at **Admin → Settings → Payment gateways → Bank transfer details** (`/admin/payments/settings/gateways#bank-details`); the save route is now owner only (`SCREEN_ACCESS.paymentGateways`), and `/admin/payments/bank-details` redirects there. Branch and QR are kept in the form but not shown to members.
- **Receipt.** `POST /api/payments/receipt` (form: `planCode`, `receipt`, optional `transactionId`): JPG/PNG/WebP/PDF, 5 MB (`receiptFileProblem`); creates or reuses ONE pending `provider='manual'` payment for the package, stores the file in the private `payment-proofs` bucket under a NEW name each time (`upsert: false`), sets `method='bank'`, and leaves it pending. It activates nothing. A second receipt for the same package is refused (409) while one is under review (`receiptUnderReview` = pending + manual + a receipt or reference). **It replaces `/api/payments/manual`, which wrote `method: 'transfer'` — a value `payments_method_check` rejects — so the old submit never recorded a transfer (0 receipts were on file).** `/pay/manual/[ref]` now redirects to the choice screen for that order's package.
- **Member state** (`receiptStateOf`): under review → "Payment under review" replaces the pay options on the choice screen, and on the tutor dashboard (`PaymentReviewNotice`, the header chip, no pay button in the benefits pop-up, no value card / pending-invoice prompt). Rejected → the staff reason with "Upload a new receipt"; the new receipt is a NEW payment row and file, so the refused one stays on record on its own rejected row.
- **Staff.** The existing Payments queue: a **Bank transfer receipts** filter (`?filter=receipts`) and a sidebar badge (`receiptsWaitingCount`). The receipt opens in the shared `DocumentViewer` (`turnOnly` — rotate on screen, nothing saved; a PDF opens in a new tab). Approve / Reject (`/api/admin/payments/decide`) are **owner, admin and operations** (`SCREEN_ACCESS.paymentsApprove`), fresh password, audited (`payment.approve` / `payment.reject`); the Partner sees the card with no buttons and `checkAdminRole` refuses the POST. Approve runs the same `activatePayment` as a gateway callback, with `reviewed_by` = the approver. **One exception to "admin and operations never see an amount":** an approver sees the amount EXPECTED on a receipt that is waiting (`withoutAmounts(rows, { keepAwaiting })`), because a receipt cannot be checked against a hidden figure. Payments and Finance label these "Bank transfer" (`channelLabel`, `methodLabel`).
- **Logos.** `public/payments/jazzcash.(svg|png)` and `public/payments/faysal-bank.(svg|png)` are shown (22px) when present; `next.config.ts` lists the files at build time (`NEXT_PUBLIC_PAY_LOGOS`, `lib/payments/logos.ts`), so a missing file is the text label alone.
- `npm run test:paychoice`.

## Settlements — PayPro payouts and bank transfers matched to bank credits (owner, 11 Oct 2026)

Migration 162 (additive, applied before the code; the settlement tables were empty). Extends Admin → Finance → Settlement check (`/admin/finance/settlement`); owner only, Partner view-only (`SCREEN_ACCESS.finance`). The older range check, deduction lines and Finance figures are unchanged and sit under the new board in a folded section. `npm run test:settlements`.

- **Rules** are pure in `lib/settlementMatchCore.ts`; I/O in `lib/settlementMatch.ts`. Order of matching: the owner's manual links → whole PayPro groups (settle date + payout channel; JazzCash vs Easypaisa/TMFB) against a PayPro credit within ±2 days, exact or up to Rs 2 short (bank charge) → a SUBSET of one settle date's orders that adds up to a credit (`findSubset`; the picked orders are named) → an amount mismatch (a credit within Rs 10 an order or 5% of a group; shown, never hidden) → approved bank-transfer receipts to a non-PayPro credit of the same amount within ±2 days, by reference, then sender name, then nearest day.
- **Upload.** `importPayproFile` (lib/reconciliation) upserts by order number (`planUpsert`) and returns new / updated / unknown order numbers. A failed upload is safe to repeat; the upload row is never deleted (it would cascade to older orders).
- **Bank credits.** `POST /api/admin/payments/settlement/credits`; a duplicate reference is refused (409, and by a unique index). `parseBankAlert` reads a pasted alert into the form in the browser; the bank's exact wording was not available, so it reads "Label: value" lines and a one-sentence alert, and the owner confirms before saving.
- **Manual links.** `POST /api/admin/payments/settlement/links` — link, unlink (hold), or back to automatic; a note is required; audited (`settlement.link` / `unlink` / `link_reset` / `credit_add`).
- **Statuses.** Matched · Paid, not settled yet (red after 5 days — `DUE_OVERDUE_DAYS` is 5 everywhere, was 3) · Bank credit not matched · in TutorMint but not in the export / in the export but not in TutorMint (only inside the dates the export covers) · Amount mismatch.
- **Page.** Month cards (received from customers = our approved PayPro + bank-transfer payments by approval day; gateway fees; net settled to bank; waiting; unmatched), tabs (Needs attention, Matched, PayPro orders, Bank transfers, Bank credits), fee table per method per month, month CSV (`/api/admin/payments/settlement/month`, no member names). The payer's name on an approved receipt is read for matching and shown on this owner-only page only.
- **Two fixes.** `proxy.ts` keeps the query string in `next` (`/pay/choose?plan=premium` returns intact after sign-in; same for the phone gate). `app/api/[...notfound]/route.ts` answers any unmatched `/api/` path with 404 JSON `{"error":"Not found"}`.

### The real PayPro export could not be read — fixed (11 Oct 2026)

No migration. The first real upload answered "We could not read that file": PayPro's .xlsx is written by a .NET OpenXML writer that prefixes every tag (`<x:workbook>`, `<x:c>`), and `exceljs` matches tag names literally, so it never built a workbook and threw `Cannot read properties of undefined (reading 'sheets')` (xlsx.js:323). `lib/xlsxRead.ts` is a small values-only reader (jszip, now a direct dependency) that ignores the prefix, the BOM and absolute part paths, and returns a date-formatted number as the calendar day it shows (no time-zone shift). `lib/payproExport.ts` `readPayproExport()` is the ONE way an Orders export is read (.xlsx or .csv): the sheet named "Orders" in any case, else the first with an Order-Number header; header found in the first ten rows; the eight required columns by name, a missing one named ("Missing column: Settle-Date"); "EasyPaisa" stored as Easypaisa; the totals row skipped. The customer columns are never mapped, so never stored or shown. `exceljs` is still used to WRITE the .xlsx downloads. Fixture: `scripts/fixtures/paypro-orders-export.xlsx`, built by `scripts/fixtures/payproWorkbook.ts` with the real structure, fake orders and no customer details; `npm run test:payproexport`. `scripts/report-paypro-export.ts <file>` prints counts for a local export, read-only.

## Bank credits by paste — Faysal Bank alerts read automatically (owner, 11 Oct 2026)

No migration. Settlement check → "Add bank credit" is paste-only (`app/admin/finance/settlement/AddBankCredits.tsx`); `npm run test:bankalerts`.

- **Why the first version left the boxes empty.** The tab-separated alert parsed correctly, but nothing was read on paste: it waited for a "Fill in from this text" button, so Save hit the empty required Date. With labels and values on separate lines the old line-by-line reader also lost the sender (and, with the email header, read "Faysal" from "From Faysal Bank" as the sender).
- **Reader** (`lib/bankAlertCore.ts`, pure, runs in the browser): `parseBankAlerts(text)` finds every known LABEL (Sender Name, Transaction Date, Amount Transferred, Transaction Reference, …; any case, tabs or line breaks) and takes the text up to the next label as its value. A new alert starts at each "Dear TUTOR MINT", after each Transaction Reference, or when a label repeats, so several alerts or a thread become a list. Text with no labels falls back to the sentence reader `parseBankAlert`. `planAlerts` marks each ready / already saved (recorded, or twice in the paste) / unreadable (date, amount or reference missing — only then are edit boxes shown, for the missing fields). Type = PayPro payout when the sender names PayPro, else member's bank transfer; the owner can flip it.
- **Account numbers.** The pasted text never leaves the browser — only the read fields are posted. The receiver account is never read; of the sender account only the last 4 digits are kept, in the credit's note ("Sender account ending 1949").
- **Save.** One button "Save N credits" behind "Credits can't be deleted after saving. Save N credits?". `POST /api/admin/payments/settlement/credits` now takes `{ credits: [...] }` (max 50) → `addBankCredits`: a recorded reference is skipped, the rest are saved, then the matching runs and each result carries `matchSummary` ("Matched to 2 JazzCash orders settled 9 Oct" / "No match yet"). A single refused credit still answers 409 / 400. `GET ?refs=` says which references are already recorded. The typed form is behind "Enter by hand instead".
- **Ignore (not a sale).** `links` route action `ignore` (note required, audited `settlement.ignore`, owner only like the rest). Stored as a `settlement_links` row `kind='none'`, `target='not_a_sale'` (`NOT_A_SALE`) — no schema change. The credit's state is `ignored`: never matched, not in "Needs attention", not in the unmatched count, CSV status "Ignored (not a sale)"; it stays on record and "Back to automatic" undoes it. A plain Unlink (target null) still counts as unmatched. Finance's month table "received in bank" reads `bank_transfers` directly and still includes an ignored credit.

## Profile photo crop, face-first avatars, Unmet-search actions, ignored credits out of every total (owner, 11 Oct 2026)

Migration 163 (additive, dry-run then applied before the code): `avatar_rotations.crop jsonb` + `source ('staff'|'member')`; `search_unmet.user_id` + `is_test`; table `search_unmet_done` (admin-read, server-written); `taxonomy_aliases.kind` also takes `'city'` (slug = the city's name); template `city_hiring_post`. `npm run test:photocrop`, `test:unmetsearches`; ignored-credit totals are in `test:bankalerts`. No library was added.

- **Face-first Avatar.** `components/Avatar.tsx` frames a photo with no saved crop at `object-[50%_22%]` (`AVATAR_FACE_FIRST`; `FACE_TOP` in `lib/photoCropCore.ts`) — centred, about 22% from the top. A cropped copy (`isCroppedAvatarUrl`: `cropped-<stamp>.jpg` or `photo-<stamp>-crop.jpg`) is already a framed square and is shown as it is. Selfie and document views do not use the Avatar.
- **One crop frame**, `components/photo/PhotoCropper.tsx` (round frame, drag, pinch, slider; mouse + touch events only), with all arithmetic pure in `lib/photoCropCore.ts`. A crop is three fractions of the picture: `x` = left/width, `y` = top/height, `s` = side/width.
- **Staff crop.** The admin viewer shows "Crop / adjust" next to Rotate for a profile picture only (`CropPanel` in `components/admin/DocumentViewer.tsx`). The frame works on `/api/admin/profile-photo/source` (the UPLOADED original, upright and turned by the saved rotation), so a crop is never cut from an earlier crop. `POST /api/admin/profile-photo/crop { memberId, crop }` → `lib/avatarCrop.ts` `saveAvatarCrop`: a square JPEG copy (at least 512, at most 1024) stored as a NEW object beside the upload (`upsert: false`), `avatar_rotations` updated, `profiles.avatar_url` pointed at it — so every surface, og:image and structured data show it. `{ memberId, reset: true }` = "Reset to original". Same access as rotate (`SCREEN_ACCESS.documentRotate`: owner, admin, operations); the Partner is refused by `checkAdminRole`; audited `profile_photo.crop` / `profile_photo.crop_reset`. `avatar_rotations.rotated_url` is the derived copy in use (turned and/or cropped). **A new rotation drops a saved crop** (its numbers belonged to the old turn); crop again after turning. Picture work is in `lib/avatarCropImage.ts` (buffers only, tested on a generated image).
- **Member crop at upload.** `components/photo/usePhotoCropUpload.tsx` is the ONE crop step for the onboarding photo step, complete-profile, tutor Settings and parent Settings: the picked file is shrunk in the browser (`compressImage`), framed, and on "Use photo" the photo AND a 640 px square (canvas) go to `POST /api/profile/photo` (401 signed out). The server re-encodes both (upright, metadata removed), stores `<uid>/photo-<stamp>-original.jpg` and `-crop.jpg` in `avatars`, records them in `avatar_rotations` (`source='member'`) and answers with the square's address. **Each screen then saves that address through the path it always used**, so the photo-review rules are unchanged. Staff review shows the crop with a "View original" link (`avatarOriginalUrl`). Members no longer upload to storage directly for a profile photo. `FileUpload` gained `clearAfterUpload` so the tile shows the stored square, not the file as picked.
- **Unmet searches** — `/admin/overview/todo-unmet` (its own page; `SCREEN_ACCESS.unmetSearches` = owner, admin, operations — the roles that could open the list; Tuitions staff could not and still cannot; Partner view-only). Rules pure in `lib/unmetSearchCore.ts`, I/O in `lib/unmetSearches.ts`; `loadUnmetBoard()` is the ONE loader for the Overview number, the To review tab and the actions. Left out and counted: `role='admin'` searches, `is_test` searches, and text containing "smoke test" / "test hidden". Identical searches (case and spacing) are one card. Tabs To review / Done (30 days). Actions: **Add search word** (`POST /api/admin/unmet-searches/search-word` — writes `taxonomy_aliases`, the same table as Settings → Subjects, for a subject, school, level or city; then `rerunSearch` with the dictionary read fresh and the card says "Now finds N results"); **Hiring post for {city}** (only when the search named a city; `city_hiring_post` template, Copy + WhatsApp share); **Mark done** (`POST /api/admin/unmet-searches/done`, optional note, `search_unmet_done`; a later identical search is newer than `done_at` and makes a new card). `logUnmetSearch` now records `user_id` and `is_test`. **Rows logged before migration 163 have no account on them, so a test ACCOUNT's older searches cannot be told apart** — only staff role and test text apply to them.
- **Ignored bank credits** are out of every money total: `lib/ignoredCredits.ts` `ignoredCreditIds()` + `withoutIgnored()` filter Finance "received in bank" (`lib/finance.ts`) and the range check (`lib/settlement.ts`); the month CSV skips them; the board never matched or counted them. They stay listed, greyed, under Bank credits with their note; "Back to automatic" counts them again. This supersedes the "Finance still includes an ignored credit" note in the section above.

## "Signed up today, not paid" card; parent contact number required on every tuition (owner, 12 Oct 2026)

Migration 164 (additive, dry-run then applied before the code): `jobs.pause_source` may also be `'no_contact'`. No row changed by the migration. `npm run test:tuitioncontact`.

- **Sixth Overview card** — `signups-today` ("Signed up today, not paid", pink tone, `UserPlus`; `SCREEN_ACCESS.unpaidSignups`, the list's own key). Its rows are `loadUnpaidSignups()` filtered by `signedUpIn(joinedAt, 'today', now)` (`lib/staffOutreachCore.ts`): tutors who created their account today (Pakistan-time day, `pkDayStart`) and have not paid the Verification Fee; staff, test, suspended ("paused"), banned, seed and team accounts are already out of that list. Subline "X yesterday · Y in the last 7 days" from the same rows (`signupCounts`). The card opens the EXISTING Unpaid signups list at `?filter=today` (`SIGNUPS_TODAY_HREF`) — no new list — which gained the quick filters Today / Yesterday / Last 7 days. Those three filters list every unpaid tutor of the window whether or not a follow-up was sent, so the card number equals the Today rows; the older tabs keep their follow-up rule. The Overview grid is 2 columns on a phone, 3 from `sm`, 6 from `lg`.
- **A tuition must always have the parent's contact number.** Rules pure in `lib/tuitionContactCore.ts`, I/O in `lib/tuitionContact.ts`. One stored format: the MSISDN of `lib/phone.ts` (`923001234567`).
  - **Staff post and staff edit:** "Parent contact number (required)" on the shared form's staff block; `createTeamJob` and `updateTeamJob` refuse without a valid Pakistani mobile — "Enter the parent's mobile number, e.g. 0300 1234567." — before anything is written. The other contact fields stay optional. Editing an older tuition that has no number now needs one.
  - **Parent post:** unchanged. A parent cannot post without a verified mobile (`PARENT_MOBILE_GATE_MESSAGE`), and a parent-posted tuition's number IS that verified mobile (`tuitionContactNumber`).
  - **Other paths:** only `createJob` and `createTeamJob` insert into `jobs`; there is no tuition bulk import and no script that creates one. `splitByContactNumber()` is the rule any future bulk path must use (valid rows in the one format, the rest skipped and named).
  - **Resume requires a number** on every path: Paused tuitions (one or many — a tuition with no number is left paused and the API says so), the tuition's own admin Resume, and a parent's own Reopen (which needs their verified mobile). `POST /api/admin/jobs/contact-number { jobId, phone, resume? }` (`SCREEN_ACCESS.jobsPost`; Partner refused by `checkAdminRole`; audited `job.contact_number`, plus `job.resume` when it resumes — the number itself is not written to the audit log) saves the number on a staff-posted tuition and, with `resume`, puts a tuition paused for no number back live: fresh 7 days, same row and address, Google told.
  - **Paused tuitions** (`/admin/jobs/paused`) now also lists `no_contact` pauses, shows a Reason column ("Paused after 7 days" / "No contact number"; an auto-paused tuition that also has no number says both), and has a "No contact number" filter. For a tuition with no number, Resume opens the number box first (`components/admin/AddParentNumber.tsx`, `resumeOnSave`); such rows cannot be ticked for "Resume selected".
  - **Applicants to forward:** a card whose tuition has no number shows "Add parent number" in place of WhatsApp / Call; saving it on a tuition paused for no number offers "Resume now".
  - **Public pages:** a tuition paused for no number is an ordinary paused tuition (200, noindex, no JobPosting, out of Browse and the sitemap).
- **One-time clean-up** — `scripts/dataop-pause-no-contact-tuitions.ts` (read-only without `--apply`; with it, one transaction: `status='paused'`, `paused_at`, `pause_source='no_contact'` on LIVE tuitions with no valid number only, one `admin_audit_log` `job.pause` row each with actor "system: missing contact", one `indexing_queue` notice each; nothing deleted; a second run finds nothing).

## SEO fixes from Search Console — JobPosting, sitemap index, Indexing API removals, school and area job hubs, thin-page control (owner, 12 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **the sitemap is an index of four files** (supersedes the single `app/sitemap.ts`, which is deleted); **a paused, closed or hired tuition is told to Google as URL_DELETED** (supersedes "every status change → URL_UPDATED", 5 Oct); **a tutor landing page is indexable on 3 VERIFIED tutors**, not 3 listed ones; **`/membership-plans` is indexable at its clean address** (supersedes its noindex); **`/tutor/packages` and `/parent/packages` are a 301 to the clean `/membership-plans`** (supersedes the query-carrying 308s); **JobPosting `employmentType` is PART_TIME for a tuition** (supersedes CONTRACTOR). `npm run test:seosc`; `npm run audit:seo` (read-only live crawl of the sitemap).

- **JobPosting** (`lib/seo.ts` `jobPostingJsonLd`, rules pure in `lib/jobPostingCore.ts`). `description` = `jobPostingDescription()`: two or more plain sentences built from the tuition's own fields (Job Type, level, subjects, area and city, timing, gender preference, mode, budget), then what the poster wrote. `employmentType` = `employmentTypeFor()`: PART_TIME for Home Tutor / Online Tutor; for a school post only what its own words say ("part time", "visiting", "full time", "contract"), else the field is LEFT OUT — never guessed. `hiringOrganization` = the school the post names (name only) when it is a school post, else TutorMint with `sameAs` and logo. `validateJobPosting()` checks a JobPosting against Google's required and recommended fields; the test runs it on a home tuition, an online tuition, a school job, and one with and one without a budget. **Kept as it was, on purpose:** `addressLocality` is the CITY and the area is `streetAddress` — Google matches "jobs in lahore" on the locality, and 489 of 514 clicks come from job listings; the area is still in the address.
- **Which school a post names** (`lib/schoolJobsCore.ts` pure, `lib/schoolJobs.ts` server). There is no school column: the form's school name goes into the title. A post is a job AT a school when (a) a KNOWN school (the Admission Test Prep schools in the taxonomy + `BUILT_IN_SCHOOLS`) is named in its title or description, or (b) a title segment is a school's own name (a school word plus a name; a role, class, subject list or street address is not a name). A **Home Tutor** post never has a school ("home tutor for a child at LGS" names the child's school); an **Online Tutor** post only by its own title segment.
- **Hubs.** `/tuition-jobs/school/[school]` ("<School> teacher jobs") is new; `/tuition-jobs/[city]` and `/tuition-jobs/[city]/[area|female|online]` already existed. All share `lib/hubCopy.ts`: heading, title (`hubTitle` — "Teaching Jobs in <Area>, <City> – <N> Open | TutorMint", "<School> Teacher Jobs – <N> Open Vacancies | TutorMint", shorter forms when over 60), description, an intro and three questions built from the page's live data. `components/seo/HubFaq.tsx` renders the questions and the FAQPage JSON-LD from the SAME array, and only on a page that clears its threshold. The city × subject landing pages got the same FAQ (`landingFaq`).
- **One threshold rule: 3 live items.** Open posts for tuition, city, area and school hubs; VERIFIED tutors (in `tutor_directory` with the Verification Fee paid — `verifiedTutorCounts()` in `lib/landing.ts`, `LandingCombo.verified`) for `/tutors/<city>/<subject>`. `landingIndexable(combo)` is the one predicate; `liveLandingPages()` (link blocks, the linker, "Popular searches") and the sitemap both filter through it. Below 3: the page still works, `noindex, follow`, out of the sitemap, and not linked from any link block. A tuition page links to its area hub (`areaHubFor`) and its school hub only when that hub exists.
- **Sitemaps.** `/sitemap.xml` (`app/sitemap.xml/route.ts`) is the index of `/sitemap-tuitions.xml` (open tuitions; lastmod = newest of posted / resumed / refreshed), `/sitemap-tutors.xml` (fee paid + CNIC, photo, selfie approved), `/sitemap-pages.xml` (static pages, `/membership-plans`, and hubs that clear their rule) and `/sitemap-blog.xml`. Rules pure in `lib/sitemapCore.ts`: every candidate passes through the same predicate its page uses for its robots tag, and `cleanEntries` drops query strings, fragments, other hosts and duplicates. Loaders in `lib/sitemaps.ts`. `robots.ts` still names `/sitemap.xml`.
- **Indexing API queue** (rules pure in `lib/googleIndexingCore.ts`: `indexingKindForStatus`, `planDrain`). Open → URL_UPDATED; paused (7-day sweep, staff, the member's own pause), closed, hired, merged → URL_DELETED. Never more than 200 a UTC day; URL_UPDATED before URL_DELETED, oldest first within each; an address with several notices waiting sends only its newest, and the older ones are marked superseded (`sent_at` = 1970, `last_error` = 'superseded') so they are neither sent nor counted. **Admin → Growth → Google indexing** (`/admin/seo/indexing`, `SCREEN_ACCESS.seo`, read-only): sent today of 200, waiting by kind, failed today, the newest notices with Google's answer. One-time `scripts/dataop-queue-indexing-removals.ts` (dry run without `--apply`) queues one URL_DELETED for every paused / closed / hired tuition, oldest first; it only adds queue rows.
- **Titles.** `lib/browseMeta.ts`: `/browse/tutors` "Find Verified Home & Online Tutors in Pakistan | TutorMint"; `/browse/tuitions` "Tuition & Teaching Jobs in Pakistan – Updated Daily | TutorMint" (the owner's wording, 63 characters); both descriptions name Karachi, Lahore, Islamabad and Rawalpindi and say "free to join, no commission". The tutors title is the owner's later wording and supersedes the 5 Oct "Find tutors" title; the description still says verified tutors are listed FIRST, not that all are verified.
- **Breadcrumbs** were already on every public page type; the trails now read Home › Tuition jobs › City › Title and Home › Tutors › City › Name.
- **Landing copy corrected:** the tutor landing intro and description no longer say every listed tutor is verified, identity-checked or has a video ("N <subject> tutors in <city> … Verified tutors are listed first").
- **Links to redirects:** `/faq` now links `/register` (was `/tutor/register`); tutor Settings sends a signed-out visitor to `/login` (was `/tutor/login`). `/apply` (a deliberate 307 short link to `/register`, used in blog posts) is left as it is and reported.

## SEO follow-ups — duplicate rule, area hubs from Locations only, no internal link to a redirect (owner, 13 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **the duplicate rule is "the same requirement"** (supersedes the 6 Oct "same title, or same city + area + level + subjects + gender + budget"); **an area hub exists only for an area in the curated Locations list** (supersedes "one hub per saved area value with 3+ open tuitions", 6 Oct); **posts and notifications link the final page, never `/apply` or `/account/messages`**. `npm run test:duplicates`, `npm run test:areahubs`, `npm run check:links` (read-only live crawl; exits 1 on any internal link that answers 3xx or any sitemap URL that is not 200 / is noindex / a tuition without a self canonical and a JobPosting).

- **Why open tuitions pointed their canonical at an unrelated one.** The safety net (`repeatOfOlderOpen`) used `duplicateReasons`, which matched on the title in the same place OR on city + area + levels + subjects + gender + budget. It never read the Job Type or the contact number, so a "Coordinator Required" and a "Primary Teacher Required" post in Karachi (no area, the same Grade 1–5 subject list ticked, the same budget band) were called repeats of an older "Online Tutor Required" post from a different number.
- **The rule** (`lib/duplicatesCore.ts` `sameRequirement`, the ONE rule for the page's safety net, the post-time check, the admin Duplicates view and merges): same city; same area (or both empty); same level/grade set; overlapping subjects (or neither has any; when both carry per-grade subjects, the same split); same Job Type; the same parent contact number, known on BOTH sides (`tuitionContactNumber`: `job_contacts` for a staff post, the parent's verified mobile otherwise); posted within 30 days (`DUPLICATE_WINDOW_DAYS`). Gender preference and budget are NOT compared — a repost with a changed budget is still the same requirement. `legacyDuplicateReasons` keeps the old rule only so a report can say what it used to flag. `lib/duplicates.ts` reads the contact for every candidate; `findExistingDuplicate` takes `jobType` and `contact` (no contact or city → no check); `openRepeatSlugs()` gives every open repeat in one read and **`tuitionSitemap` leaves them out**.
- **Result on production (456 open tuitions):** 3 pointed their canonical elsewhere before. **TM-1250 and TM-1253 were wrong and are fixed** (self canonical, JobPosting back, URL_UPDATED queued by `scripts/dataop-fix-wrong-canonicals.ts --apply`). **TM-1245 is a real repost of TM-1215** under the rule (the same contact number, Grade 1, the same three subjects, Online Tutor, one day apart) and stays a repeat, although the owner's instruction listed it as a wrong one — reported, not bent. Four more real reposts are now caught that the old rule missed because their budget or title differed: TM-1482 → TM-1364, TM-1738 → TM-1577, TM-1795 → TM-1579, TM-1949 → TM-1601.
- **Area hubs** (`lib/areaHubCore.ts`, pure). `resolveAreaHub(city, saved, curatedAreas)` → the curated area a saved value belongs to: the same words whatever the case, punctuation, trailing city or joining "-e-" (`exact`), or a longer value that names ONE curated area as a whole run of words, longest name winning (`contains` — "DHA Phase 5" → DHA, "Block B North Nazimabad" → North Nazimabad). Anything else — a school's name, a street address, an area not in Locations — has no area hub and its tuitions are in the city hub only. The hub address is `areaHubSlug` = the curated name without the city ("DHA Lahore" → `/tuition-jobs/lahore/dha`). `lib/cityJobs.ts` builds the area variants through `areaHubsFor`; a variant carries `areas` (every saved spelling in the hub), the list filter is `JobFilters.areas` (`.in('area', …)`), and "Show more" sends `areaHub=<slug>`, which `/api/browse/tuitions` turns back into the same list. **`jobs.area` is never rewritten.**
- **Old hub addresses.** A merged area is a **301** in `proxy.ts` (`lib/areaHubRedirect.ts`: the curated list via PostgREST with the publishable key, held in memory for ten minutes; rule `hubSlugRedirect`). An address a non-area value once made (a school's name, a street address, an unlisted area) is handled by the variant page: `retiredAreaValue` finds the saved value among the city's tuitions in any status, then `permanentRedirect` — **a 308, Next's permanent redirect, not a 301** — to the school hub when one exists, else the city hub. An address nothing ever made is still a 404.
- **Going forward.** The posting form's Area field was already the curated picker with free text allowed. A typed area that is not in Locations is saved as typed and simply has no hub until an admin adds it to Locations (there is no "unlisted" column — it is the absence from `location_areas`); staff see a hint under the field (`areaStanding`, `WhereHowWhen staff`), and a different one when the value reads as a school or academy name.
- **Links.** `ctaPathFor('tutors')` and the composed draft link `/register`; `/apply` stays a 307 in `proxy.ts` for posts outside the site and stays a known blog route. `teamMessagesHref(role)` (`lib/memberNav.ts`) is the Team conversation's final address, used by the `admin_message` notification and email; `/account/messages` still redirects for links already sent. `scripts/dataop-internal-redirect-links.ts` (dry run without `--apply`) swaps `/apply` → `/register` in stored post bodies (a `post_revisions` row and a `blog.fix_redirect_links` audit row each) and re-points stored notification links.
- **Reported, not changed:** real areas that had a hub and are not in Locations, so have none until added: Harbanspura (8 open), Izmir Town (3), Manawan (3) in Lahore; Gulzar-e-Hijri (4), Gulistan-e-Maymar (3), Garden West (3) in Karachi. `scripts/report-area-hubs.ts` (read-only) lists every saved value and where it goes.

## 15-day auto-pause, Partner full rights, Locations clean-up, blog title queue, smart tutor search (owner, 13 Oct 2026)

Migrations 165–167 (applied before the code; dry-run first). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **a tuition stays live 15 days** (supersedes the 7 days of 8 Oct); **the Partner is full management, not view-only** (supersedes 8 Oct "Partner role" and every "the Partner views; the server refuses their writes" note above); **an area hub also counts approved aliases**; **the content queue dismisses, never deletes**. `npm run test:tuition`, `test:pause`, `test:ownerprotection`, `test:locationclean`, `test:contenttopics`, `test:tutorsearch`.

- **15 days, one value.** `TUITION_LIVE_DAYS = 15` and `TUITION_LIVE_LABEL` in `lib/tuitionStatus.ts` (`PAUSE_AFTER_DAYS` is gone). `pauseDueAtMs(base)` = base + 15 days, never before `LIVE_FLOOR_MS` (2026-10-16 09:00 UTC — the one-time "3 days from the change" floor for a tuition already past 15 days on the day; none was). The nightly sweep, Resume and Refresh, JobPosting `validThrough`, the countdown, the Overview "pausing in 2 days" row and every label read it. `BACKLOG_CUTOFF_MS` = the floor. Nothing is stored for a tuition's expiry, so no row was changed; `scripts/dataop-queue-live-tuitions.ts` queued one URL_UPDATED per live tuition, newest first. Paused tuitions were not touched. No Urdu string mentioned 7 days.
- **Partner.** `isReadOnlyRole()` returns false for every role (the check and the screens that read it stay for a future view-only role); `alwaysNeedsTwoFactor('partner')` — no grace window, and `checkAdminRole` serves no admin request to a Partner session that has not passed two-factor. Migration 165 puts the Partner back into `is_admin_writer()` and the storage write policies. **Owner protection is server-side:** `ownerProtection()` / `staffChangeProblem()` (pure, `lib/adminAccessCore.ts`), applied by `lib/ownerGuard.ts` `refuseOwnerTarget()` in the member, tutor-edit, clear-mobile and second-role routes, and by the team route, `lib/staff.ts` and the two-factor reset. Nobody but the Owner changes the Owner account, makes anyone Owner, or changes / removes / resets a Partner. Deleting accounts (`/api/admin/cleanup`) and the PayPro test order stay Owner only. **Owner alerts:** `lib/ownerAlerts.ts` `alertOwner()` (in-app `owner_alert` + the `owner_alert` email) when anyone else changes bank transfer details, a gateway setting or a team role — who, before → after, Pakistan time; `lib/ownerAlertCore.ts` masks an account number or IBAN to its last 4 digits, in the alert and the audit row. There is no screen that edits plan PRICES (they are `plans` rows changed by migration), so no price alert exists.
- **Locations.** `location_area_aliases` (typed text → curated area, world-readable) and `location_ignored` ("Not an area"; admin-read); both taken back by `removed_at`, never deleted. `jobs.area` / `tutor_areas.area` are never rewritten. `lib/locationCleanCore.ts` `suggestFor()` proposes same / not an area / new area with a confidence; `lib/locationReview.ts` loads the list and applies approved actions (audited `location.area_add` / `location.alias` / `location.not_area`); `/admin/seo/locations` + `/api/admin/locations` (SCREEN_ACCESS.seo). An alias counts everywhere: `resolveAreaHub(city, raw, curated, aliases)` (hubs, the 3+ rule, sitemaps via `lib/cityJobs.ts`, which now reads curated areas and aliases LIVE), the proxy's hub redirect, the tuition area filter (`spellingsForArea`), tuition and tutor area labels (`canonArea`, `withCanonAreas`), the tutor filter counts, and `rank_tutors` through SQL `public.area_same()`. Approving re-evaluates the hub and queues its URL when it has 3+ open tuitions. `components/admin/ThreeWayReview.tsx` is the shared three-button pattern (Locations and Unmet searches).
- **Blog queue** (`lib/contentQueue/topics.ts`, pure). One topic per subject GROUP + city (`levelGroup`: Play Group and KG, Primary, Middle, Matric, FSc, FA, ICS, I.Com, O Level, A Level, IGCSE, BS…); clean title names (`subjectTitleName`; `taxonomy_levels.title_name` / `taxonomy_subjects.title_name`, editable in Settings → Subjects, win); `coveredByPost()` drops anything an existing post (published, scheduled or draft) covers; real search demand first, listed tutors only a tie-breaker; `chooseQueue()` = 30 topics, tutor career ≤ 40%, a city at a time, one City guides and one Urdu topic while those clusters have no post. The rebuild never deletes: an open row that leaves the queue is `dismissed` with `already covered: <post>` or `auto: not in the current mix`, and an automatic dismissal returns when the topic is chosen again.
- **Tutor search.** One Search word may mean several subjects (`Parsed.alsoSubjects`; "computer" → Computer Science, ICT, Programming…); the words are the existing `taxonomy_aliases` (Settings → Subjects, Unmet searches). `lib/tutorFacets.ts` gives `/browse/tutors` dropdown options that have a tutor, with counts, narrowed by the other filters. A zero result shows "Closest tutors" with what was relaxed, "Post a free tuition request" (city and area carried), and `components/search/NotifyMe.tsx`: `/api/search/notify` stores a `tutor_search_alerts` row (opt-in required, 5 an hour per visitor); `sweepTutorAlerts()` (5-minute cron) sends ONE SMS or email when a tutor who was not already listed matches, closing the request first, and closes requests after 60 days. Unmet searches: "Add as synonym of…", "Add as new subject" (owner / Partner / admin; one level; `search.subject_add`) and "Ignore" (`search_unmet_done.kind`). In `rank_tutors` the area is a ranking boost, not a filter, so an area never causes a zero result.

## Only real searches count as demand (owner, 13 Oct 2026)

Migration 168 (`anon_search_events.excluded` — `first_hit` | `repeat` | NULL = counted; applied with the recount, before the code). The anonymous search log was almost entirely crawlers: a crawler sends no cookie, so each of its requests was a new "visitor" making one search. Rules pure in `lib/searchCountCore.ts` (`npm run test:searchcount`), read by `lib/searchCount.ts` `searchNotCounted()`, which ALL three logs call before writing — `logSearchPerformed` (member timeline), `logAnonSearch`, `logUnmetSearch`. Not counted: a known bot or a missing user-agent; our own crawls (`TutorMint-link-check`, `TutorMint-SEO-audit` — the fixed user-agents of `check:links` and `audit:seo`); signed-in staff; a request that arrived with no visitor cookie (`proxy.ts` stamps `x-tm-new-visitor`, overwritten on every request — a person's next page carries the cookie and counts; a signed-in member always counts); and the identical search by the same visitor within 30 minutes. The page itself renders the same for everyone. The content queue and recruitment cards read only `excluded is null` rows, and member rows less staff and 30-minute repeats. `scripts/dataop-recount-searches.ts` flagged the old rows (a visitor seen exactly once = `first_hit`) and dismissed the open recruitment cards with "made by link-check crawl"; nothing was deleted. Known cost: a person whose only search was their very first request to the site is not counted. **(Fixed the same day — see the next section.)**

## Site identity, honest structured data, search beacon (owner, 13 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **Organization + WebSite are emitted on every public page by the site chrome**, not by the homepage; **a tutor profile is ProfilePage + Person** (supersedes Person + Service — no Service, no offers, no rating, no address, no worksFor); **an ordinary tuition's `hiringOrganization` is "Private tutoring client (via TutorMint)"** (supersedes "the platform is the hiring organisation"; a post that names its school still names the school); **a hub is CollectionPage + ItemList** (max 20 items); **a search row is written only by the beacon** (supersedes "the Browse page logs the search while rendering" and the `first_hit` rule for real browsers). `npm run test:siteidentity`, `npm run test:searchbeacon`, `npm run check:jsonld` (read-only live check).

- **`lib/siteIdentity.ts`** (pure) is the one source: name, tagline ("Free to join. No commission. No middleman."), the one-sentence description, the two-sided description, features, how-it-works steps, key pages, `HOME_TITLE`, `socialProfiles()` (the `SOCIAL_*` env vars; `sameAs()` in lib/seo delegates to it), `ORGANIZATION_ID` / `WEBSITE_ID`, and `llmsText()`. The homepage title + meta, the root layout default description, /about, the Organization and WebSite descriptions, the FAQ's first group and `/llms.txt` read it.
- **Site-wide JSON-LD:** `components/SiteChrome.tsx` renders `siteGraphJsonLd(company, support.whatsapp)` — one `@graph` of Organization (`#organization`) and WebSite (`#website`, SearchAction → `/browse/tutors?q=`). **The Organization keeps `legalName`, the registered address, email and the SECP identifier** (owner's answer, 13 Oct — the pasted spec said to drop them; the owner chose to keep them) and gained `description` and `areaServed` Pakistan; `slogan` is the tagline exactly.
- **Homepage stays LOCKED.** Only its `<title>` and meta description changed (permitted), and its own Organization/WebSite scripts moved to the chrome. The H1, hero, sections and links are untouched; the proposed visible changes are in the PR report for separate approval.
- **/about** gained: both sides (from siteIdentity, with the how-it-works steps), "What you get" (the features), "What is free, and how we earn" (Verification Fee + membership plans, no prices, link to /membership-plans), Support, and `AboutPage` JSON-LD (`mainEntity` → `#organization`). The stale "parents verify CNIC and address before posting" sentence now says mobile first, CNIC + address for the badge.
- **/faq** gained a first group, `basics` ("About TutorMint", nine questions). FAQPage data is still built from the same `FAQ_ITEMS` array the page renders.
- **Tutor profile:** `tutorProfileJsonLd` (indexable profiles only, as before) and `lib/tutorMeta.ts` `tutorMetaDescription` — "verified" is said only when the page is indexable; home/online comes from the tutor's Job Types.
- **Hubs:** `collectionPageJsonLd` on the city / area / school hubs and both landing kinds. No hub lists both tutors and tuitions, so H1s are unchanged; each hub now LINKS to the other side — a tutor landing page to the same subject's tuitions page and the city's tuition-jobs hub (only when they exist), a tuition landing page to the same subject's tutors page, a city/area hub to the city's live tutor landing pages and Find tutors, a school hub to Find tutors.
- **`/llms.txt`** (`app/llms.txt/route.ts`, static). The Indexing API still receives tuition URLs only.
- **Search beacon** (`lib/searchBeaconCore.ts` pure, `lib/searchBeacon.ts`, `POST /api/search/log`, `components/search/SearchBeacon.tsx`). The two Browse pages write NOTHING while rendering: they sign a ticket (HMAC with the service-role key, 30-minute life) carrying the surface, the stored filters, the result count and — only when nothing was found — the typed search; the client component posts it once after load (sendBeacon, fetch keepalive fallback); the route verifies it and calls the three logs with `fromBeacon: true`, which clears the cookieless-first-visit rule and keeps the bot / own-crawler / staff / 30-minute-repeat rules. The proxy mints the visitor id once per request and forwards it (`x-tm-anon-id`, always overwritten or removed) so the route logs under the same id the response cookie carries. The route always answers 204. `check:links`, `audit:seo` and `check:jsonld` only GET pages, so they add no row.

## Homepage — fourth owner authorisation (13 Oct 2026)

The homepage stays LOCKED. The owner approved exactly these three changes on 13 Oct 2026; everything else — hero design, the pill, HIRE, the red line, the Urdu line, both buttons, the tagline, layout and colours — is as it was. "How it works", the features list and live counts were considered and are NOT approved.

- **a) H1** reads "Find verified tutors in Pakistan — or find tuitions as a tutor" (`HOME_H1_LINES` in `lib/siteIdentity.ts`), replacing "Trusted, Verified Tutors/Teachers FREE". Same classes and sizes; it is set as two lines by meaning with `text-balance`.
- **b) Two cards directly below the two buttons** (`HOME_CARDS`), side by side and stacked on a phone, in the site's card style: "For parents" (Find verified tutors free · Post a tuition free · Contact tutors directly → Browse tutors, Post a tuition) and "For tutors" (Get verified · Find tuitions near you · No commission → Become a tutor, Tuition jobs).
- **c) The link block** (`components/home/HomeLinks.tsx`): the city tuition-job links, each ONCE; the busiest tutor city × subject pages that are indexable now (at most six, by live tutor count, from `liveLandingPages()`); then Browse tutors, Post a tuition, Become a tutor, Blog (`HOME_MORE_LINKS`). So that each city link appears once on the homepage, the footer leaves its own copy of those links out on `/` only (`components/HideOnHome.tsx`, the `FooterTagline` pattern). `npm run test:homepage`.

## Onboarding fixes, school-name search, PayPro payout wording, staff-added areas (owner, 13 Oct 2026)

Migration 169 (additive; dry-run then applied before the code): `profiles.email_pending_confirm`; `location_areas.created_by / created_by_name / created_at / removed_at / removed_by`; `search_unmet_done.kind` may be `'school'`. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **a tutor who signs up with an email is signed in at once and may finish onboarding and pay before confirming it** (supersedes, for tutors only, "Verification comes before the dashboard", 9 Sep — parents are unchanged); **the onboarding Subjects step is level ranges + quick picks + one search** (supersedes the per-level chip step of 7 Oct); **"Due from PayPro" is "Paid by customers, waiting for PayPro payout"**; **staff can add a curated area from the Post a tuition form**. `npm run test:levelranges`, `test:emailconfirm`, `test:missingitems`, `test:schoolsearch`, `test:staffareas`.

- **Subjects step** (`lib/onboarding/levelRanges.ts`, pure; the screen is `SubjectsStep` in `components/tutor/NewOnboardingFlow.tsx`). A range is a set of grades of ONE taxonomy level, matched by name pattern against the live taxonomy: Play Group to KG, Grade 1–5, Grade 6–8, Grade 9–10 / Matric, Part I & II, O Level, A Level, BS / University; every level or grade those leave out is its own range under "More levels". One tap selects every grade of the range; a grade can be switched off. Subjects are chosen PER RANGE (so "Matric Maths" + "FSc Physics" never becomes Matric Physics). Quick picks: Matric Maths, O Level English, Primary all subjects (= the level's MAIN subjects, not all 57), Quran / Nazra, FSc Physics — one that the taxonomy cannot honour is not offered. ONE search box finds a typed subject at every level (Search words + typos via `subjectMatches`, plus `/api/search/suggest` subject rows). Chosen items are removable chips. Minimum to continue: one level and one subject. It saves a moment after each change (the same `/api/profile/save` as Next), so leaving and returning keeps the choices. The 400-id cap is unchanged.
- **Email no longer blocks a tutor** (`lib/emailConfirmCore.ts` pure, `lib/emailConfirm.ts`). `/api/auth/register`, email + role tutor: the account is created able to sign in (`email_confirm: true`), `profiles.email_pending_confirm = true`, the tutor is signed in and sent to `/tutor/onboarding`, and OUR OWN confirmation link is emailed (`confirm_email` template; `GET /api/auth/confirm-email?u&e&s`, an HMAC over account + address; `POST /api/account/email/resend`). The onboarding flow asks for the mobile and verifies it by SMS BEFORE its steps when it is not verified (`MobileVerifyScreen` first) — a verified mobile is still required. The tutor dashboard shows `EmailConfirmReminder` ("Resend email") until the link is clicked. **While pending, no other email goes to the address** (`mayEmailAddress` in `deliverEmail`; `lib/matchEmail`). Nothing in payment, the onboarding gate or the step rules reads the email. A Supabase-confirmed change of address (Settings) clears the flag. `scripts/dataop-open-email-tutors.ts` put the existing unconfirmed email-only tutors into the same state (they can sign in with the password they chose; one `member.email_unblock` audit row each). Known trade-off: an email-signup tutor account is usable before the address is proved, so a mistyped or someone else's address stays attached until the tutor changes it in Settings; a second signup with that address is told to sign in.
- **"What's missing"** (`lib/onboarding/missingItems.ts` pure; `components/tutor/WhatsMissing.tsx`; `lib/whatsMissing.ts`). ONE list of 17 items, each done by the SAME test the steps use (`stepDone`), with "contact" shown as its two parts (mobile, WhatsApp). On the tutor dashboard and, collapsed to a progress line, at the top of every onboarding step; each row has "Fix now" → `/tutor/complete-profile?step=<step>` (the new flow now honours `?step=` — `initialStep`, `stepFromParam`). Separately it states what makes the profile visible on Google, from the real rule (`tutorIndexRequirements` in `lib/seo/indexable.ts` = the four conditions of `tutorProfileIndexable`: Verification Fee paid; CNIC, profile photo and selfie approved). Completing onboarding is NOT part of that rule, so it is not claimed. `lib/onboardingStop.ts` `flowStateByTutor()` returns the facts, the "Stopped at" label and the missing list together; the admin "Stuck in onboarding" cards show "Still to do: …" and the WhatsApp follow-up text carries the same list on its own line (or in place of `{missing}`), English, with the stored template's wording untouched.
- **School-name search** (`lib/schoolSearchCore.ts` pure, `lib/schoolSearch.ts`). `matchSchool` recognises a school's name, alias, short name (Beaconhouse, LGS, City School, Roots…) or a near-miss, as whole words. `/api/search/suggest` returns a `school` group (first in the typeahead): "Tutors and tuitions for <School>" → the existing `/tuition-jobs/school/<slug>` page, only when that page exists, plus "Tutors in <City>" when the school's first city has listed tutors. `/browse/tutors` shows the same row above the results (`SchoolSuggestionRow`). A school is never treated as a subject and nothing is added to subjects or search words; no new page is created. Unmet searches: a card whose text names a school is labelled "School" and offers "Link to school" (`kind: 'school'`, audited `search.link_school`) instead of "Add as new subject".
- **PayPro wording.** Overview "Today's to-do" and its list: "Paid by customers, waiting for PayPro payout"; under it "Based on the PayPro file uploaded <date, Pakistan time>. Upload a newer file to update." with a link to Settlement check, the date in red when the upload is older than 2 days (`payproFileNote`); each order card reads "Rs 193 · paid 8 Oct 2026 · 5 days" (`waitingOrderLine`; the amount is MerchantShare; the list is owner + Partner only).
- **Staff add an area while posting** (`lib/staffAreaCore.ts` pure, `lib/staffAreas.ts`, `components/forms/StaffAreaField.tsx`, `POST /api/admin/locations/area`). On the staff Post a tuition form and staff edit only (`WhereHowWhen staff`): any text is accepted; the field offers the city's curated areas and approved spellings; for other text it shows "Did you mean <closest>?" and "Add '<cleaned name>' as new area" (proper case, spaces tidied; a one-letter slip or swapped pair of a curated name offers that name only). Add saves to `location_areas` at once (city required; `SCREEN_ACCESS.jobsPost`), with `created_by`, `created_by_name`, `created_at`, audited `location.area_add` (`from: 'post_a_tuition'`). It never blocks posting. Admin → Locations lists these under "Areas added by staff while posting" with "Added by <name>, <date>" and "Same as existing area": the added name becomes a spelling of the chosen area and the added row is RETIRED (`removed_at`), never deleted — every reader of `location_areas` filters `removed_at is null`. The Indexing API is not used for hubs; the 3+ rule and sitemap discovery are unchanged. Parents and tutors keep the plain field and their free text still goes to the review list.

## Blog relevance and cover claims, one-time tutor email, "Project Manager" label, Partner edits tutors/parents/tuitions only (owner, 13 Oct 2026)

Migration 170 (dry-run, then applied before the code): `is_admin_full_writer()` and the write policies that use it; the `ads` / `blog` storage write policies exclude the Partner again; table `one_off_emails`. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **the Partner is no longer full management** (supersedes "Partner full rights", 13 Oct, and migration 165's effect); **the Owner and the Partner are both shown as "Project Manager"**; **a post's "Browse verified listings" box, "Related reading" and tuition cards are chosen by one relevance rule at render** (supersedes the author's ticks deciding the box, and "same subject or same city only" for related posts); **one more email may go to an unconfirmed address** (the one-time "You can now sign in to TutorMint"). `npm run test:partnerareas`, `test:blogrelevance`, `test:switchedemail`.

- **What the "Largest" cover really was.** No template, prompt or generator in this repository ever wrote "Pakistan's Largest Tutors Network". The four covers that carry it (`covers/<uuid>.jpg`) were made outside TutorMint and UPLOADED with a logo lockup that has the line in the picture. So the fix is a guard, not a template edit. The homepage pill ("PAKISTAN'S LARGEST VERIFIED TUTORS & TEACHERS NETWORK", locked) and the root layout's default `<title>` / OG alt ("Pakistan's Largest Verified Tutors Network") still say it — reported to the owner, not changed.
- **Claims** (`lib/brandClaims.ts`, pure). `bannedClaims()` / `coverTextProblem()`: largest, biggest, best, No.1 / number one, #1, most trusted, leading, top-rated. `brandLine(n)`: under 100 tutors holding the Verified badge → "Pakistan's fast-growing tutor network"; 100 or more → "100+ verified tutors across Pakistan", rounded down to the nearest 50. `superlativeClaims(body)`: sentences that make such a claim ABOUT TutorMint ("the best time to revise" is left alone).
- **Covers.** The composed cover (`lib/covers/compose.tsx`) now carries the brand line under the site line; `renderCoverPng` THROWS `CoverTextError` when the title or the line has a banned word — the one place every cover is painted. `lib/covers/render.ts` `verifiedBadgeTutorCount()` = listed, fee-paid tutors that pass the site's badge rule (`loadVerifiedBadgeOk`), read at generation time. `generate-cover` and `cover-compose` answer 400 with the words; `generate-cover` is audited (`blog.cover_generate`). **Uploads are checked too:** `/api/admin/blog/cover` reads the words in the picture (`completeWithImage`) and refuses a banned one; a read that cannot be made (no key, timeout, over 3.5 MB) never blocks an upload and answers `textChecked: false`. The editor has "Regenerate cover" under the current cover. Existing covers are not changed.
- **Relevance** (`lib/blogRelevanceCore.ts` pure; `lib/blogRelevance.ts` loads). A post's topic = its City, its level GROUP (`levelGroup`: Primary, Middle, Matric, O Level…; from the Subject field, else the title) and its subject (the Subject field without its level words). Tiers with a city: 1 subject + level + city, 2 subject + city, 3 level + city, 4 city only; without a city: subject + level, subject, level. `relevantItems()`: the PUBLIC box (`closestOnly`) shows only the closest tier that has anything — so an Islamiat post with Islamiat pages never shows Grade 4 English; what the writer and editor may link fills from tiers 1–3 and uses city-only pages only when nothing closer exists. Nothing related → empty → the box is hidden. Only INDEXABLE landing pages are candidates (`indexableLandingItems`: at threshold AND not the narrower half of a near-duplicate pair). An author's tick is only a preference among related pages. `rankRelatedPosts`: same subject, then level, then city, then cluster (a same-city post IS related, by the owner's order). `OpenTuitionsBlock` tries subject + level + city, subject + city, level + city, city, subject anywhere, then the newest (the old fallback). `LandingCombo` gained `levelName` / `subjectOnly`.
- **Writer.** `buildBlogBrief` takes the post's city and subject and offers ONLY related landing pages, the post's own city tuition-jobs page, and `namedTutors` — indexable tutors (the sitemap's list) who teach the post's subject at its level, in its city. No subject → no tutor. Prompts carry `tutorRule`, `RELATED_LINK_RULE` and `NO_SUPERLATIVE_RULE` (full draft, section, short section, fix). The checker (`collectBlogProblems`) gained kinds `superlative`, `tutor_mismatch` (a linked or plainly NAMED indexable tutor who does not match) and `unrelated_link`, active when the context carries `matchingTutorSlugs` / `relatedLandingPaths`; the publish gate passes the post (`liveCheckerData(slug, post)`), so the server enforces them. The editor computes the same sets live, pre-ticks the matching landing pages on a NEW post, marks them "matches", and offers "Tick the matching pages". A tutor the writer invents under a name nobody has cannot be detected — the prompt forbids it and a person reads every post.
- **One-time email** (`lib/switchedTutorEmailCore.ts` pure, `lib/switchedTutorEmail.ts`, `POST /api/internal/switched-tutor-email` behind CRON_SECRET, `scripts/send-switched-tutor-email.ts --dry-run | --send`). Candidates = the accounts with a `member.email_unblock` audit row. Skipped: already sent, mobile since verified, suspended / banned / self-paused, seed / test-name / hidden / staff / not a tutor, no real address. The `one_off_emails` row is inserted FIRST (a refused insert = already sent); a send Resend did not accept takes the row back; each send writes `admin_audit_log` `member.one_off_email`. Template `switched_tutor_signin`; `mayEmailAddress` allows it beside `confirm_email`. The route and script answer with counts only.
- **"Project Manager".** `PROJECT_MANAGER`; `ROLE_LABEL.owner` and `.partner`, `roleBadge`, `roleWord` (Audit rows, member page), the Team badges and role dropdown (`PARTNER_ROLE_OPTION`), the staff invite email, owner alerts. Internal role names, rights and Owner protection are unchanged. Only the Owner, on their own Team card, sees "(account owner)".
- **Partner rights** (`lib/adminAccessCore.ts`). `roleSatisfies` still admits the Partner everywhere (pages, menu, GET routes). `roleMayWrite(role, allowed)` is the new question: for the Partner, true only when the access list NAMES `'partner'`. `checkAdminRole` answers 403 "View only. Your account cannot change this." to any non-GET request where it is false — so a screen written later is view-only for the Partner by default. Lists that name the Partner: tutors, parents, users, signups, orphans, unpaidSignups, featuredWhatsapp, jobs, jobsMutate, jobsPost, pausedTuitions, duplicates, duplicatesMerge, applicantForwards, inbox, reports, tutorEdit, tutorSlug, videoVisibility, documentUnlock, documentRotate, cnicRead. Inside routes: the Partner may ban, verify or change a mobile, reveal a CNIC and clear a mobile; may NOT lift a ban (Owner), edit message templates, merge areas, or create a second-role account. Page flags that gate a write use `roleMayWrite`. UI: `useAdminReadOnly()` is true for a Partner on a page outside `partnerEditsPath()`; the layout shows a "View only" chip there. The client fetch guard is gone — the server decides. Database: `is_admin_writer()` stays on profiles, tutor_profiles, tutor_subjects, user_documents, children, jobs, job_subjects, applications, demo_requests; every other "any staff" write policy uses `is_admin_full_writer()` (no Partner). `scripts/test-partner-areas.ts` lists EVERY /api/admin write route with what a Partner may do there and fails on an unlisted route.


## Homepage — fifth owner authorisation (14 Oct 2026)

The homepage stays LOCKED. The owner approved ONE change on 14 Oct 2026: the TEXT of the hero pill. It read "Pakistan's Largest Verified Tutors & Teachers Network"; it now shows the computed brand line — under 100 tutors holding the Verified badge "Pakistan's fast-growing tutor network", 100 or more "100+ verified tutors across Pakistan", rounded down to the nearest 50. The pill's classes are unchanged (it is still upper-cased by CSS). `app/(site)/page.tsx` reads `cachedBrandLine()` from `lib/brandLineServer.ts` (recomputed at most once an hour; `BRAND_LINE_GROWING` if the read fails). Nothing else on the page changed. `npm run test:homepage`.

## "exam prep" level bug, no "Largest" anywhere, Partner lifts bans, cover generator polish (owner, 14 Oct 2026)

Migration 171 (additive, dry-run then applied before the code): `posts.cover_prompt`. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **the Partner may lift a ban** (supersedes "lifting a ban stays with the Owner", 13 Oct); **the header, footer, Organization and publisher logo is the clean lockup in `public/brand/`** (supersedes `/logo.png`, `/TutorMint-Footer-Logo-2448x752.png` and the 1200×630 mark as the Organization logo); **a composed cover is ONE fixed layout with the picture and the text in separate layers, stored as a JPEG** (supersedes the three text arrangements and PNG output of Blog part 4); **the default page title is "TutorMint — Verified Tutors & Tuition Jobs in Pakistan"**. `npm run test:blogrelevance`, `test:covers`, `test:homepage`, `test:partnerareas`.

- **Level detection** (`lib/blogRelevanceCore.ts` `groupsOfText`, `lib/contentQueue/topics.ts` `namesKgLevel`). O Level, A Level and IGCSE are read first and win over any weaker match. "Prep" is the Prep / KG level only when written as a level: alone, beside another early-years level ("Prep / KG III", "Nursery and Prep"), or before "class", "level", "section" or "grade" — never in "exam prep", "test prep", "preparing" or "Admission Test Prep". A text may name TWO groups ("O and A Level", "O/A Level"): `PostTopic.groups` (with `group` = the first), and `sameLevel` / `rankRelatedPosts` match on any of them. `levelGroup()` (the content queue and `coveredByPost`) uses the same rule. `scripts/report-claims-and-post-topics.ts` (read-only) prints every published post's computed city, level and subject.
- **No "Largest" claim.** `SITE_DEFAULT_TITLE` (`lib/siteIdentity.ts`) is the root layout's title, OG title, Twitter title and OG image alt; there is no title template in the layout (pages build "<page> | TutorMint" through `seoTitle`). A sweep of app/, components/, lib/ and of message templates, posts, advertisements, app settings, plans and the content queue found no other English superlative and no Urdu one. The banned-word list is still `lib/brandClaims.ts`.
- **Logo.** The lockups had "Pakistan's Largest Tutors Network" baked into the picture. `scripts/build-clean-logos.ts` (re-runnable) finds the tagline's rows and paints ONLY that line over with the picture's own background — nothing redrawn: `public/logo.png` → `public/brand/tutormint-logo.png` (header; Organization and Article-publisher logo, 2048×752), `public/TutorMint-Footer-Logo-2448x752.png` → `public/brand/tutormint-logo-dark.png` (footer), plus `tutormint-logo-640.png` for composed covers. The old files are kept and no longer referenced. The sources are raster, so there is no SVG. `SITE_LOGO_PATH` / `SITE_LOGO_DARK_PATH` are the one place the paths live. The 1200×630 share image (`/tutormint-logo1200x630.png`, `OG_DEFAULT_IMAGE`), the favicon, `app/icon.png`, `app/apple-icon.png` and the two PWA icons are the monogram alone and never carried the line; emails use a typed wordmark. Covers already uploaded to the `blog` bucket with the old line in the picture are not changed.
- **Partner lifts a ban.** `/api/admin/members` `unban` is `roleMayWrite(role, ['partner'])` — the Owner and the Partner, not an admin; the member page's "Lift ban" button follows the same rule. Audited as before (`member.unban`). No database change: a ban and a lifted ban write the same rows (profiles, which a Partner may already write through `is_admin_writer()`; `penalties_log` and `signup_blocklist` are server-written), recorded in migration 171's header.
- **Cover generator — still no external image service** (owner's answer, 14 Oct 2026: "No external service"). The scene of a generated cover comes from the house illustration library in `public/covers`.
  - `lib/covers/scene.ts` (pure) `sceneFor()` decides the scene from the post's subject, level, city and cluster: Islamiat/Quran → study of the Quran at a table; Physics/Science → a simple experiment; Maths → working on a notebook; English/Urdu → reading together; tutor-career → a tutor preparing a lesson; city guides → a calm local street without signage; online → a laptop video lesson; exams → revising at a desk. It also gives the student's age from the level, whether the topic is religious, and a female or male tutor that alternates across posts.
  - `lib/covers/compose.tsx`: `sceneLayer()` (the right-hand panel — city silhouette, person, motifs; NO text) and `overlayLayer()` (the clean logo top-left, the title in navy on white — at most 3 lines, auto-sized, inside `COVER_LAYOUT` margins — the brand line, the tagline `SITE_TAGLINE`, and tutormint.org). The three options differ only in the scene. `renderCoverPng` refuses (`CoverTextError`) a banned word in the title, brand line or tagline. A Matric / O / A Level / college post never shows the parent-and-small-child figure.
  - `lib/covers/encode.ts` `coverJpeg()`: the stored file is a 1200×630 JPEG under 250 KB (`covers/gen-<uuid>.jpg`, a new name each time). The preview route still serves PNG.
  - `lib/covers/prompt.ts` `coverImagePrompt()` is the scene prompt for the owner's own image tool: background scene only, no text, people rules (invented figures, no real person or lookalike, age-appropriate, religious dress only for a religious topic), no school logos, crests, badged uniforms, brands, watermarks or signage. `generate-cover` returns it with a line saying what the library drew; the editor saves it in `posts.cover_prompt` and shows it under the current cover ("Image prompt used for this cover"). An uploaded cover keeps the prompt that was open in the "Copy image prompt" box when it was uploaded.
  - Alt text is "Cover for “<title>”: <what the picture shows>." (editable). The editor's button reads "Regenerate" (three new options); "Upload your own" and its banned-words guard are unchanged. Existing covers are not changed.
  - `lib/brandLineServer.ts` is the one loader of the brand line (homepage pill and covers). `scripts/preview-covers.ts <folder>` writes sample covers offline.

## Tuition cards under posts match the level, teacher illustrations named right, clean cover prompts, TM monogram on covers (owner, 14 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **the tuition cards under a post never fall back to the newest tuitions unless the post names no level, subject or city at all** (supersedes "never empty" of 5 and 13 Oct); **the cover prompt is one clean paragraph with fixed style, colour, composition and "do not" lines** (supersedes the 14 Oct prompt text); **every composed cover carries the TM monogram top-left with the wordmark typed beside it** (supersedes the clean lockup image on covers — the lockup stays for header, footer and JSON-LD). `npm run test:blogrelevance`, `test:covers`.

- **Tuition cards** (`components/blog/OpenTuitionsBlock.tsx`; rules pure in `lib/blogRelevanceCore.ts` `tuitionSteps` / `tuitionLevelConflicts`). Steps in order, each only when the post has what it needs: subject + level + city → subject + level → level + city → level anywhere → subject + city → city → subject anywhere. A tuition whose own levels name a group and share none with the post's (a KG tuition under an O / A Level post) is never shown; a tuition with no readable level is not a conflict. Nothing relevant → no block. Only a post with no level, subject or city gets "Newest open tuitions". The heading and "See all" say "in <city>" only when the cards were chosen by the city.
- **Illustration library.** `teacher-female.png` drew a man and `teacher-male.png` a woman: `scripts/covers-build.ts` had mapped the source files the wrong way round. The two files were renamed to match what they show (man with a book = `teacher-male`, woman with a tablet = `teacher-female`), the build mapping and `lib/covers/catalog.ts` sizes corrected, and the alt text now says which ("a male teacher holding a book"). Every other file's name matches its picture. Everyday clothing in the people illustrations is kept as it is.
- **Cover prompt** (`lib/covers/prompt.ts`, scene in `lib/covers/scene.ts`). `PROMPT_STYLE` + "Scene: <who, doing what, where> for a <lesson> lesson." + people line + `PROMPT_COLOURS` (the site theme's hex values from `lib/brand`) + `PROMPT_COMPOSITION` (left 45% plain) + `PROMPT_DO_NOT`; one paragraph, at most about 120 words. Plain names only (`plainSubject` / `levelWords`: "Matric English", "FA Maths", "O and A Level", "Play Group and KG English", "BS Computer Science"); the post title, raw labels ("Grade 9 & 10 - Science", "( Part I & Part II)", "Semester 1 - 8"), cluster names, claims and brand names never appear. The scene reads the PLAIN subject, so "Grade 9 & 10 - Science English" is an English (reading) scene, not a science one. "no religious items" is added for every non-religious topic; the Quran appears only for Islamiat / Quran. A parent appears beside the tutor for a parents' post about a young child; tutor-career shows a tutor alone. The stored prompt (`posts.cover_prompt`) is that paragraph alone; what the library drew is in the `blog.cover_generate` audit row. The editor has "Regenerate prompt" in the prompt box and under a stored prompt. `subjectOfText` now also strips "Semester N - N" and "KG I / II / III".
- **TM monogram on covers.** `public/brand/tutormint-monogram.png` (869×814, trimmed with a transparent ground) is made by `scripts/build-clean-logos.ts` from `public/tutormint-logo-1080x1080.png` — the largest monogram in the repo (the favicon source is 514×485, the app icon 512). `overlayLayer()` puts it top-left at 84px high on every composed cover, the wordmark typed beside it; uploaded covers are not stamped. Covers already made are not changed.

## Cover prompts name colours, never hex codes (owner, 14 Oct 2026)

No migration. An image model can paint a hex code onto the picture as text, so `lib/covers/prompt.ts` writes colour NAMES only: `COLOUR_NAMES` (keyed by the theme's own values in `lib/brand`) — #151E6B "dark navy blue", #9AE899 "fresh mint green", #C20202 "deep red", #0A0A0A "near black", #F8FAFC "very light off-white" — and the line reads "Colours: dark navy blue, fresh mint green, deep red accents and near black, on a very light off-white background." Those five are the only colours the prompt uses. Everything else in the prompt is unchanged. `hasHexCode()` is the check; `test:covers` runs it on every post shape and `test:coverprompts:live` runs it, with the 120-word limit, on every published post through `scripts/coverPromptPosts.ts` (the same source as `scripts/print-cover-prompts.ts`). Prompts already SAVED on a cover keep their text (3 posts carried hex codes on 14 Oct 2026; `scripts/report-saved-cover-prompts.ts` counts them); "Regenerate prompt" writes the new version.

**Decisions recorded (owner, 14 Oct 2026), no code change:** the city silhouettes with a landmark mosque or shrine (Lahore, Islamabad, Peshawar, Multan) stay on every post for those cities; the typed "TutorMint" wordmark beside the monogram on composed covers stays.

## SendPK is the only SMS provider (owner, 14 Oct 2026)

No migration. TutorMint never used the second SMS adapter that sat behind SendPK in `getSmsProvider()`; it is deleted, with its tests, its sample env lines and every mention in the docs. The chain is SendPK → the console adapter in development → a stated failure in production ("SendPK is not configured. Set SENDPK_API_KEY, SENDPK_SENDER, SENDPK_TEMPLATE_ID and SENDPK_BASE_URL."). The startup check (`instrumentation.ts`) warns about SMS only when one of those four is missing, naming SendPK and the missing settings (`missingSendpkEnv()` in `lib/sms/sendpk.ts`, names only). SendPK's behaviour, its env vars, the OTP rules and the password-reset flow are unchanged. `.env.example` documents the four SendPK variables. `npm run test:delivery`.

## SMS health — the log, Admin → Settings → SMS, the hourly alert (owner, 15 Oct 2026)

Migration 172 (additive, dry-run then applied before the code). `npm run test:smshealth`; `scripts/report-sms-silence.ts` (read-only).

- **Diagnosis of the 13–15 Oct quiet period: SMS was working.** SendPK settings unchanged (all four present since 10 Sep), the Twilio removal (68a9dec) did not touch the SendPK path, and the first sign-up after the quiet period was sent at once (15 Oct 11:48 PKT, SendPK `ok`, balance Rs 9,570.40). The database shows NO `register`, `otp_send` or `otp_verify` request at all from 13 Oct 22:20 PKT to 15 Oct 11:48 PKT (every POST to those routes writes a rate-limit row, including a 400), no new account and no pending signup — so no code was asked for. Vercel keeps only about an hour of logs on this plan, so the quiet period's logs could not be read; that is why the log below exists.
- **Every SMS goes through `sendSms()`** (`lib/smsLog.ts`): the one adapter `getSmsProvider()` selects, plus a row in `sms_sends` built by `smsLogRow()` (`lib/smsHealthCore.ts`, pure — masks the number, scrubs any 6+ digit run from the error). `deliverCode()` (signup code — `recordAs: 'signup'` — verify, change mobile, onboarding, reset) and the search-alert sweep use it; a reused live code and a bridge code are recorded as `reused` / `not_sent`. Recording is best-effort and never changes what the member is told.
- **Admin → Settings → SMS** (`/admin/settings/sms`, `SCREEN_ACCESS.smsHealth = []`: Owner; the Partner views; everyone else redirected / 403): provider, the four SENDPK_* names present/missing (never a value), last successful send, sent 24 h / 7 days, failed 24 h with the last error, SendPK balance (`sendpkBalance()` — GET `/api/balance.php`, free), the newest 50 log rows and the alert history. `GET /api/admin/sms/health` returns the same.
- **Send test SMS** (`POST /api/admin/sms/test`, Owner only — `roleMayWrite` refuses the Partner; `sms_test` 5 an hour; audited `sms.test` with the number masked). SendPK sends ONLY its approved code template and fills the one `otp` variable from the first 4–8 digit run of the body, so a free-text test cannot be sent. The test body is `<HHMMSS PKT> TutorMint SMS test — <time PKT>`: the phone shows "Your TutorMint verification code is 114830…" — the time of the test, not a code, verifying nothing (`smsTestBody`).
- **Hourly alert** (`/api/cron/sms-health`, `0 * * * *`, CRON_SECRET): `smsAlertDecision()` fires when a non-test send failed since the last alert (or in the last 12 h), OR 2+ distinct numbers asked for a signup/verify code in 12 h and no SMS was sent; never within 6 h of the last alert. Records `sms_alerts`, then a bell notification (`sms_alert`) and the `sms_alert` email to every Owner: "SMS may not be sending — last successful SMS at <time PKT>. Check Admin → Settings → SMS."
- **Reported, not changed:** the "Notify me when a matching tutor joins" SMS (`alertSms`, `lib/tutorAlerts.ts`) carries no code, and SendPK sends only the code template, so every such SMS is refused (`no verification code found in the message body`) and the request closes as `send_failed`. Each one now shows as a failed "Search alert" row and can trigger the hourly alert.

## Homepage — sixth owner authorisation (15 Oct 2026)

The homepage stays LOCKED. The owner approved two things on 15 Oct 2026: the green "HIRE" word above the H1 is removed (it belonged with the old heading), and the site header's signed-out "Join free" button (beside "Login") appears on the homepage as on every public page. The H1 keeps its classes exactly. Nothing else on the page changed. `npm run test:homepage` pins it.

## Sign-up leaks: header Join free, Apply pop-up, funnel, Notify-me email, team display, approval notices, Tuitions group (owner, 15 Oct 2026)

Migration 173 (additive, dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **Notify me is email only** (supersedes "a mobile number or an email", 13 Oct); **every staff role needs two-factor** (supersedes "the Partner only"); **Staff activity is the Owner and Project Managers' only** (supersedes Admin + Tuitions staff own-activity); **the signed-out Apply pop-up leads with joining**. `npm run test:signupleaks`.

- **Header.** Signed out, every public page shows "Join free" (primary, red, → `/register`) beside "Login" (secondary outline), at every width; the button that goes where the visitor already is hides (`lib/headerAuth.ts`). Below 360px the logo steps down so both fit one row at 320px. Signed in, neither shows.
- **Return-to** (`lib/returnTo.ts`, pure): `safeReturnTo()` accepts a same-site path only — no absolute, protocol-relative, backslash, encoded-slash or control-character value — and `nextForRole()` calls it first, so every `next` on /register, /login, /verify-phone and onboarding is checked. `applyReturnPath()` adds `?apply=1`; `authHref()` builds /register or /login with `next` and `role`.
- **Apply pop-up** (`AuthGateModal`, intent apply): "Apply for this tuition", primary "Join free — new tutor" → `/register?next=<tuition>?apply=1&role=tutor`, secondary "Already have an account? Sign in" → /login with the same return-to. The card (`JobCard`) returns to the tuition's own page, not the list. Other intents keep their sign-in button and gained "New here? Join free". After sign-up a NEW tutor goes through onboarding first (`newTutorDestination`: /verify-phone → `/tutor/onboarding?next=<tuition>`; the email path the same) — applying needs a finished profile (lib/applications). `NewOnboardingFlow` now takes `returnTo` (it ignored `next`): the last screen reads "Back to the tuition", the pay screen links back, and a finished tutor is redirected straight to it. Back on the tuition, `ApplyPanel` focuses Apply with one line ("Tap Apply to send your application") and drops the flag; nothing is sent until the tutor taps. Not carried: a PayPro payment round trip (the tutor returns to the dashboard after paying).
- **Other signed-out entry points fixed:** "Sign up first to view numbers" (tuition page) went to /login — now /register with the return-to; the tutor profile's certificate "Sign in" link now returns to the profile; /register's "Sign in" link keeps `next`.
- **Daily sign-up funnel** (Overview, `SCREEN_ACCESS.signupFunnel = []` — Owner + Project Managers): Today / Yesterday / Last 7 days, public page visits → /register visits → tutor sign-up forms submitted → mobile verified → onboarding done → paid, with the drop at each step and parent sign-up forms beside it. Visits: `components/VisitBeacon` (signed-out visitors only, in the site chrome) → `POST /api/visit` → the existing bot / own-crawler rules (`lib/searchCountCore`) → `bump_site_visit()` into `site_visit_counts` (one number per Pakistan-time day per kind; no id, no IP; service-role writes, admin read). Forms submitted are counted in `/api/auth/register` (a repeat while a code is live is not counted). Counting starts at deploy; no backfill. Not an Overview "item" (it has no list to open), so outside the counts-match-lists rule.
- **Notify me → email only.** The form asks for an email (opt-in tick unchanged); a mobile is refused with "We can only send this by email." Stored mobile requests are skipped by the sweep and lapse at 60 days (there were none). No alert SMS is ever sent.
- **Team display** (`TeamClient`): for every viewer but the Owner, the Owner and the Partner are two identical "Project Manager" cards — no "(account owner)", no "One account holds the platform…", no "cannot be demoted" note, role names without descriptions. Permissions and the server's Owner protection are unchanged.
- **Owner display name** is "Alee Sabeer" (migration 173; profiles + auth metadata; email and login unchanged).
- **Blocked-attempt alert** (`alertOwnerBlocked`, `lib/ownerAlerts.ts`): when Owner protection refuses a non-Owner (edit / pause / suspend / ban / warn / mobile / two-factor / remove / demote the Owner, or make anyone Owner), the Owner gets a bell notification and an email (who, what, when in Pakistan time) and `admin_audit_log` gets `owner.protection_blocked`. A Partner-protection refusal is not this alert. Wired in `refuseOwnerTarget` (every caller now says what was tried), the team route, the two-factor reset and `lib/staff.ts`. A Partner's write on the Team screen is refused earlier by the view-only rule, so it raises no alert.
- **Two-factor for all staff.** `alwaysNeedsTwoFactor` is true for every staff role; `checkAdminRole` refuses any admin request from a session that has not passed two-factor (the admin layout already showed the setup screen to everyone once the 25 Sep grace ended).
- **Approval / rejection notices.** Before: tutor CNIC/photo/selfie approve → in-app only; reject → in-app + email; a re-upload decision → in-app only both ways; parent partial approval → in-app only; parent full verification → in-app + email; parent CNIC re-upload → in-app only; no SMS anywhere. Added the missing emails (new `document_approved` template; `verification_rejected` reused for re-upload rejections, with the "earlier approved one stays on record" line). Still no SMS.
- **WhatsApp after approval.** Templates `documents_approved` (fee not paid → pay link `/pay/choose?plan=verified`) and `documents_approved_paid` (fee paid → public profile link), English, no amount, editable in Team inbox → Templates; `lib/documentsApprovedCore` picks and fills. When CNIC, photo and selfie are all approved, the review card (member page and Verification → Tutors) shows "Send WhatsApp" → wa.me to the tutor's WhatsApp, else mobile; the click is logged in `member_follow_ups` (source `documents`, migration 173) with the Audit + timeline rows every follow-up writes.
- **Tuitions sidebar group:** Tuitions, Post a tuition, Paused tuitions, Duplicates, Applicants to forward, Tuition posting activity. Tuitions staff now open Duplicates (view; merging stays admin + Partner).
- **Tuition posting activity** (`/admin/jobs/posting-activity`, `SCREEN_ACCESS.tuitionPosting` = admin, operations, tuitions staff, Partner + Owner): one row per staff member who posts (tuitions staff and operations always; anyone else once they posted in the last two weeks) and a Team total; Today | Yesterday | Last 7 days | Today vs Yesterday (today so far against yesterday up to the same time, Pakistan time; "—" when that is 0) | Last 7 days vs the 7 before | Repeated tuitions this week (red, linking to Duplicates). Sorted by Today. Read from `admin_audit_log` `job.post` by actor; maths pure in `lib/tuitionPostingCore`.
- **SMS Point cleanup:** removed from `.env.example` (`SMSPOINT_*`), comments, and this file's current-status notes; its old "Part 7 stage 2" section is now a short superseded record. `scripts/sms-probe.ts` (a dev probe of that provider) and migration 74 keep their historical mentions.

## "Onboarding done" is stamped by the server; back to the tuition after paying (owner, 15 Oct 2026)

Migration 174 (additive: `payments.return_to`, applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **`tutor_profiles.onboarded_at` means every required onboarding step is answered** (supersedes "stamped when the tutor reaches the last step or dismisses the flow", PR78 §D.2 and 14 Sep). `npm run test:onboardingdone`; read-only `scripts/report-onboarding-done.ts`.

- **Why "Onboarding done" read 0.** The new flow (on for everyone since 3 Oct) wrote the flag only from a leave button; a tutor who finished the steps went from "Complete your verification" to `/pay/choose` → PayPro → `/pay/return` → dashboard and never pressed one. Since the payment choice screen (11 Oct) nobody came back through the flow, so nothing was stamped.
- **The rule** is `onboardingStepsComplete(facts)` (lib/tutorFlow): verified mobile + every `NEW_FLOW_ORDER` step except `verify` (the fee is its own funnel step). **One writer**, `markOnboardedIfComplete(userId, via)` (lib/onboardingDone, service role, `is null` guard, `onboarding_done` activity event), called by `/api/tutor/onboarding` (`complete` — sent by the flow on reaching the fee step or the last screen; `dismiss` no longer stamps an unfinished tutor), `/api/profile/save`, `/api/documents/upload` (CNIC/selfie), `/api/identity` and the fee activation. `test:onboardingdone` fails if anything else writes the column.
- **The new flow's Contact step = verified mobile + WhatsApp** (`stepDoneIn`); the tagline + bio are their own later step. Judged by the old flow's rule, a tutor at the CNIC or tagline step was sent back to Contact on every return and Admin showed "Stopped at: Contact". **WhatsApp can no longer be skipped** — it was optional on screen but required by the rule, so tutors who finished everything else could never be done.
- **"Stopped at" read subjects through the 1,000-row cap** (`flowStateByTutor` fetched every tutor_subjects row for 80 tutors at once), so tutors with subjects showed "Stopped at: Subjects". `flowFactsByTutor` now pages every read and COUNTS subjects per tutor.
- **Back to the tuition after paying.** The flow's pay button is `payChoiceHref('verified', returnTo)`; `/pay/choose?next=` passes it to the PayPro checkout and the receipt upload, which store it as `payments.return_to` (fee only, same-site only). `/pay/return` sends a paid tutor to `afterFeeReturnPath(return_to, 'paid')` (the tuition with `?apply=1&paid=1`: "You're ready — tap Apply"). After a receipt, the choice screen links "Back to the tuition", and the tuition's Apply waits with "You can apply as soon as we approve it" while the receipt is under review; the approval notification links back to the tuition. The apply-gate verify sheet carries the tuition the same way.
- **Data:** `scripts/dataop-onboarding-done.ts` set the flag (dated at each tutor's last onboarding action) for tutors who had genuinely answered every step, one `tutor.onboarding_done` Audit row each. Tutors already flagged with a step missing (old dismissals) were listed, not changed.

## Sign-ups by staff — join links, credit, claims, board; Admin gets Staff activity back (owner, 15 Oct 2026)

Migration 175 (additive, dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **Admin opens Staff activity again, view only** (supersedes "Staff activity is the Owner and Project Managers' only", earlier the same day); **the /register form has a sixth, optional field "Staff code (if someone helped you)"**; **`city_hiring_post` and `seeded_tuition_live` carry `{join_link}`**. Rules pure in `lib/staffSignupsCore.ts`, I/O in `lib/staffSignups.ts`. `npm run test:staffsignups`, `npm run test:staffsignups:live`.

- **Participants** = staff with `admin_role` tuitions_staff, operations or admin, not paused (`isActiveParticipant`). A role given later is covered automatically (`ensureJoinLinks`, run by the board); a removed or paused staff member keeps past credits and earns none. The Owner and the Project Managers carry no link.
- **Join link and code.** `/join/<slug>` (`app/join/[slug]/route.ts`): a 307 to `/register` keeping `next` (same-site only) and `role`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`, disallowed in robots. It records a `staff_referral_visits` row and sets the httpOnly `tm_staff_ref` cookie for 30 days — unless the browser already holds a valid credit (first link wins). An unknown slug, an inactive participant or a crawler gets the same redirect with no credit. The code (the slug in capitals) typed on /register gives credit only when there is no valid credit; an unknown code is ignored and never blocks sign-up. Links: `scripts/dataop-create-join-links.ts`.
- **Credit at account creation** (`creditNewAccount`, silent, never affects the sign-up): `/api/auth/register` for an email sign-up (tutor and parent), `/api/auth/register/verify` for a mobile one. One row per account (`member_id` primary key, inserts ignore a second). Refused (`creditRefusal` / `linkCreditRefusal`): not a tutor/parent; test/staff (`is_test_name`, `hidden_from_public`, `is_seed`, `is_team_account`, role admin); the mobile/WhatsApp or email of ANY staff account; a duplicate — an OLDER account with the same mobile/WhatsApp or email (a linked second-role account is caught by this); an account created more than a minute before the link was opened. Audited `staff.signup_credit` (actor = the staff member, `automatic: true`).
- **Claims** (`POST /api/admin/staff-signups/claims`, `SCREEN_ACCESS.staffSignupClaim`): a participant enters the mobile or email and a note; allowed only for an account that signed up in the last 30 days with no credit and passing the rules above; one pending claim per account. **Claims to review** (`/admin/jobs/posting-activity/claims`, `SCREEN_ACCESS.staffClaimsReview` = Owner + Admin decide, Project Managers view): Approve / Reject with an optional reason (`/api/admin/staff-signups/claims/decide`). **Nobody decides their own claim** (`mayDecideClaim`) — Aqsa's claims go to the Owner. Audited `staff.signup_claim`, `staff.signup_claim_approve` / `_reject`; the claimant sees the result under "Your claims".
- **Milestones**, each counted on the day it happened (Pakistan time): tutors Signed up (`profiles.created_at`) → Mobile verified (`phone_verified_at`) → Onboarded (`tutor_profiles.onboarded_at`) → Paid (the first approved, not refunded `verified` payment, `reviewed_at` — admin-comped fees do not count); parents Signed up → Mobile verified → Posted a tuition (first `jobs.created_at`). `loadCreditedAccounts` is the one loader; `accountsAt` is the one rule for both a board number and the list behind it.
- **Board** = Tuitions → Tuition posting activity, tabs "Tuitions posted" and "Sign-ups by staff" (`?tab=signups&period=today|yesterday|last7|month`). Tutor table (sorted by Paid) with "Paid: Today vs Yesterday" (same time of day), parent table below; each number opens `/admin/jobs/posting-activity/signups` (name, masked mobile, date, current step). The Owner, Project Managers and Admin (`seesEveryone`, `SCREEN_ACCESS.staffSignupsAll`) see every row and the Team total; everyone else only their own row and lists — another person's list is refused on the server (`loadSignupList`; `GET /api/admin/staff-signups/list` answers 403). Counts only; mobiles masked.
- **Your join link** (copy link + code) shows on the Sign-ups tab, on the participant's Two-factor page (`/admin/security`, the one page every staff role opens) and on their Staff activity page.
- **`{join_link}`** is filled with the SENDING staff member's link (`fillJoinLink`, `hiringPost`): Unmet searches → hiring post, and Admin → tuition → "Message parent (WhatsApp)". A sender with no link sends `/register`. Migration 175 changed the two bodies only where they were still the seeded wording. Templates sent to existing members were not touched.

## Team activity — one page for staff numbers; paid sign-ups first; sidebar column (owner, 15 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **"Staff activity" and "Tuition posting activity" are one page, Tuitions → Team activity (`/admin/team-activity`)**; the old addresses are redirects. Rules pure in `lib/teamActivityCore.ts`. `npm run test:teamactivity`.

- **Tabs** (`tabsFor` / `pickTab` / `mayOpenTab` — read by the page, `GET /api/admin/team-activity` and the test): **Paid sign-ups** (default; `SCREEN_ACCESS.tuitionPosting`), **Tuitions posted** (same), **Verifications & messages** (`SCREEN_ACCESS.staffActivity` = Owner, Project Managers, Admin; the API answers 403 to Operations and Tuitions staff, the page falls back to the default tab). The screen key of the page is still `tuitionPosting`.
- **Paid sign-ups.** Tutors table: Paid sign-ups (approved, not-refunded Verification Fee) first, sorted by it, "Paid: Today vs Yesterday" beside it; the Team total row is the number used for staff pay. A separate **"In progress (not counted)"** block — Signed up / Mobile verified / Onboarded for tutors who have NOT paid (`inProgressAt` in `lib/staffSignupsCore`; `BoardRow.inProgress`), each number opening `/admin/team-activity/accounts?…&inprogress=1`. A paid tutor is never in progress and in-progress numbers never add to Paid. "Parents (for information)" below; footer "Only paid tutor sign-ups count as results."; "Claims to review (n)" for Owner / Admin. Operations and Tuitions staff see their own row only (unchanged).
- **Verifications & messages:** one row per staff member + Team total: approved, rejected, messages sent — Today | Last 7 days | Total; each number opens the staff detail page.
- **Moved / redirects:** `/admin/jobs/posting-activity` → `?tab=posted` (`?tab=signups` → Paid sign-ups, period kept); `/admin/staff-activity` → `?tab=verifications`; `/admin/staff-activity/<id>` → `/admin/team-activity/<id>`; `/admin/jobs/posting-activity/signups` → `/admin/team-activity/accounts`; `/claims` → `/admin/team-activity/claims`. Query strings are kept.
- **Sidebar:** one "Team activity" entry in the Tuitions group; the "Staff activity" (People) and "Tuition posting activity" entries are gone.
- **Sidebar display bug.** The desktop sidebar was `position: fixed; inset-y-0` — exactly one screen tall — so on a long page (and in any full-page capture) the dark panel ended after the first screen, around the Marketplace heading, with white below. Reproduced in headless Chrome at 1366×768 (sidebar 768px on a 4,053px page). `AdminShell` now lays out as a flex row: the `<aside>` column stretches to the full page height (dark top to bottom), and the panel inside it is `sticky top-0 h-dvh` with its own scrolling list (`min-h-0 overflow-y-auto overscroll-contain`). The mobile drawer is unchanged (fixed overlay).

## Owner-only approvals; Team activity loses its Verifications tab; Follow-ups, Finance tabs, Reports & flags, Paid list periods (owner, 15 Oct 2026)

Migration 176 (applied before the code; dry-run proof in `scripts/apply-migration-176.ts`). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **only the Owner approves** (supersedes every grant of approve/reject/unlock/CNIC-number/receipt/claim rights to admin, operations or the Partner above); **Team activity has two tabs** (supersedes the "Verifications & messages" tab of earlier today); **Unpaid signups and Abandoned signups are People → Follow-ups**; **Settlement check is a tab of Finance**; **Reports and Flagged messages are one page**; **Payments → Recent payers is retired**. `npm run test:ownerapprovals`.

- **Owner-only approvals.** `canApprove(role)` (lib/adminAccessCore, Owner only) and `refuseUnlessOwnerApproval(actor, what, target)` (lib/ownerGuard): every approval route calls it after its view gate — tutor and parent document review, tutor video approve/hold (suspend/unsuspend unchanged), the CNIC number (`/api/admin/tutors/edit` set-cnic-number and the "Read number from photo" action), the staff upload-and-approve route (`/api/admin/tutors/media`), document and profile-photo rotate/crop, unlock, bank-transfer receipt decide, staff sign-up claim decide. Every other role gets 403 `OWNER_ONLY_APPROVAL` and the Owner gets the existing blocked-attempt alert (bell + email + Audit, titled "Blocked attempt at an Owner-only approval"). Screens hide the controls through `useCanApprove()` (components/admin/ReadOnly, set by the admin layout) and show "View only — approvals are made by the Owner." Queues and records stay open to the same roles as before. Approval-waiting notifications are unchanged. The "Send WhatsApp" after approval is not an approval and is unchanged.
- **Database.** Column grants already stop a signed-in token writing most approval columns. Two were writable by a staff token: `profiles.cnic_number` (via `is_admin_writer`) and the `payments` decision columns (via `is_admin_full_writer`). Migration 176 adds the BEFORE UPDATE trigger `owner_only_approval` on profiles, tutor_profiles and payments: a signed-in staff account that is not the Owner cannot change an approval column (42501). The service role, SQL sessions and members are untouched; no policy or row changed.
- **Team activity:** tabs Paid sign-ups and Tuitions posted. `?tab=verifications` and `/admin/staff-activity` land on Paid sign-ups; the API answers 404 for that tab. The staff detail page `/admin/team-activity/<id>` keeps the tuitions they posted (counts, by city, the list) and drops verifications and messages; staff names on the Tuitions posted tab link to it for Owner, Project Managers and Admin. Approvals and messages stay in Audit.
- **Follow-ups** (`/admin/follow-ups`, rules lib/followUpsPageCore): Tutors (the Unpaid signups list, `SCREEN_ACCESS.unpaidSignups`), Parents & email not confirmed (Abandoned signups minus tutors who have not finished — `onParentsTab`), Orphaned accounts (both `SCREEN_ACCESS.signups`). Tuitions staff see Tutors only. Old addresses redirect with the query kept. Tutors with an unfinished profile who joined more than 30 days ago, or who already paid the Verification Fee, were on Abandoned signups and are on no tab now (the Tutors tab is the 30-day unpaid list) — reported to the owner, not changed.
- **Finance** tabs Finance | Settlement check (`/admin/finance?tab=settlement`, lib/financeTabsCore); `/admin/finance/settlement` redirects with month/from/to kept. Access unchanged; settlement actions stay Owner only.
- **Reports & flags** (`/admin/reports`, `?tab=flags`); `/admin/flags` redirects. Same roles and actions.
- **Paid today list** has a period switch Today | Yesterday | Last 7 days | This month (`feePayersInRange`, the Recent payers rule); the card still counts today. `/admin/payments/payers` redirects to it (its `?period`, else This month).
- **Sidebar:** People = People, Follow-ups, Featured WhatsApp, Team; Marketplace loses Settlement check; Trust = Reports & flags, Team inbox, Audit.

## Monthly paid sign-up targets; Follow-ups → Tutors groups (owner, 16 Oct 2026)

Migration 177 (additive, dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **a paid sign-up counts tutors AND parents** (supersedes "staff are paid for paid TUTOR sign-ups only", 15 Oct); **the Paid sign-ups tab is a month at a time against targets** (supersedes its Today / Yesterday / Last 7 days / This month tables). `npm run test:stafftargets`.

- **The paid rule** (`lib/staffTargetsCore.ts` `isQualifyingPayment` / `firstPaidAt`, read by `loadCreditedAccounts`): a credited account counts ONCE, on the Pakistan-time day its first qualifying payment was approved (`payments.reviewed_at`). Tutor = an approved, not refunded `verified` payment (the Verification Fee; a free admin grant writes no payment, so it never counts). Parent = an approved, not refunded `parent_…` plan purchase. Computed from the payments as they are now: a refund drops the count from its month; a later kept payment counts in its own month. The board, team strip, chart and the lists behind them all read `CreditedAccount.at.paid`.
- **Targets** (`lib/staffTargets.ts`): per staff per month in `staff_monthly_targets`; the list in `staff_target_list`. The current and later months use the stored list; a PAST month's list is the staff with a target row for it (`targetListFor`), so history keeps its own targets and results. Staff not on the list are "No target": shown with their paid count, never in the team target or team paid number.
- **Pace** (`paceFor`): expected = target × elapsed days (today's fraction included) ÷ days in month; On pace ≥ 100%, Slightly behind 80–99%, Behind < 80%; a reached target is On pace with "Target reached ✓". Needed per day = (target − paid) ÷ days left including today, rounded UP to one decimal; null once the month has ended.
- **Set targets** — `POST /api/admin/team-activity/targets` (`set` with month + targets; `list` to add/remove someone): Owner only by `refuseUnlessOwnerTargets` (lib/ownerGuard) — every other role 403 `OWNER_ONLY_TARGETS` and the Owner gets the blocked-attempt alert ("Blocked attempt to change staff targets"). Audited `staff.targets_set` (month, before → after per person) and `staff.target_list`. An empty box leaves a target as it is. The panel ("Set the same for all", "Copy last month's targets", per-person boxes, add/remove) renders for the Owner only.
- **Who sees what** (`targetScope`, cut on the SERVER in `loadTargetBoard`; the same board is `GET /api/admin/team-activity/targets` and `?tab=paid`): Owner, Project Managers, Admin — everything (PM and Admin view only). Staff on this month's target list — their own card, own chart line, own In-progress lists and the team status chip. Other staff — their own paid count and In-progress lists. `?staff=<other>` from anyone who does not see everyone → 403; the accounts lists keep their own 403.
- **Tab layout** (`app/admin/team-activity/PaidTab.tsx`): month picker; team strip; one card per target-list staff member sorted by % of target (paid / target, %, status bar, Tutors · Parents split linking to the lists, Today / Yesterday / Today vs Yesterday in the current month, needed per day); the running-total chart vs the target line (`CumulativeChart.tsx`, per-person toggle); "No target" and "In progress (not counted)" collapsed (tutors: Signed up / Mobile verified / Onboarded; parents: Signed up / Posted a tuition — not paid yet). The accounts list takes `?month=YYYY-MM` and parents' `step=paid`. The wide tables are gone. Tuitions posted is unchanged.
- **Follow-ups → Tutors** gained three groups (`?scope=`; `tutorInScope` in lib/staffOutreachCore): "Last 30 days (unpaid)" (default, unchanged), "Older than 30 days (unpaid)", "Paid, profile not finished" (an approved, not refunded fee payment and `onboarded_at` null, any join date; shows "Still to do" and the same WhatsApp follow-up). The follow-up chips apply within a group; the sign-up-day chips only to the default group.

## Tuitions on Google; "Started payment, didn't finish"; target counting start; cleaner staff posting; quick rejection reasons (owner, 16 Oct 2026)

Migrations 178, 179, 180 (additive; dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **a PAUSED tuition stays indexable and in the sitemap for 60 days after it was paused** (supersedes PR28 / 12 Oct "paused → noindex" and the 12 Oct "paused → URL_DELETED"); **pausing sends URL_UPDATED**; **the Indexing API day is Google's Pacific day**; **Overview "Payments waiting over 1 hour" is "Started payment, didn't finish"**; **staff choose the city from the curated list only**; **Locations merges are Owner-only** (the merge route was open to admin/operations before). `npm run test:tuitionsgoogle`, `test:stafftargets`, `test:rejectreasons`.

- **Paused pages** (`lib/tuitionStatus.ts` `tuitionPublicState(status, pausedAt)`, `PAUSED_INDEXABLE_DAYS = 60`; `lib/seo/indexable.ts` `tuitionIndexable({ pausedAt })`). A paused page: 200, indexable and in the sitemap until 60 days after `paused_at` (then noindex + out of the sitemap; the page stays live), banner "This tuition is no longer accepting applications", NO JobPosting (BreadcrumbList kept), Apply, the contact line and the contact reveal hidden, "Similar open tuitions" (same city + subject or level first, then the city; `similarOpenTuitions(..., 'match-first')`, max 6, open only). Resume restores JobPosting with a fresh validThrough; same URL always. Closed/hired unchanged (noindex). The SQL mirror is `indexable_tuitions()` (migration 178: open, or paused with `paused_at` in the last 60 days, not merged, the fixture/test/thin rules) — the tuition sitemap reads it; `indexable_job_slugs()` is kept unchanged for older callers.
- **Indexing API** (`lib/googleIndexing.ts`, rules in `lib/googleIndexingCore.ts`): open and paused → URL_UPDATED, closed/hired/merged → URL_DELETED; posts (priority 2, `queueIndexingUpdate(job, { newPost: true })`), edits that change the page (`updateJob`, `updateTeamJob`), pauses, resumes and refreshes are queued; never more than 200 per Google day (`pacificDayStart` — the old UTC count caused the "Quota exceeded" refusals); failures retried with backoff (`retryDelayMs`, `MAX_ATTEMPTS` 6), a quota refusal waits for the next Pacific midnight. Admin → Google indexing has an "Indexing API health" box (sent today of 200, the last 7 Google days, the last 10 errors).
- **Fresh internal links** (`lib/newestTuitions.ts`, `components/seo/NewestTuitions.tsx`): "Newest tuitions" (latest 10 live in the scope, by title) on the homepage's approved link block (only that block changed), every city hub and its variants, and every city × subject page (both kinds). The city hub (page 1, no variant) also lists every other live tuition in the city as plain links ("All open tuitions in <City>"), so no live tuition in a city with a hub is linked from nowhere. Every tuition page links its city hub ("See all tuition jobs in <City>", only when the hub exists) and its city × subject page.
- **Started payment, didn't finish** (`lib/startedPaymentCore.ts` pure, `lib/startedPayment.ts`): a pending checkout over an hour old, NOT a bank-transfer receipt waiting for staff, one per member and package; it leaves the list 48 hours after it started or as soon as the member has an approved, not refunded payment for the same package (or the fee is stamped). The Overview row (key `todo-payments`) and Follow-ups → Tutors chip "Started payment, didn't finish" (`scope=started_payment`) read the same loader; the WhatsApp uses template `payment_not_finished` (`{name}`, `{pay_link}` = `/pay/choose?plan=<code>`; no amount).
- **Targets counting start** (migration 179 `staff_target_months`; `lib/staffTargetsCore.ts`): pace, status, needed per day and the chart's target line count from the month's counting start (default the 1st; October 2026 = 15 Oct). Paid sign-ups before it still count in the month total. Set by the Owner in Set targets, audited in `staff.targets_set`.
- **Staff posting** (shared `PostTuitionForm`, staff branch only): (1) a typed area that names a curated area with a block or landmark around it (`splitAreaLandmark` in `lib/staffAreaCore.ts`, the area-hub "contains" rule) selects the curated area when staff leave the field and moves the rest into "Block / landmark" (`jobs.area_landmark`); the tuition page shows "Clifton (Block 1)"; "Add as new area" only when there is no curated match. Admin → Locations suggests "same as <area>" + landmark for each staff-added area (`staffAreaSuggestions`), approved by the Owner one at a time or "Approve all suggestions" — the existing merge (alias + retire) plus `area_landmark` on that city's tuitions saved with that name; audited `location.alias` + `location.landmark`; URLs unchanged. (2) City is a dropdown of curated cities; `createTeamJob`/`updateTeamJob` refuse anything else (`curatedCityName`, `matchCuratedCity`). (3) Title check warnings (`lib/tuitionTitleCheck.ts`): misspelt known school (one-tap fix), junk in the school slot, stray commas, post type vs level (e.g. "O Levels Teacher" with "FSC Part I"); never a block. `buildTuitionTitle` strips stray commas.
- **Quick rejection reasons** (`lib/rejectReasonsCore.ts`, `components/admin/RejectReasonPicker.tsx`): seven one-tap reasons + optional text on the tutor and parent review cards; the in-app notice, the email and the WhatsApp re-upload text carry the chosen reason; "This is not the right document." only as the fallback (a reject with no reason now uses it instead of being refused; the parent's typed address still needs a written reason).

## Indexing API for tuition pages only; Locations in pages and batches (owner, 16 Oct 2026)

Migration 181 (additive, applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **the Indexing API is sent ONLY single tuition pages** (`/tuitions/<city>/<public slug>`; supersedes the 15 Oct "approving an area alias re-evaluates the hub and queues its URL" and every other hub notice); **Locations approvals are the Owner's on the server, one kind at a time, in batches** (supersedes the single "Approve all suggestions"). `npm run test:indexinglocations`; read-only `scripts/report-indexing-locations.ts`, `scripts/report-sitemaps-googlebot.mjs [--check-redirects]`.

- **Only tuition pages** (`isTuitionPageUrl` in `lib/googleIndexingCore.ts`: our host, `/tuitions/<city>/<slug ending in a 6+ hex suffix>`, no query). `enqueueIndexing` and `enqueueAndDrain` refuse anything else; the drain marks any waiting non-tuition notice `not_tuition`. Hubs, landing pages, tutor profiles, blog and static pages are found through the sitemap only. The source of the hub notices was `applyLocationActions` re-checking area hubs after an approval — removed (`hubsQueued` is always empty). `scripts/dataop-mark-hub-notices.ts` marked the 37 waiting hub notices (one `indexing.skip_not_tuition` audit row); none had been sent.
- **Before each send** the notice must be the tuition's CURRENT address (from `jobs`: city segment + slug, not merged) and the live page must answer 200 with no redirect and a self canonical (`pageCheckVerdict`; a network error or 5xx is retried, not skipped). Otherwise it is marked `old_address`. One waiting notice per URL (`planDrain` supersedes older ones). Priority order unchanged.
- **Quota.** After a "Quota exceeded" refusal (`quotaReachedToday`) nothing is sent until the next Pacific midnight. "Sent today" counts every attempt except quota refusals — Google's documentation charges requests it accepts; a refused request is not believed to count (not verified with Google). The health box shows "Not sent today" by reason, a banner while stopped, and "Last 10 errors" newest first.
- **Sitemap.** `iso()` clamps a lastmod to now. The 60-day paused rule is `indexable_tuitions()` (SQL) and `tuitionIndexable` (TS); on 16 Oct no paused tuition was older than 60 days.
- **Locations** (`/admin/seo/locations`): two sections, "Staff-added areas" and "Typed by tutors and parents". The typed list loads a page at a time (`GET /api/admin/locations?kind=&q=&offset=`, 40 rows, suggestions computed on the server, `loadLocationReviewPage`). Bulk approval is one button per kind ("Approve all “Same as an area” (N)", "Not an area", "New area"): `GET ?kind=…&bulk=1` (`bulkReviewActions`) returns the rows and a sample of 5, a confirm shows the count and the sample (New area adds a warning), then the screen posts batches of 20 (`runBatches`, `lib/batchRunCore.ts`) with a progress bar; a failed batch never stops the rest and the screen lists what did not save. `POST /api/admin/locations` takes at most 25 items and is Owner-only (`refuseUnlessOwnerApproval`, before any write). Staff-added areas: each card has "Same as area" (the city's curated areas) and "Block / landmark", pre-filled from the suggestion and editable; `approve_suggestion` takes optional `intoAreaId` + `landmark` (same city, not retired, ≤120); "Approve all suggestions" confirms with a sample and approves one area per request with a progress bar. The server's `approve_all` action is removed. Approving never changes the typed text; nothing is deleted.
- **What the timed-out "Approve all" of 16 Oct (13:56–13:57 PKT) did:** it finished on the server — 120 new curated areas, 142 spellings saved against 68 areas, 44 values marked "Not an area"; nothing deleted. Afterwards 1 typed value was still waiting.

## My sign-ups; review of the 16 Oct bulk-approved areas (owner, 16 Oct 2026)

Migration 182 (applied before the code; its dry run proved the new policies as every staff token). `npm run test:mysignups`, `test:mysignups:live`, `test:locationrunreview`; read-only `scripts/report-run-review.ts`.

- **Tuitions → My sign-ups** (`/admin/my-signups`, `SCREEN_ACCESS.mySignups` = admin, operations, tuitions staff; the Owner and the Project Managers pass and are told they carry no link). Rules pure in `lib/mySignupsCore.ts`, I/O in `lib/mySignups.ts`. Each staff member sees ONLY the people credited to their own link, code or approved claim: the page and `GET /api/admin/my-signups` use the signed-in actor's own id and take none from the request, and since migration 182 the database refuses another staff member's `staff_signup_credits` / `staff_signup_claims` / `staff_join_links` / `staff_referral_visits` rows to a staff token (the Owner, Project Managers and Admin read all — `public.sees_all_staff_signups()`).
- **One row per person**: name, FULL phone, email (a synthetic `@users.tutormint.org` address is not shown), city, Tutor/Parent, signed-up date, Join link / Staff code / Approved claim, the step (tutors Signed up → Mobile verified → Onboarded → Paid; parents Signed up → Posted a tuition → Paid), "Next step for them" (Verify mobile, Finish profile, Upload documents, Pay Verification Fee, Post a tuition, Buy a plan), Counted / Not counted with the reason (not paid yet, refunded). The staff member's own claims that are not credited show only the name, a masked mobile and the reason (Claim waiting for Owner, Credited to another link first, Outside 30 days, Claim rejected). `MY_SIGNUP_ROW_KEYS` is the whole of a row: never a CNIC number, document, selfie, receipt, payment amount, bank detail or OTP; Paid is yes/no + a date.
- **The same numbers as Team activity.** The month card reads `loadTargetBoard` as that staff member alone (`adminRole: 'self'`): on this month's target list → "Paid this month: X of <target>", the pace and "Counting starts <date>"; otherwise (in-house: Aqsa, Javeria, Khizra, Nabeel on 16 Oct) "Paid this month: X" only. Paid is `lib/staffTargetsCore` firstPaidAt, as everywhere.
- **WhatsApp** per row, from `signup_mobile_unverified` and `profile_completion_nudge` (reused, unchanged) and the plain-English `my_signup_upload_documents` / `my_signup_pay_fee` / `my_signup_post_tuition` / `my_signup_buy_plan` / `my_signup_check_in` (migration 182), filled by `followUpText`. A tap writes `staff.my_signups_whatsapp` (only for a member credited to the tapper, or to a staff member they may view); every page open writes `staff.my_signups_open`. Both show on that staff member's Team activity page (Owner, Project Managers, Admin) under "My sign-ups activity".
- **Notice.** A credited link or code sign-up sends the staff member an in-app `staff_signup` notification, "New sign-up through your link: <name> (Tutor/Parent)" (`creditNewAccount`; never blocks the sign-up).
- **Team activity's lists** (`/admin/team-activity/accounts`, behind every number including "In progress (not counted)") use the same columns (`components/admin/SignupRows.tsx`, `rowsForAccounts`).
- **Review added areas** (`/admin/seo/locations/added`; viewing `SCREEN_ACCESS.seo`; `POST /api/admin/locations/run-review` Owner only via `refuseUnlessOwnerApproval`, at most 25 per request, the screen sends batches of 20 after a confirm). The rows are what the 16 Oct 13:56 PKT run wrote, by creation time inside `RUN_START`–`RUN_END` (areas also by its `location.area_add` Audit rows): 120 areas, 142 aliases, 44 "Not an area" values. Per area: city, tuitions (open) and profiles that count as it, its public hub (3+ open; a hub two list rows of one name share belongs to the row the hub rule picks), warnings (`lib/locationRunCore` areaWarnings — close or identical spelling to another area, a city name, block/street/landmark words, under 3 letters, digits only, junk). Actions: Keep; Same as (merge — the name is saved as a spelling of the area, its spellings follow, the area is retired; its old hub address 301s through `lib/areaHubRedirect`); Split into area + Block / landmark (merge + `jobs.area_landmark`); Not an area (the area and its spellings retired, the values added to `location_ignored`). Aliases: Keep / Change the match (old row retired, new row saved). "Not an area" values: Keep / Actually an area / Same as. Nothing is deleted; `jobs.area` and profile text are never changed; each decision is in `location_run_reviews` and a `location.run_review` Audit row. A retired area is in no curated read, so it is never a hub or a sitemap entry.

## Locations follow-ups — merged areas count on the main hub; Keep as its own area (owner, 16 Oct 2026)

No migration. `npm run test:locationsfollowups`; read-only `scripts/report-locations-followups.ts`, `scripts/report-zubia-signups.ts`.

- **Merged areas count on the main area's hub.** `resolveAreaHub` (lib/areaHubCore) now also searches the APPROVED SPELLINGS as whole runs of words, after the live curated names (which always decide first). A merge saves the retired name as a spelling, so "Lal Flats near Johar Morr" counts on Gulistan-e-Johar once Johar is merged. Hubs, chips, the city page's area list, the sitemap's 3+ rule, a tuition page's area link and the browse area filter (`areaFilterSpellings` in lib/cityJobs, used by lib/jobFeed) all read this one rule. A merge clears `AREA_ALIAS_TAG` + `LANDING_TAG`; the proxy's hub-redirect memory is now 1 minute (was 10).
- **Gulshan → Gulshan-e-Iqbal** merged by `scripts/dataop-merge-gulshan.ts` (the same `mergeArea` as the review screen; audited under the Owner as done by this PR on their instruction). `/tuition-jobs/karachi/gulshan` 301s to `/gulshan-e-iqbal`.
- **Review added areas → "Search all areas"**: every live area of any date (`GET /api/admin/locations/run-review?search=`), same cards and actions; area actions are no longer limited to the 16 Oct run's rows. Owner-only on the server, as before.
- **"Keep as its own area"** for a staff-added area (`POST /api/admin/locations/area` action `keep`, Owner only; `keepStaffArea` in lib/staffAreas): optional cleaned name (the old name is kept as a spelling) and Block / landmark on the tuitions saved with the old name; recorded in `location_run_reviews` ('keep', which takes it off the waiting list) and audited `location.area_keep`.
- **Suggestions never cut a place name in half** (`splitAreaLandmark`): the words around the area must be set off by a comma / bracket / dash or start with a block or landmark word, else no suggestion.
- **Locations counts:** the "Typed by tutors and parents" heading, chips, bulk buttons and summary come from one counts object (`reviewCountsView`, lib/locationCountsCore) re-read after every action; a bulk button at 0 is disabled.
- **My sign-ups month filter** = signed up OR paid in the month (`inMonth`, lib/mySignupsCore) — the people Team activity counts (In progress + Paid). The list itself is all time.

## One email send path — batched, paced, retried, recorded (owner, 16 Oct 2026)

Migration 183 (additive, dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **every email goes through `lib/email/send.ts`** (supersedes `lib/notify/email.ts` posting to Resend itself); **every list send is a batch** (supersedes one `deliverEmail` per recipient in the crons and fan-outs). Templates, subjects, copy and who receives what are unchanged. `npm run test:emailsend`; read-only `scripts/report-invalid-recipients.ts`.

- **Why.** Resend allows 10 requests a second per team. The 03:00 UTC cron (`/api/cron/subscriptions` → `pauseStaleTuitions()`, the 150-a-night backlog) sent each `tuition_paused` email as its own request, ten at a time with no pacing — 22–28 a second — and Resend answered 429 to the excess: 202 emails lost on 9, 10, 11 and 13 Oct, with nothing noticing.
- **`lib/email/send.ts`** is the only file that talks to Resend (a test fails on any other `api.resend.com`, `resend` SDK or nodemailer import). `sendOne(message)` — one transactional email, immediately, on the limiter's PRIORITY lane, so it never waits behind a bulk run (at most for the next free slot that second). `sendBulk(messages, { job })` — `POST /emails/batch`, at most 100 per request (150 → 2 requests). Shared: at most **5 requests a second** across the module (`RATE_PER_SECOND`, sliding window, per server instance — the headroom to 10 is for other instances and Supabase's SMTP sends); a 429, 5xx or network error is retried up to **5 attempts** with exponential backoff + jitter, honouring Retry-After; a 422 or any other 4xx is a permanent failure, not retried; every request carries an `Idempotency-Key` that is the same for all its retries, so a retry cannot deliver twice. Rules pure in `lib/email/core.ts`; the DB writer is `lib/email/record.ts`.
- **Recipients** are checked first by `lib/notify/recipient.ts` `recipientProblem()` (the shape Resend accepts); an invalid one is skipped with the reason and recorded, never attempted (in a batch it would make Resend refuse the whole chunk). `looksLikeEmail()` (lib/phone) now uses the same rule — it was `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`.
- **`lib/notify`**: `deliverEmail()` = the same per-recipient decisions (opt-out, unconfirmed address, no-mailbox synthetic address) → `sendOne`. `deliverEmailBulk(items, job)` = the same decisions per item → `sendBulk`, one result per item in order. Bulk callers: `pauseStaleTuitions` (`tuition_paused`), the expiry sweep (`plan_expiring` — `reminded_at` is still stamped only after the send — and `plan_expired`), the Monday content digest, `sendMatchEmails` (`tuition_match`), the search-alert sweep (`tutor_alert`), the one-time `switched_tutor_signin` email. The owner/finance alert emails (1–3 fixed addresses) stay on `sendOne`.
- **Nothing silent.** Every message's outcome → `email_sends`; every bulk run → `email_runs` plus the log line `[email] bulk <job>: attempted N, delivered N, failed N, skipped N (R requests)`. **Admin → Settings → Email** (`/admin/settings/email`, `SCREEN_ACCESS.emailHealth = ['admin']`; Owner + admin, Partner views; read only) shows counts, failed and skipped emails of the last 7 days with Resend's error, and the bulk runs. Overview to-do **"Emails that failed in the last 7 days"** (`todo-email-failed`, hidden at 0) reads the same loader (`loadEmailFailures`).
- **The SMTP sender ("resend-smtp") is Supabase Auth**, not our code: sign-up confirmation (`auth.signUp`, `auth.resend` — register route, /login, /verify-email), password-reset email (`resetPasswordForEmail`) and email change (`auth.updateUser({ email })`). It is not historical and was NOT migrated: moving it would replace Supabase's templates with ours, which this change may not do. Every one of those call sites now refuses an address `recipientProblem` rejects before calling Auth. The 15 HTTP 422s of 8 Oct could not be traced to an address: Supabase's auth audit log is empty on this project, Resend's log bodies are not readable from here, and none of the 203 auth addresses, 54 pending email changes or 198 profile addresses on 16 Oct fails the rule. They are not in `email_sends` (Supabase sends them).
- **Reported, not changed:** secure email change is on, so a member whose sign-in address is the synthetic `<msisdn>@users.tutormint.org` and who adds a real email gets one confirmation at the real address and one at the synthetic one, which has no mailbox — their change can never complete (54 email changes pending on 16 Oct, many from synthetic accounts).

## Overview cards are plain squares (owner, 17 Oct 2026)

No migration. Supersedes the trend lines and "▲/▼ % vs yesterday" pills of 7093940. The six Overview cards (`app/admin/page.tsx`) are square (`aspect-square`; 2 a row on a phone, 3 from `sm`, 6 from `lg`) with short titles — Revenue, Paid, New tutors, New parents, Tuitions posted, Signed up, not paid — and show only Today (big), Yesterday, Last 7 days and one tiny grey bottom line: Revenue "This month Rs X", Paid "This month X", New tutors / New parents "Total X", Tuitions posted "Open now X", Signed up, not paid none. No descriptions. Windows (Pakistan time, `lib/overviewTrendCore.ts` `trendWindows` — the one helper): today = 00:00 → now, yesterday = the whole day, last 7 days = 00:00 six days ago → now. Meanings: Revenue = Rs approved, not refunded; Paid = tutors whose Verification Fee was approved (each once); New tutors / parents = accounts created; Tuitions posted = every tuition posted, any status now (test accounts out); Signed up, not paid = the Unpaid signups rows by join day. Each card still opens the same list as before: Paid and Signed up, not paid open their Today list (= the big number); the others open the list their bottom line counts. The Unpaid signups page's own "Last 7 days" filter is still 7 × 24 hours, so it can differ slightly from the card's calendar window. `npm run test:overviewtrends`, `test:overview:live`.

## Payment banner names the plan; /pay/choose with no plan; "Other methods" (owner, 17 Oct 2026)

Migration 185 (additive, applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **the /membership-plans banner shows only a checkout that can still be paid** (supersedes "You have a payment in progress — tap to continue", which showed the newest pending payment of any kind); **the second way to pay is "Other methods"** with no bank logo or name on the option row (supersedes "Other method: bank transfer" with the bank logo, 11 Oct). `npm run test:paymentbanner`.

- **Rule** pure in `lib/paymentBannerCore.ts`, I/O in `lib/paymentBanner.ts`: pending, not closed, no receipt, not refunded, a plan of the member's audience, not paid since, not something held now (fee stamped / active plan), opened in the last 48 hours (`STARTED_PAYMENT_CLEAR_MS`). Text "<Plan> — Rs N: payment started, not finished." (the fee reads "Verification Fee"); Continue → `/pay/choose?plan=<code>` (PayPro reuses the same order under 24 h); Cancel → `POST /api/payments/checkout/cancel` marks it `cancelled_by_member` (own checkout only, activity `checkout_cancelled`). A receipt waiting for approval wins: "Receipt received — we’re checking it.", no link. The dashboard invoice prompt and Overview "Started payment, didn't finish" skip closed checkouts.
- **Clean-up** `scripts/dataop-close-stale-checkouts.ts` (read-only without `--apply`): on 17 Oct 41 tutors (0 parents) saw the banner wrongly — 36 older than 48 h, 4 already paid, 1 with no valid plan; 69 checkout rows marked (58 expired, 10 already paid, 1 no valid checkout), one `payment.checkout_close` Audit row. Never an approved, rejected or refunded payment or a receipt waiting for approval.
- **/pay/choose with no plan** (`lib/payChooseDefault.ts`): signed out → `/login?next=/pay/choose`; a tutor without the Verification Fee → `/pay/choose?plan=verified`; a verified tutor → `/membership-plans?for=tutors`, a parent → `?for=parents`.
- **"Other methods"** — subtext "Any bank app, Easypaisa or ATM transfer — activated after we check your receipt"; the bank panel opens with "You can pay from any bank or wallet app. You don’t need a Faysal Bank account." above the unchanged details and receipt upload. Approval (Owner only) and PayPro are unchanged.

## Tidy tutor cards; each subject once; no school names as subjects; no "Pay later" on /pay/choose (owner, 17 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **the tutor listing card shows no areas and no Experience / Area / City rows** (supersedes "Avatar … then Subjects / Experience / Area / City" in the TutorCard spec); **/pay/choose has no "Pay later"** (the owner's gateway switch still governs other surfaces). `npm run test:tidycard`; read-only `scripts/report-card-subjects.ts`.

- **Card** (`components/TutorCard.tsx`, rules pure in `lib/tutorCardCore.ts` `cardSummary`): name on one line with an ellipsis and the badges beside it; stars; headline in two reserved lines; roles = at most 2 outline chips then "+N"; subjects = one line, at most 4 (each still linked), then "+N more"; one info line "📍 City · experience · Rs fee/month" (the fee exactly as set). Every row has a fixed height, so cards in a list line up at 360px and on desktop. The four buttons, their labels, colours, order and behaviour, and the card's links are unchanged. The profile page keeps every role, subject and area.
- **Each subject once** (`lib/subjectDisplay.ts`): "Islamiat / Islamic Studies", "Islamiyat / Islamic Studies", "Islamic Studies", "Islamiyat" → "Islamiat / Islamic Studies"; "Translation of Quran" → "Translation of the Holy Quran". Display only — on the card and within each level on the profile; nothing stored changes, matching still runs on master ids.
- **School names are not shown as subjects.** The schools are the choices of the no-grade level (Admission Test Prep, `taxonomy_categories.no_grade`); the card and the profile show the level's name instead. Structured data and page titles are unchanged.
- **Master-list subjects only:** `/api/profile/save` (before any write) and the staff tutor edit refuse a subject id that is not a `taxonomy_master` row (`lib/masterSubjectCheck.ts`, `NOT_A_MASTER_SUBJECT`). The retired free-text `specialty_subjects` / `specialty_list` columns are not writable and not shown.

## CNIC number for the Owner only, "Hide my photo from parents", approved photo locked, five subject merges, "AI assistants" source, /how-it-works (owner, 17 Oct 2026)

Migration 186 (applied before the code; its dry run acts as a real tutor and proves the lock). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **only the Owner ever receives a member's full CNIC number** (supersedes "Owner/Admin reveal", PR8 §3.3, and "the admin queues see the full number"); **an approved profile photo is locked** (supersedes "The profile photo is NOT locked", 9 Oct, and migration 158's removal of the avatar lock); **"Show my picture to parents" is now "Hide my photo from parents"** (same column, inverted; a hidden photo shows the tutor's initials, superseding the default silhouette for that case). `npm run test:privacylocks`; read-only `scripts/report-ai-signups.ts`, `scripts/report-lock-functions.ts`.

- **CNIC number.** Rules pure in `lib/cnicRevealCore.ts`: `mayRevealCnic` (Owner only), `adminCnicDisplay` (XXXXX-XXXXXXX-4, or "Incomplete number on file") and `revealCnic` (the reveal with its I/O injected — a non-Owner gets 403 and nothing is read; the Owner's Show is written to `admin_audit_log` `cnic.reveal`, target the member, BEFORE the number is returned). `/api/admin/tutors/cnic-reveal` takes `memberId` (tutor or parent). Every admin loader sends the masked number: `loadParentDocs` / `parentsAwaitingReview` and `loadParentQueue` (they sent the full number to every staff role before), the tutor queue, the member page. The read-from-photo `cached` suggestion returns its number to the Owner only. `components/admin/CnicShow.tsx` is the one Show button (Owner via `useCanApprove`; held in memory, hidden on Hide, page leave or tab hide), on the member page's tutor and parent cards and the tutor queue. Parents, the public and other tutors get no part of the number: tutor cards and the profile show `components/CnicVerifiedChip.tsx` ("CNIC verified") once staff approved the CNIC (`lib/cnicStatus` 'approved', batched in `loadCardTrustFacts`). The tutor's own Settings is unchanged.
- **Hide my photo.** `tutor_profiles.show_avatar` (PR70) — the public views already return a null photo when it is false (migration 115). `components/tutor/HidePhotoToggle.tsx` on the onboarding photo step and in Settings, off by default, label "Hide my photo from parents", helper "Parents will see your initials instead. We still need your photo for verification." It is never locked (the 186 lock covers `avatar_url` only). `lib/photoPrivacyCore.ts` `publicPhoto()` is the one rule; `lib/badgeFacts.ts` `loadCardTrustFacts()` returns verified badge, CNIC approval and hidden photo in one batch for every card producer in `lib/browseTutors.ts` (Browse, landing pages, shortlist, blog embed), which set `avatar_url` null and `photo_hidden`; `Avatar` `initials` draws a grey initials disc. The profile page (body, owner preview, OG/Twitter image, JSON-LD image) reads `show_avatar` and drops the photo. Staff and the tutor's own Settings see the real photo; upload and review are unchanged. The inbox counterpart keeps the default silhouette (no photo) — not changed.
- **Approved photo locked.** `lib/docLockCore.ts`: `UnlockItem` adds `'photo'`; `DocLockViews.photo`; `photoLockView` / `photoUploadDecision`. `/api/profile/photo` refuses a new file while the approved photo is locked; **migration 186** `tm_photo_change_refused()` (SECURITY DEFINER) is called from `lock_profile_fields` and `lock_tutor_profile_fields` on a member's own change of `avatar_url` at trigger depth 1 (the avatar mirror is not re-checked) — refused unless an open `'photo'` unlock exists, which that one change spends (`close_reason 'used'`); the new photo then waits for review through `profiles_photo_rereview` as before. Hiding is never locked. The Owner's "Unlock for re-upload" (`UnlockDocButton item="photo"`) sits on the profile-picture card; a photo decision closes an open photo unlock. CNIC (both sides), selfie and the CNIC number were already locked (157/158; the number by `lock_profile_fields` since 116). Member notice (`DocLockNotice doc=…`): "Approved 🔒" + "To change this, contact support on WhatsApp 0321 5872222." with the number linked to `wa.me/923215872222` and the message "Hi TutorMint, I want to update my <CNIC | CNIC number | selfie | profile picture>." (`lockedWhatsappHref`); the Urdu line is unchanged.
- **Subject merges** (`lib/subjectDisplay.ts`, display only): Business → Business Studies, Design Technology → Design & Technology, Robotics Engineering → Robotics & Engineering, French Language → French, German Language → German. English / English Literature / English Language & Literature, Urdu / Urdu Literature, the IB "Language A" pair and "Language & Literature" vs "Language" stay separate.
- **AI assistants** (`lib/signupSourceCore.ts`): a first-touch `utm_source` naming chatgpt.com, chat.openai.com, gemini.google.com, perplexity.ai, copilot.microsoft.com, claude.ai or a similar assistant (or a subdomain, or a bare "chatgpt"/"gemini"…) is the source "AI assistants". The member page and the Payments queue read "AI assistant · chatgpt.com". Overview gained a "Where sign-ups came from" table under the daily funnel (`lib/signupSources.ts`; same visibility; not a card): AI assistants with one line per site, Other links and campaigns, Direct — Today, Yesterday, Last 7 days, This month (real tutor and parent accounts by creation day, Pakistan time). On 17 Oct 2026, 24 past sign-ups were from chatgpt.com (all tutors, 15–17 Oct) and none from another assistant.
- **/how-it-works** was referenced only by `scripts/check-jsonld-live.mjs` (no page, link or structured data pointed at it). How TutorMint works is on /about, so `next.config.ts` redirects /how-it-works there permanently (308) and the check now tests that redirect and fails on any page that does not answer 200.


## Only documents lock; check:links finishes (owner, 19 Oct 2026)

Migration 187 (dry-run probe as a real Step-1-complete tutor, then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **only an approved document locks — the CNIC (front, back, number), the profile picture and the selfie** (supersedes PR72 §E / migration 116 "subjects, city and areas lock once Step 1 is complete"). `npm run test:steplocks`; read-only `scripts/report-step-locks.ts`.

- **Why "Subjects you teach" and "Where you teach" showed Locked:** the older PR72 §E rule, not the new document lock. Tutor Settings set `locked: step1Complete` on both cards (Step 1 = verified mobile + approved CNIC, photo, selfie + subjects + areas), and the database refused a member's change of the city (`lock_profile_fields`, `lock_tutor_profile_fields`) and of `tutor_areas` (`lock_tutor_areas` → `lock_step1_set`). The subjects trigger had already been dropped in migration 134, so subjects were locked only on screen. On 19 Oct 80 of 241 tutors were in that state; all 80 had an approved photo.
- **Now:** the `step1Complete` lock is gone from Settings; the mobile card is not shown as Locked (a verified mobile is changed through support, as its card says; the database still refuses a member's own change of a verified mobile, unchanged). Migration 187 drops `lock_tutor_areas` and the two city checks; the CNIC-number, verified-mobile and approved-photo checks are unchanged; `lock_step1_set()` and `tutor_step1_complete()` are kept, unused. A locked card reads "Approved 🔒" (`APPROVED_LOCK_LABEL` in `components/tutor/SettingsPieces.tsx`) — the word "Locked" no longer appears. Only `cnic` and `selfie` set `locked`; the approved profile photo uses `approvedLock`, so its card stays open and the "Hide my photo from parents" toggle stays usable. The video's 3-submission cap is a submission limit and is unchanged.
- **Subjects save:** `/api/profile/save` and the staff tutor edit refuse only NEWLY ADDED non-list subject ids (`refusedNewSubjects` / `unknownNewMasterIds`); an id already saved never blocks the save and is kept (the editor's merge, `lib/subjectMerge`, already keeps saved ids it does not display).
- **check:links** (`scripts/check-internal-redirects.mjs`): every request has a 15-second timeout and one retry, an unneeded body is cancelled, link targets are checked without downloading their body, lookups are sets, 10 at a time, and a progress line goes to stderr every 100 URLs. A paused tuition listed without JobPosting (the 60-day rule) is not a problem. The full live crawl on 19 Oct: 419 s, 1,177 sitemap URLs + 3 extra pages, 2,107 link targets, 0 sitemap problems, 0 redirecting links, 0 broken links.

## Documents row on admin tutor cards; "Waiting for approval" filter (owner, 19 Oct 2026)

No migration. Every tutor card on the Overview lists (`components/admin/OverviewCardGrid.tsx`, the only admin tutor card grid) has a "Documents" row: ✅ Approved (CNIC — front, back and number, by lib/cnicStatus — photo and selfie approved) · 🟡 Waiting for approval (n) · 🔴 Rejected — <item> · 🟠 k of 3 approved · ⚪ Not uploaded, first match in that order; tapping it shows "CNIC ✅ · Photo 🟡 · Selfie ⚪ · Video —". The optional video is in the breakdown only and never changes the status. Rules pure in `lib/tutorDocSummaryCore.ts`; statuses come from `tutorCardStatuses()` through `tutorDocFactsFromRow()`, the mapping `loadDocumentStatuses` (the member page) also uses, so card and member page agree. `lib/tutorDocSummaries.ts` loads the whole page in three batched reads. Every admin role sees the row; approving stays on the member page, Owner only. The Tutors list (`/admin/overview/tutors`) has chips All / Waiting for approval ("Waiting for my approval" for the Owner) / Approved / Rejected / Not uploaded with counts over the searched cards; Waiting is oldest waiting upload first (user_documents created_at; a changed photo by `profile_pic_rereview_at`; else account creation). The card's free-text line drops its "Joined …" part (`withoutJoined`) — the details table shows it. `npm run test:docsummary`; read-only `scripts/report-doc-summary.ts`.

## Staff uploads on the tutor edit screen — "Upload failed (200)" fixed (owner, 19 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **staff other than the Owner may upload a tutor's CNIC, photo or selfie from the edit screen while it is not approved and locked** (supersedes "the media route is Owner only", 15 Oct); **a non-Owner may type the CNIC number only while the CNIC is not approved**. Approving stays Owner only. `npm run test:admindocupload`.

- **Cause:** `/api/admin/tutors/media` answered 200 with `{ok, field, completion}` and no `documentId`; the shared `CnicCameraField` treats a reply without `documentId` as a failure and printed "Upload failed (200)." The upload had saved (and was marked approved). Not caused by the 17 Oct lock or masking changes.
- **Rules** pure in `lib/adminDocUploadCore.ts`: `adminUploadDecision` — Owner always, saved approved, replacing an approved, locked part audited `document.owner_replace` (the Owner's action is the unlock); anyone else 403 "This document is approved and locked. Only the Owner can replace it." on a locked part, else saved `pending` (a missing side of an approved CNIC as a `review` upload). `cnicNumberDecision` — empty or masked (X, *, •) → keep the stored number (200 `kept`); invalid → 400; non-Owner on an approved CNIC → 403. Saving the same number again writes nothing.
- The route returns `documentId` / `url`, `saveAs` and `statusLabel` ("Approved" / "Waiting for approval"), and hides earlier active uploads of the same side or selfie (`status='paused'`, never deleted). `readUploadResponse` is the one client reading: a 2xx without what was stored, or with an error, is a failure. The CNIC boxes show the photo and the status at once; photo and selfie show a thumbnail and status.
- The edit screen shows "Number on file: XXXXX-XXXXXXX-4" (`CnicCapture numberOnFile`): leave the box empty to keep it; the mask is never put into the box or sent.
- The tutor's own upload (`/api/documents/upload`, the lock and "Approved 🔒") is unchanged.

## Admin clean-up — breadcrumbs that follow you, one member timeline, copy profile link (owner, 20 Oct 2026)

No migration; admin only — tutors and parents see no change. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **the member page has one Timeline** (supersedes the separate "Admin actions about them" box and the PR99 "Activity" box); **document cards use one "Change ▾" menu** (supersedes "Change decision" + "Unlock for re-upload" buttons); **a payment row is labelled in plain words** ("Verification Fee Rs 199 — started, not paid"). `npm run test:admincleanup`.

- **Breadcrumbs follow you** (`lib/adminFromCore.ts`, pure). `components/admin/AdminReturnKeeper.tsx` (mounted once in `AdminShell`) turns any click on a link to `/admin/(users|jobs|tutors|team-activity)/<uuid>` from an admin page into `?from=<the page's full address>` — every list at once, new-tab clicks included. The `@pagehead` slot builds the trail with `trailFor()`: the list's own trail (its crumb linking back to the list's exact address, chip and search kept) + the record, up to 3 lists deep. No `from` (search, a link, a notification) = the record's own section, e.g. "Admin › People › Name". `from` is trusted only as a same-site `/admin` path. `/admin/overview` crumbs link to `/admin` (it has no page of its own). The keeper also remembers each admin page's scroll per tab and restores it on a breadcrumb return or the browser/phone back button. List filters that were client state are now in the address: Overview lists `?q=` and `?docs=` (`lib/useUrlState.ts`, `history.replaceState`), the sign-up rows `?fq= ?frole= ?fstep= ?fcounted= ?fmonth=`; "Show more" is remembered per tab. Every "← Back to …" link at the top of an admin page is gone (two in error/empty panels remain).
- **Member page top section** (`lib/memberPageCore.ts`). Documents uses the tutor cards' words and colours (`DOC_KIND_TONE` in `lib/tutorDocSummaryCore.ts`: green approved, amber waiting or partly approved, red rejected, grey not uploaded; parents from their CNIC + address). "Video: None" or "Uploaded · Private". "Tutor status: Pending: fee not paid · documents waiting/missing/rejected".
- **Copy profile link + Share on WhatsApp** (`lib/profileShareCore.ts`, `components/admin/ProfileShareButtons.tsx`, batch loader `lib/profileShare.ts`): the clean `https://www.tutormint.org/tutor/<slug>`, on the member page next to the name and on every admin tutor card (Overview lists, Follow-ups → Tutors, My sign-ups, Team activity lists). Public = in `tutor_directory` with a slug; otherwise both are disabled with the directory's own reason ("Profile not public yet: account suspended"). **The Verification Fee is not a listing condition (removed in PR16), so "fee not paid" is never a reason here** — the owner's example could not be used as written. "Tutor record & profile address" + "Open public profile" became one "Public profile ↗" link; the admin tutor record is still reached from Actions → "Edit tutor record" (kept so profile-address and tutor edits stay one tap away).
- **Document cards**: "Change ▾" (`lib/docChangeMenuCore.ts`, `components/admin/DocChangeMenu.tsx`) offers Approve, Reject (opens the quick reasons) and Unlock for re-upload (`useUnlockDoc`) — Owner only, as before; others see the status and the existing view-only note. "View original" is gone; the ⤢ icon on the profile picture opens the uploaded original (`/api/admin/profile-photo/source`, turned by any saved rotation). CNIC Show/Hide and Change unchanged.
- **Actions**: Warn; "Suspend or ban ▾" (Suspend / Reinstate, Ban for fraud — same confirms and permissions); Contact (Message = the in-app Team channel, WhatsApp, Call); Verify mobile manually, Change mobile, Grant or revoke a plan, Edit tutor record, and "Create parent/tutor account" (the second-account box, same behaviour) inside Actions. "Open moderation queue" removed.
- **Empty boxes** are not drawn; they are listed on one grey line ("No jobs, applications, subscriptions, reports, penalties or flags.").
- **Payments** (`lib/paymentLabelCore.ts`): "<Plan> Rs N — paid / receipt waiting / refunded / cancelled / expired / started, not paid / not approved", plan names Verification Fee, Premium, Featured, Parent Verified, Parent Featured (subscriptions use the same names). A checkout over 1 hour old gets "WhatsApp follow-up" with the `payment_not_finished` message, recorded as a follow-up. **The amount is shown only to `SCREEN_ACCESS.paymentAmounts` (Owner, Partner)** — this page was the one place still showing admin/operations an amount, against the 8 Oct rule.
- **One timeline** (`lib/memberTimelineCore.ts` pure, `lib/memberTimeline.ts`, route `/api/admin/queues/timeline` with an offset cursor, `/api/admin/activity/session-pages`): the member's own events, every `admin_audit_log` row naming them (Moderation, "by <staff name>" — never an email) and their visits (Activity; owner/admin/Partner only, as the old box). An admin action's member-side twin within 5 minutes is dropped. Specific names ("Approved CNIC / profile picture / selfie", "Showed the full CNIC number", "Sign-up credited to a staff member"). Repeats in a row (≤ 60 min apart) are one line, "Updated their profile ×8 (10:46–10:53 pm)", tap to expand; a visit expands to its pages. The Activity tab starts with "2 sessions · 6 min in the last 30 days · last seen <date>". The whole grouped list is built per request and sliced, so the header count, the list and "That's the whole timeline — N events" agree. `MemberActivity.tsx` / `MoreActivity.tsx` are deleted; nothing stored changed.
- **Overview → Tutors** gained the "Partly approved" chip (`DOC_FILTERS`).

## No back link in the admin header; plain timeline names (owner, 20 Oct 2026)

No migration; admin only. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **the admin header draws no "← Back to …" link** (supersedes the shared back control on admin pages — the breadcrumb trail is the only way back); **a grouped timeline line is a short fixed phrase** (supersedes "Changed subjects: added … removed …" as one collapsed line). `npm run test:headertimeline`; read-only `scripts/report-timeline-event-types.ts`.

- **Header.** `components/Breadcrumbs.tsx` takes `showBack` (default true — the public site keeps its back control); the admin `@pagehead` slot passes `showBack={false}`. 60 of the 61 admin pages drew the link (every page but `/admin` itself); none do now. The two "Back to" links inside error and empty messages (Team activity accounts, Post a tuition without the team account) stay.
- **Names.** `lib/timelineLabelsCore.ts` `AUDIT_LABELS` names every admin action the code writes and every one stored in `admin_audit_log` on 20 Oct 2026; `ACTOR_FIRST` actions read "<staff name> sent a WhatsApp from My sign-ups" with no "by …" line. `auditSentence(action, detail, actorName)` keeps its item-specific names ("Approved CNIC"). `timelineSentence` names every `ActivityEvent`; "Followed up by staff on WhatsApp" no longer shows the template's code name. The test fails on an unnamed action or event, and on any name with an underscore, a dotted code or a camelCase word.
- **Grouping.** `buildTimeline` no longer pre-collapses subject edits (`collapseTimeline` is still used by the admin queue timeline). A run of an event in `GROUP_LINE` (profile, subjects, documents, searches, sign-ins, profile views, completion, document reviews) groups by the event alone under its short phrase — "Changed subjects ×23 (12:43–12:47 am)" — with each row's full sentence under "Show each"; the group line is clamped to 2 lines.
- **Member page.** `Fact` values wrap ("Pending: Fee Not Paid · Documents waiting" on two lines), never truncated.
- **CNIC card.** "Read number from photo" is disabled with "Upload the CNIC front first" until a CNIC front (on record or waiting for review) is uploaded (`lib/cnicReadButtonCore.ts`).

## Follow-ups — one merged Tutors list, short cards, pre-filled WhatsApp, PayPro status check (owner, 20 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **"Unpaid signups not yet contacted", "Stuck in onboarding" and "Started payment, didn't finish" are chips of ONE list, Follow-ups → Tutors** (supersedes the three separate Overview lists and the Stuck / Follow-up sent tabs of 9 Oct); **a tutor counts as contacted on ANY contact record — a follow-up (WhatsApp, Mark as followed up) or a logged call** (the old "not yet contacted" read logged calls only); **"Follow up again" is 3 days after the last contact, still unpaid** (the 7-day "Follow-up sent" hold still applies on the Parents tab only). Rules pure in `lib/tutorFollowUpCore.ts`, I/O in `lib/tutorFollowUps.ts`. `npm run test:tutorfollowups`; read-only `scripts/report-follow-up-chips.ts` (counts only).

- **Chips** (a tutor may match several; "All" shows each once, sorted and labelled by the first that matches): Started payment (the existing `lib/startedPaymentCore` rule) → Docs done, fee not paid (CNIC, photo and selfie approved, every onboarding step done but the fee) → Stuck at a step → Not contacted → Follow up again → Contacted. The default group ("Last 30 days (unpaid)") also carries every tutor with a started checkout, whatever their join date (`tutorInScope`). The sign-up-day chips (Today / Yesterday / Last 7 days) list fee-unpaid tutors only, so the "Signed up, not paid" card still equals Today. Search (name, city) is a typeahead (`QueueSearch` gained `keep`).
- **Overview rows** `todo-uncontacted`, `todo-stuck`, `todo-payments` count their chip from the same loader and link to `/admin/follow-ups?chip=…`; `/admin/overview/todo-uncontacted|todo-stuck|todo-stuck-sent|todo-payments` redirect there (`OVERVIEW_KEY_CHIP`), and old `?filter=uncontacted|onboarding|payment|followed|started_payment` and `?scope=started_payment` addresses redirect to the matching chip (`legacyFollowUpsRedirect`). "Started payment" is tutors only now (0 parent checkouts were open at the change).
- **Short card** (`app/admin/follow-ups/UnpaidSignupRow.tsx`): name, city, joined, % complete, the state chip, ONE "Next: <step>" line, "Started <date> · Verification Fee · PayPro", "Contacted <date> by <name>", Copy profile link / Share, WhatsApp / Call / Mark as followed up; the full "Still to do" list, documents, order ID and the call-outcome log are under "See all steps". The shared Overview card grid says "Next: <step>" once and `withoutJoined()` drops any "stopped at / Next / Still to do" part of the detail line.
- **WhatsApp** opens the tutor's number with a message built from their own state (`followUpMessage`): next step (name, %, step words from `NEXT_PHRASE`), documents approved + fee, started fee payment, each prefixed with "Please re-upload your <document> first (<reason>)." when a document is rejected. A plan checkout (not the fee) gets the stored `payment_not_finished` text. New plain English; no stored template or Urdu text changed. Each tap records a follow-up whose `template_key` is the message type (`followup_[reupload_]<type>`). My sign-ups uses the same message for unpaid tutors and logs `messageType` with the tap.
- **Check payment status** (`POST /api/admin/follow-ups/payment-check`, `checkAdminRole('partner')` = Owner + Partner): asks PayPro (`getPayproOrderStatus` via `confirmPayproOrder`, the callback/cron path) — paid → activated through that path, "Paid ✅"; not paid → "Not paid yet (checked <time>)"; audited `payment.status_check`. Shown only on PayPro checkouts.

## Pre-filled WhatsApp on every admin WhatsApp button (owner, 20 Oct 2026)

No migration. Admin only. Five admin WhatsApp buttons opened a BLANK chat: the Overview list cards (Documents to approve and every other list, parent cards included), the member page's Contact → WhatsApp, and `components/admin/WhatsappChatButton` (People rows, Verification → Tutors, the tutor record). They now point at `GET /api/admin/whatsapp?memberId=&from=` (roles of `users` ∪ `unpaidSignups` ∪ `tutors` ∪ `parents`; a GET, so the Partner may open it), which builds the message from the member's own state, writes `admin_audit_log` `member.whatsapp_open` with `{ messageType, from }`, and 302s to `https://wa.me/92…?text=<encodeURIComponent>`. Rules pure in `lib/adminWhatsAppCore.ts` (`adminMemberMessage`, `adminWaLink` — number through `normalisePkMobile`, no link without text), I/O in `lib/adminWhatsApp.ts`. Message order: parent → "Do you need any help finding a tutor?"; tutor with a rejected CNIC/photo/selfie → "please re-upload your <document> (<reason>)"; a document waiting → "thanks for uploading … your next step is to <step>"; fee paid and nothing left → a plain "Do you need any help?"; otherwise the Follow-ups state messages (`followUpMessage`); staff/other → the plain help line. Follow-ups, My sign-ups, Team activity lists, Applicants to forward, Team inbox and the after-approval WhatsApp already pre-filled and encoded correctly and are unchanged. `npm run test:adminwhatsapp` scans `app/admin` and `components/admin` for any `wa.me/${…}` without `?text=`.

## Every Pakistani city and town; searchable city picker (owner, 20 Oct 2026)

Migration 188 (additive, re-runnable, dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **the city list is every Pakistani city and town (422)**, not the curated 26; **every place a city is chosen uses `components/forms/CityPicker.tsx`** (supersedes `LocationInput`/`<select>`/datalist for cities; areas are unchanged); **the Browse city filters list only cities with an open tuition or a listed tutor**. `npm run test:pkcities`.

- **Source: GeoNames** (CC BY 4.0) — the 2023 census list of urban areas (PBS) is published only as per-district PDFs. Extract `supabase/seed/pk-cities-geonames.tsv` (header says how it was cut): feature class P with PPL/PPLA/PPLA2/PPLA3/PPLC and population 10,000+, plus every district headquarters (PPLA2) whatever its recorded population, plus four towns GeoNames lists with no population (Taxila, Hasan Abdal, Samundri, Daska). Curation is in `scripts/build-pk-cities.ts`, by GeoNames id: 20 exclusions (neighbourhoods inside Lahore and Islamabad, GeoNames copies, numbered "Chak" villages, unclear names, a town listed twice), common English spellings (the GeoNames spelling becomes an alias), and hand aliases. Nothing is merged by distance (Kotri and Rohri are their own towns). Homonyms: the existing or larger place keeps the plain name, the other shows its district — "Sahiwal (Sargodha)", "Khairpur (Ghotki)"; "Mirpur (Azad Kashmir)" follows the owner's slug example. Re-run the generator and commit the extract, generator, `lib/pkCityData.ts` and the migration together.
- **Storage (owner's choice, 20 Oct): exactly like the 26.** `location_cities` gets the name + sort_order 100; nothing else in the database. Province, district, coordinates, population and aliases are in the generated `lib/pkCityData.ts`. The 26 keep their name, sort order, hand coordinates (`lib/cityCoordsHand.ts`, moved unchanged out of `lib/cityDistance.ts`) and hand provinces (`lib/pkLocations.ts`); those tables WIN, the generated data fills in every other city (`CITY_COORDS`, `provinceForCity`). Aliases also go into `taxonomy_aliases` (kind 'city', slug = name), so site search reads them. No postcodes were added.
- **Picker.** Type to filter by name or alias (`lib/pkCitiesCore.ts` `searchCities`); each row shows "<district> district, <province>" (district left out when it repeats the name); biggest first = the big four, the other 22 existing cities, then new places by GeoNames population. The ~64 KB data file is loaded only when a picker is first opened. Staff posting is list-only and the server check (`curatedCityName`) is unchanged; member forms keep today's free-text rule ("Not on the list — use as typed"). Used in: the shared Post a tuition form (staff + parent), staff tutor edit, both tutor onboarding flows, tutor Settings (`TutorCitiesEditor`), parent Settings, both Browse filter bars (and the landing pages that reuse them). Admin job filters, Paused tuitions and the blog editor's city field were not changed.
- **Browse filters** read `GET /api/browse/cities` (`lib/browseCities.ts`, cached 10 minutes): cities with an open tuition or a listed tutor; the tutor bar uses its own facet counts when it has them (count shown beside each city). The chosen city always stays visible (`browseCityOptions`).
- **Pages and sitemap are unchanged.** City pages are built from open tuitions only (`cityPages`), so a city with none is a 404 and in no sitemap; 1–2 = noindex; 3+ = indexed. On 20 Oct no open tuition or listed tutor had a city outside the 26, so the import created no page and no sitemap entry.
- **Known source limits (reported):** GeoNames populations are wrong for some towns (Bannu 1.36 million, Arifwala 854,000, Battagram 700,000, Chunian 634,000) — they only affect the picker order; some district names are GeoNames' older forms.

## Link a bank credit to a member (owner, 20 Oct 2026)

No migration. A member who pays straight into the company account (Raast, IBFT) without a receipt leaves only a bank credit; a manual grant then gave the badge but no payment, so Revenue, Paid counts, payment history and staff credit missed it. Rules pure in `lib/bankPaymentLinkCore.ts`, I/O in `lib/bankPaymentLink.ts`, route `/api/admin/payments/bank-link` (GET search / plans / unmatched credits — the Finance screen's roles; POST Owner only via `refuseUnlessOwnerApproval`, fresh password). `npm run test:bankpaymentlink`; read-only `scripts/report-grants-without-payment.ts`.

- **"Link to member"** on every unmatched or held bank credit (Finance → Settlement check, Needs attention and Bank credits tabs) and **"Record a bank payment"** under Payments on the member page (Owner only; it lists only unmatched credits) — one component, `components/admin/LinkBankCredit.tsx`. Pick the member, what it paid for (Verification Fee or a plan of their audience), the amount (pre-filled from the credit, never more than it), confirm.
- It inserts ONE payment (`provider 'manual'`, `method 'bank'`, `reference` = the bank's reference, `raw.bankTransferId`), approves it, sets `reviewed_at` to the credit's date and time (Pakistan time; noon if no time) — so Revenue, Paid, Follow-ups, My sign-ups and Team activity count it on the day the money arrived — and links the credit to it (`settlement_links` kind `receipt`), so the settlement check shows it matched. Audited `payment.bank_link` with who linked it.
- Nothing held yet → the normal `activatePayment` (badge or plan, notification, receipt email, `payment.approve`). A manual grant already gave it (fee flag set, or an active/paused subscription of that plan with no payment) → **attach**: approved, the subscription's `payment_id` set, the receipt email sent; nothing granted again, no plan extended. A counted payment for the same fee (or for the current plan period) → refused "This member has already paid this fee."
- If a step fails after the insert, the payment is marked rejected with the reason (never deleted).

## A wrongly guessed bank-credit match; "Paid by another method"; Review button and tutor status (owner, 21 Oct 2026)

Migration 189 (additive, applied before the code): `payments.checkout_close_reason` may also be `paid_another_way`. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **"Link to member" also appears on a credit the automatic same-amount rule matched to a bank-transfer receipt** (supersedes "only on unmatched credits", 20 Oct); **an approved payment closes the member's other open checkouts for the same fee or plan**; **a tutor with the fee paid and CNIC, photo and selfie approved reads "Tutor status: Verified"**. `npm run test:approvebankcredit`; read-only `scripts/report-ayaz-bank-credit.ts`, `scripts/report-ayaz-member.ts`.

- **What happened (Ayaz Hussain).** The brief said his credit (Raast ref 261838203082, Rs 199, 20 Oct) was matched to "his own pending bank-transfer checkout TM-MVCYYLHV-ED2EEA6E1C85". In the data that payment is **Saleem Khan's**, an APPROVED bank receipt from 18 Oct; the credit had no manual link — step 5 of the matcher (same amount within ±2 days) guessed it. The "What does this credit pay?" panel lists only approved receipts, so a credit can never be matched to a pending payment; the proposed "Approve with this bank credit" button was not built (owner's choice).
- **Rule** (`lib/bankPaymentLinkCore.ts` `autoReceiptMatch`, `creditLinkable(state, match)`): a matched credit is linkable when the match is automatic (not `manual`), pays no PayPro order and pays at least one receipt. The settlement card and the member page's "Record a bank payment" list show it with "Now matched automatically to bank transfer <ref>. Linking replaces that match…". Linking writes the manual link, which always wins, so the guessed receipt goes back to "waiting for its own bank credit". Audit `payment.bank_link` carries `replacedAutoMatch`, `closedCheckouts` and an optional `note`. `linkCreditToMember(…, { dryRun })` returns the decision without writing.
- **Paid by another method** (`lib/payments/closeOtherCheckoutsCore.ts` pure, `lib/payments/closeOtherCheckouts.ts`): after a payment is approved — both branches of `activatePayment` (PayPro callback/cron, approved receipt, bank link "activate") and the bank-link "attach" step — the member's other PENDING checkouts for the same plan code are marked `checkout_closed_at` + `paid_another_way` (status unchanged, nothing deleted; a late PayPro payment still activates). Never one with a receipt screenshot or a typed bank reference. Timeline "A started payment was closed: paid by another method"; payment row "… — cancelled, paid by another method". The banner, Follow-ups and Overview already skip closed checkouts.
- **Revenue and Paid** already counted every approved payment whatever the provider or method (`loadFinancePayments`, the paid-today loader); the test pins it.
- **Review button** on admin tutor cards (`showReviewButton` in `lib/tutorDocSummaryCore.ts`): only when the Documents row is "Waiting"; a card with no Documents row (a parent) keeps it.
- **Tutor status** (`tutorStatusFact`): `verification_status` stays 'pending' until the video review, so fee paid + documents approved reads "Verified"; otherwise the reasons as before.
- **Data step** (`scripts/dataop-link-ayaz-bank-credit.ts` → CRON_SECRET route `/api/internal/link-ayaz-bank-credit`, fixed to that one credit and member): Ayaz's credit linked to him through the same path, attached to his manual grant, audited as the Owner with a note naming this fix. The credit has no time recorded, so the payment is dated noon 20 Oct PKT.

## Camera-only selfie, 15-subject limit, tuitions live 20 days (owner, 21 Oct 2026)

Migration 190 (additive, dry-run then applied before the code): `user_documents.photo_dhash` and `user_documents.same_as_profile_photo`. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **a tuition stays live 20 days** (supersedes the 15 days of 13 Oct); **the selfie is taken with the device camera only — no gallery, no file upload** (supersedes the camera-or-gallery tile for the selfie; CNIC sides, the profile photo and degree certificates keep it); **a tutor may have at most 15 distinct subjects** (separate from the 400-entry `TUTOR_SUBJECT_CAP`). `npm run test:pause`, `test:tuition`, `test:subjectlimit`, `test:liveselfie`.

- **20 days.** `TUITION_LIVE_DAYS = 20` in `lib/tuitionStatus.ts`, read by the nightly sweep, Resume and Refresh, JobPosting `validThrough`, the countdown and every label (`TUITION_LIVE_LABEL`); the five admin strings that hard-coded "15 days" now read the label. No Urdu text mentioned the number. The 60-day paused-indexable rule is unchanged. One-time `scripts/dataop-resume-20-day-tuitions.ts` (rule `lib/autoPauseResumeCore.ts` `resumeVerdict`) put back live every tuition the old rule paused by age (`pause_source` 'auto' or 'backlog') that is under 20 days old, KEEPING its own clock (so it pauses on its own day 20), one `job.resume` Audit row each (actor "system: 20-day rule"), one URL_UPDATED in `indexing_queue`; never a staff, poster, self, no-contact or merged pause, a closed/hired tuition, or a poster who is suspended, banned or self-paused; a tuition with no valid contact number stays paused. Posters were not notified.
- **Selfie** (`components/tutor/LiveSelfieCapture.tsx`, rules `lib/liveSelfieCore.ts`): phones open the front camera directly (`capture="user"`, the only input; a file older than 15 minutes is refused as an old photo); computers get a live webcam preview (Take photo → Retake / Use this photo); no camera or permission denied → "Please open this step on your phone to take your selfie" with the page link and a QR code, and no upload fallback. Used by the new and old onboarding selfie steps, Settings and `IdentityDocsStatus`. Approved selfies, the lock and the Owner-only unlock are unchanged; the re-upload after an unlock uses the same capture. Staff uploads on the tutor edit screen are unchanged.
- **Selfie vs profile picture** (`lib/photoHashCore.ts` pure, `lib/selfieMatch.ts`): after a selfie upload (member or staff), the selfie is compared with the profile picture in use and the uploaded original — the same file (SHA-256) or a 64-bit dHash within 10 bits — and `same_as_profile_photo` is stored. A match shows the amber "Looks the same as the profile picture — check it’s a live selfie." on the tutor review card (`/admin/tutors/[id]`), the member page and the Documents to approve cards (`CardDocs.selfieLooksLikePhoto`). A warning only. Selfies uploaded before migration 190 are not checked (null).
- **15 subjects** (`lib/subjectLimitCore.ts` pure, `lib/subjectLimit.ts`): a subject counts once however many levels, and names merged by `lib/subjectDisplay` count once. `/api/profile/save`, `/api/tutor/onboarding` and the staff `set-subjects` edit refuse, before writing, a set over 15 that ADDS a subject not already saved ("You can choose up to 15 subjects. Remove one to add another."). A tutor already over 15 keeps everything, saves other fields, keeps or shrinks the set. The pickers (new onboarding, old onboarding, Settings, staff edit) show "N of 15 subjects" (`components/tutor/SubjectLimitNote.tsx`), disable adding at 15 and show "Parents trust focused profiles — please keep your top 15 subjects." when over. Read-only `scripts/report-subject-limit.ts`.

## Payments page — two filters; "Check with PayPro" fees (owner, 21 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **Admin → Payments has exactly two filters, Paid / Completed and Unpaid / Incomplete** (supersedes All / Bank transfer receipts / Waiting / Approved / Rejected). Rules pure in `lib/paymentFiltersCore.ts`; `npm run test:paymentfilters`; read-only `scripts/report-payments-filters.ts`.

- **Paid / Completed** = approved and never refunded, by any method. **Unpaid / Incomplete** = everything else: Started, not paid (under 48 hours, never closed) · Expired (older, or closed as expired) · Cancelled (closed by the member, paid by another method, already paid / held) · Rejected · Refunded / Partly refunded · receipts waiting. Refunded follows Finance's "counted = never refunded". Waiting bank receipts sort first with the amber "Receipt waiting — review" badge and the existing Open receipt / Approve / Reject (Owner only); the rest newest first with a grey label. No filter chosen → Unpaid when a receipt waits, else Paid.
- **Old addresses** (`?filter=all|receipts|pending|approved|rejected`) 308 to the new filter, search kept (`legacyPaymentFilter`); the access gate runs first.
- **Hidden rows:** a payment with no linked, named member, or whose member is a test account (`hidden_from_public` / `is_test_name`), is hidden until "Show N hidden rows" (`?hidden=1`). A waiting receipt is never hidden. Nothing is deleted. Staff accounts are ordinary payers.
- **One list, one count.** `loadPaymentQueue` reads every payment once, classifies, searches (name, email, our reference, their reference), hides, sorts, then pages by offset — the chip counts, the header (`paymentsHeading`: "Payments (N)" / "Payments — showing X of Y") and the footer all describe that list.
- **Negative gateway fees:** six October PayPro orders have MerchantShare above Order-Amount in PayPro's own export (TM-20261002075312-C3AAD5 Easypaisa 199 / 203; TM-20261002150450-186C73, TM-20261004152320-9FEFF3, TM-20261004151340-2935B0, TM-20261004093245-24066C, TM-20261004124851-86B1EB JazzCash 199 / 200). Our fee (amount − share) is right, so their data is not changed: `feeNeedsCheck` shows "Check with PayPro" on the order line and in "Gateway fees by method" (`FeeRow.checkOrders`), and those orders are left out of that table's per-order fees and total. The month card's "Gateway fees" total and the CSV are unchanged.

## Social posts — only verified tutors; "I'm a Verified Tutor" template; grey avatars for hidden photos (owner, 21 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **Admin → Growth → Social posts lists only verified tutors** (supersedes "every real tutor appears", 14 Sep); **a tutor with no photo to show is drawn as the grey gender silhouette on every social template** (supersedes the coloured initials disc on the social banner and the tutor's own share card). `npm run test:socialverified`; read-only `scripts/report-social-picker.ts [samples-folder]`.

- **Who appears** (`lib/social/eligibilityCore.ts`, pure; rows read by `lib/social/eligibility.ts`, uncached): Verification Fee paid (`verified_fee_paid_at` — a payment or an Owner grant), CNIC (`deriveCnicStatus` 'approved'), photo and selfie approved; not suspended, banned or self-paused; not seed, team, test-named or hidden. The picker (`app/admin/social/page.tsx`, force-dynamic) and the render route (`/api/admin/social/image`: signed out 401, no access 403, not verified 403 "Only verified tutors can be posted.") read the same rule. On 21 Oct 2026: 33 tutors.
- **Template `verified`** ("I'm a Verified Tutor", the default; `DEFAULT_SOCIAL_TEMPLATE`): logo, headline with "Verified Tutor" in green and a drawn tick, one line (the Headline field replaces it, max 90), the tutor card (photo or silhouette, name — shrinks, wraps to 2 lines — up to 3 subject chips, city), green bar "Get your profile verified → tutormint.org", "New tuitions posted every day", the slim brand band. Square/Story stack; Wide puts the headline left and the card right. All words in `lib/social/copy.ts`; margins in `VERIFIED_MARGIN`, checked empty by the test at all three sizes. No price, fee or superlative on any template (tested).
- **Hidden photo** (`lib/social/avatars.ts` `socialPortraitSrc`): "Hide my photo from parents" (or a rejected/missing photo) → the grey silhouette for the profile gender (female, male, else neutral), embedded from `public/avatars` as data URIs; the real photo URL is never passed to the render. The other four templates and the tutor's own `/api/tutor/social/verified` card use the same `Portrait`.

## Social posts redesign — big framed photo, heavy type, one structure for all five templates (owner, 21 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **every social template uses one structure** — logo, a heavy headline with green key words, the framed photo, name, up to three subject chips + city on one row, a CTA pill, the small footer (supersedes the four separate layouts and the "New tuitions posted every day" footnote of the verified template); **a post's photo is cropped on the face and shoulders**, with admin Zoom / Move for that post only. `npm run test:socialverified` (all 15 template × format combinations), `npm run test:social`.

- **Font.** Plus Jakarta Sans 500 / 700 / 800 (SIL OFL 1.1, `assets/fonts/plus-jakarta-sans/`, latin subset from @fontsource 5.3.0), embedded as base64 in the generated `lib/social/fonts.ts` with each weight's ASCII advance widths (`npx tsx scripts/build-social-fonts.ts`). Geist Regular is the fallback face.
- **Fitting** (`lib/social/fit.ts`, pure): headlines and names are wrapped with the font's widths — at most two lines, the green key words kept on one line (shrinking up to 30% to do so), ellipsis only at the minimum size. `render.tsx` `plan()` sizes every block, gives the photo what is left (square ring 270–470 px; a standard sub-line is dropped on Square when it would push the photo under 400 px — never text the admin typed), and steps all word sizes down in 5% steps until a very long name + headline fit. `SAFE_MARGIN` (≥ 6% per side) holds no ink at any combination — the test checks it pixel by pixel, decoration shapes included (low opacity, under the threshold).
- **Templates** (`THEMES`; words in `lib/social/copy.ts` `headlineFor` / `subLineFor` / `occasionFor` / `ctaParts`): I'm a Verified Tutor (light ground, navy→green ring, "Get your profile verified → tutormint.org"); Spotlight ("Meet your next tutor", white, green ring, outlined "Hire verified tutors"); Bold ("Hire a Verified Tutor", navy, mint key word, mint→green ring, mint pill); Success ("Congratulations" + drawn party popper, the occasion line, gold→green ring, pill "Verified on TutorMint" / "Hired through TutorMint"); Announcement (Headline field or "New on TutorMint", navy, white ring, gold date chip, outlined mint pill). The ✓ badge sits on the ring's lower right. On dark grounds the monogram sits on a white tile and chips are white with navy text. Text pairs are on `check:contrast`.
- **Crop** (`lib/social/cropCore.ts` pure, `lib/social/crop.ts` sharp): no face-detection library is in the stack, so the default is an upper-centre crop — a tall (full-length) photo is zoomed and taken from its top. The admin's Zoom (1–3×) and Move (±5 steps of 10%) travel as `zoom` / `x` / `y` on the render URL and are never saved; the render route writes nothing. A silhouette passes through uncropped. The tutor's own share card (`/api/tutor/social/verified`) uses the same crop and look.
- `scripts/report-social-picker.ts <folder>` writes all 15 combinations for a real verified tutor with a photo, the Square of each template for a hidden-photo tutor, and a contact sheet (`scripts/socialContactSheet.ts`).

## One People page (Tutors / Parents / Staff); a simpler Finance page (owner, 21 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **People (`/admin/users`) is the one member directory, tabs Tutors | Parents | Staff** (supersedes Verification → Tutors, Verification → Parents, Overview → Tutors and Documents to approve as lists, and the Everyone / role / Suspended chips); **the Verification sidebar group is gone and People carries the documents-waiting badge**; **Finance is one page** (supersedes the Finance | Settlement check tabs of 15 Oct). Layout only for Finance: matching, numbers and Owner-only routes unchanged. `npm run test:people`, `test:financeitems`, `test:people:live`.

- **Who counts** (`lib/peopleDirectoryCore.ts` `excludedReason`, read by every People count, the Overview "New tutors" / "New parents" cards and "Documents to approve", and the People badge — `lib/peopleDirectory.ts` `loadDirectory` is the one loader): staff accounts (role admin) are on the Staff tab only; seed, team, test-named and `hidden_from_public` accounts are left out; a tutor/parent account linked to staff (a `staff.*` audit target, same email or mobile as a staff account, or linked to one) is left out unless it has real activity (tutor: fee paid, onboarded or subjects; parent: a tuition, a paid plan, or documents sent). "Show staff & test accounts" (`?all=1`) brings them back.
- **Tutors tab:** Paid / Unpaid (`verified_fee_paid_at`, Owner grant included), then the Documents chips (the shared `lib/tutorDocSummaries` status). **Parents tab:** Posted a tuition / Not posted yet, then Waiting for review / Verified / Not submitted (+ Rejected only when someone is in it); card shows mobile verified, tuitions open/total, plan, verification, last active. **Staff tab:** role (`roleBadge`), last active, Team activity link. Cards are the shared `OverviewCardGrid` (new `filterRows`, `tags`, `searchText` for email/mobile search, `parent`, `dupes`).
- **Possible duplicate** tag (same mobile, same CNIC, or a similar name in the same city; a linked second-role account never) — tags only, nothing merged.
- **"That's all 25 tutors"**: `lib/useInfinite` kept the previous list's load-more cursor when a chip changed under a mounted component (Pending had no next page, so All stopped at 25). The hook now restarts when its `storageKey` changes.
- **"CNIC pending" on an approved tutor**: the old pill read `tutor_profiles.verification_status`, which stays 'pending' until the video review. The video-review screen now shows the shared Documents status.
- **Addresses:** `/admin/tutors` → `?tab=tutors` (filter=pending → docs=waiting), `/admin/parents` → `?tab=parents&pv=…`, `/admin/overview/tutors|parents|todo-docs` → the matching tab/chip, `/admin/users?filter=approval` → Tutors · Waiting. The intro-video Approve / Hold tool moved to `/admin/tutors/videos` (linked from the Tutors tab).
- **Finance** (`lib/financeItemsCore.ts`): three cards (Received, In the bank, Needs attention), two filters (Needs attention · All good ✅) covering every credit, order, receipt and missing payment once, plain labels; one "Link" per bank credit (one search: member, order or payment — the same Owner-only routes, the member path still asks for the password); "Ignore (not a sale)", Unlink and Back to automatic in a ⋯ menu; one "+ Add" (Add bank credit · Upload PayPro export); totals, fee table, range check, full lists and downloads behind "Show details". `?tab=` and `/admin/finance/settlement` redirect to `/admin/finance` (month/from/to kept).

## Follow-ups — every unfinished sign-up, one reason per card, full links in WhatsApp, account flags (owner, 21 Oct 2026)

Migration 191 (additive, dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **Follow-ups lists every unfinished sign-up of any age** (supersedes "tutors in their first 30 days who have not paid"); **a tutor is on the Tutors tab only, an unconfirmed email included** (supersedes `onParentsTab` taking email-unconfirmed tutors); **every admin pre-filled WhatsApp message carries ONE full https://www.tutormint.org link on its own line**. The Follow-ups layout is unchanged. `npm run test:followupreasons`, `test:followupflags:live`; read-only `scripts/report-follow-up-chips.ts`.

- **Who is on Follow-ups.** Tutors: every tutor-role account not yet done, whatever their sign-up date — `lib/tutorFollowUpCore` `tutorDone` = Verification Fee paid AND CNIC, photo and selfie approved AND every onboarding step done (the "Paid, not finished" group keeps paid tutors whose profile is unfinished, so they stay until done). An approved document waiting for a re-review does not hold a done tutor back. Groups (`TUTOR_SCOPES`, `tutorInScope`): Last 30 days · Older than 30 days · Paid, not finished · Not interested (hidden). Parents: as before (email not confirmed, or profile under 100%), now any role but tutor. Both tabs leave out the People page's excluded accounts (`loadDirectory()` `excluded !== null`: staff, seed, team, test, staff-linked without activity) and paused (suspended / banned) accounts.
- **Not interested** (`lib/followUpDismissals.ts`, `POST /api/admin/follow-ups/not-interested`, `components/admin/NotInterestedButton.tsx`): the list's own access (tutor → `unpaidSignups`, others → `signups`); moves the member to the hidden "Not interested" group (who / when on the row, `member.not_interested` in Audit); "Undo not interested" stamps `undone_at` (`member.not_interested_undo`). Nothing deleted. The Overview rows that read this list (`tutorsWithChip`, "Signed up, not paid") leave marked members out too.
- **Reason line** (`followReason`, first match): "Documents rejected — <document>: <reason>" · "Waiting for our approval (<n> days)" (from the oldest waiting upload) · "Started Rs 199 payment, didn't finish" (a plan: "Started <plan> payment…") · "Documents approved, fee not paid" · "Stopped at: <step>" · "Signed up, never verified mobile"; plus " · No activity for <n> days" when last seen (activity_sessions, else the sign-up) 14+ days ago. "Next: <step>" and "See all steps" are unchanged.
- **Waiting on the tutor / Waiting on us** — two more chips (`WAIT_CHIPS`), every card in exactly one: Waiting on us = the reason is "Waiting for our approval". Those cards show no WhatsApp follow-up (`showWhatsApp`); the Owner gets "Review" (→ the member page's Documents) and "Message on WhatsApp anyway" stays under "See all steps". The state badge and "All" order still come from the six state chips (`PRIORITY`).
- **Links** (`lib/waLinkCore.ts`): `siteLink(path)` writes `https://www.tutormint.org/…`; `finishWaText` (run by every wa.me builder — `waLink`, `adminWaLink`, `followUpWaLink`, `waMeHref`, and the member page's payment follow-up) writes any `tutormint.org` link in full and, when a message has exactly one link, puts it on its own line (several different links, e.g. Featured WhatsApp, stay in place). The code-built messages (Follow-ups, member page / People / Documents to approve) end with the link; migration 191 rewrote the seeded `documents_approved`, `documents_approved_paid`, `payment_not_finished` and `my_signup_*` bodies (only where still the seeded wording) to end with the link placeholder on its own line. No Urdu text changed.
- **Link previews.** `/pay/choose` and `/tutor/dashboard` send a signed-out visitor (and WhatsApp's preview fetcher) to `/login`, which now has its own Open Graph card: "Sign in to TutorMint", the logo image (`socialMeta`). Tutor profiles keep their own preview.
- **Account flags** (`scripts/dataop-followups-account-flags.ts`, audited under the Owner): Javeria Fiaz's tutor account (`c656ab23…`) — test mark off (`member.unhide_public`); Aqsa Mughal's second tutor account on the same mobile (`532e5da5…`, no payment, signed up 14 Sep) — marked as a test account (`member.hide_public`); her real account is `d5c10c45…` (Verification Fee approved 13 Oct 2026).

## Social posts C3 — seven new layouts, one tick, Shuffle, three captions, tutor link previews (owner, 21 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **Social posts has twelve templates** (supersedes the five of C2); **"I'm a Verified Tutor" has no tick after the headline** — the ✓ badge on the photo ring is the only one; **a tutor profile's `<title>` and og:title are the first WHOLE form that fits 60 characters** (supersedes `seoTitle("<Name> — <three subjects> tutor in <City>")`, which could cut inside a subject); **a tutor profile's og:image is a generated 1200×630 card** (supersedes the raw photo / site default). `npm run test:socialverified`, `test:social`.

- **Files.** `app/api/admin/social/image/pieces.tsx` (formats, margins, fonts, render params, the shared drawn parts — footer, logo, ring, chips, CTA), `render.tsx` (the C2 stack + the dispatcher `renderSocialBanner`), `layouts.tsx` (the seven C3 layouts). Words in `lib/social/copy.ts`; the catalogue and Shuffle in `lib/social/templates.ts` (pure); one tutor's post data in `lib/social/postTutor.ts` (shared by the admin route, group posts and the share image — never reads CNIC, date of birth, phone, WhatsApp or email).
- **New templates** (each its own layout, two colour looks, `?v=0|1`): Split card, Verified ID card (photo, name, ≤3 subjects, city, "✓ Verified by TutorMint" seal, the profile QR — navy, no CNIC/DOB/phone, nothing like a NADRA card; the footer QR is left out so there is one), Tutor's own words (the profile headline exactly, trimmed to fit; refused 409 "No headline on profile" and disabled in the picker without one), Subject spotlight (top subject as a huge low-contrast word; "<level> <subject> tutor in <city>"), Meet our verified tutors (`?city=&slugs=a,b,c,d` — 4–6 verified tutors of that city, default the most recently verified; caption lists the names and links `/browse/tutors?city=`), Just verified (text only), Polaroid (tilted print, name in Caveat Bold — SIL OFL, `assets/fonts/caveat/`, embedded by `scripts/build-social-fonts.ts`). Gold only on Just verified.
- **Fitting.** Every layout is a stack of blocks of known height (text wrapped with the fonts' own widths); sizes step down 5% until it fits; the safe area clips. The test renders 12 templates × both looks × 3 formats with a very long name and headline and checks the 6% margins hold no ink.
- **Shuffle** (`shufflePick`): a random template (and, Square/Story, a random look), never the previous template for that tutor; never the group post; never own-words without a headline; a tutor with a hidden photo only gets photo-free templates (ID card, own words, subject spotlight, Just verified).
- **Captions** (`captionVariants`): three per template — same facts, link, handles, hashtags and tagline, different lead; "Next caption" cycles, Copy copies the one shown.
- **Tutor link previews.** `tutorOgTitle` (lib/seo/tutorOg.ts): `<Name> — <summary> tutor in <City> | TutorMint`, summary = the level range for 3+ subjects, else two subjects, one subject, the level; then the first name; then no subject. og:description = the tutor's headline (else "Teaches …") + "Free to join. No commission. No middleman." (≤155). og:image = `/og/tutor/<slug>?v=<hash>` (`app/og/tutor/[slug]/route.tsx`, not under /api which robots.txt disallows): the Wide design with the photo or the grey silhouette; "I'm a Verified Tutor" only for a tutor who passes the Social posts verified rule, else the neutral "Tutor on TutorMint" look (navy/red, no green, no ✓, and the tutor's own headline is left out if it says "verified"). The `v` hash covers photo (or hidden), name, verification, city, subjects and headline, so a change gives a new URL; `Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800`. Under-review / unclaimed / non-public profiles: 404 (the page keeps the site default).
- **test:overview:live** checks New tutors / New parents against the People page's exclusion rule (seed, team, test-named, hidden, and staff-linked without activity).

## Application tracking — stages, owners, overdue flags, tutor status, Hired count (owner, 22 Oct 2026)

Migration 192 (additive, dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **Applicants to forward is part of Follow-ups → Applications** (`/admin/jobs/applicants` 308s to `/admin/follow-ups?tab=applications`, its old `?tab=` to the "Forward to parents" view; the sidebar item is gone); **the Follow-ups sidebar badge is overdue applications** (the old To-forward badge is gone); **the parent's phone on the forward board is masked in the list** (0321•••••22; the WhatsApp/Call buttons still dial it). Rules pure in `lib/applicationStageCore.ts`, I/O in `lib/applicationTracking.ts`. `npm run test:applicationtracking`; read-only `scripts/report-application-tracking.ts`.

- **Stages.** Applied → Forwarded → Contacted → Demo/interview → Hired, or Not selected / No response. Stored on `applications.stage` with who and when; every change writes `application_stage_events`, `admin_audit_log` `application.stage` (target the tuition — its history) and the tutor's timeline (`application_stage_changed`, "Application moved to <Stage> by staff"). A new application starts at Applied (insert trigger). "Mark as forwarded" on the forward board moves each included tutor's application from Applied to Forwarded (later stages untouched). **A stage never changes the tuition** — status, expiry, noindex, JobPosting and visibility stay with the parent's own hire flow (`hireApplicant`), which was not changed.
- **Backfill:** an application in an `applicant_forwards` row → Forwarded (dated by that forward, by its staff member); everything else → Applied (dated by when it was made). On 22 Oct 2026: 133 Applied, 26 Forwarded (159 rows; 126 + 26 counted — 7 are test/staff tutors). No later stage was guessed.
- **Owners** (`tuition_owners`): the staff member who posted the tuition — backfilled from the first `job.post` audit row; `createTeamJob` records it for every new staff post (`recordPoster`). Parent-posted tuitions and the oldest pre-audit ones have no recorded poster → Unassigned. Only the Owner reassigns (one tuition from its row, or ticked rows in bulk; `POST /api/admin/applications/owner`, 403 otherwise; audited `job.owner_assign` with from/to).
- **Who edits a stage** (`mayEditStage`): the Owner any; anyone else only on tuitions they own (`POST /api/admin/applications/stage`, 403 otherwise); everyone else read-only. Screen access is `SCREEN_ACCESS.applicantForwards` (admin, operations, tuitions staff, Partner).
- **Hired** opens a confirmation listing the tuition's other open applications (`/api/admin/applications/others`), each with a tick box, none ticked by default; the ticked ones become Not selected.
- **Overdue** (`overdueFlag`): Applied MORE than 1 day → red "Forward overdue"; Forwarded / Contacted / Demo with no update for MORE than 3 days → amber "Check in" (exactly 1 / 3 days is not yet). Overdue rows sort first. The Follow-ups red badge = overdue applications on the signed-in staff member's own tuitions; all of them for the Owner (`overdueApplicationsCount`).
- **Applications tab** (`/admin/follow-ups?tab=applications`; `show=` mine | all | unassigned | a stage — default Mine for staff, All for the Owner): tutor name, masked phone, tuition title + TM number, city, owner, stage dropdown (or a read-only chip), time at the stage, WhatsApp check-in (`GET /api/admin/applications/whatsapp` — the same server pre-fill + wa.me redirect as Follow-ups; English message by stage, tuition link on its own line; audited `application.whatsapp_open`). A Hired row has "Success story" → `/admin/social?tutor=<slug>&template=success&success=hired` (Social posts now reads those params) when the tutor passes the Social posts verified rule, else "Verify first".
- **Who counts:** not withdrawn, and not a staff, seed, team, test-named or hidden tutor (the People rule — an applicant has paid the fee, so has activity).
- **Admin tuition cards** (`/admin/jobs`): "6 applied · 2 forwarded · 1 hired" (forwarded = Forwarded or any later stage except Not selected); "No applications yet" when none.
- **Public cards and tuition pages:** "<n> tutors applied" ("1 tutor applied"), only when n ≥ 1, from `job_applied_counts` — never a name, a stage or "Hired". Not in JobPosting.
- **Tutor dashboard:** a "My applications" section (title, city, date applied, the stage in the owner's words: Sent to the parent team · Shared with the parent · Parent contacted you · Demo/interview stage · You got this tuition ✓ · The parent chose another tutor · No reply from the parent) and a green "Hired" tile — on the tutor's own dashboard only. Never the parent's name or number.


## Applications v2 — its own page, Staff filter, grouped list, worked items sink, Older, city owners, parent hires (owner, 22 Oct 2026)

Migration 193 (additive, dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **Applications is its own page, Tuitions → Applications (`/admin/applications`)** (supersedes "Follow-ups → Applications", earlier the same day); **the overdue badge is on Applications, and Follow-ups has no badge for applications**; **overdue is counted from the last activity, and applications on tuitions posted more than 30 days ago are never overdue**; **a tuition no staff member posted belongs to its city's owner** (supersedes "parent-posted tuitions … → Unassigned"); **a parent's own hire moves that application to Hired**. Rules pure in `lib/applicationStageCore.ts` (the "Applications v2" section) and `lib/cityOwnersCore.ts`; I/O in `lib/applicationTracking.ts` and `lib/cityOwners.ts`. `npm run test:applicationsv2`.

- **Addresses.** `/admin/follow-ups?tab=applications…` and `/admin/jobs/applicants…` permanently redirect to `/admin/applications` (`legacyApplicationsHref`: `show=mine|all|unassigned` → `staff=`, `show=<stage>` kept, `view=forward` / `fwd=` kept, Applicants to forward's `tab=` → the forward view). `/tuitions` (the bare address only) is a 308 to `/browse/tuitions` (next.config.ts).
- **Staff filter** (`?staff=all | unassigned | <staff id> | mine`): staff open on their own name, the site Owner on All; the dropdown lists every owner with applications, plus Unassigned, with counts (`staffChoices`). Anyone may view another list; stage changes stay own-tuitions-only, the Owner any (`mayEditStage`, re-checked by the route). Stage chips (`?show=`) count within the staff filter.
- **Grouped list** (`groupBoard`): one group per tuition — TM number, title cut at a whole word (`shortTitle`), city, owner, "4 applied · 1 forwarded" (`groupCountLine`), Forward to parents — and one compact row per application (name, masked phone, stage, time at stage, flag, WhatsApp, Success story / Verify first). Order: overdue groups (oldest overdue item first), then groups with an item not yet worked (oldest first), then fully worked groups (most recently worked LAST). Inside a group: overdue, then unworked, then worked rows (muted, "Updated <time> by <name>").
- **Activity** = `applications.worked_at` (+ by / name), written on every staff stage change (`writeStage`), on a WhatsApp check-in tap (`recordCheckInTap` in `/api/admin/applications/whatsapp`) and on a forward (`advanceForwarded` — Applied moves to Forwarded, any later stage is only marked worked). `itemOverdue` = the 1-day / 3-day rules counted from `lastActivityAt` (stage change or activity, the later); a worked row is one with activity that is not overdue again, so it returns to the top with its flag when due. Backfill: rows whose stage was set by staff are worked as of that change.
- **Older** (`OLDER_AFTER_DAYS = 30`, by the tuition's `created_at`): a collapsed "Older (n)" section at the bottom; never overdue, never in a badge; stages untouched, so the tutor dashboard is unchanged. On 22 Oct 2026: 19 applications.
- **Search** covers every application, filters set aside (tutor, TM number with or without "TM-", title, city — `searchMatches`); found rows are highlighted where they sit and the Older section opens when it holds one.
- **City owners** (`city_owners`; Tuitions → City owners, `/admin/settings/city-owners`; `SCREEN_ACCESS.cityOwners = []` — the site Owner edits, the Partner views; `POST /api/admin/city-owners`, audited `city_owner.set`). The rule (`cityRuleApplies`, `cityOwnerFor`): a tuition with no staff poster (`tuition_owners.posted_by` null) and no hand-chosen owner (`source <> 'reassigned'`) gets its city's owner, else the site Owner; a row the rule wrote (`source 'city'`) follows a later change of the city owner. Staff-posted tuitions are never changed. New parent posts are assigned in `createJob` (`assignNewTuitionOwner`); staff posts record `posted_by` (`recordPoster`). Every assignment is `job.owner_assign` in Audit, actor "system: city owners". Seed (22 Oct 2026): every name matched exactly one staff account (Nabeel → "Nabeel", Inzamam → "Inzamam Ullah"); 21 cities mapped, none unmapped; 48 tuitions with no owner assigned (Lahore 41 → Aqsa Mughal, Islamabad/Rawalpindi 4 → Nabeel, Karachi 3 → Khizra Danish), 0 to the site Owner.
- **Parent hires** (`recordParentHire`, called by `hireApplicant` after the hire is written): that tutor's application → Hired, `stage_changed_by_name = 'Parent'`, a stage event (staff_name "Parent"), an `application.stage` Audit row on the tuition (actor = the parent, role member) and the tutor's timeline ("Application moved to Hired by the parent"). The other applicants' stages are not touched (their old `status` handling is unchanged), and the tuition is not written again. Backfill: 0 past parent hires had an application not at Hired.
- **Admin Tuitions → "Posted by"** (`?poster=<staff id>`, the "Posted by admin" tab): reads `tuition_owners.posted_by` with an inner embed; the dropdown lists every staff poster with counts (`adminPosterFacets`).


## Applications v3 — stage-based follow-ups, To do / Sent, one place to forward, per-tutor check-in (owner, 22 Oct 2026)

Migration 194 (additive, dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **the row WhatsApp button writes to the parent or the tutor by stage** (supersedes v2's single tutor check-in); **"To do" / "Sent" tabs replace "worked items sink to the bottom"**; **the badge counts overdue To do items only**; **the separate "Forward to parents" tab is gone** — the button on each tuition group opens the same features in a panel. Rules pure in `lib/applicationFollowUpCore.ts` (due rules, tabs, grouping) and `lib/applicationMessagesCore.ts` (EVERY message's wording — one file); I/O in `lib/applicationFollowUps.ts`. `npm run test:applicationsv3`.

- **Messages** (`stageMessage`, `STAGE_RECIPIENT`, `STAGE_MESSAGE`): Applied → parent, shares the tutor's profile link; Forwarded → parent, "did you get a chance to contact them?"; Contacted → parent, demo or interview?; Demo/interview → parent, how did it go, go ahead?; Hired → tutor, congratulations + a line for a success story; Not selected / No response → tutor, a kind update + `/browse/tuitions?city=<their city>`. Every message has the TM number and title, links on their own line, and ends with `SUPPORT_LINE` (WhatsApp 0321 5872222). No price, fee or superlative (`FORBIDDEN_WORDS`, tested); names and titles go through `clean()` (no number or email can ride in). The button reads "WhatsApp parent" / "WhatsApp tutor", or is disabled as "No parent number" / "No tutor number" (`buttonLabel`; `BoardRow.hasParentNumber` — the number itself never reaches the page).
- **Sending** (`POST /api/admin/applications/follow-up`, `SCREEN_ACCESS.applicantForwards`): the server reads the number (parent = `job_contacts` for a team-posted tuition, else the posting account; `parentContacts`), builds the message, records the follow-up and returns the wa.me link + the record id. The browser opens a tab in the tap and points it at the link; a toast offers **Undo for 10 seconds** (`ToastAction.ms`) → `POST /api/admin/applications/follow-up/undo` stamps `undone_at` on the staff member's own rows (never deleted). Each send writes `application.follow_up` in the tuition history and `application_follow_up` on the tutor's timeline — recipient TYPE and message key only, never a number.
- **`application_follow_ups`** (migration 194): `application_id`, `job_id`, `tutor_id`, `stage`, `kind` ('follow_up' | 'tutor_update'), `recipient` ('parent' | 'tutor'), `message_key`, `staff_id`, `staff_name`, `created_at`, `undone_at`, `undone_by`. Admin-read RLS, service-role writes (signed-in member and staff tokens refused, proved in the apply script).
- **Due rules** (`dueState`), counted from the CURRENT stage only (a follow-up made before the stage changed does not count): Applied — due now, "Forward overdue" after 1 day; after a follow-up, due again 1 day later. Forwarded / Contacted / Demo — due 3 days after the later of the stage change and the last follow-up ("Check in"). Hired / Not selected / No response — due once; after that message, Sent for good ("Done"). To do = due; Sent = not due yet (it returns to To do on its due date). Older (tuition posted 30+ days ago) is a collapsed section at the bottom of To do, never overdue. Sent rows read "<message> sent to <Parent/Tutor> by <name>, <time> ago · next due <date>" (`sentLine`).
- **Badge** (`todoBadgeCount` in `overdueApplicationsCount`): overdue To do items, not Older — the viewer's own, every one for the site Owner.
- **Forward panel** (`app/admin/applications/ForwardToParents.tsx` `ForwardPanel`, opened by "Forward to parents" on a tuition group): the old card unchanged — tuition, parent (masked), every PAID tutor who applied or viewed the number (photo or grey silhouette — a hidden or rejected photo shows the silhouette — name, badges, subjects, experience, area/city, public profile link, admin page link, applied/viewed + when, "already sent", tick box with new ones pre-ticked), WhatsApp parent (the admin-editable "Applicants to forward" template), Call parent, Mark as forwarded (Applied → Forwarded, then a parent follow-up `message_key 'forward'` on each ticked tutor's application → Sent), Add parent number, "What did the parent say?" outcomes, the last forward/outcome lines, New applicant / Check with parent tags. Tuitions a paid tutor only VIEWED the number of (no application) are listed under the groups ("Viewed the number, no application yet" in To do; forwarded ones in Sent) with the same button. `?view=forward` / `&fwd=` and `/admin/jobs/applicants` redirect to `/admin/applications`.
- **By tutor** (`?view=tutor`): the same rows grouped per tutor — "N in progress", each tuition and stage, a Preview of the message (`?preview=<tutor id>` opens it), and one "WhatsApp tutor" (`POST /api/admin/applications/tutor-update`) listing every ACTIVE application (Applied → Demo/interview) in the dashboard's words with the dashboard link (`tutorUpdateMessage`). It records `kind 'tutor_update'` on each listed application ("Tutor updated <time> ago") and never counts as the parent follow-up. The Staff filter, stage chips, search and the tabs work in both views; search covers To do, Sent and Older and labels each result's tab.

## Applications v3.1 — the Applied message forwards, every message a template, support number from settings (owner, 23 Oct 2026)

Migration 195 (additive, generated by `scripts/build-migration-195.ts` from the code defaults; dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **sending the Applied-stage WhatsApp to the parent IS forwarding that tutor** (supersedes v3's "Applied — after a follow-up, due again 1 day later"); **every Applications message is an editable template** (supersedes "ONE FILE so the wording is easy to edit"). Rules pure in `lib/applicationTemplatesCore.ts` (defaults, placeholders, fill, checks), `lib/templateRules.ts` (the save check, Reset) and `lib/applicationFollowUpCore.ts` (`forwardUndoProblem`); I/O in `lib/applicationFollowUps.ts` and `lib/applicationTemplates.ts`. `npm run test:applicationsv31`.

- **Applied = forward** (`forwardByAppliedMessage`): the stage moves Applied → Forwarded (`writeStage` with an explicit time), an `applicant_forwards` row with that one tutor is recorded (the forward panel shows "already sent"; audited `applicants.forward`, `via: applied_message`), and the parent follow-up is recorded at the Forwarded stage (`message_key share_profile`) — all with ONE time stamp, so the row goes to Sent, due again 3 days later under the Forwarded rule. The tutor's dashboard reads "Shared with the parent".
- **Undo** (10 s in the browser, 60 s server grace, sender only; `undoFollowUps` routes a follow-up with `forward_id` to `undoAppliedForward`): allowed only while the application is still Forwarded with `stage_changed_at` and `worked_at` equal to that time and no later follow-up; then the stage fields saved in `restore` are put back (guarded update), the follow-up and the forward are stamped undone (never deleted), and a forwarded → applied stage event, audit rows and the tutor's timeline record it. Otherwise 409 "Can't undo, the application has changed since".
- **Templates** (Team inbox → Templates → Applications; `/admin/inbox?templates=1` opens it): `app_applied`, `app_forwarded`, `app_contacted`, `app_demo` (to the parent), `app_hired`, `app_not_selected`, `app_no_response`, `app_tutor_update` (to the tutor), plus the existing `applicants_forward` (parent). Not selected and No response are two templates because their v3 wording differs. Seeded byte-for-byte with the v3 wording (tested against a frozen copy). Each shows its recipient, its placeholders beside the editor, a live preview with sample data and "Reset to default". Unknown placeholders block a save (client and `PUT /api/admin/inbox`); a price or superlative is a warning; every edit and reset writes `template.edit` / `template.reset` in Audit. A stored body that is empty or carries an unknown placeholder is never sent — the default is (`resolveBody`). An empty value is removed cleanly (`fillTemplate`). The Applications templates are not offered in the member compose dropdown. Edit rights unchanged (owner/admin). One known difference from v3: a tutor with no profile address keeps the words "You can see their TutorMint profile here:" (the link line is dropped).
- **Placeholders:** {parent_name} (first name), {tutor_name}, {tutor_first_name}, {tm_number}, {tuition_title}, {city}, {profile_link}, {open_tuitions_link}, {dashboard_link}, {applications_list} (By tutor only), {support_whatsapp}; the forward message keeps {parent_name}, {tuition_title}, {area}, {tutor_list}.
- **Support number:** `app_settings` 'support.whatsapp' (already present; migration 195 only fills a fresh database) fills {support_whatsapp} in every Applications message and preview (`loadSupportWhatsApp`: setting → env → the constant). Owner-only edit at Team inbox → Templates → Applications (`POST /api/admin/settings/support-whatsapp`, `SCREEN_ACCESS.supportNumber = []`; audited `settings.support_whatsapp` with the number masked). Other places that write the number directly were listed for the owner, not changed.

## Tutor journey — Follow-ups To do / Sent, Activity tab, Paid tutors, Convert account type (owner, 23 Oct 2026)

Migration 196 (additive, dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **Follow-ups → Tutors is split into To do / Sent** and its WhatsApp is picked by the tutor's REASON for being stuck (supersedes the one code-built message per state of 20 Oct for this list — My sign-ups and the admin WhatsApp route keep `followUpMessage`); **Follow-ups has its own red badge again** (overdue To do items; supersedes "Follow-ups has no badge of its own", 22 Oct). The Parents tab is unchanged. `npm run test:tutorjourney`; read-only `scripts/report-tutor-journey.ts`.

- **Follow-ups → Tutors** (`lib/tutorFollowUpTabsCore.ts`, pure). Each tap (`/api/admin/follow-ups/tutor`) records the tutor, reason, template, a progress snapshot, the staff member and the time; 10-second Undo for the sender only (server grace 60 s). Sent = last message at the current progress under 3 days ago; due again at exactly 3 days. 3 messages at the same snapshot = Sent → collapsed "No reply after 3 messages", not due. A new step finished (a different snapshot) puts them back in To do and restarts the count. Calls, notes and follow-ups recorded before this change carry no snapshot: they count as contact, never towards the three. Waiting on us is not a message: To do with "Documents to review" + link, never in the badge. Badge = To do, not waiting on us, due for MORE than 1 day.
- **Templates** (`lib/followUpTemplatesCore.ts`): Team inbox → Templates → **Follow-ups** group, same editor / placeholders / preview / Reset / warnings / fallback as Applications (`lib/templateRules` FOLLOW_UPS_GROUP). Reused as stored (Urdu untouched): `signup_mobile_unverified` (no mobile), `profile_completion_nudge` (profile not finished), `payment_not_finished` (payment started), `fee_not_paid` (documents approved, fee due). New (seeded, plain English, no price): `fu_no_cnic`, `fu_no_photo`, `fu_reupload`, `fu_paid_unfinished`. Every filled message gets the link on its own line and the support number from `support.whatsapp` when the body does not already have it (`fillFollowUp`). `payment_not_finished` still has the number written in its stored text.
- **Activity tab** (`/admin/users/<id>/activity`, `SCREEN_ACCESS.memberActivity` — Tuitions staff included; `components/admin/MemberTabs` Profile | Activity). `lib/journey.ts` rebuilds one timeline, newest first, from existing records — signed up, profile steps (edits one line per day), follow-ups, calls, notes, payments (never an amount), documents and decisions, applications, forwards, stage changes, check-ins, hires, account type changes, pauses; parents: tuitions posted, tutors forwarded, follow-ups, hires. Nothing is stored twice; lines older than `JOURNEY_LIVE_AT` read "from records". Every line is scrubbed of phone / CNIC / email (`scrubPii`), and a note containing one is refused. Summary strip: Paid · Applications · Forwarded · Waiting to forward · Hired · Last contact. "Log a call or note" (`/api/admin/members/notes`): never edited, only withdrawn with a reason; audit row carries no note text.
- **Paid tutors** (`/admin/paid-tutors`, Tuitions group after Applications, `SCREEN_ACCESS.paidTutors`; `lib/paidTutorsCore.ts` + `lib/paidTutors.ts`). Paid = People → Tutors → Paid. Red: an application at Applied in no live forward for MORE than 1 day (Older tuitions never), or no contact for 7 days or more (never contacted: from the day they paid). Owner = the city owner of the tutor's city (else the site Owner). Badge = red rows in the viewer's cities, all for the Owner. Rows open the Activity tab.
- **Convert account type** (`/api/admin/members/convert`, `components/admin/ConvertAccountCard` on the member page; `lib/convertAccountCore.ts` + `lib/convertAccount.ts`). Site Owner only on GET and POST (`refuseUnlessOwnerApproval`), fresh password (`requireFreshAuth`), required reason, confirmation; paid (an approved, not refunded payment) or approved documents block it until a second confirmation that names them in words. Parent → Tutor: same account and login, tutor profile draft (name, city), their tuitions shown "posted as a parent" (derived: a job owned by a tutor account). Tutor → Parent: tutor profile hidden (directory requires role tutor), `converted_to_parent_at` set, its address 301s via `proxy.ts` (`lib/convertedTutorRedirect`, 1-minute cache; the page 308s as a backstop). Reversible with the same button. Audited `member.convert_role`; the person is told in-app and by email (`account_type_changed`) when the email is confirmed. **Not by SMS**: SendPK sends only the approved verification-code template, so a free-text SMS is refused (or would read as a code) — left out on purpose and recorded in the audit detail.


## Follow-ups polish — "Followed up" tab, emoji in WhatsApp, progress keeps the wait, Fee reply (owner, 23 Oct 2026)

Migration 197 (additive, dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **the Follow-ups → Tutors "Sent" tab is "Followed up"** (Applications keeps "Sent"; the URL value stays `?fu=sent`); **a tutor who makes progress stays in Followed up until 3 days after the last message** (supersedes "a tutor who finished a new step is back in To do at once", earlier the same day — the count of unanswered messages still starts again); **every pre-filled WhatsApp message uses `https://api.whatsapp.com/send?phone=…&text=…`, never `wa.me`** (supersedes "The link is https://wa.me/<92…>?text=", 20 Oct). `npm run test:followupspolish`; read-only `scripts/report-template-chars.ts`.

- **Why the "�".** WhatsApp's own wa.me address redirects to api.whatsapp.com/send and turns EVERY emoji in the text into U+FFFD on the way (checked 23 Oct 2026: `wa.me/…?text=%F0%9F%99%82` and `…%E2%9C%85` both redirect with `text=%EF%BF%BD`; Urdu passes through). The garbled character was the 🙂 in the code-built follow-up message. Our encoding was correct and no stored template held a broken character (all 36 scanned), so **no template was changed**. Fix: `lib/waLinkCore.ts` `waSendHref(msisdn, text)` is the one builder (`waSafeText` drops a lone half of an emoji or a "�" rather than send it — `encodeURIComponent` would throw on a lone surrogate); `safeSlice` cuts by character, used by `shortTitle`. Every pre-filled builder calls it: `adminWaLink` (member page, People, Applications check-ins, By tutor), `followUpWaLink`, `waLink` (Follow-ups → Tutors, Featured WhatsApp), `forwardWaLink`, `waMeHref` (documents approved), `whatsappHref` with text (Team inbox, Message parent, support links), `whatsappShareLink` (hiring post), the member page's payment follow-up and both document review cards. Fixed-English member links (daily report, doc lock, error messages, receipt help, the tutor profile's WhatsApp) keep wa.me; a plain chat link with no text keeps wa.me.
- **Followed up** (`FU_TAB_LABEL` in `lib/tutorFollowUpTabsCore.ts`): tab, counts, empty states ("Nobody to message right now." / "Nobody followed up in the last 3 days."), toast. `tabState`: any contact under 3 days old → Followed up, due 3 days after it, whatever the tutor did since; then To do with the message for their NEW reason (the reason is always worked out from where they are now).
- **About the Verification Fee** (`fu_fee_reply`, `FU_FEE_REPLY_DEFAULT`): Team inbox → Templates → Follow-ups, same editor, placeholders, preview, Reset and fallback; `{pay_link}` = `https://www.tutormint.org/pay/choose`. It states the fee's amount (a private reply to a tutor), so `warningsFor()` (lib/templateRules) drops the price warning for it alone — editor and save check; the superlative warning and the placeholder block still apply. **"Fee reply"** on every Follow-ups → Tutors row with a number (waiting-on-us cards included): opens the message, records a follow-up (`template_key 'fu_fee_reply'`, the row's reason and progress) through `/api/admin/follow-ups/tutor` with the same 10-second Undo, and counts as one of the 3 messages.
- **test:socialverified** never had a broken rule: it renders about 200 PNGs and took ~12 minutes in one process, and the previous PR's all-suites runner stopped any suite at 4 minutes, which Node reports as "test failed" at line 1. The render matrix is now split into 4 shards Node runs in parallel (`scripts/test-social-verified.ts` = shard 0 + every other test; `scripts/test-social-verified-render-1|2|3.ts`), ~5 minutes; every assertion unchanged, and a guard test fails if a shard file is missing. `SOCIAL_SAMPLES_DIR` still runs the whole matrix in one process.

## Staff links with a hidden code (owner, 23 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **/register has no "Staff code" box** (supersedes the sixth, optional field of 15 Oct — the form is "I am a…", Full name, Mobile number or email, Password, the Terms box and the buttons); **a staff member's personal link is `https://www.tutormint.org/join?ref=<CODE>`** (supersedes `/join/<slug>` as the link shown; that address still works); **every tutormint.org link a staff member sends or copies from the admin panel carries `?ref=<their code>`**. Built on the 15 Oct system (`staff_join_links`, `staff_referral_visits`, the httpOnly `tm_staff_ref` cookie, `staff_signup_credits.source`); no second system. `npm run test:stafflinks`; read-only `scripts/report-staff-codes.ts` (codes and counts only).

- **?ref on any page.** `components/StaffRefCapture.tsx` (in `SiteChrome`, so every public page) reads `?ref`, posts it once to `POST /api/ref` and removes `ref` from the address bar with `history.replaceState` (no reload; other parameters and the #fragment kept — `withoutRef`). `/api/ref` (`refLinkVisit` = `staffCodeVisit(…, 'link')`) records a visit with source `link` and sets the cookie for 30 days — only when the browser holds no valid credit (first link wins); an unknown or inactive code records nothing; bots and our own crawlers are skipped; always 204. Codes are case-insensitive (`normaliseStaffCode`).
- **/join** (`app/join/route.ts`): records the same credit and 307s to `/register?ref=<CODE>` (keeping `next` and `role`), noindex, `/join` disallowed in robots. Canonical tags are built from paths and never carry `ref` (checked by the test); the sitemap and JSON-LD are unchanged.
- **Sign-up.** `/register` reads `?ref` and an old `?code` on the server and the form sends them as `refCode` (source `link`) and `staffCode` (source `code`); `/api/auth/register` tries the stored cookie, then `refCode`, then `staffCode`, each only when there is no valid credit. Credit is attached exactly as before (email sign-up in the register route, mobile at `/api/auth/register/verify`), and `creditRefusal` still refuses staff and test accounts.
- **Messages.** `lib/waLinkCore.ts`: `withStaffRef(text, code)` / `addRefToUrl(url, code)` add `ref=<CODE>` to every site link that has none (never twice; before a #fragment); `finishWaText(text, code)` and `waSendHref(msisdn, text, code)` apply it; `waHrefWithRef(href, code)` rebuilds a ready-made WhatsApp link (rows cached for every viewer). Every staff builder takes the code (`adminWaLink`, `followUpWaLink`, `waLink`, `forwardWaLink`, `waMeHref`, `whatsappHref`, `whatsappShareLink`). The sender's code is `senderRefCode(staffId)` (lib/staffSignups, React-cached): their `staff_join_links.code` while they are an active participant, else null (the site Owner and the Project Managers have none, so nothing is added). Server senders: the member-page WhatsApp route, Applications follow-ups + By tutor + check-ins, documents approved, Featured WhatsApp, Team inbox and Message parent, My sign-ups and Team activity lists, Follow-ups → Tutors (rows mapped on the page). Client screens read `useStaffRefCode()` (components/admin/ReadOnly, provided by the admin layout): Forward to parents, the hiring post, document review cards, the shared follow-up buttons, Copy profile link / Share on WhatsApp, blog "Copy URL", Social posts captions. The Social posts QR (`/api/admin/social/image`) encodes the profile address with the ref; the address printed on the image stays clean. In-app and email bodies are not changed.
- **My link card** (`components/admin/MyLinkCard.tsx` → `MyLinkCardView.tsx`): on `/admin` for staff with a code, and on `/admin/jobs` for Tuitions staff (their home): the link, Copy, a QR, and their own counts for the last 7 and 30 days (Pakistan time) — tutor and parent sign-ups (by sign-up day) and tutors who paid (by approval day). `myLinkCounts` (pure).
- **Team activity → Paid sign-ups → "Sign-ups by source"** (`app/admin/team-activity/SourceTable.tsx`, `loadSourceTable`, `sourceRow`): per staff member, all-time credits by source (Link · Code · Claim · All sources) and tutors paid in the last 7 / 30 days and all time; Owner, Project Managers and Admin see everyone and the total, others their own row. Both this table and the card leave out accounts marked staff, test, seed, team or hidden (`countableCreditedAccounts`); existing credits and the other boards are unchanged.

## Staff clean-up, Supervisor, hidden-parent tuitions, direct credit, sign-up form (owner, 24 Oct 2026)

Migration 198 (additive, dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **a tuition whose poster is hidden, test, suspended or banned is hidden with them** (status `'hidden'`); **a sign-up with no valid staff link is credited to Admin** (source `direct`) and **new claims are closed** (existing claims stay in Claims to review); **/register starts on Tutor, or Parent from `?role=parent`** (supersedes PR106-G "nothing preselected"); **Supervisor** is a staff role. `npm run test:staffcleanup`; read-only `scripts/report-staff-cleanup.ts`.

- **Why the Hyderabad parent page 404'd.** The parent (Saliha) was not hidden or test: the Owner SUSPENDED the account on 23 Oct, `/parent/[id]` returns nothing for a suspended account, and her five open tuitions kept linking to it. The owner chose (24 Oct) to treat suspended and banned parents like hidden/test ones.
- **Hidden tuitions** (`lib/hiddenTuitionCore.ts` pure, `lib/hiddenTuition.ts`, `lib/hiddenTuitionRedirect.ts`). SQL `parent_hide_reason()` + the `profiles_sync_tuitions` trigger set every tuition of such a poster to `'hidden'` (status kept in `hidden_prev_status`); a BEFORE INSERT trigger hides one posted by an already-hidden account; un-hiding restores each tuition's own status. Every public reader already lists open tuitions only, and the sitemap functions read status, so a hidden tuition is out of Browse, search, the homepage, landing and city pages and the sitemap at once. Its address is a **301** in `proxy.ts` (`hidden_tuition_redirects()`, one-minute cache) to `/tuition-jobs/<city>` when that city has an open tuition, else `/browse/tuitions`; the page itself 308s as a backstop and its metadata is noindex. Applications stay, marked "Tuition no longer available" (`BoardItem.unavailable`): Sent, never overdue, out of To do, every badge, the forward board and the Paid tutors red rules; staff stage changes and follow-ups on them are refused; the tutor dashboard says "This tuition is no longer available". Nothing deleted.
- **Parent card links.** `parentCardResolves()` is the ONE rule for whether `/parent/[id]` renders (role parent/academy, not suspended, banned or hidden); `lib/publicParent` and every link to it (job cards, the tuition page's "Posted by") read it, so no live page links to a 404.
- **Former staff** (`lib/formerStaffCore.ts` pure, `lib/formerStaff.ts`; `scripts/dataop-staff-cleanup.ts`). Keep list (exact full names, among accounts with staff access or ties): Khizra Danish, Aqsa Mughal, Mahnoor Amin, Zubia Bashir, Nabeel, Inzamam Ullah, plus the Owner and Rai Mohsin Raza, never touched (`UNTOUCHABLE_ROLES`). Aseer Ul Hassan was on the pasted list but the owner chose (24 Oct) to treat him as former staff. A keep name matching no account or more than one changes nothing. Everyone else becomes former staff: role 'parent', admin_role null, `former_staff_*` set, every session revoked, staff link deactivated (`deactivated_at`; it still opens the site and credits Admin), off the target list, out of City owners, and each tuition they own moves to its city's owner, else the site Owner (`job.owner_assign`, reason "former staff"). Past credits, tuitions and history stay, labelled "(former staff)" (Team activity, Sign-ups by source, Applications owner, the admin "Posted by" filter). **Restore staff access** (`/api/admin/members/restore-staff`, member page): Owner only (refuseUnlessOwnerApproval + fresh password); brings back the role held and the link; cities and tuitions are not handed back. Audited `staff.former` / `staff.restore`.
- **Supervisor** (`admin_role 'supervisor'`, given to Aqsa Mughal). Opens every screen Operations opens (`withSupervisor` in `SCREEN_ACCESS`) plus the tuition actions; Staff filters open on All (`seesAllStaffLists`, Applications `defaultFilter`, Paid tutors); changes only their own tuitions and the tutors in their own cities — `lib/supervisorScope.ts` on every tuition, application, forward and follow-up write route (`SUPERVISOR_OWN_ONLY`, 403). Has a staff link (`PARTICIPANT_ROLES`). Owner-only actions stay Owner-only. Aqsa keeps Lahore in City owners.
- **Team overview** (`components/admin/TeamOverviewCard.tsx` → `TeamOverviewView`, `lib/teamOverview.ts`, `lib/teamOverviewCore.ts`; `SCREEN_ACCESS.teamOverview` = Owner, Project Managers, Supervisors) on /admin: per staff member, overdue Applications (`overdueApplicationsByOwner`, the badge's rule), red Paid tutors (by city owner), follow-ups sent today and in the last 7 days (member + application follow-ups, not undone, Pakistan time).
- **Direct credit.** `creditNewAccount` writes a `direct` row (no staff id) when there is no valid, unexpired staff link, the link is deactivated or the staff member is inactive, or the link credit is refused — never for a staff, test, seed or team account. Older uncredited sign-ups are counted as Admin by `loadAdminDirectAccounts()` without rewriting them. `loadCreditedAccounts()` (every staff board) leaves direct rows out. Team activity → "Sign-ups by source" has a Direct (Admin) column and an "Admin (direct)" row. `CLAIMS_OPEN = false`: the claim form is hidden and `submitClaim` answers 410.
- **Sign-up form.** `defaultRegisterRole` decides Tutor or Parent on the server and the form starts on it. Parent links open `/register?role=parent` (`lib/signupLinks.ts`): every public "Post a tuition" goes to `/register?next=/parent/dashboard/post-job&role=parent` (a session is sent straight on), the Parents footer column, the FAQ parent links, and the header's "Join free" on pages aimed at parents (`pageAimsAtParents`: /browse/tutors, /tutors/*, a tutor profile, a parent card). Create account is `bg-gray-200 text-slate-700` with a one-line hint naming what is missing until ready, then brand red (`lib/registerFormCore.ts`).

## CV redesign — Modern layout, one page, six fixes (owner, 24 Oct 2026)

Migration 199 (additive, dry-run then applied before the code): `tutor_profiles.cv_accent` (navy | green | charcoal, NULL = navy). Later-dated than "Tutor CV builder — as built (5 Sep 2026)" and "Social templates v2" carry-overs, so under precedence rule 10 it wins where it touches them: **Modern is the default CV template** (Classic and Minimal stay); **the fee is OFF unless the tutor ticks "Include my fee"**; **the footer says "Verified tutor on TutorMint" only for a tutor who passes the site's Verified badge rule (lib/badgeFacts `loadVerifiedBadgeOk`), else "Tutor on TutorMint"**, and the ✓ on the photo ring follows the same fact; **a hidden photo shows the grey gender silhouette** (supersedes "hidden → initials"); **the PDF fonts are Plus Jakarta Sans with Noto Naskh Arabic as the per-character fallback** (supersedes Geist on the CV; Geist stays for the social render); **the file is `<Name>-TutorMint-CV.pdf`**. `npm run test:cv` (21), `npm run test:cvpdf` (18).

- **One model, three layouts.** `lib/cv/model.ts` `toCvModel(raw, { includeContact, includeFee, includePhoto, template })` (pure) feeds the preview (`components/cv/CvPreview.tsx`) and the PDF (`lib/cv/pdfDocument.tsx`). Modern's words come from `cvModernLayout()` (sidebar: Contact, Teaching mode, Areas, "Scan to view my profile"; main: About, Subjects, Experience, Education), Classic/Minimal's from `cvSections()`. The display rules are pure in `lib/cv/textRules.ts`.
- **react-pdf is passed in.** `buildCvDocument(R, args)` takes the react-pdf module so the `.mts` test and `scripts/cv-samples.mts` can render real PDFs (react-pdf cannot be loaded from CommonJS); `lib/cv/pdf.tsx` passes the real one. **Never set `wrap={false}` on a react-pdf Page** — it shrinks the page to its content; one page is kept by `CV_BUDGET` (About length, subject cells, subjects per cell, degrees, areas, name length per template), proved by rendering the heaviest fixture in every template and colour.
- **Rules:** subjects grid grouped by level and stream, neighbouring grades with the same subjects merged ("Grade 9–10 · Science"), then "+N more on my profile" (N = distinct subjects shown nowhere); ONE experience phrase from `experience_years` through `lib/experienceLabel` ("5–10 years of experience"), and a year figure in an About sentence about experience is shown as the same figure (`alignExperience`, display only); phones through `lib/phone` → "0321 1234567", WhatsApp only when the profile has one; every `tutor_areas` row through `distinctAreaLabels` (legacy `tutor_profiles.area` only when there are none); degrees typed in all capitals read in Title Case with abbreviations kept (`displayCase`, display only); any 5-7-1 digit run is removed from CV text and the CV never reads a CNIC column.
- **Accent** (`POST /api/tutor/cv/prefs`, signed-in tutor's own row, service role, only `cv_accent`, logged `cv_accent_changed`). Sidebar/header text is white on the accent; section titles take the accent on white, with a thin green rule; all pairs in `scripts/contrast-check.ts`.
- **Photo** in the PDF is fetched and re-encoded by sharp to a square JPEG (react-pdf draws JPEG/PNG only); the silhouette is drawn from `lib/social/avatars` SILHOUETTE_SVG.
- **Fonts:** `lib/cv/urduFont.ts` is generated by `scripts/build-cv-fonts.ts` from `assets/fonts/noto-naskh-arabic/` (OFL, @fontsource 5.3.0 arabic subset).

## Fixed Overview order; PayPro retired; copyable bank details; Faysal Bank email reader (owner, 26 Oct 2026)

Migration 200 (additive, dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **PayPro is retired — the only way to pay is a bank transfer with a receipt** (supersedes "JazzCash (PayPro)" on /pay/choose, 11 Oct, and every "online payments activate automatically" line); **the admin Overview's first six sections are in a fixed order**; **a bank credit may come from the bank's own alert email** (source Email). `npm run test:overvieworder`, `test:payproretire`, `test:bankcopy`, `test:bankreader`; read-only `scripts/report-bank-settings.ts` (set / empty only, never a value), `scripts/report-paypro-mentions.ts`.

- **Overview order** (`lib/overviewOrderCore.ts` `OVERVIEW_SECTION_ORDER`): Square cards → Today's to-do → Team overview → Sign-up to payment → Daily sign-up funnel → Where sign-ups came from; everything else (the staff "My link" card) below. `app/admin/page.tsx` draws its sections through `orderOverviewSections()`; a role sees the sections it may see, in that order.
- **PayPro retired** (`PAYPRO_RETIRED` in `lib/payments/gatewaySettingsCore.ts`): `onlineCheckoutOn()` is false and `bankTransferOn()` true whatever the stored switches say, so membership plans, the upgrade sheet, onboarding and the verify gate all offer bank transfer only. /pay/choose shows the bank panel directly with "Pay from JazzCash, Easypaisa or any bank app using Raast or bank transfer." (`PAY_BY_TRANSFER_LINE`). `/api/payments/checkout` refuses a non-transfer checkout with `PAYPRO_CLOSED_MESSAGE` (409 `use_transfer`) before any PayPro order is made; the Owner's PayPro test order is refused too. The dashboard "Complete your payment" prompt for an unfinished PayPro checkout now opens `/pay/choose?plan=<code>`. Past PayPro payments, refunds, fees, the settlement check and PayPro env vars are unchanged.
- **Cut-off** (`lib/payments/payproRetireCore.ts`, setting `pay.paypro.cutoff` = 2026-11-25): `confirmPayproOrder` (the one path for /paypro/uis, the return page, the 5-minute cron and "Check payment status") activates a paid order through that day, Pakistan time; after it the order is recorded as a `paypro_late` finance alert and nobody is activated — /paypro/uis still answers PayPro "00" so it stops retrying, and wrong credentials still get the same "01" reply.
- **Copyable bank details** (`lib/payments/bankCopyCore.ts`): rows Account title, Bank (default "Faysal Bank"), Account number, IBAN, Raast ID (only when `pay.raast_id` is set), Amount — each with its own Copy, numbers shown in groups of 4 and copied without spaces, "Copied ✓" for 2 s, plus "Copy all details" (one WhatsApp-ready message). Values come from `app_settings` (`pay.bank_name`, `pay.account_title`, `pay.account_number`, `pay.iban`, `pay.raast_id`), edited only by the Owner at Payment gateways → Bank transfer details (fresh password, audited with account numbers masked to the last 4, Owner alert).
- **Faysal Bank email reader** (`lib/bankEmailCore.ts` pure rules, `lib/bankEmailRun.ts` one run with the mailbox and store passed in, `lib/bankEmailReader.ts` imapflow + mailparser + Supabase). IMAP from `BANK_IMAP_HOST/PORT/USER/PASSWORD` — never printed or logged; errors stored as a plain category. **Off by default**; Owner switch at Finance → Settings (`/admin/finance/settings`, `POST /api/admin/finance/bank-reader`, fresh password, audited `finance.bank_reader`); status Off / Running / Locked / Error with last run and last success. Runs in the 5-minute cron (`/api/cron/paypro-reconcile`). Each run: (1) From headers of the last 30 days — any sender other than efbl@faysalbank.com or the provider's own system mail (google.com, hostinger.com, the IMAP host's domain) → Locked, "This mailbox isn't bank-only", nothing else read; (2) only the bank's emails without the `TutorMintRead` keyword (and not already recorded by Message-ID) are looked at; (3) Authentication-Results must show dkim=pass for faysalbank.com before the body is opened, else "Couldn't verify sender"; (4) both formats parsed (RAAST Fund Transfer, FBL Transaction Alert), credits only ("Your account has been credited"), non-credits counted, an unreadable credit → "Couldn't read this email" with subject and date only; (5) stored: amount, date, time, sender name and bank, sender account last 4 only, reference, channel, Message-ID, source 'email' — never the body or the receiver's account; (6) dedupe by reference, then against a hand-entered credit (same amount, within 15 minutes, same or blank name → linked), unclear → Needs attention; (7) sender name containing PAYPRO → a PayPro payout (`gateway 'paypro'`), matched only against PayPro orders. Processed emails are marked read with the keyword; nothing is moved or deleted. The reader never activates, approves or grants anything; the existing automatic matching shows matches on Finance and unmatched credits stay in Needs attention for the Owner to Link. Failing (error or locked) for over an hour while on → a red alert on Finance and at the top of Today's to-do, plus a `reader_failing` finance alert.
- **Finance** shows "Source: Email / Manual" on every credit and lists open `finance_alerts` first under Needs attention, each with "Mark as dealt with" (Owner, `POST /api/admin/finance/alerts`, audited).
- **Staff payment alert email** now says "via bank transfer" or "via PayPro" from the payment's provider (it said PayPro for every payment).

## Hotfix — the "Your verification" sheet flickered on desktop; /pay/choose bounce guard (owner, 26 Oct 2026)

No migration, no data change. `npm run test:payloop`; read-only `scripts/report-samia-pay-loop.ts`, `scripts/report-pay-loop-affected.ts`; throwaway test account tool `scripts/dataop-payloop-test-account.ts` (a "Test Pay Loop" account, hidden, only its own rows).

- **Cause.** Not a redirect loop and not payment-state specific. The tutor header card is a `rounded-2xl border` box, so the site-wide hover lift (8 Oct) gives it a CSS transform on hover; the sheet (`VerifyBenefitsDialog`, `fixed inset-0`) was rendered inside it, and a transformed ancestor is the containing block of a fixed child. On a mouse device the sheet jumped between the full window and the card's 478×166 box each time the hover state flipped — measured in headless Chrome on the live site, 34 full-window vs 26 card-sized samples in 3 s. Production logs of the reported session showed no redirect chain. It has existed since 8 Oct on desktop; 20fa27e only sent more tutors to the sheet.
- **Fix.** `VerifyBenefitsDialog` renders through `createPortal` into `<body>`. The hover-lift rule (`app/globals.css`) also skips any card that contains an open `[role='dialog']` / `[aria-modal='true']` (`:where(:has(...))`, zero specificity), so no other pop-up inside a card can be captured. Any new pop-up opened from inside a card should still be portalled.
- **Bounce guard** (`lib/payChooseRouteCore.ts`, pure). Every automatic redirect /pay/choose makes is in `payChooseRoute()`, which the page obeys. Its own redirect back into itself (no plan named → the fee) carries `?hop=1`; a request with `hop=1` that would be redirected again is stopped: "Something went wrong, please continue here." with the fee's bank page (a tutor who still owes it) or a link to the dashboard (nothing left to pay — never a second payment), logged as `[pay-redirect-guard] stopped user=<id> plan=<code> reason=<reason>` (ids only).

## Payment page clean-up, Verified status image, live images, Merge duplicates, Follow-ups → Parents, View as (owner, 26 Oct 2026)

Migration 201 (additive; generated by `scripts/build-migration-201.ts`, applied by `scripts/apply-migration-201.ts`, dry-run first). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **the payment page has no transaction-ID box, no Copy-all and no English steps** (supersedes the 26 Oct copyable-details layout; the server still accepts a transaction ID and keeps old values); **Copy is on the account number and IBAN only**; **social images, the status image and og:image carry a version key and are cached only while it is live** (supersedes "Cached for a day at the edge" with a facts hash that did not include the drawing); **Follow-ups → Parents is a To do / Followed up board with one message per situation** (supersedes the Abandoned-signups list on that tab); **the member page header shows the phone and email masked with a logged Show**. `npm run test:paypagecleanup`, `test:statusimage`, `test:membermerge`, `test:parentfollowups`, `test:viewas`; read-only `scripts/report-oct26.ts`.

- **/pay/choose.** Removed: the breadcrumb's "Back to …" link (`showBack={false}`), the Urdu fee heading, "One-time. Non-refundable.", the any-bank line, Copy on Account title / Bank / Amount, "Copy all details", the three English steps, the file-size line, the transaction-ID box. The fee card reads "One-Time Verification Fee" (the amount is on the Amount row); "Back واپس" is "Back" (`OrderPageNav`); the help link is a "WhatsApp us" button with the logo on the left. `bankCopyRows()` rows carry `copyable` (`COPYABLE_KEYS` = account number, IBAN). A wrong file still shows `receiptFileProblem`'s message. The Terms still say the fee "is paid once, never renews … It is non-refundable" (not changed).
- **/membership-plans** — the Activation Urdu line is `ACTIVATION_URDU` in `components/PackagesTable.tsx`, the owner's exact text.
- **Status image** (`lib/social/statusImageCore.ts` pure, `lib/social/statusImage.ts`): the "I'm a Verified Tutor" design at Story size (`STATUS_DRAW`), only for a tutor who passes the Social posts verified rule (fee paid; CNIC, photo, selfie approved) — the routes answer 403 otherwise; a hidden photo is the grey silhouette. Staff: "Send status image" (`components/admin/SendStatusImageButton.tsx`, on the member page and each Paid tutors row; `SCREEN_ACCESS.statusImage`) downloads the PNG (`/api/admin/social/status-image`), opens WhatsApp with template `status_image_verified` (`POST /api/admin/follow-ups/status-image`; only `{tutor_first_name}` is known, so every link placeholder is blocked, a typed address is refused on save and removed on send), shows "Attach the downloaded image in WhatsApp", and records a follow-up (source `status_image`) with the 10-second Undo. Tutor dashboard: "Share on WhatsApp Status" (`components/tutor/ShareStatusButton.tsx` — the phone's share sheet with the image attached when the browser can share files, else a download and one line) and a one-time card the tutor dismisses for good (`tutor_profiles.status_card_dismissed_at`, `POST /api/tutor/status-card`). Team inbox → Templates → "Status image".
- **Images follow the live profile** (`lib/social/imageVersionCore.ts` pure, `lib/social/imageVersion.ts` the ONE reader of the profile half). `imageVersionKey(profile, drawing)` hashes name, photo address, hidden photo, subject master ids, city, headline, verification + template, format, colour variant, crop. The key is in every image URL (og `v=`, social `k=`, status `k=`); each route computes it again from the live rows and caches only when the URL's key matches (`imageCacheControl`) — an old key is drawn live and never cached. Old images expire on their own. Subject chips merge neighbouring grades with the CV's grouping (`lib/social/subjectChips.ts` → `subjectGrid`, per subject): "Grade 9–10 · English"; `lib/social/data.ts` merges before the limit, so social posts, status images and og:image all show merged chips.
- **Merge duplicates** (owner only, reversible; rules `lib/memberMergeCore.ts`, I/O `lib/memberMerge.ts`, routes `/api/admin/members/merge` (GET preview, POST merge / undo — `refuseUnlessOwnerApproval` + `requireFreshAuth`) and `/api/admin/members/duplicates`). "Merge" and "Not a duplicate" on every "Possible duplicate" line (People cards, `components/admin/DuplicateActions.tsx`) and on People → Possible duplicates (`/admin/users/duplicates`). "Not a duplicate" is a `member_duplicate_dismissals` row (one per pair, `a_id < b_id`), logged `member.not_duplicate` on both accounts. The merge screen (`/admin/users/merge?a&b`) shows both accounts (phone masked), the suggested keep (more complete, then paid, then older), and exactly what moves. Same type only; blocked when both paid or both have an approved document. Single fields: kept wins, empty takes the other's. Subjects + areas combined within the 15-subject cap (the rest listed). Documents move only when the kept account has none or none approved (the other's CNIC number is cleared first — it is unique). Applications (one to a tuition both applied to stays, listed), their follow-ups and history, follow-ups, notes (`member_notes_guard` allows a move between a recorded merge pair, service role only), the timeline, a parent's tuitions and staff credit (earliest wins) move. Payments move only when only the other account paid (shown as "PAYMENT MOVES"). The kept phone stays the login; the other is `profiles.secondary_phone`. The other account gets `merged_into` / `merged_at` / `hidden_from_public` (so it leaves lists, search, the directory views and the sitemap; People labels it "Merged account"), its sessions are revoked, signing in says `MERGED_LOGIN_MESSAGE` (login and SMS reset), and its profile 301s to the kept one (`proxy.ts` → `lib/mergedTutorRedirect.ts` → `merged_tutor_redirects()`). Every write is an Op with its old values, stored on `member_merges.log`; a failure part-way puts back what was applied; "Undo merge" (member page) writes every op back newest first. `member.merge` / `member.merge_undo` in Audit and on both Activity tabs.
- **Follow-ups → Parents** (`lib/parentFollowUpCore.ts` pure, `lib/parentFollowUps.ts`, `POST /api/admin/follow-ups/parent`, `app/admin/follow-ups/ParentFollowUpsBoard.tsx`). Every real parent (People rule; not suspended or banned) with a situation, first match: tutors applied and not forwarded (Waiting on us — a link to Applications, never a message, never in the badge), tutor hired (thanks + a short review by reply, once per hire within 30 days), a tuition ended with no hire and none open ("Still looking? We can repost it"), a tuition open 2+ days with no applicant, email not confirmed, signed up 1+ day ago with no tuition. To do / Followed up = `tabState` (3 days, 3 messages, progress resets the count but not the wait). An Applications message to the parent in the last 3 days is a contact (not due here, never one of the 3). WhatsApp when they gave a number, else an official in-app message + email. Templates `pf_no_tuition`, `pf_no_applicants`, `pf_email_unconfirmed`, `pf_expired`, `pf_hired` (Team inbox → Templates → Parents; each ends with `{support_whatsapp}`, no prices). The Posted / Not posted and verification chips and the Not interested group stay. The Follow-ups badge adds the parents' overdue To do (`lib/parentFollowUpsBadge.ts`, held 5 minutes).
- **Small fixes.** People cards: the Verified badge sits on the name line (`BadgeRow nowrap`), every name line the same height. Member page header: masked phone ("0348 •••• 733") and, only for a real email, a masked email, each with Show (`components/admin/MaskedContact.tsx` → `POST /api/admin/members/reveal-contact`, `SCREEN_ACCESS.memberContactReveal`; Audit `member.contact_reveal` with the field, never the value, written before the value is returned); Call and WhatsApp still work. Overview → Where sign-ups came from gained an "AI assistants" table (`aiAssistantTotals`): sign-ups and paid tutors for 7 days, 30 days and all time, per site; the member page keeps "AI assistant · <site>".
- **View as** (owner only, read only; `lib/viewAsCore.ts` pure, `lib/viewAs.ts`, `POST /api/admin/view-as/start` with the password asked again, `/api/admin/view-as/exit`). The member's dashboard exactly as they see it: a session for the member is minted with an admin magic-link token (no password or code is ever shown) and swapped into the browser; the Owner's own refresh token waits in an httpOnly cookie sent only to the exit route; a signed 30-minute ticket (`tm_view_as`, HMAC with the service-role key) drives the fixed banner "Viewing as <name> — read only · Exit" (`components/ViewAsBanner.tsx`). Every change is refused: `proxy.ts` answers 403 to any non-GET request and any /api/auth or /api/admin request but the exit route; the database refuses every insert/update/delete made with the minted session (RESTRICTIVE policies on every public table with RLS and on storage.objects, `is_view_as_session()` on the JWT's `session_id`, `view_as_sessions`); the browser client refuses `auth.updateUser`. It ends on Exit or after 30 minutes (the proxy sends the next page to the exit route, and the 5-minute cron ends any view whose browser never came back — `end_view_as_session()` deletes the minted auth session). Start and end are in Audit (`member.view_as_start` / `member.view_as_end`) and on the member's Activity tab. Known limit: viewing signs the member's account in once, so its "last sign-in" time in Supabase Auth moves.

## Hotfix — Supabase 502s and 300-second hangs; receipt uploads (owner, 26 Oct 2026)

Migration 202 (one index, dry-run then applied before the code). `npm run test:hotfix`, `npm run test:hotfix:live` (rolled back / dry run — writes nothing); read-only `scripts/report-db-health.ts`, `report-db-restarts.ts`, `report-db-spill.ts`, `report-db-indexes.ts`, `report-nosheen-bank-link.ts`, `measure-live-timings.mjs`.

- **What happened.** Error 834679845 was `GET /admin` at 14:05 UTC: Supabase answered a Cloudflare "502 Bad Gateway" page. Between 11:13 and 11:35 UTC eleven requests hung for Vercel's full 300 s; between 13:52 and 14:05 two pages got the 502; at 14:14 Supabase's pooler (Supavisor), PostgREST and Auth all reconnected. Postgres itself never restarted (up since 5 Sep), was 80 MB with a 100% cache hit rate, no lock waits and no stuck sessions. Migration 201's View-as policies are NOT the cause: they run on writes only, cost ~0.2 ms per write, and reads never call them. The sign-in merge check is one extra column on a select that already ran.
- **Supabase fetch** (`lib/supabase/fetch.ts`): every server Supabase client (cookie, service role, public, and the proxy's) uses it — 25 s time limit (120 s for storage), and a READ (GET/HEAD) that gets a 502/503/504 or a network error is tried once more after 400 ms. Writes are never repeated. `pageAll` throws one plain line (`plainSupabaseError`), not the HTML page.
- **Proxy lookups** (`lib/proxyLookup.ts`): the merged / converted tutor, hidden tuition and area-hub redirect lookups have a 2.5 s limit and, after a failure, are not tried again for 30 s (the last good list, or no redirect, is used meanwhile).
- **Receipts on /pay/choose:** a photo is resized and re-encoded in the browser before it is checked and sent (`lib/payments/receiptPrepare.ts`, longest side 2000 px, aiming under 2.5 MB); the limit is 4 MB (was 5 MB, above Vercel's ~4.5 MB body cap, so a 4.5–5 MB photo failed with no reason given); a 413 shows the size message. The route stores through the service role, so RLS and the View-as storage policies never applied to it.
- **Nosheen Waheed's bank payment was recorded** (14:04:11 UTC, Verification Fee, settlement link saved); the error page was the next page load hitting the 502. Recording it again is refused ("already paid").
- **Migration 202:** `job_subjects (master_id, job_id)` index for subject lookups (1.4 → 1.0 ms on the 20 busiest subjects).


## Erase on request, View as without sign-in, parent reviews, Manager role, name edit, masking, subject cap (owner, 27 Oct 2026)

Migrations 203, 204, 206 (each dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **personal data erased at the member's request is the one thing ever deleted** (rule 14); **View as never signs in as the member** (supersedes the 26 Oct minted session); **only approved reviews from hired parents count**; **"Supervisor" is shown as "Manager"**; **the Tuitions posted columns are Staff | Today | Yesterday | Last 7 days | All time | Repeated this week**.

### Close account and erase personal data
Migration 203. Rules `lib/accountEraseCore.ts`, I/O `lib/accountErase.ts`, requests in `account_erasures` (admin-read, service-role writes).
- **Who:** the Owner on the member page ("Close account and erase data": reason, how identity was confirmed, password re-check; "Erase in 7 days" default with countdown + Cancel, or "Erase now"; `/api/admin/members/erase` — 401 signed out, 403 + blocked-attempt alert for anyone else). Or the member: Settings → "Delete my account", confirmed by an SMS code (purpose `erase`, the reset rules: 10 minutes, 3 a day) to the verified mobile, 7-day grace, dashboard banner "Your account will be deleted on <date> — Cancel" (`/api/account/delete`). Due erasures run in the daily cron.
- **Erased:** name → "Deleted user"; phones, emails, CNIC number, address, area, photo, headline, bio, degrees/certificates, areas, field and slug history, documents and photo rotations; CNIC images, photo, selfie, intro video files (YouTube deleted when credentials exist, else recorded) and receipt files; message and Team message contents → "[deleted]"; phones/emails masked inside staff notes, call logs, application messages and tuition descriptions (`member_notes_guard` allows only this server path). The confirmation email (`account_erased`) goes before the address is cleared; "Copy confirmation" shows the text.
- **Kept, without personal details:** payments (amount, date, method, bank reference), applications, follow-ups, staff credits, Audit "Account erased on request · reason · by <owner> · <date>". Counts and revenue do not change. An erased account cannot be reinstated.
- **The auth user is scrubbed, NOT deleted** — deleting it cascades into payments, applications, tuitions and the profile. `erase_auth_user()` sets the email to `erased-<id>@users.tutormint.org` (refused as a recipient; never displayed — `shownEmail`), clears the phone, password and metadata, deletes identities, sessions, refresh tokens and MFA factors, and bans it. Phone and email are free again; nobody can sign in.
- **Public:** marked suspended (out of directory, search, sitemap, work lists; People still counts it); tuitions hidden with reason `parent_erased` and 301 like hidden-parent tuitions; old tutor addresses 301 to `/browse/tutors?city=<city>` in `proxy.ts` (`erased_tutor_redirects()` holds sha256 hashes of the old addresses only). `npm run test:accounterase`.

### View as without signing in
No migration. `proxy.ts` stamps `x-tm-view-as` (always overwritten or removed; never on the exit route) while a live ticket is in the browser; `lib/viewAsContext.ts` returns the member only when the ticket verifies, the `view_as_sessions` row is open and under 30 minutes, and the real session is the Owner who started it. Then `lib/supabase/server.ts` `createClient()` gives a service-role client whose `auth.getUser()` is the member, with account calls refused; the plain cookie client is `lib/supabase/serverReal.ts` `createRealClient`. Every write is refused by `lib/viewAsGuardCore.ts` through `lib/supabase/fetch.ts` and the browser client (non-GET → 403 without leaving the process; exceptions: the Owner's token refresh, storage read-link signing, the read-only RPC allowlist `VIEW_AS_READ_RPCS` — a new read-only RPC a member page calls must be added there). No session is minted and the member's last sign-in never moves. Known limit: reads run as service role, so a server query relying on RLS alone (no explicit user filter) shows the Owner more than the member sees. `npm run test:viewasreadonly`.

### Parent reviews
Migration 204. Only a parent whose application is at stage Hired on a tuition they posted may review that tutor, once per hire (`reviews.application_id` unique, `can_review_hire()` in the insert policy, no update policy); 1–5 + text, saved `status='pending'`. The Owner approves or rejects at Trust → Reviews (`/admin/reviews`; `SCREEN_ACCESS.reviews` admin + operations read; `/api/admin/reviews/decide` via `refuseUnlessOwnerApproval`; Audit `review.approve` / `review.reject`). Only approved reviews are public, listed by `tutor_public_page()` and counted by `recompute_tutor_rating`. Demos no longer earn a review. No review JSON-LD. `/review` shows a sign-in prompt when signed out. `pf_hired` carries `{review_link}` (`/review?application=<id>`). `npm run test:reviews`.

### Manager role (renamed from Supervisor)
Migration 206 (function body only). Internal value stays `admin_role 'supervisor'`; everywhere shown it reads **Manager** (`ROLE_LABEL`, `roleBadge` for every viewer — it showed "Admin" before, which is why Aqsa Mughal's badge was wrong; her data did not change), the Team picker, the invite email, `SUPERVISOR_OWN_ONLY`. Past Audit rows unchanged; "Project Manager" for Owner/Partner unchanged. Managers see everyone's data in full (`seesEveryone`, `targetScope`, `staffActivity`, `staffSignupsAll`, SQL `sees_all_staff_signups()`), and still change only their own items. Claims stay Owner/Admin. `npm run test:managerview`.

### Tuitions posted, credit picker, fee card
- Team activity → Tuitions posted: `POSTED_COLUMNS` (`lib/tuitionPostingCore.ts`), sorted by Last 7 days desc; former staff one collapsed "Former staff" row, counted in the Team total. `npm run test:tuitionsposted`.
- Member page "Record a bank payment" picker (`pickerOffers` / `pickerCredits` in `lib/bankPaymentLinkCore.ts`, applied on the server by `linkableCredits()`): only unlinked credits (unmatched or held), never matched/ignored, never a PayPro payout, never above Rs 5,000 (`PICKER_MAX_PKR`); matching amount first, then newest; "+ Add a credit" opens the Finance add form inline and returns with the new credit selected. Supersedes, for this picker only, the 21 Oct offering of auto-matched credits (Finance's own "Link to member" still offers them). `npm run test:creditpicker`.
- /pay/choose fee card heading is exactly تصدیق کروانا کیوں ضروری ہے؟ (`FEE_CARD_TITLE`, `text-tm-green-deep`, text-xl heavy — green on the light navy card is 4.21:1, large text only), Urdu first then English. `npm run test:feecard`.

### Name edit, masking, subject cap, address chip, uploads
No migration.
- **Name edit** (`/api/admin/members/name`, `lib/nameEditCore.ts`, `components/admin/NameEditForm.tsx`): tutor edit panel Name section and parent "Edit name" card; reason required; `formatName`; Change history (field `name`), Audit `member.name_edit`, timeline. A tutor with an approved CNIC (`cnic_verified_at`) is renamed by the Owner only ("Check the spelling against the approved CNIC"; others 403 + alert). After a tutor rename the profile-address box is offered (old address redirects).
- **Who acted** is "Tutor — Name" / "Staff — Name" (`lib/actorLabelCore.ts`); a synthetic `@users.tutormint.org` address is never displayed in admin (`shownEmail()`; `npm run test:nosyntheticemail` scans for raw renders). The tutor edit page's WhatsApp is masked with a logged Show (reveal-contact field `whatsapp`).
- **15-subject cap** now also refuses bulk-import rows over 15. Tutors over the cap see `SubjectCapBanner` (dashboard + Settings) and may only remove. Not capped: a member token writing `tutor_subjects` directly (a trigger would break over-cap tutors re-saving Settings). On 27 Oct 2026: 20 tutors over the cap. `npm run test:subjectcapall`.
- **Address chip**: a typed, undecided address is "Waiting for review" (`parentAddressState`, `addressChipLabel`) and appears in the documents-waiting lists.
- **Uploads**: message photos, ad images and refund screenshots share `lib/uploadLimitCore.ts` — shrunk in the browser, 4 MB on client and server (413 with a clear message), failures always say why; a refund screenshot that fails to save stops the refund being recorded. `npm run test:uploadlimits`, `test:addresschip`, `test:nameedit`.

## Hotfix — "Change to Tutor" failed every time; a parent account can be merged into a tutor account (owner, 27 Oct 2026)

No migration. Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **a parent account may be merged INTO a tutor account of the same person** (supersedes "Same type only", 26 Oct). `npm run test:convertmerge`; read-only `scripts/report-mudasir-convert.ts` (replays the change in a rolled-back transaction), `scripts/report-mudasir-merge-preview.ts` (run with `--conditions=react-server`), `scripts/report-merge-schema.ts`.

- **Cause.** `convertAccount()` inserted a `tutor_profiles` row without `email`, which is NOT NULL there (`ensureProfile` writes it). Every Parent → Tutor change for an account with no earlier tutor profile was refused (23502) and the screen said only "That did not save". The insert now writes `profiles.email`.
- **Never silent.** A refused write returns the database's reason with every run of digits removed (`plainDbError` in `lib/convertAccountCore.ts`), logged as `[convert-account] <step> refused: …`; a one-account-per-mobile clash (23505) says so. Before any write, `findConvertClash()` looks for an account of the target type with the same mobile (last 10 digits), CNIC (13 digits) or a two-way link; the preview and the POST then show "This person already has a Tutor account with … : <name> (ID <id>, phone masked)" and **"Merge into that tutor account instead"** (`mergeInsteadHref`), and the change button stays off. A parent's card also has "Already has a tutor account? Its account ID" → the merge screen.
- **Parent → tutor merge** (`mergeKind` = 'parent_into_tutor' in `lib/memberMergeCore.ts`; the tutor is always kept — `suggestKeep`, and keeping the parent is refused). Same owner-only route, password re-check, preview, op log and exact Undo. Moves: the CNIC (number cleared on the parent first, `CNIC_COLUMNS`, CNIC photos; the tutor's own non-approved CNIC photos are paused) when the tutor has no approved CNIC and the parent's is approved or the tutor has none; the home address with its review columns (`ADDRESS_COLUMNS`) when the tutor's is not approved; tuitions (shown "posted as a parent" — derived from `postedAsParent`) and children; the timeline, follow-ups, notes; the staff credit (earliest wins; a moved credit's `member_role` becomes 'tutor', and a copied credit never changes the kept account's role). Blocked when both paid. Approved documents on both sides do not block a cross-type merge. The parent becomes "Merged into <name>", hidden, sessions revoked, and signing in says `MERGED_LOGIN_MESSAGE`. `member_merges.error` is scrubbed with `plainDbError`.
- **Known gap (reported):** a moved address waiting for review does not appear in a review list on a tutor account (the address review list reads parent accounts); `profile_completion` refreshes on the next profile save.

## Withdraw a contact; the Do not use list (owner, 27 Oct 2026)

Migration 207 (additive, dry-run then applied before the code). A person whose phone number was put on tuitions without their consent asks for it to be removed — personal data removed at a person's request (rule 14). Rules pure in `lib/contactWithdrawCore.ts`, I/O in `lib/contactWithdraw.ts`, gate `lib/contactWithdrawGate.ts`. `npm run test:contactwithdraw`; read-only `scripts/report-contact-consent.ts`, `scripts/report-phone-columns.ts`.

- **Trust → Withdraw a contact** (`/admin/withdraw-contact`, `SCREEN_ACCESS.contactWithdraw = []`): the site Owner ONLY — the page redirects anyone else (the Partner included) and every route answers 401 signed out, 403 + the blocked-attempt alert to anyone else. The number is typed in any common format and normalised with `normalisePkMobile`; it travels only in POST bodies and is only ever shown masked.
- **Search** (`POST /api/admin/contact-withdraw/search`): every tuition whose own contact data holds the number (`job_contacts` phone / WhatsApp / social / address, or written in the title / description — any status, staff- or parent-posted), with TM number, title, city, status, poster, tutors applied and tutors who opened the number; accounts holding it (mobile, WhatsApp, second number, tutor profile number); the imported leads (`legacy_parent_profiles`, `legacy_parents`, `legacy_tutors`). A parent account's own tuitions are listed too.
- **Withdraw this contact** (`POST …/withdraw`, reason required, password re-check): each tuition whose own contact data holds the number → status `'hidden'`, `hidden_reason 'contact_withdrawn'` (earlier status kept in `hidden_prev_status`, Featured off), shown to staff as **"Closed: contact withdrawn"**. Through the hidden-tuition machinery of migration 198 it 301s to `/tuition-jobs/<city>` (or Browse tuitions), is noindex with no JobPosting, is out of every list and the sitemap, and its applications read "Tuition no longer available" (out of To do, the Paid tutors red rules and every badge; the tutor sees "This tuition is no longer available", no reason). The number is removed from `job_contacts` and scrubbed from the tuition text ("[number removed]") — reveals are read live from those, so tutors who opened it no longer see it — and cleared from the imported leads. Migration 207 changed `sync_parent_tuitions` so an account-flag change never un-hides or re-labels a withdrawn tuition. **Accounts are never changed**: when a parent account owns the number the results offer that account's "Close account and erase data" (`/admin/users/<id>#erase`). The Indexing API is not used (a redirecting page is never sent; Google sees the 301 on its next visit).
- **Do not use list** (`GET/POST …/list`): hash + masked form only; removal is Owner only with a reason and the password re-check, stamped, never deleted. `doNotUseRefusal()` (fails open if the list cannot be read) refuses a listed number with "This number has asked not to be contacted. Please don't use it." in `createJob` (the parent's own number or one in the text), `createTeamJob` / `updateTeamJob` (contact number, WhatsApp, text, social), `updateJob`, `saveTuitionContactNumber`, bulk import (`doNotUseChecker`, mobile and WhatsApp), and the two admin mobile changes (`/api/admin/members` change-mobile, `/api/admin/tutors/edit` set-mobile).
- **Audit:** `contact.withdraw` (target the withdrawal row; reason, tuition ids, refs, counts), `job.close_contact_withdrawn` per tuition, `contact.do_not_use_remove` — never a number or its mask (`auditDetailSafe`).
- **Consent report** on the same page: team-account tuitions with a parent number that belongs to no account, counted per staff member (`consentCounts`). On 27 Oct 2026: 1,346 of 1,482.


## Parent consent for listings, team-posted tuition labels, report fixes, payment Submit, tutor address review (owner, 27 Oct 2026)

Migration 208 (additive, dry-run then applied before the code). Later-dated than everything above, so under precedence rule 10 it wins where it touches them: **every staff save of a tuition (create AND edit) needs the "Parent agreed to be listed on TutorMint" tick and a method**; **while the Owner's switch is on, a tuition whose consent is Not recorded never reveals its parent's number to a tutor** (supersedes "View number" for those tuitions, and any earlier reveal); **a staff-posted tuition names its poster "Posted by TutorMint team for a parent ✓"** (supersedes the "Verified tuition" pill on the card and page); **a report on a staff-posted tuition is "Problem with this job" and names nobody**; **/pay/choose's receipt button is "Submit" and the "WhatsApp us" button is gone**. Rules pure in `lib/tuitionConsentCore.ts`, `lib/teamPosterCore.ts`, `lib/reportCardCore.ts`; I/O in `lib/tuitionConsent.ts`. `npm run test:consent`; read-only `scripts/report-consent-baseline.ts`.

- **Consent record** (`tuition_consents`, see Canonical tables). Backfill on 27 Oct 2026: 1,524 tuitions — 1,483 staff-posted Not recorded, 41 parent-posted Recorded (parent posted it themselves). `consentFor(jobIds)` reads it (a missing row reads Not recorded — the safe side).
- **Staff Post a tuition / admin edit** (`components/forms/ConsentBox.tsx` in the shared form's staff block): tick + "How did they agree?" (Phone call / WhatsApp / In person) + optional note. `createTeamJob` and `updateTeamJob` refuse without them (`consentInputProblem`) before any write, then `recordConsent()` (Audit `job.consent_record`). The edit page pre-ticks a recorded consent. **There is no tuition bulk import** (the only import is tutors); `importRowConsent()` is the rule a future one must use (no consent column / empty → Not recorded).
- **"Consent not recorded" chip** (`components/admin/ConsentChip.tsx`) on admin tuition cards and Applications group headers: **Ask parent** → `GET /api/admin/jobs/consent/ask` (the editable `consent_ask` template, Team inbox → Templates → Consent; number added on the server; Audit `job.consent_ask`), **Parent agreed** → `POST /api/admin/jobs/consent` (`SCREEN_ACCESS.tuitionConsent`; a Manager only on own tuitions), and "Parent said no? Withdraw the contact" (link for the Owner; others are told to ask the Owner).
- **Owner switch** Admin → Settings → Privacy (`/admin/settings/privacy`, `SCREEN_ACCESS.consentPrivacy = []`, `POST /api/admin/settings/hide-numbers`, Owner + fresh password, Audit `settings.hide_unconsented_numbers`), ON by default; an unreadable value reads ON. When on, for Not recorded tuitions: `revealJobContact` refuses before any check or spend (no reveal counted), `peekTuitionContact` returns nothing (earlier reveals hidden), `jobContactRevealStatus` answers reason 'consent', `lib/jobFeed` drops the teaser and sets `contactHidden`, and the card / page show "Apply — our team will share your profile with the parent" in place of the number and the reveal buttons. Applying is unchanged (it still uses one unit of the shared monthly pool as an application). Public pages show only the masked teaser, never a number, either way.
- **Team activity → Tuitions posted** gained "Consent recorded" (% of that staff member's posts with consent recorded — last 7 days and all time; `countConsent`), summed in the Team total.
- **Poster label.** The team account's stored name is "TutorMint Admin"; it is never shown: the card and page pill read `TEAM_POSTER_LABEL`, messages and report cards use `TEAM_MEMBER_NAME` ("TutorMint team"), the thread header adds the label. JSON-LD unchanged.
- **Reports.** `ReportButton teamJob` offers `JOB_PROBLEM_REASONS` (no response, already filled, wrong details, other); `/api/reports` decides "staff-posted" from the row (`isTeamJob`) and stores `reported_id = null` (`jobReportDecision`). Migration 208 pointed the one existing job report that named the team account at the tuition only. Report cards (`components/admin/ReportTargetBlock.tsx`) link the exact tuition (TM number + title, admin + public page) or profile, and show the reporter's status (tutor: fee paid / Verified badge; parent: verified / mobile) and their applications on that tuition with forward status.
- **/pay/choose**: `SUBMIT_LABEL` "Submit", `bg-gray-200 text-slate-700` and disabled until a receipt is attached, then `bg-tm-green-deep text-white` (pairs in check:contrast). The "WhatsApp us" button is removed from every state; nothing else on the page changed.
- **Tutor home addresses** (`tutorAddressesAwaitingReview`, `loadParentDocs(id, { allowTutor })`, `ParentDocumentReview addressOnly`): a tutor's typed, undecided address is in the Documents to approve list (Overview, People badge) and on the member page with the same Approve / Reject and chip; deciding it never makes a tutor a "verified parent". The waiting rule now also counts a typed address with no status yet, for parents too.
