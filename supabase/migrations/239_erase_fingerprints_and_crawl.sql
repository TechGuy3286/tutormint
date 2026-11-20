-- 239 — Re-sign-up block for erased members, the tutor profile's "last real
-- change", and the Parent interest inbox's window index (owner, 20 Nov 2026 — PR-11).
--
-- 1. erased_fingerprints — when an erase runs, a KEYED one-way fingerprint
--    (HMAC-SHA256 with the server-only ERASE_FINGERPRINT_SECRET) of each of the
--    member's mobile numbers (normalised to 92XXXXXXXXXX) and of their CNIC
--    number (digits only). Never the number itself. A sign-up / mobile
--    verification / CNIC entry whose fingerprint matches a row with
--    allowed_at IS NULL is refused. "Allow" (Owner, reason required) stamps
--    allowed_at; its Undo clears it.
--
-- 2. signup_block_attempts — each refused attempt: when, which step, the kind,
--    the LAST TWO digits of what was entered (the Owner's list shows "••42"),
--    and which fingerprint row it matched. reviewed_at = the Owner pressed
--    "Keep blocked" (the Overview to-do counts unreviewed attempts whose
--    fingerprint is still blocked).
--
--    Both tables: RLS on, no policy, no client grant (service role only).
--
-- 3. tutor_profiles.content_updated_at — the profile's last REAL change, for
--    the tutor sitemap's lastmod. updated_at is stamped on every UPDATE
--    (migration 138), including bookkeeping (WhatsApp-updates switch, banner
--    dismissals, video upload attempts, review flags); content_updated_at moves
--    only when a column a visitor can see changes, or the tutor's subjects
--    change. Existing rows start from updated_at (the best value on record).
--    listed_tutor_slugs() returns it (same signature, same rows, grants kept).
--
-- 4. parent_interest_events (created_at) — the inbox reads the 30-day window of
--    every event; the only created_at index was partial (alerted_at is null).
--
-- Additive and re-runnable. No phone, CNIC, name or email is stored.

-- ---------------------------------------------------------------- 1 and 2 ---
create table if not exists public.erased_fingerprints (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  fingerprint text not null,
  member_id uuid not null,
  erasure_id uuid,
  erased_at timestamptz not null,
  allowed_at timestamptz,
  allowed_by uuid,
  allow_reason text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'erased_fingerprints_kind_chk') then
    alter table public.erased_fingerprints add constraint erased_fingerprints_kind_chk check (kind in ('mobile', 'cnic'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'erased_fingerprints_fp_chk') then
    -- 64 lowercase hex characters: an HMAC-SHA256 digest, never a number.
    alter table public.erased_fingerprints add constraint erased_fingerprints_fp_chk check (fingerprint ~ '^[0-9a-f]{64}$');
  end if;
end $$;

create unique index if not exists erased_fingerprints_one_per_member
  on public.erased_fingerprints (kind, fingerprint, member_id);
create index if not exists erased_fingerprints_blocked
  on public.erased_fingerprints (kind, fingerprint) where allowed_at is null;

comment on table public.erased_fingerprints is
  'PR-11: keyed HMAC-SHA256 fingerprints of an erased member''s mobile(s) and CNIC — never the number. A match blocks a new sign-up until the Owner allows it.';

create table if not exists public.signup_block_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  step text not null,
  last2 text not null,
  fingerprint_id uuid not null references public.erased_fingerprints (id),
  reviewed_at timestamptz,
  reviewed_by uuid
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'signup_block_attempts_kind_chk') then
    alter table public.signup_block_attempts add constraint signup_block_attempts_kind_chk check (kind in ('mobile', 'cnic'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'signup_block_attempts_step_chk') then
    alter table public.signup_block_attempts add constraint signup_block_attempts_step_chk check (step in ('signup', 'verify', 'cnic'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'signup_block_attempts_last2_chk') then
    alter table public.signup_block_attempts add constraint signup_block_attempts_last2_chk check (last2 ~ '^[0-9]{2}$');
  end if;
end $$;

create index if not exists signup_block_attempts_recent on public.signup_block_attempts (created_at desc);
create index if not exists signup_block_attempts_fp on public.signup_block_attempts (fingerprint_id);

alter table public.erased_fingerprints enable row level security;
alter table public.signup_block_attempts enable row level security;
revoke all on public.erased_fingerprints from anon, authenticated;
revoke all on public.signup_block_attempts from anon, authenticated;

-- ---------------------------------------------------------------------- 3 ---
alter table public.tutor_profiles add column if not exists content_updated_at timestamptz;
-- The one-time start value must not restamp updated_at (migration 138's
-- trigger) on every tutor, so that trigger is off for this one statement.
alter table public.tutor_profiles disable trigger tutor_profiles_set_updated_at;
update public.tutor_profiles set content_updated_at = coalesce(updated_at, created_at) where content_updated_at is null;
alter table public.tutor_profiles enable trigger tutor_profiles_set_updated_at;

create or replace function public.set_tutor_profiles_content_updated_at()
returns trigger
language plpgsql
as $$
declare
  -- Bookkeeping columns: a change to only these is not a change a visitor sees.
  skip text[] := array[
    'updated_at', 'content_updated_at', 'email', 'phone_number', 'whatsapp_number',
    'cnic_front_url', 'cnic_back_url', 'selfie_url', 'experience_letter_url',
    'video_status', 'video_attempts', 'video_visibility_set_at', 'video_visibility_set_by',
    'verification_status', 'imported', 'imported_at', 'imported_by', 'claimed_at',
    'terms_accepted_at', 'slug_locked', 'under_review', 'review_reason', 'onboarded_at',
    'verified_banner_seen_at', 'converted_to_parent_at', 'converted_to_parent_by',
    'cv_accent', 'status_card_dismissed_at', 'whatsapp_updates'
  ];
begin
  if (to_jsonb(new) - skip) is distinct from (to_jsonb(old) - skip) then
    new.content_updated_at = now();
  else
    new.content_updated_at = old.content_updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists tutor_profiles_set_content_updated_at on public.tutor_profiles;
create trigger tutor_profiles_set_content_updated_at
  before update on public.tutor_profiles
  for each row execute function public.set_tutor_profiles_content_updated_at();

alter table public.tutor_profiles alter column content_updated_at set default now();

-- A change of subjects is a real change too (they live in tutor_subjects).
create or replace function public.touch_tutor_content_from_subjects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tutor_profiles set content_updated_at = now()
   where id = coalesce(new.tutor_id, old.tutor_id);
  return null;
end;
$$;
revoke all on function public.touch_tutor_content_from_subjects() from public, anon, authenticated;

drop trigger if exists tutor_subjects_touch_content on public.tutor_subjects;
create trigger tutor_subjects_touch_content
  after insert or delete on public.tutor_subjects
  for each row execute function public.touch_tutor_content_from_subjects();

CREATE OR REPLACE FUNCTION public.listed_tutor_slugs()
 RETURNS TABLE(slug text, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- lastmod = the profile's last REAL change (PR-11), never before it was created.
  select d.slug, greatest(d.created_at, coalesce(tp.content_updated_at, tp.updated_at, d.created_at))
  from tutor_directory d
  join tutor_profiles tp on tp.id = d.id
  join profiles p on p.id = d.id
  where d.slug is not null
    and coalesce(p.is_seed, false) = false
    -- paid + approved (owner, 5 Oct 2026); the selfie is optional (12 Nov 2026).
    and tp.verified_fee_paid_at is not null
    -- CNIC approved = deriveCnicStatus(...) === 'approved' (marker + number + image)
    and (p.cnic_verified_at is not null or lower(coalesce(p.verification_state, '')) = 'approved')
    and coalesce(btrim(p.cnic_number), '') <> ''
    and coalesce(btrim(p.cnic_image_path), '') <> ''
    and p.profile_pic_status = 'approved';
$function$;

-- ---------------------------------------------------------------------- 4 ---
create index if not exists parent_interest_events_created_idx
  on public.parent_interest_events (created_at desc);
