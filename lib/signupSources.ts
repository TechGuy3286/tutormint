import 'server-only'

// lib/signupSources.ts — where sign-ups came from, for Admin → Overview (owner,
// 17 Oct 2026). Real tutor and parent accounts (not seed, test-named, hidden,
// staff or the team account), dated by when the account was created, grouped
// by first-touch source (lib/signupSourceCore). Today, Yesterday, Last 7 days
// and This month, Pakistan time — the Overview cards' own windows.

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { trendWindows } from '@/lib/overviewTrendCore'
import { aiAssistantSite, aiAssistantTotals, countSources, type AiTotals, type SourceRow, type SourceWindowKey } from '@/lib/signupSourceCore'

export async function loadSignupSources(nowMs = Date.now()): Promise<SourceRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const w = trendWindows(nowMs)
  const windows: Record<SourceWindowKey, { fromMs: number; toMs: number }> = {
    today: { fromMs: w.today.start, toMs: w.today.end },
    yesterday: { fromMs: w.yesterday.start, toMs: w.yesterday.end },
    last7: { fromMs: w.last7.start, toMs: w.last7.end },
    month: { fromMs: w.month.start, toMs: w.month.end },
  }
  const since = new Date(Math.min(w.month.start, w.last7.start)).toISOString()
  const rows = await pageAll((from, to) =>
    admin
      .from('profiles')
      .select('id, created_at, utm_source, role, is_seed, is_test_name, hidden_from_public, is_team_account, admin_role')
      .in('role', ['tutor', 'parent', 'academy'])
      .gte('created_at', since)
      .order('id')
      .range(from, to),
  )
  const real = rows.filter(
    (p) => !p.is_seed && !p.is_test_name && !p.hidden_from_public && !p.is_team_account && !p.admin_role,
  )
  return countSources(
    real.map((p) => ({ createdAtMs: Date.parse(p.created_at as string), utmSource: (p.utm_source as string | null) ?? null })),
    windows,
  )
}

/** The AI assistants summary (owner, 26 Oct 2026): every real account whose
 *  first touch was an AI-assistant site, all time, and which tutors paid. */
export async function loadAiAssistantTotals(nowMs = Date.now()): Promise<AiTotals | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const rows = await pageAll((from, to) =>
    admin
      .from('profiles')
      .select('id, created_at, utm_source, role, is_seed, is_test_name, hidden_from_public, is_team_account, admin_role')
      .in('role', ['tutor', 'parent', 'academy'])
      .not('utm_source', 'is', null)
      .order('id')
      .range(from, to),
  )
  const real = rows.filter(
    (p) => !p.is_seed && !p.is_test_name && !p.hidden_from_public && !p.is_team_account && !p.admin_role && aiAssistantSite(p.utm_source as string | null),
  )
  const tutorIds = real.filter((p) => p.role === 'tutor').map((p) => p.id as string)
  const paid = new Set<string>()
  for (let i = 0; i < tutorIds.length; i += 100) {
    const { data } = await admin
      .from('payments')
      .select('user_id')
      .eq('plan_code', 'verified')
      .eq('status', 'approved')
      .is('refunded_at', null)
      .in('user_id', tutorIds.slice(i, i + 100))
    for (const r of data ?? []) paid.add(r.user_id as string)
  }
  return aiAssistantTotals(
    real.map((p) => ({
      createdAtMs: Date.parse(p.created_at as string),
      utmSource: (p.utm_source as string | null) ?? null,
      role: (p.role as string | null) ?? null,
      paid: paid.has(p.id as string),
    })),
    nowMs,
  )
}
