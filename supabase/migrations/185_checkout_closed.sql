-- 185_checkout_closed.sql — a checkout can be marked closed (owner, 17 Oct 2026).
--
-- The "payment started, not finished" banner offers only a checkout that can
-- still be paid. A checkout the member cancels, or one the clean-up finds
-- expired / already paid / for something the member already has / with no
-- valid plan, is MARKED here — never deleted, and its status is left as it is.
--
-- Why not a new status: payments_status_check allows pending / approved /
-- rejected, and a PayPro order left pending can still be paid at the gateway;
-- the reconcile cron and the callback approve a PENDING row. Keeping the status
-- means a member who pays a closed checkout after all is still activated. The
-- banner, the dashboard invoice prompt and the Overview list read
-- checkout_closed_at; a checkout that is reused for a new attempt is reopened.
--
-- Only server code (service role) writes these. Additive; idempotent.

alter table public.payments
  add column if not exists checkout_closed_at timestamptz,
  add column if not exists checkout_close_reason text,
  add column if not exists checkout_closed_by uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_checkout_close_reason_check') then
    alter table public.payments
      add constraint payments_checkout_close_reason_check
      check (checkout_close_reason is null or checkout_close_reason in
        ('cancelled_by_member', 'expired', 'already_paid', 'already_has_it', 'no_valid_checkout'));
  end if;
end $$;

comment on column public.payments.checkout_closed_at is
  'A pending checkout marked closed (cancelled by the member or expired by the clean-up). Status is unchanged; nothing is deleted.';
comment on column public.payments.checkout_close_reason is
  'cancelled_by_member | expired | already_paid | already_has_it | no_valid_checkout';
