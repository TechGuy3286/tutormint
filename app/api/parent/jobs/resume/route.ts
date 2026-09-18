import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resumeJob } from '@/lib/jobs'
import { parseBody, z } from '@/lib/validate'

// Resume a paused tuition (PR27 §3.3). Ownership is checked in lib/jobs.ts, and
// resuming sets a fresh 15-day clock (resumed_at = now) so the daily sweep waits
// another 15 days before pausing it again.

const ResumeBody = z.object({
  jobId: z.string().min(1, 'Missing tuition.').max(64),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to resume your tuition.' }, { status: 401 })

  const parsed = await parseBody(request, ResumeBody)
  if (!parsed.ok) return parsed.response

  const result = await resumeJob(user.id, parsed.data.jobId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ success: true })
}
