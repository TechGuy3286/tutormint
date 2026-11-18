-- 234 — statement matching fix (owner, 18 Nov 2026 — PR-04).
--
-- A fee credit on the bank statement is now linked AUTOMATICALLY to an approved
-- bank-transfer payment when the pairing is unique on both sides (same amount,
-- within ±2 days of the receipt upload or the approval). When the Owner undoes
-- such a link — or undoes their own "Link" — the row is stamped here, so the
-- automatic matching never puts the same link back. The link itself is a
-- settlement_links row, removed by stamping removed_at (never deleted).
--
-- Additive: two nullable columns, no row changed. bank_statement_rows stays
-- Owner only (RLS on, no policy, no client grant — migration 233).

alter table public.bank_statement_rows add column if not exists auto_link_undone_at timestamptz;
alter table public.bank_statement_rows add column if not exists auto_link_undone_by uuid references auth.users (id) on delete set null;

comment on column public.bank_statement_rows.auto_link_undone_at is
  'The Owner undid a statement link to an approved payment (PR-04): never linked automatically again.';
