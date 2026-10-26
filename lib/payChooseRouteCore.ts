// lib/payChooseRouteCore.ts — PURE. Every automatic redirect /pay/choose can
// make, in one function, plus the guard that stops a redirect bounce
// (hotfix, 26 Oct 2026).
//
// The page (app/(site)/pay/choose/page.tsx) asks payChooseRoute() what to do and
// does exactly that; scripts/test-pay-loop.ts walks every tutor state through
// the same function, so the page and the test cannot disagree.
//
// THE GUARD. /pay/choose marks its own automatic redirect back into itself (the
// "no plan named" default) with ?hop=1. A request that arrives with hop=1 has
// just been redirected here by us; if it would now be redirected AGAIN, that is
// a bounce, so the page stops, shows a plain "Something went wrong, please
// continue here" note with the way to pay (or, when nothing is left to pay, the
// way to the dashboard), and logs the event (ids only). It never takes payment
// for something already paid.

import { afterFeeReturnPath } from '@/lib/returnTo'
import { defaultPayChoose, FEE_PLAN_CODE, payChooseHref } from '@/lib/payChooseDefault'

/** The query flag on our own automatic redirect into /pay/choose. */
export const PAY_HOP_PARAM = 'hop'

/** The note shown when the guard stops a redirect. */
export const PAY_LOOP_NOTE = 'Something went wrong, please continue here.'

export type PayChooseFacts = {
  /** The ?plan= value as given (trimmed). */
  planCode: string
  /** The same-site return path (?next=), already checked. */
  returnTo: string | null
  /** The request arrived through our own redirect (?hop=1). */
  hop: boolean
  role: string | null
  /** The plans row for planCode, or null when there is none. */
  plan: { code: string; audience: string; pricePkr: number } | null
  /** tutor_profiles.verified_fee_paid_at is set. */
  feePaid: boolean
}

export type PayChooseRoute =
  | { kind: 'render' }
  | { kind: 'redirect'; to: string; reason: string }
  /** The guard: a second automatic redirect in a row was about to happen. */
  /** payPlan = the package to show the bank-transfer page for (the fee for a
   *  tutor who has not paid it), or null when nothing is left to pay. */
  | { kind: 'stopped'; wouldGoTo: string; reason: string; payPlan: string | null }

/** Add ?hop=1 to one of our own redirects into /pay/choose. */
export function withPayHop(href: string): string {
  if (!href.startsWith('/pay/choose')) return href
  return `${href}${href.includes('?') ? '&' : '?'}${PAY_HOP_PARAM}=1`
}

function decide(f: PayChooseFacts): PayChooseRoute {
  const audience = f.role === 'tutor' ? 'tutor' : 'parent'
  const plansHref = `/membership-plans?for=${audience === 'tutor' ? 'tutors' : 'parents'}`
  const dashboard = audience === 'tutor' ? '/tutor/dashboard' : '/parent/dashboard'

  if (!f.planCode) {
    return { kind: 'redirect', to: withPayHop(defaultPayChoose({ role: f.role, feePaid: f.feePaid, returnTo: f.returnTo })), reason: 'no_plan' }
  }
  if (!f.plan || !f.plan.pricePkr || f.plan.audience !== audience) {
    return { kind: 'redirect', to: plansHref, reason: 'plan_not_for_member' }
  }
  if (audience === 'tutor') {
    const isFee = f.plan.code === FEE_PLAN_CODE
    if (isFee && f.feePaid) {
      return { kind: 'redirect', to: (f.returnTo && afterFeeReturnPath(f.returnTo, 'paid')) || dashboard, reason: 'fee_already_paid' }
    }
    if (!isFee && !f.feePaid) {
      const here = payChooseHref(f.planCode, f.returnTo)
      return { kind: 'redirect', to: `/tutor/complete-profile?step=verify&next=${encodeURIComponent(here)}`, reason: 'fee_first' }
    }
  }
  return { kind: 'render' }
}

export function payChooseRoute(f: PayChooseFacts): PayChooseRoute {
  const r = decide(f)
  if (r.kind === 'redirect' && f.hop) {
    const payPlan = f.role === 'tutor' && !f.feePaid ? FEE_PLAN_CODE : null
    return { kind: 'stopped', wouldGoTo: r.to, reason: r.reason, payPlan }
  }
  return r
}
