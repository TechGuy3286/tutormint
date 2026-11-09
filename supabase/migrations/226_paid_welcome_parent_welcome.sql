-- 226_paid_welcome_parent_welcome.sql — owner, 9 Nov 2026.
--
-- 1. "Send welcome" on a paid tutor's People card records a follow-up with
--    source 'welcome' (lib/paidWelcomeCore), with the same 10-second Undo as
--    every follow-up. member_follow_ups.source may now also be 'welcome'.
--    Every existing value stays allowed.
-- 2. The new-parent welcome WhatsApp (pf_no_tuition) says plainly that the
--    parent posts the tuition themselves. The replaced wording is kept in
--    template_history first (never deleted; Restore puts it back).
--
-- Additive and re-runnable.

alter table public.member_follow_ups drop constraint if exists member_follow_ups_source_check;
alter table public.member_follow_ups
  add constraint member_follow_ups_source_check
  check (source in ('stuck', 'unpaid', 'abandoned', 'documents', 'status_image', 'parents', 'social_links', 'welcome'));

insert into public.template_history (key, kind, body, action, saved_by_name)
select t.key, 'whatsapp', t.body, 'edit', 'Owner instruction (9 Nov 2026)'
from public.admin_message_templates t
where t.key = 'pf_no_tuition'
  and t.body is distinct from 'Assalam o Alaikum {first_name}, thank you for joining TutorMint. You can post your tuition yourself, for free. Add the class, subjects and area, and verified tutors near you will apply. Post your tuition here: https://www.tutormint.org/post-tuition Or browse tutors and contact one directly: https://www.tutormint.org/browse/tutors Need help? WhatsApp {support_whatsapp}';

update public.admin_message_templates
set body = 'Assalam o Alaikum {first_name}, thank you for joining TutorMint. You can post your tuition yourself, for free. Add the class, subjects and area, and verified tutors near you will apply. Post your tuition here: https://www.tutormint.org/post-tuition Or browse tutors and contact one directly: https://www.tutormint.org/browse/tutors Need help? WhatsApp {support_whatsapp}'
where key = 'pf_no_tuition';
