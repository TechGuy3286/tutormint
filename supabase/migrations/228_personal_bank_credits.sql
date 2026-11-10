-- 228_personal_bank_credits.sql (owner, 10 Nov 2026)
--
-- "Not business (personal)" on a bank credit. The Owner marks a bank-received
-- entry as personal money (e.g. a private transfer into the company account)
-- with a short note. A marked credit is left out of Received in bank, the
-- PayPro settlement, Due from PayPro, revenue and every Finance total; it stays
-- listed in a grey line under its month. Undo stamps personal_undone_* and
-- clears personal_at — the row is never deleted, and both actions are in
-- admin_audit_log (settlement.personal / settlement.personal_undo).
--
-- bank_transfers keeps its RLS (admin read, service-role writes). Additive and
-- re-runnable.

alter table public.bank_transfers
  add column if not exists personal_at         timestamptz,
  add column if not exists personal_by         uuid references auth.users (id) on delete set null,
  add column if not exists personal_by_name    text,
  add column if not exists personal_note       text,
  add column if not exists personal_undone_at  timestamptz,
  add column if not exists personal_undone_by  uuid references auth.users (id) on delete set null;

alter table public.bank_transfers drop constraint if exists bank_transfers_personal_note_check;
alter table public.bank_transfers add constraint bank_transfers_personal_note_check
  check (personal_at is null or (personal_note is not null and length(btrim(personal_note)) >= 3));

comment on column public.bank_transfers.personal_at is
  'Owner marked this credit "Not business (personal)": out of every money total. Null = counted (or the mark was undone).';
