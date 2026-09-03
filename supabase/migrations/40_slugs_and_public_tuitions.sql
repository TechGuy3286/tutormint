-- 40_slugs_and_public_tuitions.sql — readable URLs for tutors, a public URL
-- for every tuition, and a redirect table so no old link ever dies.
--
-- THREE THINGS, all of them about addresses.
--
-- 1. TUTOR SLUGS STOP CARRYING PHONE DIGITS. The bulk import minted
--    `ali-raza-2221` — a name plus the last four digits of the mobile. Four
--    digits of a Pakistani mobile is not a secret on its own, but it is
--    personal data in a URL that gets pasted into WhatsApp, indexed by Google
--    and printed on a social post, and it says nothing to a parent reading it.
--    The canonical form is `ali-raza-physics-tutor-lahore`: the name, the
--    subject the tutor actually competes in, the word a parent searches for,
--    and the city.
--
--    SEVEN OF SEVENTEEN TUTORS HAD NO SLUG AT ALL. handle_new_user() creates a
--    tutor_profiles row and never sets one, so every tutor who registered
--    normally — as opposed to being seeded or bulk-imported — had a public
--    profile with no address at all. This backfill is the first time those
--    seven are reachable.
--
-- 2. SLUG HISTORY. Every slug this migration replaces is written to
--    slug_history, and /tutor/[slug] 301s an old one to the tutor's CURRENT
--    slug. Chains are impossible by construction: history maps old_slug ->
--    tutor_id and the redirect reads that tutor's live slug, so however many
--    times an address changes there is always exactly one hop.
--
-- 3. TUITIONS GET A PAGE. Until now a job existed only as a row in the browse
--    list; there was no URL for one, so Google could not index a tuition and
--    JobPosting structured data had nowhere to live. `jobs.public_slug` is set
--    once, by a BEFORE INSERT trigger, and never changes — a job's address is
--    the one thing about it that must not move, because a notification, a
--    WhatsApp share and a search result all point at it.
--
-- Backed up before applying: supabase/backups/full-20260904-024418.sql.

begin;

-- ---------------------------------------------------------------- slugify ---
-- One implementation, mirrored in lib/slugs.ts for the two places TypeScript
-- has to produce the same string (the admin Suggest button and the import).
-- Both sides are exercised by the same rows, so a divergence shows up as a
-- Suggest that proposes something different from what the trigger wrote.
--
-- Non-latin input reduces to the empty string here — a name written only in
-- Urdu script cannot become an ASCII slug, and inventing a transliteration
-- would be worse than the caller's fallback. Every caller below has one.
create or replace function public.tm_slugify(p_text text)
returns text
language sql
immutable
as $fn$
  select trim(both '-' from
    regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g')
  )
$fn$;

comment on function public.tm_slugify(text) is
  'ASCII slug: lowercase, non-alphanumerics collapsed to single hyphens, trimmed.';

-- ------------------------------------------------------------ slug history ---
create table if not exists public.slug_history (
  old_slug   text primary key,
  tutor_id   uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists slug_history_tutor_idx on public.slug_history (tutor_id);

alter table public.slug_history enable row level security;

-- A public SELECT and nothing else. This table is a URL redirect map: the pair
-- (an address that used to work, the account it belongs to) is exactly what
-- the old URL already told anybody who had it. Writes have no policy at all,
-- so only the service role — this migration and the admin slug route — can add
-- a row.
drop policy if exists slug_history_public_read on public.slug_history;
create policy slug_history_public_read on public.slug_history
  for select using (true);

comment on table public.slug_history is
  'Retired tutor slugs. /tutor/[slug] 301s these to the tutor CURRENT slug, so a chain can never form.';

-- -------------------------------------------------- the tutor main subject ---
-- The subject the tutor is actually in competition for, which is the one worth
-- putting in their address. The same rule the position widget uses: of the
-- subjects this tutor teaches, the one with the largest pool of LISTED tutors.
-- A subject where they are alone tells a parent nothing and ranks for nothing.
--
-- Ties break on master_id so the result is stable — an address that changed
-- because two pools drew level would be an address that changed for no reason
-- anybody could see.
create or replace function public.tutor_main_subject_label(p_tutor uuid)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  with mine as (
    select ts.master_id from public.tutor_subjects ts where ts.tutor_id = p_tutor
  ),
  pool as (
    select ts.master_id, count(*)::int as n
    from public.tutor_subjects ts
    join public.tutor_directory td on td.id = ts.tutor_id
    where ts.master_id in (select master_id from mine)
    group by ts.master_id
  )
  select coalesce(sub.name, lvl.name)
  from mine
  left join pool on pool.master_id = mine.master_id
  join public.taxonomy_master tm on tm.id = mine.master_id
  left join public.taxonomy_subjects sub on sub.slug = tm.subject_slug
  left join public.taxonomy_levels lvl on lvl.slug = tm.level_slug
  order by coalesce(pool.n, 0) desc, mine.master_id
  limit 1
$fn$;

-- --------------------------------------------------- the canonical address ---
-- name + main subject + "tutor" + city, with a 4-character suffix ONLY when
-- that address is already taken by somebody else.
--
-- The subject is skipped when the name already contains it (a tutor called
-- "Physics Academy" would otherwise be physics-academy-physics-tutor), and the
-- city likewise. Repeating a word in a URL is keyword stuffing, and it reads
-- as broken to a person.
create or replace function public.tutor_canonical_slug(p_tutor uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_name    text;
  v_city    text;
  v_base    text;
  v_part    text;
  v_taken   boolean;
begin
  select public.tm_slugify(tp.full_name), public.tm_slugify(tp.city)
    into v_name, v_city
  from public.tutor_profiles tp where tp.id = p_tutor;

  if v_name is null then return null; end if;
  if v_name = '' then v_name := 'tutor'; end if;

  v_base := v_name;

  v_part := public.tm_slugify(public.tutor_main_subject_label(p_tutor));
  if v_part is not null and v_part <> '' and position(v_part in v_base) = 0 then
    -- Long level names ("grade-9-10-science") would otherwise dominate the
    -- address; 28 characters keeps the whole thing readable at a glance.
    v_base := v_base || '-' || trim(both '-' from left(v_part, 28));
  end if;

  if position('tutor' in v_base) = 0 then
    v_base := v_base || '-tutor';
  end if;

  if v_city is not null and v_city <> '' and position(v_city in v_base) = 0 then
    v_base := v_base || '-' || v_city;
  end if;

  v_base := trim(both '-' from left(v_base, 80));

  -- Taken by another tutor, or reserved by another tutor's retired address.
  select exists (
    select 1 from public.tutor_profiles where slug = v_base and id <> p_tutor
    union all
    select 1 from public.slug_history where old_slug = v_base and tutor_id <> p_tutor
  ) into v_taken;

  if v_taken then
    v_base := trim(both '-' from left(v_base, 75)) || '-' || substr(md5(p_tutor::text), 1, 4);
  end if;

  return v_base;
end $fn$;

-- ------------------------------------------------------- apply a new slug ---
-- The ONE place a tutor's address changes. Writing the old one to history is
-- part of the same statement as writing the new one, so there is no code path
-- — and no admin screen — that can move an address without leaving a redirect
-- behind. That is why there is no "also keep the old URL" checkbox anywhere in
-- the UI: it is not a choice anybody gets to make.
create or replace function public.set_tutor_slug(p_tutor uuid, p_slug text)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old text;
begin
  p_slug := public.tm_slugify(p_slug);
  if p_slug is null or p_slug = '' then
    raise exception 'A profile address cannot be empty.';
  end if;

  select slug into v_old from public.tutor_profiles where id = p_tutor for update;

  if exists (select 1 from public.tutor_profiles where slug = p_slug and id <> p_tutor) then
    raise exception 'That profile address is already in use.';
  end if;
  if exists (select 1 from public.slug_history where old_slug = p_slug and tutor_id <> p_tutor) then
    raise exception 'That profile address belonged to another tutor and cannot be reused.';
  end if;

  if v_old is not distinct from p_slug then
    return p_slug;
  end if;

  -- An address being taken up again is no longer a redirect.
  delete from public.slug_history where old_slug = p_slug;

  update public.tutor_profiles set slug = p_slug where id = p_tutor;

  if v_old is not null and v_old <> '' then
    insert into public.slug_history (old_slug, tutor_id)
    values (v_old, p_tutor)
    on conflict (old_slug) do update set tutor_id = excluded.tutor_id;
  end if;

  return p_slug;
end $fn$;

revoke all on function public.set_tutor_slug(uuid, text) from public;
revoke all on function public.set_tutor_slug(uuid, text) from anon;
revoke all on function public.set_tutor_slug(uuid, text) from authenticated;

-- ------------------------------------------------------- tutor backfill ------
do $backfill$
declare
  r     record;
  v_new text;
begin
  for r in select id, slug from public.tutor_profiles order by created_at loop
    v_new := public.tutor_canonical_slug(r.id);
    if v_new is null or v_new = '' then continue; end if;
    if r.slug is not distinct from v_new then continue; end if;
    perform public.set_tutor_slug(r.id, v_new);
  end loop;
end $backfill$;

-- ------------------------------------------------------- the 301 lookup ------
-- The retired address -> the tutor's CURRENT address, in one query.
--
-- SECURITY DEFINER because tutor_profiles is owner-or-admin under RLS, so a
-- public page reading it directly would get nothing and every old link would
-- 404. It returns one string, the slug, which is already public — and it can
-- never produce a chain, because it reads the live slug rather than following
-- history forward.
create or replace function public.tutor_slug_redirect(p_old text)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select tp.slug
  from public.slug_history sh
  join public.tutor_profiles tp on tp.id = sh.tutor_id
  where sh.old_slug = p_old
  limit 1
$fn$;

grant execute on function public.tutor_slug_redirect(text) to anon;
grant execute on function public.tutor_slug_redirect(text) to authenticated;

-- --------------------------------------------------- public tuition pages ---
alter table public.jobs add column if not exists public_slug text;

create unique index if not exists jobs_public_slug_uniq
  on public.jobs (public_slug) where public_slug is not null;

-- title + city + a short id. The id is what makes it unique and it is derived
-- from the row's own uuid, so the same job always produces the same address —
-- a slug that depended on a counter would differ between a backfill and a
-- rebuild.
create or replace function public.job_public_slug(p_id uuid, p_title text, p_city text)
returns text
language sql
immutable
as $fn$
  select trim(both '-' from left(
    case
      when coalesce(public.tm_slugify(p_city), '') = ''
        then coalesce(nullif(public.tm_slugify(p_title), ''), 'tuition')
      when position(public.tm_slugify(p_city) in coalesce(public.tm_slugify(p_title), '')) > 0
        then public.tm_slugify(p_title)
      else coalesce(nullif(public.tm_slugify(p_title), ''), 'tuition')
             || '-' || public.tm_slugify(p_city)
    end, 70)) || '-' || substr(md5(p_id::text), 1, 6)
$fn$;

create or replace function public.set_job_public_slug()
returns trigger
language plpgsql
as $fn$
begin
  if new.public_slug is null then
    new.public_slug := public.job_public_slug(new.id, new.title, new.city);
  end if;
  return new;
end $fn$;

drop trigger if exists jobs_set_public_slug on public.jobs;
create trigger jobs_set_public_slug
  before insert on public.jobs
  for each row execute function public.set_job_public_slug();

update public.jobs
   set public_slug = public.job_public_slug(id, title, city)
 where public_slug is null;

-- ------------------------------------------------------------- the 410 -------
-- A closed or hired tuition must answer 410, not a blank page and not a 404 —
-- 404 says "there was never anything here", which is untrue and is the slower
-- of the two signals for getting a page out of an index.
--
-- Anon can only read OPEN jobs (jobs_public_read_open), so without this the
-- page cannot tell "filled last week" from "never existed" and both would be
-- 404. SECURITY DEFINER, returning TWO FACTS ONLY: what state the address is
-- in, and the city, which is what the page needs to offer a useful link
-- onward. No title, no parent, no description — nothing a closed tuition
-- should still be handing out.
create or replace function public.job_page_status(p_slug text)
returns table (status text, city text)
language sql
stable
security definer
set search_path = public
as $fn$
  select j.status, j.city from public.jobs j where j.public_slug = p_slug limit 1
$fn$;

grant execute on function public.job_page_status(text) to anon;
grant execute on function public.job_page_status(text) to authenticated;

commit;
