-- 74_signup_mobile_template_sms.sql
--
-- OTP delivery moved from SMS Point (WhatsApp) to SendPK (SMS over a Pakistani
-- short code), but the abandoned-signup outreach template still told a member to
-- "enter the verification code we sent to your mobile on WhatsApp" — a code that
-- now arrives as an SMS. /admin/signups renders the DB template body (not the
-- client fallback), so the wrong channel is what an admin actually sends.
--
-- Correct the one template that describes OTP delivery. Guarded on the stale
-- phrase so it is idempotent AND cannot clobber an owner/manager edit that has
-- already dropped the WhatsApp wording — the template is editable in the
-- Team-inbox editor. The other two abandoned-signup templates (email, profile)
-- do not describe OTP delivery and are untouched.

update public.admin_message_templates
set body = 'Hi {name}, thanks for signing up to TutorMint. To finish, enter the verification code we sent to your mobile by SMS — that unlocks your account. If you did not receive a code, reply to this message and our team will verify your number for you.'
where key = 'signup_mobile_unverified'
  and body like '%on WhatsApp%';
