import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { reviewTutorDocument, type DocItem } from '@/lib/tutorDocuments'
import { parseBody, z, uuid, text } from '@/lib/validate'

// Approve or reject ONE of a tutor's identity items — CNIC, profile picture or
// selfie (PR60). Same roles as the rest of tutor moderation (SCREEN_ACCESS.tutors).
// A reject needs a reason; the tutor is notified. This changes NO listing rule.

export const dynamic = 'force-dynamic'

const Body = z.object({
  tutorId: uuid,
  item: z.enum(['cnic', 'profile_pic', 'selfie']),
  decision: z.enum(['approve', 'reject']),
  reason: text({ min: 0, max: 1000, label: 'Reason' }).nullish(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tutors)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { tutorId, item, decision } = parsed.data

  const result = await reviewTutorDocument({
    actor: gate.actor,
    tutorId,
    item: item as DocItem,
    decision,
    reason: (parsed.data.reason ?? '').trim(),
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
