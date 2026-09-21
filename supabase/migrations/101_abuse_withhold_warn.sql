-- 101_abuse_withhold_warn.sql (PR41)
--
-- Two changes to abuse handling: a flagged message is now WITHHELD from delivery
-- (never reaches the recipient) instead of delivered, and the sender is WARNED
-- twice before the third flag suspends them.
--
-- messages.withheld_at / withheld_level — a message flagged for abuse is stored
--   (so the SENDER sees it in their thread, marked "not sent") but never
--   delivered: the recipient's read paths exclude it, and no notification, unread
--   or digest is raised. withheld_level is the warning number (1, 2 or 3) at the
--   time, so the sender's own bubble can read the right escalation line.
--
-- abuse_flags.warning_level — which flag this was for the member (1 = first
--   warning, 2 = second, 3 = suspension), so /admin/flags and the member page
--   show that the person was warned before being suspended.
-- abuse_flags.withheld — whether the flagged content was withheld from delivery
--   or publication (always true now; recorded so admin can see it plainly).

alter table public.messages
  add column if not exists withheld_at    timestamptz,
  add column if not exists withheld_level int;

alter table public.abuse_flags
  add column if not exists warning_level int,
  add column if not exists withheld boolean not null default false;
