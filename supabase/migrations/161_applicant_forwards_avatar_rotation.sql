-- 161_applicant_forwards_avatar_rotation.sql  (owner, 10 Oct 2026)
--
-- Additive. Three staff-only tables and one message template. Nothing existing
-- changes shape. Admin-read RLS, service-role writes only (each API checks its
-- own SCREEN_ACCESS; the view-only Partner is refused by checkAdminRole).
--
-- 1. applicant_forwards — Marketplace → "Applicants to forward". Staff tell a
--    tuition's parent which PAID tutors applied or viewed the number; each
--    "Mark as forwarded" writes one row: when, who, the channel, and exactly
--    which tutors were included (so a later applicant is known to be new).
--
-- 2. applicant_forward_outcomes — what came of it: hired / demo arranged /
--    not interested / no answer, the tutor where one is named, an optional note.
--
-- 3. avatar_rotations — the DISPLAY rotation staff saved on a member's profile
--    photo. The uploaded file is never changed: the picture shown is a turned
--    COPY stored beside it, and this row remembers the rotation, the uploaded
--    original and the copy. A member's next upload simply replaces avatar_url,
--    after which this row no longer applies (rotated_url no longer matches).
--
-- Nothing in these tables is shown to tutors or parents.

create table if not exists public.applicant_forwards (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  channel     text not null check (channel in ('whatsapp', 'call', 'other')),
  tutor_ids   uuid[] not null default '{}',
  staff_id    uuid references auth.users(id) on delete set null,
  staff_email text,
  staff_name  text,
  created_at  timestamptz not null default now()
);
create index if not exists applicant_forwards_job_idx on public.applicant_forwards (job_id, created_at desc);

create table if not exists public.applicant_forward_outcomes (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  outcome     text not null check (outcome in ('hired', 'demo', 'not_interested', 'no_answer')),
  tutor_id    uuid references auth.users(id) on delete set null,
  note        text,
  staff_id    uuid references auth.users(id) on delete set null,
  staff_email text,
  staff_name  text,
  created_at  timestamptz not null default now()
);
create index if not exists applicant_forward_outcomes_job_idx on public.applicant_forward_outcomes (job_id, created_at desc);

create table if not exists public.avatar_rotations (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  rotation     smallint not null default 0 check (rotation in (0, 90, 180, 270)),
  original_url text not null,
  rotated_url  text,
  updated_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);

alter table public.applicant_forwards enable row level security;
alter table public.applicant_forward_outcomes enable row level security;
alter table public.avatar_rotations enable row level security;

drop policy if exists applicant_forwards_admin_read on public.applicant_forwards;
create policy applicant_forwards_admin_read on public.applicant_forwards
  for select using (public.is_admin());

drop policy if exists applicant_forward_outcomes_admin_read on public.applicant_forward_outcomes;
create policy applicant_forward_outcomes_admin_read on public.applicant_forward_outcomes
  for select using (public.is_admin());

drop policy if exists avatar_rotations_admin_read on public.avatar_rotations;
create policy avatar_rotations_admin_read on public.avatar_rotations
  for select using (public.is_admin());

-- The WhatsApp text staff send a parent. Placeholders: {parent_name},
-- {tuition_title}, {area}, {tutor_list} (one line per tutor: name and public
-- profile link — never a phone number). Editable with the other templates.
insert into public.admin_message_templates (key, title, subject, body) values
  ('applicants_forward', 'Applicants to forward', 'Tutors interested in your tuition',
   E'Assalam o Alaikum {parent_name}, this is TutorMint about your tuition: {tuition_title} ({area}). These verified tutors are interested:\n{tutor_list}\nReply here if you''d like a demo lesson with any of them.')
on conflict (key) do nothing;
