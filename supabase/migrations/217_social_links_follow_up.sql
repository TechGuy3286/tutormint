-- 217_social_links_follow_up.sql — owner, 31 Oct 2026.
--
-- "Send social links" on a paid tutor's member page records a follow-up with
-- source 'social_links' (lib/socialLinksCore), so the tutor's Activity tab and
-- the Audit log show it, with the 10-second Undo. member_follow_ups.source may
-- now also be 'social_links'. Every existing value stays allowed.
--
-- Additive and re-runnable.

alter table public.member_follow_ups drop constraint if exists member_follow_ups_source_check;
alter table public.member_follow_ups
  add constraint member_follow_ups_source_check
  check (source in ('stuck', 'unpaid', 'abandoned', 'documents', 'status_image', 'parents', 'social_links'));
