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
  followState,
  isFollowStage,
  missingDocs,
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
  docs: PipeDocFacts | null | undefined
  contacts: PipeContact[]
  notInterested: boolean
  paused: boolean
  lastActiveAt: string | null
  support: string | null
  nowMs: number
}): PipeCard {
  const d = pipeDocsOf(a.docs)
  const stage = pipelineStage({ ...d, feePaid: a.feePaid })
  const missing = missingDocs(d)
  const rejected = rejectedDocs(d, d.reasons)
  const follow = isFollowStage(stage) ? followState(stage, a.contacts, a.nowMs) : null
  const lc = newest(a.contacts)
  return {
    stage,
    section: follow ? follow.section : null,
    missing,
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

/** The tags a card is stored with (admin_list_rows). */
export function pipeTags(p: PipeCard): { stage: PipeStage; fu: 'not' | 'done' | 'na'; ni: boolean; informed: boolean } {
  return { stage: p.stage, fu: p.section ?? 'na', ni: p.notInterested, informed: p.informed }
}

/** The stored sort time: Waiting oldest upload first, Followed up soonest due
 *  first; paused accounts have none (they sort last). */
export function pipeSortAt(p: PipeCard): string | null {
  if (p.paused) return null
  if (p.stage === 'waiting') return p.oldestUploadAt
  if (p.section === 'done') return p.follow?.dueAt ?? null
  return null
}
