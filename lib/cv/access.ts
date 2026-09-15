import type { Entitlements } from '@/lib/entitlements'
import { planRank } from '@/lib/upsell'

// Who may DOWNLOAD the CV PDF. CV download is free to all three tutor tiers
// (owner, 15 Sep 2026): a tutor who has paid the one-time Rs 199 fee (and so is
// on Basic or above) may download. The on-screen preview is open even before
// that. This gates the download only for an UNVERIFIED, no-plan tutor.
//
// Pure and tiny on purpose: the /api/tutor/cv/pdf route and the dashboard card
// both decide from this one function.

export function canDownloadCv(
  ent: Pick<Entitlements, 'audience' | 'plan' | 'suspended'>,
): boolean {
  if (ent.suspended) return false
  // Tutor ladder is basic(1) < premium(2) < featured(3); rank >= 1 is any tutor
  // plan, i.e. the fee has been paid.
  return ent.audience === 'tutor' && planRank('tutor', ent.plan) >= 1
}
