-- 149_unpaid_contacts_featured_wa_urdu_subjects.sql (owner, 8 Oct 2026)
--
-- ADDITIVE ONLY. Nothing existing changes meaning and nothing is deleted.
--
-- 1. taxonomy_subjects.name_ur — a short Urdu name per subject, shown under the
--    English name on the onboarding subject chips and editable in Admin →
--    Settings → Subjects. Seeded for the 13 subjects that are a MAIN subject at
--    any live level (taxonomy_master.is_core); every other subject stays NULL
--    and shows English only. Only rows still NULL are filled, so a re-run never
--    overwrites an admin's edit.
-- 2. tutor_contact_logs — staff call/WhatsApp outcomes for the Unpaid signups
--    tab (Admin → People). One row per contact attempt; admin-read; written by
--    the server only (service role).
-- 3. featured_whatsapp_sends — one row per (Featured tutor, tuition) sent on
--    WhatsApp from Admin → People → Featured WhatsApp. The UNIQUE pair is what
--    stops a tuition being sent twice, and two staff sending the same batch:
--    the second insert conflicts. Admin-read; written by the server only.

alter table public.taxonomy_subjects
  add column if not exists name_ur text;

update public.taxonomy_subjects s set name_ur = v.ur
from (values
  ('biology', 'حیاتیات'),
  ('chemistry', 'کیمیا'),
  ('computer-science', 'کمپیوٹر سائنس'),
  ('english', 'انگریزی'),
  ('general-knowledge', 'معلوماتِ عامہ'),
  ('general-science', 'جنرل سائنس'),
  ('islamiat-islamic-studies', 'اسلامیات'),
  ('mathematics', 'ریاضی'),
  ('pakistan-studies', 'مطالعۂ پاکستان'),
  ('phonics', 'فونکس'),
  ('physics', 'طبیعیات'),
  ('social-studies', 'معاشرتی علوم'),
  ('urdu', 'اردو')
) as v(slug, ur)
where s.slug = v.slug and s.name_ur is null;

create table if not exists public.tutor_contact_logs (
  id          uuid primary key default gen_random_uuid(),
  tutor_id    uuid not null references public.profiles(id) on delete cascade,
  outcome     text not null check (outcome in ('called', 'no_answer', 'needs_help', 'will_pay_later', 'not_interested')),
  note        text check (note is null or char_length(note) <= 1000),
  staff_id    uuid references auth.users(id) on delete set null,
  staff_email text,
  created_at  timestamptz not null default now()
);

create index if not exists tutor_contact_logs_tutor_idx
  on public.tutor_contact_logs (tutor_id, created_at desc);

alter table public.tutor_contact_logs enable row level security;

drop policy if exists tutor_contact_logs_admin_read on public.tutor_contact_logs;
create policy tutor_contact_logs_admin_read on public.tutor_contact_logs
  for select using (public.is_admin());

create table if not exists public.featured_whatsapp_sends (
  id          uuid primary key default gen_random_uuid(),
  tutor_id    uuid not null references public.profiles(id) on delete cascade,
  job_id      uuid not null references public.jobs(id) on delete cascade,
  sent_by     uuid references auth.users(id) on delete set null,
  sent_by_email text,
  sent_at     timestamptz not null default now(),
  unique (tutor_id, job_id)
);

create index if not exists featured_whatsapp_sends_tutor_idx
  on public.featured_whatsapp_sends (tutor_id, sent_at desc);

alter table public.featured_whatsapp_sends enable row level security;

drop policy if exists featured_whatsapp_sends_admin_read on public.featured_whatsapp_sends;
create policy featured_whatsapp_sends_admin_read on public.featured_whatsapp_sends
  for select using (public.is_admin());
