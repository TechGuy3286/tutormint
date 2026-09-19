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
 * A stored key ("email_confirmed", "staff.remove") as readable words:
 * separators to spaces, sentence case. The last-resort fallback for a timeline
 * event or an admin action that has no explicit label — so an unmapped key
 * still reads as words, never the raw key (PR31 §5).
 */
export function humanizeKey(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/[_.\-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
}

/**
 * A person's name in proper case for display — "ALEE SABEER" → "Alee Sabeer"
 * (PR31 §6). Only touches a word that is ALL CAPS or all lower; a name the
 * member typed with deliberate casing ("McAli", "al-Rashid") is left alone, so
 * this fixes shouty/careless input without mangling real names. Display only —
 * the stored name is never changed.
 */
export function properName(raw: string | null | undefined): string {
  const s = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!s) return s
  return s
    .split(' ')
    .map((w) =>
      // Only normalise a word that is entirely upper or entirely lower; a word
      // with deliberate internal caps ("McAli") is left as the member typed it.
      w === w.toUpperCase() || w === w.toLowerCase()
        ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
        : w,
    )
    .join(' ')
}

/**
 * An admin_audit_log action ("staff.remove") in plain words ("Removed from
 * staff") for the member page's "Admin actions" panel (PR31 §5). Total: an
 * unmapped action falls back to humanizeKey, never the raw key.
 */
export function adminActionLabel(action: string | null | undefined): string {
  const known: Record<string, string> = {
    'staff.create': 'Added to staff',
    'staff.remove': 'Removed from staff',
    'staff.role_change': 'Staff role changed',
    'staff.grant_existing': 'Granted a staff role',
    'staff.invite_resend': 'Staff invite resent',
    'staff.suspend': 'Staff access suspended',
    'staff.reactivate': 'Staff access restored',
    'plan.grant': 'Plan granted',
    'plan.revoke': 'Plan revoked',
    'payment.approve': 'Payment approved',
    'payment.reject': 'Payment rejected',
    'member.suspend': 'Suspended',
    'member.unsuspend': 'Reinstated',
    'member.ban': 'Banned',
    'member.unban': 'Unbanned',
    'member.warn': 'Warned',
    'member.message': 'Sent a message',
    'member.export': 'Exported members',
    'member.change_mobile': 'Changed their mobile',
    'member.verify_mobile': 'Verified their mobile',
    'mobile.clear_verification': 'Cleared mobile verification',
    'tutor.approve': 'Approved a tutor',
    'tutor.hold': 'Put a tutor video on hold',
    'tutor.suspend': 'Suspended a tutor',
    'tutor.unsuspend': 'Reinstated a tutor',
    'tutor.import': 'Imported tutors',
    'tutor.slug': 'Changed a profile address',
    'parent.verify.approve': 'Approved parent verification',
    'parent.verify.reject': 'Rejected parent verification',
    'job.post': 'Posted a tuition',
    'job.edit': 'Edited a tuition',
    'job.close': 'Closed a tuition',
    'job.contact_message': 'Messaged a tuition contact',
    'video.visibility': 'Changed video visibility',
    'report.action': 'Actioned a report',
    'user.delete': 'Deleted an account',
    'ad.create': 'Created an ad',
    'ad.edit': 'Edited an ad',
    'ad.delete': 'Deleted an ad',
    'ad.status': 'Changed an ad status',
    'social.generate': 'Generated a social post',
    'blog.generate': 'Generated a blog draft',
    'blog.publish': 'Published a post',
    'blog.schedule': 'Scheduled a post',
    'blog.unpublish': 'Unpublished a post',
    'blog.delete': 'Deleted a post',
    'orphan.backfill': 'Created a missing profile',
    'cnic.reveal': 'Revealed a CNIC number',
  }
  return known[(action ?? '').trim()] ?? humanizeKey(action)
}

/**
 * Job Type — the kind of work a tutor wants, or a tuition offers.
 *
 * Three mutually-exclusive options (owner, 10 Sep 2026): Home Tuition, Online
 * Tuition, School Job. One phrase everywhere it appears (filters, cards,
 * profile, job form, notifications) so the label cannot drift. Total, and
 * tolerant of the retired values: `both`/`in_person`/`physical` read as Home
 * Tuition (the value they migrated to), so a browser tab open across the deploy
 * still renders sensibly.
 */
// Job Type is now a set of 19 job titles stored VERBATIM (migration 77), so the
// stored value IS the display label — this returns it as-is. The only mapping
// left is for the RETIRED short codes ('home'/'online'/'school' and their older
// spellings) that may still arrive from an old ?mode= link or a pre-77 row:
// 'home' → 'Home Tutor', 'online' → 'Online Tutor', 'school' → 'School Job' (the
// 2 unmapped legacy rows). A real title is returned verbatim — NOT title-cased,
// so "IB PYP Teacher" / "STEM Teacher" / "O Levels Teacher" keep their casing.
export function jobType(raw: string | null | undefined): string | null {
  if (!raw) return null
  switch (raw.trim().toLowerCase()) {
    case 'home':
    case 'home_tuition':
    case 'in_person':
    case 'in-person':
    case 'inperson':
    case 'physical':
    case 'onsite':
    case 'on_site':
    case 'both':
    case 'either':
    case 'any':
      return 'Home Tutor'
    case 'online':
    case 'online_tuition':
    case 'remote':
      return 'Online Tutor'
    case 'school':
    case 'school_job':
      return 'School Job'
    default:
      return raw.trim()
  }
}

/**
 * A tutor's SET of Job Types, as one clean line (owner, 10 Sep 2026).
 *
 * A tutor may offer any combination of the three. One type reads as its full
 * label ("Home Tuition"); several join with " · " so a tutor offering all three
 * reads cleanly rather than as a cramped list. Total, and tolerant of the
 * retired single values via jobType().
 */
export function jobTypesLabel(types: readonly string[] | null | undefined): string | null {
  const list = (types ?? []).map((t) => jobType(t)).filter(Boolean) as string[]
  if (list.length === 0) return null
  return list.join(' · ')
}

/**
 * A demo request's location — a different concept from Job Type. A demo happens
 * once, in one place: in person or online. `demo_requests.mode` still holds
 * 'in_person' | 'online', untouched by the Job Type change.
 */
export function demoMode(raw: string | null | undefined): string | null {
  if (!raw) return null
  switch (raw.trim().toLowerCase()) {
    case 'in_person':
    case 'in-person':
    case 'physical':
      return 'In person'
    case 'online':
    case 'remote':
      return 'Online'
    default:
      return titleCase(raw)
  }
}

/**
 * A taxonomy level name, as a person reads it: "O Level", not "O Levels".
 *
 * The taxonomy stores the plural programme name ("O Levels", "AS & A Levels"),
 * but a single tutor's profile and their CV read the singular — "O Level
 * Physics". ONE mapper so the public profile and the CV cannot diverge on the
 * same label. Total: an unrecognised name passes through unchanged, so a level
 * added by a future migration reads as itself. The stored value is untouched;
 * matching everywhere is on `master_id`, never on this string.
 */
export function levelLabel(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\bLevels\b/g, 'Level')
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
    basic: 'Basic',
    // 'verified' survives only as the one-time fee marker on a payment row; a
    // tutor never holds it as a plan. Kept so a fee payment reads "Verified".
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
