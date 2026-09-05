import type { Entitlements } from '@/lib/entitlements'
import { planRank } from '@/lib/upsell'

// Who may DOWNLOAD the CV PDF. The on-screen preview is open to every tutor,
// free included; this gates only the download, at Verified (199) and above.
//
// Pure and tiny on purpose: the /api/tutor/cv/pdf route and the dashboard card
// both decide from this one function, and it is what the route test asserts —
// a free tutor is refused (and gets the gate), a Verified+ tutor is allowed
// (and gets application/pdf).

export function canDownloadCv(
  ent: Pick<Entitlements, 'audience' | 'plan' | 'suspended'>,
): boolean {
  if (ent.suspended) return false
  // Tutor ladder is verified(1) < premium(2) < featured(3); rank >= 1 is any
  // tutor plan, i.e. "Verified and above".
  return ent.audience === 'tutor' && planRank('tutor', ent.plan) >= 1
}
