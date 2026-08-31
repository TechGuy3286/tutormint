import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized parent session' }, { status: 401 })
    }

    // A parent cannot post until admin has approved CNIC + address. Enforced
    // here as well as in the UI: hiding the button is not a control.
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
    const { title, subject, grade, location, budget, description } = body

    // Generate a unique internal job tracking/transaction ID
    const jobTxId = `JOB-TX-${Math.random().toString(36).substring(2, 9).toUpperCase()}`

    // Insert job into database
    const { data: jobData, error: jobError } = await supabase
      .from('parent_jobs')
      .insert({
        job_tx_id: jobTxId,
        parent_user_id: user.id,
        title,
        subject,
        grade,
        location,
        budget,
        description,
        status: 'active'
      })
      .select()
      .single()

    if (jobError) throw jobError

    return NextResponse.json({ success: true, jobTxId, job: jobData })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}