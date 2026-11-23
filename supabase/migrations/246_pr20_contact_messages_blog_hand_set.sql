-- 246_pr20_contact_messages_blog_hand_set.sql (owner, 24 Nov 2026 — PR-20)
--
-- A. contact_messages — the /contact form. Each message lands in the Team inbox
--    (Admin → Team inbox → Contact form) and is emailed to support. Service
--    role only (RLS on, no policies): the public form writes through
--    /api/contact, staff read through the admin pages. The sender's mobile or
--    email is shown masked in the inbox with a logged Show. Never in a log.
--    No IP is stored here (the rate limit counts by IP in its own table).
--
-- B. posts.hand_set — the blog editor's settings staff changed by hand
--    (cluster, audience, language, city, subject, related, coverAlt); auto-fill
--    from the title never overwrites these.
--
-- Additive and re-runnable; no begin/commit (the apply script wraps it).

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 80),
  contact text not null check (char_length(contact) between 3 and 120),
  contact_kind text not null check (contact_kind in ('mobile', 'email')),
  message text not null check (char_length(message) between 1 and 2000),
  member_id uuid references public.profiles(id) on delete set null,
  status text not null default 'new' check (status in ('new', 'done')),
  done_at timestamptz,
  done_by uuid references public.profiles(id) on delete set null,
  emailed boolean not null default false
);

create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);
create index if not exists contact_messages_new_idx on public.contact_messages (created_at desc) where status = 'new';

alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon, authenticated;

alter table public.posts add column if not exists hand_set text[] not null default '{}';
