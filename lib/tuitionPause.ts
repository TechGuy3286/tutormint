// lib/tuitionPause.ts
//
// Tuitions auto-pause 7 days after they were posted or last resumed (owner,
// 8 Oct 2026; was 15 days, PR27 §3).
//
// A paused tuition has status 'paused' — auto-excluded from browse, search,
// matching, the sitemap, landing pages and Apply (all of which filter
// status='open'). The poster and admins keep the row, its public_slug, its
// applications and its threads. The clock runs from coalesce(resumed_at,
// created_at); resuming sets a fresh clock.
//
// THE BACKLOG. Open tuitions already past 7 days when the rule changed are
// paused 150 a night, oldest first (lib/tuitionPauseCore) — never all at once —
// with pause_source 'backlog'; a recently-due tuition is an ordinary 'auto'
// pause the same night. Indexing API notifications go through the queue, which
// never sends more than 200 a day.
//
// Closed and hired tuitions are never touched: the sweep only reads status='open'.

import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications'
import { deliverEmail } from '@/lib/notify'
import { PAUSE_AFTER_DAYS } from '@/lib/tuitionStatus'
import { enqueueIndexing, drainIndexingQueue, tuitionUrl } from '@/lib/googleIndexing'
import { pageAll } from '@/lib/pageAll'
import { planPauseBatch, nextBatchAt } from '@/lib/tuitionPauseCore'

export { PAUSE_AFTER_DAYS }

type OpenRow = { id: string; parent_id: string; title: string | null; created_at: string; resumed_at: string | null; public_slug: string | null; city: string | null }

async function openTuitions(): Promise<(OpenRow & { clockBase: string })[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const rows = (await pageAll((from, to) =>
    admin.from('jobs').select('id, parent_id, title, created_at, resumed_at, public_slug, city').eq('status', 'open').order('id').range(from, to),
  )) as OpenRow[]
  return rows.map((r) => ({ ...r, clockBase: r.resumed_at ?? r.created_at }))
}

/** "Backlog: N left · next batch <date> 03:00 UTC" — for Paused tuitions. */
export async function pauseBacklogStatus(now = new Date()): Promise<{ left: number; nextBatch: string }> {
  const open = await openTuitions()
  const plan = planPauseBatch(open, now.getTime(), Number.MAX_SAFE_INTEGER)
  return { left: plan.backlog.length, nextBatch: nextBatchAt(now).toISOString() }
}

/**
 * The nightly sweep. Pauses every recently-due open tuition and the next 150 of
 * the backlog, notifies each poster in-app and by email, queues the Indexing API
 * notices (sent within 200 a day) and returns what it did. Idempotent: every
 * update is guarded on status='open'.
 */
export async function pauseStaleTuitions(now = new Date()): Promise<{
  paused: number
  backlogPaused: number
  backlogLeft: number
  ids: string[]
  indexing: { sent: number; failed: number; left: number }
}> {
  const admin = createAdminClient()
  const empty = { paused: 0, backlogPaused: 0, backlogLeft: 0, ids: [], indexing: { sent: 0, failed: 0, left: 0 } }
  if (!admin) return empty

  const plan = planPauseBatch(await openTuitions(), now.getTime())
  const iso = now.toISOString()
  const ids: string[] = []
  const urls: string[] = []
  let backlogPaused = 0

  const run = async (j: OpenRow, source: 'auto' | 'backlog') => {
    const { data, error } = await admin
      .from('jobs')
      .update({ status: 'paused', paused_at: iso, pause_source: source })
      .eq('id', j.id)
      .eq('status', 'open')
      .select('id')
    if (error || !data || data.length === 0) return
    ids.push(j.id)
    if (source === 'backlog') backlogPaused++
    const url = tuitionUrl(j)
    if (url) urls.push(url)

    const title = j.title ?? 'your tuition'
    await notify({
      userId: j.parent_id,
      kind: 'tuition_paused',
      title: 'Your tuition is paused',
      body: 'Paused after 7 days — resume to show it to tutors again.',
      href: '/parent/dashboard/jobs',
    })
    // Email is best-effort: a paused tuition must not be reported as failed
    // because a mail send did not go out.
    await deliverEmail({ userId: j.parent_id }, { id: 'tuition_paused', title }).catch(() => {})
  }

  for (const j of plan.regular) await run(j, 'auto')
  for (const j of plan.backlog) await run(j, 'backlog')

  await enqueueIndexing(urls)
  const indexing = await drainIndexingQueue().catch(() => ({ sent: 0, failed: 0, left: 0 }))

  return { paused: ids.length, backlogPaused, backlogLeft: plan.backlogLeft, ids, indexing }
}
