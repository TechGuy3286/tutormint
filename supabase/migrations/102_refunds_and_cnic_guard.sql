-- 102_refunds_and_cnic_guard.sql  (PR106-H4 §3 + §4)
--
-- Additive. (a) Refund fields on payments — the original row is never deleted;
-- a refund is recorded alongside it and net revenue = amount - refunded_amount.
-- (b) A guard function so a CNIC already on another account cannot be saved.

-- ── §4 refund fields ─────────────────────────────────────────────────────────
alter table public.payments
  add column if not exists refunded_amount_pkr integer,
  add column if not exists refund_method text,
  add column if not exists refund_reference text,
  add column if not exists refund_reason text,
  add column if not exists refund_proof_path text,
  add column if not exists refunded_at timestamptz,
  add column if not exists refunded_by uuid references auth.users(id);

-- ── §3 duplicate-CNIC guard ──────────────────────────────────────────────────
-- True when p_digits (CNIC digits only) is already saved on ANOTHER account.
-- SECURITY DEFINER so a member's own request can check across all accounts
-- without reading anyone's CNIC; it returns only a boolean, never a number.
create or replace function public.cnic_in_use(p_digits text, p_except uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select p_digits is not null
     and length(p_digits) = 13
     and exists (
       select 1 from public.profiles
        where id <> p_except
          and regexp_replace(coalesce(cnic_number, ''), '\D', '', 'g') = p_digits
     )
$$;

revoke all on function public.cnic_in_use(text, uuid) from public;
grant execute on function public.cnic_in_use(text, uuid) to service_role;
