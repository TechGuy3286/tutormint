// lib/tutorDocStatus.ts
//
// Map a profile row (+ whether a selfie file exists) to the three document
// states the badge rule reads. PURE (cnicStatus + badgeRule are pure), so
// lib/badgeFacts (lists), lib/entitlements (dashboard) and the tests all derive
// the states the SAME way.

import { deriveCnicStatus, cnicHasDocuments } from '@/lib/cnicStatus'
import type { TutorDocs, DocState, DocStatusValue } from '@/lib/badgeRule'

export type ProfileDocRow = {
  verification_state?: string | null
  verification_rejection_reason?: string | null
  cnic_verified_at?: string | null
  cnic_number?: string | null
  cnic_image_path?: string | null
  profile_pic_status?: string | null
  profile_pic_reason?: string | null
  selfie_status?: string | null
  selfie_reason?: string | null
  avatar_url?: string | null
}

const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0

function docState(status: string | null | undefined, hasFile: boolean, reason: string | null | undefined): DocState {
  const s = (status ?? 'none').toLowerCase() as DocStatusValue
  // A status without a file reads as 'none' (PR106-E §5), except 'rejected',
  // which stands so the block screen still fires.
  const rawStatus: DocStatusValue = s === 'rejected' ? 'rejected' : hasFile ? (s === 'approved' ? 'approved' : s === 'none' ? 'pending' : s) : 'none'
  return { present: hasFile || s === 'rejected', rawStatus, reasonPresent: filled(reason) && s !== 'approved' }
}

export function tutorDocStatusesFromProfile(p: ProfileDocRow, hasSelfieFile: boolean): TutorDocs {
  const cnicFacts = {
    verification_state: p.verification_state ?? null,
    cnic_verified_at: p.cnic_verified_at ?? null,
    cnic_number: p.cnic_number ?? null,
    cnic_image_path: p.cnic_image_path ?? null,
  }
  const cnicStatus = deriveCnicStatus(cnicFacts)
  // The CNIC "file" is the number AND the image (PR106-E §5) — a marker without
  // the documents is not submitted for the badge.
  const cnicHasFile = cnicHasDocuments(cnicFacts)
  return {
    cnic: {
      present: cnicHasFile,
      rawStatus: cnicStatus as DocStatusValue,
      reasonPresent: filled(p.verification_rejection_reason) && cnicStatus !== 'approved',
    },
    photo: docState(p.profile_pic_status, filled(p.avatar_url), p.profile_pic_reason),
    selfie: docState(p.selfie_status, hasSelfieFile, p.selfie_reason),
  }
}
