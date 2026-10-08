import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { reviewParentDocument } from '@/lib/parentDocuments'
import { parseBody, z, uuid, text } from '@/lib/validate'

// Approve or reject ONE of a parent's verification items — the CNIC or the
// address (owner, 8 Oct 2026). Owner, admin and operations (SCREEN_ACCESS.parents);
// a Partner is refused by checkAdminRole (view-only), Tuitions staff are not in
// the list. A reject needs a reason. Used by the member page's Documents box and
// the Verification → Parents queue alike.

export const dynamic = 'force-dynamic'

const Body = z.object({
  parentId: uuid,
  item: z.enum(['cnic', 'address']),
  decision: z.enum(['approve', 'reject']),
  reason: text({ min: 0, max: 1000, label: 'Reason' }).nullish(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.parents)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { parentId, item, decision } = parsed.data

  const result = await reviewParentDocument({
    actor: gate.actor,
    parentId,
    item,
    decision,
    reason: (parsed.data.reason ?? '').trim(),
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, verified: result.verified })
}
