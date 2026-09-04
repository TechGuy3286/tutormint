-- 45: the verification selfie becomes a private document.
--
-- The tutor settings page uploaded the selfie through the same helper as the
-- avatar, into the PUBLIC tutor-media bucket -- a face photo held "for
-- verification only", on a URL anyone could fetch. Zero rows carried a
-- selfie_url when this was written, so the writer was the whole defect: this
-- migration only widens user_documents.kind so the selfie can travel the same
-- private path as the CNIC (identity-docs bucket, watermark-free preview is
-- unnecessary here but the derivative pipeline strips EXIF/GPS, which a phone
-- selfie carries).
--
-- tutor_profiles.selfie_url stays in place, unread and unwritten, for the
-- same reason as cnic_front_url/cnic_back_url: dropping a column is not this
-- migration's job and the count-zero fact should stay checkable.

alter table public.user_documents
  drop constraint if exists user_documents_kind_check;

alter table public.user_documents
  add constraint user_documents_kind_check
  check (kind in ('cnic', 'degree', 'selfie'));
