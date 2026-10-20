-- 189_checkout_paid_another_way.sql (owner, 21 Oct 2026)
--
-- Once a member's fee or plan is paid by ANY method, their other open checkouts
-- for the same thing are marked closed with the reason "Paid by another method"
-- (lib/payments/closeOtherCheckouts.ts), so Follow-ups and the payment banner
-- stop chasing them. Status is unchanged and nothing is deleted, exactly as for
-- the other close reasons (migration 185): a late PayPro payment still activates.
--
-- This only widens the CHECK on payments.checkout_close_reason by one value.
-- Additive; idempotent; no row changes.

alter table public.payments drop constraint if exists payments_checkout_close_reason_check;
alter table public.payments
  add constraint payments_checkout_close_reason_check
  check (checkout_close_reason is null or checkout_close_reason in
    ('cancelled_by_member', 'expired', 'already_paid', 'already_has_it', 'no_valid_checkout', 'paid_another_way'));

comment on column public.payments.checkout_close_reason is
  'cancelled_by_member | expired | already_paid | already_has_it | no_valid_checkout | paid_another_way';
