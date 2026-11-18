-- 236 — CNIC address suggestions and "sent to the parent" alerts (owner, 18 Nov 2026 — PR-07).
--
-- 1. user_documents.address_read_at — the CNIC BACK's address was read (or a
--    read is in flight). One read per uploaded image: a finished read keeps the
--    stamp, a failed one clears it so it can be tried again. No address is ever
--    stored on the document row.
--
-- 2. address_suggestions — the home address read from a member's CNIC back, as
--    a SUGGESTION. One row per member. profiles.address is never written from
--    here: the member's own Confirm or Edit (Settings → Home address) writes it,
--    through the same member save as typing it. An address the member already
--    entered is never touched: no suggestion is made for them.
--      status  unconfirmed  read, waiting for the member
--              confirmed    the member pressed Confirm
--              edited       the member changed it and saved
--              superseded   the member saved an address another way first
--    Staff see it masked, with a logged Show (address.reveal). Never public.
--
-- 3. application_forward_alerts — the first time staff forwarded an
--    application to the parent (Forward to parents, or the Applied message).
--    One row per application, so the tutor's "Your application was sent to the
--    parent" alert goes once. `notified` = the bell alert went (eligible paid
--    tutor). The Applied message's Undo stamps undone_at, which takes it out of
--    the WhatsApp updates queue.
--
-- 4. whatsapp_update_sends.forwarded_application_ids — which forwards a
--    WhatsApp update carried (kept apart from the opened ones, so a parent
--    opening the same application later is still news).
--
-- Additive and re-runnable. Both new tables: RLS on, no policy, no client grant
-- (service role only — read on the server behind the session or the role check).

alter table public.user_documents add column if not exists address_read_at timestamptz;

comment on column public.user_documents.address_read_at is
  'PR-07: the CNIC back''s address was read (or is being read). No address is stored on the document.';

create table if not exists public.address_suggestions (
  user_id uuid primary key references public.profiles (id),
  document_id uuid references public.user_documents (id),
  address text not null,
  city text not null,
  status text not null default 'unconfirmed'
    check (status in ('unconfirmed', 'confirmed', 'edited', 'superseded')),
  source text not null default 'upload' check (source in ('upload', 'backfill')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

comment on table public.address_suggestions is
  'PR-07: home address read from the member''s CNIC back — a suggestion until the member confirms or edits it. Staff-only, masked with a logged Show. Never public.';

create index if not exists address_suggestions_status_idx on public.address_suggestions (status);

alter table public.address_suggestions enable row level security;
revoke all on public.address_suggestions from anon, authenticated;

create table if not exists public.application_forward_alerts (
  application_id uuid primary key references public.applications (id),
  tutor_id uuid not null references public.profiles (id),
  job_id uuid not null references public.jobs (id),
  forwarded_at timestamptz not null default now(),
  notified boolean not null default false,
  undone_at timestamptz
);

comment on table public.application_forward_alerts is
  'PR-07: first forward of an application to the parent — drives the once-only "sent to the parent" alert and the WhatsApp updates item.';

create index if not exists application_forward_alerts_at_idx on public.application_forward_alerts (forwarded_at desc);

alter table public.application_forward_alerts enable row level security;
revoke all on public.application_forward_alerts from anon, authenticated;

alter table public.whatsapp_update_sends add column if not exists forwarded_application_ids uuid[] not null default '{}';
