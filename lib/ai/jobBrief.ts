// lib/ai/jobBrief.ts
//
// Turning a set of SELECTIONS into a job title and description.
//
// The parent picks: level, grade, subjects, city, area, mode, budget band,
// days and times. They write nothing. Two things can then produce the words:
//
//   composeJobCopy()   deterministic, always available, no network. This is
//                      the fallback AND the yardstick. Here.
//   generateJobCopy()  Claude, warmer and more natural, checked against the
//                      selections before it is returned. In lib/ai/jobCopy.ts.
//
// EVERYTHING IN THIS FILE IS PURE, and that is why it is its own file:
// jobCopy.ts reaches the Anthropic API through a module that imports
// 'server-only', which by design refuses to load anywhere but a server
// component -- including in a test runner. The composer and the verifier are
// the two parts most worth testing, so they are kept on this side of that
// line. Same reasoning as lib/feedGrouping.ts.
//
// THE RULE THAT SHAPES ALL OF IT: nothing may appear in the text that the
// parent did not select. A generated post is published under their name on a
// public board; a sentence saying "she is currently getting a C and needs to
// reach an A" is a claim about a real child that nobody made. So the prompt
// forbids invention, AND the output is verified against the selection set
// afterwards -- because an instruction in a prompt is a request, not a
// guarantee, and the verifier is the part that holds when the model is having
// an imaginative day.
//
// What the verifier can and cannot do is stated at `unsupportedFacts()`.

import { teachingMode } from '@/lib/display'
import { feeChipLabel } from '@/lib/feeBands'

export type JobSelection = {
  /** Taxonomy level name, e.g. "O Levels". Resolved server-side from ids. */
  level: string | null
  /** Subject names, resolved server-side from taxonomy_master ids. */
  subjects: string[]
  city: string | null
  area: string | null
  /** Canonical: 'in_person' | 'online' | 'both'. */
  mode: string | null
  budgetMin: number | null
  budgetMax: number | null
  /** Days and times, as picked from the schedule chips. */
  schedule: string | null
}

export type JobCopy = {
  title: string
  description: string
  /** 'claude' when the model wrote it, 'composed' when this file did. */
  source: 'claude' | 'composed'
  /** Set when a generation was attempted and did not produce usable text. */
  note?: string
}

export const MIN_WORDS = 60
export const MAX_WORDS = 100

// ---------------------------------------------------------------- pieces ---

function subjectPhrase(subjects: string[]): string {
  const s = subjects.filter(Boolean)
  if (s.length === 0) return ''
  if (s.length === 1) return s[0]
  if (s.length === 2) return `${s[0]} and ${s[1]}`
  return `${s.slice(0, -1).join(', ')} and ${s[s.length - 1]}`
}

export function placePhrase(sel: JobSelection): string {
  if (sel.area && sel.city) return `${sel.area}, ${sel.city}`
  return sel.area || sel.city || ''
}

export function budgetPhrase(sel: JobSelection): string {
  if (sel.budgetMin === null && sel.budgetMax === null) return ''
  return feeChipLabel(
    sel.budgetMin === null ? '' : String(sel.budgetMin),
    sel.budgetMax === null ? '' : String(sel.budgetMax),
  )
}

export function modePhrase(sel: JobSelection): string {
  const m = teachingMode(sel.mode)
  if (!m) return ''
  if (m === 'Online') return 'online'
  if (m === 'In person') return 'in person'
  return 'either in person or online'
}

// ------------------------------------------------------------- composed ----

/**
 * The plain version, built from the selections and nothing else.
 *
 * This is what a parent gets when there is no API key, when the call fails,
 * and when the generated text does not survive the verifier. It is meant to be
 * unremarkable and correct, not good -- a parent can edit it, and an
 * unremarkable post that is true beats an absent one every time.
 */
export function composeJobCopy(sel: JobSelection): JobCopy {
  const subject = subjectPhrase(sel.subjects)
  const place = placePhrase(sel)
  const mode = modePhrase(sel)
  const budget = budgetPhrase(sel)

  const titleBits = [subject || sel.level, sel.level && subject ? `(${sel.level})` : '', 'tutor needed']
    .filter(Boolean)
    .join(' ')
  const title = place ? `${titleBits} in ${place}` : titleBits

  const lines: string[] = []
  lines.push(
    subject
      ? `We are looking for a tutor for ${subject}${sel.level ? ` at ${sel.level}` : ''}.`
      : `We are looking for a tutor${sel.level ? ` for ${sel.level}` : ''}.`,
  )
  if (place) lines.push(`We are in ${place}.`)
  if (mode) lines.push(`Lessons can be ${mode}.`)
  if (sel.schedule) lines.push(`We are hoping for ${sel.schedule}.`)
  // Not lowercased: the band label carries "Rs", and "our budget is rs 10,000"
  // reads like a typo in the one sentence about money.
  if (budget) lines.push(`Our monthly budget is ${budget.replace(/^Under /, 'under ').replace(/^Over /, 'over ')}.`)
  lines.push('Please get in touch if this suits you and tell us about your experience.')

  return { title, description: lines.join(' '), source: 'composed' }
}

// -------------------------------------------------------------- verifier ---

/**
 * Facts in the text that the parent did not select.
 *
 * WHAT IT CATCHES, and it is deliberately narrow: NUMBERS. Almost every way
 * this could embarrass a parent is numeric -- an exam grade, a percentage, a
 * fee, a number of days or hours, a child's age, a year. Those are the claims
 * that read as specific and checkable, and they are the ones a reader will
 * believe. A number that appears in the output and in none of the selections
 * was invented, and that is a decidable question rather than a judgement call.
 *
 * WHAT IT DOES NOT CATCH: invented prose. "She is a bright girl who has always
 * enjoyed the subject" is unsupported and this will not see it. That is the
 * accepted limit -- the prompt argues against it, the 60-100 word ceiling
 * leaves little room for it, and the parent reads and edits everything before
 * it posts. The verifier exists for the class of invention that is both likely
 * and damaging, not for every possible one.
 *
 * Ordinals inside a selected name ("Grade 9 & 10", "Semester 1 - 8") are
 * supported by definition, because the selection text is searched too.
 */
export function unsupportedFacts(text: string, sel: JobSelection): string[] {
  const allowed = new Set<string>()

  // Both forms of every figure. The band label a person would write is
  // "Rs 10,000 - 20,000" while the stored bounds are 10000 and 19999, and a
  // digits-only scan of the label yields "10","000","20","000" -- which
  // matches nothing in an output that writes "20,000". Collecting the
  // comma-separated run AND its bare form is what makes the two comparable.
  const addNumbers = (s: string | null | undefined) => {
    for (const m of String(s ?? '').matchAll(/\d[\d,]*/g)) {
      allowed.add(m[0])
      allowed.add(m[0].replace(/,/g, ''))
    }
  }

  addNumbers(sel.level)
  sel.subjects.forEach(addNumbers)
  addNumbers(sel.city)
  addNumbers(sel.area)
  addNumbers(sel.schedule)
  if (sel.budgetMin !== null) {
    addNumbers(String(sel.budgetMin))
    // "Rs 10,000" and "10000" are the same figure written two ways, and the
    // model will reasonably write the readable one.
    addNumbers(sel.budgetMin.toLocaleString('en-PK'))
  }
  if (sel.budgetMax !== null) {
    addNumbers(String(sel.budgetMax))
    addNumbers(sel.budgetMax.toLocaleString('en-PK'))
  }
  // The band label is what a person would actually write: "Rs 10,000 - 20,000"
  // for a band stored as 10000/19999. Both ends of the phrasing are allowed.
  addNumbers(budgetPhrase(sel))

  const found: string[] = []
  for (const m of text.matchAll(/\d[\d,]*/g)) {
    const raw = m[0]
    const bare = raw.replace(/,/g, '')
    if (allowed.has(bare) || allowed.has(raw)) continue
    // A number written with separators is checked in both forms, since
    // "10,000" in the output and "10000" in the selection are one figure.
    if ([...allowed].some((a) => a.replace(/,/g, '') === bare)) continue
    found.push(raw)
  }
  return [...new Set(found)]
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}
