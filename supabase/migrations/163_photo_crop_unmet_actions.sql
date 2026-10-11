-- 163_photo_crop_unmet_actions.sql  (owner, 11 Oct 2026)
--
-- ADDITIVE. No row is deleted or rewritten; nothing existing changes meaning.
--
-- 1. avatar_rotations — a profile photo's saved DISPLAY setting now also holds a
--    crop. `crop` = { x, y, s } as fractions of the (rotated) original: left edge
--    / width, top edge / height, side / width. `rotated_url` is the derived copy
--    in use (turned and/or cropped). `source` says who made it: 'staff' (the
--    admin viewer) or 'member' (the crop step at upload, where original_url is
--    the photo the member uploaded and rotated_url their cropped square).
--    The uploaded original is never changed.
-- 2. search_unmet — who searched, so staff and test accounts can be left out of
--    "Unmet searches": user_id (null for a guest) and is_test (a test, seed or
--    hidden account at the time). Rows logged before this have neither.
-- 3. search_unmet_done — "Mark done" on an unmet-search card: the search, how
--    many times it had been made, who marked it and when, an optional note. A
--    later identical search is newer than done_at and so makes a new card.
--    Admin-read; written by the server only.
-- 4. taxonomy_aliases.kind also takes 'city' (slug = the city's name), so a
--    Search word can point at a city ("swl" → Sahiwal).
-- 5. The "Hiring post for {city}" text, editable with the other templates.

alter table public.avatar_rotations
  add column if not exists crop   jsonb,
  add column if not exists source text not null default 'staff';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'avatar_rotations_source_check') then
    alter table public.avatar_rotations add constraint avatar_rotations_source_check check (source in ('staff', 'member'));
  end if;
end $$;

alter table public.search_unmet
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists is_test boolean not null default false;

create table if not exists public.search_unmet_done (
  id            uuid primary key default gen_random_uuid(),
  query_key     text not null,
  query         text not null,
  searches      integer not null default 0,
  note          text,
  done_by       uuid references auth.users(id) on delete set null,
  done_by_email text,
  done_by_name  text,
  done_at       timestamptz not null default now()
);
create index if not exists search_unmet_done_key_idx on public.search_unmet_done (query_key, done_at desc);
alter table public.search_unmet_done enable row level security;
drop policy if exists search_unmet_done_admin_read on public.search_unmet_done;
create policy search_unmet_done_admin_read on public.search_unmet_done
  for select to authenticated using (public.is_admin());

alter table public.taxonomy_aliases drop constraint if exists taxonomy_aliases_kind_check;
alter table public.taxonomy_aliases add constraint taxonomy_aliases_kind_check
  check (kind in ('category', 'level', 'subject', 'city'));

insert into public.admin_message_templates (key, title, subject, body) values
  ('city_hiring_post', 'Hiring post for a city', 'Hiring tutors in {city}',
   'Hiring tutors in {city}! Join TutorMint free — find home and online tuitions near you. No commission, no middleman. Apply: https://tutormint.org/apply')
on conflict (key) do nothing;
