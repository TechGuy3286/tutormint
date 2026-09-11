-- 73_location_tables.sql
--
-- Cities and areas become DATA, not a hardcoded array in a component (owner,
-- 11 Sep 2026). Adding an area later is an INSERT, not a code change and a
-- redeploy — the same shape the academic taxonomy already uses.
--
-- SHAPE (mirrors taxonomy_categories / taxonomy_levels):
--   location_cities (id, name unique, sort_order)  — 23 curated cities.
--   location_areas  (id, city_id -> cities, name)  — 249 curated areas, area is
--                                                     dependent on its city.
-- Both are reference data: world-readable, admin-writable (the same RLS the
-- taxonomy tables carry, added by the 06 policy loop on the next run of that
-- migration; this migration also adds the policies directly so a fresh apply is
-- complete on its own).
--
-- SORTING. Cities: sort_order 1..4 pins Lahore, Karachi, Islamabad, Rawalpindi
-- (the largest markets) first; every other city defaults to 100, so
-- `order by sort_order, name` lists the big four then alphabetical, and a city
-- inserted later slots in alphabetically with no code change. Areas sort by
-- name within their city (`order by name`).
--
-- FREE TEXT IS NOT STORED HERE. jobs.city / jobs.area / profiles.city|area /
-- tutor_profiles.city|area stay plain text columns holding the display name —
-- ranking compares them with lower(), and a member whose locality is not one of
-- 23 cities types their own. A free-text value is therefore, by construction,
-- any city/area string in use that is NOT in these tables; lib/locations.ts
-- `unmappedLocations()` surfaces them for review (and promotion = an insert
-- here). Keeping the columns as strings is also why NOTHING existing becomes
-- invisible: every current value still resolves exactly as before.
--
-- The AUTHORITATIVE list is the owner's dataset — names are stored verbatim
-- ("PECHS", "Gulshan-e-Iqbal", "Federal B Area", "Bahria Town Lahore",
-- "6th Road"); nothing was corrected or added.
--
-- Backup taken before apply.

create table if not exists public.location_cities (
  id serial primary key,
  name text unique not null,
  sort_order int not null default 100
);

create table if not exists public.location_areas (
  id serial primary key,
  city_id int not null references public.location_cities(id) on delete cascade,
  name text not null
);

create unique index if not exists location_areas_city_name_uniq
  on public.location_areas (city_id, name);

create index if not exists location_areas_city_idx
  on public.location_areas (city_id);

alter table public.location_cities enable row level security;
alter table public.location_areas  enable row level security;

-- Reference data: world readable, admin writable — the taxonomy pattern.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='location_cities' and policyname='location_cities_public_read') then
    create policy location_cities_public_read on public.location_cities for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='location_cities' and policyname='location_cities_admin_write') then
    create policy location_cities_admin_write on public.location_cities for all using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='location_areas' and policyname='location_areas_public_read') then
    create policy location_areas_public_read on public.location_areas for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='location_areas' and policyname='location_areas_admin_write') then
    create policy location_areas_admin_write on public.location_areas for all using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;

grant select on public.location_cities to anon, authenticated;
grant select on public.location_areas  to anon, authenticated;

-- ─────────────────────────────────── the owner's dataset (verbatim) ───────
insert into public.location_cities (name, sort_order) values
  ('Karachi', 2),
  ('Lahore', 1),
  ('Islamabad', 3),
  ('Rawalpindi', 4),
  ('Faisalabad', 100),
  ('Multan', 100),
  ('Peshawar', 100),
  ('Quetta', 100),
  ('Sialkot', 100),
  ('Gujranwala', 100),
  ('Bahawalpur', 100),
  ('Sargodha', 100),
  ('Hyderabad', 100),
  ('Abbottabad', 100),
  ('Gujrat', 100),
  ('Sahiwal', 100),
  ('Mardan', 100),
  ('Mingora', 100),
  ('Wah Cantt', 100),
  ('Dera Ghazi Khan', 100),
  ('Larkana', 100),
  ('Sukkur', 100),
  ('Jhelum', 100)
on conflict (name) do update set sort_order = excluded.sort_order;

insert into public.location_areas (city_id, name)
select c.id, v.name from (values
  ('Karachi', 'Clifton'),
  ('Karachi', 'DHA Karachi'),
  ('Karachi', 'Gulshan-e-Iqbal'),
  ('Karachi', 'Gulistan-e-Johar'),
  ('Karachi', 'North Nazimabad'),
  ('Karachi', 'Nazimabad'),
  ('Karachi', 'PECHS'),
  ('Karachi', 'Bahadurabad'),
  ('Karachi', 'Saddar'),
  ('Karachi', 'Korangi'),
  ('Karachi', 'Landhi'),
  ('Karachi', 'Malir'),
  ('Karachi', 'Shah Faisal Colony'),
  ('Karachi', 'Federal B Area'),
  ('Karachi', 'Buffer Zone'),
  ('Karachi', 'North Karachi'),
  ('Karachi', 'Orangi Town'),
  ('Karachi', 'Lyari'),
  ('Karachi', 'Surjani Town'),
  ('Karachi', 'Scheme 33'),
  ('Lahore', 'DHA Lahore'),
  ('Lahore', 'Gulberg'),
  ('Lahore', 'Model Town'),
  ('Lahore', 'Johar Town'),
  ('Lahore', 'Wapda Town'),
  ('Lahore', 'Bahria Town Lahore'),
  ('Lahore', 'Garden Town'),
  ('Lahore', 'Faisal Town'),
  ('Lahore', 'Township'),
  ('Lahore', 'Allama Iqbal Town'),
  ('Lahore', 'Cantt'),
  ('Lahore', 'Cavalry Ground'),
  ('Lahore', 'Gulshan-e-Ravi'),
  ('Lahore', 'Samanabad'),
  ('Lahore', 'Shadman'),
  ('Lahore', 'Muslim Town'),
  ('Lahore', 'Garhi Shahu'),
  ('Lahore', 'Mughalpura'),
  ('Lahore', 'Raiwind Road'),
  ('Lahore', 'Lake City'),
  ('Islamabad', 'F-6'),
  ('Islamabad', 'F-7'),
  ('Islamabad', 'F-8'),
  ('Islamabad', 'F-10'),
  ('Islamabad', 'F-11'),
  ('Islamabad', 'G-5'),
  ('Islamabad', 'G-6'),
  ('Islamabad', 'G-7'),
  ('Islamabad', 'G-8'),
  ('Islamabad', 'G-9'),
  ('Islamabad', 'G-10'),
  ('Islamabad', 'G-11'),
  ('Islamabad', 'I-8'),
  ('Islamabad', 'I-9'),
  ('Islamabad', 'I-10'),
  ('Islamabad', 'E-7'),
  ('Islamabad', 'DHA Islamabad'),
  ('Islamabad', 'Bahria Town Islamabad'),
  ('Islamabad', 'Blue Area'),
  ('Islamabad', 'Bani Gala'),
  ('Rawalpindi', 'Saddar'),
  ('Rawalpindi', 'Satellite Town'),
  ('Rawalpindi', 'Chaklala'),
  ('Rawalpindi', 'Westridge'),
  ('Rawalpindi', 'Peshawar Road'),
  ('Rawalpindi', 'Murree Road'),
  ('Rawalpindi', '6th Road'),
  ('Rawalpindi', 'Commercial Market'),
  ('Rawalpindi', 'Bahria Town Rawalpindi'),
  ('Rawalpindi', 'DHA Islamabad-Rawalpindi'),
  ('Rawalpindi', 'Adiala Road'),
  ('Rawalpindi', 'Lalazar'),
  ('Rawalpindi', 'Scheme 3'),
  ('Rawalpindi', 'Raja Bazaar'),
  ('Rawalpindi', 'Tench Bhata'),
  ('Faisalabad', 'D Ground'),
  ('Faisalabad', 'Peoples Colony'),
  ('Faisalabad', 'Gulberg'),
  ('Faisalabad', 'Madina Town'),
  ('Faisalabad', 'Canal Road'),
  ('Faisalabad', 'Susan Road'),
  ('Faisalabad', 'Satiana Road'),
  ('Faisalabad', 'Jaranwala Road'),
  ('Faisalabad', 'Sargodha Road'),
  ('Faisalabad', 'Kohinoor City'),
  ('Faisalabad', 'Millat Town'),
  ('Faisalabad', 'Ghulam Muhammad Abad'),
  ('Multan', 'Gulgasht Colony'),
  ('Multan', 'Cantt'),
  ('Multan', 'Bosan Road'),
  ('Multan', 'Mumtazabad'),
  ('Multan', 'Shah Rukn-e-Alam Colony'),
  ('Multan', 'New Multan'),
  ('Multan', 'Wapda Town'),
  ('Multan', 'DHA Multan'),
  ('Multan', 'Chungi No. 6'),
  ('Multan', 'Suraj Miani'),
  ('Multan', 'MDA Chowk'),
  ('Peshawar', 'University Town'),
  ('Peshawar', 'Hayatabad'),
  ('Peshawar', 'Dabgari Gardens'),
  ('Peshawar', 'Saddar'),
  ('Peshawar', 'Gulbahar'),
  ('Peshawar', 'Warsak Road'),
  ('Peshawar', 'Ring Road'),
  ('Peshawar', 'Board Bazaar'),
  ('Peshawar', 'Khyber Bazaar'),
  ('Peshawar', 'Regi Model Town'),
  ('Peshawar', 'Tehkal'),
  ('Quetta', 'Jinnah Road'),
  ('Quetta', 'Satellite Town'),
  ('Quetta', 'Samungli Road'),
  ('Quetta', 'Airport Road'),
  ('Quetta', 'Brewery Road'),
  ('Quetta', 'Sariab Road'),
  ('Quetta', 'Chaman Housing Scheme'),
  ('Quetta', 'Model Town'),
  ('Quetta', 'Cantt'),
  ('Quetta', 'Zarghoon Road'),
  ('Sialkot', 'Cantt'),
  ('Sialkot', 'Cantonment'),
  ('Sialkot', 'Paris Road'),
  ('Sialkot', 'Kashmir Road'),
  ('Sialkot', 'Daska Road'),
  ('Sialkot', 'Ugoki Road'),
  ('Sialkot', 'Defence Road'),
  ('Sialkot', 'Sialkot Bypass'),
  ('Sialkot', 'Model Town'),
  ('Sialkot', 'Murray College Road'),
  ('Gujranwala', 'Satellite Town'),
  ('Gujranwala', 'Model Town'),
  ('Gujranwala', 'DC Colony'),
  ('Gujranwala', 'Wapda Town'),
  ('Gujranwala', 'G.T. Road'),
  ('Gujranwala', 'Sialkot Road'),
  ('Gujranwala', 'Pasrur Road'),
  ('Gujranwala', 'Civil Lines'),
  ('Gujranwala', 'Garden Town'),
  ('Gujranwala', 'Master City'),
  ('Bahawalpur', 'Model Town A'),
  ('Bahawalpur', 'Model Town B'),
  ('Bahawalpur', 'Satellite Town'),
  ('Bahawalpur', 'Cantt'),
  ('Bahawalpur', 'Dubai Chowk'),
  ('Bahawalpur', 'Circular Road'),
  ('Bahawalpur', 'Yazman Road'),
  ('Bahawalpur', 'Baghdad-ul-Jadeed'),
  ('Bahawalpur', 'DHA Bahawalpur'),
  ('Bahawalpur', 'University Chowk'),
  ('Sargodha', 'Satellite Town'),
  ('Sargodha', 'University Road'),
  ('Sargodha', 'Cantt'),
  ('Sargodha', 'Model Town'),
  ('Sargodha', 'Faisal Colony'),
  ('Sargodha', 'Fatima Jinnah Road'),
  ('Sargodha', 'Lahore Road'),
  ('Sargodha', 'Bhalwal Road'),
  ('Sargodha', '47 Pull'),
  ('Sargodha', 'New Satellite Town'),
  ('Hyderabad', 'Latifabad'),
  ('Hyderabad', 'Qasimabad'),
  ('Hyderabad', 'Auto Bhan Road'),
  ('Hyderabad', 'Citizen Colony'),
  ('Hyderabad', 'Hirabad'),
  ('Hyderabad', 'Saddar'),
  ('Hyderabad', 'Latifabad Unit 7'),
  ('Hyderabad', 'Latifabad Unit 8'),
  ('Hyderabad', 'Latifabad Unit 10'),
  ('Hyderabad', 'Wadhu Wah Road'),
  ('Abbottabad', 'Jinnahabad'),
  ('Abbottabad', 'Mandian'),
  ('Abbottabad', 'Nawansher'),
  ('Abbottabad', 'Supply'),
  ('Abbottabad', 'Kakul Road'),
  ('Abbottabad', 'Cantt'),
  ('Abbottabad', 'Salhad'),
  ('Abbottabad', 'PMA Road'),
  ('Abbottabad', 'Karakoram Highway'),
  ('Gujrat', 'Model Town'),
  ('Gujrat', 'Satellite Town'),
  ('Gujrat', 'G.T. Road'),
  ('Gujrat', 'Jalalpur Jattan Road'),
  ('Gujrat', 'Fawara Chowk'),
  ('Gujrat', 'Service Mor'),
  ('Gujrat', 'Gulshan Colony'),
  ('Gujrat', 'Shadman Colony'),
  ('Sahiwal', 'Faridia Park'),
  ('Sahiwal', 'Faridia Colony'),
  ('Sahiwal', 'High Street'),
  ('Sahiwal', 'Jinnah Road'),
  ('Sahiwal', 'Fateh Sher Colony'),
  ('Sahiwal', 'Mission Chowk'),
  ('Sahiwal', 'Pakpattan Road'),
  ('Sahiwal', 'G.T. Road'),
  ('Sahiwal', 'Noor Shah Road'),
  ('Mardan', 'Cantt'),
  ('Mardan', 'Sheikh Maltoon Town'),
  ('Mardan', 'Baghdada'),
  ('Mardan', 'Nowshera Road'),
  ('Mardan', 'Malakand Road'),
  ('Mardan', 'Ring Road'),
  ('Mardan', 'Charsadda Road'),
  ('Mardan', 'Sadar Bazaar'),
  ('Mingora', 'Saidu Sharif'),
  ('Mingora', 'Green Chowk'),
  ('Mingora', 'Fizagat'),
  ('Mingora', 'Nishat Chowk'),
  ('Mingora', 'Amankot'),
  ('Mingora', 'Rahimabad'),
  ('Mingora', 'Kanju'),
  ('Mingora', 'Airport Road'),
  ('Wah Cantt', 'Lalazar'),
  ('Wah Cantt', 'New City'),
  ('Wah Cantt', 'Model Town'),
  ('Wah Cantt', 'Wah Garden'),
  ('Wah Cantt', 'Taxila Road'),
  ('Wah Cantt', 'GT Road'),
  ('Wah Cantt', 'Khalabat Township'),
  ('Dera Ghazi Khan', 'Model Town'),
  ('Dera Ghazi Khan', 'Block 17'),
  ('Dera Ghazi Khan', 'Airport Road'),
  ('Dera Ghazi Khan', 'Jampur Road'),
  ('Dera Ghazi Khan', 'College Road'),
  ('Dera Ghazi Khan', 'Quaid-e-Azam Road'),
  ('Dera Ghazi Khan', 'Dera Ghazi Khan Cantt'),
  ('Larkana', 'Sachal Colony'),
  ('Larkana', 'Shahbaz Colony'),
  ('Larkana', 'Station Road'),
  ('Larkana', 'VIP Road'),
  ('Larkana', 'Resham Gali'),
  ('Larkana', 'Ratodero Road'),
  ('Larkana', 'Airport Road'),
  ('Larkana', 'Naudero Road'),
  ('Sukkur', 'Military Road'),
  ('Sukkur', 'New Sukkur'),
  ('Sukkur', 'Old Sukkur'),
  ('Sukkur', 'Shahi Bazaar'),
  ('Sukkur', 'Airport Road'),
  ('Sukkur', 'Minara Road'),
  ('Sukkur', 'Barrage Colony'),
  ('Sukkur', 'Lab-e-Mehran'),
  ('Jhelum', 'Cantt'),
  ('Jhelum', 'Civil Lines'),
  ('Jhelum', 'Kala Gujran'),
  ('Jhelum', 'Machine Mohalla'),
  ('Jhelum', 'GT Road'),
  ('Jhelum', 'Railway Road'),
  ('Jhelum', 'Model Colony'),
  ('Jhelum', 'Kachehri Road')
) as v(city, name) join public.location_cities c on c.name = v.city
on conflict (city_id, name) do nothing;
