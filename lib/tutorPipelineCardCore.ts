// lib/tutorPipelineCardCore.ts
//
// PURE, client-safe. One tutor's People → Tutors pipeline card (owner, 8 Nov
// 2026), built from facts the server loads (lib/tutorPipeline): the stage, what
// is missing or rejected, where the follow-ups stand and the stage's WhatsApp
// text. The stored list tags and the badge / Overview counts read the SAME
// helpers here, so a count is always the length of its view.
//
// Unit-tested by scripts/test-tutor-pipeline.ts.

import { firstNameOf } from '@/lib/staffOutreachCore'
import { itemState } from '@/lib/tutorDocSummaryCore'
import type { CardDocState, CardStatuses } from '@/lib/tutorDocQueueCore'
import {
  docsReadyForReview,
  followState,
  isFollowStage,
  missingDocs,
  pendingDocs,
  pipelineStage,
  pipeMessage,
  rejectedDocs,
  type DocState,
  type FollowState,
  type PipeContact,
  type PipeDocs,
  type PipeStage,
} from '@/lib/tutorPipelineCore'

/** What a People → Tutors card carries about the pipeline. */
export type PipeCard = {
  stage: PipeStage
  /** 'not' / 'done' for a stage that is followed up; null otherwise. */
  section: 'not' | 'done' | null
  missing: string[]
  /** Uploaded and waiting for a decision (owner, 9 Nov 2026). Older stored
   *  rows have none until the next summary run. */
  pending?: string[]
  /** profiles.profile_completion when the card was built — the status line
   *  reads it, so the line and the stage never disagree. */
  completion?: number
  /** No verified mobile number on file: bottom of the stage, never in a
   *  badge, "No mobile number — can't follow up". */
  noMobile?: boolean
  /** The current profile photo / selfie looks almost entirely black or blank
   *  (lib/photoBlankCore). A flag for staff only — nothing is rejected by it. */
  blank?: ('photo' | 'selfie')[]
  rejected: { name: string; reason: string | null }[]
  /** Rejected: a WhatsApp was sent in this stage. */
  informed: boolean
  follow: Pick<FollowState, 'sent' | 'nextNumber' | 'nextKind' | 'dueAt'> | null
  lastContact: { at: string; kind: string; by: string | null } | null
  /** The stage's WhatsApp text (no number in it). */
  message: string | null
  notInterested: boolean
  paused: boolean
  lastActiveAt: string | null
  oldestUploadAt: string | null
}

/** The document facts a card is built from (lib/tutorDocSummaries CardDocs). */
export type PipeDocFacts = { statuses: CardStatuses; oldestUploadAt: string | null }

const state = (s: CardDocState | undefined): DocState => (s ? itemState(s) : 'none')

export function pipeDocsOf(d: PipeDocFacts | null | undefined): PipeDocs & { reasons: { cnic: string | null; photo: string | null; selfie: string | null } } {
  return {
    cnic: state(d?.statuses.cnic),
    photo: state(d?.statuses.profilePic),
    selfie: state(d?.statuses.selfie),
    reasons: {
      cnic: d?.statuses.cnic.reason ?? null,
      photo: d?.statuses.profilePic.reason ?? null,
      selfie: d?.statuses.selfie.reason ?? null,
    },
  }
}

const newest = (cs: PipeContact[]) => [...cs].sort((x, y) => Date.parse(y.at) - Date.parse(x.at))[0] ?? null

/** One tutor's pipeline card from its facts. Paid, Waiting and Not interested
 *  tutors carry no follow-up due (the sequence stops). */
export function pipeCardFrom(a: {
  name: string
  feePaid: boolean
  /** profiles.profile_completion. */
  completion?: number
  /** A verified mobile number on file (false = can't follow up). */
  mobileOk?: boolean
  blank?: ('photo' | 'selfie')[]
  docs: PipeDocFacts | null | undefined
  contacts: PipeContact[]
  notInterested: boolean
  paused: boolean
  lastActiveAt: string | null
  support: string | null
  nowMs: number
}): PipeCard {
  const d = pipeDocsOf(a.docs)
  const completion = a.completion ?? 0
  const stage = pipelineStage({ ...d, feePaid: a.feePaid, completion })
  const missing = missingDocs(d)
  const rejected = rejectedDocs(d, d.reasons)
  const follow = isFollowStage(stage) ? followState(stage, a.contacts, a.nowMs) : null
  const lc = newest(a.contacts)
  return {
    stage,
    section: follow ? follow.section : null,
    missing,
    pending: pendingDocs(d),
    completion,
    noMobile: a.mobileOk === false,
    blank: a.blank ?? [],
    rejected,
    informed: follow?.informed ?? false,
    follow: follow ? { sent: follow.sent, nextNumber: follow.nextNumber, nextKind: follow.nextKind, dueAt: follow.dueAt } : null,
    lastContact: lc ? { at: lc.at, kind: lc.kind, by: lc.staffName } : null,
    message: isFollowStage(stage) ? pipeMessage(stage, { firstName: firstNameOf(a.name), missing, rejected, supportWhatsapp: a.support }) : null,
    notInterested: a.notInterested,
    paused: a.paused,
    lastActiveAt: a.lastActiveAt,
    oldestUploadAt: a.docs?.oldestUploadAt ?? null,
  }
}

/** The card again after its contacts changed (a follow-up logged or undone),
 *  keeping its stored stage. */
export function withContacts(p: PipeCard, contacts: PipeContact[], nowMs: number): PipeCard {
  if (!isFollowStage(p.stage)) return p
  const f = followState(p.stage, contacts, nowMs)
  const lc = newest(contacts)
  return {
    ...p,
    section: f.section,
    informed: f.informed,
    follow: { sent: f.sent, nextNumber: f.nextNumber, nextKind: f.nextKind, dueAt: f.dueAt },
    lastContact: lc ? { at: lc.at, kind: lc.kind, by: lc.staffName } : null,
  }
}

/** A follow-up is due now: a followed-up stage, Not followed up, not marked
 *  Not interested. The People badge and the Overview rows count these. */
export function followUpDue(p: PipeCard): boolean {
  return isFollowStage(p.stage) && !p.notInterested && p.section === 'not'
}

/**
 * The People badge's follow-up part (owner, 9 Nov 2026: only "act now"
 * counts): Approved, fee pending · Not followed up — and only tutors staff can
 * reach (a verified mobile on file).
 */
export function feePendingDue(p: PipeCard): boolean {
  return p.stage === 'approved' && followUpDue(p) && !p.noMobile
}

/** Ready for review (lib/tutorPipelineCore docsReadyForReview) from the
 *  document facts and the profile completion. */
export function readyForReviewFrom(docs: PipeDocFacts | null | undefined, completion: number): boolean {
  return docsReadyForReview(pipeDocsOf(docs), completion)
}

const BLANK_NAME = { photo: 'Profile photo', selfie: 'Selfie' } as const

/** "Photo looks blank: Selfie" — which current photo(s) staff should look at. */
export function blankLine(p: Pick<PipeCard, 'blank'>): string | null {
  const b = p.blank ?? []
  if (b.length === 0) return null
  return `Photo looks blank: ${b.map((k) => BLANK_NAME[k]).join(', ')}`
}

/**
 * The card's ONE status line (owner, 9 Nov 2026), built only from the card so
 * it can never disagree with the stage:
 *   missing   "Missing: CNIC, Selfie · Profile 64%"; with an upload waiting
 *             "CNIC waiting approval · Selfie missing · Profile 64%"; all
 *             uploaded but under 80%: "… · Profile 64% (80% needed for review)"
 *   waiting   "Waiting approval: CNIC, Selfie · Profile 90%"
 *   rejected  "Rejected: Selfie (blurry) · Profile 70% · Informed: no"
 *   approved  "Documents approved · fee pending · Profile 95%"
 *   paid      "Fee paid · Profile 100%" (plus anything still waiting)
 */
export function pipeStatusLine(p: PipeCard): string {
  const pct = typeof p.completion === 'number' ? `Profile ${p.completion}%` : null
  const pending = p.pending ?? []
  const parts: string[] = []
  if (p.stage === 'missing') {
    if (pending.length === 0) parts.push(`Missing: ${p.missing.length ? p.missing.join(', ') : 'documents'}`)
    else parts.push(...pending.map((n) => `${n} waiting approval`), ...p.missing.map((n) => `${n} missing`))
    if (pct) parts.push(p.missing.length === 0 && pending.length > 0 ? `${pct} (80% needed for review)` : pct)
  } else if (p.stage === 'waiting') {
    parts.push(`Waiting approval: ${pending.join(', ') || 'documents'}`)
    if (pct) parts.push(pct)
  } else if (p.stage === 'rejected') {
    parts.push(`Rejected: ${p.rejected.map((r) => (r.reason ? `${r.name} (${r.reason})` : r.name)).join(', ')}`)
    parts.push(...pending.map((n) => `${n} waiting approval`), ...p.missing.map((n) => `${n} missing`))
    if (pct) parts.push(pct)
    parts.push(`Informed: ${p.informed ? 'yes' : 'no'}`)
  } else if (p.stage === 'approved') {
    parts.push('Documents approved · fee pending')
    if (pct) parts.push(pct)
  } else {
    parts.push('Fee paid', ...pending.map((n) => `${n} waiting approval`))
    if (pct) parts.push(pct)
  }
  return parts.join(' · ')
}

/** "Copy profile link" and "Share on WhatsApp" only for a tutor who has paid
 *  the Verification Fee (owner, 9 Nov 2026) — an unpaid profile is not public. */
export function showProfileShare(feePaid: boolean | null | undefined): boolean {
  return feePaid === true
}

/** The line for a tutor nobody can reach. */
export const NO_MOBILE_LINE = "No mobile number — can't follow up"

/** The tags a card is stored with (admin_list_rows). */
export function pipeTags(p: PipeCard): { stage: PipeStage; fu: 'not' | 'done' | 'na'; ni: boolean; informed: boolean } {
  return { stage: p.stage, fu: p.section ?? 'na', ni: p.notInterested, informed: p.informed }
}

/** The stored sort time: Waiting oldest upload first, Followed up soonest due
 *  first; paused accounts have none (they sort last). */
export function pipeSortAt(p: PipeCard): string | null {
  // No mobile on file sorts last in the stage too (owner, 9 Nov 2026).
  if (p.paused || p.noMobile) return null
  if (p.stage === 'waiting') return p.oldestUploadAt
  if (p.section === 'done') return p.follow?.dueAt ?? null
  return null
}
