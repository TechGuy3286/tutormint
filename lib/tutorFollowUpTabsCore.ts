// lib/tutorFollowUpTabsCore.ts
//
// PURE, client-safe. Follow-ups → Tutors works like Applications (owner,
// 23 Oct 2026): every tutor is in "To do" or "Followed up" (the tab was
// called "Sent" until 23 Oct 2026; its internal value is still 'sent').
//
//   Waiting on us     documents waiting for the Owner. Not a message: stays in
//                     To do with the action to take ("Documents to review") and
//                     a link, until it is done. Never counted in the badge.
//   No reply          3 messages at the SAME progress (the snapshot taken on
//                     each tap) with nothing new done → Followed up, in a
//                     collapsed "No reply after 3 messages" section, no longer
//                     due.
//   Followed up       the last contact was less than 3 days ago; due again 3
//                     days after it. Progress does NOT skip the wait (owner,
//                     23 Oct 2026): a tutor who finished a new step stays here
//                     until the 3 days are up, and only then returns to To do —
//                     with the message for their NEW reason, and the count of
//                     unanswered messages started again.
//   To do             everything else.
//
// Overdue (the red Follow-ups badge): in To do, not waiting on us, and due for
// MORE than 1 day — never contacted and signed up more than a day ago, or the
// 3 days since the last message ran out more than a day ago.
//
// A contact recorded some other way (a logged call, a note) carries no progress
// snapshot: it counts as a contact (Followed up for 3 days) but never towards "3
// messages with no progress". The same is true of follow-ups recorded before
// this change.
//
// Unit-tested by scripts/test-tutor-journey.ts.

export const DUE_AGAIN_DAYS = 3
export const NO_REPLY_AFTER = 3
export const OVERDUE_AFTER_DAYS = 1
const DAY = 86_400_000

export type FuTab = 'todo' | 'sent'
export type FuSection = 'todo' | 'sent' | 'no_reply'

export type ContactRecord = {
  at: string
  /** The progress snapshot when it was sent; null = not a Follow-ups tap. */
  progress: string | null
  staffName?: string | null
  /** The template sent (a follow-up), or null. */
  templateKey?: string | null
}

export type TabFacts = {
  joinedAt: string
  /** The tutor's progress now (progressKey). */
  progress: string
  waitingOnUs: boolean
  contacts: ContactRecord[]
  /** Where the "Waiting on us" action goes (the member's documents). */
  reviewHref?: string
}

export type TabState = {
  tab: FuTab
  section: FuSection
  /** When the next message is due (Sent), else null. */
  dueAt: string | null
  overdue: boolean
  /** Messages in a row at the current progress. */
  unanswered: number
  last: ContactRecord | null
  /** "Documents to review" for a card waiting on us. */
  action: { label: string; href: string } | null
}

/** A snapshot of how far a tutor has got — any step finished changes it. */
export function progressKey(f: { stoppedStep: string | null; completion: number; feePaid: boolean; docsApproved: boolean }): string {
  return `${f.stoppedStep ?? 'done'}|${Math.round(f.completion || 0)}|${f.feePaid ? 1 : 0}|${f.docsApproved ? 1 : 0}`
}

const t = (iso: string | null | undefined) => {
  const v = iso ? Date.parse(iso) : NaN
  return Number.isFinite(v) ? v : NaN
}

/** Newest first. */
export function sortContacts(cs: ContactRecord[]): ContactRecord[] {
  return [...cs].filter((c) => Number.isFinite(t(c.at))).sort((a, b) => t(b.at) - t(a.at))
}

/** Follow-up messages in a row, newest first, at the current progress. A
 *  message at a different progress (or a contact with no snapshot that is not a
 *  Follow-ups tap) ends the run. */
export function unansweredCount(contacts: ContactRecord[], progress: string): number {
  let n = 0
  for (const c of sortContacts(contacts)) {
    if (c.progress === null) continue // a call or note: not a Follow-ups message
    if (c.progress !== progress) break
    n++
  }
  return n
}

export function tabState(f: TabFacts, nowMs: number): TabState {
  const sorted = sortContacts(f.contacts)
  const last = sorted[0] ?? null
  const unanswered = unansweredCount(sorted, f.progress)
  if (f.waitingOnUs) {
    return {
      tab: 'todo',
      section: 'todo',
      dueAt: null,
      overdue: false,
      unanswered,
      last,
      action: { label: 'Documents to review', href: f.reviewHref ?? '#documents' },
    }
  }
  if (unanswered >= NO_REPLY_AFTER) return { tab: 'sent', section: 'no_reply', dueAt: null, overdue: false, unanswered, last, action: null }
  if (last) {
    // Progress does not skip the wait: whatever the tutor did since, they stay
    // in Followed up until 3 days after the last contact. (unansweredCount has
    // already started the count again if they made progress.)
    const lastAt = t(last.at)
    if (nowMs - lastAt < DUE_AGAIN_DAYS * DAY) {
      return { tab: 'sent', section: 'sent', dueAt: new Date(lastAt + DUE_AGAIN_DAYS * DAY).toISOString(), overdue: false, unanswered, last, action: null }
    }
    const dueSince = lastAt + DUE_AGAIN_DAYS * DAY
    return { tab: 'todo', section: 'todo', dueAt: null, overdue: nowMs - dueSince > OVERDUE_AFTER_DAYS * DAY, unanswered, last, action: null }
  }
  const joined = t(f.joinedAt)
  return {
    tab: 'todo',
    section: 'todo',
    dueAt: null,
    overdue: Number.isFinite(joined) && nowMs - joined > OVERDUE_AFTER_DAYS * DAY,
    unanswered,
    last,
    action: null,
  }
}

/** Counts per tab (Followed up includes the collapsed No-reply section). */
export function tabCounts(states: TabState[]): { todo: number; sent: number; noReply: number } {
  return {
    todo: states.filter((s) => s.tab === 'todo').length,
    sent: states.filter((s) => s.tab === 'sent').length,
    noReply: states.filter((s) => s.section === 'no_reply').length,
  }
}

/** The red badge: overdue To do items only. */
export function fuBadgeCount(states: TabState[]): number {
  return states.filter((s) => s.tab === 'todo' && s.overdue && !s.action).length
}

/** The tab names staff see. Applications keeps its own "Sent". */
export const FU_TAB_LABEL: Record<FuTab, string> = { todo: 'To do', sent: 'Followed up' }

export function parseFuTab(v: string | null | undefined): FuTab {
  return v === 'sent' ? 'sent' : 'todo'
}

/** "Finish your profile sent by Aqsa, 2 days ago · next due 25 Oct 2026". */
export function sentLine(a: { templateTitle: string | null; staffName: string | null; ago: string; nextDue: string | null }): string {
  const what = a.templateTitle ? `“${a.templateTitle}” sent` : 'Contacted'
  return `${what} by ${a.staffName || 'staff'}, ${a.ago}${a.nextDue ? ` · next due ${a.nextDue}` : ''}`
}

// ------------------------------------------------------------ undo (sender only)

/** Undo stays open 10 seconds in the browser; the server allows a little more
 *  for a slow network, and only to the person who sent it. */
export const UNDO_MS = 10_000
export const UNDO_GRACE_MS = 60_000

export type UndoProblem = 'not_found' | 'not_yours' | 'already_undone' | 'too_late'

export function undoProblem(
  r: { staffId: string | null; createdAt: string; undoneAt: string | null } | null,
  actorId: string,
  nowMs: number,
): UndoProblem | null {
  if (!r) return 'not_found'
  if (r.staffId !== actorId) return 'not_yours'
  if (r.undoneAt) return 'already_undone'
  if (nowMs - t(r.createdAt) > UNDO_GRACE_MS) return 'too_late'
  return null
}

export const UNDO_TEXT: Record<UndoProblem, string> = {
  not_found: 'That follow-up was not found.',
  not_yours: 'Only the person who sent it can undo it.',
  already_undone: 'That follow-up was already undone.',
  too_late: 'Too late to undo — it was recorded.',
}
