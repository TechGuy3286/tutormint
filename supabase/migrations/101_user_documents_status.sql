-- 101_user_documents_status.sql  (PR106-H3 §1.4)
--
-- The "Replace" upload flow inserts a NEW user_documents row each time and never
-- retires the old one, so a tutor who re-uploaded accumulated many rows of the
-- same kind (one had 14 CNIC rows). Add a status so the extras can be PAUSED —
-- hidden, but the files and rows are kept, nothing deleted.
--
-- Additive and safe: the column defaults 'active', so every existing row stays
-- visible exactly as before until the pause script marks the older duplicates
-- 'paused'. Read paths filter to active where they list/count documents.

alter table public.user_documents
  add column if not exists status text not null default 'active'
  check (status in ('active', 'paused'));

-- The duplicate lookups are per (user, kind); index them so the pause pass and
-- the active-only reads stay cheap.
create index if not exists user_documents_user_kind_status_idx
  on public.user_documents (user_id, kind, status);
