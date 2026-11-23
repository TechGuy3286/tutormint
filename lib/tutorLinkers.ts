import 'server-only'

// lib/tutorLinkers.ts — the I/O of lib/tutorLinkersCore (PR-16, owner 22 Nov 2026).
//
// A tutor who is suspended, banned, hidden, erased or has a document rejected
// drops out of listed_tutor_slugs(). The pages that LINKED to them (other
// profiles' Similar tutors, open tuitions' matching tutors, their city's tutor
// pages) are rebuilt at once — not on the 24-hour safety net — and only those.
//
// How: the indexable set is kept as a snapshot in admin_summary
// ('crawl-listed', ids and public facts only — slug, city, gender, subject ids).
// syncListedTutors() compares today's slugs with it; for every slug that left,
// it marks exactly the pages that showed that tutor (decided against the
// snapshot, i.e. the set as it WAS), clears the in-memory crawl set so the
// rebuilt pages no longer see them, and stores the new snapshot. It runs from
// the 1-minute admin cron (every removal path is covered, whoever made it) and
// directly from the moderation route (at once). Per minute it costs one read
// of the slug list; the rest only runs when the set changed.

import { createAdminClient } from '@/lib/supabase/admin'
import { createPublicClient } from '@/lib/supabase/public'
import { pageAll, pageAllIn, READ_CONCURRENCY } from '@/lib/pageAll'
import { invalidateMemoTag } from '@/lib/memoCache'
import { LANDING_TAG, subjectMetaByMaster } from '@/lib/landing'
import { loadCrawlSetUncached } from '@/lib/tutorCrawl'
import { crawlGender, type CrawlTutor } from '@/lib/tutorCrawlCore'
import { citySegment } from '@/lib/slugs'
import { applyMarks } from '@/lib/publicRevalidate'
import { droppedSlugs, linkerMarks, redoDue, withPending, type LinkerTuition, type PendingMarks } from '@/lib/tutorLinkersCore'

export const LISTED_SNAPSHOT_KEY = 'crawl-listed'

/** `slugs` = every listed slug (the diff); `tutors` = the linkable ones (a city). */
type Snapshot = { slugs?: string[]; tutors: CrawlTutor[]; pending?: PendingMarks | null }

/** The snapshot keeps only what the link rules need — no name or photo. */
function slim(t: CrawlTutor): CrawlTutor {
  return { id: t.id, slug: t.slug, name: '', city: t.city, citySlug: t.citySlug, gender: t.gender, masters: t.masters, subjects: t.subjects, levels: t.levels }
}

async function listedSlugs(): Promise<string[]> {
  const db = createPublicClient()
  const rows = (await pageAll((from, to) => db.rpc('listed_tutor_slugs').order('slug').range(from, to))) as { slug: string }[]
  return [...new Set(rows.map((r) => r.slug).filter(Boolean))]
}

async function openTuitionsIn(cities: Set<string>): Promise<LinkerTuition[]> {
  const db = createPublicClient()
  const jobs = (await pageAll((from, to) =>
    db.from('jobs').select('id, city, public_slug, gender_preference').eq('status', 'open').order('id').range(from, to),
  )) as { id: string; city: string | null; public_slug: string | null; gender_preference: string | null }[]
  const inCity = jobs.filter((j) => j.city && cities.has(citySegment(j.city)))
  if (inCity.length === 0) return []
  const [links, meta] = await Promise.all([
    pageAllIn<{ job_id: string; master_id: number }, string>(
      inCity.map((j) => j.id),
      (part, from, to) => db.from('job_subjects').select('job_id, master_id').in('job_id', part).order('job_id').order('master_id').range(from, to),
      100,
      READ_CONCURRENCY,
    ),
    subjectMetaByMaster(),
  ])
  const masters = new Map<string, number[]>()
  for (const l of links) masters.set(l.job_id, [...(masters.get(l.job_id) ?? []), Number(l.master_id)])
  return inCity.map((j) => {
    const ms = masters.get(j.id) ?? []
    const subjects = new Set<string>()
    const levels = new Set<string>()
    for (const m of ms) {
      const s = meta.get(m)
      if (s?.subject) subjects.add(s.subject.trim().toLowerCase())
      if (s?.level) levels.add(s.level.trim().toLowerCase())
    }
    return { id: j.id, city: j.city, publicSlug: j.public_slug, masters: ms, subjects: [...subjects], levels: [...levels], genderPref: crawlGender(j.gender_preference) }
  })
}

/**
 * PR-19: a tutor's rating changed. The pages that link to them (other
 * profiles' Similar tutors, open tuitions' matching tutors, their city tutor
 * pages) show their gold stars, so exactly those pages are rebuilt — decided by
 * the same rule as a tutor leaving the set (linkerMarks over today's set) — and
 * again after LINKER_REDO_MS (the crawl set is held 5 minutes per server), via
 * the snapshot's pending marks that syncListedTutors applies. Never throws.
 */
export async function markRatingLinkers(tutorId: string): Promise<number> {
  try {
    const admin = createAdminClient()
    if (!admin) return 0
    const set = await loadCrawlSetUncached()
    const self = set.tutors.find((t) => t.id === tutorId)
    if (!self) return 0
    const tuitions = await openTuitionsIn(new Set([self.citySlug]))
    const marks = linkerMarks(set.tutors, [self], tuitions)
    try {
      invalidateMemoTag(LANDING_TAG)
    } catch {
      /* no request scope */
    }
    applyMarks(marks)
    const { data } = await admin.from('admin_summary').select('payload').eq('key', LISTED_SNAPSHOT_KEY).maybeSingle()
    const snap = (data?.payload as Snapshot | null) ?? null
    if (snap && Array.isArray(snap.tutors) && Array.isArray(snap.slugs)) {
      const pending = withPending(snap.pending ?? null, marks, Date.now())
      await admin.from('admin_summary').upsert({ key: LISTED_SNAPSHOT_KEY, payload: { ...snap, pending }, computed_at: new Date().toISOString() })
    }
    return marks.length
  } catch {
    return 0
  }
}

export type SyncResult = { dropped: number; added: number; marks: number }

/** Compare, mark the linkers of every tutor that left, store the new set. Never throws. */
export async function syncListedTutors(): Promise<SyncResult> {
  const out: SyncResult = { dropped: 0, added: 0, marks: 0 }
  try {
    const admin = createAdminClient()
    if (!admin) return out
    const { data } = await admin.from('admin_summary').select('payload').eq('key', LISTED_SNAPSHOT_KEY).maybeSingle()
    const snap = (data?.payload as Snapshot | null) ?? null
    const now = await listedSlugs()
    const nowMs = Date.now()
    let pending: PendingMarks | null = snap?.pending ?? null
    let pendingChanged = false
    // The second pass of an earlier drop (lib/tutorLinkersCore LINKER_REDO_MS).
    if (redoDue(pending, nowMs)) {
      applyMarks(pending!.marks)
      out.marks += pending!.marks.length
      pending = null
      pendingChanged = true
    }
    const save = async (slugs: string[], tutors: CrawlTutor[]) => {
      await admin.from('admin_summary').upsert({ key: LISTED_SNAPSHOT_KEY, payload: { slugs, tutors, pending }, computed_at: new Date().toISOString() })
    }
    const store = async () => save(now, (await loadCrawlSetUncached()).tutors.map(slim))
    if (!snap || !Array.isArray(snap.tutors) || !Array.isArray(snap.slugs)) {
      await store()
      return out
    }
    const before = snap.slugs!
    const gone = droppedSlugs(before, now)
    const nowSet = new Set(now)
    const beforeSet = new Set(before)
    out.dropped = gone.length
    out.added = now.filter((s) => !beforeSet.has(s)).length
    if (gone.length > 0) {
      const goneSet = new Set(gone)
      const goneTutors = snap.tutors.filter((t) => goneSet.has(t.slug) && !nowSet.has(t.slug))
      const tuitions = await openTuitionsIn(new Set(goneTutors.map((t) => t.citySlug)))
      const marks = linkerMarks(snap.tutors, goneTutors, tuitions)
      // The rebuilt pages must not read the old crawl set from memory.
      try {
        invalidateMemoTag(LANDING_TAG)
      } catch {
        /* no request scope */
      }
      applyMarks(marks)
      out.marks += marks.length
      pending = withPending(pending, marks, nowMs)
    }
    if (out.dropped > 0 || out.added > 0) await store()
    else if (pendingChanged) await save(snap.slugs!, snap.tutors)
  } catch {
    /* the 24-hour safety net still applies */
  }
  return out
}
