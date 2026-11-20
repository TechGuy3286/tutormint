import 'server-only'

// lib/insightVisit.ts — one signed-out page view for Admin → Insights (PR-12).
//
// The visitor is a keyed hash of (Pakistan day, IP, device category), cut to
// 16 hex characters. The key is a server secret and the day is part of the
// input, so the value changes every day and cannot be turned back into an IP or
// used to follow a visitor across days. Only the hash and the device CATEGORY
// are stored (bump_insight_visit, migration 240). Best-effort: never an error.

import { createHmac } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { deviceOf, pkDayOf } from '@/lib/insightsCore'

export async function recordInsightVisit(ip: string, ua: string | null): Promise<void> {
  try {
    const key = process.env.CRON_SECRET
    if (!key) return // no secret, no visitor count — never an unkeyed hash
    const admin = createAdminClient()
    if (!admin) return
    const d = deviceOf(ua)
    const visitor = createHmac('sha256', key).update(`insights|${pkDayOf(Date.now())}|${ip}|${d.device}|${d.os}`).digest('hex').slice(0, 16)
    await admin.rpc('bump_insight_visit', { p_visitor: visitor, p_device: d.device, p_os: d.os })
  } catch {
    /* a count is never worth an error */
  }
}
