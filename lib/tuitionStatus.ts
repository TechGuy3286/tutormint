// lib/tuitionStatus.ts
//
// The public state of a tuition detail page, as a PURE function (PR28) — so the
// route, the metadata and the guard test all read the SAME rules and cannot
// drift. A tuition's URL never 404s because of status: the page always renders
// 200 while a job with that slug exists; only its state changes. 404 is reserved
// for a slug that does not exist.
//
// Only OPEN is indexable, emits JobPosting JSON-LD and sits in the sitemap. A
// paused/closed/hired page is 200 + noindex + no JobPosting + not in the sitemap
// — the correct de-listing signal, which reverses cleanly on resume.
//
// Vocabulary stays paused/closed/hired to match the DB and admin. The word
// "expired" never appears in copy.

/** A tuition auto-pauses this many days after it is posted or last resumed. */
export const PAUSE_AFTER_DAYS = 15

const DAY_MS = 86_400_000

/**
 * The instant an OPEN tuition auto-pauses: its clock base
 * (coalesce(resumed_at, created_at)) + 15 days. This is the ONE expression the
 * sweep (isPauseDue) and the display (pauseCountdownLabel) both derive from, so
 * "pauses in N days" and "what the sweep writes" can never drift (PR29 §B).
 */
export function pauseDueAtMs(clockBaseIso: string): number {
  return new Date(clockBaseIso).getTime() + PAUSE_AFTER_DAYS * DAY_MS
}

/** True once the 15-day clock has run out — exactly what the sweep pauses on. */
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

export type TuitionBanner = { tone: 'gold' | 'navy' | 'green'; text: string }

export type TuitionPublicState = {
  status: string
  isOpen: boolean
  /** Applications are accepted only while open (the server is the gate). */
  acceptsApplications: boolean
  /** Open only. A fixture is separately noindex regardless. */
  indexable: boolean
  /** Emit JobPosting structured data — open only. */
  emitJobPosting: boolean
  /** Eligible for the sitemap — open only (the sitemap RPC already enforces this). */
  inSitemap: boolean
  /** The plain status banner, or null when open. */
  banner: TuitionBanner | null
}

export function tuitionPublicState(status: string | null | undefined): TuitionPublicState {
  const s = (status ?? '').trim() || 'open'
  const isOpen = s === 'open'

  const banner: TuitionBanner | null =
    s === 'paused'
      ? { tone: 'gold', text: 'This tuition is paused — it is not accepting applications right now.' }
      : s === 'closed'
        ? { tone: 'navy', text: 'This tuition is closed.' }
        : s === 'hired'
          ? { tone: 'green', text: 'A tutor has been hired for this tuition.' }
          : null

  return {
    status: s,
    isOpen,
    acceptsApplications: isOpen,
    indexable: isOpen,
    emitJobPosting: isOpen,
    inSitemap: isOpen,
    banner,
  }
}
