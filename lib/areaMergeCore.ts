// lib/areaMergeCore.ts
//
// Locations follow-ups (owner, 16 Oct 2026). PURE — no database — so the
// review screen, the report and the tests share one rule.

import { areaKey } from './areaHubCore'

export type ShortNameCandidate = { short: string; shortCount: number; longer: string; longerCount: number }

/**
 * Areas whose name looks like a short or partial name of a bigger area of the
 * same city: every word of the short name appears, in order, inside the longer
 * name ("Johar" ~ "Gulistan-e-Johar", "Iqbal Town" ~ "Allama Iqbal Town").
 * Only areas that have a hub (`hubs`, with their open count) are reported as
 * the SHORT side; the longer side may be any live curated area. A report only:
 * nothing is merged (Nazimabad and North Nazimabad are different areas).
 */
export function shortNameCandidates(
  city: string,
  hubs: { name: string; count: number }[],
  curated: string[],
): ShortNameCandidate[] {
  const countOf = new Map(hubs.map((h) => [areaKey(h.name, city), h.count]))
  const out: ShortNameCandidate[] = []
  for (const h of hubs) {
    const sk = areaKey(h.name, city)
    if (!sk) continue
    for (const c of curated) {
      const ck = areaKey(c, city)
      if (!ck || ck === sk) continue
      if (!` ${ck} `.includes(` ${sk} `)) continue
      out.push({ short: h.name, shortCount: h.count, longer: c, longerCount: countOf.get(ck) ?? 0 })
    }
  }
  const seen = new Set<string>()
  return out
    .filter((c) => {
      const k = `${areaKey(c.short, city)}|${areaKey(c.longer, city)}`
      return seen.has(k) ? false : (seen.add(k), true)
    })
    .sort((a, b) => b.shortCount - a.shortCount || a.short.localeCompare(b.short))
}
