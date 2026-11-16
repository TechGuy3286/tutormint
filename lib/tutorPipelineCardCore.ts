// lib/tutorPipelineCardCore.ts
//
// PURE, client-safe. One tutor's People → Tutors pipeline card (owner, 8 Nov
// 2026), built from facts the server loads (lib/tutorPipeline): the stage, what
// is missing or rejected, where the follow-ups stand and the stage's WhatsApp
// text. The stored list tags and the badge / Overview counts read the SAME
// helpers here, so a count is always the length of its view.
//
// Unit-tested by scripts/test-tutor-pipeline.ts.

import { planTag, type PaidPlanTag, type UpgradeHeld } from '@/lib/upgradePlanCore'
import { firstNameOf } from '@/lib/staffOutreachCore'
import { itemState } from '@/lib/tutorDocSummaryCore'
import type { CardDocState, CardStatuses } from '@/lib/tutorDocQueueCore'
import type { Welcome } from '@/lib/paidWelcomeCore'
import type { NiMark } from '@/lib/notInterestedCore'
import {
  ATTEMPT_LABEL,
  docsReadyForReview,
  followState,
  followTag,
  KIND_LABEL,
  retryPending,
  REUPLOADED,
  type CallAttempt,
  type PipeKind,
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
  FU_TRIED,
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
  follow: (Pick<FollowState, 'sent' | 'nextNumber' | 'nextKind' | 'dueAt'> & { retryAt?: string | null }) | null
  lastContact: { at: string; kind: string; by: string | null } | null
  /** The newest call attempt ("No answer", "Wrong number") after the last
   *  follow-up of this stage (owner, 15 Nov 2026). */
  lastAttempt?: { at: string; outcome: CallAttempt; by: string | null } | null
  /** Uploaded a new document after a rejection, not yet decided (owner, 15 Nov
   *  2026): tagged "Re-uploaded", top of the stage; clears on the decision. */
  reuploaded?: boolean
  /** Approved, fee pending: when the CNIC and photo were approved. */
  approvedAt?: string | null
  /** Started a Verification Fee payment that never completed and has not paid
   *  since (owner, 15 Nov 2026): the "Tried to pay" chip in Approved, fee pending. */
  triedToPay?: boolean
  /** The stage's WhatsApp text (no number in it). */
  message: string | null
  notInterested: boolean
  /** The live Not interested mark — reason, note, who, when (owner, 11 Nov 2026). */
  niMark?: NiMark | null
  paused: boolean
  lastActiveAt: string | null
  oldestUploadAt: string | null
  /** Paid cards (owner, 9 Nov 2026): when the Verification Fee was paid, whether
   *  the CNIC and profile photo are approved (the status image needs it — the
   *  selfie is optional since 12 Nov 2026), and the standing welcome. Older
   *  stored rows have none until the next run. */
  paidAt?: string | null
  badge?: boolean
  /** The optional selfie is approved: "Selfie checked ✓" (staff and the tutor
   *  only — never a public badge; owner, 12 Nov 2026). */
  selfieChecked?: boolean
  welcome?: Welcome | null
  /** A paid tutor's Premium / Featured upgrade and its end date (owner, 10 Nov
   *  2026); none = Verified. Older stored rows have none until the next run. */
  plan?: UpgradeHeld | null
}

/** The document facts a card is built from (lib/tutorDocSummaries CardDocs). */
export type PipeDocFacts = { statuses: CardStatuses; oldestUploadAt: string | null; approvedAt?: string | null }

/**
 * A rejected document was replaced and the new one waits for a decision (owner,
 * 15 Nov 2026). A new file after a rejection goes back to waiting and KEEPS the
 * rejection reason (lib/docUploadStatusCore), so "waiting with a reason on
 * record" is the re-upload. Any decision — approve or reject — ends it.
 */
export function reuploadedAfterRejection(statuses: CardStatuses | null | undefined): boolean {
  if (!statuses) return false
  return [statuses.cnic, statuses.profilePic, statuses.selfie].some(
    (s) => itemState(s) === 'waiting' && !s.rereview && typeof s.reason === 'string' && s.reason.trim() !== '',
  )
}

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
  niMark?: NiMark | null
  paused: boolean
  lastActiveAt: string | null
  support: string | null
  nowMs: number
  paidAt?: string | null
  welcome?: Welcome | null
  plan?: UpgradeHeld | null
  /** lib/paymentAttemptsCore triedToPay. */
  triedToPay?: boolean
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
    follow: follow ? { sent: follow.sent, nextNumber: follow.nextNumber, nextKind: follow.nextKind, dueAt: follow.dueAt, retryAt: follow.retryAt ?? null } : null,
    lastContact: lc ? { at: lc.at, kind: lc.kind, by: lc.staffName } : null,
    lastAttempt: follow?.lastAttempt ?? null,
    reuploaded: reuploadedAfterRejection(a.docs?.statuses),
    approvedAt: stage === 'approved' ? (a.docs?.approvedAt ?? null) : null,
    triedToPay: stage === 'approved' && !!a.triedToPay,
    message: isFollowStage(stage) ? pipeMessage(stage, { firstName: firstNameOf(a.name), missing, rejected, supportWhatsapp: a.support }) : null,
    notInterested: a.notInterested,
    niMark: a.notInterested ? (a.niMark ?? null) : null,
    paused: a.paused,
    lastActiveAt: a.lastActiveAt,
    oldestUploadAt: a.docs?.oldestUploadAt ?? null,
    paidAt: a.feePaid ? (a.paidAt ?? null) : null,
    badge: a.feePaid && d.cnic === 'approved' && d.photo === 'approved',
    selfieChecked: d.selfie === 'approved',
    welcome: a.feePaid ? (a.welcome ?? null) : null,
    plan: a.feePaid ? (a.plan ?? null) : null,
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
    follow: { sent: f.sent, nextNumber: f.nextNumber, nextKind: f.nextKind, dueAt: f.dueAt, retryAt: f.retryAt ?? null },
    lastContact: lc ? { at: lc.at, kind: lc.kind, by: lc.staffName } : null,
    lastAttempt: f.lastAttempt ?? null,
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
export function feePendingDue(p: PipeCard, nowMs = Date.now()): boolean {
  // "No answer" today: due again tomorrow, not an act-now item until then (owner, 15 Nov 2026).
  return p.stage === 'approved' && followUpDue(p) && !p.noMobile && !retryPending({ section: p.section, retryAt: p.follow?.retryAt ?? null }, nowMs)
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
 *   missing   "Missing: CNIC, Profile photo · Profile 64%"; with an upload
 *             waiting "CNIC waiting approval · Profile photo missing · …"; all
 *             uploaded but under 80%: "… · Profile 64% (80% needed for review)"
 *   waiting   "Waiting approval: CNIC, Selfie · Profile 90%"
 *   rejected  "Rejected: CNIC (blurry) · Profile 70% · Informed: no"
 * (The selfie is optional: it is never "missing"; an uploaded one waiting for
 * review is still named.)
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

/** The tags a card is stored with (admin_list_rows). `stages` and `fus` are
 *  ARRAY tags (admin_list_page matches an element) behind the stage row (with
 *  its "Re-uploaded" chip) and the follow-up chips (owner, 15 Nov 2026); `stage`
 *  and `fu` stay as they were for older readers. */
export function pipeTags(p: PipeCard): {
  stage: PipeStage
  stages: string[]
  fu: 'not' | 'done' | 'na'
  fus: string[]
  reup: boolean
  ni: boolean
  informed: boolean
  plan: PaidPlanTag | 'na'
} {
  return {
    stage: p.stage,
    stages: p.reuploaded ? [p.stage, REUPLOADED] : [p.stage],
    fu: p.section ?? 'na',
    fus: [...followTag({ section: p.section, sent: p.follow?.sent ?? 0 }), ...(p.stage === 'approved' && p.triedToPay ? [FU_TRIED] : [])],
    reup: !!p.reuploaded,
    ni: p.notInterested,
    informed: p.informed,
    plan: planTag(p.stage, p.plan),
  }
}

/** A re-upload sorts before everyone when the list is in sort-time order. */
export const REUPLOAD_SORT_AT = '1970-01-01T00:00:00.000Z'

/** The stored sort time: a re-upload first, Waiting oldest upload first,
 *  Followed up soonest due first; paused accounts have none (they sort last). */
export function pipeSortAt(p: PipeCard): string | null {
  // No mobile on file sorts last in the stage too (owner, 9 Nov 2026).
  if (p.paused || p.noMobile) return null
  if (p.reuploaded) return REUPLOAD_SORT_AT
  if (p.stage === 'waiting') return p.oldestUploadAt
  if (p.section === 'done') return p.follow?.dueAt ?? null
  return null
}

// ------------------------------------------- compact card (15 Nov 2026) ---
//
// One meta line, one "what's missing" line where it helps, one last-outcome
// line. The stage itself is the chip the staff member picked, so the card does
// not repeat it.

const DAY_MS = 86_400_000

/** "Multan · joined 8 Nov · 94%". */
export function pipeMetaLine(a: { city: string | null; joinedAt: string | null; completion: number | null | undefined }, dayText: (iso: string) => string): string {
  const parts: string[] = []
  if (a.city?.trim()) parts.push(a.city.trim())
  if (a.joinedAt) parts.push(`joined ${dayText(a.joinedAt)}`)
  if (typeof a.completion === 'number') parts.push(`${a.completion}%`)
  return parts.join(' · ')
}

/** Whole days since an instant (0 = today). */
export function daysSince(iso: string | null | undefined, nowMs: number): number | null {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((nowMs - t) / DAY_MS))
}

/** "Approved 3 days ago" / "Approved today". */
export function approvedAgoLine(approvedAt: string | null | undefined, nowMs: number): string | null {
  const d = daysSince(approvedAt, nowMs)
  if (d === null) return null
  return d === 0 ? 'Approved today' : `Approved ${d} ${d === 1 ? 'day' : 'days'} ago`
}

/**
 * What the staff member needs beyond the stage chip, or null:
 *   missing   "Missing: CNIC" (and anything waiting / "80% needed for review")
 *   rejected  "Rejected: CNIC (blurry) · Informed: no"
 *   waiting   "Waiting: CNIC, Selfie"
 *   approved  "Approved 3 days ago"
 *   paid      anything still waiting
 */
export function pipeDetailLine(p: PipeCard, nowMs: number): string | null {
  const pending = p.pending ?? []
  const parts: string[] = []
  if (p.stage === 'missing') {
    if (p.missing.length) parts.push(`Missing: ${p.missing.join(', ')}`)
    if (pending.length) parts.push(`Waiting: ${pending.join(', ')}`)
    if (p.missing.length === 0 && pending.length > 0) parts.push('80% needed for review')
  } else if (p.stage === 'rejected') {
    parts.push(`Rejected: ${p.rejected.map((r) => (r.reason ? `${r.name} (${r.reason})` : r.name)).join(', ')}`)
    if (p.missing.length) parts.push(`Missing: ${p.missing.join(', ')}`)
    parts.push(`Informed: ${p.informed ? 'yes' : 'no'}`)
  } else if (p.stage === 'waiting') {
    if (pending.length) parts.push(`Waiting: ${pending.join(', ')}`)
  } else if (p.stage === 'approved') {
    const ago = approvedAgoLine(p.approvedAt, nowMs)
    if (ago) parts.push(ago)
  } else if (pending.length) {
    parts.push(`Waiting: ${pending.join(', ')}`)
  }
  return parts.length ? parts.join(' · ') : null
}

/**
 * The last outcome and what is next (owner, 15 Nov 2026):
 *   "11 Nov · WhatsApp by Alee · Follow-up 2 due"
 *   "15 Nov · No answer by Alee · try again 16 Nov"
 *   "Never contacted · Follow-up 1 due"
 * null outside a followed-up stage.
 */
export function lastOutcomeLine(p: PipeCard, dayText: (iso: string) => string, nowMs: number): string | null {
  const f = p.follow
  if (!f || p.notInterested) return null
  const att = p.lastAttempt ?? null
  const lc = p.lastContact
  const useAttempt = !!att && (!lc || Date.parse(att.at) >= Date.parse(lc.at))
  const last = useAttempt
    ? `${dayText(att!.at)} · ${ATTEMPT_LABEL[att!.outcome]}${att!.by ? ` by ${att!.by}` : ''}`
    : lc
      ? `${dayText(lc.at)} · ${KIND_LABEL[lc.kind as PipeKind] ?? lc.kind}${lc.by ? ` by ${lc.by}` : ''}`
      : 'Never contacted'
  let next: string
  if (p.section === 'done') next = `Follow-up ${f.nextNumber} due ${f.dueAt ? dayText(f.dueAt) : 'soon'}`
  else if (retryPending({ section: p.section, retryAt: f.retryAt ?? null }, nowMs)) next = `try again ${dayText(f.retryAt as string)}`
  else next = `Follow-up ${f.nextNumber} due`
  return `${last} · ${next}`
}

/** The chip on a re-upload. */
export const REUPLOADED_LABEL = 'Re-uploaded'
