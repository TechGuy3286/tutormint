// lib/dataopMatch.ts
//
// Pure identity-matching helpers for the data-op removal script (HOTFIX-64 §3),
// so "matches every phone format" is unit-tested without touching the DB.
//
// A Pakistani mobile is reduced to its canonical 12-digit MSISDN (92XXXXXXXXXX)
// and its 10-digit core (3XXXXXXXXX) regardless of how it was written: 03…,
// 3…, 92…, 0092…, +92…, with dashes or spaces. The synthetic signup email is
// <msisdn>@users.tutormint.org, derived from the same MSISDN.

export type MobileParts = { msisdn: string; core10: string; synthetic: string }

/** Normalise any Pakistani-mobile shape to its MSISDN + 10-digit core, or null. */
export function normMobile(raw: string): MobileParts | null {
  let m = raw.replace(/\D/g, '')
  if (m.startsWith('0092')) m = m.slice(2)
  if (m.length === 11 && m.startsWith('0')) m = '92' + m.slice(1)
  else if (m.length === 10 && m.startsWith('3')) m = '92' + m
  else if (m.length === 13 && m.startsWith('920')) m = '92' + m.slice(3)
  if (!(m.length === 12 && m.startsWith('923'))) return null
  return { msisdn: m, core10: m.slice(2), synthetic: `${m}@users.tutormint.org` }
}

/** Does a stored free-text phone (any format) refer to this 10-digit core? */
export function phoneMatchesCore(stored: string | null | undefined, core10: string): boolean {
  if (!stored) return false
  const d = stored.replace(/\D/g, '')
  return d.endsWith(core10)
}
