-- 191_follow_up_not_interested.sql  (owner, 21 Oct 2026)
--
-- 1. "Not interested" on Follow-ups. Every unfinished sign-up is now on
--    Follow-ups whatever their age; a member leaves only when they finish, or
--    when staff mark them "Not interested". That moves them to a hidden
--    "Not interested" group. Undo stamps undone_at — nothing is ever deleted.
--    One live mark per member (partial unique index). Admin-read RLS;
--    service-role writes only (POST /api/admin/follow-ups/not-interested,
--    which checks the list's own SCREEN_ACCESS and writes admin_audit_log).
--
-- 2. Links on their own line. Every admin pre-filled WhatsApp message puts its
--    one link, written in full, on a line of its own so WhatsApp shows the link
--    preview. The seeded template bodies that carried a link inside a sentence
--    are rewritten ONLY where the stored body is still exactly the seeded
--    wording — an admin's own edit is left alone (the send path moves the link
--    onto its own line at send time anyway, lib/waLinkCore). English only; no
--    Urdu text is changed.
--
-- Additive and re-runnable. No member row changes.

create table if not exists public.follow_up_dismissals (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references auth.users(id) on delete cascade,
  reason         text not null default 'not_interested' check (reason in ('not_interested')),
  note           text check (note is null or length(note) <= 500),
  staff_id       uuid references auth.users(id) on delete set null,
  staff_name     text,
  created_at     timestamptz not null default now(),
  undone_at      timestamptz,
  undone_by      uuid references auth.users(id) on delete set null,
  undone_by_name text
);

create unique index if not exists follow_up_dismissals_one_live
  on public.follow_up_dismissals (member_id) where undone_at is null;

create index if not exists follow_up_dismissals_member_idx
  on public.follow_up_dismissals (member_id, created_at desc);

alter table public.follow_up_dismissals enable row level security;

drop policy if exists follow_up_dismissals_admin_read on public.follow_up_dismissals;
create policy follow_up_dismissals_admin_read on public.follow_up_dismissals
  for select using (public.is_admin());

-- 2. Template bodies — each only while it is still the seeded wording.
update public.admin_message_templates
   set body = E'Assalam o Alaikum {name}, your documents on TutorMint are approved ✅. One step left to get your Verified badge and appear to parents: pay the Verification Fee. Need help? WhatsApp 0321 5872222. — TutorMint\n\n{pay_link}'
 where key = 'documents_approved'
   and body = 'Assalam o Alaikum {name}, your documents on TutorMint are approved ✅. One step left to get your Verified badge and appear to parents: pay the Verification Fee here: {pay_link}. Need help? WhatsApp 0321 5872222. — TutorMint';

update public.admin_message_templates
   set body = E'Assalam o Alaikum {name}, your documents on TutorMint are approved ✅ and your profile is now live — parents can find you on TutorMint. Need help? WhatsApp 0321 5872222. — TutorMint\n\n{profile_link}'
 where key = 'documents_approved_paid'
   and body = 'Assalam o Alaikum {name}, your documents on TutorMint are approved ✅ and your profile is now live — parents can find you here: {profile_link}. Need help? WhatsApp 0321 5872222. — TutorMint';

update public.admin_message_templates
   set body = E'Assalam o Alaikum {name}, your TutorMint payment didn''t complete. Need help? Support WhatsApp 0321 5872222. Here is your link to try again:\n{pay_link}'
 where key = 'payment_not_finished'
   and body = 'Assalam o Alaikum {name}, your TutorMint payment didn''t complete. Need help? Here is your link to try again: {pay_link}. Support WhatsApp 0321 5872222.';

update public.admin_message_templates
   set body = E'Hi {name}, this is TutorMint. Thank you for posting your tuition. With a plan you can see tutors'' contact numbers and hire directly. See the plans here:\n{link}'
 where key = 'my_signup_buy_plan'
   and body = 'Hi {name}, this is TutorMint. Thank you for posting your tuition. With a plan you can see tutors'' contact numbers and hire directly. See the plans here: {link}';

update public.admin_message_templates
   set body = E'Hi {name}, this is TutorMint. Thank you for joining. If you need any help, just reply here.\n\n{link}'
 where key = 'my_signup_check_in'
   and body = 'Hi {name}, this is TutorMint. Thank you for joining. If you need any help, just reply here: {link}';

update public.admin_message_templates
   set body = E'Hi {name}, this is TutorMint. Your profile is ready. The last step to get your Verified badge and appear to parents is the Verification Fee. You can pay it here:\n{link}'
 where key = 'my_signup_pay_fee'
   and body = 'Hi {name}, this is TutorMint. Your profile is ready. The last step to get your Verified badge and appear to parents is the Verification Fee. You can pay it here: {link}';

update public.admin_message_templates
   set body = E'Hi {name}, this is TutorMint. Your account is ready. Post your tuition here and verified tutors near you can see it:\n{link}'
 where key = 'my_signup_post_tuition'
   and body = 'Hi {name}, this is TutorMint. Your account is ready. Post your tuition here and verified tutors near you can see it: {link}';

update public.admin_message_templates
   set body = E'Hi {name}, this is TutorMint. You are nearly there — please upload your CNIC, profile photo and selfie so we can check your profile. You can do it here:\n{link}'
 where key = 'my_signup_upload_documents'
   and body = 'Hi {name}, this is TutorMint. You are nearly there — please upload your CNIC, profile photo and selfie so we can check your profile. You can do it here: {link}';
