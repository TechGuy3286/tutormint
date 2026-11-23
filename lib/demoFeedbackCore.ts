// PURE (scripts/test-pr17.ts). Demo feedback (PR-17 Part B + D.4, owner 23 Nov 2026).
//
//   * The parent leaves feedback ONCE per completed demo (the database keeps
//     one row per demo); afterwards they see their stars + comment with Edit,
//     and an edit updates the same row — never a second one.
//   * The STARS count in the tutor's rating at once (each demo once).
//   * The written COMMENT is public only after the Owner approves it
//     (Trust → Reviews); an edited comment waits for approval again.

export const DEMO_FEEDBACK_MIN_CHARS = 5
export const DEMO_FEEDBACK_MAX_CHARS = 2000

/** "★★★★☆" for 4. */
export function starLine(rating: number): string {
  const n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)))
  return '★'.repeat(n) + '☆'.repeat(5 - n)
}

/** The parent's own summary line: "You rated ★★★★☆". */
export function youRatedLine(rating: number): string {
  return `You rated ${starLine(rating)}`
}

/** The tutor's notification (F.2): the stars, tappable to their profile's reviews. */
export function feedbackNotice(rating: number, slug: string | null): { title: string; body: string; href: string } {
  return {
    title: 'You received demo feedback',
    body: `${starLine(rating)} ${rating} out of 5`,
    href: slug ? `/tutor/${slug}#reviews` : '/tutor/dashboard/demos',
  }
}

/** What "Mark completed" tells the OTHER side (F.1): a tutor is never told
 *  "Feedback can now be left" — that prompt is the parent's. */
export function demoCompletedNotice(recipient: 'tutor' | 'parent'): { title: string; body: string; href: string } {
  return recipient === 'tutor'
    ? { title: 'Demo completed', body: 'The parent marked your demo lesson as completed.', href: '/tutor/dashboard/demos' }
    : { title: 'A demo was marked as completed', body: 'Feedback can now be left.', href: '/parent/dashboard/demos' }
}

export type FeedbackInput = { rating: unknown; text: unknown }

/** The problem with a rating + comment, or null. */
export function feedbackProblem(i: FeedbackInput): string | null {
  const r = Number(i.rating)
  if (!Number.isInteger(r) || r < 1 || r > 5) return 'Give a rating from 1 to 5.'
  const t = typeof i.text === 'string' ? i.text.trim() : ''
  if (t.length < DEMO_FEEDBACK_MIN_CHARS) return 'Write a sentence about how it went.'
  if (t.length > DEMO_FEEDBACK_MAX_CHARS) return 'Keep your feedback under 2000 characters.'
  return null
}

/** Create (no row yet) or update (the parent's own row) — never a duplicate. */
export function feedbackWrite(existing: { id: string; parentId: string } | null, parentId: string): { kind: 'create' } | { kind: 'update'; id: string } | { kind: 'refuse' } {
  if (!existing) return { kind: 'create' }
  if (existing.parentId !== parentId) return { kind: 'refuse' }
  return { kind: 'update', id: existing.id }
}

export type SortableDemo = {
  status: 'requested' | 'accepted' | 'declined' | 'completed' | 'cancelled'
  proposedTime: string | null
  createdAt: string
}

const GROUP: Record<SortableDemo['status'], number> = { accepted: 0, requested: 1, completed: 2, declined: 3, cancelled: 3 }

/** The parent's "My demos" order (D.3): Accepted — upcoming first, nearest
 *  date first, then accepted ones whose time has passed or has no time —
 *  → Pending → Completed → Declined / Cancelled (shown grey, at the bottom).
 *  Within the other groups, newest first. */
export function sortParentDemos<T extends SortableDemo>(demos: readonly T[], nowMs: number): T[] {
  const t = (s: string | null) => (s ? Date.parse(s) : NaN)
  return [...demos].sort((a, b) => {
    const g = GROUP[a.status] - GROUP[b.status]
    if (g !== 0) return g
    if (a.status === 'accepted') {
      const ta = t(a.proposedTime)
      const tb = t(b.proposedTime)
      const ua = Number.isFinite(ta) && ta >= nowMs
      const ub = Number.isFinite(tb) && tb >= nowMs
      if (ua !== ub) return ua ? -1 : 1
      if (ua && ub) return ta - tb
      if (Number.isFinite(ta) !== Number.isFinite(tb)) return Number.isFinite(ta) ? -1 : 1
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta
    }
    return b.createdAt.localeCompare(a.createdAt)
  })
}

/** Declined and cancelled demos are drawn grey. */
export function demoIsClosed(status: SortableDemo['status']): boolean {
  return status === 'declined' || status === 'cancelled'
}
