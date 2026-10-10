// lib/applicantForwardCore.ts
//
// Marketplace → "Applicants to forward" (owner, 10 Oct 2026). When a tutor who
// has PAID the Verification Fee applies to a tuition or views its contact
// number, staff contact that tuition's parent and tell them which tutors are
// interested. ONE CARD PER TUITION, so each parent is contacted once.
//
// The rules, all here and pure (the loader, the page, the APIs and the tests
// read this one file):
//   - only PAID tutors count; an unpaid tutor's application is not on a card;
//   - "Applied" and "Viewed number" both count, one line per tutor (applied
//     wins when a tutor did both), newest first;
//   - To forward  = at least one paid tutor not yet included in a forward;
//     Forwarded   = everyone was included, no outcome recorded since;
//     Outcome     = an outcome was recorded after the last forward;
//   - a NEW paid applicant on a forwarded tuition sends the card back to
//     To forward with a "New applicant" tag — only the new tutors are
//     pre-selected for the next message, earlier ones read "already sent";
//   - 3 days after a forward with no outcome, the card is tagged
//     "Check with parent";
//   - the message is built from the template; it never carries a phone number.

export type InterestKind = 'applied' | 'viewed'
export type InterestEvent = { jobId: string; tutorId: string; kind: InterestKind; at: string }
export type ForwardRow = { jobId: string; tutorIds: string[]; at: string; staffName: string | null; channel: string }
export type OutcomeKind = 'hired' | 'demo' | 'not_interested' | 'no_answer'
export type OutcomeRow = { jobId: string; outcome: OutcomeKind; tutorId: string | null; note: string | null; at: string; staffName: string | null }

export const OUTCOME_LABEL: Record<OutcomeKind, string> = {
  hired: 'Hired',
  demo: 'Demo arranged',
  not_interested: 'Not interested',
  no_answer: 'No answer',
}
/** Outcomes that name a tutor. */
export const OUTCOME_NEEDS_TUTOR: Record<OutcomeKind, boolean> = { hired: true, demo: true, not_interested: false, no_answer: false }

export const CHECK_AFTER_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

export type ForwardTab = 'to_forward' | 'forwarded' | 'outcome'

export type TutorInterest = {
  tutorId: string
  /** "Applied" when the tutor applied (even if they also viewed the number). */
  kind: InterestKind
  /** Their newest action on this tuition. */
  at: string
  /** Already included in an earlier forward. */
  alreadySent: boolean
}

export type ForwardState = {
  jobId: string
  tab: ForwardTab
  tutors: TutorInterest[]
  /** The tutors pre-selected for the next message: those not sent yet. */
  newTutorIds: string[]
  /** A forwarded tuition that gained a paid applicant since. */
  newApplicant: boolean
  /** Forwarded 3+ days ago with no outcome. */
  checkWithParent: boolean
  lastForward: ForwardRow | null
  lastOutcome: OutcomeRow | null
  /** Sort key: the newest thing that happened on this card. */
  latestAt: string
}

const newest = (a: string, b: string) => (a > b ? a : b)

/**
 * Group interest into one state per tuition. `paid` is the set of tutors who
 * have paid the fee — everyone else is dropped here, whatever the caller sent.
 */
export function buildForwardStates(input: {
  events: InterestEvent[]
  paid: ReadonlySet<string>
  forwards: ForwardRow[]
  outcomes: OutcomeRow[]
  nowMs: number
}): ForwardState[] {
  const byJob = new Map<string, Map<string, TutorInterest>>()
  for (const e of input.events) {
    if (!input.paid.has(e.tutorId)) continue
    const tutors = byJob.get(e.jobId) ?? new Map<string, TutorInterest>()
    const cur = tutors.get(e.tutorId)
    tutors.set(e.tutorId, {
      tutorId: e.tutorId,
      kind: cur?.kind === 'applied' || e.kind === 'applied' ? 'applied' : 'viewed',
      at: cur ? newest(cur.at, e.at) : e.at,
      alreadySent: false,
    })
    byJob.set(e.jobId, tutors)
  }

  const out: ForwardState[] = []
  for (const [jobId, tutorMap] of byJob) {
    const forwards = input.forwards.filter((f) => f.jobId === jobId).sort((a, b) => (a.at < b.at ? 1 : -1))
    const outcomes = input.outcomes.filter((o) => o.jobId === jobId).sort((a, b) => (a.at < b.at ? 1 : -1))
    const sent = new Set(forwards.flatMap((f) => f.tutorIds))
    const tutors = [...tutorMap.values()]
      .map((t) => ({ ...t, alreadySent: sent.has(t.tutorId) }))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    const newTutorIds = tutors.filter((t) => !t.alreadySent).map((t) => t.tutorId)
    const lastForward = forwards[0] ?? null
    const lastOutcome = outcomes[0] ?? null

    let tab: ForwardTab
    if (newTutorIds.length > 0) tab = 'to_forward'
    else if (lastOutcome && lastForward && lastOutcome.at >= lastForward.at) tab = 'outcome'
    else tab = 'forwarded'

    const checkWithParent =
      tab === 'forwarded' && !!lastForward && input.nowMs - Date.parse(lastForward.at) >= CHECK_AFTER_DAYS * DAY_MS

    let latestAt = tutors[0]?.at ?? ''
    if (lastForward) latestAt = newest(latestAt, lastForward.at)
    if (lastOutcome) latestAt = newest(latestAt, lastOutcome.at)

    out.push({
      jobId,
      tab,
      tutors,
      newTutorIds,
      newApplicant: tab === 'to_forward' && !!lastForward,
      checkWithParent,
      lastForward,
      lastOutcome,
      latestAt,
    })
  }
  return out.sort((a, b) => (a.latestAt < b.latestAt ? 1 : a.latestAt > b.latestAt ? -1 : 0))
}

/** The numbers reported for the screen. */
export function forwardCounts(states: ForwardState[], events: InterestEvent[], paid: ReadonlySet<string>) {
  const counted = events.filter((e) => paid.has(e.tutorId))
  const toForward = states.filter((s) => s.tab === 'to_forward')
  return {
    toForward: toForward.length,
    forwarded: states.filter((s) => s.tab === 'forwarded').length,
    outcome: states.filter((s) => s.tab === 'outcome').length,
    paidTutors: new Set(states.flatMap((s) => s.tutors.map((t) => t.tutorId))).size,
    paidTutorsToForward: new Set(toForward.flatMap((s) => s.newTutorIds)).size,
    applications: counted.filter((e) => e.kind === 'applied').length,
    views: counted.filter((e) => e.kind === 'viewed').length,
  }
}

/** "Forwarded 2 days ago by Aqsa (3 tutors)". */
export function forwardedLine(f: ForwardRow, nowMs: number): string {
  const days = Math.max(0, Math.floor((nowMs - Date.parse(f.at)) / DAY_MS))
  const when = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
  const n = f.tutorIds.length
  return `Forwarded ${when}${f.staffName ? ` by ${f.staffName}` : ''} (${n} ${n === 1 ? 'tutor' : 'tutors'})`
}

// ---------------------------------------------------------------- message ----

export const APPLICANTS_FORWARD_TEMPLATE_KEY = 'applicants_forward'
export const APPLICANTS_FORWARD_DEFAULT =
  "Assalam o Alaikum {parent_name}, this is TutorMint about your tuition: {tuition_title} ({area}). These verified tutors are interested:\n{tutor_list}\nReply here if you'd like a demo lesson with any of them."

/** A run of digits long enough to be a phone number, however it is spaced. */
const PHONE_LIKE = /(?:\+|00)?\d[\d\s().-]{7,}\d/g

/** Text that cannot carry a phone number (a tutor's name, a tuition title). */
export function withoutPhoneNumbers(text: string | null | undefined): string {
  return (text ?? '').replace(PHONE_LIKE, '').replace(/\s{2,}/g, ' ').trim()
}

export type MessageTutor = { name: string; profileUrl: string | null }

/** One line per tutor: the name and the public profile link. No phone, ever. */
export function tutorListLines(tutors: MessageTutor[]): string {
  return tutors
    .map((t) => {
      const name = withoutPhoneNumbers(t.name) || 'TutorMint tutor'
      return t.profileUrl ? `${name}: ${t.profileUrl}` : name
    })
    .join('\n')
}

/**
 * The prefilled WhatsApp text. Every placeholder is filled (an empty value is
 * removed cleanly, never left as "{area}"); the tutor list holds names and
 * profile links only.
 */
export function buildForwardMessage(args: {
  template: string | null | undefined
  parentName: string | null
  tuitionTitle: string
  area: string | null
  tutors: MessageTutor[]
}): string {
  const template = (args.template ?? '').trim() || APPLICANTS_FORWARD_DEFAULT
  const area = withoutPhoneNumbers(args.area)
  let text = template
    .replace(/\{parent_name\}/g, withoutPhoneNumbers(args.parentName))
    .replace(/\{tuition_title\}/g, withoutPhoneNumbers(args.tuitionTitle))
    .replace(/\{area\}/g, area)
    .replace(/\{tutor_list\}/g, tutorListLines(args.tutors))
  // Tidy what an empty value leaves behind: "Assalam o Alaikum , this" and "()".
  text = text
    .replace(/\s*\(\s*\)/g, '')
    .replace(/[ \t]+,/g, ',')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\{[a-z_]+\}/g, '')
  return text.trim()
}

/** wa.me link with the text prefilled, or null with no usable number. */
export function forwardWaLink(msisdn: string | null, message: string): string | null {
  return msisdn ? `https://wa.me/${msisdn}?text=${encodeURIComponent(message)}` : null
}

/** What a forward may record: only tutors who are on the card (paid, interested). */
export function validForwardTutorIds(state: ForwardState | null | undefined, requested: string[]): string[] {
  if (!state) return []
  const onCard = new Set(state.tutors.map((t) => t.tutorId))
  return [...new Set(requested)].filter((id) => onCard.has(id))
}
