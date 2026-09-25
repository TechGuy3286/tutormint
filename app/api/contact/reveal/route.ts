import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revealParentContact, revealStatus } from '@/lib/contactReveal'
import { parseBody, parseQuery, z, uuid } from '@/lib/validate'
import { rateLimit, tooManyRequests } from '@/lib/rateLimit'

// Tutor reveal of a parent's phone & email (PR56).
//
//   GET  ?parentId=…  -> status for the button: eligible, plan, reveals left,
//                        already-revealed. NEVER any contact.
//   POST { parentId }  -> the counted reveal: returns the contact only after
//                        every entitlement check and an atomic count succeed.
//
// The contact lives in ONE place (lib/contactReveal.ts) and reaches the client
// only in the POST success body. Both verbs require a signed-in tutor; the
// entitlement, parent-eligibility and count decisions are all server-side.

export const dynamic = 'force-dynamic'

const StatusQuery = z.object({ parentId: uuid })
const RevealBody = z.object({ parentId: uuid })

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ eligible: false }, { status: 401 })

  const parsed = parseQuery(new URL(request.url), StatusQuery)
  if (!parsed.ok) return parsed.response

  const status = await revealStatus(user.id, parsed.data.parentId)
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

  const result = await revealParentContact(user.id, parsed.data.parentId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error, gate: result.gate }, { status: result.status })
  }
  return NextResponse.json({
    contact: result.contact,
    remaining: result.remaining,
    alreadyRevealed: result.alreadyRevealed,
  })
}
