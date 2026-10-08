// lib/smartSearchCore.ts
//
// ONE smart search engine (owner, 8 Oct 2026) — the PURE half, shared by the
// server (browse pages, landing/city pages, the typeahead route) and the browser
// (subject pickers on Post a tuition and onboarding). No database, no React.
//
// It reads a full sentence — "sahiwal tutor for primary school beacchon house" —
// into its parts: City Sahiwal · Level Primary · School Beaconhouse. Short forms
// and Roman Urdu come from the editable "Search words" list (taxonomy_aliases,
// Settings → Subjects) plus a built-in seed, and typos are tolerated by an edit
// distance that grows with the word's length ("mathmatics", "fizics", "beacchon").

export type Dict = {
  /** Canonical city names (location_cities + the distance table). */
  cities: string[]
  /** Levels the pickers show: name, slug, category name. */
  levels: { slug: string; name: string; category: string }[]
  /** Subjects: name + slug; `school` marks the Admission Test Prep schools. */
  subjects: { slug: string; name: string; school?: boolean }[]
  /** Search words: kind subject → subject slug, kind level → level slug. */
  aliases: { kind: 'subject' | 'level'; slug: string; alias: string }[]
  /** Merge the built-in words too (default true). The server passes false: its
   *  list is the editable table, which the built-ins were seeded into. */
  builtin?: boolean
}

export type Parsed = {
  city: string | null
  /** Level names the query named ("Primary" → Grade 1 … Grade 5). */
  levels: string[]
  levelLabel: string | null
  subject: { slug: string; name: string } | null
  school: { slug: string; name: string } | null
  /** The words of the query each part came from, for the removable chips. */
  spans: { kind: 'city' | 'level' | 'subject' | 'school'; text: string; label: string }[]
  /** Meaningful words nothing matched (a tutor's name, for instance). */
  leftover: string
}

/** Built-in search words, used even before the database list loads. The same
 *  set is seeded into taxonomy_aliases (migration 154), where it is editable. */
export const BUILTIN_SUBJECT_WORDS: Record<string, string[]> = {
  mathematics: ['math', 'maths', 'hisab', 'riazi', 'mathmatics'],
  english: ['eng', 'angrezi', 'anghrezi'],
  physics: ['phy', 'fizics', 'physcis'],
  chemistry: ['chem', 'kemistry', 'chemestry'],
  biology: ['bio', 'bailogy'],
  'computer-science': ['comp', 'cs', 'comp sci', 'computer'],
  'islamiat-islamic-studies': ['isl', 'islamiat', 'islamiyat'],
  'pakistan-studies': ['pak st', 'pak studies', 'pak std'],
  'lahore-grammar-school': ['lgs'],
  'karachi-grammar-school': ['kgs'],
  'beaconhouse-school': ['beaconhouse', 'beacon house', 'beacon'],
  'aitchison-college': ['aitchison'],
}

/** Built-in level words → level NAMES (resolved against the live level list). */
const BUILTIN_LEVEL_WORDS: Record<string, string[]> = {
  matric: ['Grade 9 - Arts', 'Grade 10 - Arts', 'Grade 9 - Science', 'Grade 10 - Science'],
  'grade 9 10': ['Grade 9 - Arts', 'Grade 10 - Arts', 'Grade 9 - Science', 'Grade 10 - Science'],
  fsc: ['FSC Part I & Part II'],
  'f sc': ['FSC Part I & Part II'],
  inter: ['FA ( Part I & Part II)', 'FSC Part I & Part II', 'ICS', 'I Com'],
  intermediate: ['FA ( Part I & Part II)', 'FSC Part I & Part II', 'ICS', 'I Com'],
  'o level': ['O Levels'],
  'o levels': ['O Levels'],
  olevel: ['O Levels'],
  'a level': ['AS & A Levels'],
  'a levels': ['AS & A Levels'],
  alevel: ['AS & A Levels'],
  igcse: ['IGCSE Core'],
  kg: ['Pre Nursery / Play Group / KG I', 'Nursery / KG - II', 'Prep / KG- III'],
  nursery: ['Pre Nursery / Play Group / KG I', 'Nursery / KG - II'],
  montessori: ['Pre Nursery / Play Group / KG I', 'Nursery / KG - II', 'Prep / KG- III'],
}

/** Words that carry no meaning in a search (removed before matching). */
const STOP = new Set([
  'tutor', 'tutors', 'teacher', 'teachers', 'tuition', 'tuitions', 'tution', 'for', 'in', 'near', 'at', 'of',
  'the', 'a', 'an', 'need', 'needed', 'required', 'require', 'want', 'wanted', 'looking', 'job', 'jobs',
  'home', 'school', 'and', 'or', 'to', 'my', 'me', 'chahiye', 'chahye', 'ke', 'ki', 'ka', 'liye', 'lye', 'mein',
  'me', 'student', 'students', 'child', 'kids', 'class', 'level', 'subject', 'subjects', 'please', 'best', 'good',
  'female', 'male', 'lady', 'online',
])

export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const squash = (s: string) => norm(s).replace(/ /g, '')

/** Damerau–Levenshtein (optimal string alignment), early exit past `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      rowMin = Math.min(rowMin, d[i][j])
    }
    if (rowMin > max) return max + 1
  }
  return d[a.length][b.length]
}

/** How many typos a word of this length may carry. Short words must be exact —
 *  "cs" must never fuzz into "ict". */
export function typoBudget(len: number): number {
  if (len <= 4) return 0
  if (len <= 7) return 1
  return 2
}

/** Is `typed` (a query word or phrase) close enough to `target`? */
export function fuzzyEq(typed: string, target: string): number | null {
  const a = squash(typed)
  const b = squash(target)
  if (!a || !b) return null
  if (a === b) return 0
  // The budget follows what was TYPED (a misspelling is usually longer), but a
  // short target never fuzzes at all.
  if (b.length < 5) return null
  const budget = typoBudget(a.length)
  if (budget === 0) return null
  const d = editDistance(a, b, budget)
  return d <= budget ? d : null
}

type Entry = { kind: 'city' | 'level' | 'subject' | 'school'; key: string; label: string; value: string; levels?: string[] }

function entries(dict: Dict): Entry[] {
  const out: Entry[] = []
  for (const c of dict.cities) out.push({ kind: 'city', key: norm(c), label: c, value: c })
  const levelByName = new Map(dict.levels.map((l) => [norm(l.name), l]))
  const categories = new Map<string, string[]>()
  for (const l of dict.levels) {
    const k = norm(l.category)
    ;(categories.get(k) ?? categories.set(k, []).get(k)!).push(l.name)
  }
  // A category ("Primary", "Middle / Lower Secondary") names all its grades.
  for (const [k, names] of categories) {
    const label = dict.levels.find((l) => norm(l.category) === k)?.category ?? k
    out.push({ kind: 'level', key: k, label, value: label, levels: names })
    // "Middle / Lower Secondary" → also "middle", "lower secondary".
    for (const part of label.split('/').map((p) => norm(p)).filter((p) => p && p !== k && p.length > 3)) {
      out.push({ kind: 'level', key: part, label, value: label, levels: names })
    }
  }
  for (const l of dict.levels) out.push({ kind: 'level', key: norm(l.name), label: l.name, value: l.name, levels: [l.name] })
  // "grade 5", "class 5", "5th" → Grade 5.
  for (const l of dict.levels) {
    const m = /^grade (\d+)$/i.exec(l.name.trim())
    if (m) {
      for (const k of [`class ${m[1]}`, `${m[1]}th`, `${m[1]}st`, `${m[1]}nd`, `${m[1]}rd`, `grade${m[1]}`]) {
        out.push({ kind: 'level', key: k, label: l.name, value: l.name, levels: [l.name] })
      }
    }
  }
  for (const [word, names] of Object.entries(BUILTIN_LEVEL_WORDS)) {
    const live = names.filter((n) => levelByName.has(norm(n))).map((n) => levelByName.get(norm(n))!.name)
    if (live.length) out.push({ kind: 'level', key: norm(word), label: live.length === 1 ? live[0] : word.toUpperCase() === word ? word : titleCase(word), value: live.join('|'), levels: live })
  }
  const subjBySlug = new Map(dict.subjects.map((s) => [s.slug, s]))
  for (const s of dict.subjects) {
    out.push({ kind: s.school ? 'school' : 'subject', key: norm(s.name), label: s.name, value: s.slug })
    // A school also answers to its name without "School" / "College".
    if (s.school) {
      const short = norm(s.name.replace(/\b(school|college|schools|colleges)\b/gi, ''))
      if (short && short !== norm(s.name)) out.push({ kind: 'school', key: short, label: s.name, value: s.slug })
    }
  }
  const aliasRows = [
    ...dict.aliases,
    ...(dict.builtin === false
      ? []
      : Object.entries(BUILTIN_SUBJECT_WORDS).flatMap(([slug, words]) => words.map((alias) => ({ kind: 'subject' as const, slug, alias })))),
  ]
  for (const a of aliasRows) {
    if (a.kind === 'subject') {
      const s = subjBySlug.get(a.slug)
      if (s) out.push({ kind: s.school ? 'school' : 'subject', key: norm(a.alias), label: s.name, value: s.slug })
    } else {
      const l = dict.levels.find((x) => x.slug === a.slug)
      if (l) {
        // A level word shared by several levels ("matric") collects them all.
        const existing = out.find((e) => e.kind === 'level' && e.key === norm(a.alias))
        if (existing && existing.levels) {
          if (!existing.levels.includes(l.name)) existing.levels.push(l.name)
        } else out.push({ kind: 'level', key: norm(a.alias), label: titleCase(a.alias), value: l.name, levels: [l.name] })
      }
    }
  }
  return out
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

const KIND_ORDER = { city: 0, level: 1, school: 2, subject: 3 } as const

/**
 * Read a query into city / level / subject / school. Longest phrases first;
 * an exact match beats a fuzzy one; a word is used once.
 */
export function parseQuery(q: string, dict: Dict): Parsed {
  const words = norm(q).split(' ').filter(Boolean)
  const out: Parsed = { city: null, levels: [], levelLabel: null, subject: null, school: null, spans: [], leftover: '' }
  if (words.length === 0) return out
  const all = entries(dict)
  const byKey = new Map<string, Entry[]>()
  for (const e of all) (byKey.get(e.key) ?? byKey.set(e.key, []).get(e.key)!).push(e)
  const squashed = new Map<string, Entry[]>()
  for (const e of all) {
    const k = e.key.replace(/ /g, '')
    ;(squashed.get(k) ?? squashed.set(k, []).get(k)!).push(e)
  }

  const used = new Array(words.length).fill(false)
  const take = (e: Entry, from: number, to: number) => {
    const text = words.slice(from, to).join(' ')
    if (e.kind === 'city' && !out.city) out.city = e.value
    else if (e.kind === 'level' && out.levels.length === 0) {
      out.levels = e.levels ?? [e.value]
      out.levelLabel = e.label
    } else if (e.kind === 'subject' && !out.subject) out.subject = { slug: e.value, name: e.label }
    else if (e.kind === 'school' && !out.school) out.school = { slug: e.value, name: e.label }
    else return false
    out.spans.push({ kind: e.kind, text, label: e.label })
    for (let i = from; i < to; i++) used[i] = true
    return true
  }
  const free = (from: number, to: number) => used.slice(from, to).every((u) => !u)
  const pick = (cands: Entry[]) =>
    [...cands].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])

  // Pass 1: exact phrases (with and without spaces), longest first.
  for (let len = Math.min(4, words.length); len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      if (!free(i, i + len)) continue
      const phrase = words.slice(i, i + len).join(' ')
      if (len === 1 && STOP.has(phrase)) continue
      const hits = byKey.get(phrase) ?? squashed.get(phrase.replace(/ /g, '')) ?? []
      for (const e of pick(hits)) if (take(e, i, i + len)) break
    }
  }
  // Pass 2: fuzzy phrases, longest first — "beacchon house", "mathmatics".
  for (let len = Math.min(3, words.length); len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      if (!free(i, i + len)) continue
      const phrase = words.slice(i, i + len).join(' ')
      if (len === 1 && STOP.has(phrase)) continue
      if (squash(phrase).length < 5) continue
      let best: { e: Entry; d: number } | null = null
      for (const e of all) {
        const d = fuzzyEq(phrase, e.key)
        if (d == null) continue
        if (!best || d < best.d || (d === best.d && KIND_ORDER[e.kind] < KIND_ORDER[best.e.kind])) best = { e, d }
      }
      if (best) take(best.e, i, i + len)
    }
  }
  out.leftover = words.filter((w, i) => !used[i] && !STOP.has(w)).join(' ')
  return out
}

/** Did the query mean anything we understood? */
export function understood(p: Parsed): boolean {
  return !!(p.city || p.levels.length || p.subject || p.school)
}

/** The query with one chip's words removed — the chip's × link. */
export function withoutSpan(q: string, spanText: string): string {
  const words = norm(q).split(' ')
  const drop = spanText.split(' ')
  for (let i = 0; i + drop.length <= words.length; i++) {
    if (drop.every((w, j) => words[i + j] === w)) {
      words.splice(i, drop.length)
      break
    }
  }
  return words.filter((w) => !STOP.has(w)).join(' ').trim()
}

/**
 * The broader subject for a fallback: a subject whose words are a strict subset
 * of the asked one ("Additional Mathematics" → "Mathematics"). Never an
 * unrelated subject — null when nothing qualifies.
 */
export function broaderSubject(asked: { slug: string; name: string }, subjects: Dict['subjects']): { slug: string; name: string } | null {
  const askedWords = new Set(norm(asked.name).split(' '))
  let best: { slug: string; name: string; n: number } | null = null
  for (const s of subjects) {
    if (s.slug === asked.slug || s.school) continue
    const w = norm(s.name).split(' ')
    if (w.length >= askedWords.size) continue
    if (!w.every((x) => askedWords.has(x))) continue
    if (!best || w.length > best.n) best = { slug: s.slug, name: s.name, n: w.length }
  }
  return best ? { slug: best.slug, name: best.name } : null
}

/** The nearest levels for a fallback: a Grade N widens to N-1 and N+1; any
 *  other level to the rest of its category. Never empty-handed if it can help. */
export function nearestLevels(asked: string[], levels: Dict['levels']): string[] {
  const names = new Set(levels.map((l) => l.name))
  const out = new Set<string>()
  for (const a of asked) {
    const m = /^Grade (\d+)(.*)$/.exec(a)
    if (m) {
      const n = Number(m[1])
      for (const k of [n - 1, n + 1]) {
        const cand = `Grade ${k}${m[2]}`
        if (names.has(cand)) out.add(cand)
      }
      continue
    }
    const cat = levels.find((l) => l.name === a)?.category
    for (const l of levels) if (l.category === cat && l.name !== a) out.add(l.name)
  }
  for (const a of asked) out.delete(a)
  return [...out]
}

/** Client pickers: does a subject (name + its search words) match what was typed? */
export function subjectMatches(typed: string, name: string, words: string[] = []): boolean {
  const t = norm(typed)
  if (!t) return true
  const n = norm(name)
  if (n.includes(t)) return true
  for (const w of words) {
    const nw = norm(w)
    if (nw === t || (t.length >= 3 && nw.startsWith(t))) return true
  }
  // Typos: compare against the name and each of its words.
  if (fuzzyEq(t, n) != null) return true
  for (const part of n.split(' ')) if (part.length >= 5 && fuzzyEq(t, part) != null) return true
  for (const w of words) if (fuzzyEq(t, w) != null) return true
  return false
}

/** The search words for a subject slug, built-in + any extra. */
export function wordsForSlug(slug: string, extra: { slug: string; alias: string }[] = []): string[] {
  return [...(BUILTIN_SUBJECT_WORDS[slug] ?? []), ...extra.filter((a) => a.slug === slug).map((a) => a.alias)]
}
