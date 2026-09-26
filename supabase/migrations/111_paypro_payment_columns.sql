-- 111_paypro_payment_columns.sql (PR65)
--
-- PayPro gateway (PR65). Two nullable columns on payments so the PayPro invoice
-- id and the Click2Pay link are visible in plain SQL. ADDITIVE and OPTIONAL: the
-- code writes the same two values into payments.raw ({ "paypro": { … } }) and
-- reads the PayProId back from there, so the callback, the reconcile cron and the
-- return page all work whether or not these columns exist yet. That is why the
-- code deploys BEFORE this migration is applied.
--
-- No RLS change. payments already has the right policies (owner PR16): a member
-- reads only their own rows (payments_self_read) and can never write status or
-- activation (payments_admin_update is admin-only; the pending PayPro row is
-- written by the service role). These two columns inherit that.

alter table payments add column if not exists paypro_id text;
alter table payments add column if not exists click2pay_url text;

comment on column payments.paypro_id is 'PayPro invoice id (PayProId) for a provider=paypro payment; also mirrored in payments.raw.paypro.payProId.';
comment on column payments.click2pay_url is 'PayPro Click2Pay payment link for a provider=paypro payment; also in payments.raw.paypro.click2pay.';
