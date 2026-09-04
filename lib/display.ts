// Database values, in the words a person reads.
//
// "in_person" reached a live job card. It is a real value in
// `jobs.teaching_mode`, and the card rendered it faithfully — which is the
// problem: a column that holds both 'Physical' and 'in_person' will always
// leak whichever one nobody thought about.
//
// So nothing renders an enum directly any more. These helpers are total: an
// unrecognised value is TITLE-CASED rather than dropped or replaced with a
// guess, so a new status added by a migration reads as "Under review" instead
// of vanishing from the card or crashing it.
//
// THE DATA WAS ALSO INCONSISTENT, and migration 35 fixed that: all three
// columns now hold lowercase snake ('in_person', 'online', 'both') behind a
// CHECK constraint. `teachingMode()` still accepts the retired spellings on
// purpose. Three reasons, none of them nostalgia: a browser tab open across
// the deploy still holds the old value in its form state; the helper is the
// only translation for values arriving from anywhere at all, including a CSV
// import written later; and a total function that title-cases the unexpected
// cannot be the thing that empties a card.

function titleCase(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
}

/**
 * How a tuition or a tutor is taught.
 *
 * The both-modes case reads "In person or online" — spelled out rather than
 * "Either", which said the choice was there but not what the choices were. One
 * phrase everywhere it appears (filters, cards, profile, job form, notifications)
 * so the label cannot drift. The stored value is unchanged ('both').
 */
export function teachingMode(raw: string | null | undefined): string | null {
  if (!raw) return null
  switch (raw.trim().toLowerCase()) {
    case 'in_person':
    case 'in-person':
    case 'inperson':
    case 'physical':
    case 'onsite':
    case 'on_site':
      return 'In person'
    case 'online':
    case 'remote':
      return 'Online'
    case 'both':
    case 'either':
    case 'any':
      return 'In person or online'
    default:
      return titleCase(raw)
  }
}

/** A demo request's mode. Same vocabulary as a job's. */
export function demoMode(raw: string | null | undefined): string | null {
  return teachingMode(raw)
}

/** Where an application stands, from the tutor's side. */
export function applicationStatus(raw: string | null | undefined): string {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'applied':
      return 'Awaiting the parent'
    case 'shortlisted':
      return 'Shortlisted'
    case 'hired':
      return 'Hired'
    case 'rejected':
      return 'Not selected'
    case 'withdrawn':
      return 'Withdrawn'
    default:
      return titleCase(raw ?? '—')
  }
}

/** A posted tuition's state. */
export function jobStatus(raw: string | null | undefined): string {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'open':
      return 'Open'
    case 'closed':
      return 'Closed'
    case 'hired':
      return 'Hired'
    case 'filled':
      return 'Filled'
    default:
      return titleCase(raw ?? '—')
  }
}

/** A demo request's state. */
export function demoStatus(raw: string | null | undefined): string {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'requested':
      return 'Requested'
    case 'accepted':
      return 'Accepted'
    case 'declined':
      return 'Declined'
    case 'completed':
      return 'Completed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return titleCase(raw ?? '—')
  }
}

/** A verification state, as a member should read it. */
export function verificationStatus(raw: string | null | undefined): string {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'pending':
      return 'Pending'
    case 'submitted':
      return 'In review'
    case 'verified':
      return 'Verified'
    case 'rejected':
      return 'Not accepted'
    case 'suspended':
      return 'Suspended'
    default:
      return titleCase(raw ?? '—')
  }
}

/**
 * Any stored status, as a word.
 *
 * The generic fallback for the admin chip: the queues carry statuses from six
 * different columns and most of them just need title-casing. Where a column
 * has its own vocabulary -- an application, a job, a demo, a verification --
 * use that column's helper above, which knows the wording a member expects.
 */
export function statusLabel(raw: string | null | undefined): string {
  return titleCase(raw ?? '—')
}

/**
 * A plan code as a member sees it: "Verified", "Premium", "Featured".
 *
 * Mirrors plans.name, and deliberately does NOT read the table. This is called
 * once per row while rendering a feed, and a database round trip per activity
 * line to turn `verified` into `Verified` is a query budget spent on a word.
 * The two parent codes carry the same names as their tutor counterparts --
 * which is correct, because a parent's Featured plan is called Featured.
 *
 * Total, like every other helper here: an unrecognised code is title-cased
 * rather than dropped, so a plan added by a future migration reads as itself
 * instead of vanishing from the sentence.
 */
export function planLabel(code: string | null | undefined): string | null {
  if (!code) return null
  const known: Record<string, string> = {
    verified: 'Verified',
    premium: 'Premium',
    featured: 'Featured',
    parent_verified: 'Verified',
    parent_featured: 'Featured',
  }
  return (
    known[code] ??
    code
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ')
  )
}
