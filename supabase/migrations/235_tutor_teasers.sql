-- 235 — paid-tutor teasers and the WhatsApp updates queue (owner, 18 Nov 2026 — PR-06).
--
-- 1. tutor_profiles.whatsapp_updates — "Send me updates on WhatsApp" on the
--    tutor's Edit Profile. Default ON (every existing tutor starts opted in, as
--    the owner asked). Off = out of the staff WhatsApp updates queue; the
--    in-app teasers still show. Written only by /api/tutor/whatsapp-updates
--    (service role), which logs the change.
--
-- 2. application_parent_views — the first time a tuition's own parent opened
--    their tuition page and saw an application on it. One row per application,
--    nothing else: no parent id (the application's job already names its
--    parent), no IP, no device. It drives the instant "A parent opened your
--    application" alert and the WhatsApp queue.
--
-- 3. whatsapp_update_sends — every "Send" on Admin → People → WhatsApp updates:
--    which tutor, the Pakistan day, what the message carried, who sent it and
--    when. Undo stamps undone_at / undone_by; nothing is ever deleted.
--
-- Additive and re-runnable. Both new tables: RLS on, no policy, no client grant
-- (service role only — read on the server behind the screen role check).

alter table public.tutor_profiles add column if not exists whatsapp_updates boolean not null default true;

comment on column public.tutor_profiles.whatsapp_updates is
  'PR-06: "Send me updates on WhatsApp" (default on). Off = never in the staff WhatsApp updates queue; in-app teasers still show.';

create table if not exists public.application_parent_views (
  application_id uuid primary key references public.applications (id),
  first_seen_at timestamptz not null default now()
);

comment on table public.application_parent_views is
  'PR-06: first time the tuition''s own parent opened their tuition page showing this application. No parent id, IP or device.';

create index if not exists application_parent_views_seen_idx on public.application_parent_views (first_seen_at desc);

alter table public.application_parent_views enable row level security;
revoke all on public.application_parent_views from anon, authenticated;

create table if not exists public.whatsapp_update_sends (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.profiles (id),
  pk_day date not null,
  kinds text[] not null default '{}',
  application_ids uuid[] not null default '{}',
  staff_id uuid references auth.users (id) on delete set null,
  staff_name text,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references auth.users (id) on delete set null
);

comment on table public.whatsapp_update_sends is
  'PR-06: staff WhatsApp update sends (People → WhatsApp updates). Undo stamps undone_at; never deleted.';

create index if not exists whatsapp_update_sends_tutor_idx on public.whatsapp_update_sends (tutor_id, created_at desc);
create index if not exists whatsapp_update_sends_day_idx on public.whatsapp_update_sends (pk_day);

alter table public.whatsapp_update_sends enable row level security;
revoke all on public.whatsapp_update_sends from anon, authenticated;
