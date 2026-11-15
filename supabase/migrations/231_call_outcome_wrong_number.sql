-- 231_call_outcome_wrong_number.sql (owner, 15 Nov 2026)
--
-- People → Tutors: "Call" now asks "Reached them?" — Yes, talked · No answer ·
-- Wrong number. "Yes" is a follow-up (member_follow_ups); "No answer" and
-- "Wrong number" are call ATTEMPTS, logged in tutor_contact_logs. This only
-- widens the outcome check to allow 'wrong_number'. No row changes.

alter table public.tutor_contact_logs drop constraint if exists tutor_contact_logs_outcome_check;
alter table public.tutor_contact_logs
  add constraint tutor_contact_logs_outcome_check
  check (outcome in ('called', 'no_answer', 'needs_help', 'will_pay_later', 'not_interested', 'wrong_number'));
