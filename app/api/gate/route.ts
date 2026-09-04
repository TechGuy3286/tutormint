import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'
import { buildGate, type GateReason } from '@/lib/gate'
import { parseBody, z } from '@/lib/validate'

// POST /api/gate  ->  { gate }
//
// For gated surfaces that are not an API call: the locked contact row, and the
// disabled Hire and Send Message buttons. Those have nothing to POST to, so
// without this they would each need the price rendered into the page in order
// to show a sheet -- and that price would then sit in the HTML of a PUBLIC
// tutor profile, readable before anybody clicked anything.
//
// CLAUDE.md's rule is that a price appears only after the member reaches for
// something. Fetching the gate on the click is what makes that literally true:
// the page ships with no price in it, and the request that creates one is the
// member's own tap.
//
// REQUIRES A SESSION. A signed-out visitor gets the sign-in modal instead --
// showing prices to someone who has not signed up is the exact thing the
// conversion rules forbid.
//
// Suspension is resolved here too, and first, so a suspended member pressing a
// locked row is told they are suspended rather than sold a plan.

export const dynamic = 'force-dynamic'

// EVERY REASON AN <UpgradeTrigger> CAN CARRY MUST BE LISTED HERE. The trigger
// swallows a failed gate on purpose -- a locked row already says it is locked,
// and an error banner over it is noise -- so a reason missing from this list
// does not fail loudly: the button simply does nothing, forever, and looks
// fine. That is exactly what happened to `tutor_viewer_identity`, which
// shipped on the profile-view teaser and on /tutor/dashboard/views with no
// entry here, so "See who" was a no-op from the day it was added.
//
// The check is one line: `grep -ro 'reason="[a-z_]*"' components app | sort -u`
// against this array.
const ALLOWED: GateReason[] = [
  'tutor_contact',
  'tutor_message',
  'tutor_viewer_identity',
  'parent_contact',
  'parent_hire',
  'parent_verify',
  'tutor_complete_profile',
]

const Body = z.object({
  reason: z.enum(ALLOWED as [GateReason, ...GateReason[]]),
})

export async function POST(request: Request) {
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Not an error the member should see as a failure -- the caller shows the
  // sign-in modal on a 401, which is the right next step for a guest.
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })

  const ent = await getEntitlements(user.id)

  // Suspension outranks whatever the surface asked for.
  if (ent.suspended) {
    return NextResponse.json({ gate: await buildGate('suspended', ent) })
  }

  // A member who already has the power should never have reached a locked
  // surface; if they do, say nothing rather than sell them what they own.
  const reason = parsed.data.reason
  if (
    (reason === 'parent_contact' && ent.canViewContact) ||
    (reason === 'tutor_contact' && ent.canViewContact) ||
    (reason === 'parent_hire' && ent.canHire) ||
    (reason === 'tutor_message' && ent.canInitiateMessage)
  ) {
    return NextResponse.json({ gate: null })
  }

  return NextResponse.json({ gate: await buildGate(reason, ent) })
}
