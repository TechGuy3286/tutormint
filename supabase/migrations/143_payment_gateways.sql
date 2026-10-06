-- 143_payment_gateways.sql — Admin → Settings → Payment gateways (owner, 6 Oct 2026, item 19).
--
-- ADDITIVE ONLY.
--
-- 1. gateway_events: one row per callback received from a gateway and per
--    gateway error we hit, read by the health panel ("last callback received",
--    "last error"). Admin-read only; written by the server (service role) only —
--    NOT in app_settings, which is world-readable.
-- 2. The gateway settings, seeded to TODAY'S state (insert only if missing):
--      pay.gateway.active        paypro
--      pay.method.paypro_online  true   (JazzCash, Easypaisa and card on PayPro's page)
--      pay.method.bank_transfer  false  (off today)
--      pay.pay_later             false  (off today)

create table if not exists public.gateway_events (
  id bigserial primary key,
  gateway text not null,
  kind text not null check (kind in ('callback', 'error')),
  message text,
  created_at timestamptz not null default now()
);

create index if not exists gateway_events_gateway_kind_at
  on public.gateway_events (gateway, kind, created_at desc);

alter table public.gateway_events enable row level security;

drop policy if exists gateway_events_admin_read on public.gateway_events;
create policy gateway_events_admin_read on public.gateway_events
  for select using (public.is_admin());

insert into public.app_settings (key, value) values
  ('pay.gateway.active', 'paypro'),
  ('pay.method.paypro_online', 'true'),
  ('pay.method.bank_transfer', 'false'),
  ('pay.pay_later', 'false')
on conflict (key) do nothing;
