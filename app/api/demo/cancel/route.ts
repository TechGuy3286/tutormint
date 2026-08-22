import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized session' }, { status: 401 })
    }

    const { jobTxId, scheduledTime, reason } = await request.json()

    // Calculate time difference to enforce policy (e.g., must cancel at least 2 hours prior)
    const now = new Date()
    const demoTime = new Date(scheduledTime)
    const hoursDifference = (demoTime.getTime() - now.getTime()) / (1000 * 60 * 60)

    let penaltyApplied = false
    let penaltyMessage = ''

    if (hoursDifference < 2 && hoursDifference > 0) {
      penaltyApplied = true
      penaltyMessage = 'Late cancellation penalty applied (< 2 hours notice). Temporary lockout and credit deduction recorded.'
    } else if (hoursDifference <= 0) {
      return NextResponse.json({ error: 'Cannot cancel a demo class that has already started or passed.' }, { status: 400 })
    }

    // Update job status and penalty record in database
    const { error: updateError } = await supabase
      .from('parent_jobs')
      .update({ 
        status: 'cancelled',
        cancellation_reason: reason || 'No reason provided',
        penalty_applied: penaltyApplied
      })
      .eq('job_tx_id', jobTxId)

    if (updateError) throw updateError

    // Log penalty event if applicable
    if (penaltyApplied) {
      await supabase.from('penalties_log').insert({
        user_id: user.id,
        job_tx_id: jobTxId,
        reason: penaltyMessage
      })
    }

    return NextResponse.json({ 
      success: true, 
      penaltyApplied, 
      message: penaltyApplied ? penaltyMessage : 'Demo class successfully cancelled without penalty.' 
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}