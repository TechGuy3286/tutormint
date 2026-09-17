// lib/notificationActions.ts
//
// The button on a notification card.
//
// ONE MAPPING, THREE SURFACES. The header bell, /account/notifications and the
// dashboard ACTIVITY band all render the same rows, and before this each of
// them rendered the row as text with the whole card as a link. So the most
// consequential notifications — your badge expired, a job in your subject was
// posted, somebody looked at you — arrived as a sentence with no next step,
// and the reader had to work out for themselves where to go.
//
// THE NOTIFICATION CARRIES THE FACT; THE PRICE STAYS ON THE PAGE IT OPENS.
// That is the conversion rule from CLAUDE.md and it is why `upgrade` is a
// separate kind here rather than an href to a packages page: an upgrade button
// carries a REASON, and the sheet fetches the plan and the amount when it is
// pressed. A notification list must never ship a price in its HTML.
//
// PLAIN DATA, NO SERVER IMPORTS. The bell is a client component, so this file
// must stay bundleable — `GateReason` is a type-only import, which is erased.
//
// Nothing invents an offer. There are no discounts on this platform and no
// promotions, so no card offers one; every button leads to a page that already
// existed, or to the sheet.

import type { GateReason } from '@/lib/gate'

export type NotificationCta =
  | { kind: 'link'; label: string; href: string }
  | { kind: 'upgrade'; label: string; reason: GateReason }

/**
 * The action for one notification, or null when the row is complete on its own.
 *
 * Most kinds get nothing, deliberately: a card with a button on it is a card
 * that asks for something, and a queue where everything asks for something is
 * a queue people stop reading. Four kinds carry one, and each is a case where
 * the useful next step is not the place the row's own href points at.
 */
export function ctaFor(row: { kind: string; href: string | null }): NotificationCta | null {
  switch (row.kind) {
    // Identity is the thing being offered, so the button opens the sheet
    // rather than a priced page. See lib/gate: the reason resolves to whichever
    // plan actually carries can_see_viewer_identity, which is Verified.
    case 'profile_viewed':
      return { kind: 'upgrade', label: 'See who', reason: 'tutor_viewer_identity' }

    // The tuition's own page. The row's href already points at it — the button
    // exists because "New O Level Physics job in Johar Town" with no control
    // reads as an announcement rather than something to act on.
    case 'job_matched':
      return row.href ? { kind: 'link', label: 'See the tuition', href: row.href } : null

    // A direct link, not the sheet: this member HAS held a plan and is being
    // asked to renew a thing they already chose once. `?plan=` preselects the
    // card they had, so the page opens on the decision rather than on three
    // equal columns.
    case 'plan_expired':
    case 'plan_expiring':
    // Every way a plan can end takes the same button. A member whose plan was
    // revoked by an admin is in exactly the position a member whose plan
    // lapsed is in -- the powers are gone and buying them back is the action.
    case 'plan_revoked':
    case 'plan_cancelled':
    case 'plan_ended':
      return {
        kind: 'link',
        label: 'Reactivate',
        href: reactivateHref(row.href),
      }

    // The position widget is on the dashboard and has an id.
    case 'rank_dropped':
      return { kind: 'link', label: 'See your position', href: '/tutor/dashboard#position' }

    default:
      return null
  }
}

/**
 * Where "Reactivate" goes: the packages page, on the member's own tab and the
 * card to open on.
 *
 * The row's stored href tells us the audience. It handles BOTH the current
 * /packages?for=… URL and the old /tutor|parent/packages URLs still sitting on
 * notifications written before the pages were unified (owner PR13 §1) — those
 * old URLs also 308 to /packages, but resolving the audience here means the
 * ?plan hint survives. An absent href gets no guess.
 */
function reactivateHref(href: string | null): string {
  if (!href) return '/membership-plans'
  if (href.includes('/tutor/packages') || href.includes('for=tutors')) {
    return '/membership-plans?for=tutors&plan=premium'
  }
  if (href.includes('/parent/packages') || href.includes('for=parents')) {
    return '/membership-plans?for=parents&plan=parent_featured'
  }
  return href
}
