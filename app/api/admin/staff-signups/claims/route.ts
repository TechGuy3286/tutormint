import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { submitClaim } from '@/lib/staffSignups'
import { parseBody, z } from '@/lib/validate'

// Sign-ups by staff → claim a sign-up that came without a link (owner, 15 Oct
// 2026): a mobile number or email and a short note. Participants only
// (Tuitions staff, Operations, Admin); the Partner is refused by checkAdminRole,
// and the Owner carries no link, so lib/staffSignups refuses. Audited. The
// claims themselves are read on the server by the Sign-ups tab and Claims to
// review pages.

export const dynamic = 'force-dynamic'

const Body = z.object({
  identifier: z.string().trim().min(3, 'Enter the mobile number or email they signed up with.').max(320),
  note: z.string().trim().min(1, 'Add a short note: how did you help this person sign up?').max(500),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.staffSignupClaim)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const result = await submitClaim(gate.actor, parsed.data.identifier, parsed.data.note)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, claimId: result.claimId })
}
