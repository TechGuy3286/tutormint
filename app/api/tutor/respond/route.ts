import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { jobTxId, action } = await request.json() // action: 'ACCEPT' or 'REJECT'

    if (!jobTxId || !['ACCEPT', 'REJECT'].includes(action)) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
    }

    // Update job status or log the response
    const newStatus = action === 'ACCEPT' ? 'Accepted by Tutor' : 'Rejected by Tutor'

    const { error: updateError } = await supabase
      .from('parent_jobs')
      .update({ status: newStatus })
      .eq('job_tx_id', jobTxId)

    if (updateError) throw updateError

    // Insert an automated system message into the chat room
    await supabase.from('job_messages').insert({
      job_tx_id: jobTxId,
      sender_id: user.id,
      message: `🔔 System Notice: Tutor has explicitly ${action === 'ACCEPT' ? 'ACCEPTED ✅' : 'REJECTED ❌'} the demo class request.`
    })

    return NextResponse.json({ success: true, status: newStatus })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}