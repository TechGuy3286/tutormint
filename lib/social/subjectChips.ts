// lib/social/subjectChips.ts — PURE, client-safe.
//
// The subject chips on social posts, the WhatsApp status image and the profile
// link-preview image (owner, 26 Oct 2026): neighbouring grades are merged with
// the SAME grouping the CV uses (lib/cv/textRules subjectGrid), so a tutor who
// teaches English in Grade 9 and Grade 10 shows one chip "Grade 9–10 · English"
// instead of two.
//
// The CV groups whole subject lists per level; a chip is one subject, so the
// grouping is run once per subject (that subject's levels only), which merges
// the neighbouring grades of that subject whatever else the tutor teaches.

import { subjectGrid } from '@/lib/cv/textRules'

export type ChipInput = { level: string; subject: string | null }
export type SubjectChip = { level: string; subject: string | null; label: string }

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** "Grade 9–10 · Science" (a CV cell label) → "Grade 9–10 Science" for a chip. */
function chipLevel(cellLabel: string): string {
  return squash(cellLabel.replace(/\s*·\s*/g, ' '))
}

/**
 * The merged chips, in the order the tutor's subjects first appear (the
 * profile's order). Within one subject the grades read youngest first.
 */
export function mergeSubjectChips(parts: ChipInput[]): SubjectChip[] {
  const order: string[] = []
  const levelsBySubject = new Map<string, string[]>()
  const levelOnly: string[] = []
  for (const p of parts) {
    const level = squash(p.level ?? '')
    const subject = p.subject ? squash(p.subject) : ''
    if (!subject) {
      if (level && !levelOnly.includes(level)) levelOnly.push(level)
      if (level && !order.includes(`\u0000${level}`)) order.push(`\u0000${level}`)
      continue
    }
    const key = subject.toLowerCase()
    if (!levelsBySubject.has(key)) {
      levelsBySubject.set(key, [])
      order.push(subject)
    }
    const list = levelsBySubject.get(key)!
    if (level && !list.includes(level)) list.push(level)
  }

  const out: SubjectChip[] = []
  const seen = new Set<string>()
  const push = (c: SubjectChip) => {
    const k = c.label.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    out.push(c)
  }
  for (const entry of order) {
    if (entry.startsWith('\u0000')) {
      const level = entry.slice(1)
      const cell = subjectGrid([{ level, subjects: [] }])[0]
      const lv = cell ? chipLevel(cell.label) : level
      push({ level: lv, subject: null, label: lv })
      continue
    }
    const subject = entry
    const levels = levelsBySubject.get(subject.toLowerCase()) ?? []
    if (levels.length === 0) {
      push({ level: '', subject, label: subject })
      continue
    }
    const cells = subjectGrid(levels.map((level) => ({ level, subjects: [subject] })))
    for (const cell of cells) {
      const lv = chipLevel(cell.label)
      push({ level: lv, subject, label: lv ? `${lv} · ${subject}` : subject })
    }
  }
  return out
}
