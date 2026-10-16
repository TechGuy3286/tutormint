-- 180_started_payment_area_landmark.sql (owner, 16 Oct 2026) — additive, idempotent.
--
-- 1. jobs.area_landmark — the "Block / landmark" part of a staff-typed area
--    ("Clifton Block 1" → area Clifton, landmark "Block 1"). Shown on the
--    tuition page as "Clifton (Block 1)". Plain text, optional; nothing reads it
--    for matching, hubs or URLs. jobs.area stays the text it was saved with.
-- 2. The payment_not_finished WhatsApp template (Follow-ups → Tutors, "Started
--    payment, didn't finish"). English, no amount. Edited in Team inbox →
--    Templates like the others.

alter table public.jobs add column if not exists area_landmark text;
alter table public.jobs drop constraint if exists jobs_area_landmark_len;
alter table public.jobs add constraint jobs_area_landmark_len check (area_landmark is null or char_length(area_landmark) <= 120);

insert into public.admin_message_templates (key, title, subject, body) values
  ('payment_not_finished', 'Started payment, didn''t finish', 'Your TutorMint payment',
   'Assalam o Alaikum {name}, your TutorMint payment didn''t complete. Need help? Here is your link to try again: {pay_link}. Support WhatsApp 0321 5872222.')
on conflict (key) do nothing;
