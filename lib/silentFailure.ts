'use client'

// When a handler swallows an error on purpose, this is what it must still do.
//
// WHY IT EXISTS, precisely. `UpgradeTrigger` catches a failed /api/gate call
// and does nothing, on a defensible argument: the locked row already says it
// is locked, and a red error line under it repeats that with less information.
// The cost of that argument is what happened next -- `tutor_viewer_identity`
// shipped without an entry in the route's allowlist, so "See who" returned a
// 400 and the button did NOTHING, on the platform's primary upsell surface,
// for a day. Nothing in any log said so, because the only code that knew had
// been written to stay quiet.
//
// The rule this file encodes: a swallowed error is silent TO THE MEMBER, never
// to us.
//
//   development  console.error, immediately, with the scope and the cause.
//   production   one line to /api/client-error, which logs it server-side
//                where Vercel keeps it.
//
// FIRE AND FORGET, ALWAYS. Nothing here awaits, nothing here throws, and the
// beacon's own failure is discarded — this is called from inside a catch, and
// a logger that can fail the handler it is reporting on is worse than no
// logger. `keepalive` so a report survives the navigation that often follows.
//
// NOT AN ERROR TRACKER. There is no Sentry on this project and this is not a
// substitute for one; it is the minimum that makes a no-op button findable.

/** How many reports one page may send. A loop in a render must not flood. */
const MAX_PER_PAGE = 20
let sent = 0

export type SilentContext = Record<string, string | number | boolean | null | undefined>

/**
 * Report an error that the member is deliberately not being shown.
 *
 * `scope` is where it happened, in a form that is greppable: 'UpgradeTrigger',
 * 'NotificationBell.markRead'. `context` is small, non-personal detail — a
 * reason code, a status, an id of a thing rather than a person. Never a
 * message body, an address or a phone number: this is written to a log we read
 * later, and the masking rules do not stop at the database.
 */
export function reportSilentFailure(
  scope: string,
  error: unknown,
  context?: SilentContext,
): void {
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : (() => {
            try {
              return JSON.stringify(error)
            } catch {
              return String(error)
            }
          })()

  if (process.env.NODE_ENV !== 'production') {
    // Grouped under one prefix so a developer can filter for it, and loud
    // enough to notice: this is the line that would have caught the gate bug
    // the first time anybody pressed the button locally.
    console.error(`[silent-failure] ${scope}:`, detail, context ?? {})
    return
  }

  if (sent >= MAX_PER_PAGE) return
  sent += 1

  try {
    const body = JSON.stringify({
      scope,
      detail: detail.slice(0, 500),
      path: typeof location === 'undefined' ? null : location.pathname,
      context: context ?? null,
    })
    // No await, no .catch that does anything: if the beacon itself fails there
    // is nowhere left to report that to, and retrying inside a catch block is
    // how one broken call becomes a storm.
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* Reporting must never be the thing that throws. */
  }
}
