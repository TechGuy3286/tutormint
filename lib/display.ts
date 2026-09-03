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
// THE DATA IS ALSO INCONSISTENT and that is worth stating rather than hiding:
// `jobs.teaching_mode` holds 'Physical' (6 rows), 'in_person' (1) and NULL
// (51); `tutor_profiles.teaching_mode` holds 'Physical', 'Online' and 'Both';
// `demo_requests.mode` holds 'online'. Normalising the column is a migration
// and a decision about which spelling wins. Until that happens the display
// layer accepts every spelling, which means the fix holds whichever way the
// data goes.

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
 * "Either" rather than "Both" for the both-modes case: a parent reading a job
 * card is choosing, and "Either" is the word that says the choice is theirs.
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
      return 'Either'
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
