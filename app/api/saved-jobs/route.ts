import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z, uuid } from '@/lib/validate'

// Save a tuition, or remove one. The tutor-side mirror of /api/shortlist.
//
// Saving is FREE and needs no plan — it is per-account state, so it lives in
// the database and follows the tutor across devices. Auth first, and the write
// is scoped to the caller: saved_jobs.user_id is taken from the session, never
// from the body, and RLS (user_id = auth.uid()) says the same underneath.

const SavedJobBody = z.object({
  jobId: uuid,
  action: z.enum(['add', 'remove']).default('add'),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Sign in to save tuitions.' }, { status: 401 })
  }

  const parsed = await parseBody(request, SavedJobBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const jobId = body.jobId
  const action = body.action === 'remove' ? 'remove' : 'add'

  if (action === 'remove') {
    const { error } = await supabase
      .from('saved_jobs')
      .delete()
      .eq('user_id', user.id)
      .eq('job_id', jobId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logActivity({
      userId: user.id,
      event: 'saved_job_removed',
      targetType: 'job',
      targetId: jobId,
    })
    return NextResponse.json({ success: true, saved: false })
  }

  // Idempotent: pressing the heart twice must not error.
  const { error } = await supabase
    .from('saved_jobs')
    .upsert({ user_id: user.id, job_id: jobId }, { onConflict: 'user_id,job_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logActivity({
    userId: user.id,
    event: 'saved_job_added',
    targetType: 'job',
    targetId: jobId,
  })
  return NextResponse.json({ success: true, saved: true })
}
