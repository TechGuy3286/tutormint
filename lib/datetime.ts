// Dates and times, in one place, always in Pakistan Standard Time.
//
// WHY THIS FILE EXISTS. `new Date(iso).toLocaleString('en-PK')` formats in
// whatever zone the runtime is in: UTC on a Vercel lambda, Asia/Karachi in a
// member's browser. In a client component that is server-rendered and then
// hydrated -- which is most of this app -- the two produce different text for
// the same instant, and React throws:
//
//   Minified React error #418
//
// That was live on /parent/dashboard and /parent/dashboard/demos through
// DemoInbox. It is not only a console error: in a server component there is no
// hydration to mismatch, so nothing throws and the page quietly shows a
// Karachi member a UTC timestamp instead. Five hours wrong and silent is worse
// than five hours wrong and loud.
//
// Every audience for these strings is in Pakistan -- members, admins, and the
// email and WhatsApp templates -- so the zone is fixed rather than guessed
// from the client. A guessed zone would reintroduce the mismatch exactly.
//
// NUMBERS ARE NOT DATES. `amount.toLocaleString('en-PK')` for currency has no
// zone to get wrong and is deliberately left alone; only Date instances route
// through here.

export const PK_TIMEZONE = 'Asia/Karachi'

const DATE: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: PK_TIMEZONE,
}

const DATE_TIME: Intl.DateTimeFormatOptions = {
  ...DATE,
  hour: 'numeric',
  minute: '2-digit',
}

type When = string | number | Date | null | undefined

function toDate(value: When): Date | null {
  if (value === null || value === undefined) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "3 Sep 2026". Empty string for a missing or unparseable value. */
export function formatDate(value: When): string {
  const d = toDate(value)
  return d ? d.toLocaleDateString('en-PK', DATE) : ''
}

/** "3 Sep 2026, 2:05 pm". */
export function formatDateTime(value: When): string {
  const d = toDate(value)
  return d ? d.toLocaleString('en-PK', DATE_TIME) : ''
}

/** "Sep 2026" — for "posted" lines where the day adds nothing. */
export function formatMonthYear(value: When): string {
  const d = toDate(value)
  return d
    ? d.toLocaleDateString('en-PK', { month: 'short', year: 'numeric', timeZone: PK_TIMEZONE })
    : ''
}

/**
 * "just now" / "5m ago" / "3h ago" / "2d ago", then an absolute date.
 *
 * Deliberately switches to an absolute date after a week: "43d ago" is a
 * number a reader has to do arithmetic on, and by then the exact day is what
 * they actually want.
 */
export function relativeTime(value: When): string {
  const d = toDate(value)
  if (!d) return ''
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(d)
}

/** The Karachi calendar day an instant falls on, as YYYY-MM-DD. */
export function pkDayKey(value: When): string {
  const d = toDate(value)
  if (!d) return ''
  // en-CA gives ISO-ordered parts, so this is a sortable key rather than a
  // display string — and it is the KARACHI day, which is what "the same day"
  // has to mean for a reader in Lahore.
  return d.toLocaleDateString('en-CA', { timeZone: PK_TIMEZONE })
}
