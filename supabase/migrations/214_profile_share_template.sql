-- 214_profile_share_template.sql — owner, 28 Oct 2026.
--
-- "Share on WhatsApp" on a tutor's admin card (member page and People cards)
-- opens WhatsApp with a ready message instead of the bare profile link. The
-- message is a template staff can edit in Team inbox → Templates → Share
-- profile. Placeholders: {tutor_name}, {city}, {subjects}, {profile_link}.
-- For a tutor without the Verified badge the code leaves the word "verified"
-- out (lib/profileShareCore fillShareMessage).
--
-- Additive and re-runnable: inserted only when missing; nothing else changes.

insert into public.admin_message_templates (key, title, subject, body)
values
  (E'profile_share', E'Share profile — a tutor''s profile on WhatsApp', E'Share a tutor''s profile',
   E'Meet {tutor_name}, a verified tutor in {city} for {subjects}.\nSee the profile:\n{profile_link}')
on conflict (key) do nothing;
