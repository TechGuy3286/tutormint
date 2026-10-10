-- 160_document_rotation_cnic_read.sql  (owner, 10 Oct 2026)
--
-- Two display/assist facts on a stored document. Additive; nothing existing
-- changes shape, no file is touched, no policy changes (user_documents has no
-- member UPDATE policy — every write below is a server path).
--
-- 1. rotation — a DISPLAY setting staff save from the document viewer when a
--    photo was uploaded sideways or upside down. 0 / 90 / 180 / 270, clockwise.
--    The stored original and preview are never modified: the preview route
--    turns the picture as it serves it.
--
-- 2. cnic_read_* — the CNIC number as READ FROM THE PHOTO of a CNIC front
--    (lib/cnicReader). A SUGGESTION ONLY: it pre-fills the number box for staff
--    or for the member, and becomes the member's number (profiles.cnic_number)
--    only when a person presses Save / Approve / Next. Cached here so one
--    uploaded image is read at most once.
--      cnic_read_status: 'reading' (a read is in flight), 'found', 'none'.

alter table public.user_documents
  add column if not exists rotation smallint not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_documents_rotation_check') then
    alter table public.user_documents
      add constraint user_documents_rotation_check check (rotation in (0, 90, 180, 270));
  end if;
end $$;

alter table public.user_documents
  add column if not exists cnic_read_status text,
  add column if not exists cnic_read_number text,
  add column if not exists cnic_read_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_documents_cnic_read_status_check') then
    alter table public.user_documents
      add constraint user_documents_cnic_read_status_check
      check (cnic_read_status is null or cnic_read_status in ('reading', 'found', 'none'));
  end if;
end $$;

comment on column public.user_documents.rotation is
  'Display rotation in degrees clockwise (0/90/180/270), saved by staff. The stored file is never changed.';
comment on column public.user_documents.cnic_read_number is
  'SUGGESTED CNIC number read from the photo. Never the confirmed number — that is profiles.cnic_number, saved only by a person.';
