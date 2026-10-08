-- 150_partner_role_view_only.sql (owner, 8 Oct 2026)
--
-- The "Partner" staff role: sees every admin page the owner sees, changes
-- nothing. ADDITIVE — no row changes meaning, nothing is deleted.
--
-- 1. profiles.admin_role may now hold 'partner'.
--
-- 2. public.is_admin_writer() — is_admin() minus the Partner. is_admin() keeps
--    its meaning (any role='admin' account, used for READ policies), so a
--    Partner still reads everything an admin session can read.
--
-- 3. Every database WRITE policy that admitted "any admin" through is_admin()
--    now admits is_admin_writer() instead. The app refuses a Partner's writes
--    in every /api/admin route (403); this closes the other door — a Partner's
--    own session token used directly against the database API.
--      * INSERT / UPDATE / DELETE policies: is_admin() → is_admin_writer().
--      * FOR ALL policies: the same swap, plus a FOR SELECT twin carrying the
--        ORIGINAL expression, so reading is exactly as before for everyone.
--    Done by reading pg_policies, so it covers every such policy present when
--    the migration runs, not a hand-copied list.
--
-- 4. The four storage write policies (ads and blog buckets) that test
--    role = 'admin' directly also exclude the Partner.
--
-- Policies gated by is_admin_with(array[...]) need nothing: that helper names
-- roles explicitly and 'partner' is in none of the lists.

alter table public.profiles
  drop constraint if exists profiles_admin_role_check;

alter table public.profiles
  add constraint profiles_admin_role_check
  check (
    admin_role is null
    or (role = 'admin'::user_role
        and admin_role = any (array['owner', 'admin', 'operations', 'tuitions_staff', 'partner']))
  );

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
      and p.admin_role is distinct from 'partner'
  )
$$;

grant execute on function public.is_admin_writer() to anon, authenticated, service_role;

do $$
declare
  pol record;
  new_qual text;
  new_check text;
  sql text;
begin
  for pol in
    select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and cmd <> 'SELECT'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%is_admin()%'
  loop
    new_qual := replace(pol.qual, 'is_admin()', 'is_admin_writer()');
    new_check := replace(pol.with_check, 'is_admin()', 'is_admin_writer()');

    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);

    sql := format(
      'create policy %I on %I.%I as %s for %s to %s',
      pol.policyname, pol.schemaname, pol.tablename, pol.permissive, pol.cmd,
      array_to_string(pol.roles, ', ')
    );
    if new_qual is not null then sql := sql || ' using (' || new_qual || ')'; end if;
    if new_check is not null then sql := sql || ' with check (' || new_check || ')'; end if;
    execute sql;

    -- FOR ALL also granted SELECT: keep reading exactly as it was.
    if pol.cmd = 'ALL' and pol.qual is not null then
      execute format(
        'create policy %I on %I.%I as %s for select to %s using (%s)',
        left(pol.policyname, 54) || '_read', pol.schemaname, pol.tablename, pol.permissive,
        array_to_string(pol.roles, ', '), pol.qual
      );
    end if;
  end loop;
end
$$;

do $$
declare
  pol record;
  needle constant text := '(p.role = ''admin''::user_role)';
  repl constant text := '((p.role = ''admin''::user_role) AND (p.admin_role IS DISTINCT FROM ''partner''::text))';
  sql text;
begin
  for pol in
    select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
    from pg_policies
    where schemaname = 'storage'
      and cmd <> 'SELECT'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%' || needle || '%'
      and (coalesce(qual, '') || coalesce(with_check, '')) not like '%partner%'
  loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    sql := format(
      'create policy %I on %I.%I as %s for %s to %s',
      pol.policyname, pol.schemaname, pol.tablename, pol.permissive, pol.cmd,
      array_to_string(pol.roles, ', ')
    );
    if pol.qual is not null then sql := sql || ' using (' || replace(pol.qual, needle, repl) || ')'; end if;
    if pol.with_check is not null then sql := sql || ' with check (' || replace(pol.with_check, needle, repl) || ')'; end if;
    execute sql;
  end loop;
end
$$;
