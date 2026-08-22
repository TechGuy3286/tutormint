import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    const { jobTxId, awardedTutorId } = await req.json()

    if (!jobTxId || !awardedTutorId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    const supabase = await createClient()

    // 1. Verify the user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Update the parent job status to 'closed' or 'awarded' and set the assigned tutor
    const { error: updateError } = await supabase
      .from('parent_jobs')
      .update({
        status: 'awarded',
        awarded_tutor_id: awardedTutorId,
        updated_at: new Date().toISOString()
      })
      .eq('job_tx_id', jobTxId)

    if (updateError) throw updateError

    return NextResponse.json({ success: true, message: 'Job successfully awarded and slot locked.' })
  } catch (err: any) {
    console.error('Error closing job:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}