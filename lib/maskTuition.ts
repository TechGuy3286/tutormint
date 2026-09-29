// lib/maskTuition.ts
//
// Masking phone numbers and email addresses written INSIDE a tuition's title or
// description (PR91 Part A). A parent sometimes types a number into the free
// text to skip the platform; on every non-staff surface (browse cards, the
// tuition page, "More" strips, dashboard lists, My applications, search
// snippets, page <title>/meta, OG text, JobPosting JSON-LD) that number is
// masked. A tutor spends one pool unit ("View number") to see it — the same
// gate as the contact field. Admin/staff surfaces render the full text.
//
// The masked forms (owner):
//   * a phone keeps its first 4 digits, then dots: "0313-•••••••"
//   * an email becomes "•••••@•••••"
//
// PHONE DETECTION IS SHARED with the message masker (lib/masking.ts
// findPhoneSpans), so both catch exactly the same numbers and a fee range
// ("15000-20000"), a price list or a run of years is never masked. Only the
// REPLACEMENT differs — a partial mask here, a full mask there.
//
// PURE — no imports beyond the shared span finder — so the render surfaces, the
// data layer and the tests share one function.

import { findPhoneSpans, MASK } from '@/lib/masking'
import { formatPkMobile } from '@/lib/phone'

/** An email address. Deliberately conservative: a local part, @, a dotted
 *  domain with a 2+ letter TLD. Matches the address, not a stray "@handle". */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

const EMAIL_MASK = '•••••@•••••'

/** The masked email teaser shown on the always-visible "Contact:" line (PR92). */
export const EMAIL_TEASER = EMAIL_MASK

export type TuitionMask = {
  /** The masked text. Equal to the input when nothing matched. */
  text: string
  /** True when at least one phone or email was hidden. */
  masked: boolean
}

/** Keep the first 4 digits of a phone run (and the separators around them),
 *  then a dotted mask for the rest: "0313-0042960" → "0313-•••••••". */
function maskPhoneRun(run: string): string {
  let digits = 0
  let i = 0
  let head = ''
  for (; i < run.length; i++) {
    head += run[i]
    if (/\d/.test(run[i])) {
      digits++
      if (digits === 4) {
        i++
        break
      }
    }
  }
  if (digits < 4) return MASK // too few digits to keep a prefix — mask whole
  // Keep the separators that lead the rest (e.g. the "-"), drop its digits.
  const restSeparators = run.slice(i).replace(/\d/g, '')
  return head + restSeparators + MASK
}

/**
 * The masked phone teaser for the always-visible "Contact:" line (PR92): the
 * first 4 digits then dots. `fromMsisdn` formats a canonical 92… number to its
 * local 0… shape first (job_contacts / a parent's verified number); a raw text
 * run is masked as written (keeping its "-"). Returns null if there is nothing
 * to show.
 */
export function phoneTeaser(input: string | null | undefined, fromMsisdn = false): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  const run = fromMsisdn ? formatPkMobile(raw) : raw
  const masked = maskPhoneRun(run)
  return masked || null
}

/**
 * Mask every phone and email inside a tuition's free text. Emails are masked
 * first (their local part can contain digits that would otherwise confuse the
 * phone scan), then phones on what remains, by position so offsets stay valid.
 */
export function maskTuitionText(input: string | null | undefined): TuitionMask {
  const text = input ?? ''
  if (!text) return { text, masked: false }

  // 1. Emails → build spans and replacements.
  type Rep = { start: number; end: number; with: string }
  const reps: Rep[] = []
  EMAIL.lastIndex = 0
  let e: RegExpExecArray | null
  while ((e = EMAIL.exec(text)) !== null) {
    reps.push({ start: e.index, end: e.index + e[0].length, with: EMAIL_MASK })
    if (e.index === EMAIL.lastIndex) EMAIL.lastIndex++
  }

  // 2. Phones — but not inside an email span already replaced (an email's digits
  //    are gone conceptually). Skip a phone span that overlaps an email span.
  const emailSpans = reps.map((r) => ({ start: r.start, end: r.end }))
  const overlapsEmail = (s: { start: number; end: number }) =>
    emailSpans.some((es) => s.start < es.end && es.start < s.end)

  for (const s of findPhoneSpans(text)) {
    if (overlapsEmail(s)) continue
    reps.push({ start: s.start, end: s.end, with: maskPhoneRun(text.slice(s.start, s.end)) })
  }

  if (reps.length === 0) return { text, masked: false }

  reps.sort((a, b) => a.start - b.start)

  let out = ''
  let cursor = 0
  for (const r of reps) {
    if (r.start < cursor) continue // defensive: skip any overlap
    out += text.slice(cursor, r.start) + r.with
    cursor = r.end
  }
  out += text.slice(cursor)

  return { text: out, masked: true }
}

/**
 * Pull the phone numbers and emails OUT of a tuition's free text, for a reveal
 * (PR91 Part B.2): "View number" shows the numbers in the text as well as the
 * contact field. Runs the same detection as the mask, so a fee range is never
 * mistaken for a number. Phones are returned as their raw run (the caller
 * normalises); emails as written. De-duplicated, order preserved.
 */
export function extractTuitionContacts(...texts: (string | null | undefined)[]): {
  phones: string[]
  emails: string[]
} {
  const phones: string[] = []
  const emails: string[] = []
  for (const t of texts) {
    const text = t ?? ''
    if (!text) continue
    EMAIL.lastIndex = 0
    let e: RegExpExecArray | null
    const emailSpans: { start: number; end: number }[] = []
    while ((e = EMAIL.exec(text)) !== null) {
      emailSpans.push({ start: e.index, end: e.index + e[0].length })
      if (!emails.includes(e[0])) emails.push(e[0])
      if (e.index === EMAIL.lastIndex) EMAIL.lastIndex++
    }
    for (const s of findPhoneSpans(text)) {
      if (emailSpans.some((es) => s.start < es.end && es.start < s.end)) continue
      const run = text.slice(s.start, s.end)
      if (!phones.includes(run)) phones.push(run)
    }
  }
  return { phones, emails }
}
