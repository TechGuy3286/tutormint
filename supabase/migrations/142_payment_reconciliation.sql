-- 142_payment_reconciliation.sql
--
-- PayPro reconciliation (owner, 6 Oct 2026): Admin → Payments → Reconciliation.
--
-- The admin uploads PayPro's Orders export (xlsx or csv) and the bank statement
-- (csv, or a transfer typed by hand), and the screen compares them with our own
-- `payments` rows: PAID at PayPro but not approved here, approved here but not
-- PAID there, amounts that differ, and whether PayPro's settlements have actually
-- arrived in the bank.
--
-- WHAT IS STORED, AND WHAT IS NOT. Only the EIGHT PayPro columns the comparison
-- needs — Order-Number, Transaction Status, Payment Via, Order-Amount,
-- MerchantShare, Date Paid, Settle-Date, Settle-Status. PayPro's export also
-- carries the customer's name, mobile and email; those are NEVER stored here.
-- The parser maps the eight headers by name and drops every other column, so a
-- future export with extra personal columns still stores only these eight.
-- Bank rows likewise keep only the LAST FOUR DIGITS of an account number.
--
-- Reconciliation NEVER changes a payment's status. It reports; a person acts
-- through the existing payments queue (audited there).
--
-- RLS: enabled on all three tables; admins may read (public.is_admin()); there
-- is deliberately NO insert/update/delete policy — every write goes through the
-- service role from lib/reconciliation.ts and is audit-logged, the same shape
-- as `advertisements` and `job_contacts`.

create table if not exists public.reconciliation_imports (
  id           uuid primary key default gen_random_uuid(),
  filename     text,
  sheet        text,
  row_count    int,
  period_from  date,
  period_to    date,
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.reconciliation_imports is
  'One row per uploaded PayPro Orders export. Only the eight PayPro columns are stored on its rows; customer names, mobiles and emails are never stored.';

create table if not exists public.reconciliation_rows (
  id                  uuid primary key default gen_random_uuid(),
  import_id           uuid not null references public.reconciliation_imports(id) on delete cascade,
  order_number        text not null,
  transaction_status  text,
  payment_via         text,
  order_amount        numeric,
  merchant_share      numeric,
  date_paid           date,
  settle_date         date,
  settle_status       text,
  created_at          timestamptz not null default now()
);

comment on table public.reconciliation_rows is
  'The eight PayPro export columns per order — nothing personal. order_number matches payments.provider_ref.';

create index if not exists reconciliation_rows_order_number_idx
  on public.reconciliation_rows (order_number);
create index if not exists reconciliation_rows_import_id_idx
  on public.reconciliation_rows (import_id);

create table if not exists public.bank_transfers (
  id              uuid primary key default gen_random_uuid(),
  transferred_on  date not null,
  amount_pkr      numeric not null,
  reference       text,
  account_last4   text check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  source          text not null check (source in ('manual', 'csv')),
  recorded_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

comment on table public.bank_transfers is
  'Money received from PayPro into our bank: typed by an admin (manual) or imported from a statement CSV (csv). Only the last four digits of an account number are kept.';

create index if not exists bank_transfers_transferred_on_idx
  on public.bank_transfers (transferred_on);

alter table public.reconciliation_imports enable row level security;
alter table public.reconciliation_rows    enable row level security;
alter table public.bank_transfers         enable row level security;

drop policy if exists reconciliation_imports_admin_read on public.reconciliation_imports;
create policy reconciliation_imports_admin_read on public.reconciliation_imports
  for select using (public.is_admin());

drop policy if exists reconciliation_rows_admin_read on public.reconciliation_rows;
create policy reconciliation_rows_admin_read on public.reconciliation_rows
  for select using (public.is_admin());

drop policy if exists bank_transfers_admin_read on public.bank_transfers;
create policy bank_transfers_admin_read on public.bank_transfers
  for select using (public.is_admin());
