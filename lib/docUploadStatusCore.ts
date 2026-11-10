// lib/docUploadStatusCore.ts
//
// What a new upload does to a document's review status, and the repair of
// accounts left behind (owner, 10 Nov 2026). PURE — tested by
// scripts/test-doc-upload-status.ts.
//
// The bug: several upload paths saved the file but never set the status, so a
// CNIC (verification_state stayed 'none'), a first profile photo
// (profile_pic_status stayed empty) and some selfies were on file with no
// status. The admin card then read "Not uploaded" over real images and offered
// no Approve/Reject, and People counted those tutors as "Documents missing".
// Only the separate CNIC "Submit" step and a re-upload after a rejection ever
// set a status.
//
// The rule, one place:
//   - a new file with NO decision on record → waiting ("pending"; for the CNIC
//     the vocabulary is verification_state 'submitted');
//   - a new file after a REJECTION → waiting again (the rejection was about the
//     old file); the rejection reason is left as it is (PR106-H4: it keeps the
//     badge paused until staff approve);
//   - an APPROVED document is never changed here — a replacement waits as a
//     re-review (lib/docLockCore, migration 222) and the approval stays.

const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0
const low = (v: unknown) => String(v ?? '').trim().toLowerCase()

/** The CNIC is approved (the marker). */
export function cnicApprovedMarker(p: { verification_state?: string | null; cnic_verified_at?: string | null }): boolean {
  return filled(p.cnic_verified_at) || low(p.verification_state) === 'approved'
}

/** The profiles patch a NEW CNIC side upload makes, or null when it must not
 *  touch the status (approved, or already waiting). */
export function cnicPatchAfterUpload(
  p: { verification_state?: string | null; cnic_verified_at?: string | null },
  nowIso: string,
): { verification_state: 'submitted'; verification_submitted_at: string } | null {
  if (cnicApprovedMarker(p)) return null
  if (low(p.verification_state) === 'submitted') return null
  return { verification_state: 'submitted', verification_submitted_at: nowIso }
}

/** profile_pic_status / selfie_status after a NEW file is saved, or null when
 *  it must stay as it is (approved, or already pending). */
export function itemStatusAfterUpload(current: string | null | undefined): 'pending' | null {
  const s = low(current)
  if (s === 'approved' || s === 'pending') return null
  return 'pending'
}

// ── The display rule ─────────────────────────────────────────────────────────

/** A file is on record but nobody has decided: the card shows it waiting. */
export function fileWithoutDecision(status: string | null | undefined, hasFile: boolean): boolean {
  if (!hasFile) return false
  const s = low(status)
  return s === '' || s === 'none'
}

// ── The repair of existing accounts ──────────────────────────────────────────

export type RepairFacts = {
  verification_state?: string | null
  cnic_verified_at?: string | null
  /** An active CNIC image (front or back) is on file. */
  hasCnicFile: boolean
  avatar_url?: string | null
  profile_pic_status?: string | null
  selfie_status?: string | null
  /** An active selfie document is on file. */
  hasSelfieFile: boolean
}

export type RepairPlan = { cnic: boolean; photo: boolean; selfie: boolean }

/** Which statuses the repair would set to waiting. Approved and rejected are
 *  never touched; neither is an already-waiting item. */
export function repairPlanFor(f: RepairFacts): RepairPlan {
  return {
    cnic: f.hasCnicFile && !cnicApprovedMarker(f) && fileWithoutDecision(f.verification_state, true),
    photo: fileWithoutDecision(f.profile_pic_status, filled(f.avatar_url)),
    selfie: fileWithoutDecision(f.selfie_status, f.hasSelfieFile),
  }
}

export function repairPatch(plan: RepairPlan, nowIso: string): Record<string, string> {
  const patch: Record<string, string> = {}
  if (plan.cnic) {
    patch.verification_state = 'submitted'
    patch.verification_submitted_at = nowIso
  }
  if (plan.photo) patch.profile_pic_status = 'pending'
  if (plan.selfie) patch.selfie_status = 'pending'
  return patch
}
