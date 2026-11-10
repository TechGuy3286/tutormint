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

// ------------------------------------------------- promotion (owner, 10 Nov 2026) --
//
// While upgrades are "Coming soon", nothing invites a member to buy one: no
// weekly "who viewed your profile" upsell, no quota nudge, no house banner for
// a paid plan, no dashboard "Upgrade" / "See Premium" / "Renew" prompt. ONE
// switch; it follows UPGRADES_PAUSED by default, so selling again turns the
// invitations back on too. Benefits of members who already hold a plan are
// untouched (entitlements never read this). Templates are not deleted.

/** Flip to true to invite members to upgrade again. */
export const PROMOTE_UPGRADES = !UPGRADES_PAUSED

/** The plan codes an invitation may pitch (the Verification Fee and the free
 *  parent tier are not upgrades). */
export const UPGRADE_PLAN_CODES = ['premium', 'featured', 'parent_featured'] as const

export function pitchesUpgrade(code: string | null | undefined): boolean {
  return (UPGRADE_PLAN_CODES as readonly string[]).includes((code ?? '').trim())
}

/** Notifications that exist only to sell an upgrade — never sent while promotion is off. */
export const UPGRADE_INVITE_KINDS = ['viewer_weekly_teaser', 'quota_nudge'] as const

/** True when a notification of this kind may go out. */
export function inviteAllowed(kind: string, promote = PROMOTE_UPGRADES): boolean {
  return promote || !(UPGRADE_INVITE_KINDS as readonly string[]).includes(kind)
}

/** True when a page may show an "Upgrade" prompt. */
export function showUpgradePrompts(promote = PROMOTE_UPGRADES): boolean {
  return promote
}
