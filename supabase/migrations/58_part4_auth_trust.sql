-- 58_part4_auth_trust.sql
-- Part 4 — auth & trust (owner, Sunday 6 Sep 2026). All additive.
--
-- 1. phone_verified_via — how a number was proved. 'otp' (real code) or
--    'bridge' (the BRIDGE_OTP trust-bridge, until the third-party OTP API is
--    enabled). Surfaced in admin + the CSV export so bridge-verified accounts
--    are visible, and read at login so they can be made to re-verify once when
--    the bridge is removed. Null on accounts that predate this / email-path.
-- 2. Ban — a permanent status DISTINCT from suspend. Mirrors the is_suspended
--    quartet exactly rather than touching the unused `account_status` type.
-- 3. under_review — a boolean on jobs and tutor_profiles (NOT a new enum value,
--    which would need ALTER TYPE): a reported item is paused/delisted while the
--    report is open. The two listing views exclude it (browse/search); the
--    profile page and job detail still render, with an amber sticker.
-- 4. signup_blocklist — a banned account's CNIC (hashed) and mobile, checked at
--    signup and at claim so the same person cannot simply re-register.
-- 5. admin_message_templates + admin_messages — the official TutorMint Team
--    channel. A DEDICATED store, deliberately NOT the member↔member `threads`
--    table: that keeps the "no chat-browsing screen" privacy line true by
--    construction — /admin/inbox can only ever read official messages.

-- ---------------------------------------------------------------- profiles ---
alter table public.profiles
  add column if not exists phone_verified_via text,
  add column if not exists is_banned boolean not null default false,
  add column if not exists banned_at timestamptz,
  add column if not exists banned_reason text,
  add column if not exists banned_by uuid references auth.users(id) on delete set null;

create index if not exists profiles_banned_idx on public.profiles (is_banned) where is_banned;

-- ------------------------------------------------------------- under review ---
alter table public.jobs
  add column if not exists under_review boolean not null default false,
  add column if not exists review_reason text;

alter table public.tutor_profiles
  add column if not exists under_review boolean not null default false,
  add column if not exists review_reason text;

-- The listing views exclude banned tutors always, and under-review tutors from
-- browse/search (tutor_directory) — the profile page (tutor_visible_profiles)
-- still renders an under-review tutor so the amber sticker has somewhere to sit.
create or replace view public.tutor_directory as
  SELECT tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url,
    tp.subjects, tp.class_levels, tp.degrees, tp.teaching_mode, tp.online_platforms,
    tp.city, tp.area, tp.hourly_rate_pkr, tp.experience_years, tp.video_youtube_id,
    tp.video_status, tp.verification_status, tp.rating_avg, tp.rating_count,
    tp.is_featured, tp.created_at, tp.gender, p.profile_completion
   FROM tutor_profiles tp
     JOIN profiles p ON p.id = tp.id
  WHERE p.profile_completion >= 100
    AND (tp.verification_status <> ALL (ARRAY['suspended'::verification_status, 'rejected'::verification_status]))
    AND COALESCE(p.is_suspended, false) = false
    AND COALESCE(p.is_banned, false) = false
    AND COALESCE(tp.under_review, false) = false
    AND (tp.imported = false OR tp.claimed_at IS NOT NULL);

create or replace view public.tutor_visible_profiles as
  SELECT tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url,
    tp.subjects, tp.class_levels, tp.degrees, tp.teaching_mode, tp.online_platforms,
    tp.city, tp.area, tp.hourly_rate_pkr, tp.experience_years, tp.video_youtube_id,
    tp.video_status, tp.verification_status, tp.rating_avg, tp.rating_count,
    tp.is_featured, tp.created_at, tp.gender, p.profile_completion
   FROM tutor_profiles tp
     JOIN profiles p ON p.id = tp.id
  WHERE (tp.verification_status <> ALL (ARRAY['suspended'::verification_status, 'rejected'::verification_status]))
    AND COALESCE(p.is_suspended, false) = false
    AND COALESCE(p.is_banned, false) = false
    AND (p.profile_completion >= 100 AND (tp.imported = false OR (tp.claimed_at IS NULL) = false)
         OR tp.imported = true AND tp.claimed_at IS NULL);

-- --------------------------------------------------------- penalties widen ---
-- False reporters accumulate penalties, and ban/unban are penalty events.
do $$ begin
  alter table public.penalties_log drop constraint if exists penalties_log_kind_check;
  alter table public.penalties_log
    add constraint penalties_log_kind_check
    check (kind in ('warning', 'suspension', 'unsuspension', 'ban', 'unban', 'report_penalty'));
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------- signup blocklist ---
create table if not exists public.signup_blocklist (
  id             uuid primary key default gen_random_uuid(),
  cnic_hash      text,          -- sha256 hex of the CNIC's digits (never the CNIC itself)
  mobile         text,          -- normalised MSISDN 92XXXXXXXXXX
  reason         text,
  source_user_id uuid references auth.users(id) on delete set null,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists signup_blocklist_cnic_idx on public.signup_blocklist (cnic_hash);
create index if not exists signup_blocklist_mobile_idx on public.signup_blocklist (mobile);
alter table public.signup_blocklist enable row level security;
-- Admin-read only; every write is a service-role path (ban action / claim).
create policy signup_blocklist_admin_read on public.signup_blocklist
  for select using (public.is_admin());

-- ------------------------------------------------------ message templates ---
create table if not exists public.admin_message_templates (
  key        text primary key,
  title      text not null,
  subject    text not null,
  body       text not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.admin_message_templates enable row level security;
create policy admin_message_templates_admin_read on public.admin_message_templates
  for select using (public.is_admin());

insert into public.admin_message_templates (key, title, subject, body) values
  ('cnic_unclear', 'CNIC photo unclear', 'We need a clearer photo of your CNIC',
   'Hi {name}, thanks for submitting your CNIC. The photo we received is not clear enough for us to verify — some details are hard to read. Please open Settings and upload a clearer, well-lit photo of both sides. Once you do, we will review it again promptly.'),
  ('address_untraceable', 'Address could not be verified', 'We could not verify your address',
   'Hi {name}, we were unable to verify the address on your account. Please check the address in your profile and make sure it is complete and correct, then resubmit. If you need help, reply to this message.'),
  ('job_under_review', 'Your tuition is under review', 'Your tuition post is under review',
   'Hi {name}, your tuition "{job_title}" is temporarily under review while our team checks a report. Applications are paused until the review is complete. We will let you know as soon as it is resolved — this usually does not take long.'),
  ('video_rerecord', 'Please re-record your video', 'Please re-record your introduction video',
   'Hi {name}, we reviewed your introduction video and need you to record it again. Reason: {reason}. Please open Settings and upload a new video. You have a limited number of attempts, so please read the reason carefully before re-recording.'),
  ('profile_completion_nudge', 'Finish your profile', 'You are almost there — finish your profile',
   'Hi {name}, your profile is not yet complete, so parents cannot find you in search. Completing it to 100% is what lists you and lets you get hired. Open your dashboard to see exactly what is left.'),
  ('payment_received', 'Payment received', 'We have received your payment',
   'Hi {name}, we have received your payment and it is with our team for confirmation. Plans are usually activated within a few hours. We will notify you the moment it is approved.'),
  ('payment_approved', 'Payment approved', 'Your payment is approved',
   'Hi {name}, your payment has been approved and your plan is now active. Thank you for choosing TutorMint.')
on conflict (key) do nothing;

-- ------------------------------------------------------------ admin messages ---
-- The official TutorMint Team ↔ member conversation. `direction` is from the
-- platform's point of view: 'out' = Team → member, 'in' = the member's reply.
create table if not exists public.admin_messages (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references auth.users(id) on delete cascade,
  direction    text not null check (direction in ('out', 'in')),
  admin_id     uuid references auth.users(id) on delete set null,  -- who sent an 'out' (never shown to the member)
  template_key text,
  body         text not null,
  read_at      timestamptz,     -- when the recipient side read it
  created_at   timestamptz not null default now()
);
create index if not exists admin_messages_member_idx on public.admin_messages (member_id, created_at);
create index if not exists admin_messages_unread_in_idx on public.admin_messages (created_at) where direction = 'in' and read_at is null;
alter table public.admin_messages enable row level security;
-- A member reads their own official conversation; an admin reads any. Every
-- write is a server path (the member's reply route, the admin send route), so
-- there is no member/anon write policy to scrutinise — the same shape as
-- notifications and message_reports.
create policy admin_messages_read on public.admin_messages
  for select using (member_id = auth.uid() or public.is_admin());
