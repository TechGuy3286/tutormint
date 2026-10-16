-- 182_my_signups_location_run_review.sql (owner, 16 Oct 2026)
--
-- 1. "My sign-ups": every staff member reads ONLY the sign-ups credited to them.
--    The four sign-up tables (migration 175) had one policy each, staff read
--    (is_admin()), so any staff token could read every colleague's credits.
--    Each policy now admits a staff account for its OWN rows, and the Owner,
--    the Project Managers and Admin for every row (the people who see everyone
--    on Team activity). Still no write policy: every write is the service role.
--
-- 2. Five plain-English WhatsApp templates for the "Next step for them" button
--    where no existing template fits. Existing templates are not touched.
--
-- 3. location_run_reviews: the Owner's decision on each row the 16 Oct
--    "Approve all suggestions" run wrote (an added area, a "same as" spelling,
--    a "Not an area" value). One row per item, overwritten by a later decision
--    (every decision is also in admin_audit_log). Admin read; service-role writes.
--
-- Additive except for the four policy swaps. No data row changes.

create or replace function public.sees_all_staff_signups()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role = 'admin'
       and p.admin_role in ('owner', 'partner', 'admin')
       and not coalesce(p.is_suspended, false)
  )
$fn$;
revoke all on function public.sees_all_staff_signups() from public;
grant execute on function public.sees_all_staff_signups() to authenticated, service_role;

drop policy if exists staff_signup_credits_admin_read on public.staff_signup_credits;
drop policy if exists staff_signup_credits_own_read on public.staff_signup_credits;
create policy staff_signup_credits_own_read on public.staff_signup_credits
  for select to authenticated
  using (public.is_admin() and (staff_id = auth.uid() or public.sees_all_staff_signups()));

drop policy if exists staff_signup_claims_admin_read on public.staff_signup_claims;
drop policy if exists staff_signup_claims_own_read on public.staff_signup_claims;
create policy staff_signup_claims_own_read on public.staff_signup_claims
  for select to authenticated
  using (public.is_admin() and (staff_id = auth.uid() or public.sees_all_staff_signups()));

drop policy if exists staff_join_links_admin_read on public.staff_join_links;
drop policy if exists staff_join_links_own_read on public.staff_join_links;
create policy staff_join_links_own_read on public.staff_join_links
  for select to authenticated
  using (public.is_admin() and (staff_id = auth.uid() or public.sees_all_staff_signups()));

drop policy if exists staff_referral_visits_admin_read on public.staff_referral_visits;
drop policy if exists staff_referral_visits_own_read on public.staff_referral_visits;
create policy staff_referral_visits_own_read on public.staff_referral_visits
  for select to authenticated
  using (public.is_admin() and (staff_id = auth.uid() or public.sees_all_staff_signups()));

insert into public.admin_message_templates (key, title, subject, body) values
  ('my_signup_upload_documents', 'My sign-ups — upload documents', 'Upload your documents',
   'Hi {name}, this is TutorMint. You are nearly there — please upload your CNIC, profile photo and selfie so we can check your profile. You can do it here: {link}'),
  ('my_signup_pay_fee', 'My sign-ups — pay the Verification Fee', 'One step left to get verified',
   'Hi {name}, this is TutorMint. Your profile is ready. The last step to get your Verified badge and appear to parents is the Verification Fee. You can pay it here: {link}'),
  ('my_signup_post_tuition', 'My sign-ups — post a tuition', 'Post your tuition',
   'Hi {name}, this is TutorMint. Your account is ready. Post your tuition here and verified tutors near you can see it: {link}'),
  ('my_signup_buy_plan', 'My sign-ups — buy a plan', 'Hire a tutor directly',
   'Hi {name}, this is TutorMint. Thank you for posting your tuition. With a plan you can see tutors'' contact numbers and hire directly. See the plans here: {link}'),
  ('my_signup_check_in', 'My sign-ups — check in', 'Welcome to TutorMint',
   'Hi {name}, this is TutorMint. Thank you for joining. If you need any help, just reply here: {link}')
on conflict (key) do nothing;

create table if not exists public.location_run_reviews (
  id bigserial primary key,
  kind text not null check (kind in ('area', 'alias', 'ignored')),
  ref_id bigint not null,
  decision text not null check (decision in ('keep', 'merge', 'split', 'not_area', 'actually_area', 'same_as', 'rematch')),
  detail jsonb not null default '{}'::jsonb,
  decided_by uuid references auth.users (id),
  decided_at timestamptz not null default now(),
  unique (kind, ref_id)
);
alter table public.location_run_reviews enable row level security;
drop policy if exists location_run_reviews_admin_read on public.location_run_reviews;
create policy location_run_reviews_admin_read on public.location_run_reviews
  for select to authenticated using (public.is_admin());
