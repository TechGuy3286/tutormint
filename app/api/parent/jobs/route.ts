import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activityLog'

// Post a job.
//
// Writes to the canonical `jobs` table. It previously inserted into the legacy
// `parent_jobs`, which T1 locked to admin-SELECT-only, so every post failed
// with an RLS error once those policies landed. The full parent job flow
// (children, taxonomy master_ids, quotas) is T5; this keeps the existing
// endpoint honest in the meantime.
//
// A parent cannot post until admin has approved CNIC + address — enforced here
// as well as in the UI, because hiding the button is not a control.

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized parent session' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('cnic_verified_at, address_verified_at, verification_state')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile?.cnic_verified_at || !profile?.address_verified_at) {
      return NextResponse.json(
        {
          error:
            profile?.verification_state === 'submitted'
              ? 'Your verification is still being reviewed. You can post once it is approved.'
              : 'Verify your CNIC and address before posting a job.',
          verificationState: profile?.verification_state ?? 'none',
          verifyUrl: '/parent/verify',
        },
        { status: 403 },
      )
    }

    const body = await request.json()
    const { title, subject, grade, location, city, area, budget, description } = body

    if (!title || !subject) {
      return NextResponse.json({ error: 'A title and at least one subject are required.' }, { status: 400 })
    }

    const jobTxId = `JOB-TX-${Math.random().toString(36).substring(2, 9).toUpperCase()}`
    const budgetPkr = Number(String(budget ?? '').replace(/[^0-9]/g, '')) || null
    const resolvedArea = area ?? location ?? ''

    const { data: jobData, error: jobError } = await supabase
      .from('jobs')
      .insert({
        job_tx_id: jobTxId,
        parent_id: user.id,
        title,
        subjects: Array.isArray(subject) ? subject : [subject],
        class_level: grade ?? null,
        city: city ?? location ?? null,
        area: resolvedArea,
        budget_pkr: budgetPkr,
        description: description ?? null,
        status: 'open',
        // Legacy NOT NULL columns, dropped in T8.
        subject: Array.isArray(subject) ? subject.join(', ') : subject,
        grade: grade ?? '',
        budget: String(budget ?? ''),
        timings: '',
      })
      .select('id, job_tx_id')
      .single()

    if (jobError) throw jobError

    await logActivity({
      userId: user.id,
      event: 'job_posted',
      targetType: 'job',
      targetId: jobData.id,
      meta: { jobTxId, city: city ?? location ?? null },
    })

    return NextResponse.json({ success: true, jobTxId, job: jobData })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
