import { NextResponse } from 'next/server'

import { createTutorAlert } from '@/lib/tutorAlerts'
import { getSessionUser } from '@/lib/auth'
import { rateLimit, callerIp } from '@/lib/rateLimit'
import { parseBody, z } from '@/lib/validate'

// "Notify me when a matching tutor joins" (owner, 13 Oct 2026). Public: a
// parent need not sign in to leave a mobile number or an email. It needs the
// explicit opt-in tick, stores the request, and promises exactly one message.
// Rate-limited per visitor so nobody can fill the table or aim messages at
// somebody else's number in bulk.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  contact: z.string().trim().min(5, 'Enter your email address.').max(200),
  consent: z.boolean(),
  q: z.string().max(200).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  area: z.string().max(160).optional().nullable(),
  subjectId: z.coerce.number().int().positive().optional().nullable(),
})

export async function POST(request: Request) {
  const limit = await rateLimit('tutor_alert', callerIp(request))
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many requests from this device. Please try again in an hour.' }, { status: 429 })
  }
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const user = await getSessionUser().catch(() => null)
  const result = await createTutorAlert({ ...parsed.data, userId: user?.user.id ?? null })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, channel: result.channel, label: result.label })
}
