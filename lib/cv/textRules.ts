// lib/cv/textRules.ts
//
// The small display rules the CV applies to what the profile holds (owner,
// 24 Oct 2026). PURE — no server-only, no DB, no react-pdf — so the preview,
// the PDF and scripts/test-cv.ts all read the same functions. Every rule here
// changes only how a value is SHOWN; nothing stored is ever rewritten.

import { normalisePkMobile, formatPkMobile } from '@/lib/phone'
import { experienceLabel } from '@/lib/experienceLabel'
import { levelLabel } from '@/lib/display'

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------- phone ----

/** A phone number the Pakistani way: "0321 1234567", never "92…". A value that
 *  is not a Pakistani mobile (a landline) is shown as typed, tidied. */
export function cvPhone(raw: string | null | undefined): string | null {
  const v = squash(raw ?? '')
  if (!v) return null
  const msisdn = normalisePkMobile(v)
  if (msisdn) return formatPkMobile(msisdn)
  return v
}

// ----------------------------------------------------------- experience ----

/** The ONE experience phrase on the CV ("5–10 years of experience"), from
 *  tutor_profiles.experience_years through the same band rule the public
 *  profile uses. Null when there is none on file. */
export function experiencePhrase(years: number | null | undefined): string | null {
  if (!years || years <= 0) return null
  const label = experienceLabel(years).en // "5–10 years", "10+ years", "7 years"
  return `${label} of experience`
}

const YEAR_RUN = /\b(?:over\s+\d+|\d+\s*[–-]\s*\d+|\d+\+?)\s+years?\b/gi
const EXPERIENCE_WORDS = /\b(experience|experienced|teaching|classroom|taught)\b/i

/**
 * The About text with its experience figure made to agree with the Teaching
 * line. The composed bio says "5–10 years"; a tutor who later changed their
 * band would otherwise read two figures on one page. Only a year figure in a
 * sentence about experience is replaced; any other number is left alone.
 */
export function alignExperience(text: string, years: number | null | undefined): string {
  if (!years || years <= 0) return text
  const label = experienceLabel(years).en // "5–10 years"
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => (EXPERIENCE_WORDS.test(sentence) ? sentence.replace(YEAR_RUN, label) : sentence))
    .join(' ')
}

// ---------------------------------------------------------------- CNIC ----

const CNIC = /\b\d{5}[-\s]?\d{7}[-\s]?\d\b/g

/** Never a CNIC number on a CV: any 5-7-1 digit run in free text is removed. */
export function withoutCnic(text: string): string {
  return squash(text.replace(CNIC, ''))
}

// ----------------------------------------------------------- Title Case ----

// Written the way they are written, whatever case the tutor typed them in.
const KEEP: Record<string, string> = {
  bs: 'BS', bsc: 'BSc', ba: 'BA', ma: 'MA', ms: 'MS', msc: 'MSc', mba: 'MBA', bba: 'BBA',
  'm.phil': 'M.Phil', mphil: 'M.Phil', 'm.phil.': 'M.Phil', phd: 'PhD', 'ph.d': 'PhD', 'ph.d.': 'PhD',
  fsc: 'FSc', 'f.sc': 'FSc', fa: 'FA', 'f.a': 'FA', ics: 'ICS', ict: 'ICT', cs: 'CS', it: 'IT',
  bcom: 'BCom', 'b.com': 'BCom', mcom: 'MCom', 'm.com': 'MCom', bed: 'BEd', 'b.ed': 'BEd', med: 'MEd', 'm.ed': 'MEd',
  llb: 'LLB', mbbs: 'MBBS', bds: 'BDS', bsed: 'BSEd', adp: 'ADP', igcse: 'IGCSE', gcse: 'GCSE',
  'o/a': 'O/A', 'a/o': 'A/O', ib: 'IB', uk: 'UK', usa: 'USA',
  // Universities and boards often written as acronyms.
  lums: 'LUMS', nust: 'NUST', uet: 'UET', fast: 'FAST', gcu: 'GCU', pu: 'PU', uol: 'UOL', comsats: 'COMSATS',
  iba: 'IBA', ucp: 'UCP', umt: 'UMT', ku: 'KU', aiou: 'AIOU', bzu: 'BZU', qau: 'QAU', iiui: 'IIUI', ned: 'NED',
  giki: 'GIKI', szabist: 'SZABIST', bise: 'BISE', fbise: 'FBISE', cie: 'CIE', aku: 'AKU', gc: 'GC',
  ii: 'II', iii: 'III', iv: 'IV',
}
const SMALL = new Set(['of', 'and', 'in', 'the', 'for', 'at', 'from', 'with', 'on', 'to', 'a', 'an', 'or'])

function caseWord(word: string, first: boolean): string {
  // Keep surrounding punctuation ("(LUMS)", "Science,").
  const m = word.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9.]*)$/)
  if (!m) return word
  const [, lead, core, trail] = m
  if (!core) return word
  const key = core.toLowerCase()
  if (KEEP[key]) return lead + KEEP[key] + trail
  if (!first && SMALL.has(key)) return lead + key + trail
  if (/^\d/.test(core)) return lead + core.toLowerCase() + trail
  // Hyphenated parts each capitalised ("Pre-Medical").
  const cased = core
    .toLowerCase()
    .split('-')
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join('-')
  return lead + cased + trail
}

/**
 * A degree or institution typed in ALL CAPITALS, in Title Case: "BS COMPUTER
 * SCIENCE — UNIVERSITY OF LAHORE" → "BS Computer Science — University of
 * Lahore". Known abbreviations keep their own form. Text that already has
 * lower-case letters is the tutor's own casing and is left exactly as it is.
 */
export function displayCase(text: string): string {
  const v = text.trim()
  if (!/[A-Z]/.test(v) || /[a-z]/.test(v)) return v
  const words = v.split(/(\s+)/)
  let first = true
  return words
    .map((w) => {
      if (/^\s+$/.test(w)) return w
      if (/^[—–\-:,|·/]+$/.test(w)) {
        first = true
        return w
      }
      const out = caseWord(w, first)
      first = /[—–:(]$/.test(w)
      return out
    })
    .join('')
    // "O LEVELS" / "A LEVELS" — the letter is a level name, not the article.
    .replace(/\b([oa])\s+(levels?)\b/gi, (_m, l: string, w: string) => `${l.toUpperCase()} ${w[0].toUpperCase()}${w.slice(1).toLowerCase()}`)
}

// ------------------------------------------------------- whole-word cut ----

/** Cut at a whole word to at most `max` characters, with an ellipsis. */
export function cutAtWord(text: string, max: number): string {
  const v = squash(text)
  if (v.length <= max) return v
  const slice = v.slice(0, max - 1)
  const at = slice.lastIndexOf(' ')
  return `${(at > max * 0.5 ? slice.slice(0, at) : slice).replace(/[\s,;:·—–-]+$/, '')}…`
}

// --------------------------------------------------------- subject grid ----

export type CvSubjectGroup = { level: string; subjects: string[] }
export type CvGridCell = { label: string; subjects: string[] }

type ParsedLevel = { from: number; to: number; stream: string } | null

/** "Grade 9 - Science" → 9–9 Science; "Grade 9 & 10 - Arts" → 9–10 Arts. */
function parseGradeLevel(name: string): ParsedLevel {
  const m = squash(name).match(/^Grades?\s+(\d+)(?:\s*(?:&|and|to|–)\s*(\d+))?(?:\s*[-–]\s*(.+))?$/i)
  if (!m) return null
  const from = parseInt(m[1], 10)
  const to = m[2] ? parseInt(m[2], 10) : from
  return { from, to, stream: m[3] ? squash(m[3]) : '' }
}

/** A non-grade level, tidied for print: "FA ( Part I & Part II)" → "FA (Part I & Part II)". */
export function tidyLevel(name: string): string {
  return squash(levelLabel(name).replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s*-\s*/g, ' - '))
}

/** Where a level sits in school order, so the grid reads youngest first. */
function levelRank(name: string): number {
  const g = parseGradeLevel(name)
  if (g) return g.from
  const n = name.toLowerCase()
  if (/play|nursery|kg|prep|pre\s*-?\s*primary/.test(n)) return 0
  if (/igcse/.test(n)) return 10.5
  if (/\bo\s*levels?\b/.test(n)) return 10.6
  if (/fsc|\bfa\b|ics|i\.?\s?com|part i/.test(n)) return 11.5
  if (/as\s*&|a\s*levels?/.test(n)) return 12
  if (/\bib\b|pyp|myp|diploma/.test(n)) return 13
  if (/adp|bs\b|semester|university/.test(n)) return 20
  if (/ms\b|mphil/.test(n)) return 21
  return 30
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

/**
 * Subjects as a grid grouped by level and stream (owner, 24 Oct 2026):
 * "Grade 9–10 · Science: Computer Science, ICT". Neighbouring grades of the
 * same stream with the same subjects merge into one range. Youngest first.
 */
export function subjectGrid(groups: CvSubjectGroup[]): CvGridCell[] {
  type Item = { rank: number; order: number; parsed: ParsedLevel; label: string; subjects: string[] }
  const items: Item[] = groups
    .filter((g) => squash(g.level) || g.subjects.length > 0)
    .map((g, order) => {
      const parsed = parseGradeLevel(g.level)
      return {
        rank: levelRank(g.level),
        order,
        parsed,
        label: parsed ? '' : tidyLevel(g.level),
        subjects: [...new Set(g.subjects.map(squash).filter(Boolean))],
      }
    })
    .sort((a, b) => a.rank - b.rank || a.order - b.order)

  type Ranked = CvGridCell & { rank: number; order: number }
  const cells: Ranked[] = []

  // Grades: per stream, neighbouring grades with the same subjects merge into
  // one range ("Grade 9 - Science" + "Grade 10 - Science" → "Grade 9–10 · Science"),
  // even when another stream's grades sit between them in the list.
  const streams = new Map<string, Item[]>()
  for (const it of items) if (it.parsed) streams.set(it.parsed.stream, [...(streams.get(it.parsed.stream) ?? []), it])
  for (const [stream, list] of streams) {
    let run: { from: number; to: number; subjects: string[]; order: number } | null = null
    const flush = () => {
      if (!run) return
      const range = run.from === run.to ? `Grade ${run.from}` : `Grade ${run.from}–${run.to}`
      cells.push({ label: stream ? `${range} · ${stream}` : range, subjects: run.subjects, rank: run.from, order: run.order })
      run = null
    }
    for (const it of [...list].sort((a, b) => a.parsed!.from - b.parsed!.from)) {
      const p = it.parsed!
      if (run && p.from <= run.to + 1 && sameSet(run.subjects, it.subjects)) {
        run.to = Math.max(run.to, p.to)
        continue
      }
      flush()
      run = { from: p.from, to: p.to, subjects: it.subjects, order: it.order }
    }
    flush()
  }

  // Everything else keeps its own label; the same label twice is one cell.
  for (const it of items) {
    if (it.parsed) continue
    const same = cells.find((c) => c.label === it.label)
    if (same) same.subjects = [...new Set([...same.subjects, ...it.subjects])]
    else cells.push({ label: it.label, subjects: it.subjects, rank: it.rank, order: it.order })
  }

  return cells
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'en', { numeric: true }))
    .map(({ label, subjects }) => ({ label, subjects }))
}

export type FittedGrid = { cells: CvGridCell[]; more: number }

/**
 * The grid cut to what fits the page: at most `maxCells` cells and at most
 * `maxPerCell` subjects in a cell. `more` is how many of the tutor's distinct
 * subjects then appear nowhere on the CV — the "+N more on my profile" line.
 */
export function fitGrid(cells: CvGridCell[], maxCells: number, maxPerCell: number): FittedGrid {
  const all = new Set(cells.flatMap((c) => c.subjects.map((s) => s.toLowerCase())))
  const kept = cells.slice(0, maxCells).map((c) => ({ label: c.label, subjects: c.subjects.slice(0, maxPerCell) }))
  const shown = new Set(kept.flatMap((c) => c.subjects.map((s) => s.toLowerCase())))
  const hiddenCells = cells.length - kept.length
  let more = 0
  for (const s of all) if (!shown.has(s)) more++
  // A dropped cell that only held subjects shown elsewhere still counts as one
  // more thing on the profile, so the line never claims nothing is missing.
  if (more === 0 && hiddenCells > 0) more = hiddenCells
  return { cells: kept, more }
}

export function moreLine(more: number): string | null {
  return more > 0 ? `+${more} more on my profile` : null
}

// --------------------------------------------------------------- title ----

/** "<short subject summary> tutor · <City>", at most `max` characters, cut at a
 *  whole word (owner, 24 Oct 2026). */
export function cvTitleLine(subjects: string[], city: string | null, max = 64): string {
  const distinct: string[] = []
  for (const s of subjects.map(squash).filter(Boolean)) if (!distinct.some((d) => d.toLowerCase() === s.toLowerCase())) distinct.push(s)
  const where = city && squash(city) ? ` · ${squash(city)}` : ''
  const summaries: string[] = []
  if (distinct.length >= 3) summaries.push(`${distinct[0]}, ${distinct[1]} & more`)
  if (distinct.length === 2) summaries.push(`${distinct[0]} & ${distinct[1]}`)
  if (distinct.length >= 2) summaries.push(`${distinct[0]} & more`)
  if (distinct.length >= 1) summaries.push(distinct[0])
  for (const s of summaries) {
    const line = `${s} tutor${where}`
    if (line.length <= max) return line
  }
  if (distinct.length > 0) {
    const room = Math.max(8, max - ` tutor${where}`.length)
    return `${cutAtWord(distinct[0], room).replace(/…$/, '')} tutor${where}`
  }
  return `Tutor${where}`
}
