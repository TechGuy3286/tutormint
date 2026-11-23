-- 245_pr18_ai_posting_claims_otp_alerts.sql  (owner, 23 Nov 2026 — PR-18)
--
-- Additive and idempotent; nothing is deleted. No member row is changed.
--
-- 1. member_follow_ups.channel may be 'claim' — "I'm on it" (Part C.4) is a
--    follow-up of the tutor's current stage, logged like any other.
-- 2. member_work_claims — who is working on a member right now:
--      kind 'session' — the "Start follow-ups" mode holds a tutor while it is
--                       open (expires after 10 minutes, released on Skip or a
--                       recorded outcome), so two staff never get the same one;
--      kind 'on_it'   — "I'm on it": the first staff member to tap owns the
--                       member until they release it or the Owner reassigns.
--    At most one live claim of each kind per member (partial unique indexes).
--    claim_follow_up_session() takes the first free member of a candidate list
--    atomically. Service role only (RLS on, no policies). Ids and times only.
-- 3. tuition_post_sources — whether a staff tuition was filled by the AI paste
--    box or typed by hand (counts only, for Insights later).
-- 4. otp_alerts — one row per member whose mobile was verified, for the
--    "New verified tutor/parent" staff emails (sent, digest, or held back by the
--    daily email budget). Ids, role and times only — never a phone or email.
-- 5. app_settings 'alerts.otp_recipients' (JSON array of profile ids, default
--    the Owner + the 'staff.insights' grant, i.e. Mohsin) and
--    'alerts.otp_digest' ('off').
-- 6. pg_cron runs refresh_tutor_rank_cache(null) every minute inside the
--    database (it ran from the Vercel admin-summary function before), and a
--    daily job trims pg_cron's own run log to 7 days.

-- 1 ---------------------------------------------------------------------------
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.member_follow_ups'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%channel%'
  loop
    execute format('alter table public.member_follow_ups drop constraint %I', c);
  end loop;
end $$;
alter table public.member_follow_ups
  add constraint member_follow_ups_channel_check check (channel in ('whatsapp', 'call', 'email', 'claim'));

-- 2 ---------------------------------------------------------------------------
create table if not exists public.member_work_claims (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('session', 'on_it')),
  stage text,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz,
  released_at timestamptz,
  released_by uuid references public.profiles(id) on delete set null,
  release_reason text check (release_reason is null or release_reason in ('skip', 'done', 'expired', 'released', 'reassigned'))
);
alter table public.member_work_claims enable row level security;
create unique index if not exists member_work_claims_one_session
  on public.member_work_claims (member_id) where kind = 'session' and released_at is null;
create unique index if not exists member_work_claims_one_on_it
  on public.member_work_claims (member_id) where kind = 'on_it' and released_at is null;
create index if not exists member_work_claims_staff on public.member_work_claims (staff_id, kind) where released_at is null;

-- The first candidate (in the order given) nobody else holds: no live session
-- claim of another staff member, no "I'm on it" of another staff member. The
-- caller's own older session claims are released first (one tutor at a time).
-- Expired sessions are stamped 'expired' on the way. Returns the member id, or
-- null when every candidate is taken.
create or replace function public.claim_follow_up_session(p_staff uuid, p_ids uuid[], p_stage text, p_ttl_seconds integer default 600)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m uuid;
begin
  update member_work_claims set released_at = now(), release_reason = 'expired'
   where kind = 'session' and released_at is null and expires_at < now();
  update member_work_claims set released_at = now(), released_by = p_staff, release_reason = 'released'
   where kind = 'session' and released_at is null and staff_id = p_staff;
  foreach m in array coalesce(p_ids, '{}'::uuid[]) loop
    if exists (select 1 from member_work_claims w where w.member_id = m and w.kind = 'on_it' and w.released_at is null and w.staff_id <> p_staff) then
      continue;
    end if;
    begin
      insert into member_work_claims (member_id, staff_id, kind, stage, expires_at)
      values (m, p_staff, 'session', p_stage, now() + make_interval(secs => greatest(60, p_ttl_seconds)));
      return m;
    exception when unique_violation then
      continue;
    end;
  end loop;
  return null;
end;
$$;
revoke all on function public.claim_follow_up_session(uuid, uuid[], text, integer) from public, anon, authenticated;

-- 3 ---------------------------------------------------------------------------
create table if not exists public.tuition_post_sources (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  source text not null check (source in ('ai', 'manual')),
  staff_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.tuition_post_sources enable row level security;
create index if not exists tuition_post_sources_day on public.tuition_post_sources (created_at, source);

-- 4 ---------------------------------------------------------------------------
create table if not exists public.otp_alerts (
  member_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('tutor', 'parent')),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sent', 'digest_sent', 'held_limit', 'no_recipients', 'failed')),
  sent_at timestamptz,
  emails integer not null default 0
);
alter table public.otp_alerts enable row level security;
create index if not exists otp_alerts_pending on public.otp_alerts (created_at) where status = 'pending';
create index if not exists otp_alerts_day on public.otp_alerts (created_at);

-- 5 ---------------------------------------------------------------------------
insert into public.app_settings (key, value)
select 'alerts.otp_recipients',
       (select coalesce(jsonb_agg(distinct x), '[]'::jsonb)::text from (
          select id::text x from public.profiles where role = 'admin' and admin_role = 'owner'
          union
          select jsonb_array_elements_text(coalesce((select value from public.app_settings where key = 'staff.insights'), '[]')::jsonb)
        ) s)
on conflict (key) do nothing;
insert into public.app_settings (key, value) values ('alerts.otp_digest', 'off')
on conflict (key) do nothing;

-- 6 ---------------------------------------------------------------------------
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('tm-rank-cache-refresh', 'tm-cron-log-trim');
  perform cron.schedule('tm-rank-cache-refresh', '* * * * *', 'select public.refresh_tutor_rank_cache(null)');
  perform cron.schedule('tm-cron-log-trim', '17 3 * * *', $c$delete from cron.job_run_details where end_time < now() - interval '7 days'$c$);
end $$;
