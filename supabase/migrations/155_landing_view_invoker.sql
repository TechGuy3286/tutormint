-- 155_landing_view_invoker.sql (owner, 8 Oct 2026)
--
-- Migration 154's CREATE OR REPLACE VIEW landing_combinations reset the view's
-- options, dropping security_invoker (rls:audit caught it). Put it back, and
-- read the "posted by a test-named account" fact through a tiny SECURITY
-- DEFINER function, because under security_invoker an anonymous reader cannot
-- see profiles (self-read only) and the NOT EXISTS would silently never match.

begin;

create or replace function public.is_test_account(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_test_name from public.profiles p where p.id = uid), false)
$$;
revoke all on function public.is_test_account(uuid) from public;
grant execute on function public.is_test_account(uuid) to anon, authenticated, service_role;

create or replace view public.landing_combinations
with (security_invoker = true) as
 SELECT 'tutors'::text AS kind,
    td.city,
    ts.master_id,
    (count(DISTINCT td.id))::integer AS n
   FROM (tutor_directory td
     JOIN tutor_subjects ts ON ((ts.tutor_id = td.id)))
  WHERE ((td.city IS NOT NULL) AND (btrim(td.city) <> ''::text))
  GROUP BY td.city, ts.master_id
UNION ALL
 SELECT 'tuitions'::text AS kind,
    j.city,
    js.master_id,
    (count(DISTINCT j.id))::integer AS n
   FROM (jobs j
     JOIN job_subjects js ON ((js.job_id = j.id)))
  WHERE ((j.status = 'open'::text) AND (j.city IS NOT NULL) AND (btrim(j.city) <> ''::text)
    AND NOT public.is_test_account(j.parent_id))
  GROUP BY j.city, js.master_id;

commit;
