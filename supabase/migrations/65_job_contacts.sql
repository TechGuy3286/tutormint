-- 65_job_contacts.sql
--
-- Real parent contact for admin-posted (seeded) tuitions (owner, 9 Sep 2026).
--
-- WHY A SEPARATE TABLE, not columns on `jobs`. `jobs` has a PUBLIC row-read
-- policy (jobs_public_read_open: status='open' OR owner OR admin), and RLS
-- controls rows, not columns — so a contact number stored on the jobs row would
-- be readable by the anon key the moment any query selected it, and one
-- `select('*')` anywhere would publish a real person's phone number on a public,
-- indexable page. That is the exact thing the owner requires never happens
-- ("never shown to another parent, never indexed, never in structured data, OG
-- or sitemap"). A dedicated 1:1 table, admin-read-only and service-role-written,
-- makes the guarantee hold BY CONSTRUCTION: the contact never touches the
-- anon-readable jobs feed, so it cannot leak into a card, JSON-LD, OG image or
-- the sitemap. It is still "stored with the job, not on a profile" — keyed by
-- job_id, cascading with the job — which is the owner's distinction (these
-- parents have no account).
--
-- Read only via the service role (the tutor-facing block on the job page, and
-- the admin job screen). No anon read, no member read.

create table if not exists public.job_contacts (
  job_id       uuid primary key references public.jobs(id) on delete cascade,
  contact_name text,
  contact_phone text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.job_contacts enable row level security;

-- Admins may read (the admin job screen). Nobody else — no anon, no member.
-- Writes are service-role only (createTeamJob), which bypasses RLS; there is
-- deliberately no insert/update/delete policy.
drop policy if exists job_contacts_admin_read on public.job_contacts;
create policy job_contacts_admin_read on public.job_contacts
  for select using (public.is_admin());

-- The WhatsApp "your tuition is live" outreach template (owner). No promise of a
-- tutor, an outcome or a timeframe; no price. {name} and {tuition_url} fill at
-- send. Editable afterwards in the Team-inbox template editor like any other.
insert into public.admin_message_templates (key, title, subject, body) values
  ('seeded_tuition_live', 'Seeded tuition — live', 'Your tuition is live on TutorMint',
   'Hi {name}, your tuition is now live on TutorMint and verified tutors browsing the site can see it here: {tuition_url}. If you would like to post and manage your own tuitions next time, you can create a free account at tutormint.org.')
on conflict (key) do nothing;
