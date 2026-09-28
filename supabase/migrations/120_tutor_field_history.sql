-- PR83 (Part C) — change history for a tutor's "step 1" fields.
--
-- Records every change to: mobile, cnic_number, cnic_front, cnic_back,
-- profile_picture, selfie, subjects, city, areas — whether the change was made
-- by staff (on /admin/tutors/[id]) or by the tutor themselves before their
-- fields locked. One row per change; history is NEVER deleted.
--
-- ACCESS: admins read (only ever through the admin routes / the admin tutor
-- page). Members can NEVER insert, update, delete or read. Writes are
-- service-role only (the service role bypasses RLS), so there is deliberately
-- NO insert/update/delete policy and NO member/anon select policy — exactly the
-- job_contacts / admin_messages shape. This keeps it off every rls-audit
-- allowlist (an is_admin() SELECT policy → passes checkRlsEnabled; not
-- anon-readable → passes probeReads; no write policy → nothing to scope).
--
-- The write is best-effort in application code: a save never blocks on it, and
-- the code works whether or not this table exists yet (a missing table is
-- swallowed). Additive: nothing else changes.

create table if not exists public.tutor_field_history (
  id              bigint generated always as identity primary key,
  tutor_id        uuid not null references public.profiles(id) on delete cascade,
  field           text not null,
  old_value       text,
  new_value       text,
  changed_by      uuid references public.profiles(id) on delete set null,
  -- 'tutor' (the member, before locking) or 'staff' (an admin/operations edit).
  changed_by_role text not null,
  -- Stored on the row (not joined) so an entry still says who acted after that
  -- staff/member account is gone — the admin_audit_log pattern.
  changed_by_email text,
  -- Required for a staff edit (the spec); null for a member's own change.
  reason          text,
  changed_at      timestamptz not null default now()
);

create index if not exists tutor_field_history_tutor_idx
  on public.tutor_field_history (tutor_id, changed_at desc);

alter table public.tutor_field_history enable row level security;

-- Admins may read. Nobody else — no anon, no member. Writes are service-role
-- only (bypasses RLS); deliberately no insert/update/delete policy.
drop policy if exists tutor_field_history_admin_read on public.tutor_field_history;
create policy tutor_field_history_admin_read on public.tutor_field_history
  for select using (public.is_admin());
