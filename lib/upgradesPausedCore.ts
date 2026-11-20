// Which paid upgrades can be bought (owner: all paused 9 Nov 2026; PR-13,
// 21 Nov 2026: tutor Premium and parent Featured on sale again by bank transfer).
//
// PR-13 turned on only the plans whose every card line is delivered by code.
// Tutor Featured stays "Coming soon": its "Matched tuitions on your WhatsApp"
// line was a staff-sent list (Featured WhatsApp) that was retired on 31 Oct
// 2026, so that plan cannot be sold until the list is back. The cards, the
// upgrade sheet, /pay/choose and the two routes that create a payment
// (checkout and receipt) all read this one rule. Members who already hold a
// plan keep it until its end date: entitlements read subscriptions, which this
// never touches.
//
// Pure: no I/O, so the test runner and client components can import it.

/** The upgrade plan codes that are still "Coming soon". Remove a code to sell it. */
export const PAUSED_UPGRADE_CODES: readonly string[] = ['featured']

/** Every upgrade paused at once (the 9 Nov 2026 state). Off since PR-13 — the
 *  per-plan list above decides. */
export const UPGRADES_PAUSED: boolean = false

/** The plan code of the one-time Verification Fee — never paused. */
export const FEE_PLAN_CODE = 'verified'

export const COMING_SOON_LABEL = 'Coming soon'

export const UPGRADES_PAUSED_MESSAGE = 'This plan is coming soon. You cannot buy it right now.'

/** The pause the app runs with: everything, or the per-plan list. */
const CURRENT_PAUSE: boolean | readonly string[] = UPGRADES_PAUSED || PAUSED_UPGRADE_CODES

/** True for a paid plan other than the Verification Fee. */
export function isUpgradePlan(code: string | null | undefined, pricePkr?: number | null): boolean {
  const c = (code ?? '').trim()
  if (!c || c === FEE_PLAN_CODE) return false
  if (pricePkr != null && pricePkr <= 0) return false
  return true
}

/** True when this plan cannot be bought right now. `paused` is a list of
 *  paused plan codes (default: the live list) or a blanket true/false. */
export function upgradeBlocked(
  code: string | null | undefined,
  pricePkr?: number | null,
  paused: boolean | readonly string[] = CURRENT_PAUSE,
): boolean {
  if (!isUpgradePlan(code, pricePkr)) return false
  if (typeof paused === 'boolean') return paused
  return paused.includes((code ?? '').trim())
}

/** The server's refusal for a purchase, or null when it may go ahead. */
export function upgradeRefusal(
  code: string | null | undefined,
  pricePkr?: number | null,
  paused: boolean | readonly string[] = CURRENT_PAUSE,
): { error: string; code: 'upgrades_paused'; status: 409 } | null {
  return upgradeBlocked(code, pricePkr, paused) ? { error: UPGRADES_PAUSED_MESSAGE, code: 'upgrades_paused', status: 409 } : null
}

// ------------------------------------------------- promotion (owner, 10 Nov 2026) --
//
// While upgrades were "Coming soon", nothing invited a member to buy one: no
// weekly "who viewed your profile" upsell, no quota nudge, no house banner for
// a paid plan, no dashboard "Upgrade" / "See Premium" / "Renew" prompt.
// Benefits of members who already hold a plan are untouched (entitlements never
// read this). Templates are not deleted.
//
// PR-13 put Premium and parent Featured on sale but asked only for the buttons
// on Membership Plans and the payment flow behind them. Promotion stays OFF —
// no upsell notifications, nudges, banners or "Renew" reminders — until the
// Owner asks for it. It is its own switch now, no longer tied to the pause.

/** Flip to true to invite members to upgrade again. */
export const PROMOTE_UPGRADES: boolean = false

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
