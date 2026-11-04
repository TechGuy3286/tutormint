// lib/memberLocksCore.ts — PURE, client-safe.
//
// What a member can change on their own Edit Profile page (owner, 4 Nov 2026).
// This REPLACES every older member lock rule (the approved photo / selfie lock
// of 9 and 17 Oct, the Step-1 lock of PR72 §E):
//
//   LOCKED for the member   Mobile number (once verified), CNIC — number and
//                           pictures (once approved), Email (once a real
//                           address is the account's sign-in address).
//                           Staff and the Owner still change them from admin.
//   EDITABLE at any time    everything else, after approval too: profile
//                           picture and selfie (a change goes back to review,
//                           the approved one stays public until then),
//                           subjects, cities and areas, job type, availability,
//                           degrees, certifications, experience, monthly fee,
//                           Tagline & About, name, WhatsApp, password, and
//                           "Hide my photo from parents".
//
// Before a value exists the member provides it as before (verifying a mobile in
// onboarding, uploading a CNIC, adding a first email) — "locked" means a member
// cannot CHANGE it.

import { waSendHref } from './waLinkCore'
import { isSyntheticEmail } from './phone'

export type MemberLockField = 'mobile' | 'cnic' | 'email'

/** The one English line in each locked box. No Urdu (owner, 4 Nov 2026). */
export const MEMBER_LOCK_LINE: Record<MemberLockField, string> = {
  mobile: 'To change your mobile number, please contact our support.',
  cnic: 'To change your CNIC, please contact our support.',
  email: 'To change your email, please contact our support.',
}

export const SUPPORT_WHATSAPP_DISPLAY = '0321 5872222'
export const SUPPORT_WHATSAPP_MSISDN = '923215872222'

const WHAT: Record<MemberLockField, string> = { mobile: 'mobile number', cnic: 'CNIC', email: 'email' }

/** WhatsApp support with "Hi TutorMint, I want to change my <field>." */
export function memberLockWhatsappHref(field: MemberLockField): string {
  return waSendHref(SUPPORT_WHATSAPP_MSISDN, `Hi TutorMint, I want to change my ${WHAT[field]}.`)
}

/** A verified mobile is locked. */
export function mobileLocked(f: { phoneVerifiedAt: string | null | undefined }): boolean {
  return !!(f.phoneVerifiedAt && String(f.phoneVerifiedAt).trim())
}

/** A real sign-in address on the account is locked. A mobile sign-up (whose
 *  sign-in address is the auto-made placeholder) may still add one, and may
 *  replace an address that is only waiting for its confirmation link. */
export function emailLocked(f: { authEmail: string | null | undefined }): boolean {
  const e = (f.authEmail ?? '').trim()
  return !!e && e.includes('@') && !isSyntheticEmail(e)
}

/** An approved CNIC (number and both pictures) is locked. */
export function cnicLocked(f: { cnicVerifiedAt?: string | null; verificationState?: string | null }): boolean {
  return !!(f.cnicVerifiedAt && String(f.cnicVerifiedAt).trim()) || String(f.verificationState ?? '').toLowerCase() === 'approved'
}

/** The server's refusal for a member trying to change a locked field. */
export function memberLockRefusal(field: MemberLockField): { status: 403; error: string; locked: true } {
  return { status: 403, error: MEMBER_LOCK_LINE[field], locked: true }
}

/**
 * A replaced profile picture or selfie goes back to review (owner, 4 Nov 2026).
 * Never refused. When an APPROVED one is on record, the new one waits: the
 * approved file stays the public one, and the Verified badge stays, until the
 * Owner decides. Otherwise it is an ordinary upload.
 */
export function replaceDecision(f: { approved: boolean; onRecord: boolean }): 'review' | 'normal' {
  return f.approved && f.onRecord ? 'review' : 'normal'
}

/** The name-change flag for the Owner's review queue (owner, 4 Nov 2026): a
 *  tutor with an approved CNIC changed their name. Saved, never blocked. */
export const NAME_CHANGED_LABEL = 'Name changed — check against CNIC'

export function nameChangeNeedsCheck(f: {
  role: string | null | undefined
  cnicApproved: boolean
  oldName: string | null | undefined
  newName: string | null | undefined
}): boolean {
  if (f.role !== 'tutor' || !f.cnicApproved) return false
  const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  return norm(f.oldName) !== norm(f.newName)
}

/**
 * The Owner's decision on a REPLACED profile picture (owner, 4 Nov 2026).
 *   approve + a waiting photo → it becomes the public photo
 *   reject  + a waiting photo → the approved photo stays (keepOld)
 *   no waiting photo (a change made before migration 222, already live) →
 *     approve keeps it; reject rejects the photo as before.
 */
export function photoRereviewOutcome(f: { approve: boolean; pendingUrl: string | null }): {
  newAvatarUrl: string | null
  keepOld: boolean
  rejectPhoto: boolean
} {
  const pending = f.pendingUrl && f.pendingUrl.trim() ? f.pendingUrl : null
  if (f.approve) return { newAvatarUrl: pending, keepOld: false, rejectPhoto: false }
  return pending ? { newAvatarUrl: null, keepOld: true, rejectPhoto: false } : { newAvatarUrl: null, keepOld: false, rejectPhoto: true }
}
