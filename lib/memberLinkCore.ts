// lib/memberLinkCore.ts
//
// One rule for "a member's name opens their admin member page" (owner,
// 11 Nov 2026 — Payments, Finance and the bank-transfer approval list). The
// name shown is the display name the loaders already read (profiles.full_name,
// the Display name else the Name on CNIC); a row with no account (deleted)
// stays plain text. Phone and account numbers are never part of the link.
//
// PURE — tested by scripts/test-staff-pause.ts.

export function memberAdminHref(memberId: string | null | undefined): string | null {
  if (!memberId) return null
  return /^[0-9a-f-]{36}$/i.test(memberId) ? `/admin/users/${memberId}` : null
}
