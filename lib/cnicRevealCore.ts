// lib/cnicRevealCore.ts
//
// PURE. Who may see a member's FULL CNIC number (owner, 17 Oct 2026): the
// Owner, and nobody else. Every admin screen shows the masked form
// (XXXXX-XXXXXXX-4, lib/cnic maskCnicHeavy); the Owner presses "Show" to fetch
// the full number to match it against the card images, and every Show is
// written to the audit log. Partner, Admin, Operations and Tuitions staff get
// the masked number and no Show button — and the server never sends them the
// full number. Parents, the public and other tutors get no part of it.

import { formatCnic, maskCnicHeavy, normaliseCnic } from '@/lib/cnic'

// Reviewers (owner, 16 Nov 2026): the staff roles that review documents — the
// Owner, the Project Manager ('partner') and Backend Support — get the same
// Show/Hide, so they can match the number to the card images. Every Show is
// still logged before the number is returned. Every other role keeps the
// masked number with no Show.
export const CNIC_REVEAL_ROLES: readonly string[] = ['owner', 'partner', 'backend_support']

export function mayRevealCnic(adminRole: string | null | undefined): boolean {
  return !!adminRole && CNIC_REVEAL_ROLES.includes(adminRole)
}

export const CNIC_REVEAL_REFUSED = 'Only document reviewers can see the full CNIC number.'

/** The CNIC number as any admin screen receives it: masked, never the full
 *  number. An incomplete number on file reads as such, never half-shown. */
export function adminCnicDisplay(raw: string | null | undefined): string | null {
  if (!raw || !normaliseCnic(raw)) return null
  return maskCnicHeavy(raw) ?? 'Incomplete number on file'
}

export type RevealDeps = {
  /** The member's stored CNIC number (or null). */
  loadNumber: (memberId: string) => Promise<string | null>
  /** Write the audit row. Called BEFORE the number is returned. */
  log: (entry: { memberId: string }) => Promise<void>
}

export type RevealResult = { status: 200; body: { cnicNumber: string | null } } | { status: 403; body: { error: string } }

/**
 * The reveal itself, with its I/O injected so it is tested at the API level:
 * a non-Owner gets 403 and nothing is read; the Owner's Show is logged, then
 * the formatted number is returned.
 */
export async function revealCnic(actor: { adminRole: string | null | undefined }, memberId: string, deps: RevealDeps): Promise<RevealResult> {
  if (!mayRevealCnic(actor.adminRole)) return { status: 403, body: { error: CNIC_REVEAL_REFUSED } }
  const raw = await deps.loadNumber(memberId)
  await deps.log({ memberId })
  return { status: 200, body: { cnicNumber: raw ? formatCnic(raw) : null } }
}
