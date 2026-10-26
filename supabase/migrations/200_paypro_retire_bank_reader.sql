-- 200_paypro_retire_bank_reader.sql — PayPro retired, copyable bank details,
-- the Faysal Bank email reader (owner, 26 Oct 2026).
--
-- Additive only. Nothing is deleted; no existing payment, refund, fee or report
-- row changes.
--
--   1. app_settings 'pay.paypro.cutoff' — the last day (Pakistan time) a PayPro
--      order started before the retirement may still activate. Seeded once to
--      2026-11-25 (30 days after the deploy); never overwritten here.
--      app_settings 'pay.raast_id' — an optional Raast ID shown on the bank
--      panel; seeded empty (hidden until the Owner fills it in).
--   2. finance_alerts — items the Owner must look at under Finance → Needs
--      attention: a late PayPro callback after the cut-off, a bank email that
--      could not be read or verified, a mailbox that is not bank-only, an
--      unclear email match, the reader failing. Never a message body, never an
--      account number, email address or phone number. Admin-read RLS; written
--      only by the server (service role).
--   3. bank_reader_state — one row: the Owner's on/off switch (OFF), status,
--      last run, last success, the last error. Admin-read RLS; server writes.
--   4. bank_transfers — a credit may now come from an email ('email'); it gains
--      channel (raast | ibft) and message_id (the email's Message-ID, unique),
--      so an email is never added twice. Existing rows keep source manual/csv.

-- 1 ------------------------------------------------------------------------
insert into public.app_settings (key, value)
values ('pay.paypro.cutoff', '2026-11-25')
on conflict (key) do nothing;

insert into public.app_settings (key, value)
values ('pay.raast_id', '')
on conflict (key) do nothing;

-- 2 ------------------------------------------------------------------------
create table if not exists public.finance_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in (
    'paypro_late', 'email_unreadable', 'email_unverified', 'mailbox_locked',
    'email_unclear', 'reader_failing'
  )),
  -- A stable key so the same thing is recorded once (an order number, a
  -- Message-ID, 'reader').
  ref text not null,
  title text not null,
  detail text,
  amount_pkr numeric,
  happened_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);

create unique index if not exists finance_alerts_kind_ref_uidx on public.finance_alerts (kind, ref);
create index if not exists finance_alerts_open_idx on public.finance_alerts (created_at desc) where resolved_at is null;

alter table public.finance_alerts enable row level security;
drop policy if exists finance_alerts_admin_read on public.finance_alerts;
create policy finance_alerts_admin_read on public.finance_alerts for select to authenticated using (public.is_admin());

-- 3 ------------------------------------------------------------------------
create table if not exists public.bank_reader_state (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  status text not null default 'off' check (status in ('off', 'running', 'locked', 'error')),
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  error_since timestamptz,
  backfill_done boolean not null default false,
  emails_read int not null default 0,
  credits_added int not null default 0,
  ignored_count int not null default 0,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.bank_reader_state (id) values (1) on conflict (id) do nothing;

alter table public.bank_reader_state enable row level security;
drop policy if exists bank_reader_state_admin_read on public.bank_reader_state;
create policy bank_reader_state_admin_read on public.bank_reader_state for select to authenticated using (public.is_admin());

-- 4 ------------------------------------------------------------------------
alter table public.bank_transfers drop constraint if exists bank_transfers_source_check;
alter table public.bank_transfers
  add constraint bank_transfers_source_check check (source in ('manual', 'csv', 'email'));

alter table public.bank_transfers add column if not exists channel text;
alter table public.bank_transfers drop constraint if exists bank_transfers_channel_check;
alter table public.bank_transfers
  add constraint bank_transfers_channel_check check (channel is null or channel in ('raast', 'ibft'));

alter table public.bank_transfers add column if not exists message_id text;
create unique index if not exists bank_transfers_message_id_uidx
  on public.bank_transfers (message_id) where message_id is not null;

-- An email-sourced credit keys on the bank's own reference too.
create unique index if not exists bank_transfers_email_reference_uidx
  on public.bank_transfers (upper(btrim(reference))) where source = 'email';

comment on column public.bank_transfers.channel is 'raast | ibft — how the credit reached the bank (email-sourced credits).';
comment on column public.bank_transfers.message_id is 'The bank alert email''s Message-ID (email-sourced or email-linked credits). Never the body.';
