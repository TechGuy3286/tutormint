// lib/blogApproval.ts
//
// Pure helpers behind the blog publishing settings (owner, 5 Oct 2026):
//   • the Pakistan-time publishing week (cadence: "Published this week: N",
//     warn at a third post in one week — warn only, never block);
//   • near-duplicate titles (differ only by city, grade or subject — warn only);
//   • the number claims an approver must check before approving (every Rs
//     amount, percentage, and "N tutors / N tuitions" claim);
//   • the "Needs review" date test.
// No imports, client-safe, unit-tested in scripts/test-blog-approval.ts.

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000 // Asia/Karachi, no DST

/** The Monday 00:00 (Pakistan time) that starts the week containing `at`, as a
 *  UTC instant, and the following Monday. */
export function pakistanWeek(at: Date): { start: Date; end: Date } {
  const shifted = new Date(at.getTime() + PKT_OFFSET_MS)
  const dow = (shifted.getUTCDay() + 6) % 7 // Monday = 0
  const startShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - dow)
  const start = new Date(startShifted - PKT_OFFSET_MS)
  return { start, end: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000) }
}

export const CADENCE_WARNING = 'Two posts a week works best for Google.'
export const CADENCE_LIMIT = 2

/** How many posts land in the week containing `at`: published_at of published
 *  posts plus publish_at of scheduled posts. */
export function postsInWeek(
  posts: { status: string; publishedAt: string | null; publishAt: string | null }[],
  at: Date,
): number {
  const { start, end } = pakistanWeek(at)
  let n = 0
  for (const p of posts) {
    const when =
      p.status === 'published' ? p.publishedAt : p.status === 'scheduled' ? p.publishAt : null
    if (!when) continue
    const t = new Date(when).getTime()
    if (t >= start.getTime() && t < end.getTime()) n += 1
  }
  return n
}

/** The warning line when a post would be the third (or later) in its week, else null. */
export function cadenceWarning(countThisWeekIncludingThis: number): string | null {
  return countThisWeekIncludingThis > CADENCE_LIMIT ? CADENCE_WARNING : null
}

/** A `datetime-local` value typed as PAKISTAN time → the UTC instant. */
export function pakistanLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim())
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi) - PKT_OFFSET_MS
  return Number.isNaN(utc) ? null : new Date(utc).toISOString()
}

/** An ISO instant → the `datetime-local` value in Pakistan time. */
export function isoToPakistanLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const d = new Date(t + PKT_OFFSET_MS)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

// ---------------------------------------------------------------- duplicates

const GRADE_WORDS =
  /\b(?:grade|grades|class|classes)\s*\d+(?:\s*(?:-|–|to|&|and)\s*\d+)?\b|\b(?:o|a|as)[-\s]?levels?\b|\bigcse\b|\bmatric(?:ulation)?\b|\bf\.?s\.?c\b|\bintermediate\b|\bkg\s*[iI1-2]*\b|\bnursery\b|\bmontessori\b/gi

/**
 * The title with its city, grade and subject words removed and the rest
 * normalised — two titles with the same "skeleton" differ only by city, grade
 * or subject. `cities` and `subjects` are the live name lists.
 */
export function titleSkeleton(title: string, cities: string[], subjects: string[]): string {
  let s = ` ${title.toLowerCase()} `
  const strip = (words: string[]) => {
    for (const w of [...words].sort((a, b) => b.length - a.length)) {
      const t = w.trim().toLowerCase()
      if (t.length < 3) continue
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      s = s.replace(new RegExp(`(?<![a-z])${esc}(?![a-z])`, 'g'), ' ')
    }
  }
  strip(cities)
  strip(subjects)
  s = s.replace(GRADE_WORDS, ' ')
  return s
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type SimilarPost = { id: string; title: string; slug: string }

/** Posts whose title differs from `title` only by city, grade or subject. */
export function similarPosts(
  title: string,
  others: SimilarPost[],
  cities: string[],
  subjects: string[],
): SimilarPost[] {
  const mine = titleSkeleton(title, cities, subjects)
  if (!mine) return []
  return others.filter((o) => titleSkeleton(o.title, cities, subjects) === mine && o.title.trim().toLowerCase() !== title.trim().toLowerCase())
}

// ---------------------------------------------------------------- numbers

export type NumberClaim = { kind: 'rupees' | 'percent' | 'count'; text: string; context: string }

const CLAIM_PATTERNS: { kind: NumberClaim['kind']; re: RegExp }[] = [
  { kind: 'rupees', re: /\b(?:rs\.?|pkr|rupees?)\s?[\d][\d,]*(?:\.\d+)?\s?(?:k|lakh|lac|crore)?\b/gi },
  { kind: 'rupees', re: /\b\d[\d,]*(?:\.\d+)?\s?(?:k\s)?rupees\b/gi },
  { kind: 'percent', re: /\b\d+(?:\.\d+)?\s?(?:%|percent|per cent)/gi },
  { kind: 'count', re: /\b\d[\d,]*\+?\s+(?:verified\s+|active\s+|open\s+|new\s+)?(?:tutors?|teachers?|tuitions?|jobs?|parents?|students?|families)\b/gi },
]

/** Every Rs amount, percentage and tutor/tuition count claim in the body, with
 *  a little context, de-duplicated by text. */
export function numberClaims(body: string): NumberClaim[] {
  const out: NumberClaim[] = []
  const seen = new Set<string>()
  for (const { kind, re } of CLAIM_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(body)) !== null) {
      const text = m[0].trim()
      const key = `${kind}:${text.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      const from = Math.max(0, m.index - 40)
      const to = Math.min(body.length, m.index + text.length + 40)
      const context = body.slice(from, to).replace(/\s+/g, ' ').trim()
      out.push({ kind, text, context: `${from > 0 ? '…' : ''}${context}${to < body.length ? '…' : ''}` })
    }
  }
  return out
}

// ---------------------------------------------------------------- review by

/** True when a post's Review-by date (YYYY-MM-DD) has passed in Pakistan time. */
export function needsReview(reviewBy: string | null | undefined, now: Date = new Date()): boolean {
  if (!reviewBy) return false
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(reviewBy)
  if (!m) return false
  const dueEnd = Date.UTC(+m[1], +m[2] - 1, +m[3] + 1) - PKT_OFFSET_MS // end of that day, PKT
  return now.getTime() >= dueEnd
}
