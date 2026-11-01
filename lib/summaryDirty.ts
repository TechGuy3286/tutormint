import 'server-only'

// lib/summaryDirty.ts — "something changed" for the admin summary (owner,
// 1 Nov 2026; lib/adminSummaryCore). An admin action or a member action stamps
// admin_summary 'dirty'; the 1-minute job rebuilds when 'dirty' is newer than
// the last build. One small upsert, at most once every 15 seconds per server
// instance, and never an error for the caller.

import { createAdminClient } from '@/lib/supabase/admin'
import { DIRTY_IGNORED_EVENTS } from '@/lib/adminSummaryCore'

let lastMarked = 0

export async function markSummaryDirty(event?: string): Promise<void> {
  if (event && DIRTY_IGNORED_EVENTS.has(event)) return
  const now = Date.now()
  if (now - lastMarked < 15_000) return
  lastMarked = now
  try {
    const admin = createAdminClient()
    if (!admin) return
    await admin.from('admin_summary').upsert({ key: 'dirty', payload: {}, computed_at: new Date(now).toISOString() })
  } catch {
    // A missed mark only delays the summary to its 10-minute rebuild.
  }
}
