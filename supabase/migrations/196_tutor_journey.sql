-- 196_tutor_journey.sql  (owner, 23 Oct 2026)
--
-- Tutor journey: Follow-ups → Tutors To do / Sent, the Activity tab on member
-- pages, Paid tutors, and Convert account type. Additive; nothing is deleted.
--
--   1. member_follow_ups.reason / .progress — every Follow-ups → Tutors tap
--      records WHY the tutor was messaged (their reason for being stuck) and a
--      snapshot of how far they had got. Three messages at the same snapshot
--      with no progress = "No reply after 3 messages"; a new step finished
--      (a different snapshot) starts the count again.
--   2. member_notes — "Log a call or note" on the Activity tab. Never edited,
--      never deleted: only marked withdrawn, with who, when and why. A trigger
--      refuses any change to what was written and any direct DELETE (a member
--      account deleted by the owner's cleanup still cascades).
--   3. tutor_profiles.converted_to_parent_at / _by — a tutor account changed to
--      a parent account. The tutor profile is kept, hidden (tutor_directory and
--      tutor_visible_profiles already require role = 'tutor'), and its public
--      address 301s to Browse tutors for the city: converted_tutor_redirects()
--      gives proxy.ts the slug → city list (anon-callable, nothing else).
--   4. Four new Follow-ups templates (Team inbox → Templates → Follow-ups),
--      inserted only when missing. The other Follow-ups templates are existing
--      stored rows, reused as they are.
--
-- Admin-read RLS on member_notes; service-role writes only.

-- 1 -----------------------------------------------------------------------------
alter table public.member_follow_ups add column if not exists reason text;
alter table public.member_follow_ups add column if not exists progress text;

-- 2 -----------------------------------------------------------------------------
create table if not exists public.member_notes (
  id                uuid primary key default gen_random_uuid(),
  member_id         uuid not null references auth.users(id) on delete cascade,
  kind              text not null check (kind in ('call', 'whatsapp', 'note')),
  body              text not null check (char_length(btrim(body)) between 1 and 1000),
  staff_id          uuid references auth.users(id) on delete set null,
  staff_name        text,
  created_at        timestamptz not null default now(),
  withdrawn_at      timestamptz,
  withdrawn_by      uuid references auth.users(id) on delete set null,
  withdrawn_by_name text,
  withdrawn_reason  text check (withdrawn_reason is null or char_length(btrim(withdrawn_reason)) between 1 and 500)
);

create index if not exists member_notes_member_idx on public.member_notes (member_id, created_at desc);

alter table public.member_notes enable row level security;

drop policy if exists member_notes_admin_read on public.member_notes;
create policy member_notes_admin_read on public.member_notes
  for select using (public.is_admin());

-- What was written never changes; a note can be withdrawn once.
create or replace function public.member_notes_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    -- A direct delete is refused. A cascade from deleting the member's account
    -- (the owner's junk cleanup) runs one trigger level deeper and is allowed.
    if pg_trigger_depth() <= 1 then
      raise exception 'member notes are never deleted; withdraw the note instead' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.member_id is distinct from old.member_id
     or new.kind is distinct from old.kind
     or new.body is distinct from old.body
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
$$;

drop trigger if exists member_notes_guard on public.member_notes;
create trigger member_notes_guard
  before update or delete on public.member_notes
  for each row execute function public.member_notes_guard();

-- 3 -----------------------------------------------------------------------------
alter table public.tutor_profiles add column if not exists converted_to_parent_at timestamptz;
alter table public.tutor_profiles add column if not exists converted_to_parent_by uuid references auth.users(id) on delete set null;

-- The public address of a tutor profile hidden by a change to a parent
-- account → its city, for the 301 to Browse tutors. Only the slug and the
-- city of such profiles; no other column, no other profile.
create or replace function public.converted_tutor_redirects()
returns table (slug text, city text)
language sql
stable
security definer
set search_path = public
as $$
  select tp.slug::text, coalesce(nullif(btrim(tp.city), ''), nullif(btrim(p.city), ''))::text
  from public.tutor_profiles tp
  join public.profiles p on p.id = tp.id
  where tp.converted_to_parent_at is not null
    and p.role <> 'tutor'
    and tp.slug is not null
$$;

revoke all on function public.converted_tutor_redirects() from public;
grant execute on function public.converted_tutor_redirects() to anon, authenticated, service_role;

-- 4 -----------------------------------------------------------------------------
insert into public.admin_message_templates (key, title, subject, body)
values
  ('fu_no_cnic', 'Follow-ups — CNIC not added', 'Add your CNIC',
   E'Assalam o Alaikum {first_name}, your TutorMint profile is {completion}% complete. The next step is to add your CNIC: the number and a clear photo of both sides. Only our verification team sees it, and it never shows on your profile.\nYou can add it here:\n{continue_link}\n\nNeed help? WhatsApp us on {support_whatsapp}.'),
  ('fu_no_photo', 'Follow-ups — photo or selfie not added', 'Add your photo',
   E'Assalam o Alaikum {first_name}, your TutorMint profile is {completion}% complete. The next step is to {next_step}. A clear photo helps parents trust you, and the selfie lets us check it is really you.\nYou can do it here:\n{continue_link}\n\nNeed help? WhatsApp us on {support_whatsapp}.'),
  ('fu_reupload', 'Follow-ups — document to upload again', 'Please upload again',
   E'Assalam o Alaikum {first_name}, we could not approve your {document}. {reason}\nPlease upload it again and we will check it.\nYou can upload it here:\n{continue_link}\n\nNeed help? WhatsApp us on {support_whatsapp}.'),
  ('fu_paid_unfinished', 'Follow-ups — paid, profile not finished', 'Finish your profile',
   E'Assalam o Alaikum {first_name}, thank you for getting verified on TutorMint. Your profile is {completion}% complete, and the next step is to {next_step}. A finished profile helps parents choose you.\nYou can finish it here:\n{continue_link}\n\nNeed help? WhatsApp us on {support_whatsapp}.')
on conflict (key) do nothing;
