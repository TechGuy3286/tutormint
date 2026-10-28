-- 212_template_review.sql — the simple-English template rewrite, reviewed by
-- the Owner (owner, 28 Oct 2026).
--
-- The proposed wording itself lives in code (lib/templateProposals.ts,
-- lib/notify/emailWordingCore.ts). Nothing goes live until the Owner approves
-- it in Team inbox → Templates → Review new wording. These three tables hold
-- what the Owner decided and what was replaced:
--
--   template_reviews   one row per template the Owner decided on: 'approved'
--                      (the proposed or edited wording went live) or 'kept'
--                      (the live wording stays). No row = not reviewed yet.
--   template_history   the wording that was REPLACED, every time a template's
--                      live wording changes here (approve, restore). Nothing is
--                      deleted; Restore puts a row back. body null = the
--                      built-in wording of an email (no stored wording).
--   email_wordings     the live wording of an approved email; no row = the
--                      built-in email of lib/notify/templates.ts.
--
-- Admin-read RLS, service-role writes only (no write policy). Additive and
-- re-runnable; no existing row is changed.

create table if not exists public.template_reviews (
  key text primary key,
  status text not null check (status in ('approved', 'kept')),
  edited boolean not null default false,
  decided_by uuid references auth.users(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz not null default now()
);

create table if not exists public.template_history (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  kind text not null check (kind in ('whatsapp', 'team', 'email')),
  subject text,
  body text,
  action text not null check (action in ('approve', 'restore', 'edit')),
  saved_by uuid references auth.users(id) on delete set null,
  saved_by_name text,
  saved_at timestamptz not null default now()
);
create index if not exists template_history_key_idx on public.template_history (key, saved_at desc);

create table if not exists public.email_wordings (
  variant text primary key,
  subject text not null,
  body text not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.template_reviews enable row level security;
alter table public.template_history enable row level security;
alter table public.email_wordings enable row level security;

drop policy if exists template_reviews_admin_read on public.template_reviews;
create policy template_reviews_admin_read on public.template_reviews for select to authenticated using (public.is_admin());
drop policy if exists template_history_admin_read on public.template_history;
create policy template_history_admin_read on public.template_history for select to authenticated using (public.is_admin());
drop policy if exists email_wordings_admin_read on public.email_wordings;
create policy email_wordings_admin_read on public.email_wordings for select to authenticated using (public.is_admin());
