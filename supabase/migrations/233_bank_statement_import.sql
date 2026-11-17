-- 233_bank_statement_import.sql (owner, 17 Nov 2026 — PR-03)
--
-- Faysal Bank statement import. The bank portal exports only the account
-- statement (an ".xls" that is an HTML table). The Owner uploads it on
-- Finance → Import bank statement; each transaction is stored ONCE, keyed by
-- the bank's Tran Seq No, so an overlapping date range can be imported again
-- safely.
--
--   bank_statement_imports — one row per upload: counts and totals only.
--   bank_statement_rows    — one row per bank transaction. OWNER ONLY: RLS on,
--                            no permissive policy, so only the service role
--                            reads it; the Owner (and the view-only Partner)
--                            see it through a server route. Account and mobile
--                            numbers are shown masked; a reveal is logged.
--   bank_transfers         — every statement CREDIT becomes (or is linked to)
--                            one bank credit, source 'statement', so the
--                            existing matching, Finance totals and personal
--                            marks work on it unchanged.
--   payments               — Reopen (a rejected receipt back to waiting) and
--                            the 10-second Undo after Approve / Reject are
--                            stamped here. Nothing is deleted.
--
-- Additive and re-runnable.

create table if not exists public.bank_statement_imports (
  id                        uuid primary key default gen_random_uuid(),
  filename                  text,
  uploaded_by               uuid references auth.users (id) on delete set null,
  uploaded_by_name          text,
  created_at                timestamptz not null default now(),
  period_from               date,
  period_to                 date,
  rows_total                int not null default 0,
  rows_new                  int not null default 0,
  rows_duplicate            int not null default 0,
  total_credits             numeric not null default 0,
  total_debits              numeric not null default 0,
  opening_balance           numeric,
  closing_balance_file      numeric,
  closing_balance_computed  numeric,
  credits_added             int not null default 0,
  credits_linked            int not null default 0,
  credits_unclear           int not null default 0
);

create table if not exists public.bank_statement_rows (
  id                      uuid primary key default gen_random_uuid(),
  import_id               uuid references public.bank_statement_imports (id) on delete set null,
  tran_seq_no             text not null,
  serial_no               int,
  tran_date               date not null,
  effect_date             date,
  tran_time               time,
  tran_type               text,
  description             text,
  stan                    text,
  debit_credit            text check (debit_credit is null or debit_credit in ('D', 'C')),
  reference               text,
  withdrawal              numeric not null default 0,
  deposit                 numeric not null default 0,
  balance                 numeric,
  ref_bank                text,
  time_stamp              text,
  transfer_account_no     text,
  transfer_account_title  text,
  contra_account          text,
  sender_name             text,
  sender_bank             text,
  account_last4           text check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  class_auto              text not null check (class_auto in ('fee', 'paypro', 'other_credit', 'debit')),
  class                   text not null check (class in ('fee', 'paypro', 'other_credit', 'debit')),
  class_prev              text check (class_prev is null or class_prev in ('fee', 'paypro', 'other_credit', 'debit')),
  class_gateway_prev      text,
  class_changed_at        timestamptz,
  class_changed_by        uuid references auth.users (id) on delete set null,
  transfer_id             uuid references public.bank_transfers (id) on delete set null,
  transfer_how            text check (transfer_how is null or transfer_how in ('added', 'linked', 'unclear')),
  personal_at             timestamptz,
  personal_by             uuid references auth.users (id) on delete set null,
  personal_by_name        text,
  personal_note           text,
  personal_undone_at      timestamptz,
  personal_undone_by      uuid references auth.users (id) on delete set null,
  -- The automatic match (lib/bankStatementCore matchFeeCredits), refreshed
  -- after every import and every 5 minutes: 'receipt' (a pending receipt —
  -- "Bank-matched"), 'approved' (an approved payment with no credit), 'member'
  -- (paid in bank, not recorded), 'unmatched', 'settled'.
  match_kind              text check (match_kind is null or match_kind in ('settled', 'receipt', 'approved', 'member', 'unmatched')),
  match_payment_id        uuid,
  match_member_id         uuid,
  match_reason            text,
  match_note              text,
  matched_at              timestamptz,
  created_at              timestamptz not null default now(),
  constraint bank_statement_rows_personal_note_check
    check (personal_at is null or (personal_note is not null and length(btrim(personal_note)) >= 3))
);

create unique index if not exists bank_statement_rows_seq_uidx on public.bank_statement_rows (tran_seq_no);
create index if not exists bank_statement_rows_date_idx on public.bank_statement_rows (tran_date);
create index if not exists bank_statement_rows_transfer_idx on public.bank_statement_rows (transfer_id);
create index if not exists bank_statement_rows_match_payment_idx on public.bank_statement_rows (match_payment_id) where match_payment_id is not null;

comment on table public.bank_statement_rows is
  'Faysal Bank statement transactions (PR-03). Owner only: service role reads; one row per Tran Seq No.';

-- Owner only: RLS on, NO policy, and no grant to anon or authenticated — only
-- the service role reads or writes (so no view-as policy is needed either).
alter table public.bank_statement_imports enable row level security;
alter table public.bank_statement_rows enable row level security;
revoke all on public.bank_statement_imports from anon, authenticated;
revoke all on public.bank_statement_rows from anon, authenticated;

-- bank_transfers: a credit may come from the statement.
alter table public.bank_transfers drop constraint if exists bank_transfers_source_check;
alter table public.bank_transfers
  add constraint bank_transfers_source_check check (source in ('manual', 'csv', 'email', 'statement'));
alter table public.bank_transfers add column if not exists statement_row_id uuid;
create unique index if not exists bank_transfers_statement_row_uidx
  on public.bank_transfers (statement_row_id) where statement_row_id is not null;

-- payments: Reopen and the decision Undo.
alter table public.payments
  add column if not exists reopened_at        timestamptz,
  add column if not exists reopened_by        uuid references auth.users (id) on delete set null,
  add column if not exists reopen_reason      text,
  add column if not exists decision_undone_at timestamptz,
  add column if not exists decision_undone_by uuid references auth.users (id) on delete set null;
