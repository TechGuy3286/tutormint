// lib/memberDuplicatesCore.ts — PURE. "Possible duplicate" pairs (owner, 26 Oct 2026).
//
// The People page tags each member with the accounts that look like the same
// person (lib/peopleDirectoryCore findPossibleDuplicates). Here those tags
// become PAIRS (each once), minus every pair the Owner marked "Not a
// duplicate" — that mark hides the warning for that pair for good.

import type { DupLink, DupReason } from '@/lib/peopleDirectoryCore'

export type DuplicatePair = {
  aId: string
  bId: string
  aName: string
  bName: string
  role: string
  reason: DupReason
}

export function pairId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function openPairs(
  tags: Map<string, DupLink[]>,
  dismissed: Set<string>,
  people: Map<string, { name: string; role: string }>,
): DuplicatePair[] {
  const seen = new Set<string>()
  const out: DuplicatePair[] = []
  for (const [id, links] of tags) {
    for (const l of links) {
      const key = pairId(id, l.id)
      if (seen.has(key) || dismissed.has(key)) continue
      seen.add(key)
      const [aId, bId] = key.split('|')
      const a = people.get(aId)
      const b = people.get(bId)
      if (!a || !b) continue
      out.push({ aId, bId, aName: a.name, bName: b.name, role: a.role, reason: l.reason })
    }
  }
  return out.sort((x, y) => x.aName.localeCompare(y.aName))
}

/** Tags without the dismissed pairs (the People cards' "Possible duplicate" line). */
export function withoutDismissed(tags: Map<string, DupLink[]>, dismissed: Set<string>): Map<string, DupLink[]> {
  const out = new Map<string, DupLink[]>()
  for (const [id, list] of tags) {
    const keep = list.filter((l) => !dismissed.has(pairId(id, l.id)))
    if (keep.length) out.set(id, keep)
  }
  return out
}
