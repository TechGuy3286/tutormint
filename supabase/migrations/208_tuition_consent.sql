-- 208_tuition_consent.sql  (owner, 27 Oct 2026)
--
-- Parent consent for listings. 1,346 of 1,482 staff-posted tuitions use a
-- parent number with no account behind it, so nothing records that the parent
-- agreed to be listed. From now on every tuition carries a consent record.
--
--   1. tuition_consents — ONE row per tuition (job_id primary key):
--        status   'recorded' | 'not_recorded'
--        method   'phone' | 'whatsapp' | 'in_person' | 'parent_posted'
--                 (set exactly when status = 'recorded')
--        recorded_by / recorded_by_name / recorded_at, optional note.
--      A DEDICATED table, not columns on jobs: jobs has a public row-read
--      policy and RLS cannot hide a column, and the note and the staff name are
--      not public. Admin-read RLS, service-role writes (the job_contacts pattern).
--   2. Backfill: a tuition posted by a parent from their own account is
--      "Recorded — Parent posted it themselves" (dated when it was posted);
--      every staff-posted (team account) tuition starts "Not recorded".
--   3. An AFTER INSERT trigger on jobs writes the row for every new tuition
--      the same way. A staff post then records the consent the form required
--      (lib/jobs createTeamJob) by updating that row.
--   4. Template consent_ask ("Ask parent", Team inbox → Templates → Consent).
--   5. app_settings 'privacy.hide_unconsented_numbers' = 'true' (ON by default;
--      Owner-only switch, Admin → Settings → Privacy).
--   6. Reports never target the team account: the one existing job report that
--      named it as the reported member is pointed at the tuition only
--      (reported_id = null). Nothing is deleted.
--
-- Additive and re-runnable.

-- 1 ------------------------------------------------------------------------
create table if not exists public.tuition_consents (
  job_id            uuid primary key references public.jobs (id) on delete cascade,
  status            text not null default 'not_recorded' check (status in ('recorded', 'not_recorded')),
  method            text check (method in ('phone', 'whatsapp', 'in_person', 'parent_posted')),
  recorded_by       uuid references auth.users (id) on delete set null,
  recorded_by_name  text,
  recorded_at       timestamptz,
  note              text check (note is null or char_length(note) <= 500),
  updated_at        timestamptz not null default now(),
  constraint tuition_consents_method_when_recorded check ((status = 'recorded') = (method is not null))
);

create index if not exists tuition_consents_status_idx on public.tuition_consents (status);

alter table public.tuition_consents enable row level security;
drop policy if exists tuition_consents_admin_read on public.tuition_consents;
create policy tuition_consents_admin_read on public.tuition_consents
  for select using (public.is_admin());

-- 2 ------------------------------------------------------------------------
insert into public.tuition_consents (job_id, status, method, recorded_at, updated_at)
select j.id,
       case when coalesce(p.is_team_account, false) then 'not_recorded' else 'recorded' end,
       case when coalesce(p.is_team_account, false) then null else 'parent_posted' end,
       case when coalesce(p.is_team_account, false) then null else j.created_at end,
       now()
from public.jobs j
left join public.profiles p on p.id = j.parent_id
on conflict (job_id) do nothing;

-- 3 ------------------------------------------------------------------------
create or replace function public.tuition_consent_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  team boolean;
begin
  select coalesce(is_team_account, false) into team from public.profiles where id = new.parent_id;
  insert into public.tuition_consents (job_id, status, method, recorded_at)
  values (
    new.id,
    case when coalesce(team, false) then 'not_recorded' else 'recorded' end,
    case when coalesce(team, false) then null else 'parent_posted' end,
    case when coalesce(team, false) then null else coalesce(new.created_at, now()) end
  )
  on conflict (job_id) do nothing;
  return new;
end
$$;

revoke all on function public.tuition_consent_on_insert() from public, anon, authenticated;

drop trigger if exists jobs_tuition_consent on public.jobs;
create trigger jobs_tuition_consent
  after insert on public.jobs
  for each row execute function public.tuition_consent_on_insert();

-- 4 ------------------------------------------------------------------------
insert into public.admin_message_templates (key, title, subject, body)
values (
  E'consent_ask',
  E'Consent — ask the parent to be listed',
  E'May we list your tuition?',
  E'Assalam o Alaikum, we\'d like to list your tuition requirement on TutorMint so verified tutors can apply. May we list it? Please reply YES or NO.'
)
on conflict (key) do nothing;

-- 5 ------------------------------------------------------------------------
insert into public.app_settings (key, value)
values ('privacy.hide_unconsented_numbers', 'true')
on conflict (key) do nothing;

-- 6 ------------------------------------------------------------------------
update public.reports r
set reported_id = null
from public.profiles p
where p.id = r.reported_id
  and p.is_team_account
  and r.target_type = 'job';
