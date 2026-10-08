import 'server-only'

// Marketplace → Paused tuitions (owner, 8 Oct 2026).
//
// The auto-paused tuitions (pause_source 'auto' or 'backlog' — the 7-day rule),
// newest first, with city, area, grade, poster, paused date and application
// count; filters by city, "paused this week / older" and "with / without
// applications". Resume — one row or many — gives a fresh 7 days, moves the
// tuition back to the top of Browse (and so Google Jobs), keeps its URL, tells
// the Indexing API, notifies the poster and writes a `job.resume` audit row,
// which is what Staff activity counts.

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { citySegment } from '@/lib/slugs'
import { queueIndexingUpdate } from '@/lib/googleIndexing'
import { revalidateLanding } from '@/lib/landingRevalidate'
import { logAdminAction } from '@/lib/auditLog'
import { notify } from '@/lib/notifications'
import type { AdminActor } from '@/lib/adminAuth'

export type PausedFilters = { city?: string; age?: 'week' | 'older' | ''; apps?: 'with' | 'without' | '' }

export type PausedRow = {
  id: string
  refId: string | null
  title: string
  city: string | null
  area: string | null
  grade: string | null
  poster: string
  pausedAt: string
  source: string
  applications: number
  href: string | null
}

const WEEK_MS = 7 * 86_400_000

export async function loadPausedTuitions(filters: PausedFilters = {}, now = Date.now()): Promise<{ rows: PausedRow[]; cities: string[] }> {
  const admin = createAdminClient()
  if (!admin) return { rows: [], cities: [] }
  const jobs = await pageAll((from, to) =>
    admin
      .from('jobs')
      .select('id, ref_id, title, city, area, class_level, parent_id, paused_at, pause_source, public_slug')
      .eq('status', 'paused')
      .in('pause_source', ['auto', 'backlog'])
      .order('paused_at', { ascending: false })
      .order('id')
      .range(from, to),
  )
  const ids = jobs.map((j) => j.id as string)
  const parentIds = [...new Set(jobs.map((j) => j.parent_id as string).filter(Boolean))]
  const [apps, parents] = await Promise.all([
    pageAllIn(ids, (part, from, to) =>
      admin.from('applications').select('id, job_id').in('job_id', part).is('withdrawn_at', null).order('id').range(from, to),
    ),
    pageAllIn(parentIds, (part, from, to) =>
      admin.from('profiles').select('id, full_name, is_team_account').in('id', part).order('id').range(from, to),
    ),
  ])
  const appCount = new Map<string, number>()
  for (const a of apps) appCount.set(a.job_id as string, (appCount.get(a.job_id as string) ?? 0) + 1)
  const posterBy = new Map(parents.map((p) => [p.id as string, p.is_team_account ? 'TutorMint team' : formatName(p.full_name as string | null) || '—']))

  const all: PausedRow[] = jobs.map((j) => ({
    id: j.id as string,
    refId: (j.ref_id as string | null) ?? null,
    title: (j.title as string | null) ?? 'Tuition',
    city: (j.city as string | null) ?? null,
    area: (j.area as string | null) ?? null,
    grade: (j.class_level as string | null) ?? null,
    poster: posterBy.get(j.parent_id as string) ?? '—',
    pausedAt: j.paused_at as string,
    source: j.pause_source as string,
    applications: appCount.get(j.id as string) ?? 0,
    href: j.public_slug ? `/tuitions/${citySegment(j.city as string | null)}/${j.public_slug as string}` : null,
  }))
  const cities = [...new Set(all.map((r) => r.city).filter((c): c is string => !!c))].sort()
  const city = (filters.city ?? '').trim().toLowerCase()
  const rows = all.filter((r) => {
    if (city && (r.city ?? '').toLowerCase() !== city) return false
    const age = now - new Date(r.pausedAt).getTime()
    if (filters.age === 'week' && age > WEEK_MS) return false
    if (filters.age === 'older' && age <= WEEK_MS) return false
    if (filters.apps === 'with' && r.applications === 0) return false
    if (filters.apps === 'without' && r.applications > 0) return false
    return true
  })
  return { rows, cities }
}

/** Resume paused tuitions as staff. Returns how many came back. */
export async function resumeTuitionsAsStaff(actor: AdminActor, ids: string[]): Promise<{ resumed: string[]; skipped: string[] }> {
  const admin = createAdminClient()
  if (!admin) return { resumed: [], skipped: ids }
  const resumed: string[] = []
  const skipped: string[] = []
  const bulk = ids.length > 1
  for (const id of ids) {
    const now = new Date().toISOString()
    const { data } = await admin
      .from('jobs')
      .update({ status: 'open', resumed_at: now, bumped_at: now, paused_at: null, self_paused_at: null, pause_source: null })
      .eq('id', id)
      .eq('status', 'paused')
      .select('id, ref_id, job_tx_id, title, public_slug, city, parent_id')
    const job = data?.[0]
    if (!job) {
      skipped.push(id)
      continue
    }
    resumed.push(id)
    queueIndexingUpdate({ public_slug: (job.public_slug as string | null) ?? null, city: (job.city as string | null) ?? null })
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email,
      action: 'job.resume',
      targetType: 'job',
      targetId: id,
      detail: { jobTxId: job.job_tx_id ?? null, refId: job.ref_id ?? null, title: job.title, from: 'paused-tuitions', bulk },
    })
    if (job.parent_id) {
      await notify({
        userId: job.parent_id as string,
        kind: 'tuition_resumed',
        title: 'Your tuition is live again',
        body: `Your tuition “${job.title as string}” is live again for 7 days. Tutors can apply.`,
        href: `/parent/dashboard/job/${(job.job_tx_id as string | null) ?? id}`,
      })
    }
  }
  if (resumed.length > 0) revalidateLanding()
  return { resumed, skipped }
}
