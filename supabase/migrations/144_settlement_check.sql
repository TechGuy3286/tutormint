-- 144_settlement_check.sql — Settlement check per payment gateway (owner, 6 Oct 2026).
--
-- ADDITIVE ONLY. Nothing existing changes meaning and nothing is deleted.
--
-- 1. gateway_deductions — the owner-editable deduction lines per gateway
--    ("PayPro fee", "Withholding tax"): a percentage and/or a fixed amount per
--    payment, from an effective date. A period is calculated with the line in
--    effect on each payment's date, so a NEW line (a new rate from a later
--    date) never rewrites an earlier period. Removing a line is a soft removal
--    (removed_at) — the row stays. Admin-read; written by the server only.
-- 2. bank_transfers.gateway and reconciliation_imports.gateway — which gateway a
--    transfer or an uploaded file belongs to. Every existing row is PayPro's
--    (the only gateway so far), which the default records.

create table if not exists public.gateway_deductions (
  id              uuid primary key default gen_random_uuid(),
  gateway         text not null,
  name            text not null,
  percent         numeric check (percent is null or (percent >= 0 and percent <= 100)),
  fixed_pkr       numeric check (fixed_pkr is null or fixed_pkr >= 0),
  effective_from  date not null,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  removed_at      timestamptz,
  removed_by      uuid references auth.users(id) on delete set null,
  check (percent is not null or fixed_pkr is not null)
);

create index if not exists gateway_deductions_gateway_idx
  on public.gateway_deductions (gateway, effective_from);

alter table public.gateway_deductions enable row level security;

drop policy if exists gateway_deductions_admin_read on public.gateway_deductions;
create policy gateway_deductions_admin_read on public.gateway_deductions
  for select using (public.is_admin());

alter table public.bank_transfers
  add column if not exists gateway text not null default 'paypro';

alter table public.reconciliation_imports
  add column if not exists gateway text not null default 'paypro';
