// lib/payChooseDefault.ts — PURE. Where /pay/choose goes when no ?plan= is
// given (owner, 17 Oct 2026).
//
//   • signed out → /login?next=/pay/choose (the page does this before asking us);
//   • a signed-in tutor who has not paid the Verification Fee → the fee
//     checkout itself, /pay/choose?plan=verified;
//   • a verified tutor, a parent or anyone else → Membership Plans, as before.

/** The fee's plan code (plans.code). */
export const FEE_PLAN_CODE = 'verified'

/** /pay/choose for a plan, keeping a same-site return path. No plan → the bare address. */
export function payChooseHref(planCode: string, returnTo: string | null = null): string {
  const q: string[] = []
  if (planCode) q.push(`plan=${encodeURIComponent(planCode)}`)
  if (returnTo) q.push(`next=${encodeURIComponent(returnTo)}`)
  return `/pay/choose${q.length ? `?${q.join('&')}` : ''}`
}

export function defaultPayChoose(v: { role: string | null; feePaid: boolean; returnTo?: string | null }): string {
  if (v.role === 'tutor' && !v.feePaid) return payChooseHref(FEE_PLAN_CODE, v.returnTo ?? null)
  return v.role === 'parent' ? '/membership-plans?for=parents' : '/membership-plans?for=tutors'
}
