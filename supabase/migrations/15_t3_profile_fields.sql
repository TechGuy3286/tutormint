-- 15_t3_profile_fields.sql
-- Columns and tables T3 needs for profile completion, verification and
-- document handling. ADD/CREATE only -- nothing is dropped or retyped.
--
-- Idempotent throughout.

begin;

-- ---------------------------------------------------------------------------
-- tutor_profiles: gender and the video submission counter.
-- headline already exists and is the LinkedIn-style tagline.
-- ---------------------------------------------------------------------------
alter table public.tutor_profiles add column if not exists gender text;
alter table public.tutor_profiles add column if not exists video_attempts integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tutor_profiles_gender_check') then
    alter table public.tutor_profiles
      add constraint tutor_profiles_gender_check
      check (gender is null or gender in ('male','female','other'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- profiles: verification submission state, so the T3.5 admin queue can find
-- what is waiting. 'none' -> 'submitted' -> approved (cnic_verified_at set) or
-- 'rejected'. The *_verified_at columns stay the source of truth for approval.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists verification_state text not null default 'none';
alter table public.profiles add column if not exists verification_submitted_at timestamptz;
alter table public.profiles add column if not exists verification_rejection_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_verification_state_check') then
    alter table public.profiles
      add constraint profiles_verification_state_check
      check (verification_state in ('none','submitted','approved','rejected'));
  end if;
end $$;

-- Existing approved parents should read as approved rather than 'none'.
update public.profiles
set verification_state = 'approved'
where cnic_verified_at is not null
  and address_verified_at is not null
  and verification_state = 'none';

-- ---------------------------------------------------------------------------
-- user_documents: CNIC scans and degree certificates.
--
-- original_path  -> private identity-docs bucket. Never served directly.
-- preview_path   -> downscaled, diagonally watermarked derivative, in the SAME
--                   private bucket. Served only through /api/documents/[id]/preview,
--                   which checks rights per document kind.
--
-- A row is the only handle the client ever sees; paths never reach the browser.
-- ---------------------------------------------------------------------------
create table if not exists public.user_documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('cnic','degree')),
  label         text,
  original_path text not null,
  preview_path  text,
  created_at    timestamptz not null default now()
);

create index if not exists user_documents_user_kind_idx on public.user_documents (user_id, kind);

alter table public.user_documents enable row level security;

do $$
begin
  -- Owner and admin can see the rows. Note this governs the METADATA only;
  -- the bytes are gated separately by the preview route, and degree previews
  -- are deliberately visible to signed-in parents through that route.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_documents' and policyname='user_documents_owner_read') then
    create policy user_documents_owner_read on public.user_documents
      for select using (user_id = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_documents' and policyname='user_documents_owner_write') then
    create policy user_documents_owner_write on public.user_documents
      for insert with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_documents' and policyname='user_documents_owner_delete') then
    create policy user_documents_owner_delete on public.user_documents
      for delete using (user_id = auth.uid() or public.is_admin());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Degree previews are visible to any SIGNED-IN user (a parent looking at a
-- tutor's qualifications), but user_documents rows are owner+admin only under
-- RLS. This function is the narrow exception: given a document id it returns
-- the PREVIEW path and only when the document is a degree. It can never reach
-- a CNIC and never returns original_path.
--
-- SECURITY DEFINER with a pinned search_path, and execute granted only to
-- authenticated -- anon cannot call it at all.
-- ---------------------------------------------------------------------------
create or replace function public.get_degree_preview_path(doc_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.preview_path
  from public.user_documents d
  where d.id = doc_id
    and d.kind = 'degree'
    and d.preview_path is not null
$$;

revoke all on function public.get_degree_preview_path(uuid) from public, anon;
grant execute on function public.get_degree_preview_path(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- phone_otps already has phone/code/expires_at/consumed_at/attempts. Add the
-- per-hour rate-limit key and an index for the lookups the route does.
-- ---------------------------------------------------------------------------
alter table public.phone_otps add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists phone_otps_phone_created_idx on public.phone_otps (phone, created_at desc);

commit;
