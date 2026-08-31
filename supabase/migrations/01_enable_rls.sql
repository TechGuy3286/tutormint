-- 01_enable_rls.sql
-- Enable RLS on every table in `public` that does not already have it.
-- Idempotent: re-running is a no-op. ENABLE only — no drops, no policy changes.
-- Policies themselves land in 06_rls_policies.sql. Until then, RLS with no
-- policy means "deny all" to anon/authenticated, which is the safe default.

do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'          -- ordinary tables only
      and c.relrowsecurity = false -- not already enabled
    order by c.relname
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    raise notice 'RLS enabled on public.%', r.relname;
  end loop;
end $$;
