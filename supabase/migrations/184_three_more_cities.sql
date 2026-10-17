-- 184_three_more_cities.sql — owner, 17 Oct 2026.
--
-- Adds three Punjab cities to the curated city list (location_cities), stored
-- exactly as the existing 23 are (migration 73): name verbatim, sort_order 100
-- so they sort alphabetically after the pinned big four. No areas are added.
-- Nothing existing changes: on conflict do nothing, so an existing row keeps
-- its sort_order. Additive and idempotent.

insert into public.location_cities (name, sort_order) values
  ('Sheikhupura', 100),
  ('Jhang', 100),
  ('Rahim Yar Khan', 100)
on conflict (name) do nothing;
