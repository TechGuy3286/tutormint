// lib/tuitionStatus.ts
//
// The public state of a tuition detail page, as a PURE function (PR28) — so the
// route, the metadata and the guard test all read the SAME rules and cannot
// drift. A tuition's URL never 404s because of status: the page always renders
// 200 while a job with that slug exists; only its state changes. 404 is reserved
// for a slug that does not exist.
//
// Only OPEN emits JobPosting JSON-LD. OPEN is indexable and in the sitemap, and
// so is a PAUSED tuition for 60 days after it was paused (owner, 16 Oct 2026 —
// the page keeps its ranking; it shows "no longer accepting applications" and
// similar open tuitions). After 60 days a paused page, and a closed/hired page
// always, is 200 + noindex + no JobPosting + not in the sitemap.
//
// Vocabulary stays paused/closed/hired to match the DB and admin. The word
// "expired" never appears in copy.

/**
 * How long a tuition stays live: it auto-pauses this many days after it is
 * posted or last resumed (owner, 13 Oct 2026 — 15 days; it was 7 from 8 Oct).
 * THE one value. The nightly pause, Resume and Refresh, JobPosting
 * validThrough, the countdown, the Overview "pausing soon" row and every label
 * that names the number read it from here.
 */
export const TUITION_LIVE_DAYS = 15

/** "15 days" — for labels, so no screen carries its own copy of the number. */
export const TUITION_LIVE_LABEL = `${TUITION_LIVE_DAYS} days`

/**
 * The one-time floor of the move from 15 days to 15 (owner, 13 Oct 2026). A
 * tuition that was live on the day of the change and whose 15 days had already
 * run out (or would within 3 days) stays live until this instant, 3 days after
 * the change, so nothing disappeared on the day. A tuition posted or resumed
 * later is always due after it, so the floor never applies again.
 */
export const LIVE_FLOOR_MS = Date.parse('2026-10-16T09:00:00Z')

const DAY_MS = 86_400_000

/**
 * The instant an OPEN tuition auto-pauses: its clock base
 * (coalesce(resumed_at, created_at)) + TUITION_LIVE_DAYS, never before
 * LIVE_FLOOR_MS. This is the ONE expression the sweep (isPauseDue), the display
 * (pauseCountdownLabel) and JobPosting validThrough all derive from, so
 * "pauses in N days" and "what the sweep writes" can never drift (PR29 §B).
 */
export function pauseDueAtMs(clockBaseIso: string): number {
  return Math.max(new Date(clockBaseIso).getTime() + TUITION_LIVE_DAYS * DAY_MS, LIVE_FLOOR_MS)
}

/** True once the clock has run out — exactly what the sweep pauses on. */
export function isPauseDue(clockBaseIso: string, now = Date.now()): boolean {
  return pauseDueAtMs(clockBaseIso) <= now
}

/**
 * The countdown shown to the poster on an OPEN tuition. Derived at read time
 * from the same clock the sweep uses. NEVER renders 0 or a negative number
 * (PR29 §B): under a day left — and the past-due-but-not-yet-swept window (cron
 * runs 03:00, so a tuition can be past due yet still open and taking
 * applications) — reads "pauses today"; otherwise "pauses in N days".
 */
export function pauseCountdownLabel(clockBaseIso: string, now = Date.now()): string {
  const remaining = pauseDueAtMs(clockBaseIso) - now
  if (remaining < DAY_MS) return 'pauses today'
  const n = Math.floor(remaining / DAY_MS)
  return `pauses in ${n} day${n === 1 ? '' : 's'}`
}

/**
 * A PAUSED tuition keeps its page indexable and in the sitemap for this many
 * days after it was paused (owner, 16 Oct 2026); after that it is noindex and
 * out of the sitemap. The page itself stays live forever. Mirrored by the SQL
 * function indexable_tuitions() (migration 178).
 */
export const PAUSED_INDEXABLE_DAYS = 60

/** Paused, and paused within PAUSED_INDEXABLE_DAYS. A paused row with no
 *  paused_at is treated as old (not indexable). */
export function pausedStillIndexable(status: string | null | undefined, pausedAtIso: string | null | undefined, now = Date.now()): boolean {
  if ((status ?? '').trim() !== 'paused' || !pausedAtIso) return false
  const t = new Date(pausedAtIso).getTime()
  if (Number.isNaN(t)) return false
  return now - t < PAUSED_INDEXABLE_DAYS * DAY_MS
}

export type TuitionBanner = { tone: 'gold' | 'navy' | 'green'; text: string }

export type TuitionPublicState = {
  status: string
  isOpen: boolean
  /** Applications are accepted only while open (the server is the gate). */
  acceptsApplications: boolean
  /** Open, or paused within the last 60 days. A fixture is separately noindex. */
  indexable: boolean
  /** Emit JobPosting structured data — open only. */
  emitJobPosting: boolean
  /** Eligible for the sitemap — the same as indexable. */
  inSitemap: boolean
  /** Apply, the contact line and the contact reveal — open only. */
  showContact: boolean
  /** The plain status banner, or null when open. */
  banner: TuitionBanner | null
}

/** The paused banner (owner, 16 Oct 2026). */
export const PAUSED_BANNER_TEXT = 'This tuition is no longer accepting applications'

export function tuitionPublicState(
  status: string | null | undefined,
  pausedAtIso: string | null = null,
  now = Date.now(),
): TuitionPublicState {
  const s = (status ?? '').trim() || 'open'
  const isOpen = s === 'open'
  const indexable = isOpen || pausedStillIndexable(s, pausedAtIso, now)

  const banner: TuitionBanner | null =
    s === 'paused'
      ? { tone: 'gold', text: PAUSED_BANNER_TEXT }
      : s === 'closed'
        ? { tone: 'navy', text: 'This tuition is closed.' }
        : s === 'hired'
          ? { tone: 'green', text: 'A tutor has been hired for this tuition.' }
          : null

  return {
    status: s,
    isOpen,
    acceptsApplications: isOpen,
    indexable,
    emitJobPosting: isOpen,
    inSitemap: indexable,
    showContact: isOpen,
    banner,
  }
}
