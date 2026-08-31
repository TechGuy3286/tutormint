-- 02_canonical_schema.sql
-- Canonical tables per CLAUDE.md. Column names below were taken from
-- supabase/schema-before.md (real introspection), not from guesses.
--
-- ADDITIVE ONLY, by design: "create table if not exists" and
-- "add column if not exists". No DROP, no RENAME, no ALTER ... TYPE.
-- The type changes and renames the canonical spec also implies are listed at
-- the bottom of this file and are NOT executed here -- they need sign-off.
-- Idempotent: safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- New tables (none of these existed)
-- ---------------------------------------------------------------------------

create table if not exists public.plans (
  code                 text primary key,
  audience             text not null check (audience in ('tutor','parent')),
  name                 text not null,
  price_pkr            integer not null default 0,
  duration_days        integer not null default 30,
  monthly_quota        integer not null default 0,
  displayed_quota      text    not null default '0',
  can_view_contact     boolean not null default false,
  can_whatsapp         boolean not null default false,
  can_initiate_message boolean not null default false,
  search_rank          integer not null default 1,
  badges               text[]  not null default '{}',
  tag_label            text,
  created_at           timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  plan_code  text not null references public.plans(code),
  starts_at  timestamptz not null default now(),
  expires_at timestamptz,
  status     text not null default 'active' check (status in ('active','expired','cancelled')),
  payment_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id, status);

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  plan_code       text references public.plans(code),
  amount_pkr      integer not null default 0,
  method          text check (method in ('jazzcash','easypaisa','bank','assanpay')),
  reference       text,
  screenshot_path text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by     uuid references auth.users(id),
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments (user_id, status);

create table if not exists public.usage_counters (
  user_id            uuid not null references auth.users(id) on delete cascade,
  period             text not null,
  jobs_applied       integer not null default 0,
  jobs_posted        integer not null default 0,
  messages_initiated integer not null default 0,
  updated_at         timestamptz not null default now(),
  primary key (user_id, period)
);

create table if not exists public.applications (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid,
  tutor_id   uuid not null references auth.users(id) on delete cascade,
  message    text,
  status     text not null default 'applied'
             check (status in ('applied','shortlisted','hired','rejected')),
  created_at timestamptz not null default now()
);
create unique index if not exists applications_job_tutor_uniq
  on public.applications (job_id, tutor_id);

create table if not exists public.threads (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid,
  participant_a uuid not null references auth.users(id) on delete cascade,
  participant_b uuid not null references auth.users(id) on delete cascade,
  initiated_by  uuid not null references auth.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists threads_participants_idx
  on public.threads (participant_a, participant_b);

create table if not exists public.shortlists (
  user_id    uuid not null references auth.users(id) on delete cascade,
  tutor_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, tutor_id)
);

create table if not exists public.demo_requests (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid not null references auth.users(id) on delete cascade,
  tutor_id   uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'requested'
             check (status in ('requested','accepted','declined','completed','cancelled')),
  created_at timestamptz not null default now()
);

-- Subject join tables. taxonomy_subjects has no stable slug column yet
-- (see 03), so the FK is deferred until the taxonomy shape is settled.
create table if not exists public.tutor_subjects (
  tutor_id     uuid not null references auth.users(id) on delete cascade,
  subject_slug text not null,
  primary key (tutor_id, subject_slug)
);

create table if not exists public.job_subjects (
  job_id       uuid not null,
  subject_slug text not null,
  primary key (job_id, subject_slug)
);

-- ---------------------------------------------------------------------------
-- Existing canonical tables: add missing columns only
-- ---------------------------------------------------------------------------

-- profiles already has: id, full_name, email, phone_number, role (user_role),
-- email_verified, phone_verified, cnic_number, cnic_image_url, account_status,
-- report_count, is_suspended, suspension_reason, created_at, updated_at.
alter table public.profiles
  add column if not exists account_type        text check (account_type in ('parent','school')),
  add column if not exists whatsapp            text,
  add column if not exists phone_verified_at   timestamptz,
  add column if not exists city                text,
  add column if not exists province            text,
  add column if not exists address             text,
  add column if not exists cnic_image_path     text,
  add column if not exists cnic_verified_at    timestamptz,
  add column if not exists address_verified_at timestamptz,
  add column if not exists avatar_url          text,
  add column if not exists profile_completion  integer not null default 0;

-- tutor_profiles already has: full_name, email, phone_number, whatsapp_number,
-- city, area_name, teaching_mode, specialty_subjects, avatar_url, degrees(jsonb),
-- certifications, cover_image_url, specialty_list, experience_letter_url,
-- selfie_url, is_featured, availability_list, video_intro_url, updated_at.
alter table public.tutor_profiles
  add column if not exists slug              text,
  add column if not exists headline          text,
  add column if not exists bio               text,
  add column if not exists subjects          text[],
  add column if not exists class_levels      text[],
  add column if not exists online_platforms  text[],
  add column if not exists area              text,
  add column if not exists hourly_rate_pkr   integer,
  add column if not exists experience_years  integer,
  add column if not exists video_youtube_id  text,
  add column if not exists rating_avg        numeric(3,2) not null default 0,
  add column if not exists rating_count      integer not null default 0,
  add column if not exists created_at        timestamptz not null default now();

alter table public.tutor_profiles
  add column if not exists video_status text not null default 'none';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tutor_profiles_video_status_chk') then
    alter table public.tutor_profiles
      add constraint tutor_profiles_video_status_chk
      check (video_status in ('none','uploaded','approved','rejected'));
  end if;
end $$;

-- The public.verification_status enum already exists with exactly the values
-- the spec asks for (pending|verified|rejected|suspended), so reuse it.
alter table public.tutor_profiles
  add column if not exists verification_status public.verification_status not null default 'pending';

create unique index if not exists tutor_profiles_slug_uniq
  on public.tutor_profiles (slug) where slug is not null;

-- jobs exists but is empty (0 rows). Existing columns: id(text), parent_id,
-- subject, grade, area, budget, timings, status, hired_tutor_id, created_at.
alter table public.jobs
  add column if not exists job_tx_id     text,
  add column if not exists title         text,
  add column if not exists subjects      text[],
  add column if not exists class_level   text,
  add column if not exists city          text,
  add column if not exists teaching_mode text,
  add column if not exists budget_pkr    integer,
  add column if not exists description   text,
  add column if not exists is_featured   boolean not null default false;

create unique index if not exists jobs_job_tx_id_uniq
  on public.jobs (job_tx_id) where job_tx_id is not null;

-- messages has job_id(text), sender(text), recipient(text), message(text).
-- Canonical wants thread_id/sender_id/body. Added alongside; the text->uuid
-- conversion of sender/recipient is a type change and is NOT done here.
alter table public.messages
  add column if not exists thread_id uuid,
  add column if not exists sender_id uuid,
  add column if not exists body      text;

-- reviews is empty. Has reviewer_type, target_id, rating_primary, rating_secondary.
alter table public.reviews
  add column if not exists tutor_id  uuid,
  add column if not exists parent_id uuid,
  add column if not exists rating    numeric(2,1);

-- phone_otps has phone, otp_code, expires_at, created_at. The spec calls the
-- column "code"; that rename is deferred. Add the hardening columns the OTP
-- flow needs (single-use, attempt cap):
alter table public.phone_otps
  add column if not exists consumed_at timestamptz,
  add column if not exists attempts    integer not null default 0;

commit;

-- ---------------------------------------------------------------------------
-- DEFERRED -- these need explicit sign-off before they are written or run:
--   1. taxonomy_* reconciliation (see 03_taxonomy.sql). The existing tables
--      have an entirely different shape from supabase/seed/seed_taxonomy.sql.
--   2. jobs.id is text; canonical implies uuid. ALTER TYPE, table is empty.
--   3. messages.sender / messages.recipient are text; canonical wants a uuid
--      sender_id. 3 live rows.
--   4. tutor_profiles.degrees is jsonb; canonical says text[].
--   5. phone_otps.otp_code -> code (rename).
--   6. tutor_profiles.area_name -> area and profiles.cnic_image_url ->
--      cnic_image_path now exist as duplicate pairs. The old columns stay in
--      place and are dropped only in T8, after every page has moved off them.
-- ---------------------------------------------------------------------------
