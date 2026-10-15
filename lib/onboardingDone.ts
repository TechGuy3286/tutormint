import 'server-only'

// lib/onboardingDone.ts
//
// THE one writer of tutor_profiles.onboarded_at (owner, 15 Oct 2026).
//
// "Onboarding done" means every required step of the live onboarding is
// answered (lib/tutorFlow onboardingStepsComplete — every step but the fee). It
// used to be stamped by the CLIENT only when the tutor pressed a leave button on
// the last screen; the new flow sends a tutor who has finished the steps from
// "Complete your verification" straight to payment and back to the dashboard, so
// the stamp was never written and "Onboarding done" read 0 every day.
//
// Now the server stamps it whenever the facts say the steps are complete:
//   • /api/tutor/onboarding  (the flow reaching its fee step or last screen)
//   • /api/profile/save      (any profile save — the tagline is usually last)
//   • /api/documents/upload, /api/identity (CNIC / selfie steps)
//   • fee activation          (a tutor who pays after finishing)
// and NEVER for a tutor with a required step missing.

import { createAdminClient } from '@/lib/supabase/admin'
import { flowFactsByTutor } from '@/lib/onboardingStop'
import { onboardingStepsComplete } from '@/lib/tutorFlow'
import { logActivity } from '@/lib/activityLog'

export type OnboardingDoneResult = { done: boolean; stamped: boolean }

/**
 * Stamp onboarded_at for this tutor when every required step is answered and it
 * is not already set. Best-effort: a failure is logged and never fails the
 * caller's own save. `via` says which path finished it (activity log only).
 */
export async function markOnboardedIfComplete(userId: string, via: string): Promise<OnboardingDoneResult> {
  try {
    const admin = createAdminClient()
    if (!admin) return { done: false, stamped: false }
    const { data: tp } = await admin.from('tutor_profiles').select('onboarded_at').eq('id', userId).maybeSingle()
    if (!tp) return { done: false, stamped: false }
    if (tp.onboarded_at) return { done: true, stamped: false }
    const facts = (await flowFactsByTutor(admin, [userId])).get(userId)
    if (!facts || !onboardingStepsComplete(facts)) return { done: false, stamped: false }
    // `is null` guard: two paths finishing at once stamp once.
    const { data: updated } = await admin
      .from('tutor_profiles')
      .update({ onboarded_at: new Date().toISOString() })
      .eq('id', userId)
      .is('onboarded_at', null)
      .select('id')
    const stamped = (updated ?? []).length > 0
    if (stamped) {
      await logActivity({ userId, event: 'onboarding_done', targetType: 'tutor', targetId: userId, meta: { via } })
    }
    return { done: true, stamped }
  } catch (e) {
    console.error('[onboarding-done] check failed (caller unaffected):', e instanceof Error ? e.message : e)
    return { done: false, stamped: false }
  }
}
