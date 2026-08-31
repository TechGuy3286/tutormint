-- 14_handle_new_user.sql
-- Create the profiles row (and tutor_profiles row for tutors) when an auth
-- user is created.
--
-- WHY A TRIGGER: "Confirm email" is ON, so supabase.auth.signUp() returns a
-- user but NO session. A client-side insert into profiles would therefore run
-- as anon and be refused by profiles_self_insert (which requires
-- id = auth.uid()). There is no service_role key in the app either. Doing it
-- in a SECURITY DEFINER trigger is the only place the row can be created
-- reliably, and it also means a profile always exists for every auth user --
-- including ones created from the Supabase dashboard.
--
-- The registration form passes role/full_name/city through
-- signUp({ options: { data } }), which lands in raw_user_meta_data.
--
-- role falls back to 'parent' when absent or not a recognised value. Only
-- 'tutor' and 'parent' can be self-assigned: 'admin' is deliberately not
-- reachable this way, so nobody can register themselves as an admin.
--
-- Idempotent: create or replace, and the inserts skip existing rows.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role      text := coalesce(new.raw_user_meta_data->>'role', 'parent');
  v_full_name text := coalesce(nullif(new.raw_user_meta_data->>'full_name',''), 'New User');
  v_city      text := nullif(new.raw_user_meta_data->>'city','');
begin
  -- Never let a signup mint an admin.
  if v_role not in ('tutor','parent') then
    v_role := 'parent';
  end if;

  -- phone_number is NOT NULL on profiles but the phone/WhatsApp OTP happens
  -- later, during profile completion (T3), so it starts empty rather than
  -- being invented.
  insert into public.profiles (id, role, account_type, full_name, email, phone_number, city)
  values (
    new.id,
    v_role::user_role,
    case when v_role = 'parent' then 'parent' else null end,
    v_full_name,
    coalesce(new.email, ''),
    '',
    v_city
  )
  on conflict (id) do nothing;

  if v_role = 'tutor' then
    insert into public.tutor_profiles (id, full_name, email, city, verification_status)
    values (new.id, v_full_name, coalesce(new.email,''), v_city, 'pending'::verification_status)
    on conflict (id) do nothing;
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
