// lib/tuitionPause.ts
//
// Tuitions auto-pause 15 days after they were posted or last resumed (PR27 §3).
//
// A paused tuition has status 'paused' — auto-excluded from browse, search,
// matching, the sitemap, landing pages and Apply (all of which filter
// status='open'), and hidden from the public by RLS (jobs_public_read_open),
// while the poster and admins keep read access, the row, its public_slug, its
// applications and its threads. The 15-day clock runs from
// coalesce(resumed_at, created_at); resuming sets a fresh clock.
//
// Closed and hired tuitions are never touched: the sweep only reads status='open'.

import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications'
import { deliverEmail } from '@/lib/notify'

export const PAUSE_AFTER_DAYS = 15

function cutoffIso(now = Date.now()): string {
  return new Date(now - PAUSE_AFTER_DAYS * 24 * 3600 * 1000).toISOString()
}

/**
 * The daily sweep. Pauses every open tuition — parent- or team-posted — whose
 * 15-day clock has run out, notifies the poster in-app and by email, and returns
 * what it paused. Idempotent: the update is guarded on status='open', so a second
 * run in the same day pauses nothing already paused.
 */
export async function pauseStaleTuitions(): Promise<{ paused: number; ids: string[] }> {
  const admin = createAdminClient()
  if (!admin) return { paused: 0, ids: [] }

  const cutoff = cutoffIso()
  const { data: open } = await admin
    .from('jobs')
    .select('id, parent_id, title, created_at, resumed_at')
    .eq('status', 'open')

  const now = new Date().toISOString()
  // Clock base is the last resume, else the post date.
  const due = (open ?? []).filter(
    (j) => (((j.resumed_at as string | null) ?? (j.created_at as string)) < cutoff),
  )

  const ids: string[] = []
  for (const j of due) {
    const { error } = await admin
      .from('jobs')
      .update({ status: 'paused', paused_at: now })
      .eq('id', j.id as string)
      .eq('status', 'open')
    if (error) continue
    ids.push(j.id as string)

    const title = (j.title as string) ?? 'your tuition'
    await notify({
      userId: j.parent_id as string,
      kind: 'tuition_paused',
      title: 'Your tuition is paused',
      body: 'Paused — resume to show it to tutors again.',
      href: '/parent/dashboard/jobs',
    })
    // Email is best-effort: a paused tuition must not be reported as failed
    // because a mail send did not go out.
    await deliverEmail({ userId: j.parent_id as string }, { id: 'tuition_paused', title }).catch(() => {})
  }

  return { paused: ids.length, ids }
}
