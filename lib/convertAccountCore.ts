// lib/convertAccountCore.ts
//
// PURE, client-safe. Convert account type, Parent ↔ Tutor (owner, 23 Oct
// 2026) — for people who picked the wrong account type at sign-up.
//
//   Who        the site Owner only (the route checks, and asks for a fresh
//              password like a bank payment). Everyone else never sees it.
//   Needs      a confirmation and a written reason.
//   Blocked    when the person has paid (an approved payment) or has an
//              approved document — unless the Owner confirms a SECOND time,
//              with the paid items and approved documents named (never a
//              number or an amount). No payment is ever changed or refunded.
//   Reversible the same button on the converted account changes it back.
//
// Parent → Tutor: the same account and login; a tutor profile draft with the
// name and city; their tuitions are kept, shown as "posted as a parent".
// Tutor → Parent: the tutor profile is kept but hidden (out of search and the
// sitemap) and its public address 301s to Browse tutors for their city.
//
// Unit-tested by scripts/test-tutor-journey.ts.

export type AccountRole = 'tutor' | 'parent'

export function convertTarget(role: string | null | undefined): AccountRole | null {
  if (role === 'tutor') return 'parent'
  if (role === 'parent') return 'tutor'
  return null
}

export const ROLE_WORD: Record<AccountRole, string> = { tutor: 'Tutor', parent: 'Parent' }

export function convertButtonLabel(role: AccountRole): string {
  return `Change to ${ROLE_WORD[convertTarget(role) as AccountRole]}`
}

export type ConvertFacts = {
  /** Approved, not refunded payments: their plan name and approval date (words only). */
  paid: { plan: string; date: string }[]
  /** Approved documents, as words: "CNIC", "Profile photo", "Selfie", "Home address". */
  approvedDocs: string[]
}

/** The blockers, in words — never a number, an amount or a CNIC. */
export function convertBlockers(f: ConvertFacts): string[] {
  return [...f.paid.map((p) => `${p.plan} paid on ${p.date}`), ...f.approvedDocs.map((d) => `${d} approved`)]
}

export type ConvertDecision = { ok: true } | { ok: false; needsOverride: true; blockers: string[]; message: string } | { ok: false; needsOverride: false; message: string }

export function convertDecision(args: { role: string | null | undefined; reason: string; facts: ConvertFacts; override: boolean }): ConvertDecision {
  if (!convertTarget(args.role)) return { ok: false, needsOverride: false, message: 'Only a tutor or a parent account can be changed.' }
  const reason = args.reason.trim()
  if (reason.length < 3) return { ok: false, needsOverride: false, message: 'Write the reason for the change.' }
  if (reason.length > 500) return { ok: false, needsOverride: false, message: 'Keep the reason under 500 characters.' }
  const blockers = convertBlockers(args.facts)
  if (blockers.length && !args.override)
    return {
      ok: false,
      needsOverride: true,
      blockers,
      message: `This person has ${blockers.length === 1 ? 'something' : 'things'} that stay with the account: ${blockers.join('; ')}. Confirm again to change it anyway. No payment is changed or refunded.`,
    }
  return { ok: true }
}

// ---- Another account of the target type already belongs to this person ------
// (hotfix, 27 Oct 2026). Changing a parent account to a tutor account when the
// same mobile or CNIC is already on a tutor account would either be refused by
// the database (one tutor account per verified mobile) or leave two tutor
// accounts for one person. So it stops with a clear message naming the other
// account and offers "Merge into that tutor account instead".

export type ClashCandidate = { id: string; name: string; role: string | null; phone: string | null; cnic: string | null; linkedAccountId: string | null }
export type ConvertClash = { id: string; name: string; phoneMasked: string | null; reason: 'mobile' | 'cnic' | 'linked' }

const lastTen = (s: string | null | undefined) => {
  const d = (s ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : ''
}
const cnicDigits = (s: string | null | undefined) => {
  const d = (s ?? '').replace(/\D/g, '')
  return d.length === 13 ? d : ''
}

/** The first account of the target type that shares this person's mobile,
 *  CNIC or a two-way link — or null. Never returns a number in the clear. */
export function findConvertClash(
  self: { id: string; phone: string | null; cnic: string | null; linkedAccountId: string | null },
  to: AccountRole,
  candidates: ClashCandidate[],
  mask: (p: string | null) => string | null,
): ConvertClash | null {
  const phone = lastTen(self.phone)
  const cnic = cnicDigits(self.cnic)
  for (const c of candidates) {
    if (c.id === self.id || c.role !== to) continue
    let reason: ConvertClash['reason'] | null = null
    if (cnic && cnicDigits(c.cnic) === cnic) reason = 'cnic'
    else if (phone && lastTen(c.phone) === phone) reason = 'mobile'
    else if (self.linkedAccountId === c.id || c.linkedAccountId === self.id) reason = 'linked'
    if (reason) return { id: c.id, name: c.name || 'Member', phoneMasked: mask(c.phone), reason }
  }
  return null
}

export function convertClashMessage(c: ConvertClash, to: AccountRole): string {
  const why = c.reason === 'cnic' ? 'the same CNIC' : c.reason === 'mobile' ? 'the same mobile' : 'a link to this account'
  const phone = c.phoneMasked ? `, ${c.phoneMasked}` : ''
  return `This person already has a ${ROLE_WORD[to]} account with ${why}: ${c.name} (ID ${c.id}${phone}). Merge this account into that one instead of changing it.`
}

/** A database refusal, in words, with every long run of digits removed — so
 *  an error never carries a phone or CNIC number into the screen or the log. */
export function plainDbError(e: { code?: string | null; message?: string | null } | null | undefined): string {
  const msg = String(e?.message ?? '').replace(/\d[\d\s-]{4,}\d/g, '<number>').slice(0, 200)
  return e?.code ? `${e.code}: ${msg}` : msg
}

/** The merge screen for this account and the clashing one (a parent account is
 *  always merged INTO the tutor account — lib/memberMergeCore suggestKeep). */
export function mergeInsteadHref(memberId: string, otherId: string): string {
  return `/admin/users/merge?a=${memberId}&b=${otherId}`
}

/** The in-app notice (and the email's first line). */
export function convertNotice(to: AccountRole): { title: string; body: string; href: string } {
  return to === 'tutor'
    ? { title: 'Your account is now a Tutor account', body: 'Your next step is to finish your tutor profile, so parents can find you.', href: '/tutor/dashboard' }
    : { title: 'Your account is now a Parent account', body: 'You can now post a tuition and contact tutors.', href: '/parent/dashboard' }
}

/** Where a hidden (converted) tutor's public address goes. */
export function convertedTutorRedirect(city: string | null | undefined): string {
  const c = (city ?? '').trim()
  return c ? `/browse/tutors?city=${encodeURIComponent(c)}` : '/browse/tutors'
}

/** A tuition owned by a tutor account was posted while it was a parent account. */
export function postedAsParent(ownerRole: string | null | undefined): boolean {
  return ownerRole === 'tutor'
}
