-- 207_contact_withdraw.sql — "Withdraw a contact" (owner, 27 Oct 2026).
--
-- A person whose phone number was put on tuitions without their consent asks
-- for it to be removed. The Owner finds every tuition using the number, closes
-- them, removes the number, and blocks it. The work runs in the app
-- (lib/contactWithdraw.ts, service role); this migration adds what it needs.
--
--   1. do_not_use_numbers — the "Do not use" list. The number is stored ONLY as
--      a sha256 hash (lib/contactWithdrawCore numberHash) plus a masked form for
--      the Owner's list (0300 •••• 123). Reason, who added it and when; removal
--      is a stamp (removed_at / by / reason), never a delete. One live row per
--      hash. RLS on with NO policies: service role only (the pending_signups
--      pattern) — only the Owner reads it, through a server route.
--   2. contact_withdrawals — one row per withdrawal: hash, masked form, reason,
--      who, when, and a summary (tuition ids, counts). No number. RLS on, no
--      policies.
--   3. A withdrawn tuition is status 'hidden' with hidden_reason
--      'contact_withdrawn' — so it 301s through hidden_tuition_redirects()
--      (migration 198), is in no public list or sitemap, has no JobPosting, and
--      its applications read "Tuition no longer available". sync_parent_tuitions
--      must NEVER un-hide or re-label such a tuition when its poster's account
--      flags change (it restored every 'hidden' tuition of a parent before).

-- 1 -----------------------------------------------------------------------------
create table if not exists public.do_not_use_numbers (
  id              uuid primary key default gen_random_uuid(),
  number_hash     text not null check (number_hash ~ '^[0-9a-f]{64}$'),
  masked          text not null check (char_length(masked) <= 40),
  reason          text not null check (char_length(reason) between 3 and 600),
  source          text not null default 'withdraw' check (source in ('withdraw', 'manual')),
  added_by        uuid,
  added_by_name   text,
  added_at        timestamptz not null default now(),
  removed_at      timestamptz,
  removed_by      uuid,
  removed_by_name text,
  removed_reason  text check (removed_reason is null or char_length(removed_reason) <= 600)
);
create unique index if not exists do_not_use_numbers_live
  on public.do_not_use_numbers (number_hash) where removed_at is null;
alter table public.do_not_use_numbers enable row level security;

-- 2 -----------------------------------------------------------------------------
create table if not exists public.contact_withdrawals (
  id            uuid primary key default gen_random_uuid(),
  number_hash   text not null check (number_hash ~ '^[0-9a-f]{64}$'),
  masked        text not null check (char_length(masked) <= 40),
  reason        text not null check (char_length(reason) between 3 and 600),
  done_by       uuid,
  done_by_name  text,
  done_at       timestamptz not null default now(),
  summary       jsonb not null default '{}'::jsonb
);
create index if not exists contact_withdrawals_hash on public.contact_withdrawals (number_hash, done_at desc);
alter table public.contact_withdrawals enable row level security;

-- 3 -----------------------------------------------------------------------------
create or replace function public.sync_parent_tuitions(p_parent uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  why text;
begin
  select public.parent_hide_reason(pr) into why from public.profiles pr where pr.id = p_parent;
  if why is not null then
    update public.jobs
       set hidden_prev_status = status, status = 'hidden', hidden_at = now(), hidden_reason = why
     where parent_id = p_parent and status is distinct from 'hidden';
    update public.jobs set hidden_reason = why
     where parent_id = p_parent and status = 'hidden' and hidden_reason is distinct from why
       and hidden_reason is distinct from 'contact_withdrawn';
  else
    update public.jobs
       set status = coalesce(hidden_prev_status, 'open'), hidden_prev_status = null, hidden_at = null, hidden_reason = null
     where parent_id = p_parent and status = 'hidden'
       and hidden_reason is distinct from 'contact_withdrawn';
  end if;
end
$$;
revoke all on function public.sync_parent_tuitions(uuid) from public, anon, authenticated;
