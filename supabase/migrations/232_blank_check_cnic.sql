-- 232_blank_check_cnic.sql (owner, 16 Nov 2026)
--
-- "CNIC image looks blank": the blank/dark check of migration 225 now also
-- covers the CNIC front and back images (item 'cnic', ref = the user_documents
-- id), with the same thresholds. This only widens the item check. No row
-- changes; nothing is deleted.

alter table public.photo_blank_checks drop constraint if exists photo_blank_checks_item_check;
alter table public.photo_blank_checks
  add constraint photo_blank_checks_item_check
  check (item in ('photo', 'selfie', 'cnic'));
