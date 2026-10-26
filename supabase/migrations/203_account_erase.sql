-- 203_account_erase.sql — Close account and erase personal data (owner, 27 Oct 2026).
--
-- The ONE exception to "nothing is deleted": a member's personal data is erased
-- at their own request. The erase itself runs in the app (lib/accountErase.ts,
-- service role); this migration adds what it needs and nothing else.
--
--   1. profiles.erased_at — set when an account's personal data was erased.
--   2. account_erasures — one row per request: scheduled (7-day grace, or
--      "now"), cancelled or done. Who asked (owner / member), why, how the
--      person's identity was confirmed, when it is due, and for a tutor the
--      sha256 of every address their profile ever had (never the address
--      itself — it carries their name) and their city, for the 301.
--      Admin-read RLS; service-role writes only.
--   3. phone_otps.purpose may be 'erase' — the code a member enters to confirm
--      "Delete my account" in Settings.
--   4. parent_hide_reason(): an erased poster's tuitions are hidden
--      ('parent_erased', checked first) and 301 like every hidden tuition
--      (hidden_tuition_redirects, migration 198). The sync trigger also fires
--      on erased_at.
--   5. member_notes_guard(): staff notes are never edited — EXCEPT that the
--      service role may replace the body (phones and emails masked) of a note
--      about an account whose data was erased. Nothing else about the note.
--   6. erase_auth_user(uuid) — service role only. The auth user can NOT be
--      deleted: payments, applications, follow-ups, staff credits' accounts,
--      tuitions and the profile itself are ON DELETE CASCADE from auth.users,
--      and those are exactly the records an erase must keep. So the auth user
--      is scrubbed instead: the email becomes erased-<id>@users.tutormint.org
--      (frees the real address; a no-mailbox address everywhere), the phone is
--      removed (frees the number), the password is emptied, every identity,
--      session, refresh token, MFA factor and one-time token is deleted, the
--      metadata is emptied, and it is banned for 100 years. Nobody can sign in.
--   7. erased_tutor_redirects() — (slug hash, city) of erased tutors, for the
--      proxy's 301 to Browse tutors for their city. No name, no address.

-- 1 -----------------------------------------------------------------------------
alter table public.profiles add column if not exists erased_at timestamptz;

-- 2 -----------------------------------------------------------------------------
create table if not exists public.account_erasures (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null,
  role            text,
  status          text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'done', 'failed')),
  source          text not null check (source in ('owner', 'member')),
  requested_by    uuid,
  requested_by_name text,
  reason          text check (reason is null or char_length(reason) <= 600),
  identity_check  text check (identity_check is null or char_length(identity_check) <= 300),
  requested_at    timestamptz not null default now(),
  due_at          timestamptz not null,
  cancelled_at    timestamptz,
  cancelled_by    uuid,
  done_at         timestamptz,
  error           text,
  slug_hashes     text[] not null default '{}',
  city            text,
  summary         jsonb not null default '{}'::jsonb
);
create unique index if not exists account_erasures_one_open
  on public.account_erasures (member_id) where status = 'scheduled';
create index if not exists account_erasures_due
  on public.account_erasures (due_at) where status = 'scheduled';
create index if not exists account_erasures_member
  on public.account_erasures (member_id, requested_at desc);

alter table public.account_erasures enable row level security;
drop policy if exists account_erasures_admin_read on public.account_erasures;
create policy account_erasures_admin_read on public.account_erasures for select to authenticated using (public.is_admin());

-- 3 -----------------------------------------------------------------------------
alter table public.phone_otps drop constraint if exists phone_otps_purpose_check;
alter table public.phone_otps add constraint phone_otps_purpose_check check (purpose = any (array['verify'::text, 'reset'::text, 'erase'::text]));

-- 4 -----------------------------------------------------------------------------
create or replace function public.parent_hide_reason(p public.profiles)
returns text
language sql
immutable
as $$
  select case
    when p.erased_at is not null then 'parent_erased'
    when coalesce(p.is_banned, false) then 'parent_banned'
    when coalesce(p.is_suspended, false) then 'parent_suspended'
    when coalesce(p.hidden_from_public, false) then 'parent_hidden'
    when coalesce(p.is_test_name, false) then 'parent_test'
    else null
  end
$$;

drop trigger if exists profiles_sync_tuitions on public.profiles;
create trigger profiles_sync_tuitions
  after update of is_banned, is_suspended, hidden_from_public, full_name, erased_at on public.profiles
  for each row execute function public.profiles_sync_tuitions();

-- 5 -----------------------------------------------------------------------------
create or replace function public.member_notes_guard()
returns trigger
language plpgsql
as $function$
declare
  moved boolean := false;
  erasing boolean := false;
  server boolean := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', current_user) in ('service_role', 'postgres');
begin
  if tg_op = 'DELETE' then
    -- A direct delete is refused. A cascade from deleting the member's account
    -- (the owner's junk cleanup) runs one trigger level deeper and is allowed.
    if pg_trigger_depth() <= 1 then
      raise exception 'member notes are never deleted; withdraw the note instead' using errcode = '42501';
    end if;
    return old;
  end if;
  -- A merge (owner, 26 Oct 2026) moves a note between the two accounts of a
  -- recorded merge — the service role only, and nothing else about the note.
  if new.member_id is distinct from old.member_id
     and server
     and exists (
       select 1 from public.member_merges m
       where (m.kept_id = new.member_id and m.merged_id = old.member_id)
          or (m.kept_id = old.member_id and m.merged_id = new.member_id)
     ) then
    moved := true;
  end if;
  -- An erase on request (owner, 27 Oct 2026): the service role may replace the
  -- BODY of a note about an erased account (phones and emails masked).
  if new.body is distinct from old.body
     and new.member_id is not distinct from old.member_id
     and server
     and exists (select 1 from public.profiles p where p.id = old.member_id and p.erased_at is not null) then
    erasing := true;
  end if;
  if (new.member_id is distinct from old.member_id and not moved)
     or new.kind is distinct from old.kind
     or (new.body is distinct from old.body and not erasing)
     or new.staff_id is distinct from old.staff_id
     or new.staff_name is distinct from old.staff_name
     or new.created_at is distinct from old.created_at then
    raise exception 'a member note cannot be edited; withdraw it instead' using errcode = '42501';
  end if;
  if old.withdrawn_at is not null and (
       new.withdrawn_at is distinct from old.withdrawn_at
       or new.withdrawn_reason is distinct from old.withdrawn_reason
       or new.withdrawn_by is distinct from old.withdrawn_by) then
    raise exception 'this note was already withdrawn' using errcode = '42501';
  end if;
  if new.withdrawn_at is not null and new.withdrawn_reason is null then
    raise exception 'a withdrawn note needs a reason' using errcode = '23514';
  end if;
  return new;
end;
$function$;

-- 6 -----------------------------------------------------------------------------
create or replace function public.erase_auth_user(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  update auth.users
     set email = 'erased-' || p_uid::text || '@users.tutormint.org',
         phone = null,
         phone_confirmed_at = null,
         phone_change = '',
         phone_change_token = '',
         email_change = '',
         email_change_token_new = '',
         email_change_token_current = '',
         confirmation_token = '',
         recovery_token = '',
         reauthentication_token = '',
         encrypted_password = '',
         raw_user_meta_data = '{}'::jsonb,
         banned_until = now() + interval '100 years',
         updated_at = now()
   where id = p_uid;
  delete from auth.identities where user_id = p_uid;
  delete from auth.sessions where user_id = p_uid;
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id = $1' using p_uid::text;
  end if;
  if to_regclass('auth.mfa_factors') is not null then
    execute 'delete from auth.mfa_factors where user_id = $1' using p_uid;
  end if;
  if to_regclass('auth.one_time_tokens') is not null then
    execute 'delete from auth.one_time_tokens where user_id = $1' using p_uid;
  end if;
end
$$;
revoke all on function public.erase_auth_user(uuid) from public, anon, authenticated;
grant execute on function public.erase_auth_user(uuid) to service_role;

-- 7 -----------------------------------------------------------------------------
create or replace function public.erased_tutor_redirects()
returns table (slug_hash text, city text)
language sql
stable
security definer
set search_path = public
as $$
  select h::text, nullif(btrim(e.city), '')::text
    from public.account_erasures e, unnest(e.slug_hashes) h
   where e.status = 'done' and e.role = 'tutor'
$$;
revoke all on function public.erased_tutor_redirects() from public;
grant execute on function public.erased_tutor_redirects() to anon, authenticated, service_role;
