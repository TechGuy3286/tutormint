-- 08_admin_bootstrap.sql
-- Grant profiles.role='admin' to the owner's account.
--
-- The email is matched against auth.users; if no such user exists the
-- migration raises and changes nothing. It never creates an auth user.
-- Idempotent: re-running just re-asserts role='admin'.

do $$
declare
  v_email text := 'techguy3286@gmail.com';
  v_id    uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(v_email);

  if v_id is null then
    raise exception 'No auth.users row for %; refusing to create one', v_email;
  end if;

  -- profiles.full_name and profiles.phone_number are both NOT NULL. auth.users
  -- carries a phone column (null for this account), so it falls back to ''
  -- rather than inventing a number.
  insert into public.profiles (id, role, email, full_name, phone_number)
  values (
    v_id,
    'admin'::user_role,
    v_email,
    coalesce((select full_name from public.profiles where id = v_id), 'Admin'),
    coalesce((select phone from auth.users where id = v_id), '')
  )
  on conflict (id) do update set role = 'admin'::user_role;

  raise notice 'admin role granted to % (%)', v_email, v_id;
end $$;
