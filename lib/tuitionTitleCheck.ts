// lib/tuitionTitleCheck.ts
//
// PURE. The title check on the STAFF Post a tuition form (owner, 16 Oct 2026).
// Warnings only — staff fix them with one tap or post anyway:
//   school_spelling  a misspelt known school ("Beconhouse Schoolo" → Beaconhouse School)
//   school_junk      words in the school slot that are not a school's name
//                    ("home tuition in", "Academy" on its own)
//   trailing_comma   a stray comma at the end of a title part ("Gulshan, | Karachi")
//   level_mismatch   the post type does not fit the level ("O Levels Teacher" with "FSC Part I")
// The fixes change the form's own fields, so "Write this for me" builds the
// title from the corrected values. Tested in scripts/test-title-check.ts.

import { matchSchool } from '@/lib/schoolSearchCore'
import type { KnownSchool } from '@/lib/schoolJobsCore'

export type TitleWarning = {
  kind: 'school_spelling' | 'school_junk' | 'trailing_comma' | 'level_mismatch'
  message: string
  /** The one-tap fix, when there is one. */
  fix?: { field: 'school' | 'title'; value: string; label: string }
}

const norm = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Words that never make a school's name on their own. */
const JUNK = /^(?:home\s+)?(?:tuition|tuitions|tutor|tutors|teacher|teachers|required|needed|urgent|online|home|in|at|for|near|the)(?:\s+(?:in|at|for|near|the|required|needed))*$/
/** A bare institution word with no name. */
const BARE_INSTITUTION = /^(?:academy|school|college|institute|campus|coaching|centre|center)s?$/

/** Is this text junk in the school slot? */
export function schoolSlotJunk(school: string | null | undefined): boolean {
  const n = norm(school)
  if (!n) return false
  if (JUNK.test(n) || BARE_INSTITUTION.test(n)) return true
  // "home tuition in", "tuition at" — tuition words with only joining words.
  return /\b(?:home tuition|tuition)\b/.test(n) && n.replace(/\b(?:home|tuition|tuitions|in|at|for|near|the)\b/g, '').trim() === ''
}

// ---- post type vs level ----------------------------------------------------

type Group = 'early' | 'primary' | 'middle' | 'high' | 'o' | 'a' | 'ib' | 'college'

function groupsOfLevel(level: string): Group[] {
  const l = level.toLowerCase()
  const out = new Set<Group>()
  if (/play ?group|nursery|\bkg\b|\bprep\b|montessori|pre[- ]?primary|pre[- ]?school/.test(l)) out.add('early')
  if (/\bo[\s-]*levels?\b|igcse/.test(l)) out.add('o')
  if (/\ba[\s-]*levels?\b|\bas[\s&]+a\b|\bas level/.test(l)) out.add('a')
  if (/\bib\b|\bpyp\b|\bmyp\b/.test(l)) out.add('ib')
  if (/\bf\.?\s?sc\b|\bfa\b|\bics\b|\bi\.?\s?com\b|intermediate|\bbs\b|semester|university|\bpart i\b/.test(l)) out.add('college')
  if (/matric/.test(l)) out.add('high')
  for (const m of l.matchAll(/grade\s*(\d{1,2})/g)) {
    const g = Number(m[1])
    if (g >= 1 && g <= 5) out.add('primary')
    else if (g >= 6 && g <= 8) out.add('middle')
    else if (g >= 9 && g <= 12) out.add('high')
  }
  return [...out]
}

/** Post types that name a level, and the levels they fit. Others are not checked. */
const FITS: Record<string, Group[]> = {
  'Early Years Teacher': ['early'],
  'Primary Teacher': ['primary', 'early'],
  'Middle School Teacher': ['middle'],
  'High School Teacher': ['high', 'o'],
  'O Levels Teacher': ['o'],
  'A Levels Teacher': ['a'],
  'IB PYP Teacher': ['ib'],
  'IB MYP Teacher': ['ib'],
  'IB Diploma Teacher': ['ib'],
  'College Lecturer': ['college', 'a'],
}

export function levelMismatch(jobType: string | null | undefined, levels: (string | null | undefined)[]): string | null {
  const fits = FITS[(jobType ?? '').trim()]
  const ls = levels.map((l) => (l ?? '').trim()).filter(Boolean)
  if (!fits || ls.length === 0) return null
  const known = ls.filter((l) => groupsOfLevel(l).length > 0)
  if (known.length === 0) return null
  const ok = known.some((l) => groupsOfLevel(l).some((g) => fits.includes(g)))
  return ok ? null : known[0]
}

// ---- the check ---------------------------------------------------------------

/** The title with stray commas at the ends of its parts removed. */
export function withoutTrailingCommas(title: string): string {
  return title
    .split('|')
    .map((p) => p.replace(/^[\s,]+|[\s,]+$/g, '').trim())
    .filter(Boolean)
    .join(' | ')
}

export function checkTuitionTitle(input: {
  title: string | null | undefined
  school: string | null | undefined
  jobType: string | null | undefined
  levels: (string | null | undefined)[]
  known: KnownSchool[]
}): TitleWarning[] {
  const out: TitleWarning[] = []
  const school = (input.school ?? '').trim()
  const title = (input.title ?? '').trim()

  // 1. The school slot: junk first, then a misspelt known school.
  if (school && schoolSlotJunk(school)) {
    out.push({
      kind: 'school_junk',
      message: `"${school}" is not a school's name. Leave the school empty for a home tuition.`,
      fix: { field: 'school', value: '', label: 'Clear the school' },
    })
  } else {
    // The school field, else the title's third part (where the school goes).
    const parts = title.split('|').map((p) => p.trim())
    const candidate = school || parts[2] || ''
    const hit = candidate ? matchSchool(candidate, input.known) : null
    if (hit && hit.fuzzy) {
      out.push({
        kind: 'school_spelling',
        message: `"${candidate}" looks like ${hit.name}.`,
        fix: school
          ? { field: 'school', value: hit.name, label: `Use ${hit.name}` }
          : { field: 'title', value: parts.map((p, i) => (i === 2 ? hit.name : p)).join(' | '), label: `Use ${hit.name}` },
      })
    }
    if (!school && parts[2] && schoolSlotJunk(parts[2])) {
      out.push({ kind: 'school_junk', message: `"${parts[2]}" in the title is not a school's or area's name.` })
    }
  }

  // 2. Stray commas.
  if (title && withoutTrailingCommas(title) !== title.replace(/\s*\|\s*/g, ' | ').trim()) {
    out.push({
      kind: 'trailing_comma',
      message: 'The title has a stray comma at the end of a part.',
      fix: { field: 'title', value: withoutTrailingCommas(title), label: 'Remove the comma' },
    })
  }

  // 3. Post type vs level.
  const bad = levelMismatch(input.jobType, input.levels)
  if (bad) {
    out.push({
      kind: 'level_mismatch',
      message: `"${input.jobType}" does not fit the level "${bad}". Check the post type or the level.`,
    })
  }
  return out
}
