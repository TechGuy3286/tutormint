// lib/badgeRule.ts
//
// THE ONE Verified-badge rule for tutors (owner, PR106-H4). Pure — no server
// imports — so lib/badgeFacts (lists), lib/entitlements (dashboard/profile) and
// the activity gates all read the SAME rule and can never disagree.
//
// NEW rule (owner decision): the team is too small to approve before a tutor is
// shown, so the Verified badge appears the moment the fee is paid and the
// required documents are SUBMITTED — staff approval is NOT required. A later
// staff REJECTION pauses the badge and blocks new activity.
//
//   Verified badge (tutor) = fee paid
//                            AND CNIC, profile photo and selfie all submitted
//                            AND none of them currently blocked by a rejection.
//
// THE RE-REVIEW SUBTLETY (§2.7): once staff reject a document, re-uploading it
// must NOT auto-restore the badge — it re-queues for staff, who approve before
// the badge returns. We represent this WITHOUT a new column: the rejection
// REASON lingers (reviewTutorDocument clears it only on approve), so a document
// with a reason still set is "blocked" even after its status goes back to
// pending/submitted on re-upload. Approval clears the reason and the block.

export type DocStatusValue = 'none' | 'submitted' | 'pending' | 'approved' | 'rejected'

/** One required document's state. `reasonPresent` = staff left a rejection reason
 *  that has not been cleared by an approval (so it blocks even if re-uploaded). */
export type DocState = {
  present: boolean
  rawStatus: DocStatusValue
  reasonPresent: boolean
}

export type TutorDocs = {
  cnic: DocState
  photo: DocState
  selfie: DocState
}

const REQUIRED = ['cnic', 'photo', 'selfie'] as const

/** A document blocks the badge/activity when it is rejected, or was rejected and
 *  is awaiting re-review (reason still present and not yet re-approved). */
export function docBlocks(d: DocState): boolean {
  if (d.rawStatus === 'approved') return false
  return d.rawStatus === 'rejected' || d.reasonPresent
}

/** A document counts as submitted once a file is present (any non-'none' state). */
export function docSubmitted(d: DocState): boolean {
  return d.present && d.rawStatus !== 'none'
}

export function tutorDocsSubmitted(docs: TutorDocs): boolean {
  return REQUIRED.every((k) => docSubmitted(docs[k]))
}

/** Any required document is blocked (pauses the badge + activity). */
export function tutorDocRejected(docs: TutorDocs): boolean {
  return REQUIRED.some((k) => docBlocks(docs[k]))
}

/** The Verified badge rule. `feePaid` is the Rs 199 one-time fee. */
export function tutorVerifiedBadgeOk(feePaid: boolean, docs: TutorDocs): boolean {
  return feePaid && tutorDocsSubmitted(docs) && !tutorDocRejected(docs)
}

export type RejectedDoc = {
  key: 'cnic' | 'photo' | 'selfie'
  label: string
  labelUr: string
  /** True once the member re-uploaded it and it is awaiting staff re-review
   *  (status back to pending/submitted but the reason still lingers). Drives
   *  "being reviewed" vs "please upload a correct …". */
  awaitingReview: boolean
}

const LABELS: Record<RejectedDoc['key'], { label: string; labelUr: string }> = {
  cnic: { label: 'CNIC photo', labelUr: 'شناختی کارڈ کی تصویر' },
  photo: { label: 'profile photo', labelUr: 'پروفائل تصویر' },
  selfie: { label: 'selfie', labelUr: 'سیلفی' },
}

/** The FIRST blocked required document (CNIC → photo → selfie), or null. Drives
 *  the single block screen. */
export function firstRejectedDoc(docs: TutorDocs): RejectedDoc | null {
  for (const key of REQUIRED) {
    const d = docs[key]
    if (docBlocks(d)) {
      return { key, ...LABELS[key], awaitingReview: d.rawStatus !== 'rejected' }
    }
  }
  return null
}

/** Where the member re-uploads — the identity section of tutor settings. */
export const REUPLOAD_HREF = '/tutor/dashboard/settings#identity'
