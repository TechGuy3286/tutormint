-- 42_avatar_source_and_rank_snapshots.sql
--
-- TWO THINGS. One repairs a split source of truth; one adds the state a new
-- notification needs.
--
-- ============================================================================
-- 1. ONE AVATAR, ONE SOURCE
--
-- A tutor's photograph was being written to `tutor_profiles.avatar_url` by
-- /tutor/dashboard/settings, and read from `profiles.avatar_url` by the site
-- header. So a tutor with a photo on their public profile got initials in the
-- header of every page — the two surfaces were reading different columns and
-- neither was wrong on its own.
--
-- `profiles.avatar_url` IS THE SOURCE. It is the row every member has,
-- regardless of role, and it is what getSessionUser() already selects.
--
-- `tutor_profiles.avatar_url` STAYS, as a mirror, because two SECURITY DEFINER
-- objects read it — the `tutor_directory` view and the `tutor_public_page()`
-- function — and both are the public listing surface. Rewriting those to join
-- `profiles` is a bigger change, with a bigger blast radius, than this bug
-- justifies. The mirror is kept by trigger rather than by convention, because
-- convention is exactly what produced the split.
--
-- Both directions are covered, so it does not matter which side a writer
-- touches: the existing settings page writes tutor_profiles and keeps working
-- unchanged. `pg_trigger_depth()` stops the pair from bouncing.
--
-- ============================================================================
-- 2. RANK SNAPSHOTS
--
-- `rank_dropped` is a new notification: "You've dropped to #14 for Physics in
-- Lahore." It can only be a real event if there is something to compare
-- against, so the position widget records where the tutor stood the last time
-- it was computed. One row per tutor; the widget updates it on every read.
--
-- Deliberately NOT a history table. Nothing needs the shape of the curve, and
-- a row per tutor per dashboard load is a lot of writes for a number that only
-- matters as "worse than last time".

begin;

-- ---------------------------------------------------------------- avatars ---
update public.profiles p
   set avatar_url = tp.avatar_url
  from public.tutor_profiles tp
 where tp.id = p.id
   and p.avatar_url is null
   and tp.avatar_url is not null;

update public.tutor_profiles tp
   set avatar_url = p.avatar_url
  from public.profiles p
 where p.id = tp.id
   and tp.avatar_url is null
   and p.avatar_url is not null;

create or replace function public.mirror_avatar_from_tutor()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if new.avatar_url is distinct from old.avatar_url then
    update public.profiles set avatar_url = new.avatar_url where id = new.id;
  end if;
  return null;
end $fn$;

create or replace function public.mirror_avatar_to_tutor()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if new.avatar_url is distinct from old.avatar_url then
    update public.tutor_profiles set avatar_url = new.avatar_url where id = new.id;
  end if;
  return null;
end $fn$;

drop trigger if exists tutor_profiles_mirror_avatar on public.tutor_profiles;
create trigger tutor_profiles_mirror_avatar
  after update of avatar_url on public.tutor_profiles
  for each row execute function public.mirror_avatar_from_tutor();

drop trigger if exists profiles_mirror_avatar on public.profiles;
create trigger profiles_mirror_avatar
  after update of avatar_url on public.profiles
  for each row execute function public.mirror_avatar_to_tutor();

comment on column public.tutor_profiles.avatar_url is
  'MIRROR of profiles.avatar_url, kept by trigger. Written to because tutor_directory and tutor_public_page() read it; profiles.avatar_url is the source.';

-- ------------------------------------------------------- rank snapshots -----
create table if not exists public.tutor_rank_snapshots (
  tutor_id   uuid primary key references public.profiles(id) on delete cascade,
  master_id  integer,
  city       text,
  rank       integer not null,
  total      integer not null,
  updated_at timestamptz not null default now()
);

alter table public.tutor_rank_snapshots enable row level security;

-- No policy at all: written and read by the server through the service role,
-- like rate_limits. A tutor reading their own snapshot would learn nothing the
-- position widget does not already show them, and giving the anon key a way to
-- read where any tutor stands is a competitive-intelligence feed nobody asked
-- for.
comment on table public.tutor_rank_snapshots is
  'Where each tutor stood the last time the position widget ran. Feeds the rank_dropped notification. Service-role only, by design.';

commit;
