-- 168_search_count_excluded.sql
--
-- Which anonymous searches count as demand (owner, 13 Oct 2026).
--
-- The anonymous search log was filled by crawlers: each cookieless request was
-- a brand-new "visitor" making one search. New searches are now filtered before
-- they are written (lib/searchCountCore). For the rows already there, nothing is
-- deleted: `excluded` says why a row is not counted —
--   'first_hit'  a visitor seen exactly once (a crawler, or a first request)
--   'repeat'     the identical search by the same visitor inside 30 minutes
-- NULL = counted. The content queue and recruitment cards read only NULL rows.
-- The flags are set by scripts/dataop-recount-searches.ts, not here.
--
-- Additive and idempotent. No row is changed by this migration.

alter table public.anon_search_events add column if not exists excluded text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'anon_search_events_excluded_check') then
    alter table public.anon_search_events
      add constraint anon_search_events_excluded_check check (excluded is null or excluded in ('first_hit', 'repeat', 'bot', 'link_check', 'staff'));
  end if;
end
$$;

create index if not exists anon_search_events_counted_idx on public.anon_search_events (created_at) where excluded is null;
