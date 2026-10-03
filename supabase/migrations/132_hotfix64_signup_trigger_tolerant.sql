-- HOTFIX-64 §2 — make the signup trigger tolerant of a pre-existing (leftover)
-- synthetic email, so a stale row can never again crash account creation with
-- "Database error creating new user".
--
-- Root cause: handle_new_user() inserted profiles + tutor_profiles copying the
-- new auth email into their UNIQUE `email` columns with `on conflict (id) do
-- nothing` — which catches an ID reuse but NOT an EMAIL collision. A leftover
-- row holding the synthetic <msisdn>@users.tutormint.org (e.g. a half-freed test
-- account whose auth/profiles emails were renamed but tutor_profiles.email was
-- missed) made the insert raise, aborting the whole signup.
--
-- Fix: each insert now catches unique_violation and retries with a per-id
-- freed-<id>@users.tutormint.org placeholder, so the new account is ALWAYS
-- created. For the mobile path the login identifier is auth.users.email (the
-- real synthetic), not profiles.email, so a freed placeholder on profiles/
-- tutor_profiles.email does not affect sign-in; it only avoids the crash in the
-- rare collision case (which should not occur once numbers are freed in full).
--
-- SECURITY DEFINER + search_path preserved from the original. The body is
-- otherwise unchanged (same columns, same user_activity_log 'registered' row).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role      text := coalesce(new.raw_user_meta_data->>'role', 'parent');
  v_full_name text := coalesce(nullif(new.raw_user_meta_data->>'full_name',''), 'New User');
  v_city      text := nullif(new.raw_user_meta_data->>'city','');
  v_freed     text := 'freed-' || new.id::text || '@users.tutormint.org';
begin
  if v_role not in ('tutor','parent') then
    v_role := 'parent';
  end if;

  begin
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
  exception when unique_violation then
    insert into public.profiles (id, role, account_type, full_name, email, phone_number, city)
    values (
      new.id,
      v_role::user_role,
      case when v_role = 'parent' then 'parent' else null end,
      v_full_name,
      v_freed,
      '',
      v_city
    )
    on conflict (id) do nothing;
  end;

  if v_role = 'tutor' then
    begin
      insert into public.tutor_profiles (id, full_name, email, city, verification_status)
      values (new.id, v_full_name, coalesce(new.email,''), v_city, 'pending'::verification_status)
      on conflict (id) do nothing;
    exception when unique_violation then
      insert into public.tutor_profiles (id, full_name, email, city, verification_status)
      values (new.id, v_full_name, v_freed, v_city, 'pending'::verification_status)
      on conflict (id) do nothing;
    end;
  end if;

  insert into public.user_activity_log (user_id, event, target_type, target_id, meta)
  values (new.id, 'registered', 'profile', new.id::text, jsonb_build_object('role', v_role));

  return new;
end $function$;
