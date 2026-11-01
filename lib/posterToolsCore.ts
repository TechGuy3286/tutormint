// lib/posterToolsCore.ts
//
// PURE, client-safe. The poster's own controls on a tuition page — "Move to
// top" (refresh) and "Keep it open" (fresh live days) — and their wording
// (owner, 2 Nov 2026). They show ONLY to the tuition's poster: the parent who
// posted it, or staff/owner when it is a team-posted tuition. Never to a
// tutor, a visitor, another parent, or staff on a parent's own tuition.

export const REFRESH_BOX_TEXT =
  'Move your tuition back to the top so more tutors see it. You can do this once every 3 days.'
export const MOVE_TO_TOP_LABEL = 'Move to top'
export const KEEP_OPEN_LABEL = 'Keep it open'

export type PosterViewer = { isPoster: boolean; isAdmin: boolean; isTutor?: boolean }

/** Who sees Move to top / Keep it open / Resume. */
export function posterToolsVisible(v: PosterViewer | null | undefined, teamPost: boolean): boolean {
  if (!v) return false
  if (v.isPoster) return true
  return v.isAdmin && teamPost
}

/** "Your tuition will be hidden in <n> days. Tap 'Keep it open' …" */
export function keepOpenNotice(daysLeft: number): string {
  const n = Math.max(0, Math.floor(daysLeft))
  const when = n < 1 ? 'today' : `in ${n} day${n === 1 ? '' : 's'}`
  return `Your tuition will be hidden ${when}. Tap '${KEEP_OPEN_LABEL}' to show it for longer.`
}

/** Pakistan-time date like "5 Nov 2026". */
export function pkDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })
}

/** The line under a greyed "Move to top". */
export function nextMoveLine(nextAtMs: number): string {
  return `You can move it to the top again on ${pkDate(nextAtMs)}`
}

/** The line under a greyed "Keep it open". */
export function nextKeepOpenLine(nextAtMs: number): string {
  return `You can keep it open for longer again on ${pkDate(nextAtMs)}`
}

/** What the Move to top (or Keep it open) button looks like right now. */
export function moveToTopState(nextAtMs: number | null, now = Date.now(), keepOpen = false): { enabled: boolean; note: string | null } {
  if (nextAtMs == null || nextAtMs <= now) return { enabled: true, note: null }
  return { enabled: false, note: keepOpen ? nextKeepOpenLine(nextAtMs) : nextMoveLine(nextAtMs) }
}
