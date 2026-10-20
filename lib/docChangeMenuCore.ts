// lib/docChangeMenuCore.ts
//
// One "Change ▾" menu on a decided document (CNIC, profile picture, selfie,
// a parent's address) in place of the separate "Change decision" and "Unlock
// for re-upload" buttons (owner, 20 Oct 2026).
//
// Approving, rejecting and unlocking are the Owner's alone (owner, 15 Oct
// 2026). The menu therefore offers NOTHING to anyone else — they see what they
// saw before: the status and "View only — approvals are made by the Owner."
// The routes refuse everyone but the Owner regardless (lib/ownerGuard).
// PURE — unit-tested by scripts/test-admin-cleanup.ts.

export type ChangeOption = 'approve' | 'reject' | 'unlock'

export const CHANGE_OPTION_LABEL: Record<ChangeOption, string> = {
  approve: 'Approve',
  reject: 'Reject',
  unlock: 'Unlock for re-upload',
}

export function changeMenuOptions(f: {
  /** The viewer may approve (the Owner) and the screen allows reviewing. */
  canDecide: boolean
  status: 'none' | 'pending' | 'approved' | 'rejected'
  hasUpload: boolean
  /** The document is approved and locked, so it can be unlocked. */
  unlockable: boolean
  /** An unlock is already open (the member has not re-uploaded yet). */
  unlockOpen: boolean
  /** The viewer may unlock (SCREEN_ACCESS.documentUnlock). */
  canUnlock: boolean
}): ChangeOption[] {
  if (!f.canDecide) return []
  if (f.status !== 'approved' && f.status !== 'rejected') return []
  const out: ChangeOption[] = []
  if (f.hasUpload && f.status !== 'approved') out.push('approve')
  if (f.hasUpload && f.status !== 'rejected') out.push('reject')
  if (f.unlockable && !f.unlockOpen && f.canUnlock) out.push('unlock')
  return out
}
