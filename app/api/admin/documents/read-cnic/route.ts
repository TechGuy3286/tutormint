import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { rateLimit } from '@/lib/rateLimit'
import { cachedSuggestion, cnicDuplicateFor, readCnicForMember } from '@/lib/cnicReader'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBody, z, uuid } from '@/lib/validate'

// The CNIC number box on the review card (owner, 10 Oct 2026):
//   read   — "Read number from photo": reads the member's CNIC FRONT with the
//            Claude API (once per image, cached) and returns a SUGGESTION.
//   cached — the suggestion already on file (the backlog run, or an earlier
//            read), with no API call. Pre-fills an empty box.
//   check  — is this number (or, with none given, the member's saved number)
//            already on another account? A warning for staff, never a block.
//
// NOTHING HERE SAVES A NUMBER. The box is filled; staff press Save or Approve,
// which are the existing routes. Owner, admin and operations
// (SCREEN_ACCESS.cnicRead); a Partner is refused by checkAdminRole (a POST).
// `read` is rate-limited per staff member. The response goes to staff only.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({
  memberId: uuid,
  action: z.enum(['read', 'cached', 'check']),
  cnicNumber: z.string().max(30).optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.cnicRead)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { memberId, action, cnicNumber } = parsed.data

  if (action === 'check') {
    let number = cnicNumber ?? null
    if (!number) {
      const admin = createAdminClient()
      const { data } = admin ? await admin.from('profiles').select('cnic_number').eq('id', memberId).maybeSingle() : { data: null }
      number = (data?.cnic_number as string | null) ?? null
    }
    return NextResponse.json({ duplicate: await cnicDuplicateFor(memberId, number) })
  }

  if (action === 'cached') {
    const c = await cachedSuggestion(memberId)
    return NextResponse.json({
      hasFront: !!c.documentId,
      read: c.read,
      number: c.number,
      duplicate: c.number ? await cnicDuplicateFor(memberId, c.number) : null,
    })
  }

  const limit = await rateLimit('cnic_read', gate.actor.id)
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many reads in a minute. Wait a moment, then try again.' }, { status: 429 })
  }
  const result = await readCnicForMember(memberId)
  if (result.status === 'found') {
    return NextResponse.json({ status: 'found', number: result.number, duplicate: await cnicDuplicateFor(memberId, result.number) })
  }
  return NextResponse.json({ status: result.status })
}
