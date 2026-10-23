-- 197_fee_reply_template.sql — Follow-ups polish (owner, 23 Oct 2026).
--
-- One saved reply in Team inbox → Templates → Follow-ups: "About the
-- Verification Fee" (fu_fee_reply), the answer to "Do I have to pay anything?".
-- It is the only Follow-ups template that states the fee's amount — a private
-- WhatsApp reply to the tutor, never a public page or a social post — so the
-- editor does not show the price warning for it. {pay_link} is
-- https://www.tutormint.org/pay/choose; {support_whatsapp} comes from the
-- support.whatsapp setting. The body is exactly lib/followUpTemplatesCore
-- FU_FEE_REPLY_DEFAULT (checked by scripts/apply-migration-197.ts).
--
-- Additive and re-runnable: a row that already exists (an admin may have edited
-- it) is left as it is. No other template changes: the 23 Oct 2026 scan of
-- every stored template found no broken character (no U+FFFD, no lone half of
-- an emoji) — the "�" in WhatsApp came from the wa.me redirect, fixed in code.

insert into public.admin_message_templates (key, title, subject, body)
values
  ('fu_fee_reply', 'About the Verification Fee', 'About the Verification Fee',
   'Joining TutorMint is free — no commission, no middleman. To apply to tuitions, tutors pay a one-time Verification Fee of Rs 199. We check your CNIC and selfie, and your profile gets the Verified badge so parents can trust you. You can pay here: {pay_link}. Any questions, message us on WhatsApp {support_whatsapp}.')
on conflict (key) do nothing;
