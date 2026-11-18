// lib/eraseRequestedCore.ts — PURE (owner, 18 Nov 2026 — PR-04).
//
// A member who asked for their account to be erased (account_erasures status
// 'scheduled', the 7-day grace) is never followed up. They leave every People
// stage and chip, the follow-up lists, Tried to pay, the sidebar badge, the
// Overview to-dos and the WhatsApp / follow-up queues at once — as an excluded
// reason in lib/peopleDirectoryCore, the same path deleted accounts take — and
// appear only under a grey "Erase requested (N)" chip with the erase date. If
// the erase is cancelled they return to their normal stage.
//
// On their member page: a red banner, contact buttons disabled for staff (the
// Owner sees a warning and can still contact), and the same warning over
// document approval (allowed).

export const ERASE_BANNER = 'Erase requested — don’t contact'
export const ERASE_CHIP_LABEL = 'Erase requested'
export const ERASE_CHIP_HINT = 'Members who asked for their account to be erased. Never followed up; they return to their stage if the erase is cancelled.'
export const ERASE_CONTACT_REFUSED = 'This member asked for their account to be erased. Don’t contact them.'

/** What a staff member may do about contacting an erase-requested member. */
export type EraseContact = 'allowed' | 'warn' | 'blocked'

export function eraseContactPolicy(eraseRequested: boolean, adminRole: string | null | undefined): EraseContact {
  if (!eraseRequested) return 'allowed'
  return adminRole === 'owner' ? 'warn' : 'blocked'
}

/** "Erase on 23 Nov 2026" (Pakistan time). */
export function eraseDateLine(dueAt: string | null | undefined): string {
  if (!dueAt) return ERASE_CHIP_LABEL
  const t = Date.parse(dueAt)
  if (!Number.isFinite(t)) return ERASE_CHIP_LABEL
  const d = new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })
  return `Erase on ${d}`
}

/** A stored People row's tags after an erase is scheduled (dueAt) or cancelled
 *  (null). `excluded_base` is the row's own excluded fact without the erase, so
 *  a cancel returns it exactly to where it was. */
export function eraseTags(tags: Record<string, unknown>, dueAt: string | null): Record<string, unknown> {
  const base = typeof tags.excluded_base === 'boolean' ? tags.excluded_base : tags.erase_req === true ? false : tags.excluded === true
  return { ...tags, excluded_base: base, erase_req: !!dueAt, excluded: base || !!dueAt }
}

/** Did this change move the row in or out of the real (counted) lists? */
export function eraseMovesCount(tags: Record<string, unknown>, dueAt: string | null): 'out' | 'in' | 'none' {
  const before = tags.excluded === true
  const after = eraseTags(tags, dueAt).excluded === true
  return before === after ? 'none' : after ? 'out' : 'in'
}
