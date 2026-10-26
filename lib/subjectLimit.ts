// lib/subjectLimit.ts
//
// The 15-subject limit (owner, 21 Oct 2026) — the I/O half. Every route that
// replaces a tutor's subject set calls subjectLimitRefusal() BEFORE it deletes
// anything, so a refused save changes nothing. Rules: lib/subjectLimitCore.

import { subjectLimitProblem, subjectKeysOfIds } from '@/lib/subjectLimitCore'

type Q = PromiseLike<{ data: unknown; error: unknown }>
type Client = { from: (t: string) => { select: (c: string) => { in: (col: string, v: (number | string)[]) => Q } } }

/** Each master id's subject NAME (missing when the lookup fails). */
export async function subjectNamesOfIds(client: unknown, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const unique = [...new Set(ids)]
  if (unique.length === 0) return out
  const db = client as Client
  const slugOf = new Map<number, string>()
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await db.from('taxonomy_master').select('id, subject_slug').in('id', unique.slice(i, i + 200))
    for (const r of (data as { id: number; subject_slug: string | null }[] | null) ?? []) if (r.subject_slug) slugOf.set(r.id, r.subject_slug)
  }
  const slugs = [...new Set(slugOf.values())]
  const nameOf = new Map<string, string>()
  for (let i = 0; i < slugs.length; i += 200) {
    const { data } = await db.from('taxonomy_subjects').select('slug, name').in('slug', slugs.slice(i, i + 200))
    for (const r of (data as { slug: string; name: string }[] | null) ?? []) nameOf.set(r.slug, r.name)
  }
  for (const [id, slug] of slugOf) out.set(id, nameOf.get(slug) ?? slug)
  return out
}

/** The refusal message, or null when the new set may be saved. */
export async function subjectLimitRefusal(client: unknown, newIds: number[], savedIds: number[]): Promise<string | null> {
  const names = await subjectNamesOfIds(client, [...newIds, ...savedIds])
  return subjectLimitProblem(newIds, savedIds, (id) => names.get(id))
}

/** How many distinct subjects (the limit's own count) a tutor has saved. */
export async function savedSubjectCount(client: unknown, tutorId: string): Promise<number> {
  const db = client as { from: (t: string) => { select: (c: string) => { eq: (col: string, v: string) => PromiseLike<{ data: unknown }> } } }
  const { data } = await db.from('tutor_subjects').select('master_id').eq('tutor_id', tutorId)
  const ids = ((data as { master_id: number }[] | null) ?? []).map((r) => r.master_id)
  if (ids.length === 0) return 0
  const names = await subjectNamesOfIds(client, ids)
  return subjectKeysOfIds(ids, (id) => names.get(id)).size
}
