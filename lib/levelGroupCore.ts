// PURE. The tutor profile's "Subjects and levels", grouped (PR-15).
//
// Consecutive grades that teach exactly the same subjects become one row
// ("Grade 1 – 5", "Pre-nursery – Prep", "Grade 9 – 10 (Arts and Science)"),
// and every level reads as a short, normal-case name ("Pre-nursery", not
// "PRE - PRIMARY / PRE - SCHOOL — PRE NURSERY / PLAY GROUP / KG I"). Display
// only: matching everywhere stays on taxonomy_master ids.

export type LevelSubject = { label: string; masterId: number }
export type LevelInput = { category: string; level: string; subjects: LevelSubject[]; masterId: number }
export type LevelGroup = { key: string; label: string; subjects: LevelSubject[]; masterId: number; leaf: boolean }

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** Pre-primary ladder, in order. */
const PRE: { test: RegExp; name: string }[] = [
  { test: /pre\s*nursery|play\s*group/i, name: 'Pre-nursery' },
  { test: /^nursery|kg\s*-?\s*ii\b(?!i)/i, name: 'Nursery' },
  { test: /^prep|kg\s*-?\s*iii/i, name: 'Prep' },
]

/** Fixed short names for the levels whose stored name is long or repeats its category. */
const SHORT: Record<string, string> = {
  'o levels': 'O Level',
  'as & a levels': 'AS & A Level',
  'igcse core': 'IGCSE Core',
  'fa ( part i & part ii)': 'FA',
  'fa (part i & part ii)': 'FA',
  'fsc part i & part ii': 'FSc',
  ics: 'ICS',
  'i com': 'I.Com',
  'teaching of holy quran': 'Holy Quran',
  'sports & games': 'Sports & Games',
  'admission test prep': 'Admission test prep',
  'all tests': 'Test preparation',
}

const BY_CATEGORY: Record<string, string> = {
  'adp (2 years)': 'ADP',
  'bs (4 years)': 'BS',
  'ms / mphil': 'MS / MPhil',
  ib: 'IB',
}

/** Normal case for a label that arrives in capitals ("GRADE 1" → "Grade 1");
 *  short all-caps words stay (O, AS, IB, FSC → kept as written). */
function normalCase(s: string): string {
  const clean = s.trim().replace(/\s+/g, ' ')
  if (clean !== clean.toUpperCase()) return clean
  return clean
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Kg|Ib|Bs|Ms|Ics|Igcse|As|Adp)\b/g, (m) => m.toUpperCase())
}

type Rung = { ladder: 'pre' | 'grade' | null; rank: number; grade: number | null; track: string | null }

function rungOf(category: string, level: string): Rung {
  const pre = PRE.findIndex((p) => p.test.test(level.trim()))
  if (pre >= 0 && /pre/i.test(category)) return { ladder: 'pre', rank: pre, grade: null, track: null }
  const g = /^grade\s*(\d{1,2})(?:\s*-\s*(arts|science))?$/i.exec(level.trim())
  if (g) {
    const track = g[2] ? (g[2].toLowerCase() === 'arts' ? 'Arts' : 'Science') : null
    return { ladder: 'grade', rank: Number(g[1]), grade: Number(g[1]), track }
  }
  return { ladder: null, rank: 0, grade: null, track: null }
}

/** One level's short display name. */
export function shortLevelName(category: string, level: string): string {
  const r = rungOf(category, level)
  if (r.ladder === 'pre') return PRE[r.rank].name
  if (r.ladder === 'grade') return `Grade ${r.grade}${r.track ? ` (${r.track})` : ''}`
  const lv = norm(level)
  if (SHORT[lv]) return SHORT[lv]
  const cat = BY_CATEGORY[norm(category)]
  if (cat) return /^(all programs|semester\b)/i.test(level.trim()) ? cat : `${cat} ${level.trim().length <= 4 ? level.trim() : normalCase(level)}`
  return normalCase(level.replace(/\bLevels\b/g, 'Level'))
}

const signature = (subjects: LevelSubject[]) =>
  [...new Set(subjects.map((s) => norm(s.label)))].sort().join('|')

type Unit = { rung: Rung; tracks: string[]; subjects: LevelSubject[]; masterId: number; order: number; name: string; sig: string }

function joinTracks(tracks: string[]): string {
  if (tracks.length === 0) return ''
  const sorted = [...tracks].sort()
  return ` (${sorted.length === 1 ? sorted[0] : `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`})`
}

/**
 * Group a tutor's levels for display. Input in taxonomy order (the order the
 * profile loads them). Pre-primary and Grade 1–10 are ladders: neighbours with
 * the same subject list merge; Grade 9/10's Arts and Science merge when they
 * teach the same subjects. Every other level stays its own row.
 */
export function groupLevels(levels: LevelInput[]): LevelGroup[] {
  // 1. One unit per level; a grade's tracks fold into one unit when equal.
  const units: Unit[] = []
  levels.forEach((l, i) => {
    const rung = rungOf(l.category, l.level)
    const sig = signature(l.subjects)
    if (rung.ladder === 'grade' && rung.track) {
      const same = units.find((u) => u.rung.ladder === 'grade' && u.rung.grade === rung.grade && u.tracks.length > 0 && u.sig === sig && sig !== '')
      if (same) {
        same.tracks.push(rung.track)
        return
      }
    }
    units.push({
      rung,
      tracks: rung.track ? [rung.track] : [],
      subjects: l.subjects,
      masterId: l.masterId,
      order: rung.ladder === 'pre' ? rung.rank : rung.ladder === 'grade' ? 100 + rung.rank * 10 + (rung.track === 'Science' ? 1 : 0) : 1000 + i,
      name: shortLevelName(l.category, l.level),
      sig,
    })
  })
  units.sort((a, b) => a.order - b.order)

  // 2. Merge ladder neighbours: same ladder, next rung, same subjects, same tracks.
  const groups: { units: Unit[] }[] = []
  for (const u of units) {
    const last = groups[groups.length - 1]?.units
    const prev = last?.[last.length - 1]
    const joins =
      prev &&
      u.rung.ladder !== null &&
      prev.rung.ladder === u.rung.ladder &&
      u.rung.rank === prev.rung.rank + 1 &&
      u.sig !== '' &&
      u.sig === prev.sig &&
      joinTracks(u.tracks) === joinTracks(prev.tracks)
    if (joins) last!.push(u)
    else groups.push({ units: [u] })
  }

  return groups.map(({ units: us }) => {
    const first = us[0]
    const last = us[us.length - 1]
    let label: string
    if (first.rung.ladder === 'grade') {
      label = (us.length === 1 ? `Grade ${first.rung.grade}` : `Grade ${first.rung.grade} – ${last.rung.grade}`) + joinTracks(first.tracks)
    } else if (first.rung.ladder === 'pre') {
      label = us.length === 1 ? first.name : `${first.name} – ${last.name}`
    } else {
      label = first.name
    }
    return { key: `${first.order}-${label}`, label, subjects: first.subjects, masterId: first.masterId, leaf: first.subjects.length === 0 }
  })
}

/** The first `max` items and how many more there are (job titles: 5, PR-15). */
export function firstN<T>(items: readonly T[], max: number): { shown: T[]; more: T[] } {
  return { shown: items.slice(0, max), more: items.slice(max) }
}
