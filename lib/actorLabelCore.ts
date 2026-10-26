// lib/actorLabelCore.ts — PURE, client-safe (owner, 27 Oct 2026).
//
// Who made a change, as staff read it: "Tutor — Roha Azeem", "Staff — Khizra
// Danish", "Parent — Sana Ali". The auto-made <msisdn>@users.tutormint.org
// login address is NEVER shown anywhere in admin — `shownEmail()` is the one
// gate every admin surface uses before printing an email.

import { formatName } from '@/lib/formatName'
import { isSyntheticEmail } from '@/lib/phone'

/** A real email the member gave, or null for an empty / auto-made address. */
export function shownEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim()
  if (!e || !e.includes('@') || isSyntheticEmail(e)) return null
  return e
}

export type ActorKind = 'Staff' | 'Tutor' | 'Parent' | 'Member' | 'System'

/** The kind word from what we know about the person. */
export function actorKind(p: {
  /** profiles.role — 'admin' for staff. */
  role?: string | null
  /** profiles.admin_role, or an audit row's actor_role. */
  adminRole?: string | null
  /** tutor_field_history.changed_by_role ('staff' | 'tutor'). */
  changedByRole?: string | null
}): ActorKind {
  const ar = (p.adminRole ?? '').trim()
  if (p.changedByRole === 'staff' || p.role === 'admin' || (ar && ar !== 'member' && ar !== 'system')) return 'Staff'
  if (ar === 'system') return 'System'
  if (p.role === 'tutor' || p.changedByRole === 'tutor') return 'Tutor'
  if (p.role === 'parent' || p.role === 'academy') return 'Parent'
  return 'Member'
}

/** "Staff — Khizra Danish". Falls back to a REAL email, then to the kind alone. */
export function actorLabel(p: {
  name?: string | null
  email?: string | null
  role?: string | null
  adminRole?: string | null
  changedByRole?: string | null
}): string {
  const kind = actorKind(p)
  const who = formatName(p.name ?? null) || shownEmail(p.email)
  return who ? `${kind} — ${who}` : kind
}
