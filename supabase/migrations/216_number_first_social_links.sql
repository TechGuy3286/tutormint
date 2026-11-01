-- 216_number_first_social_links.sql — owner, 31 Oct 2026.
--
-- 1. Number first on staff Post a tuition (lib/numberFirstCore): when the
--    parent's number belongs to a parent account, the new staff-posted tuition
--    is LINKED to that account. The link lives on job_contacts (admin-read RLS,
--    service-role writes — never on the public jobs row). Nothing changes who
--    owns the tuition (still the team account).
--
-- 2. "Send social links" on a paid tutor's member page: the editable template
--    (Team inbox → Templates → Social links). Placeholders: {first_name},
--    {social_links}, {support_whatsapp}. Plain English, no emoji.
--
-- Additive and re-runnable.

alter table public.job_contacts
  add column if not exists parent_account_id uuid references public.profiles(id) on delete set null;

create index if not exists job_contacts_parent_account_idx
  on public.job_contacts (parent_account_id) where parent_account_id is not null;

insert into public.admin_message_templates (key, title, subject, body)
values
  (E'social_links', E'Social links — TutorMint pages for a paid tutor', E'Follow TutorMint',
   E'Assalam o Alaikum {first_name},\nThank you for joining TutorMint. Follow us for new tuitions and tips:\n{social_links}\n\nNeed help? WhatsApp {support_whatsapp}')
on conflict (key) do nothing;
