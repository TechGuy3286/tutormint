// lib/cnicStatus.ts
//
// ONE source of truth for a tutor's CNIC status (PR66 §4). Every surface that
// shows CNIC status — onboarding, Settings, the admin panel, completion — derives
// it from here, so they can never disagree again.
//
// The rule the owner set: a CNIC is "approved" only when the approval marker is
// set AND a CNIC number AND a CNIC image are on file. An account whose marker
// says approved but has no number/image is shown as pending (never verified) —
// this only changes what is DISPLAYED; it never writes to any account.
//
// PURE — no imports — so the client, the server and the admin all read it.

export type CnicStatus = 'none' | 'submitted' | 'approved' | 'rejected'

export type CnicFacts = {
  /** profiles.verification_state ('none' | 'submitted' | 'approved' | 'rejected'). */
  verification_state?: string | null
  /** profiles.cnic_verified_at — the approval timestamp, if any. */
  cnic_verified_at?: string | null
  /** profiles.cnic_number. */
  cnic_number?: string | null
  /** profiles.cnic_image_path. */
  cnic_image_path?: string | null
}

const filled = (v: string | null | undefined) => !!(v && v.trim())

export function cnicHasDocuments(f: CnicFacts): boolean {
  return filled(f.cnic_number) && filled(f.cnic_image_path)
}

/** The single CNIC status. 'approved' requires the marker AND the documents. */
export function deriveCnicStatus(f: CnicFacts): CnicStatus {
  const marker = filled(f.cnic_verified_at) || (f.verification_state ?? '').toLowerCase() === 'approved'
  if (marker && cnicHasDocuments(f)) return 'approved'

  const vs = (f.verification_state ?? '').toLowerCase()
  if (vs === 'rejected') return 'rejected'
  // 'approved' without the documents, or 'submitted', both read as pending review.
  if (vs === 'approved' || vs === 'submitted') return 'submitted'
  return 'none'
}

/** True when the account is marked CNIC-approved but is missing the number or
 *  image — the state the owner wants surfaced as pending, not verified (§4). */
export function cnicApprovedWithoutDocuments(f: CnicFacts): boolean {
  const marker = filled(f.cnic_verified_at) || (f.verification_state ?? '').toLowerCase() === 'approved'
  return marker && !cnicHasDocuments(f)
}
