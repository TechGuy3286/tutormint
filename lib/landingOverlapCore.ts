// lib/landingOverlapCore.ts
//
// The PURE half of the near-duplicate landing-page rule (owner, 6 Oct 2026,
// item 13): no database, no server-only import, so the test runner and the
// server both read one function. See lib/landingOverlap.ts for the loader.
//
// Two landing pages of the same kind in the same city whose listed results are
// 80% or more identical are near-duplicates: the NARROWER one (fewer results —
// ties broken by the smaller master id, so the choice is stable) becomes
// noindex, follow and leaves the sitemap; the broader one stays indexable.

export type LandingKindCore = 'tutors' | 'tuitions'

export const OVERLAP_THRESHOLD = 0.8

export type PageMembers = { kind: LandingKindCore; citySlug: string; masterId: number; ids: string[] }

export function overlapKey(kind: LandingKindCore, citySlug: string, masterId: number): string {
  return `${kind}/${citySlug}/${masterId}`
}

/** The pages that should be noindex: key `${kind}/${citySlug}/${masterId}`, value = the page it duplicates. */
export function overlapNoindexSet(
  pages: PageMembers[],
  threshold = OVERLAP_THRESHOLD,
): Map<string, { kind: LandingKindCore; citySlug: string; masterId: number }> {
  const out = new Map<string, { kind: LandingKindCore; citySlug: string; masterId: number }>()
  const groups = new Map<string, PageMembers[]>()
  for (const p of pages) {
    const g = `${p.kind}/${p.citySlug}`
    ;(groups.get(g) ?? groups.set(g, []).get(g)!).push(p)
  }
  for (const list of groups.values()) {
    const sets = list.map((p) => ({ p, set: new Set(p.ids) }))
    for (const a of sets) {
      if (a.set.size === 0) continue
      for (const b of sets) {
        if (a === b || b.set.size === 0) continue
        // b is "broader" than a: more results, or the same count and a smaller id.
        const broader = b.set.size > a.set.size || (b.set.size === a.set.size && b.p.masterId < a.p.masterId)
        if (!broader) continue
        let inter = 0
        for (const id of a.set) if (b.set.has(id)) inter++
        if (inter / a.set.size >= threshold) {
          out.set(overlapKey(a.p.kind, a.p.citySlug, a.p.masterId), { kind: b.p.kind, citySlug: b.p.citySlug, masterId: b.p.masterId })
          break
        }
      }
    }
  }
  return out
}
