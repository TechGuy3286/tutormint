-- 175_staff_signups.sql  (owner, 15 Oct 2026)
--
-- Sign-ups by staff: join links, credit, claims. Additive and idempotent;
-- nothing is deleted. The rules are pure in lib/staffSignupsCore.ts, the I/O in
-- lib/staffSignups.ts.
--
-- 1. staff_join_links — one personal link (/join/<slug>) and code per
--    participating staff member (Tuitions staff, Operations, Admin). The slug is
--    the first name; no personal data. Kept when a staff member leaves.
-- 2. staff_referral_visits — the SERVER RECORD of a first-touch credit: a join
--    link opened (or a staff code typed at sign-up). The browser holds only the
--    row id, in the httpOnly tm_staff_ref cookie, for 30 days.
-- 3. staff_signup_credits — ONE row per credited account, ever (member_id is
--    the primary key). Source: link, code or an approved claim.
-- 4. staff_signup_claims — a sign-up a staff member says they brought in
--    without a link; the Owner or Admin approves or rejects. At most one
--    pending claim per account.
-- 5. Two outreach templates gain {join_link}, filled with the sending staff
--    member's own link: city_hiring_post and seeded_tuition_live — only where
--    the stored wording is still the seeded wording (an edited template is left
--    for staff to change in Team inbox → Templates).
--
-- All four tables: RLS on, staff read (is_admin()), no write policy — every
-- write is a server path holding the service role.

-- 1 -----------------------------------------------------------------------
create table if not exists public.staff_join_links (
  staff_id   uuid primary key references public.profiles (id),
  slug       text not null unique check (slug ~ '^[a-z0-9-]{2,32}$'),
  code       text not null unique check (code ~ '^[A-Z0-9]{2,24}$'),
  created_at timestamptz not null default now()
);

-- 2 -----------------------------------------------------------------------
create table if not exists public.staff_referral_visits (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.profiles (id),
  source     text not null check (source in ('link', 'code')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists staff_referral_visits_staff_idx on public.staff_referral_visits (staff_id, created_at desc);

-- 3 -----------------------------------------------------------------------
create table if not exists public.staff_signup_credits (
  member_id   uuid primary key,
  staff_id    uuid not null references public.profiles (id),
  member_role text not null check (member_role in ('tutor', 'parent')),
  source      text not null check (source in ('link', 'code', 'claim')),
  visit_id    uuid references public.staff_referral_visits (id),
  claim_id    uuid,
  created_at  timestamptz not null default now()
);
create index if not exists staff_signup_credits_staff_idx on public.staff_signup_credits (staff_id);

-- 4 -----------------------------------------------------------------------
create table if not exists public.staff_signup_claims (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null,
  staff_id    uuid not null references public.profiles (id),
  note        text not null check (length(btrim(note)) between 1 and 500),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reason      text check (reason is null or length(reason) <= 500),
  decided_by  uuid references public.profiles (id),
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists staff_signup_claims_one_pending
  on public.staff_signup_claims (member_id) where status = 'pending';
create index if not exists staff_signup_claims_staff_idx on public.staff_signup_claims (staff_id, created_at desc);

-- RLS ---------------------------------------------------------------------
alter table public.staff_join_links enable row level security;
alter table public.staff_referral_visits enable row level security;
alter table public.staff_signup_credits enable row level security;
alter table public.staff_signup_claims enable row level security;

drop policy if exists staff_join_links_admin_read on public.staff_join_links;
create policy staff_join_links_admin_read on public.staff_join_links
  for select to authenticated using (public.is_admin());
drop policy if exists staff_referral_visits_admin_read on public.staff_referral_visits;
create policy staff_referral_visits_admin_read on public.staff_referral_visits
  for select to authenticated using (public.is_admin());
drop policy if exists staff_signup_credits_admin_read on public.staff_signup_credits;
create policy staff_signup_credits_admin_read on public.staff_signup_credits
  for select to authenticated using (public.is_admin());
drop policy if exists staff_signup_claims_admin_read on public.staff_signup_claims;
create policy staff_signup_claims_admin_read on public.staff_signup_claims
  for select to authenticated using (public.is_admin());

-- 5 -----------------------------------------------------------------------
update public.admin_message_templates
   set body = 'Hiring tutors in {city}! Join TutorMint free — find home and online tuitions near you. No commission, no middleman. Join: {join_link}',
       updated_at = now()
 where key = 'city_hiring_post'
   and body = 'Hiring tutors in {city}! Join TutorMint free — find home and online tuitions near you. No commission, no middleman. Apply: https://tutormint.org/apply';

update public.admin_message_templates
   set body = 'Hi {name}, your tuition is now live on TutorMint and verified tutors browsing the site can see it here: {tuition_url}. If you would like to post and manage your own tuitions next time, you can create a free account here: {join_link}',
       updated_at = now()
 where key = 'seeded_tuition_live'
   and body = 'Hi {name}, your tuition is now live on TutorMint and verified tutors browsing the site can see it here: {tuition_url}. If you would like to post and manage your own tuitions next time, you can create a free account at tutormint.org.';
