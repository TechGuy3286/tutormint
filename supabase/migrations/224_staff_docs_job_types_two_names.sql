-- 224_staff_docs_job_types_two_names.sql (owner, 5 Nov 2026)
--
-- Additive. Three parts:
--
-- A  staff_document_decisions — every CNIC / profile picture / selfie decision
--    made by staff who are NOT the Owner (Backend Support), with the exact
--    before and after state so the Owner's Undo can put the document back to
--    waiting. Admin-read RLS, service-role writes. Nothing is deleted: Undo
--    stamps undone_at.
--    profiles.cnic_name_mismatch_at / _by / _by_name — staff marked "the name on
--    the card does not match the Name on CNIC": the CNIC is then the Owner's to
--    decide. Not member-writable.
--
-- B  Three job types (job_titles is data — adding a title is an insert).
--
-- C  Two names. profiles.cnic_name = Name on CNIC (legal, never public);
--    profiles.display_name = optional Display name. profiles.full_name stays
--    the name every existing reader uses and is now DERIVED: the Display name
--    when set, else the Name on CNIC. Backfill copies the current name into
--    both, so nothing changes on screen.
--      profiles_sync_names (BEFORE INSERT OR UPDATE): computes full_name. A
--        writer that changes ONLY full_name (older code) is treated as setting
--        the Display name — the Name on CNIC is never changed by it.
--      lock_profile_fields: a member may not change cnic_name once the CNIC is
--        approved (staff change it, reason required, from admin).
--      flag_member_name_change now watches cnic_name (the Display name may be
--        changed at any time).
--      profiles_mirror_name (AFTER UPDATE): tutor_profiles.full_name follows
--        profiles.full_name, so public pages and the CV read the Display name.
--      profiles_sync_tuitions also fires on the two new columns.
--    Members may update the two columns with their own token (column grants);
--    the server validates the Display name before writing, and the trigger
--    refuses a Display name naming TutorMint as a backstop.

-- A ---------------------------------------------------------------------------
create table if not exists public.staff_document_decisions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  member_role text,
  item text not null check (item in ('cnic', 'profile_pic', 'selfie')),
  decision text not null check (decision in ('approve', 'reject')),
  rereview boolean not null default false,
  reason text,
  staff_id uuid,
  staff_name text,
  staff_role text,
  decided_at timestamptz not null default now(),
  before_state jsonb not null,
  after_state jsonb not null,
  undone_at timestamptz,
  undone_by uuid,
  undone_by_name text,
  undo_reason text
);
create index if not exists staff_document_decisions_decided_idx on public.staff_document_decisions (decided_at desc);
create index if not exists staff_document_decisions_member_idx on public.staff_document_decisions (member_id);
alter table public.staff_document_decisions enable row level security;
drop policy if exists staff_document_decisions_admin_read on public.staff_document_decisions;
create policy staff_document_decisions_admin_read on public.staff_document_decisions
  for select to authenticated using (public.is_admin());
revoke all on public.staff_document_decisions from anon;
comment on table public.staff_document_decisions is
  'CNIC / photo / selfie decisions by staff other than the Owner, with before/after state for the Owner''s Undo (migration 224).';

alter table public.profiles add column if not exists cnic_name_mismatch_at timestamptz;
alter table public.profiles add column if not exists cnic_name_mismatch_by uuid;
alter table public.profiles add column if not exists cnic_name_mismatch_by_name text;

-- B ---------------------------------------------------------------------------
insert into public.job_titles (name, sort_order) values
  ('Montessori Expert', 23),
  ('Intermediate Teacher (FA / FSc / ICS / I.Com)', 24),
  ('Graduation Level Teacher (BA / BSc / BS)', 25)
on conflict (name) do update set sort_order = excluded.sort_order;

-- C ---------------------------------------------------------------------------
alter table public.profiles add column if not exists cnic_name text;
alter table public.profiles add column if not exists display_name text;
comment on column public.profiles.cnic_name is
  'Name on CNIC — the legal name, used only for verification; never public (migration 224).';
comment on column public.profiles.display_name is
  'Optional Display name shown to parents and tutors; full_name = display_name, else cnic_name (migration 224).';

-- Backfill: the current name into both (nothing changes on screen).
update public.profiles
   set cnic_name = coalesce(cnic_name, full_name),
       display_name = coalesce(display_name, full_name)
 where cnic_name is null or display_name is null;

create or replace function public.sync_member_names()
returns trigger
language plpgsql
as $function$
begin
  if tg_op = 'INSERT' then
    if new.cnic_name is null then new.cnic_name := new.full_name; end if;
  elsif new.full_name is distinct from old.full_name
        and new.cnic_name is not distinct from old.cnic_name
        and new.display_name is not distinct from old.display_name then
    -- An older writer that knows only full_name: that is the Display name.
    new.display_name := new.full_name;
  end if;
  if public.tm_member_self_edit()
     and coalesce(new.display_name, '') ~* 'tutor[^a-z]*mint'
     and coalesce(new.display_name, '') is distinct from coalesce(old.display_name, '') then
    raise exception 'Choose a Display name that does not name TutorMint.' using errcode = 'TMLCK';
  end if;
  new.full_name := coalesce(nullif(btrim(new.display_name), ''), nullif(btrim(new.cnic_name), ''), new.full_name);
  return new;
end $function$;

drop trigger if exists profiles_sync_names on public.profiles;
create trigger profiles_sync_names
  before insert or update on public.profiles
  for each row execute function public.sync_member_names();

create or replace function public.lock_profile_fields()
returns trigger
language plpgsql
as $function$
  BEGIN
    IF public.tm_member_self_edit() THEN
      IF OLD.phone_verified_at IS NOT NULL AND NEW.phone_number IS DISTINCT FROM OLD.phone_number THEN
        RAISE EXCEPTION 'To change your mobile number, please contact our support.' USING ERRCODE = 'TMLCK';
      END IF;
      IF (OLD.cnic_verified_at IS NOT NULL OR lower(coalesce(OLD.verification_state, '')) = 'approved')
         AND NEW.cnic_number IS DISTINCT FROM OLD.cnic_number THEN
        RAISE EXCEPTION 'To change your CNIC, please contact our support.' USING ERRCODE = 'TMLCK';
      END IF;
      IF (OLD.cnic_verified_at IS NOT NULL OR lower(coalesce(OLD.verification_state, '')) = 'approved')
         AND NEW.cnic_name IS DISTINCT FROM OLD.cnic_name THEN
        RAISE EXCEPTION 'To change your Name on CNIC, please contact our support.' USING ERRCODE = 'TMLCK';
      END IF;
    END IF;
    RETURN NEW;
  END $function$;

create or replace function public.flag_member_name_change()
returns trigger
language plpgsql
as $function$
begin
  if public.tm_member_self_edit()
     and old.role = 'tutor'
     and (old.cnic_verified_at is not null or lower(coalesce(old.verification_state, '')) = 'approved')
     and lower(regexp_replace(btrim(coalesce(new.cnic_name, '')), '\s+', ' ', 'g'))
         is distinct from lower(regexp_replace(btrim(coalesce(old.cnic_name, '')), '\s+', ' ', 'g')) then
    new.name_rereview_at := now();
    new.name_rereview_from := coalesce(old.name_rereview_from, old.cnic_name);
  end if;
  return new;
end $function$;

drop trigger if exists profiles_flag_name_change on public.profiles;
create trigger profiles_flag_name_change
  before update of cnic_name on public.profiles
  for each row execute function public.flag_member_name_change();

create or replace function public.mirror_name_to_tutor()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.full_name is distinct from old.full_name then
    update public.tutor_profiles set full_name = new.full_name
     where id = new.id and full_name is distinct from new.full_name;
  end if;
  return null;
end $function$;
revoke all on function public.mirror_name_to_tutor() from public;

drop trigger if exists profiles_mirror_name on public.profiles;
create trigger profiles_mirror_name
  after update of full_name, display_name, cnic_name on public.profiles
  for each row execute function public.mirror_name_to_tutor();

drop trigger if exists profiles_sync_tuitions on public.profiles;
create trigger profiles_sync_tuitions
  after update of is_banned, is_suspended, hidden_from_public, full_name, display_name, cnic_name, erased_at on public.profiles
  for each row execute function public.profiles_sync_tuitions();

grant update (cnic_name, display_name) on public.profiles to authenticated;
