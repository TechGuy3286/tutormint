// lib/selfPauseCore.ts
//
// "Pause my account" (owner, 8 Oct 2026) — the PURE half, unit-tested in
// scripts/test-self-pause.ts. lib/selfPause.ts does the writes.
//
// A member may hide their own account and come back by signing in. It is a
// SEPARATE state (profiles.paused_by_user_at) from staff suspension and ban:
//   * a staff-suspended or banned account cannot self-pause;
//   * signing in clears ONLY the self-pause, and never while the account is
//     suspended or banned — staff decisions are never undone by signing in.

export type PauseFacts = {
  role: string | null
  isSuspended: boolean
  isBanned: boolean
  pausedByUserAt: string | null
}

export const NOT_AVAILABLE = 'This member is not available right now.'
export const NOT_AVAILABLE_UR = 'یہ ممبر ابھی دستیاب نہیں ہے۔'

export const WELCOME_BACK = 'Welcome back, your profile is live again.'
export const WELCOME_BACK_UR = 'خوش آمدید، آپ کی پروفائل دوبارہ لائیو ہے۔'

/** Why this account may NOT pause itself, or null when it may. */
export function pauseRefusal(f: PauseFacts): string | null {
  if (f.role !== 'tutor' && f.role !== 'parent' && f.role !== 'academy') return 'Only tutor and parent accounts can be paused here.'
  if (f.isBanned || f.isSuspended) return 'Your account is suspended by TutorMint, so it cannot be paused. Contact support.'
  if (f.pausedByUserAt) return 'Your account is already paused.'
  return null
}

/** Should a successful sign-in clear the self-pause? Only a self-paused account
 *  that staff have NOT suspended or banned. */
export function shouldRestoreOnSignIn(f: PauseFacts): boolean {
  return !!f.pausedByUserAt && !f.isSuspended && !f.isBanned
}

/** The confirmation text. A tutor on Premium or Featured is told the plan keeps running. */
export function pauseConfirmText(opts: { paidPlan: boolean }): { en: string; ur: string } {
  const en = ['Your profile will be hidden and you will be signed out. Sign in any time to bring it back.']
  const ur = ['آپ کی پروفائل چھپا دی جائے گی اور آپ سائن آؤٹ ہو جائیں گے۔ واپس لانے کے لیے کسی بھی وقت سائن اِن کریں۔']
  if (opts.paidPlan) {
    en.push('Your plan days keep running while paused.')
    ur.push('روکنے کے دوران آپ کے پلان کے دن چلتے رہیں گے۔')
  }
  return { en: en.join(' '), ur: ur.join(' ') }
}
