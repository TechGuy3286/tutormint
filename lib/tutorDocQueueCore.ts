// lib/tutorDocQueueCore.ts
//
// ONE rule for "what is waiting" on a tutor's identity documents (owner,
// 9 Oct 2026). The review card (components/admin/TutorDocumentReview via
// lib/tutorDocuments loadDocumentStatuses) and the approval queue
// (lib/approvalQueue — Overview "Documents to approve", People "Approval
// needed", the sidebar badges) both read tutorCardStatuses(), so the queue can
// never say "Waiting: CNIC" while the card says Approved.
//
// The bug this closes: the queue read the RAW profiles.verification_state,
// while the card reads the derived CNIC status (lib/cnicStatus — approved when
// the approval marker cnic_verified_at is set AND the documents are on file).
// A tutor who re-uploaded a CNIC side after approval had verification_state
// set back to 'submitted' with cnic_verified_at kept, so the card showed
// Approved and the queue kept listing her (Esha Asghar).
//
// An item is WAITING when the card shows it Pending AND offers a decision (a
// file is on file to review) — so approving or rejecting every waiting item
// always empties the member from the queue.
//
// PURE — unit-tested by scripts/test-approvalqueue.ts.

import { deriveCnicStatus } from '@/lib/cnicStatus'

export type CardDocStatus = 'none' | 'pending' | 'approved' | 'rejected'
export type CardDocState = { status: CardDocStatus; reason: string | null; hasUpload: boolean }
export type CardStatuses = { cnic: CardDocState; profilePic: CardDocState; selfie: CardDocState }

export type TutorDocFacts = {
  verification_state?: string | null
  verification_rejection_reason?: string | null
  cnic_verified_at?: string | null
  cnic_number?: string | null
  cnic_image_path?: string | null
  avatar_url?: string | null
  profile_pic_status?: string | null
  profile_pic_reason?: string | null
  selfie_status?: string | null
  selfie_reason?: string | null
  /** An active selfie document is on file. */
  hasSelfieFile: boolean
  /** tutor_profiles.video_status. */
  video_status?: string | null
}

function norm(v: unknown): CardDocStatus {
  return v === 'pending' || v === 'approved' || v === 'rejected' ? v : 'none'
}
const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0

/** The three statuses exactly as the review card shows them. */
export function tutorCardStatuses(f: TutorDocFacts): CardStatuses {
  const single = deriveCnicStatus({
    verification_state: f.verification_state ?? null,
    cnic_verified_at: f.cnic_verified_at ?? null,
    cnic_number: f.cnic_number ?? null,
    cnic_image_path: f.cnic_image_path ?? null,
  })
  const cnic: CardDocStatus = single === 'submitted' ? 'pending' : single
  return {
    // The CNIC's upload state is carried by verification_state; anything past
    // 'none' means it has been submitted.
    cnic: { status: cnic, reason: f.verification_rejection_reason ?? null, hasUpload: cnic !== 'none' },
    profilePic: { status: norm(f.profile_pic_status), reason: f.profile_pic_reason ?? null, hasUpload: filled(f.avatar_url) },
    selfie: { status: norm(f.selfie_status), reason: f.selfie_reason ?? null, hasUpload: f.hasSelfieFile },
  }
}

/** The items waiting for a staff decision, by label, in display order. */
export function tutorWaiting(f: TutorDocFacts): string[] {
  const s = tutorCardStatuses(f)
  const out: string[] = []
  if (s.cnic.status === 'pending' && s.cnic.hasUpload) out.push('CNIC')
  if (s.profilePic.status === 'pending' && s.profilePic.hasUpload) out.push('Photo')
  if (s.selfie.status === 'pending' && s.selfie.hasUpload) out.push('Selfie')
  if ((f.video_status ?? '') === 'uploaded') out.push('Video')
  return out
}

/** The small note on a CNIC with only one side on file. Never blocks approval. */
export function cnicSideNote(hasFront: boolean, hasBack: boolean): string | null {
  if (hasFront && !hasBack) return 'Back side missing'
  if (hasBack && !hasFront) return 'Front side missing'
  return null
}
