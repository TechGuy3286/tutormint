// lib/newestTuitions.ts
//
// "Newest tuitions" link blocks (owner, 16 Oct 2026): the latest live tuitions
// in a scope — the whole site (homepage link row), a city (city hubs) or a city
// × subject (landing pages) — linked by title, so a fresh tuition is linked from
// an indexable page the moment it is posted. Also the city hub's full list of
// open tuitions as plain links, so no live tuition is linked from nowhere.
//
// Reads indexable_tuitions() (migration 178) with the publishable key, the same
// set the sitemap lists, so a link here never points at a noindex page. Live =
// open only. Titles are the stored human headline, masked the same way the
// cards mask them (no phone or email in a link).

import 'server-only'

import { cache } from 'react'
import { createPublicClient } from '@/lib/supabase/public'
import { pageAll } from '@/lib/pageAll'
import { citySegment } from '@/lib/slugs'
import { maskTuitionText } from '@/lib/maskTuition'
import { pickNewest, type TuitionLinkRow, type TuitionLink } from '@/lib/newestTuitionsCore'

export type { TuitionLink }
export const NEWEST_TUITIONS_LIMIT = 10

/** Every live (open, indexable) tuition — once per request. */
const liveRows = cache(async (): Promise<TuitionLinkRow[]> => {
  try {
    const db = createPublicClient()
    const rows = (await pageAll((from, to) => db.rpc('indexable_tuitions').eq('status', 'open').order('id').range(from, to))) as {
      id: string
      public_slug: string
      city: string | null
      title: string | null
      created_at: string
      bumped_at: string | null
    }[]
    return rows.map((r) => ({
      id: r.id,
      href: `/tuitions/${citySegment(r.city)}/${r.public_slug}`,
      title: maskTuitionText((r.title ?? '').trim() || 'Tuition required').text,
      city: r.city,
      createdAt: r.created_at,
      bumpedAt: r.bumped_at ?? r.created_at,
    }))
  } catch {
    return []
  }
})

/** The job ids carrying a subject (taxonomy master id). */
async function jobIdsForMaster(masterId: number): Promise<Set<string>> {
  try {
    const db = createPublicClient()
    const rows = (await pageAll((from, to) => db.from('job_subjects').select('job_id').eq('master_id', masterId).order('job_id').range(from, to))) as {
      job_id: string
    }[]
    return new Set(rows.map((r) => r.job_id))
  } catch {
    return new Set()
  }
}

/** The latest `limit` live tuitions in a scope, newest posted first. */
export async function newestTuitionLinks(scope: { city?: string | null; masterId?: number | null } = {}, limit = NEWEST_TUITIONS_LIMIT): Promise<TuitionLink[]> {
  const rows = await liveRows()
  const ids = scope.masterId ? await jobIdsForMaster(scope.masterId) : null
  return pickNewest(rows, { city: scope.city ?? null, ids }, limit)
}

/** Every live tuition in a city, newest first (bumped) — the hub's full list. */
export async function allLiveTuitionLinksInCity(city: string): Promise<TuitionLink[]> {
  const rows = await liveRows()
  return pickNewest(rows, { city, ids: null }, Number.MAX_SAFE_INTEGER, 'bumped')
}
