-- 211_fee_match_refund_due_parent_templates.sql (owner, 27 Oct 2026)
--
-- Payment auto-linking and parent WhatsApp messages. Additive and re-runnable.
--
--   1. app_settings 'pay.fee_match_min' / 'pay.fee_match_max' — the "Fee match
--      range" (default Rs 199–210). A bank credit in that range counts as a
--      Verification Fee payment; the extra is "rounding", not a problem.
--   2. payments.rounding_pkr — the extra a bank credit carried above the
--      price when it paid this payment (e.g. Rs 1 on a Rs 200 credit for the
--      Rs 199 fee). Revenue still counts amount_pkr.
--   3. bank_transfers.category (+ reason / by / at) — the owner's re-label
--      "Owner / partner transfer (not revenue)". Such a credit is out of PayPro
--      settlement, revenue and every money total (lib/ignoredCredits).
--   4. refund_dues — "Mark as duplicate — refund due": a bank credit that paid
--      a fee the member had already paid. Shown on Finance and the member's
--      page until the Owner marks it refunded. Stamped, never deleted.
--      Admin-read RLS, service-role writes.
--   5. Parent templates: pf_tutors_applied (new), and the sign-in / repost
--      link added to pf_email_unconfirmed and pf_expired — only where the body
--      is still the seeded wording.

-- 1 ------------------------------------------------------------------------
insert into public.app_settings (key, value) values ('pay.fee_match_min', '199') on conflict (key) do nothing;
insert into public.app_settings (key, value) values ('pay.fee_match_max', '210') on conflict (key) do nothing;

-- 2 ------------------------------------------------------------------------
alter table public.payments add column if not exists rounding_pkr numeric(10, 2);
comment on column public.payments.rounding_pkr is
  'The extra a bank credit carried above the price when it paid this payment (fee match range, migration 211). Not a problem; revenue counts amount_pkr.';

-- 3 ------------------------------------------------------------------------
alter table public.bank_transfers add column if not exists category text;
alter table public.bank_transfers add column if not exists category_reason text;
alter table public.bank_transfers add column if not exists category_by uuid references auth.users (id) on delete set null;
alter table public.bank_transfers add column if not exists category_at timestamptz;
alter table public.bank_transfers drop constraint if exists bank_transfers_category_check;
alter table public.bank_transfers add constraint bank_transfers_category_check check (category is null or category = 'owner_transfer');
comment on column public.bank_transfers.category is
  'owner_transfer = the Owner re-labelled it "Owner / partner transfer (not revenue)": never matched, out of PayPro settlement and every money total. NULL = a sale (PayPro payout or a member transfer, by gateway).';

-- 4 ------------------------------------------------------------------------
create table if not exists public.refund_dues (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references auth.users (id) on delete set null,
  transfer_id uuid not null references public.bank_transfers (id),
  payment_id uuid references public.payments (id) on delete set null,
  amount_pkr numeric(10, 2) not null check (amount_pkr > 0),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  refunded_at timestamptz,
  refunded_by uuid references auth.users (id) on delete set null,
  refunded_by_name text,
  refund_note text
);
create unique index if not exists refund_dues_transfer_uniq on public.refund_dues (transfer_id);
create index if not exists refund_dues_member_idx on public.refund_dues (member_id);
comment on table public.refund_dues is
  'A bank credit that paid a fee the member had already paid ("Mark as duplicate — refund due", migration 211). Open until refunded_at is set; never deleted.';

alter table public.refund_dues enable row level security;
drop policy if exists refund_dues_admin_read on public.refund_dues;
create policy refund_dues_admin_read on public.refund_dues for select to authenticated using (public.is_admin());

-- 5 ------------------------------------------------------------------------
insert into public.admin_message_templates (key, title, subject, body)
values
  (E'pf_tutors_applied', E'Parents — tutors applied, here they are', E'Tutors applied to your tuition',
   E'Assalam o Alaikum {first_name}, tutors have applied to your tuition "{tuition_title}" on TutorMint. Here are their profiles:\n{tutor_links}\n\nReply here and tell us who you would like to talk to.\n\nNeed help? WhatsApp us on {support_whatsapp}')
on conflict (key) do nothing;

update public.admin_message_templates
   set body = E'Assalam o Alaikum {first_name}, thank you for signing up to TutorMint. Please open the email we sent you and tap the link to confirm your address. If it is not in your inbox, check your spam folder. Then sign in here:\n{signin_link}\n\nNeed help? WhatsApp us on {support_whatsapp}'
 where key = 'pf_email_unconfirmed'
   and body = E'Assalam o Alaikum {first_name}, thank you for signing up to TutorMint. Please open the email we sent you and tap the link to confirm your address. If it is not in your inbox, check your spam folder.\n\nNeed help? WhatsApp us on {support_whatsapp}';

update public.admin_message_templates
   set body = E'Assalam o Alaikum {first_name}, your tuition "{tuition_title}" is no longer live on TutorMint. Still looking? You can repost it here in one tap:\n{repost_link}\n\nNeed help? WhatsApp us on {support_whatsapp}'
 where key = 'pf_expired'
   and body = E'Assalam o Alaikum {first_name}, your tuition "{tuition_title}" is no longer live on TutorMint. Still looking? We can repost it — just reply to this message.\n\nNeed help? WhatsApp us on {support_whatsapp}';
