// Premium and Featured upgrades are paused (owner, 9 Nov 2026).
//
// In this phase the only thing that earns money is the one-time Verification
// Fee ('verified'). Every other paid plan — tutor Premium and Featured, parent
// Featured — shows "Coming soon" and cannot be bought: the cards, the upgrade
// sheet, /pay/choose and the two routes that create a payment (checkout and
// receipt) all read this one rule. Members who already hold a plan keep it until
// its end date: entitlements read subscriptions, which this never touches.
//
// Pure: no I/O, so the test runner and client components can import it.

/** Flip to false to sell upgrades again. */
export const UPGRADES_PAUSED = true

/** The plan code of the one-time Verification Fee — never paused. */
export const FEE_PLAN_CODE = 'verified'

export const COMING_SOON_LABEL = 'Coming soon'

export const UPGRADES_PAUSED_MESSAGE =
  'Premium and Featured plans are coming soon. You cannot buy them right now.'

/** True for a paid plan other than the Verification Fee. */
export function isUpgradePlan(code: string | null | undefined, pricePkr?: number | null): boolean {
  const c = (code ?? '').trim()
  if (!c || c === FEE_PLAN_CODE) return false
  if (pricePkr != null && pricePkr <= 0) return false
  return true
}

/** True when this plan cannot be bought right now. */
export function upgradeBlocked(code: string | null | undefined, pricePkr?: number | null, paused = UPGRADES_PAUSED): boolean {
  return paused && isUpgradePlan(code, pricePkr)
}

/** The server's refusal for a purchase, or null when it may go ahead. */
export function upgradeRefusal(
  code: string | null | undefined,
  pricePkr?: number | null,
  paused = UPGRADES_PAUSED,
): { error: string; code: 'upgrades_paused'; status: 409 } | null {
  return upgradeBlocked(code, pricePkr, paused) ? { error: UPGRADES_PAUSED_MESSAGE, code: 'upgrades_paused', status: 409 } : null
}
