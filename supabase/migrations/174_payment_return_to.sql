-- 174_payment_return_to.sql (owner, 15 Oct 2026)
--
-- Return to the tuition after paying inside onboarding. A tutor who tapped Apply
-- on a tuition, signed up and paid the Verification Fee should land back on that
-- tuition. PayPro sends the member to one fixed return page (/pay/return?ref=…),
-- and a bank-transfer receipt is approved by staff hours later, so the page to go
-- back to is remembered on the payment row itself.
--
-- payments.return_to: a SAME-SITE PATH only (lib/returnTo safeReturnTo checks it
-- before it is written; this CHECK is the database's own guard). Written by the
-- server only (the checkout and receipt routes, service role). Additive and
-- idempotent; no existing row changes. Members already read their own payments;
-- no policy changes.

alter table public.payments add column if not exists return_to text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_return_to_path') then
    alter table public.payments
      add constraint payments_return_to_path check (
        return_to is null or (
          left(return_to, 1) = '/'
          and left(return_to, 2) <> '//'
          and strpos(return_to, chr(92)) = 0
          and length(return_to) <= 512
        )
      );
  end if;
end $$;

comment on column public.payments.return_to is
  'Same-site path to send the member back to after this payment (the tuition they tapped Apply on). Server-written. Migration 174.';
