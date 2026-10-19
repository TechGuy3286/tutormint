// lib/adminDocUploadCore.ts
//
// Staff uploads of a tutor's CNIC (front/back), profile picture or selfie from
// the admin edit screen, and the CNIC number typed there (owner, 19 Oct 2026).
//
//   - The Owner may always upload or replace, even an approved, locked
//     document. The upload is saved as approved (it is the Owner's approval),
//     and replacing a locked one counts as the unlock — it is audit-logged.
//   - Any other staff role that may edit tutors may upload only while the part
//     is NOT approved and locked. The upload waits for the Owner's approval
//     ('pending'; a missing side of an approved CNIC waits as a 'review'
//     upload, the member path's rule). A locked part is refused with 403.
//   - The CNIC number: a masked value (X, *, •) is never saved — the stored
//     number is left as it is. The Owner may always save a real number; anyone
//     else only while the CNIC is not approved (it then waits with the CNIC).
//
// Every refusal is a 4xx with a plain-English message — never a 200.
//
// PURE — unit-tested by scripts/test-admin-doc-upload.ts.

import { isValidCnic } from '@/lib/cnic'

export const ADMIN_LOCKED_ERROR = 'This document is approved and locked. Only the Owner can replace it.'
export const ADMIN_NUMBER_LOCKED_ERROR = 'This CNIC is approved and locked. Only the Owner can change its number.'
export const CNIC_NUMBER_FORMAT_ERROR = 'Enter the 13-digit CNIC number, for example 35201-1234567-1.'

export type AdminUploadDecision =
  | { allow: true; saveAs: 'approved' | 'pending' | 'review'; replacedLocked: boolean }
  | { allow: false; status: 403; error: string }

/**
 * May this staff member upload this part, and how is it saved?
 * `approved` — the item is approved; `partOnRecord` — an approved file for this
 * part is on record (both together = locked).
 */
export function adminUploadDecision(f: { isOwner: boolean; approved: boolean; partOnRecord: boolean }): AdminUploadDecision {
  const locked = f.approved && f.partOnRecord
  if (f.isOwner) return { allow: true, saveAs: 'approved', replacedLocked: locked }
  if (locked) return { allow: false, status: 403, error: ADMIN_LOCKED_ERROR }
  return { allow: true, saveAs: f.approved ? 'review' : 'pending', replacedLocked: false }
}

/** The status label the card shows after a staff upload. */
export function uploadStatusLabel(saveAs: 'approved' | 'pending' | 'review'): string {
  return saveAs === 'approved' ? 'Approved' : 'Waiting for approval'
}

/** A masked CNIC as admin screens show it (XXXXX-XXXXXXX-4, 42101-*****-2). */
export function isMaskedCnic(v: string | null | undefined): boolean {
  return /[xX*•●]/.test(v ?? '')
}

export type CnicNumberDecision =
  | { action: 'keep' }
  | { action: 'save' }
  | { action: 'refuse'; status: 400 | 403; error: string }

export function cnicNumberDecision(f: { input: string | null | undefined; isOwner: boolean; cnicApproved: boolean }): CnicNumberDecision {
  const raw = (f.input ?? '').trim()
  // A masked or empty value never overwrites the real number.
  if (!raw || isMaskedCnic(raw)) return { action: 'keep' }
  if (!isValidCnic(raw)) return { action: 'refuse', status: 400, error: CNIC_NUMBER_FORMAT_ERROR }
  if (!f.isOwner && f.cnicApproved) return { action: 'refuse', status: 403, error: ADMIN_NUMBER_LOCKED_ERROR }
  return { action: 'save' }
}

/** A client-side read of an upload response: a 2xx is success only when it
 *  carries what was stored; anything else is a failure with a message. */
export function readUploadResponse(status: number, json: { documentId?: unknown; url?: unknown; error?: unknown; statusLabel?: unknown; [k: string]: unknown }):
  | { ok: true; documentId: string | null; url: string | null; statusLabel: string | null }
  | { ok: false; error: string } {
  const ok = status >= 200 && status < 300
  const documentId = typeof json.documentId === 'string' ? json.documentId : null
  const url = typeof json.url === 'string' ? json.url : null
  if (ok && (documentId || url)) {
    return { ok: true, documentId, url, statusLabel: typeof json.statusLabel === 'string' ? json.statusLabel : null }
  }
  if (typeof json.error === 'string' && json.error) return { ok: false, error: json.error }
  if (status === 413) return { ok: false, error: 'That photo was too large. Please try again.' }
  return { ok: false, error: ok ? 'The upload did not come back as expected. Reload the page to check it.' : `Upload failed (${status}).` }
}
