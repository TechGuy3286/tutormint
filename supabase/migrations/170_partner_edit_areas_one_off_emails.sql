-- 170_partner_edit_areas_one_off_emails.sql (owner, 13 Oct 2026)
--
-- 1. Partner: edits tutors, parents and tuitions; everything else view only.
--    This replaces the "full management" of migration 165 in the database too.
--    The app refuses a Partner's writes outside those areas in every
--    /api/admin route (403, lib/adminAccessCore roleMayWrite); this closes the
--    other door — a Partner's own session token used directly against the
--    database API.
--
--      * public.is_admin_writer() keeps its meaning (any staff account) and
--        stays on the member and tuition tables a Partner may edit:
--        profiles, tutor_profiles, tutor_subjects, user_documents, children,
--        jobs, job_subjects, applications, demo_requests.
--      * public.is_admin_full_writer() — is_admin_writer() minus the Partner —
--        now gates the write policies of every OTHER table that admitted any
--        staff account: settings, plans, payments, subscriptions, usage
--        counters, the taxonomy, job titles, cities and areas.
--      * the storage write policies of the `ads` and `blog` buckets exclude the
--        Partner again (as migration 150 did).
--
--    Reading is unchanged for everyone: only write policies are rewritten, and a
--    FOR ALL policy already has its FOR SELECT twin from migration 150.
--
-- 2. one_off_emails — a send-once record for one-time emails to members
--    (first use: "You can now sign in to TutorMint" to the email-only tutors
--    opened on 13 Oct 2026). unique (user_id, email_key) is what makes a second
--    send impossible. Admin-read, service-role writes.
--
-- Idempotent. No existing row changes.

create or replace function public.is_admin_full_writer()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.admin_role is not null
      and p.admin_role is distinct from 'partner'
  )
$$;

grant execute on function public.is_admin_full_writer() to anon, authenticated, service_role;

do $$
declare
  pol record;
  new_qual text;
  new_check text;
  sql text;
  partner_tables constant text[] := array[
    'profiles', 'tutor_profiles', 'tutor_subjects', 'user_documents', 'children',
    'jobs', 'job_subjects', 'applications', 'demo_requests'
  ];
begin
  for pol in
    select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and cmd <> 'SELECT'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%is_admin_writer()%'
      and not (tablename = any (partner_tables))
  loop
    new_qual := replace(pol.qual, 'is_admin_writer()', 'is_admin_full_writer()');
    new_check := replace(pol.with_check, 'is_admin_writer()', 'is_admin_full_writer()');

    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    sql := format(
      'create policy %I on %I.%I as %s for %s to %s',
      pol.policyname, pol.schemaname, pol.tablename, pol.permissive, pol.cmd,
      array_to_string(pol.roles, ', ')
    );
    if new_qual is not null then sql := sql || ' using (' || new_qual || ')'; end if;
    if new_check is not null then sql := sql || ' with check (' || new_check || ')'; end if;
    execute sql;
  end loop;
end
$$;

-- storage: the ads and blog buckets are view-only areas for a Partner.
do $$
declare
  pol record;
  needle constant text := '(p.role = ''admin''::user_role)';
  repl constant text := '((p.role = ''admin''::user_role) AND (p.admin_role IS DISTINCT FROM ''partner''::text))';
  sql text;
begin
  for pol in
    select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
    from pg_policies
    where schemaname = 'storage'
      and cmd <> 'SELECT'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%' || needle || '%'
      and (coalesce(qual, '') || coalesce(with_check, '')) not like '%partner%'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'bucket_id = ''(ads|blog)'''
  loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    sql := format(
      'create policy %I on %I.%I as %s for %s to %s',
      pol.policyname, pol.schemaname, pol.tablename, pol.permissive, pol.cmd,
      array_to_string(pol.roles, ', ')
    );
    if pol.qual is not null then sql := sql || ' using (' || replace(pol.qual, needle, repl) || ')'; end if;
    if pol.with_check is not null then sql := sql || ' with check (' || replace(pol.with_check, needle, repl) || ')'; end if;
    execute sql;
  end loop;
end
$$;

-- 2. one-time emails, sent once.
create table if not exists public.one_off_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email_key text not null,
  sent_at timestamptz not null default now(),
  unique (user_id, email_key)
);

alter table public.one_off_emails enable row level security;

drop policy if exists one_off_emails_admin_read on public.one_off_emails;
create policy one_off_emails_admin_read on public.one_off_emails
  for select to authenticated using (public.is_admin());
