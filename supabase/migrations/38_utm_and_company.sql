-- 38_utm_and_company.sql — where a member came from, and who we legally are.
--
-- TWO UNRELATED THINGS IN ONE FILE, which is usually wrong. They are together
-- because both are additive metadata columns/rows with no behaviour attached
-- and both ship in the same change; splitting them would put two migrations in
-- the ledger that must be applied together or not at all.
--
-- ---------------------------------------------------------------- 1. UTM ---
--
-- If Meta ads are the acquisition channel then the only question that matters
-- is which ad brought the tutor who actually PAID. Answering it needs the
-- campaign recorded twice, in two places, for two different reasons:
--
--   profiles  — first touch. Which ad brought this person to the site at all.
--               Written once at signup and never updated, because first-touch
--               attribution that gets overwritten by a later visit is not
--               first-touch attribution.
--   payments  — the campaign carried on the account at the moment money moved.
--               Denormalised deliberately: a member's profile columns answer
--               "where did they come from", and this answers "what was the
--               attribution on the payment we banked", which stays true even
--               if the profile is later corrected.
--
-- All four are plain nullable text. No CHECK, no enum: utm_campaign is
-- whatever somebody typed into Ads Manager, and a constraint here would reject
-- real traffic to enforce a taxonomy we do not own.

begin;

alter table public.profiles add column if not exists utm_source text;
alter table public.profiles add column if not exists utm_medium text;
alter table public.profiles add column if not exists utm_campaign text;
alter table public.profiles add column if not exists utm_content text;

alter table public.payments add column if not exists utm_source text;
alter table public.payments add column if not exists utm_medium text;
alter table public.payments add column if not exists utm_campaign text;
alter table public.payments add column if not exists utm_content text;

comment on column public.profiles.utm_source is
  'First-touch acquisition campaign, captured on the first visit and written once at signup. Never updated by a later visit.';
comment on column public.payments.utm_source is
  'The acquisition campaign carried on the account when this payment was created. Denormalised from profiles on purpose.';

-- Indexed on the one question this exists to answer: group paid conversions by
-- campaign. Partial, because the overwhelming majority of rows are NULL and an
-- index over those is dead weight.
create index if not exists payments_utm_campaign_idx
  on public.payments (utm_campaign, created_at desc)
  where utm_campaign is not null;

create index if not exists profiles_utm_campaign_idx
  on public.profiles (utm_campaign)
  where utm_campaign is not null;

-- ------------------------------------------------------------ 2. company ---
--
-- The legal entity, in app_settings so the two numbers we do not have yet can
-- be filled in by an admin with no deploy. CLAUDE.md names them as the
-- placeholders {{COMPANY_REG_NO}} (SECP CUIN) and {{COMPANY_NTN}}, and that is
-- what is seeded: the page renders the placeholder verbatim, which is honest
-- about the gap in a way that a blank space or a "coming soon" is not.
--
-- The rest is seeded too rather than left to an env fallback, so all of it is
-- editable from one place — an address on a Terms page should not need a
-- developer. `app_settings` is publicly readable (app_settings_public_read) and
-- admin-writable, which is exactly right for facts that appear on /terms.
--
-- ON CONFLICT DO NOTHING throughout: re-running this must not overwrite a real
-- CUIN with the placeholder it replaced.
insert into public.app_settings (key, value) values
  ('company.legal_name',      'Tutor Mint (Private) Limited'),
  ('company.short_name',      'Tutor Mint (Pvt) Ltd'),
  ('company.address',         '4th Floor, 37-M, Civic Center, Model Town, Lahore, Punjab, Pakistan'),
  ('company.email',           'support@tutormint.org'),
  ('company.reg_no',          '{{COMPANY_REG_NO}}'),
  ('company.ntn',             '{{COMPANY_NTN}}')
on conflict (key) do nothing;

-- The business WhatsApp and support email, which CLAUDE.md states as owner
-- facts and requires to come from app_settings rather than page source. Until
-- now nothing was configured in either app_settings or the environment, so
-- /support offered no WhatsApp channel at all and the Organization schema had
-- no telephone to publish. Seeded here for the same reason as the company
-- rows: it is a fact that changes without anyone opening a code editor.
insert into public.app_settings (key, value) values
  ('support.whatsapp', '923215872222'),
  ('support.email',    'support@tutormint.org')
on conflict (key) do nothing;

commit;
