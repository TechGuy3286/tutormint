// lib/deletedUserCore.ts
//
// "Deleted user" rows (owner, 20 Nov 2026 — PR-11) — the pure half. Wherever an
// erased member still appears (Payments, Finance, statement matches,
// Applications, People → Deleted, timelines), the row is grey and reads
// "Deleted user · erased <date>" with the neutral default avatar: no name,
// photo, phone, email or other personal detail, and no contact or action
// button — except the Owner's money actions (refund, link a bank credit) where
// the screen already has them. Amounts and dates stay.

export const DELETED_USER = 'Deleted user'

/** "Deleted user · erased 20 Nov 2026" (Pakistan date). */
export function deletedUserLine(erasedAt: string | null | undefined): string {
  if (!erasedAt) return DELETED_USER
  const t = Date.parse(erasedAt)
  if (!Number.isFinite(t)) return DELETED_USER
  const d = new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })
  return `${DELETED_USER} · erased ${d}`
}

/** The grey row (a background + text pair listed in scripts/contrast-check.ts). */
export const DELETED_ROW_CLASS = 'bg-gray-100 text-gray-600'

/**
 * What a row may show about a member: an erased member → the deleted line and
 * nothing personal; anyone else → unchanged. `erasedAt` set = erased.
 */
export function shownMember<T extends { name: string; erasedAt?: string | null }>(row: T): T & { deleted: boolean } {
  if (!row.erasedAt) return { ...row, deleted: false }
  return { ...row, name: deletedUserLine(row.erasedAt), deleted: true }
}

/** Personal fields a deleted row must never carry to the browser. */
export const DELETED_ROW_STRIP = ['email', 'phone', 'phoneNumber', 'whatsapp', 'maskedPhone', 'avatar', 'avatarUrl', 'city', 'area', 'address', 'cnic'] as const

/** The row with every personal field emptied (shape kept, so the UI code is unchanged). */
export function stripDeleted<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row }
  for (const k of DELETED_ROW_STRIP) if (k in out) out[k] = null
  return out as T
}
