import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { beginDocDecision, finishDocDecision } from '@/lib/docDecisionGate'
import { reviewTutorDocument, type DocItem } from '@/lib/tutorDocuments'
import { parseBody, z, uuid, text } from '@/lib/validate'

// Approve or reject ONE of a tutor's identity items — CNIC, profile picture or
// selfie (PR60). Same roles as the rest of tutor moderation (SCREEN_ACCESS.tutors).
// A reject needs a reason; the tutor is notified. This changes NO listing rule.
// Who may decide: the Owner, and Backend Support within lib/docDecisionCore
// (owner, 5 Nov 2026) — every staff decision is kept for the Owner's Undo.

export const dynamic = 'force-dynamic'

const Body = z.object({
  tutorId: uuid,
  item: z.enum(['cnic', 'profile_pic', 'selfie']),
  decision: z.enum(['approve', 'reject']),
  reason: text({ min: 0, max: 1000, label: 'Reason' }).nullish(),
  /** A staff reviewer confirmed the name on the card matches the Name on CNIC. */
  nameChecked: z.boolean().optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tutors, ...SCREEN_ACCESS.documentDecide)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { tutorId, item, decision } = parsed.data

  const what = `${decision} a tutor's ${item === 'profile_pic' ? 'profile photo' : item === 'cnic' ? 'CNIC' : 'selfie'}`
  const begun = await beginDocDecision({ actor: gate.actor, memberId: tutorId, item, decision, nameChecked: !!parsed.data.nameChecked, what })
  if (!begun.ok) return begun.response

  const result = await reviewTutorDocument({
    actor: gate.actor,
    tutorId,
    item: item as DocItem,
    decision,
    reason: (parsed.data.reason ?? '').trim(),
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  await finishDocDecision({ actor: gate.actor, memberId: tutorId, item, decision, reason: (parsed.data.reason ?? '').trim() || null, start: begun.start })
  return NextResponse.json({ success: true })
}
