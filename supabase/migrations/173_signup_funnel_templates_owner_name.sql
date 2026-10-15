-- 173_signup_funnel_templates_owner_name.sql  (owner, 15 Oct 2026)
--
-- Sign-up leaks PR. Additive and idempotent; nothing is deleted.
--
-- 1. site_visit_counts — the daily sign-up funnel on Admin → Overview counts
--    public page visits (real browsers only), visits to /register and sign-up
--    forms submitted. COUNTS ONLY: one row per Pakistan-time day per kind, no
--    visitor id, no IP, no personal data. Written only by the server through
--    bump_site_visit() (service role); staff read it.
-- 2. member_follow_ups.source may also be 'documents' — the "Send WhatsApp"
--    after a tutor's documents are approved is logged like other follow-ups.
-- 3. Two WhatsApp templates in Team inbox → Templates, chosen automatically by
--    whether the Verification Fee is paid: documents_approved (fee not paid) and
--    documents_approved_paid (fee paid, profile live). English only; no amount.
-- 4. The Owner account's display name "Admin" becomes "Alee Sabeer" (email and
--    login unchanged).

-- 1 -----------------------------------------------------------------------
create table if not exists public.site_visit_counts (
  day        date   not null,
  kind       text   not null check (kind in ('public_page', 'register_page', 'signup_tutor', 'signup_parent')),
  count      bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, kind)
);

alter table public.site_visit_counts enable row level security;

drop policy if exists site_visit_counts_admin_read on public.site_visit_counts;
create policy site_visit_counts_admin_read on public.site_visit_counts
  for select using (public.is_admin());

create or replace function public.bump_site_visit(p_kind text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.site_visit_counts (day, kind, count, updated_at)
  values ((now() at time zone 'Asia/Karachi')::date, p_kind, 1, now())
  on conflict (day, kind) do update
    set count = public.site_visit_counts.count + 1, updated_at = now();
$$;

revoke all on function public.bump_site_visit(text) from public;
revoke all on function public.bump_site_visit(text) from anon, authenticated;
grant execute on function public.bump_site_visit(text) to service_role;

-- 2 -----------------------------------------------------------------------
alter table public.member_follow_ups drop constraint if exists member_follow_ups_source_check;
alter table public.member_follow_ups
  add constraint member_follow_ups_source_check check (source in ('stuck', 'unpaid', 'abandoned', 'documents'));

-- 3 -----------------------------------------------------------------------
insert into public.admin_message_templates (key, title, subject, body) values
  ('documents_approved', 'Documents approved — fee not paid', 'Your documents are approved',
   E'Assalam o Alaikum {name}, your documents on TutorMint are approved ✅. One step left to get your Verified badge and appear to parents: pay the Verification Fee here: {pay_link}. Need help? WhatsApp 0321 5872222. — TutorMint'),
  ('documents_approved_paid', 'Documents approved — profile live', 'Your documents are approved',
   E'Assalam o Alaikum {name}, your documents on TutorMint are approved ✅ and your profile is now live — parents can find you here: {profile_link}. Need help? WhatsApp 0321 5872222. — TutorMint')
on conflict (key) do nothing;

-- 4 -----------------------------------------------------------------------
update public.profiles
   set full_name = 'Alee Sabeer'
 where role = 'admin' and admin_role = 'owner' and full_name = 'Admin';

update auth.users u
   set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', 'Alee Sabeer')
  from public.profiles p
 where p.id = u.id and p.role = 'admin' and p.admin_role = 'owner'
   and coalesce(u.raw_user_meta_data ->> 'full_name', 'Admin') = 'Admin';
