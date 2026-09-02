import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { applyToJob, withdrawApplication } from '@/lib/applications'
import { parseBody, z, uuid } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'

// Apply for a tuition (POST) and withdraw (PATCH).
//
// All five gates -- listed tutor, not blocked, job open, not already applied,
// quota -- live in lib/applications.ts and run here regardless of what the
// page showed. Hiding the Apply button is presentation; this is the control.

const ApplyBody = z.object({
  jobId: z.string().min(1, 'Missing job.').max(64),
  message: z.string().max(2000, 'Keep your message under 2000 characters.').optional(),
})

const WithdrawBody = z.object({
  applicationId: uuid,
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to apply.' }, { status: 401 })

  // The plan quota is what governs how much a tutor may apply; this is a much
  // looser ceiling that only a script would meet, keyed to the account rather
  // than the address so a shared connection is not a shared budget.
  const limit = await rateLimit('apply', user.id)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'applications')

  const parsed = await parseBody(request, ApplyBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const result = await applyToJob({
    tutorId: user.id,
    jobId: body.jobId,
    message: body.message ?? null,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error, upgrade: result.upgrade, gate: result.gate }, { status: result.status })
  }

  return NextResponse.json({ success: true, applicationId: result.applicationId })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  const parsed = await parseBody(request, WithdrawBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const result = await withdrawApplication(user.id, body.applicationId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  // Said plainly, because it is the part people are surprised by.
  return NextResponse.json({ success: true, quotaRefunded: false })
}
