import { redirect } from 'next/navigation'

import { getViewerEntitlements } from '@/lib/entitlements'

// The one-time Rs 199 verification flow now lives INSIDE the completion flow, at
// /tutor/complete-profile?step=verify (PR22 §2). This standalone route is kept so
// old links, emails and bookmarks that point at /tutor/verify still work — it
// redirects to the canonical verify step.
//
// THE BUG THIS FIXES (owner, PR22 §2). The old page rendered the CNIC+Verify gate
// but guarded it with `if (ent.plan) redirect('/tutor/dashboard')`. Under the fee
// model (migration 86) `computeEntitlements` synthesises the free `basic` plan the
// moment the one-time fee is paid, so `ent.plan` is non-null for every fee-paid
// tutor — and the guard, written when `ent.plan` meant "holds a paid plan", now
// bounced a tutor to the dashboard the instant the fee was paid. Every "Get
// verified" link now points straight at the in-flow `?step=verify` (which has no
// such guard); this route only forwards there. A tutor who is ALREADY verified
// (the fee is paid — `ent.verified`) has nothing to do, so they go to the
// dashboard; everyone else goes to the verify step.

export const dynamic = 'force-dynamic'

const STEP = '/tutor/complete-profile?step=verify'

export default async function TutorVerifyPage() {
  const ent = await getViewerEntitlements()
  if (!ent) redirect(`/login?next=${encodeURIComponent(STEP)}`)
  if (ent.audience !== 'tutor') redirect('/')
  // Verified means the one-time fee is paid — nothing to verify.
  if (ent.verified) redirect('/tutor/dashboard')
  redirect(STEP)
}
