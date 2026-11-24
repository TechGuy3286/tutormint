import 'server-only'

// lib/staffAllRows.ts — the server half of lib/staffAllRowsCore (PR-12): read
// the 'staff.all_rows' grant list (cached a minute) and answer "does this actor
// see every row?". A failed read grants nothing beyond the role rule.

import { createAdminClient } from '@/lib/supabase/admin'
import { memoize } from '@/lib/memoCache'
import { redirect } from 'next/navigation'
import { getAdminActor, type AdminActor } from '@/lib/adminAuth'
import { adminHomeFor } from '@/lib/adminAccessCore'
import { ALL_ROWS_KEY, INSIGHTS_GRANT_KEY, parseAllRowsStaff, seesAllRowsFrom, seesInsightsFrom } from '@/lib/staffAllRowsCore'

async function loadGrantFresh(key: string): Promise<string[]> {
  try {
    const admin = createAdminClient()
    if (!admin) return []
    const { data } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle()
    return [...parseAllRowsStaff((data?.value as string | null) ?? null)]
  } catch {
    return []
  }
}

const cached = memoize(() => loadGrantFresh(ALL_ROWS_KEY), ['staff-all-rows-v1'], { revalidate: 60 })
const cachedInsights = memoize(() => loadGrantFresh(INSIGHTS_GRANT_KEY), ['staff-insights-v1'], { revalidate: 60 })

export async function loadAllRowsStaff(): Promise<Set<string>> {
  return new Set(await cached())
}

/** Owner / Partner, a role in `roles`, or an account on the grant list. */
export async function seesAllRows(actor: { id: string; adminRole: string | null | undefined }, roles: readonly string[]): Promise<boolean> {
  if (seesAllRowsFrom(actor, roles, new Set())) return true
  return seesAllRowsFrom(actor, roles, await loadAllRowsStaff())
}

/** Admin → Insights (PR-16): Owner, Partner, or an account on 'staff.insights'. */
export async function seesInsights(actor: { id: string; adminRole: string | null | undefined }): Promise<boolean> {
  if (seesInsightsFrom(actor, new Set())) return true
  return seesInsightsFrom(actor, new Set(await cachedInsights()))
}

/** Admin → Growth → Search words' actions (PR-22): the same people as Insights —
 *  Owner, Partner, or an account on 'staff.insights' (Mohsin). Others who open
 *  the screen (Backend Support) read only. */
export async function mayEditSearchWords(actor: { id: string; adminRole: string | null | undefined }): Promise<boolean> {
  return seesInsights(actor)
}

/** The Insights screens' guard (in place of requireAdminRole(...SCREEN_ACCESS
 *  .insights)): anyone else lands on their own home with "no access". */
export async function requireInsights(): Promise<AdminActor> {
  const actor = await getAdminActor()
  if (!actor) redirect('/')
  if (!(await seesInsights(actor))) redirect(`${adminHomeFor(actor.adminRole)}?denied=1`)
  return actor
}
