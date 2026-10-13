-- 165_partner_full_rights.sql
--
-- Partner role: view-only → full management (owner, 13 Oct 2026).
--
-- Migration 150 made the Partner read-only in the database as well as in the
-- app: public.is_admin_writer() was is_admin() minus the Partner, and the
-- storage write policies carried an explicit "admin_role is distinct from
-- 'partner'". This puts both back, so a Partner's own session may write
-- wherever any other admin's may.
--
-- Owner protection is NOT a database rule: it is enforced in the server code
-- that performs every staff and member change with the service role
-- (lib/ownerGuard, lib/staff, lib/adminAccessCore).
--
-- Idempotent: the function is replaced; the storage policies are only rewritten
-- where they still carry the Partner exclusion. No table, column or row changes.


create or replace function public.is_admin_writer()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.admin_role is not null
  )
$$;

grant execute on function public.is_admin_writer() to anon, authenticated, service_role;

-- storage: take the Partner exclusion back out of the write policies.
do $$
declare
  pol record;
  needle constant text := '((p.role = ''admin''::user_role) AND (p.admin_role IS DISTINCT FROM ''partner''::text))';
  repl constant text := '(p.role = ''admin''::user_role)';
  new_qual text;
  new_check text;
  sql text;
begin
  for pol in
    select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
    from pg_policies
    where schemaname = 'storage'
      and cmd <> 'SELECT'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%' || needle || '%'
  loop
    new_qual := replace(pol.qual, needle, repl);
    new_check := replace(pol.with_check, needle, repl);

    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    sql := format(
      'create policy %I on %I.%I as %s for %s to %s',
      pol.policyname, pol.schemaname, pol.tablename, pol.permissive, pol.cmd,
      array_to_string(pol.roles, ', ')
    );
    if new_qual is not null then sql := sql || ' using (' || new_qual || ')'; end if;
    if new_check is not null then sql := sql || ' with check (' || new_check || ')'; end if;
    execute sql;
  end loop;
end
$$;

