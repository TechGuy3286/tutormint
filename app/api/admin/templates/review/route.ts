import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { parseBody, z, uuid } from '@/lib/validate'
import { approveAllPending, decideTemplate, loadReviewBoard, restoreTemplate } from '@/lib/templateReview'

// Team inbox → Templates → Review new wording (owner, 28 Oct 2026).
//
//   GET                                          the review board (Owner; the Partner views)
//   POST { action: 'approve', key, body?, subject? }   approve — with body: edit then approve
//   POST { action: 'keep', key }                       keep the live wording
//   POST { action: 'approve_all' }                     approve every undecided template as proposed
//   POST { action: 'restore', historyId }              put an earlier wording back live
//
// Only the Owner decides: checkAdminRole refuses a Partner's write (view only),
// and every other role is refused by the screen's empty access list.

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), key: z.string().min(1).max(80), body: z.string().min(1).max(4000).nullish(), subject: z.string().max(200).nullish() }),
  z.object({ action: z.literal('keep'), key: z.string().min(1).max(80) }),
  z.object({ action: z.literal('approve_all') }),
  z.object({ action: z.literal('restore'), historyId: uuid }),
])

export async function GET() {
  const gate = await checkAdminRole(...SCREEN_ACCESS.templateReview)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  return NextResponse.json(await loadReviewBoard())
}

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.templateReview)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (gate.actor.adminRole !== 'owner') {
    return NextResponse.json({ error: 'Only the Owner can approve new wording.' }, { status: 403 })
  }
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data

  if (b.action === 'approve_all') {
    const res = await approveAllPending(gate.actor)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    return NextResponse.json({ success: true, approved: res.approved.length, skipped: res.skipped })
  }
  const res =
    b.action === 'restore'
      ? await restoreTemplate(gate.actor, b.historyId)
      : await decideTemplate(gate.actor, b.key, b.action, b.action === 'approve' && b.body ? { body: b.body, subject: b.subject ?? null } : null)
  if (!res.ok) return NextResponse.json({ error: res.error, problems: res.problems ?? [] }, { status: res.status })
  return NextResponse.json({ success: true })
}
