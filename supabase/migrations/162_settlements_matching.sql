-- 162_settlements_matching.sql — Settlements: match PayPro payouts and
-- bank-transfer payments to bank credits (owner, 11 Oct 2026).
--
-- ADDITIVE. It extends the settlement-check tables of migrations 142 and 144;
-- no table is replaced, no row is deleted, and every existing reader keeps
-- reading what it read before.
--
-- 1. reconciliation_rows — ONE current row per (gateway, order number).
--    Re-uploading the same or an overlapping PayPro export UPDATES the order's
--    row instead of adding another. `is_current` marks the row that counts;
--    where an order was already stored by more than one upload, the newest row
--    stays current and the older ones are kept, marked not current. New columns:
--    gateway, method (JazzCash / Easypaisa / Card), fee (amount − share),
--    updated_at.
-- 2. bank_transfers — a bank credit now also records the time, the sender's
--    name and bank, and a note. A hand-entered credit's reference is unique
--    (statement-CSV rows are exempt: their "reference" is a narration that can
--    legitimately repeat). gateway = 'paypro' for a PayPro payout, 'manual' for
--    a member's own bank transfer.
-- 3. settlement_links — the owner's manual link between one bank credit and
--    PayPro orders / approved receipts, or a hold ('none': leave this credit
--    unmatched). Automatic matches are computed, never stored. Soft removal.
--    Admin-read; written by the server only, and audit-logged.

alter table public.reconciliation_rows
  add column if not exists gateway    text not null default 'paypro',
  add column if not exists method     text,
  add column if not exists fee        numeric,
  add column if not exists is_current boolean not null default true,
  add column if not exists updated_at timestamptz;

update public.reconciliation_rows r
   set gateway = i.gateway
  from public.reconciliation_imports i
 where i.id = r.import_id and r.gateway is distinct from i.gateway;

update public.reconciliation_rows
   set method = case
         when payment_via ~* 'jazz' then 'JazzCash'
         when payment_via ~* 'easy|telenor|tmfb' then 'Easypaisa'
         when payment_via ~* 'card|visa|master|debit|credit' then 'Card'
         else nullif(btrim(payment_via), '')
       end
 where method is null and payment_via is not null;

update public.reconciliation_rows
   set fee = order_amount - merchant_share
 where fee is null and order_amount is not null and merchant_share is not null;

-- Older copies of an order stop being the current one (kept, not deleted).
update public.reconciliation_rows r
   set is_current = false
 where r.is_current
   and exists (
     select 1 from public.reconciliation_rows n
      where n.gateway = r.gateway
        and upper(btrim(n.order_number)) = upper(btrim(r.order_number))
        and (n.created_at, n.id) > (r.created_at, r.id)
   );

create unique index if not exists reconciliation_rows_current_order_uidx
  on public.reconciliation_rows (gateway, upper(btrim(order_number)))
  where is_current;

alter table public.bank_transfers
  add column if not exists transferred_time time,
  add column if not exists sender_name      text,
  add column if not exists sender_bank      text,
  add column if not exists note             text;

create unique index if not exists bank_transfers_manual_reference_uidx
  on public.bank_transfers (upper(btrim(reference)))
  where source = 'manual' and reference is not null and btrim(reference) <> '';

create table if not exists public.settlement_links (
  id               uuid primary key default gen_random_uuid(),
  transfer_id      uuid not null references public.bank_transfers(id) on delete cascade,
  kind             text not null check (kind in ('order', 'receipt', 'none')),
  -- 'order': the PayPro order number. 'receipt': payments.id. 'none': null.
  target           text,
  note             text,
  linked_by        uuid references auth.users(id) on delete set null,
  linked_by_email  text,
  created_at       timestamptz not null default now(),
  removed_at       timestamptz,
  removed_by       uuid references auth.users(id) on delete set null
);

comment on table public.settlement_links is
  'Owner-made links between one bank credit and PayPro orders / approved bank-transfer receipts, or a hold (kind none). Automatic matches are computed and not stored here.';

create index if not exists settlement_links_transfer_idx
  on public.settlement_links (transfer_id) where removed_at is null;

alter table public.settlement_links enable row level security;

drop policy if exists settlement_links_admin_read on public.settlement_links;
create policy settlement_links_admin_read on public.settlement_links
  for select using (public.is_admin());
