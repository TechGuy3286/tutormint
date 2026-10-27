-- 210_complaint_hold_email_savings.sql  (owner, 27 Oct 2026)
--
-- Additive and re-runnable.
--
--   1. admin_message_templates.active (default true). The consent "Ask parent"
--      template (consent_ask) is marked inactive: consent is no longer needed.
--      Nothing is deleted.
--   2. Pause on complaint ("Withdraw a contact" → "Pause all their tuitions"):
--        contact_holds      — one live hold per number: sha256 hash + masked
--                             form only (never the number), reason, who/when;
--                             released_* when "Unpause all" lifts it.
--        contact_hold_jobs  — each tuition the hold paused, with its EXACT state
--                             before (status, hidden_reason, hidden_prev_status,
--                             hidden_at, is_featured), so "Unpause all" puts it
--                             back as it was; restored_at once it is.
--      A paused tuition is status 'hidden', hidden_reason 'contact_complaint'.
--      Both tables: RLS on, NO policies — service role only.
--   3. sync_parent_tuitions(): an account flag change never un-hides or
--      re-labels a tuition paused on complaint (as for 'contact_withdrawn').
--   4. hidden_tuition_redirects(): a tuition paused on complaint is NOT
--      redirected — it stays at its URL and says "This tuition is not available".
--   5. Email savings:
--        email_sends.status may be 'queued'; email_sends.opened_at (from the
--        Resend webhook's email.opened).
--        email_do_not_send — an address Resend reported bounced or complained:
--                            sha256 of the lower-cased address + masked form,
--                            reason, when; removed_at (never deleted).
--        email_queue       — emails held for later: kind 'daily_limit' (over 90%
--                            of the daily limit — sent the next day) or
--                            'summary' (non-urgent member emails, combined into
--                            one daily summary per person). The rendered subject
--                            and text are kept only until sent, then cleared.
--      app_settings 'email.daily_limit' = '100' (Resend's daily limit; editable).
--      All service role only (RLS on, admin read on the queue and the list).

-- 1 --------------------------------------------------------------------------
alter table public.admin_message_templates add column if not exists active boolean not null default true;
update public.admin_message_templates set active = false where key = 'consent_ask' and active;

-- 2 --------------------------------------------------------------------------
create table if not exists public.contact_holds (
  id               uuid primary key default gen_random_uuid(),
  number_hash      text not null check (number_hash ~ '^[0-9a-f]{64}$'),
  masked           text not null check (char_length(masked) <= 40),
  reason           text not null check (char_length(reason) between 3 and 600),
  held_by          uuid,
  held_by_name     text,
  held_at          timestamptz not null default now(),
  released_at      timestamptz,
  released_by      uuid,
  released_by_name text,
  released_reason  text check (released_reason is null or char_length(released_reason) <= 600),
  released_how     text check (released_how is null or released_how in ('unpaused', 'removed'))
);
create unique index if not exists contact_holds_live on public.contact_holds (number_hash) where released_at is null;
alter table public.contact_holds enable row level security;

create table if not exists public.contact_hold_jobs (
  hold_id                 uuid not null references public.contact_holds (id) on delete cascade,
  job_id                  uuid not null references public.jobs (id) on delete cascade,
  prev_status             text,
  prev_hidden_reason      text,
  prev_hidden_prev_status text,
  prev_hidden_at          timestamptz,
  prev_is_featured        boolean,
  paused_at               timestamptz not null default now(),
  restored_at             timestamptz,
  primary key (hold_id, job_id)
);
create index if not exists contact_hold_jobs_job on public.contact_hold_jobs (job_id);
alter table public.contact_hold_jobs enable row level security;

-- 3 --------------------------------------------------------------------------
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
       and hidden_reason is distinct from 'contact_withdrawn'
       and hidden_reason is distinct from 'contact_complaint';
  else
    update public.jobs
       set status = coalesce(hidden_prev_status, 'open'), hidden_prev_status = null, hidden_at = null, hidden_reason = null
     where parent_id = p_parent and status = 'hidden'
       and hidden_reason is distinct from 'contact_withdrawn'
       and hidden_reason is distinct from 'contact_complaint';
  end if;
end
$$;
revoke all on function public.sync_parent_tuitions(uuid) from public, anon, authenticated;

-- 4 --------------------------------------------------------------------------
create or replace function public.hidden_tuition_redirects()
returns table (slug text, city text, city_has_open boolean)
language sql
stable
security definer
set search_path = public
as $$
  select j.public_slug::text,
         nullif(btrim(j.city), '')::text,
         exists (
           select 1 from public.jobs o
            where o.status = 'open'
              and lower(btrim(o.city)) = lower(btrim(j.city))
         )
    from public.jobs j
   where j.status = 'hidden' and j.public_slug is not null
     and j.hidden_reason is distinct from 'contact_complaint'
$$;
revoke all on function public.hidden_tuition_redirects() from public;
grant execute on function public.hidden_tuition_redirects() to anon, authenticated, service_role;

-- 5 --------------------------------------------------------------------------
alter table public.email_sends drop constraint if exists email_sends_status_check;
alter table public.email_sends add constraint email_sends_status_check check (status in ('sent', 'failed', 'skipped', 'queued'));
alter table public.email_sends add column if not exists opened_at timestamptz;
create index if not exists email_sends_provider_idx on public.email_sends (provider_id) where provider_id is not null;
create index if not exists email_sends_recipient_idx on public.email_sends (recipient, template, created_at desc);

create table if not exists public.email_do_not_send (
  id            uuid primary key default gen_random_uuid(),
  address_hash  text not null check (address_hash ~ '^[0-9a-f]{64}$'),
  masked        text not null check (char_length(masked) <= 80),
  reason        text not null check (reason in ('bounced', 'complained', 'manual')),
  event_id      text,
  created_at    timestamptz not null default now(),
  removed_at    timestamptz,
  removed_by    uuid
);
create unique index if not exists email_do_not_send_live on public.email_do_not_send (address_hash) where removed_at is null;
alter table public.email_do_not_send enable row level security;
drop policy if exists email_do_not_send_admin_read on public.email_do_not_send;
create policy email_do_not_send_admin_read on public.email_do_not_send for select to authenticated using (public.is_admin());

create table if not exists public.email_queue (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('daily_limit', 'summary')),
  template    text,
  recipient   text not null,
  user_id     uuid,
  subject     text,
  body_text   text,
  body_html   text,
  created_at  timestamptz not null default now(),
  due_at      timestamptz not null default now(),
  sent_at     timestamptz,
  dropped_at  timestamptz,
  drop_reason text
);
create index if not exists email_queue_due on public.email_queue (kind, due_at) where sent_at is null and dropped_at is null;
alter table public.email_queue enable row level security;
drop policy if exists email_queue_admin_read on public.email_queue;
create policy email_queue_admin_read on public.email_queue for select to authenticated using (public.is_admin());

insert into public.app_settings (key, value)
values ('email.daily_limit', '100')
on conflict (key) do nothing;
