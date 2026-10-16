// lib/email/record.ts — where lib/email/send.ts writes each outcome (migration 183).
// Service role; never throws (a send must not fail because its log row could not
// be written — send.ts logs that instead).

import { createAdminClient } from '@/lib/supabase/admin'
import type { Recorder, RunRow, SendRow } from './send'

export const dbRecorder: Recorder = {
  async sends(rows: SendRow[]) {
    const admin = createAdminClient()
    if (!admin) return
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from('email_sends').insert(rows.slice(i, i + 500))
      if (error) console.error('[email] email_sends insert failed:', error.message)
    }
  },
  async runStart(run) {
    const admin = createAdminClient()
    if (!admin) return
    await admin.from('email_runs').insert({ id: run.id, job: run.job })
  },
  async runFinish(run: RunRow) {
    const admin = createAdminClient()
    if (!admin) return
    await admin
      .from('email_runs')
      .update({
        finished_at: new Date().toISOString(),
        attempted: run.attempted,
        delivered: run.delivered,
        failed: run.failed,
        skipped: run.skipped,
        requests: run.requests,
      })
      .eq('id', run.id)
  },
}
