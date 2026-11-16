// lib/contentQueue/refreshCore.ts
//
// The rules that keep the suggested-title queue fresh (owner, 16 Nov 2026).
// Pure, so the tests run them on invented rows.
//
//   - A title already USED (drafted, or turned into a post) never comes back.
//   - A title STAFF DISMISSED never comes back. (A row the queue set aside by
//     itself — "auto: …" / "already covered …" — may return when chosen again.)
//     This supersedes the 5 Sep rule that a dismissed topic resurfaced when its
//     evidence changed materially.
//   - A title that is the same words as an existing post (published, scheduled
//     or draft) is never offered — no duplicate of a post.
//   - Two candidates with the same words are offered once.

export type QueueRowState = { status: string; dismiss_reason?: string | null; snooze_until?: string | null; title?: string | null }

/** A dismissal the queue made itself, not a person. */
export function isAutoDismissal(reason: unknown): boolean {
  return typeof reason === 'string' && (reason.startsWith('auto:') || reason.startsWith('already covered'))
}

/** The words of a title, for comparing: lower case, punctuation and extra spaces gone. */
export function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** May an existing queue row be offered again? */
export function rowOfferable(row: QueueRowState | undefined, now: Date): boolean {
  if (!row) return true
  if (row.status === 'drafted' || row.status === 'done') return false
  if (row.status === 'dismissed') return isAutoDismissal(row.dismiss_reason)
  if (row.status === 'snoozed') return !!row.snooze_until && new Date(row.snooze_until) <= now
  return true
}

/** Titles never to offer: every post, and every used or staff-dismissed row. */
export function blockedTitles(postTitles: readonly string[], rows: readonly QueueRowState[]): Set<string> {
  const out = new Set<string>()
  for (const t of postTitles) if (t) out.add(normTitle(t))
  for (const r of rows) {
    if (!r.title) continue
    const used = r.status === 'drafted' || r.status === 'done'
    const staffDismissed = r.status === 'dismissed' && !isAutoDismissal(r.dismiss_reason)
    if (used || staffDismissed) out.add(normTitle(r.title))
  }
  return out
}

/**
 * The candidates to offer, in their order: each one's own row must allow it,
 * its words must not be blocked, and a title already kept is not kept twice.
 */
export function refreshCandidates<C extends { fingerprint: string; title: string }>(
  candidates: readonly C[],
  rowsByFingerprint: ReadonlyMap<string, QueueRowState>,
  blocked: ReadonlySet<string>,
  now: Date,
): C[] {
  const kept: C[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    if (!rowOfferable(rowsByFingerprint.get(c.fingerprint), now)) continue
    const key = normTitle(c.title)
    if (blocked.has(key) || seen.has(key)) continue
    seen.add(key)
    kept.push(c)
  }
  return kept
}

/** The editor's line: "Queue updated 16 Nov 2026". */
export function queueUpdatedLabel(iso: string | null): string {
  if (!iso) return 'Queue not updated yet'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Queue not updated yet'
  return `Queue updated ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })}`
}

/** The app_settings key the rebuild stamps when it finishes. */
export const QUEUE_REBUILT_KEY = 'content.queue_rebuilt_at'
