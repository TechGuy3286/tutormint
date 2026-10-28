-- 213_job_fields_search_data.sql — Job Posting fields, indexing "not open",
-- and the Search Console query data for the content queue (owner, 28 Oct 2026).
--
-- 1. jobs.employment_type — what kind of work a tuition is, for JobPosting
--    employmentType: 'part_time' | 'full_time' | 'contract'. Staff choose it
--    when posting (required); a parent's post derives it. Existing tuitions are
--    filled: home and online tuitions → part_time; a school post → full_time,
--    unless its own words say "part time" / "visiting" (part_time) or
--    "contract" (contract). Nothing else on a tuition changes.
-- 2. jobs.postal_code — five digits, or null. Filled from the city/area lookup
--    on the staff form and editable there. No existing row is filled (the page
--    falls back to the same lookup when it is empty).
-- 3. indexing_queue.skip_reason may also be 'not_open' — a notice for a
--    tuition that is paused, closed, hired or hidden when the queue reaches it
--    is marked, never sent and never deleted.
-- 4. search_console_queries — the query data the content queue is built from:
--    one row per source ('api' = read from the Search Console API by the
--    nightly rebuild, 'upload' = a "Queries" CSV the owner uploaded). Query,
--    clicks and impressions only. Admin-read RLS, service-role writes.
--
-- Additive and re-runnable.

alter table public.jobs add column if not exists employment_type text;
alter table public.jobs drop constraint if exists jobs_employment_type_check;
alter table public.jobs add constraint jobs_employment_type_check
  check (employment_type is null or employment_type in ('part_time', 'full_time', 'contract'));

alter table public.jobs add column if not exists postal_code text;
alter table public.jobs drop constraint if exists jobs_postal_code_check;
alter table public.jobs add constraint jobs_postal_code_check
  check (postal_code is null or postal_code ~ '^[0-9]{5}$');

update public.jobs
set employment_type = case
  when coalesce(btrim(teaching_mode), '') in ('', 'Home Tutor', 'Online Tutor') then 'part_time'
  when (coalesce(teaching_mode, '') || ' ' || coalesce(title, '') || ' ' || coalesce(description, '')) ~* 'part[[:space:]-]?time|visiting' then 'part_time'
  when (coalesce(teaching_mode, '') || ' ' || coalesce(title, '') || ' ' || coalesce(description, '')) ~* 'contract' then 'contract'
  else 'full_time'
end
where employment_type is null;

alter table public.indexing_queue drop constraint if exists indexing_queue_skip_reason_check;
alter table public.indexing_queue add constraint indexing_queue_skip_reason_check
  check (skip_reason is null or skip_reason in ('not_tuition', 'old_address', 'superseded', 'not_open'));

create table if not exists public.search_console_queries (
  source text primary key check (source in ('api', 'upload')),
  rows jsonb not null default '[]'::jsonb,
  status text not null default 'ok' check (status in ('ok', 'error')),
  error text,
  fetched_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.search_console_queries enable row level security;
drop policy if exists search_console_queries_admin_read on public.search_console_queries;
create policy search_console_queries_admin_read on public.search_console_queries
  for select to authenticated using (public.is_admin());
