-- 166_location_aliases.sql
--
-- Locations clean-up (owner, 13 Oct 2026).
--
-- jobs.area / tutor_areas.area / profiles.area stay the plain text a member
-- typed and are NEVER rewritten. Two new tables say what a typed value means:
--
--   location_area_aliases  "Liaqatbad" (Karachi) is the curated area
--                          Liaqatabad. From then on that text counts as the
--                          curated area everywhere: area filters, area hubs,
--                          display labels, sitemaps and the hub's 3+ rule.
--   location_ignored       "Not an area" — a school's name, an address,
--                          "online", junk. Hidden from the review list.
--
-- Nothing is deleted: an alias or an ignore is taken back by stamping
-- removed_at. public.area_same() is the one SQL comparison ("is this saved area
-- the wanted one?") and rank_tutors() now uses it, so a tutor who typed
-- "Liaqatbad" ranks for the Liaqatabad filter.
--
-- Also seeds the curated areas the owner listed (skipping any that exist).
-- Idempotent throughout.


-- ---------------------------------------------------------------- tables ---

create table if not exists public.location_area_aliases (
  id bigint generated always as identity primary key,
  city_id int not null references public.location_cities(id) on delete cascade,
  -- The text as members typed it. Compared lower-case and trimmed.
  raw text not null,
  area_id int not null references public.location_areas(id) on delete cascade,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid
);

create unique index if not exists location_area_aliases_live_uniq
  on public.location_area_aliases (city_id, lower(btrim(raw)))
  where removed_at is null;

create table if not exists public.location_ignored (
  id bigint generated always as identity primary key,
  -- The city the value was typed under ('' when none).
  city text not null default '',
  raw text not null,
  reason text not null default 'junk' check (reason in ('school', 'address', 'online', 'junk')),
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid
);

create unique index if not exists location_ignored_live_uniq
  on public.location_ignored (lower(btrim(city)), lower(btrim(raw)))
  where removed_at is null;

alter table public.location_area_aliases enable row level security;
alter table public.location_ignored enable row level security;

do $$
begin
  -- Reference data, like location_areas: world-readable (the browse filters and
  -- the hub redirect read it with the publishable key). Written by the server only.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'location_area_aliases' and policyname = 'location_area_aliases_public_read') then
    create policy location_area_aliases_public_read on public.location_area_aliases for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'location_ignored' and policyname = 'location_ignored_admin_read') then
    create policy location_ignored_admin_read on public.location_ignored for select using (public.is_admin());
  end if;
end
$$;

grant select on public.location_area_aliases to anon, authenticated;
grant select on public.location_ignored to authenticated;
grant all on public.location_area_aliases, public.location_ignored to service_role;

-- ------------------------------------------------------------ area_same ---

-- The curated name a saved area stands for under a city (any city when the
-- city is not known), or the saved text itself.
create or replace function public.area_canon(p_city text, p_area text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (
      select la.name
      from location_area_aliases al
      join location_areas la on la.id = al.area_id
      join location_cities lc on lc.id = al.city_id
      where al.removed_at is null
        and lower(btrim(al.raw)) = lower(btrim(p_area))
        and (p_city is null or btrim(p_city) = '' or lower(lc.name) = lower(btrim(p_city)))
      order by al.id
      limit 1
    ),
    btrim(p_area)
  )
$$;

create or replace function public.area_same(p_city text, p_saved text, p_wanted text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_saved is not null and p_wanted is not null and (
    lower(btrim(p_saved)) = lower(btrim(p_wanted))
    or lower(public.area_canon(p_city, p_saved)) = lower(public.area_canon(p_city, p_wanted))
  )
$$;

grant execute on function public.area_canon(text, text) to anon, authenticated, service_role;
grant execute on function public.area_same(text, text, text) to anon, authenticated, service_role;

-- rank_tutors(): the area match becomes area_same(). The function is rebuilt
-- from its LIVE definition with that one expression replaced, so nothing else
-- about it changes (create or replace keeps its grants).
do $$
declare
  fn record;
  def text;
  needle constant text := 'lower(a) = lower(p_area)';
begin
  for fn in
    select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'rank_tutors'
  loop
    def := pg_get_functiondef(fn.oid);
    if position('area_same(' in def) > 0 then
      continue;
    end if;
    if position(needle in def) = 0 then
      raise exception 'rank_tutors: the area match was not found — nothing changed';
    end if;
    execute replace(def, needle, 'public.area_same(p_city, a, p_area)');
  end loop;
end
$$;

-- ------------------------------------------------------- curated areas ---

-- The owner's list. An area already in the city (whatever its case) is skipped.
insert into public.location_areas (city_id, name)
select c.id, v.area
from (
  values
    ('Lahore', 'Harbanspura'), ('Lahore', 'Thokar Niaz Baig'), ('Lahore', 'Valencia Town'),
    ('Lahore', 'Badian Road'), ('Lahore', 'Izmir Town'), ('Lahore', 'Manawan'), ('Lahore', 'Ichra'),
    ('Lahore', 'Mazang'), ('Lahore', 'Dharampura'), ('Lahore', 'Sabzazar'), ('Lahore', 'Taj Bagh'),
    ('Lahore', 'Sant Nagar'), ('Lahore', 'Shalamar Town'), ('Lahore', 'Salamatpura'),
    ('Lahore', 'Askari 9'), ('Lahore', 'Askari 11'),
    ('Karachi', 'Parsi Colony'), ('Karachi', 'Liaqatabad'), ('Karachi', 'Gulzar-e-Hijri'),
    ('Karachi', 'Civil Lines'), ('Karachi', 'Garden West'), ('Karachi', 'Garden East'),
    ('Karachi', 'Gulshan-e-Hadeed'), ('Karachi', 'Gulistan-e-Maymar'), ('Karachi', 'PIB Colony'),
    ('Karachi', 'Pak Colony'), ('Karachi', 'Qayyumabad'), ('Karachi', 'Tipu Sultan'),
    ('Karachi', 'Azam Town'), ('Karachi', 'Gizri'), ('Karachi', 'Gulshan-e-Roomi'),
    ('Karachi', 'KAECHS'), ('Karachi', 'Kazimabad'), ('Karachi', 'Kharadar'),
    ('Karachi', 'Mehmoodabad'), ('Karachi', 'Model Colony'), ('Karachi', 'Sharfabad'),
    ('Karachi', 'Tariq Road'), ('Karachi', 'Saadi Town'), ('Karachi', 'Soldier Bazar'),
    ('Karachi', 'Metroville'), ('Karachi', 'Malir'), ('Karachi', 'New Karachi'),
    ('Karachi', 'Korangi'), ('Karachi', 'Bahria Town Karachi'),
    ('Rawalpindi', 'Chaklala'), ('Rawalpindi', 'Fauji Colony'), ('Rawalpindi', 'Airport Housing Society'),
    ('Islamabad', 'E-11'), ('Islamabad', 'Bani Gala'), ('Islamabad', 'Ghauri Town'),
    ('Islamabad', 'Zaraj Housing Society')
) as v(city, area)
join public.location_cities c on lower(c.name) = lower(v.city)
where not exists (
  select 1 from public.location_areas la
  where la.city_id = c.id and lower(btrim(la.name)) = lower(v.area)
);

