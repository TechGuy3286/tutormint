-- 06_rls_policies.sql
-- RLS policies per CLAUDE.md. RLS itself is enabled in 01; this file only
-- adds policies. CREATE only -- existing policies are left alone.
--
-- Principles:
--   * A user reads and writes only their own rows.
--   * Verified tutor_profiles are readable by anyone (the public directory).
--   * Contact columns are never exposed through a public policy. RLS is
--     row-level, not column-level, so the public directory reads through the
--     public.tutor_directory view (below), which simply does not select
--     phone/whatsapp/email. Direct table access stays owner+admin only.
--   * Admin (profiles.role='admin') has full access.
--   * Legacy tables get SELECT-only policies so nothing new can write to them.
--
-- Idempotent: every policy is created only if absent.

begin;

-- Helper: is the current user an admin? SECURITY DEFINER so the policy can
-- read profiles without recursing through profiles' own RLS.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
$fn$;

create or replace function public.owns_thread(t uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.threads th
    where th.id = t and (th.participant_a = auth.uid() or th.participant_b = auth.uid())
  )
$fn$;

do $$
declare
  p record;
begin
  -- ==== helper to add a policy only when it is missing =====================
  -- (inlined below per policy; plpgsql has no macro facility)

  -- ---------------------------------------------------------------- profiles
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_self_read') then
    create policy profiles_self_read on public.profiles
      for select using (id = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_self_insert') then
    create policy profiles_self_insert on public.profiles
      for insert with check (id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_self_update') then
    create policy profiles_self_update on public.profiles
      for update using (id = auth.uid() or public.is_admin())
      with check (id = auth.uid() or public.is_admin());
  end if;

  -- ---------------------------------------------------------- tutor_profiles
  -- Owner and admin get the whole row (contact columns included).
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tutor_profiles' and policyname='tutor_profiles_owner_read') then
    create policy tutor_profiles_owner_read on public.tutor_profiles
      for select using (id = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tutor_profiles' and policyname='tutor_profiles_owner_write') then
    create policy tutor_profiles_owner_write on public.tutor_profiles
      for insert with check (id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tutor_profiles' and policyname='tutor_profiles_owner_update') then
    create policy tutor_profiles_owner_update on public.tutor_profiles
      for update using (id = auth.uid() or public.is_admin())
      with check (id = auth.uid() or public.is_admin());
  end if;

  -- ------------------------------------------------------------------- plans
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='plans' and policyname='plans_public_read') then
    create policy plans_public_read on public.plans for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='plans' and policyname='plans_admin_write') then
    create policy plans_admin_write on public.plans for all
      using (public.is_admin()) with check (public.is_admin());
  end if;

  -- ----------------------------------------------- subscriptions / payments
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='subscriptions' and policyname='subscriptions_self_read') then
    create policy subscriptions_self_read on public.subscriptions
      for select using (user_id = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='subscriptions' and policyname='subscriptions_admin_write') then
    create policy subscriptions_admin_write on public.subscriptions for all
      using (public.is_admin()) with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='payments' and policyname='payments_self_read') then
    create policy payments_self_read on public.payments
      for select using (user_id = auth.uid() or public.is_admin());
  end if;
  -- A user may submit their own payment claim; only an admin may approve it.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='payments' and policyname='payments_self_insert') then
    create policy payments_self_insert on public.payments
      for insert with check (user_id = auth.uid() and status = 'pending');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='payments' and policyname='payments_admin_update') then
    create policy payments_admin_update on public.payments
      for update using (public.is_admin()) with check (public.is_admin());
  end if;

  -- --------------------------------------------------------- usage_counters
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='usage_counters' and policyname='usage_counters_self_read') then
    create policy usage_counters_self_read on public.usage_counters
      for select using (user_id = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='usage_counters' and policyname='usage_counters_admin_write') then
    create policy usage_counters_admin_write on public.usage_counters for all
      using (public.is_admin()) with check (public.is_admin());
  end if;

  -- -------------------------------------------------------------------- jobs
  -- Open jobs are the public tuition board; the owner sees all of their own.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='jobs_public_read_open') then
    create policy jobs_public_read_open on public.jobs
      for select using (status = 'open' or parent_id = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='jobs_owner_insert') then
    create policy jobs_owner_insert on public.jobs
      for insert with check (parent_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='jobs_owner_update') then
    create policy jobs_owner_update on public.jobs
      for update using (parent_id = auth.uid() or public.is_admin())
      with check (parent_id = auth.uid() or public.is_admin());
  end if;

  -- ------------------------------------------------------------ applications
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='applications_participant_read') then
    create policy applications_participant_read on public.applications
      for select using (
        tutor_id = auth.uid()
        or exists (select 1 from public.jobs g where g.id = applications.job_id and g.parent_id = auth.uid())
        or public.is_admin()
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='applications_tutor_insert') then
    create policy applications_tutor_insert on public.applications
      for insert with check (tutor_id = auth.uid());
  end if;
  -- The job owner decides shortlist/hire/reject.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='applications_owner_update') then
    create policy applications_owner_update on public.applications
      for update using (
        exists (select 1 from public.jobs g where g.id = applications.job_id and g.parent_id = auth.uid())
        or public.is_admin()
      );
  end if;

  -- ------------------------------------------------------ threads / messages
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='threads' and policyname='threads_participant_read') then
    create policy threads_participant_read on public.threads
      for select using (participant_a = auth.uid() or participant_b = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='threads' and policyname='threads_participant_insert') then
    create policy threads_participant_insert on public.threads
      for insert with check (initiated_by = auth.uid()
                             and (participant_a = auth.uid() or participant_b = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='messages' and policyname='messages_participant_read') then
    create policy messages_participant_read on public.messages
      for select using (public.owns_thread(thread_id) or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='messages' and policyname='messages_participant_insert') then
    create policy messages_participant_insert on public.messages
      for insert with check (sender_id = auth.uid() and public.owns_thread(thread_id));
  end if;

  -- ----------------------------------------------------------------- reviews
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reviews' and policyname='reviews_public_read') then
    create policy reviews_public_read on public.reviews for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reviews' and policyname='reviews_author_insert') then
    create policy reviews_author_insert on public.reviews
      for insert with check (parent_id = auth.uid());
  end if;

  -- -------------------------------------------------- shortlists / demo_reqs
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='shortlists' and policyname='shortlists_self_all') then
    create policy shortlists_self_all on public.shortlists for all
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='demo_requests' and policyname='demo_requests_participant_read') then
    create policy demo_requests_participant_read on public.demo_requests
      for select using (parent_id = auth.uid() or tutor_id = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='demo_requests' and policyname='demo_requests_parent_insert') then
    create policy demo_requests_parent_insert on public.demo_requests
      for insert with check (parent_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='demo_requests' and policyname='demo_requests_participant_update') then
    create policy demo_requests_participant_update on public.demo_requests
      for update using (parent_id = auth.uid() or tutor_id = auth.uid() or public.is_admin());
  end if;

  -- --------------------------------------------- subject joins and taxonomy
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tutor_subjects' and policyname='tutor_subjects_public_read') then
    create policy tutor_subjects_public_read on public.tutor_subjects for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tutor_subjects' and policyname='tutor_subjects_owner_write') then
    create policy tutor_subjects_owner_write on public.tutor_subjects for all
      using (tutor_id = auth.uid() or public.is_admin())
      with check (tutor_id = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_subjects' and policyname='job_subjects_public_read') then
    create policy job_subjects_public_read on public.job_subjects for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_subjects' and policyname='job_subjects_owner_write') then
    create policy job_subjects_owner_write on public.job_subjects for all
      using (exists (select 1 from public.jobs g where g.id = job_subjects.job_id and g.parent_id = auth.uid())
             or public.is_admin())
      with check (exists (select 1 from public.jobs g where g.id = job_subjects.job_id and g.parent_id = auth.uid())
             or public.is_admin());
  end if;

  -- Taxonomy is reference data: world readable, admin writable.
  for p in select unnest(array['taxonomy_categories','taxonomy_levels','taxonomy_subjects','taxonomy_master']) as t
  loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=p.t and policyname=p.t||'_public_read') then
      execute format('create policy %I on public.%I for select using (true)', p.t||'_public_read', p.t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=p.t and policyname=p.t||'_admin_write') then
      execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', p.t||'_admin_write', p.t);
    end if;
  end loop;

  -- ---------------------------------------------------------- legacy tables
  -- SELECT-only, and only for admins, so nothing new can be written to them.
  -- They are renamed to legacy_* and dropped in T8.
  for p in select unnest(array[
      'tutors','parents','parent_profiles','parent_jobs','tuitions',
      'tutor_applications','tuition_applications','job_messages',
      'tutor_activities','tutor_trust_fees','tutor_slots','profile_views',
      'penalties_log','demo_feedback','advertisements','academy_affiliations',
      'user_blocks'
    ]) as t
  loop
    if to_regclass('public.'||p.t) is not null
       and not exists (select 1 from pg_policies where schemaname='public' and tablename=p.t and policyname=p.t||'_legacy_read_only') then
      execute format('create policy %I on public.%I for select using (public.is_admin())', p.t||'_legacy_read_only', p.t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Public tutor directory. RLS cannot hide individual columns, so the public
-- surface is this view, which never selects phone_number, whatsapp_number or
-- email. /browse/tutors reads this; the base table stays owner+admin only.
-- ---------------------------------------------------------------------------
create or replace view public.tutor_directory
with (security_invoker = false) as
select
  tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url,
  tp.subjects, tp.class_levels, tp.degrees, tp.teaching_mode,
  tp.online_platforms, tp.city, tp.area, tp.hourly_rate_pkr,
  tp.experience_years, tp.video_youtube_id, tp.video_status,
  tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured,
  tp.created_at
from public.tutor_profiles tp
where tp.verification_status = 'verified';

grant select on public.tutor_directory to anon, authenticated;

commit;
