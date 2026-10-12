-- 164_no_contact_pause_source.sql  (owner, 12 Oct 2026)
--
-- ADDITIVE. jobs.pause_source may also be 'no_contact': a tuition paused because
-- it has no parent contact number (the reason staff see is "No contact number").
-- No row is changed here. The one-time clean-up that pauses such tuitions is
-- scripts/dataop-pause-no-contact-tuitions.ts, run after the code is live.

alter table public.jobs drop constraint if exists jobs_pause_source_check;
alter table public.jobs add constraint jobs_pause_source_check
  check (pause_source is null or pause_source in ('auto', 'backlog', 'admin', 'self', 'poster', 'no_contact'));
