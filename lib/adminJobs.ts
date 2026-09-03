// lib/adminJobs.ts
//
// The tuition board, as staff.
//
// Everything reads through the SERVICE ROLE, and that is a deliberate
// difference from the public board. `lib/jobFeed.ts` answers "what may a
// visitor see" and is therefore bound by `status = 'open'` and the jobs read
// policy; this answers "what is on the platform", including closed jobs, hired
// jobs, and jobs by suspended parents -- which are exactly the ones an admin
// opens this screen to find. Permission is enforced at the route, once, by
// SCREEN_ACCESS.jobs.
//
// PAGING is the keyset pattern the rest of the platform uses: (created_at, id)
// descending, with the id as tiebreaker because created_at alone is not unique
// and two jobs posted in the same millisecond are ordinary on a busy board.

import { createAdminClient } from '@/lib/supabase/admin'
import { decodeCursor, encodeCursor } from '@/lib/cursor'

export type AdminJobRow = {
  id: string
  jobTxId: string | null
  title: string
  status: string
  isFeatured: boolean
  city: string | null
  area: string | null
  classLevel: string | null
  subjects: string[]
  createdAt: string
  parentId: string | null
  parentName: string
  applicantCount: number
  hiredTutorId: string | null
}

export type AdminJobFilters = {
  q: string
  status: string
  city: string
  subject: string
  featured: string
}

export const NO_JOB_FILTERS: AdminJobFilters = {
  q: '',
  status: '',
  city: '',
  subject: '',
  featured: '',
}

type JobCursor = { c: string; i: string }

export async function adminJobPage({
  filters,
  limit,
  cursor = null,
}: {
  filters: AdminJobFilters
  limit: number
  cursor?: string | null
}): Promise<{ rows: AdminJobRow[]; nextCursor: string | null; total: number }> {
  const admin = createAdminClient()
  if (!admin) return { rows: [], nextCursor: null, total: 0 }

  // Subject filtering resolves through job_subjects, because subjects are
  // taxonomy_master ids and never free text (rule 12). A subject that matches
  // no job returns an empty page rather than an unfiltered one.
  let matchingIds: string[] | null = null
  if (filters.subject) {
    const { data: master } = await admin
      .from('taxonomy_master')
      .select('id')
      .eq('subject_slug', filters.subject)
    const ids = (master ?? []).map((m) => m.id as number)
    if (ids.length === 0) return { rows: [], nextCursor: null, total: 0 }

    const { data: links } = await admin.from('job_subjects').select('job_id').in('master_id', ids)
    matchingIds = Array.from(new Set((links ?? []).map((l) => l.job_id as string)))
    if (matchingIds.length === 0) return { rows: [], nextCursor: null, total: 0 }
  }

  const build = () => {
    let q = admin
      .from('jobs')
      .select(
        'id, job_tx_id, title, status, is_featured, city, area, class_level, subjects, created_at, parent_id, hired_tutor_id',
        { count: 'exact' },
      )
    if (matchingIds) q = q.in('id', matchingIds)
    if (filters.status) q = q.eq('status', filters.status)
    if (filters.city) q = q.ilike('city', filters.city)
    if (filters.featured === 'yes') q = q.eq('is_featured', true)
    if (filters.featured === 'no') q = q.eq('is_featured', false)
    if (filters.q) {
      const term = filters.q.replace(/[,()]/g, ' ').trim()
      // The reference is what an admin pastes from a support message, so it
      // has to match as readily as the title does.
      if (term) q = q.or(`title.ilike.%${term}%,job_tx_id.ilike.%${term}%`)
    }
    return q
  }

  let query = build()
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  const after = decodeCursor<JobCursor>(cursor)
  if (after) {
    query = query.or(
      `created_at.lt.${after.c},and(created_at.eq.${after.c},id.lt.${after.i})`,
    )
  }

  const { data, count } = await query
  const all = data ?? []
  const hasMore = all.length > limit
  const page = hasMore ? all.slice(0, limit) : all

  if (page.length === 0) return { rows: [], nextCursor: null, total: count ?? 0 }

  const jobIds = page.map((j) => j.id as string)
  const parentIds = Array.from(
    new Set(page.map((j) => j.parent_id as string | null).filter(Boolean) as string[]),
  )

  const [{ data: apps }, { data: parents }] = await Promise.all([
    admin.from('applications').select('job_id').in('job_id', jobIds),
    parentIds.length > 0
      ? admin.from('profiles').select('id, full_name').in('id', parentIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ])

  const applicants = new Map<string, number>()
  for (const a of apps ?? []) {
    const k = a.job_id as string
    applicants.set(k, (applicants.get(k) ?? 0) + 1)
  }
  const parentName = new Map((parents ?? []).map((p) => [p.id as string, p.full_name as string]))

  const last = page[page.length - 1]
  return {
    rows: page.map((j) => ({
      id: j.id as string,
      jobTxId: (j.job_tx_id as string) ?? null,
      title: (j.title as string) ?? 'Tuition',
      status: (j.status as string) ?? 'open',
      isFeatured: !!j.is_featured,
      city: (j.city as string) ?? null,
      area: (j.area as string) ?? null,
      classLevel: (j.class_level as string) ?? null,
      subjects: (j.subjects as string[] | null) ?? [],
      createdAt: j.created_at as string,
      parentId: (j.parent_id as string) ?? null,
      parentName: parentName.get(j.parent_id as string) ?? '—',
      applicantCount: applicants.get(j.id as string) ?? 0,
      hiredTutorId: (j.hired_tutor_id as string) ?? null,
    })),
    nextCursor: hasMore
      ? encodeCursor({ c: last.created_at as string, i: last.id as string })
      : null,
    total: count ?? 0,
  }
}

/** The cities and subjects that actually appear on jobs, for the filter bar. */
export async function adminJobFacets(): Promise<{ cities: string[]; subjects: { slug: string; name: string }[] }> {
  const admin = createAdminClient()
  if (!admin) return { cities: [], subjects: [] }

  const [{ data: jobs }, { data: links }] = await Promise.all([
    admin.from('jobs').select('city'),
    admin.from('job_subjects').select('master_id'),
  ])

  const cities = Array.from(
    new Set((jobs ?? []).map((j) => (j.city as string) ?? '').filter(Boolean)),
  ).sort()

  const masterIds = Array.from(new Set((links ?? []).map((l) => l.master_id as number)))
  if (masterIds.length === 0) return { cities, subjects: [] }

  const { data: master } = await admin
    .from('taxonomy_master')
    .select('subject_slug')
    .in('id', masterIds)
  const slugs = Array.from(
    new Set((master ?? []).map((m) => m.subject_slug as string | null).filter(Boolean) as string[]),
  )
  if (slugs.length === 0) return { cities, subjects: [] }

  const { data: subjects } = await admin
    .from('taxonomy_subjects')
    .select('slug, name')
    .in('slug', slugs)

  return {
    cities,
    subjects: (subjects ?? [])
      .map((s) => ({ slug: s.slug as string, name: s.name as string }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}
