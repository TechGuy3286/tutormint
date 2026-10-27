import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { requireFreshAuth } from '@/lib/reauth'
import { createAdminClient } from '@/lib/supabase/admin'
import { linkableCredits, linkCreditToMember, linkPlansFor, searchLinkMembers } from '@/lib/bankPaymentLink'
import { linkCreditToExisting } from '@/lib/feeMatch'
import { parseBody, z } from '@/lib/validate'

// Link a bank credit to a member (owner, 20 Oct 2026) — lib/bankPaymentLink.ts.
//
//   GET  ?q=<name, email or mobile>  members to pick (never a contact field)
//   GET  ?memberId=<id>              what their payment could be for + the bank
//                                    credits not yet matched
//   GET  ?credits=1                  the bank credits not yet matched
//   POST { transferId, memberId, planCode, amountPkr }
//   POST { action: 'link_existing', transferId, paymentId }  (owner, 27 Oct 2026)
//        'already paid' → link this credit to the member's earlier fee payment
//        that has no bank credit yet.
//
// Reading is the Finance screen's (Owner; the Partner views). RECORDING a
// payment is OWNER ONLY: everyone else gets 403 and the Owner is told of the
// attempt. It grants money's worth of value, so it asks for a fresh password,
// like approving a receipt.

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const url = new URL(request.url)
  const q = url.searchParams.get('q')
  if (q !== null) return NextResponse.json({ members: await searchLinkMembers(q) })

  const memberId = url.searchParams.get('memberId')
  const credits = await linkableCredits()
  if (!credits) return NextResponse.json({ error: 'This is not working right now. Please try again in a few minutes.' }, { status: 503 })
  if (!memberId) return NextResponse.json({ credits })

  const admin = createAdminClient()
  const { data: profile } = admin ? await admin.from('profiles').select('role').eq('id', memberId).maybeSingle() : { data: null }
  if (!profile) return NextResponse.json({ error: 'That member was not found.' }, { status: 404 })
  return NextResponse.json({ credits, plans: await linkPlansFor(profile.role as string) })
}

const LinkExisting = z.object({ action: z.literal('link_existing'), transferId: z.guid(), paymentId: z.guid() })

const Body = z.object({
  action: z.literal('record').optional(),
  transferId: z.guid(),
  memberId: z.guid(),
  planCode: z.string().min(1).max(60),
  amountPkr: z.number().positive('Enter the amount.').max(1_000_000),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const notOwner = await refuseUnlessOwnerApproval(gate.actor, 'record a bank payment from a bank credit', null)
  if (notOwner) return notOwner

  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  const parsed = await parseBody(request, z.union([LinkExisting, Body]))
  if (!parsed.ok) return parsed.response
  const actor = { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email }

  if (parsed.data.action === 'link_existing') {
    const r = await linkCreditToExisting({ transferId: parsed.data.transferId, paymentId: parsed.data.paymentId }, actor)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ ok: true, linked: true, rounding: r.rounding })
  }

  const { transferId, memberId, planCode, amountPkr } = parsed.data
  const result = await linkCreditToMember({ transferId, memberId, planCode, amountPkr }, actor)
  if (!result.ok) return NextResponse.json({ error: result.error, existing: result.existing ?? null }, { status: result.status })
  return NextResponse.json(result)
}
