-- 24_t6_payments.sql
-- T6: payments, activation, expiry.
--
-- SAFETY: this file only CREATEs, ADDs and ENABLEs. There is no DROP, RENAME,
-- DELETE, TRUNCATE or column-type change anywhere in it, and it is idempotent.
--
-- Two constraints I deliberately did NOT widen, because widening a CHECK means
-- dropping it and that needs the owner's sign-off:
--
--   payments_method_check      ('jazzcash','easypaisa','bank','assanpay')
--     `method` stays the money instrument. The new `provider` column below
--     says which of our integrations handled it. A simulated purchase is
--     provider='simulator', method='assanpay' -- it is pretending to be the
--     gateway, so that is the honest pair.
--
--   subscriptions_source_check ('purchase','admin_grant')
--     The admin screen wants to show gateway / manual / admin_grant. Rather
--     than add a third source value, "how was it paid" is read from the
--     payment the subscription points at (payments.provider). That is where
--     the fact actually lives, so the join is not a workaround -- it is the
--     correct source of truth, and it cannot drift from the payment row.

-- ---------------------------------------------------------------- payments --
-- provider     which integration took the money
-- provider_ref the gateway's (or our) order reference. The unique index on it
--              is what makes a replayed webhook a no-op: there is exactly one
--              payment row per reference, and activation checks its status
--              before doing anything.
alter table public.payments add column if not exists provider text not null default 'manual';
alter table public.payments add column if not exists provider_ref text;
alter table public.payments add column if not exists rejection_reason text;
alter table public.payments add column if not exists updated_at timestamptz not null default now();
alter table public.payments add column if not exists raw jsonb not null default '{}'::jsonb;

do $$
begin
  alter table public.payments
    add constraint payments_provider_check
    check (provider in ('assanpay', 'manual', 'simulator'));
exception
  when duplicate_object then null;
end $$;

create unique index if not exists payments_provider_ref_uniq
  on public.payments (provider, provider_ref)
  where provider_ref is not null;

create index if not exists payments_queue_idx
  on public.payments (status, created_at desc);

-- ----------------------------------------------------------- subscriptions --
-- reminded_at: the T-3 expiry reminder is sent once. The cron runs daily and
-- must be safe to run twice in a day, or twice in a minute.
alter table public.subscriptions add column if not exists reminded_at timestamptz;

create index if not exists subscriptions_expiry_idx
  on public.subscriptions (expires_at)
  where status = 'active';

-- ------------------------------------------------------------ payment proof --
-- Manual bank/JazzCash/Easypaisa transfers are evidenced by a screenshot.
-- Private bucket: owner + admin read, owner write. No public policy exists, so
-- anon sees nothing, and there is no public URL to a proof of payment (which
-- shows an account number and often a name).
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do update set public = excluded.public;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'payment_proofs_owner_admin_read') then
    create policy payment_proofs_owner_admin_read on storage.objects
      for select using (
        bucket_id = 'payment-proofs'
        and (
          owner = auth.uid()
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'admin'
          )
        )
      );
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'payment_proofs_owner_write') then
    create policy payment_proofs_owner_write on storage.objects
      for insert with check (
        bucket_id = 'payment-proofs' and owner = auth.uid()
      );
  end if;
end $$;

-- -------------------------------------------------------------- settings ----
-- Manual-transfer account details. CLAUDE.md rule 7 forbids hardcoding them in
-- a shipped page, and they change without a deploy, so they live here and fall
-- back to env vars. Public read: they are printed on the manual payment
-- screen. Admin write only.
create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.app_settings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'app_settings'
                   and policyname = 'app_settings_public_read') then
    create policy app_settings_public_read on public.app_settings
      for select using (true);
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'app_settings'
                   and policyname = 'app_settings_admin_write') then
    create policy app_settings_admin_write on public.app_settings
      using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;
