-- 64_abandoned_signup_templates.sql
--
-- Three Team-message templates for the abandoned-signup outreach worklist
-- (/admin/signups), one per stuck stage: an email signup that never confirmed,
-- a mobile signup that never verified its number, and a verified account that
-- never finished its profile.
--
-- Additive only: three rows in the existing admin_message_templates table
-- (migration 58), editable afterwards in the Team-inbox template editor like
-- any other. NO price, no packages mention — these people have not opened a
-- packages page, and the outreach must not read as a sales pitch (conversion
-- rules). {name} is the only placeholder, auto-filled at send.
--
-- on conflict (key) do nothing — idempotent, safe to re-run.

insert into public.admin_message_templates (key, title, subject, body) values
  ('signup_email_unconfirmed', 'Signup — email not confirmed', 'Confirm your TutorMint account',
   'Hi {name}, thanks for signing up to TutorMint. Your account is not active yet — please confirm your email address by clicking the link we sent you (it may be in your spam or promotions folder). If the link did not arrive or has expired, reply to this message and we will help you get in.'),
  ('signup_mobile_unverified', 'Signup — mobile not verified', 'Finish verifying your TutorMint number',
   'Hi {name}, thanks for signing up to TutorMint. To finish, enter the verification code we sent to your mobile on WhatsApp — that unlocks your account. If you did not receive a code, reply to this message and our team will verify your number for you.'),
  ('signup_profile_unfinished', 'Signup — profile unfinished', 'You are almost there on TutorMint',
   'Hi {name}, you are almost set up on TutorMint — your profile just is not finished yet. Completing it is what lets parents find you, or lets you start hiring. It only takes a few minutes from your dashboard. Reply here if you would like a hand with it.')
on conflict (key) do nothing;
