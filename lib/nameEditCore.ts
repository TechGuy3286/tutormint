// lib/nameEditCore.ts — PURE, client-safe (owner, 27 Oct 2026).
//
// Staff edit of a member's name (tutor "Edit this tutor's details" → Name, and
// the parent admin page → Edit name). The rules:
//   • a reason is required (at least 3 characters);
//   • the name is stored through formatName (lib/formatName);
//   • a VERIFIED tutor — one whose CNIC has been approved (profiles
//     .cnic_verified_at set) — may have their name changed by the Owner only,
//     because that name has been checked against the CNIC. Everyone else with
//     the edit screen may change an unverified tutor's or a parent's name.

import { formatName } from '@/lib/formatName'

export const NAME_REASON_MIN = 3
export const NAME_MIN = 2
export const NAME_MAX = 60
export const VERIFIED_NAME_HINT = 'Check the spelling against the approved CNIC'
export const OWNER_ONLY_NAME = 'Only the Owner can change the name of a verified tutor.'
export const NAME_REASON_NEEDED = 'Please give a reason for this change.'

/** The name as it will be stored: spaces tidied, every word capitalised. */
export function cleanName(raw: string | null | undefined): string {
  return formatName((raw ?? '').replace(/\s+/g, ' ').trim())
}

/** Why a typed name cannot be saved, or null. */
export function nameProblem(raw: string | null | undefined): string | null {
  const n = cleanName(raw)
  if (n.length < NAME_MIN) return 'Enter the full name.'
  if (n.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`
  if (/[0-9@<>{}[\]\\/_=+*#$%^&|~`]/.test(n)) return 'A name can only have letters, spaces, dots, hyphens and apostrophes.'
  if (!/\p{L}/u.test(n)) return 'Enter the full name.'
  return null
}

/** Is this tutor's name locked to the Owner? (A parent's never is.) */
export function nameOwnerOnly(target: { role: string | null | undefined; cnicVerifiedAt: string | null | undefined }): boolean {
  return target.role === 'tutor' && !!target.cnicVerifiedAt
}

export type NameEditDecision =
  | { ok: true; name: string; unchanged: boolean }
  | { ok: false; status: number; error: string }

export function nameEditDecision(input: {
  actorRole: string
  target: { role: string | null | undefined; cnicVerifiedAt: string | null | undefined; fullName: string | null | undefined }
  name: string | null | undefined
  reason: string | null | undefined
}): NameEditDecision {
  if (!['tutor', 'parent', 'academy'].includes(String(input.target.role ?? ''))) {
    return { ok: false, status: 404, error: 'This is not a tutor or parent account.' }
  }
  if ((input.reason ?? '').trim().length < NAME_REASON_MIN) return { ok: false, status: 400, error: NAME_REASON_NEEDED }
  if (nameOwnerOnly(input.target) && input.actorRole !== 'owner') return { ok: false, status: 403, error: OWNER_ONLY_NAME }
  const problem = nameProblem(input.name)
  if (problem) return { ok: false, status: 400, error: problem }
  const name = cleanName(input.name)
  return { ok: true, name, unchanged: name === cleanName(input.target.fullName) }
}
