import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  revealParentContact,
  revealStatus,
  revealJobContact,
  jobContactRevealStatus,
} from '@/lib/contactReveal'
import { parseBody, parseQuery, z, uuid } from '@/lib/validate'
import { rateLimit, tooManyRequests } from '@/lib/rateLimit'

// Tutor reveal of contact details (PR56 parent account, PR57 staff-posted job
// contact).
//
//   GET  ?parentId=… | ?jobId=…  -> status for the button: eligible, plan,
//                        reveals left, already-revealed. NEVER any contact.
//   POST { parentId } | { jobId } -> the counted reveal: returns the contact
//                        only after every entitlement check and an atomic count
//                        succeed.
//
// The contact lives in ONE place (lib/contactReveal.ts) and reaches the client
// only in the POST success body. Both verbs require a signed-in tutor; every
// entitlement, eligibility and count decision is server-side. Exactly one of
// parentId / jobId is accepted.

export const dynamic = 'force-dynamic'

const StatusQuery = z
  .object({ parentId: uuid.optional(), jobId: uuid.optional() })
  .refine((v) => !!v.parentId !== !!v.jobId, { message: 'Give exactly one of parentId or jobId.' })
const RevealBody = StatusQuery

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ eligible: false }, { status: 401 })

  const parsed = parseQuery(new URL(request.url), StatusQuery)
  if (!parsed.ok) return parsed.response

  const status = parsed.data.jobId
    ? await jobContactRevealStatus(user.id, parsed.data.jobId)
    : await revealStatus(user.id, parsed.data.parentId!)
  return NextResponse.json(status)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })

  const limit = await rateLimit('contact_reveal', user.id)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'reveals')

  const parsed = await parseBody(request, RevealBody)
  if (!parsed.ok) return parsed.response

  const result = parsed.data.jobId
    ? await revealJobContact(user.id, parsed.data.jobId)
    : await revealParentContact(user.id, parsed.data.parentId!)
  if (!result.ok) {
    return NextResponse.json({ error: result.error, gate: result.gate }, { status: result.status })
  }
  return NextResponse.json({
    contact: result.contact,
    remaining: result.remaining,
    alreadyRevealed: result.alreadyRevealed,
  })
}
