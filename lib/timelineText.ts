// lib/timelineText.ts
//
// The member timeline in plain English (PR100 §3). One sentence per event — no
// `key: value`, no internal codes, no JSON. Pure, so the server row and the
// browser-appended row read identically, and the wording is unit-tested.
//
// Two jobs:
//   timelineSentence(event, meta) → the sentence for one (or one COLLAPSED) row.
//   collapseTimeline(rows)        → merge a run of consecutive subject edits by
//                                   the same member within 10 minutes into one
//                                   line (53 near-identical rows → one).

export type TimelineMeta = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim()) : []

function roleWord(role: string | null): string {
  if (role === 'tutor') return 'a tutor'
  if (role === 'parent') return 'a parent'
  return 'a member'
}

function viaWord(via: string | null): string {
  if (via === 'mobile' || via === 'phone' || via === 'otp' || via === 'bridge') return 'their mobile number'
  if (via === 'email') return 'their email address'
  return ''
}

const DOC_ITEM: Record<string, string> = {
  cnic: 'CNIC',
  profile_pic: 'profile photo',
  profile_picture: 'profile photo',
  selfie: 'selfie',
  degree: 'degree certificate',
}

function fieldWords(fields: string[]): string {
  const nice = fields
    .map((f) => f.replace(/_/g, ' ').replace(/\barea\b/, 'areas').trim())
    .filter(Boolean)
  if (nice.length === 0) return ''
  return ` (${nice.join(', ')})`
}

function subjectsSentence(meta: TimelineMeta): string {
  const total = num(meta.total) ?? num(meta.count)
  const totalTail = total != null ? ` (now ${total} subject${total === 1 ? '' : 's'})` : ''
  // A collapsed run.
  if (meta._group) {
    const times = num(meta.times) ?? 1
    const added = list(meta.added)
    const removed = list(meta.removed)
    if (added.length === 0 && removed.length === 0) {
      // Old rows carry only a count — nothing to name. Say how many times.
      const day = str(meta.dayLabel)
      const end = total != null ? ` (ended with ${total} subject${total === 1 ? '' : 's'})` : ''
      return `Changed subjects ${times} time${times === 1 ? '' : 's'}${day ? ` on ${day}` : ''}${end}`
    }
    const parts: string[] = []
    if (added.length) parts.push(`added ${added.join(', ')}`)
    if (removed.length) parts.push(`removed ${removed.join(', ')}`)
    return `Changed subjects: ${parts.join(' · ')}${totalTail}`
  }
  // A single row.
  const added = list(meta.added)
  const removed = list(meta.removed)
  if (added.length === 0 && removed.length === 0) {
    return total != null ? `Updated their subjects${totalTail}` : 'Updated their subjects'
  }
  const parts: string[] = []
  if (added.length) parts.push(`added ${added.join(', ')}`)
  if (removed.length) parts.push(`removed ${removed.join(', ')}`)
  return `Changed subjects: ${parts.join(' · ')}${totalTail}`
}

/** One plain-English sentence for a timeline event. Never raw meta. */
export function timelineSentence(event: string, meta: TimelineMeta = {}): string {
  switch (event) {
    case 'registered':
      return `Registered as ${roleWord(str(meta.role))}`
    case 'email_confirmed':
      return 'Confirmed their email address'
    case 'login': {
      const via = viaWord(str(meta.via))
      return via ? `Signed in with ${via}` : 'Signed in'
    }
    case 'otp_verified':
      return 'Verified their mobile number'
    case 'profile_updated':
      return `Updated their profile${fieldWords(list(meta.fields))}`
    case 'completion_changed': {
      const to = num(meta.to) ?? num(meta.completion)
      return to != null ? `Profile completion reached ${to}%` : 'Profile completion changed'
    }
    case 'subjects_changed':
      return subjectsSentence(meta)
    case 'document_uploaded': {
      const kind = str(meta.kind) ?? str(meta.item)
      return kind && DOC_ITEM[kind] ? `Uploaded their ${DOC_ITEM[kind]}` : 'Uploaded a document'
    }
    case 'video_submitted': {
      const n = num(meta.attempt) ?? num(meta.attempts)
      return n ? `Submitted their introduction video (attempt ${n})` : 'Submitted their introduction video'
    }
    case 'verification_submitted':
      return 'Submitted their identity documents for review'
    case 'verification_decision_received': {
      const item = str(meta.item)
      const label = item ? DOC_ITEM[item] ?? 'identity' : 'Identity'
      const decision = str(meta.decision)
      const noun = item ? label.charAt(0).toUpperCase() + label.slice(1) : 'Identity'
      if (decision === 'approve') return `${noun} approved by staff`
      if (decision === 'reject' || decision === 'hold') return `${noun} needs another look`
      return `${noun} reviewed by staff`
    }
    case 'video_visibility_changed': {
      const v = str(meta.visibility)
      return v ? `Video set to ${v}` : 'Video visibility changed'
    }
    case 'job_posted':
      return 'Posted a tuition'
    case 'job_edited':
      return 'Edited a tuition'
    case 'job_closed':
      return 'Closed a tuition'
    case 'application_submitted':
      return 'Applied to a tuition'
    case 'application_withdrawn':
      return 'Withdrew an application'
    case 'demo_requested':
      return 'Requested a demo'
    case 'demo_accepted':
      return 'Accepted a demo'
    case 'demo_declined':
      return 'Declined a demo'
    case 'demo_completed':
      return 'Completed a demo'
    case 'message_sent':
      return 'Sent a message'
    case 'shortlist_added':
      return 'Shortlisted a tutor'
    case 'shortlist_removed':
      return 'Removed a tutor from their shortlist'
    case 'saved_job_added':
      return 'Saved a tuition'
    case 'saved_job_removed':
      return 'Unsaved a tuition'
    case 'profile_viewed':
      return 'Viewed a profile'
    case 'search_performed': {
      const surface = str(meta.surface)
      const where = surface === 'tutors' ? 'tutors' : surface === 'tuitions' ? 'tuitions' : null
      const city = str(meta.city)
      const results = num(meta.results)
      const base = where ? `Searched ${where}` : 'Searched'
      const place = city ? ` in ${city}` : ''
      const count = results != null ? ` — ${results} result${results === 1 ? '' : 's'}` : ''
      return `${base}${place}${count}`
    }
    case 'payment_submitted':
      return 'Submitted a payment'
    case 'payment_rejected':
      return 'A payment was not approved'
    case 'payment_approved':
      return 'Payment approved — plan activated'
    case 'verification_fee_paid':
      return 'Paid the Spam Free Platform Fee'
    case 'plan_purchased':
      return 'Started a plan'
    case 'plan_granted':
      return 'A plan was granted by staff'
    case 'plan_revoked':
      return 'A plan was removed by staff'
    case 'plan_expiring':
      return 'Their plan is expiring soon'
    case 'plan_expired':
      return 'Their plan ended'
    case 'blocked':
      return 'Blocked another member'
    case 'blocked_by':
      return 'Was blocked by another member'
    case 'unblocked':
      return 'Unblocked a member'
    case 'reported':
      return 'Reported another member'
    case 'reported_by':
      return 'Was reported'
    case 'report_resolved':
      return 'A report about them was resolved'
    case 'warned':
      return 'Received a warning'
    case 'suspended':
      return 'Account suspended'
    case 'unsuspended':
      return 'Account reinstated'
    case 'banned':
      return 'Account banned'
    case 'unbanned':
      return 'Account unbanned'
    case 'staff_created':
      return 'Staff account created'
    case 'staff_role_changed':
      return 'Staff role changed'
    case 'staff_removed':
      return 'Removed from the team'
    case 'staff_suspended':
      return 'Staff access suspended'
    case 'staff_reactivated':
      return 'Staff access restored'
    case 'admin_message_received':
      return 'Received a message from the TutorMint team'
    case 'seeded_contact_messaged':
      return 'Messaged a tuition poster'
    case 'password_changed':
      return 'Changed their password'
    case 'terms_accepted':
      return 'Accepted the terms'
    case 'profile_claimed':
      return 'Claimed their profile'
    case 'imported':
      return 'Added by bulk import'
    case 'cv_downloaded':
      return 'Downloaded their CV'
    default:
      // Never raw: a code like "some_new_event" becomes "Some new event".
      return event.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  }
}

export type CollapsibleRow = {
  id: string
  event: string
  targetType?: string | null
  targetId?: string | null
  meta: TimelineMeta
  at: string
}

const TEN_MIN = 10 * 60 * 1000

/**
 * Collapse a run of consecutive `subjects_changed` events by the same member
 * within 10 minutes into ONE row (PR100 §3): 53 near-identical rows become one
 * line. Rows arrive newest-first; a run is a maximal block of adjacent
 * subjects_changed whose neighbours are ≤ 10 min apart. The merged row keeps the
 * NEWEST row's identity and total, unions the added/removed names, and carries
 * `times` + a day label for the old count-only case.
 */
export function collapseTimeline<T extends CollapsibleRow>(rows: T[]): (T & { meta: TimelineMeta })[] {
  const out: (T & { meta: TimelineMeta })[] = []
  let i = 0
  while (i < rows.length) {
    const row = rows[i]
    if (row.event !== 'subjects_changed') {
      out.push(row)
      i++
      continue
    }
    // Gather the run.
    let j = i
    while (
      j + 1 < rows.length &&
      rows[j + 1].event === 'subjects_changed' &&
      Math.abs(new Date(rows[j].at).getTime() - new Date(rows[j + 1].at).getTime()) <= TEN_MIN
    ) {
      j++
    }
    if (j === i) {
      out.push(row) // single edit — rendered by timelineSentence directly
      i++
      continue
    }
    // Merge rows[i..j] (newest at i, oldest at j).
    const added = new Set<string>()
    const removed = new Set<string>()
    for (let k = i; k <= j; k++) {
      for (const a of list(rows[k].meta.added)) added.add(a)
      for (const r of list(rows[k].meta.removed)) removed.add(r)
    }
    const newest = rows[i]
    const total = num(newest.meta.total) ?? num(newest.meta.count)
    const day = new Date(newest.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    out.push({
      ...newest,
      meta: {
        _group: true,
        times: j - i + 1,
        added: [...added],
        removed: [...removed],
        ...(total != null ? { total } : {}),
        dayLabel: day,
      },
    })
    i = j + 1
  }
  return out
}
