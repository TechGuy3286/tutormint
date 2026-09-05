import 'server-only'

import { levelLabel } from '@/lib/display'
import { createAdminClient } from '@/lib/supabase/admin'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

// A tutor's subjects as "Level Subject" display strings, singular level labels
// applied (the SAME lib/display mapper the profile and the CV use). The
// tutor_directory.subjects column is not populated, so the social banner
// resolves them from tutor_subjects → taxonomy, exactly like the CV does.

export async function resolveSubjectLabels(
  admin: Admin,
  tutorId: string,
  limit = 6,
): Promise<string[]> {
  const { data: subs } = await admin
    .from('tutor_subjects')
    .select('master_id')
    .eq('tutor_id', tutorId)
  const ids = [...new Set((subs ?? []).map((s) => s.master_id as number))]
  if (ids.length === 0) return []

  const { data: master } = await admin
    .from('taxonomy_master')
    .select('id, level_slug, subject_slug')
    .in('id', ids)
  const rows = (master ?? []) as { id: number; level_slug: string; subject_slug: string | null }[]

  const levelSlugs = [...new Set(rows.map((m) => m.level_slug))]
  const subjectSlugs = [...new Set(rows.map((m) => m.subject_slug).filter(Boolean) as string[])]

  const [{ data: levels }, { data: subjects }] = await Promise.all([
    admin.from('taxonomy_levels').select('slug, name').in('slug', levelSlugs),
    subjectSlugs.length > 0
      ? admin.from('taxonomy_subjects').select('slug, name').in('slug', subjectSlugs)
      : Promise.resolve({ data: [] as { slug: string; name: string }[] }),
  ])
  const levelName = new Map((levels ?? []).map((l) => [l.slug as string, l.name as string]))
  const subjectName = new Map((subjects ?? []).map((s) => [s.slug as string, s.name as string]))

  const out: string[] = []
  const seen = new Set<string>()
  for (const m of rows) {
    const level = levelLabel(levelName.get(m.level_slug) ?? '')
    const subject = m.subject_slug ? subjectName.get(m.subject_slug) : null
    const label = (subject ? `${level} ${subject}` : level).trim()
    if (label && !seen.has(label)) {
      seen.add(label)
      out.push(label)
    }
    if (out.length >= limit) break
  }
  return out
}

/** The same, batched across many tutors — one set of queries for the admin
    picker, so the caption can carry real subjects without N round trips. */
export async function resolveSubjectLabelsBatch(
  admin: Admin,
  tutorIds: string[],
  limit = 3,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (tutorIds.length === 0) return result

  const { data: subs } = await admin
    .from('tutor_subjects')
    .select('tutor_id, master_id')
    .in('tutor_id', tutorIds)
  const rowsByTutor = new Map<string, number[]>()
  const allMasterIds = new Set<number>()
  for (const r of subs ?? []) {
    const tid = r.tutor_id as string
    const mid = r.master_id as number
    if (!rowsByTutor.has(tid)) rowsByTutor.set(tid, [])
    rowsByTutor.get(tid)!.push(mid)
    allMasterIds.add(mid)
  }
  if (allMasterIds.size === 0) return result

  const { data: master } = await admin
    .from('taxonomy_master')
    .select('id, level_slug, subject_slug')
    .in('id', [...allMasterIds])
  const masterById = new Map(
    (master ?? []).map((m) => [m.id as number, { level_slug: m.level_slug as string, subject_slug: m.subject_slug as string | null }]),
  )
  const levelSlugs = [...new Set((master ?? []).map((m) => m.level_slug as string))]
  const subjectSlugs = [...new Set((master ?? []).map((m) => m.subject_slug as string | null).filter(Boolean) as string[])]

  const [{ data: levels }, { data: subjects }] = await Promise.all([
    admin.from('taxonomy_levels').select('slug, name').in('slug', levelSlugs),
    subjectSlugs.length > 0
      ? admin.from('taxonomy_subjects').select('slug, name').in('slug', subjectSlugs)
      : Promise.resolve({ data: [] as { slug: string; name: string }[] }),
  ])
  const levelName = new Map((levels ?? []).map((l) => [l.slug as string, l.name as string]))
  const subjectName = new Map((subjects ?? []).map((s) => [s.slug as string, s.name as string]))

  for (const [tid, mids] of rowsByTutor) {
    const out: string[] = []
    const seen = new Set<string>()
    for (const mid of mids) {
      const m = masterById.get(mid)
      if (!m) continue
      const level = levelLabel(levelName.get(m.level_slug) ?? '')
      const subject = m.subject_slug ? subjectName.get(m.subject_slug) : null
      const label = (subject ? `${level} ${subject}` : level).trim()
      if (label && !seen.has(label)) {
        seen.add(label)
        out.push(label)
      }
      if (out.length >= limit) break
    }
    result.set(tid, out)
  }
  return result
}
