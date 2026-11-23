// lib/tutorPipelineCore.ts
//
// PURE, client-safe. ONE tutor pipeline on People (owner, 8 Nov 2026): People
// and Follow-ups became one page, and the many overlapping tutor chips
// ("Partly approved", "Approved", "Closest to paying", Paid / Unpaid…) became
// a few stages. Each tutor is in exactly ONE stage, decided in this order:
//
//   paid      Verification Fee paid. No follow-up.
//   rejected  the CNIC or the profile photo rejected and not re-uploaded.
//   waiting   both uploaded, at least one waiting for a decision. A staff
//             action (Review), not a follow-up.
//   missing   at least one not uploaded (nothing waiting or rejected).
//   approved  CNIC and profile photo approved, fee not paid ("Approved, fee
//             pending").
// THE SELFIE IS OPTIONAL (owner, 12 Nov 2026): it never decides a stage and is
// never "missing". An uploaded selfie still waits for review, and an approved
// one shows "Selfie checked" on the card.
//
// Erased accounts are not in any stage: they are only under the grey
// "Deleted" chip (lib/peopleDirectoryCore peopleFixed).
//
// Follow-ups (missing, rejected, approved), until the tutor pays or staff mark
// "Not interested":
//   Follow-up 1   a WhatsApp message, due at once.
//   Follow-up 2   a WhatsApp voice note, due 2 days after Follow-up 1.
//   Follow-up 3+  WhatsApp or a call, every 3 days.
// A tutor is "Not followed up" when never contacted in this stage or the next
// follow-up is due now; otherwise "Followed up". Moving to a new stage starts
// again at Follow-up 1. For Rejected, the first WhatsApp means "Informed: yes".
//
// Contacts recorded before this change (Follow-ups taps, logged calls, call or
// WhatsApp notes) count towards the tutor's current stage, so nobody already
// contacted shows as never contacted. A contact recorded here carries its
// stage (`pipe:<stage>` in member_follow_ups.progress); a contact of another
// stage ends the run — everything before it belongs to that earlier stage.
//
// Unit-tested by scripts/test-tutor-pipeline.ts.

import { siteLink } from '@/lib/waLinkCore'

const DAY = 86_400_000

export const FIRST_GAP_DAYS = 2
export const LATER_GAP_DAYS = 3

export type DocState = 'approved' | 'waiting' | 'rejected' | 'none'

export const PIPE_STAGES = ['missing', 'waiting', 'rejected', 'approved', 'paid'] as const
/** The stage row's "Re-uploaded" chip (owner, 15 Nov 2026): tutors who uploaded
 *  a new document after a rejection, whatever their stage. */
export const REUPLOADED = 'reuploaded'
export type PipeStage = (typeof PIPE_STAGES)[number]
/** The stages staff follow up. */
export const FOLLOW_STAGES = ['missing', 'rejected', 'approved'] as const
export type FollowStage = (typeof FOLLOW_STAGES)[number]

export const STAGE_LABEL: Record<PipeStage, string> = {
  missing: 'Documents missing',
  waiting: 'Waiting for approval',
  rejected: 'Rejected',
  approved: 'Approved, fee pending',
  paid: 'Paid',
}

export function isPipeStage(v: unknown): v is PipeStage {
  return (PIPE_STAGES as readonly string[]).includes(v as string)
}
export function isFollowStage(v: unknown): v is FollowStage {
  return (FOLLOW_STAGES as readonly string[]).includes(v as string)
}

export type PipeDocs = { cnic: DocState; photo: DocState; selfie: DocState }
/** completion = profiles.profile_completion (lib/profileRequired). */
export type PipeFacts = PipeDocs & { feePaid: boolean; completion: number }

const DOCS = ['cnic', 'photo', 'selfie'] as const
/** The documents a stage needs; the selfie is optional (owner, 12 Nov 2026). */
const REQUIRED = ['cnic', 'photo'] as const
export const DOC_NAME: Record<(typeof DOCS)[number], string> = { cnic: 'CNIC', photo: 'Profile photo', selfie: 'Selfie' }

/** A tutor's documents are ready for staff review only from this profile
 *  completion up (owner, 9 Nov 2026). */
export const WAITING_MIN_COMPLETION = 80

/**
 * The "Waiting for approval" STAGE (owner, 9 Nov 2026; selfie optional 12 Nov):
 * CNIC and profile photo both uploaded, at least one of them waiting for a
 * decision, neither rejected, and the profile 80% complete or more.
 */
export function requiredReadyForReview(d: PipeDocs, completion: number): boolean {
  const s = REQUIRED.map((k) => d[k])
  return !s.includes('none') && !s.includes('rejected') && s.includes('waiting') && completion >= WAITING_MIN_COMPLETION
}

/**
 * Ready for review — the documents' rule behind the Overview "Documents to
 * approve" tutor rows and the People badge's waiting count: CNIC and profile
 * photo uploaded and neither rejected, the profile 80% or more, and something
 * waiting — the CNIC, the photo, or an (optional) selfie the tutor added. A
 * paid tutor with a re-upload waiting is counted too, though their stage is
 * Paid.
 */
export function docsReadyForReview(d: PipeDocs, completion: number): boolean {
  const req = REQUIRED.map((k) => d[k])
  if (req.includes('none') || req.includes('rejected') || completion < WAITING_MIN_COMPLETION) return false
  return req.includes('waiting') || d.selfie === 'waiting'
}

/** The ONE stage — precedence Paid → Rejected → Waiting → Missing → Approved.
 *  A tutor with a document waiting who is not ready for review (one not
 *  uploaded, or the profile under 80%) is in Documents missing. */
export function pipelineStage(f: PipeFacts): PipeStage {
  if (f.feePaid) return 'paid'
  const s = REQUIRED.map((k) => f[k])
  if (s.includes('rejected')) return 'rejected'
  if (requiredReadyForReview(f, f.completion)) return 'waiting'
  if (s.includes('none') || s.includes('waiting')) return 'missing'
  return 'approved'
}

/** "CNIC, Profile photo" — the REQUIRED documents not uploaded (never the
 *  optional selfie). */
export function missingDocs(f: PipeDocs): string[] {
  return REQUIRED.filter((k) => f[k] === 'none').map((k) => DOC_NAME[k])
}

/** The documents uploaded and waiting for a decision. */
export function pendingDocs(f: PipeDocs): string[] {
  return DOCS.filter((k) => f[k] === 'waiting').map((k) => DOC_NAME[k])
}

/** The REQUIRED documents rejected — an optional selfie's rejection is shown on
 *  its own review card, not in the stage. */
export function rejectedDocs(f: PipeDocs, reasons: Partial<Record<(typeof DOCS)[number], string | null>> = {}): { name: string; reason: string | null }[] {
  return REQUIRED.filter((k) => f[k] === 'rejected').map((k) => ({ name: DOC_NAME[k], reason: reasons[k] ?? null }))
}

// ------------------------------------------------------------ contacts ---

/** 'inbox' = a Team inbox message sent to the tutor (owner, 15 Nov 2026). */
/** 'claim' = "I'm on it" (PR-18 C.4): a follow-up of the stage, never offered as a card button. */
export type PipeKind = 'whatsapp' | 'voice' | 'call' | 'inbox' | 'claim'
export const PIPE_KINDS = ['whatsapp', 'voice', 'call', 'inbox'] as const
export const KIND_LABEL: Record<PipeKind, string> = { whatsapp: 'WhatsApp', voice: 'Voice note', call: 'Call', inbox: 'Team inbox', claim: "I'm on it" }

/** The template key stored with a follow-up recorded here. */
export function pipeTemplateKey(stage: FollowStage, kind: PipeKind): string {
  return `pipe_${stage}_${kind}`
}
/** The progress value stored with it — carries the stage. */
export function pipeProgress(stage: FollowStage): string {
  return `pipe:${stage}`
}
export function stageOfProgress(progress: string | null | undefined): FollowStage | null {
  const m = /^pipe:(missing|rejected|approved)$/.exec(progress ?? '')
  return m ? (m[1] as FollowStage) : null
}
export function kindOfTemplateKey(key: string | null | undefined): PipeKind | null {
  const m = /^pipe_(?:missing|rejected|approved)_(whatsapp|voice|call|inbox|claim)$/.exec(key ?? '')
  return m ? (m[1] as PipeKind) : null
}

/** One contact with a tutor, as the pipeline reads it. */
export type PipeContact = {
  at: string
  /** The channel: a WhatsApp message, a voice note, a call (a note of a call
   *  or WhatsApp is read as its kind). */
  kind: PipeKind
  /** The stage it was recorded in; null = recorded before this change. */
  stage: FollowStage | null
  /** An older Follow-ups tap's progress snapshot said documents were all
   *  approved (`…|…|…|1`); null = no snapshot. */
  docsApproved: boolean | null
  staffName: string | null
  /** A call that did NOT reach the tutor (owner, 15 Nov 2026): "No answer" or
   *  "Wrong number". An attempt is logged and shown, but it is never a
   *  follow-up: it does not count, and the tutor stays in Not followed up. */
  attempt?: CallAttempt | null
}

/** The call outcomes that are attempts, not follow-ups. */
export const CALL_ATTEMPTS = ['no_answer', 'wrong_number'] as const
export type CallAttempt = (typeof CALL_ATTEMPTS)[number]
export const ATTEMPT_LABEL: Record<CallAttempt, string> = { no_answer: 'No answer', wrong_number: 'Wrong number' }
/** Kept for older readers. Since 16 Nov 2026 (PR-02) EVERY "No answer" /
 *  "Wrong number" row is an attempt, whatever its date — the owner: "No answer
 *  attempts don't count". (Before, rows older than this counted as calls.) */
export const CALL_OUTCOMES_FROM = '2026-11-15T00:00:00.000Z'
/** After "No answer" the tutor is due again the next day. */
export const RETRY_GAP_DAYS = 1

/** A tutor_contact_logs row as the pipeline reads it: an attempt ("no answer"
 *  / "wrong number", any date), or null = a call that counts. */
export function callLogAttempt(outcome: string | null | undefined, _at?: string | null): CallAttempt | null {
  return outcome === 'no_answer' || outcome === 'wrong_number' ? outcome : null
}

/**
 * Follow-up numbering (owner, 16 Nov 2026 — PR-02). A tutor approved today
 * showed "Follow-up 9 due": every contact made BEFORE they entered the stage
 * (older Follow-ups taps, the "documents approved" WhatsApp, calls) was counted,
 * and repeat taps seconds apart counted as separate follow-ups. Now:
 *   - only contacts made since the tutor entered the CURRENT stage count (a
 *     few minutes' grace: the "documents approved" message can be sent just
 *     before the last approval is stamped);
 *   - more than one contact on the same Pakistan-time day is ONE follow-up;
 *   - a call that did not reach them is never a follow-up.
 * A stage change (e.g. documents approved) therefore restarts at Follow-up 1.
 */
export const ENTRY_GRACE_MS = 10 * 60_000

/** The Pakistan-time calendar day of an instant ("2026-11-16"). */
export function pkDay(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t + 5 * 3_600_000).toISOString().slice(0, 10) : ''
}

/** Made since the tutor entered the stage (null = no entry date known). */
export function sinceEntry(at: string, enteredAt: string | null | undefined): boolean {
  if (!enteredAt) return true
  const e = Date.parse(enteredAt)
  if (!Number.isFinite(e)) return true
  return Date.parse(at) >= e - ENTRY_GRACE_MS
}

/** Read an older Follow-ups progress snapshot (`step|pct|fee|docsApproved`). */
export function legacyDocsApproved(progress: string | null | undefined): boolean | null {
  const parts = (progress ?? '').split('|')
  if (parts.length !== 4) return null
  return parts[3] === '1'
}

const ts = (iso: string | null | undefined) => {
  const v = iso ? Date.parse(iso) : NaN
  return Number.isFinite(v) ? v : NaN
}

/** The contacts that belong to the tutor's current stage, newest first.
 *  `enteredAt` = when the tutor entered it (contacts before then are another
 *  stage's — PR-02). */
export function contactsInStage(contacts: PipeContact[], stage: FollowStage, enteredAt?: string | null): PipeContact[] {
  const sorted = contacts.filter((c) => Number.isFinite(ts(c.at))).sort((a, b) => ts(b.at) - ts(a.at))
  const out: PipeContact[] = []
  for (const c of sorted) {
    if (c.attempt) continue // an attempt is never a follow-up
    if (!sinceEntry(c.at, enteredAt)) break // before the tutor entered this stage
    if (c.stage !== null && c.stage !== stage) break // an earlier stage — it and everything before it are not this stage's
    if (c.stage === null && c.docsApproved !== null) {
      // An older tap with a snapshot: count it only where it fits.
      if (stage === 'approved' && !c.docsApproved) continue
      if (stage !== 'approved' && c.docsApproved) continue
    }
    out.push(c)
  }
  return out
}

export type FollowState = {
  /** Follow-ups sent in this stage. */
  sent: number
  /** The next follow-up's number (sent + 1) and what it is. */
  nextNumber: number
  nextKind: 'whatsapp' | 'voice' | 'either'
  /** When the next one is due (null = due now: never contacted). */
  dueAt: string | null
  /** 'not' = Not followed up (due now); 'done' = Followed up. */
  section: 'not' | 'done'
  last: PipeContact | null
  /** Rejected: a WhatsApp (message or voice note) was sent in this stage. */
  informed: boolean
  /** The newest call attempt of this stage after its last follow-up (owner,
   *  15 Nov 2026), and when the tutor is due again (the next day). */
  lastAttempt?: { at: string; outcome: CallAttempt; by: string | null } | null
  retryAt?: string | null
}

/** The call attempts of the current stage made after its last follow-up,
 *  newest first. An attempt older than a contact of another stage is that
 *  stage's, and one older than a follow-up is done with. */
export function stageAttempts(contacts: PipeContact[], stage: FollowStage, enteredAt?: string | null): PipeContact[] {
  const sorted = contacts.filter((c) => Number.isFinite(ts(c.at))).sort((a, b) => ts(b.at) - ts(a.at))
  const out: PipeContact[] = []
  for (const c of sorted) {
    if (!sinceEntry(c.at, enteredAt)) break
    if (!c.attempt) {
      if (c.stage !== null && c.stage !== stage) break
      if (contactsInStage([c], stage, enteredAt).length > 0) break
      continue
    }
    out.push(c)
  }
  return out
}

/** The follow-ups of a stage: its contacts (newest first), with every contact
 *  on the same Pakistan-time day as a later one folded into it. The count is
 *  `.length`; [0] is the newest contact (the due date runs from it). */
export function followUpsInStage(contacts: PipeContact[], stage: FollowStage, enteredAt?: string | null): PipeContact[] {
  const out: PipeContact[] = []
  const days = new Set<string>()
  for (const c of contactsInStage(contacts, stage, enteredAt)) {
    const d = pkDay(c.at)
    if (days.has(d)) continue
    days.add(d)
    out.push(c)
  }
  return out
}

export function nextKindFor(n: number): FollowState['nextKind'] {
  return n === 1 ? 'whatsapp' : n === 2 ? 'voice' : 'either'
}

/** Where a tutor stands in their stage's sequence. */
export function followState(stage: FollowStage, contacts: PipeContact[], nowMs: number, enteredAt?: string | null): FollowState {
  const all = contactsInStage(contacts, stage, enteredAt)
  const sent = followUpsInStage(contacts, stage, enteredAt).length
  const last = all[0] ?? null
  const informed = all.some((c) => c.kind === 'whatsapp' || c.kind === 'voice')
  const nextNumber = sent + 1
  const att = stageAttempts(contacts, stage, enteredAt)[0] ?? null
  const lastAttempt = att?.attempt ? { at: att.at, outcome: att.attempt, by: att.staffName } : null
  const retryAt = att ? new Date(ts(att.at) + RETRY_GAP_DAYS * DAY).toISOString() : null
  if (!last) return { sent, nextNumber, nextKind: nextKindFor(nextNumber), dueAt: null, section: 'not', last, informed, lastAttempt, retryAt }
  const gap = (sent === 1 ? FIRST_GAP_DAYS : LATER_GAP_DAYS) * DAY
  const due = ts(last.at) + gap
  return {
    sent,
    nextNumber,
    nextKind: nextKindFor(nextNumber),
    dueAt: new Date(due).toISOString(),
    section: nowMs >= due ? 'not' : 'done',
    last,
    informed,
    lastAttempt,
    retryAt,
  }
}

/** "No answer" today: still in Not followed up, but due again tomorrow — not
 *  an act-now item until then. */
export function retryPending(state: { section: 'not' | 'done' | null; retryAt?: string | null }, nowMs: number): boolean {
  return state.section === 'not' && !!state.retryAt && ts(state.retryAt) > nowMs
}

// ------------------------------------------- follow-up chips (15 Nov) ---

/** The follow-up chips of a followed-up stage (owner, 15 Nov 2026): who is due
 *  now, and who is waiting after their 1st, 2nd or 3rd+ follow-up in this
 *  stage. The numbered chips hold people whose next follow-up is not due yet;
 *  when it is due they are back in "Not followed up". */
export const FU_BUCKETS = ['not', 'f1', 'f2', 'f3'] as const
export type FuBucket = (typeof FU_BUCKETS)[number]
export const FU_BUCKET_LABEL: Record<FuBucket, string> = {
  not: 'Not followed up (due now)',
  f1: '1st follow-up',
  f2: '2nd follow-up',
  f3: '3rd+ follow-up',
}
/** The old "Followed up" chip (?fu=done): every numbered chip together. */
export const FU_DONE = 'done'

/**
 * Each chip's rule in one plain line (owner, 16 Nov 2026 — PR-02), shown as
 * the chip's tooltip. Real tutors only: staff, test, deleted and Not
 * interested accounts are counted under their own chips.
 */
export const CHIP_HINT = {
  all: 'Every tutor, each in exactly one stage — the stages add up to this number.',
  missing: 'The CNIC or profile photo is not uploaded yet, or the profile is under 80% with a document waiting.',
  waiting: 'CNIC and profile photo uploaded, one waiting for our decision, and the profile 80% or more.',
  rejected: 'The CNIC or profile photo was rejected and has not been uploaded again.',
  approved: 'CNIC and profile photo approved; the Verification Fee is not paid yet.',
  paid: 'The Verification Fee is paid.',
  reuploaded: 'Uploaded a new document after a rejection; we have not decided on it yet.',
  not: 'Never contacted in this stage, or their next follow-up date has arrived.',
  f1: 'Had 1 follow-up in this stage; the next one is not due yet.',
  f2: 'Had 2 follow-ups in this stage; the next one is not due yet.',
  f3: 'Had 3 or more follow-ups in this stage; the next one is not due yet.',
  tried: 'Started a Verification Fee payment, did not finish, and a follow-up is due now.',
  approvedToday: 'CNIC and profile photo approved today (Pakistan time), fee not paid, not contacted in this stage yet. Leaves this chip after the first follow-up.',
  ni: 'Marked Not interested — counted here only, never in the chips above.',
  deleted: 'Accounts erased at the member’s request — counted here only.',
  staffTest: 'Staff and test accounts — never counted in the chips.',
} as const

/** Approved, fee pending: started a Verification Fee payment that never
 *  completed (owner, 15 Nov 2026 — lib/paymentAttemptsCore). Its own chip in
 *  that stage's follow-up row, and first within Not followed up. */
export const FU_TRIED = 'tried'
export const FU_TRIED_LABEL = 'Tried to pay'

/** Approved, fee pending: documents approved TODAY (Pakistan time) and not
 *  contacted in this stage yet (owner, 18 Nov 2026 — PR-07). A subset of Not
 *  followed up (due now), like Tried to pay; first in that chip. */
export const FU_APPROVED_TODAY = 'approved_today'
export const FU_APPROVED_TODAY_LABEL = 'Approved today'

/** Approved on the Pakistan date holding `nowMs`. */
export function approvedOnPkDay(approvedAt: string | null | undefined, nowMs: number): boolean {
  if (!approvedAt) return false
  const d = pkDay(approvedAt)
  return d !== '' && d === pkDay(new Date(nowMs).toISOString())
}

export function followBucket(state: { section: 'not' | 'done' | null; sent: number }): FuBucket | null {
  if (state.section === null) return null
  if (state.section === 'not') return 'not'
  return state.sent <= 1 ? 'f1' : state.sent === 2 ? 'f2' : 'f3'
}

/** The stored follow-up tag: ['not'], or ['done', 'f1' | 'f2' | 'f3'] so an
 *  old ?fu=done address still lists everyone followed up. */
export function followTag(state: { section: 'not' | 'done' | null; sent: number }): string[] {
  const b = followBucket(state)
  if (!b) return ['na']
  return b === 'not' ? ['not'] : [FU_DONE, b]
}

/** Is a recorded kind allowed for the next follow-up? */
export function kindAllowed(nextKind: FollowState['nextKind'], kind: PipeKind): boolean {
  // A call that reached them ("Yes, talked") and a Team inbox message always
  // count (owner, 15 Nov 2026): Call sits beside every due button.
  if (kind === 'call' || kind === 'inbox' || kind === 'claim') return true
  if (nextKind === 'whatsapp') return kind === 'whatsapp'
  if (nextKind === 'voice') return kind === 'voice'
  return kind === 'whatsapp'
}

/** "Follow-up 2 sent · next due 10 Nov". */
export function sentLine(state: Pick<FollowState, 'sent' | 'dueAt'>, dateText: (iso: string) => string): string {
  if (state.sent === 0) return 'Never contacted'
  return `Follow-up ${state.sent} sent${state.dueAt ? ` · next due ${dateText(state.dueAt)}` : ''}`
}

/** "Follow-up 2 (voice note) is due". */
export function dueLine(state: Pick<FollowState, 'nextNumber' | 'nextKind'>): string {
  const what = state.nextKind === 'whatsapp' ? 'WhatsApp message' : state.nextKind === 'voice' ? 'voice note' : 'WhatsApp or call'
  return `Follow-up ${state.nextNumber} (${what}) is due`
}

// ------------------------------------------------------------- ordering ---

export type PipeSortable = {
  stage: PipeStage
  section: 'not' | 'done' | null
  paused: boolean
  /** No verified mobile number on file — nobody can follow them up
   *  (owner, 9 Nov 2026): always at the bottom of their stage. */
  noMobile?: boolean
  /** Last seen on the site, else when they signed up. */
  lastActiveAt: string | null
  /** Re-uploaded a rejected document (owner, 15 Nov 2026): top of the stage. */
  reuploaded?: boolean
  /** Approved, fee pending: when the CNIC and photo were approved — every
   *  follow-up chip there is newest approval first (owner, 15 Nov 2026:
   *  interest is highest in the first days after approval). */
  approvedAt?: string | null
  /** When staff last contacted them (any channel). Approved, fee pending: a
   *  contact in the last 3 days sorts to the bottom of the chip. */
  lastContactAt?: string | null
  /** Approved, fee pending: started a fee payment that never completed (owner,
   *  15 Nov 2026) — first within Not followed up, before the approval order. */
  triedToPay?: boolean
  /** Approved today and not contacted in this stage (PR-07): first within Not
   *  followed up, before Tried to pay. */
  approvedTodayDue?: boolean
}

function approvedTodayFirst(r: PipeSortable): boolean {
  return r.stage === 'approved' && r.section === 'not' && !!r.approvedTodayDue
}

function triedFirst(r: PipeSortable): boolean {
  return r.stage === 'approved' && r.section === 'not' && !!r.triedToPay
}

/** Approved, fee pending: contacted in the last 3 days goes to the bottom. */
export const RECENT_CONTACT_MS = 3 * 86_400_000

function recentlyContacted(r: PipeSortable, nowMs: number): boolean {
  if (r.stage !== 'approved') return false
  const t = ts(r.lastContactAt)
  return !!t && nowMs - t < RECENT_CONTACT_MS
}

/** Approved, fee pending (every follow-up chip): newest approval first; a
 *  missing approval date sorts after every dated one. */
function approvalOrder(a: PipeSortable, b: PipeSortable): number {
  if (a.stage !== 'approved' || b.stage !== 'approved') return 0
  const x = ts(a.approvedAt) || -Infinity
  const y = ts(b.approvedAt) || -Infinity
  return x === y ? 0 : x > y ? -1 : 1
}

/** The list order: stage (chip order); tutors with no mobile number at the
 *  bottom of their stage; then Not followed up before Followed up, paused
 *  accounts last, newest active first. (Followed up is shown soonest due first
 *  and Waiting oldest upload first — by sort_at.) */
export function pipelineOrder<T extends PipeSortable>(rows: T[], nowMs: number = Date.now()): T[] {
  const rank = (s: PipeStage) => PIPE_STAGES.indexOf(s)
  const sec = (s: T['section']) => (s === 'done' ? 1 : 0)
  return rows
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        rank(a.r.stage) - rank(b.r.stage) ||
        Number(!a.r.reuploaded) - Number(!b.r.reuploaded) ||
        Number(!!a.r.noMobile) - Number(!!b.r.noMobile) ||
        sec(a.r.section) - sec(b.r.section) ||
        Number(a.r.paused) - Number(b.r.paused) ||
        Number(!approvedTodayFirst(a.r)) - Number(!approvedTodayFirst(b.r)) ||
        Number(!triedFirst(a.r)) - Number(!triedFirst(b.r)) ||
        Number(recentlyContacted(a.r, nowMs)) - Number(recentlyContacted(b.r, nowMs)) ||
        approvalOrder(a.r, b.r) ||
        (ts(b.r.lastActiveAt) || 0) - (ts(a.r.lastActiveAt) || 0) ||
        a.i - b.i,
    )
    .map((x) => x.r)
}

// ------------------------------------------------------------- messages ---

export const PAY_PATH = '/pay/choose?plan=verified'
export const DOCS_PATH = '/tutor/dashboard/settings'

/** The WhatsApp text for a stage's message. Plain English, no price. */
export function pipeMessage(
  stage: FollowStage,
  a: { firstName: string; missing: string[]; rejected: { name: string; reason: string | null }[]; supportWhatsapp: string | null },
): string {
  const hi = `Assalam o Alaikum ${a.firstName || 'there'},`
  let body: string
  let link: string
  if (stage === 'missing') {
    const list = a.missing.length ? a.missing.join(', ') : 'your documents'
    body = `${hi} thank you for joining TutorMint. To finish your profile, please upload: ${list}. It only takes a few minutes.`
    link = siteLink(DOCS_PATH)
  } else if (stage === 'rejected') {
    const lines = a.rejected.map((r) => `- ${r.name}${r.reason ? `: ${r.reason.replace(/\s+/g, ' ').trim()}` : ''}`)
    body = `${hi} we checked your documents and could not approve ${a.rejected.length === 1 ? 'this one' : 'these'}:\n${lines.join('\n')}\n\nPlease upload ${a.rejected.length === 1 ? 'it' : 'them'} again from your profile. Open the link, tap Edit Profile and upload a clear new photo.`
    link = siteLink(DOCS_PATH)
  } else {
    body = `${hi} good news: your CNIC and profile photo are approved. The last step is the one-time Verification Fee. After that you get the Verified badge and can apply to tuitions.`
    link = siteLink(PAY_PATH)
  }
  const help = a.supportWhatsapp ? `\n\nNeed help? WhatsApp ${a.supportWhatsapp}` : ''
  return `${body}\n\n${link}${help}`
}

// ------------------------------------------------------ old addresses ---

/**
 * Where an old Follow-ups address goes now (owner, 8 Nov 2026): Follow-ups is
 * part of People. Tutors land on the Tutors tab (an old chip or "Closest to
 * paying" stage on the nearest stage), parents and orphans on their People
 * tabs. Search and the sign-up day are kept.
 */
export function followUpsToPeople(sp: Record<string, string | string[] | undefined>): string {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const q = new URLSearchParams()
  const tab = one(sp.tab)
  if (tab === 'parents') {
    q.set('tab', 'parent_followups')
    for (const k of ['scope', 'chip', 'fu']) if (one(sp[k])) q.set(k, one(sp[k]))
    return `/admin/users?${q}`
  }
  if (tab === 'orphans') return '/admin/users?tab=orphans'
  q.set('tab', 'tutors')
  const closest = one(sp.closest)
  const chip = one(sp.chip)
  const filter = one(sp.filter)
  const stage =
    closest === 'ready' || chip === 'docs_done' || filter === 'payment'
      ? 'approved'
      : closest === 'all_uploaded' || chip === 'on_us'
        ? 'waiting'
        : closest === 'main_approved' || closest === 'main_uploaded'
          ? 'missing'
          : null
  if (stage) q.set('stage', stage)
  const fu = chip === 'not_contacted' || chip === 'again' || filter === 'uncontacted' || one(sp.fu) === 'todo' ? 'not' : chip === 'contacted' || filter === 'followed' || one(sp.fu) === 'sent' ? 'done' : null
  if (fu) q.set('fu', fu)
  if (one(sp.scope) === 'not_interested') q.set('ni', '1')
  if (['today', 'yesterday', 'week'].includes(filter)) q.set('signed', filter)
  if (one(sp.q).trim()) q.set('q', one(sp.q).trim())
  return `/admin/users?${q}`
}

/** A People → Tutors address on a stage (and a follow-up chip). */
export function stageHref(stage: PipeStage | 'all' | typeof REUPLOADED, fu?: FuBucket | typeof FU_DONE | typeof FU_TRIED | typeof FU_APPROVED_TODAY | null): string {
  const q = new URLSearchParams()
  q.set('tab', 'tutors')
  q.set('stage', stage)
  if (fu) q.set('fu', fu)
  return `/admin/users?${q}`
}

/** The address keys that mean "a filter was chosen" on People → Tutors. */
const TUTOR_FILTER_KEYS = ['stage', 'fu', 'q', 'ni', 'signed', 'deleted', 'all', 'docs', 'paid']

/**
 * The stage People → Tutors shows (owner, 9 Nov 2026): opened with no filter
 * in the address, staff land on "Approved, fee pending → Not followed up" (the
 * Not followed up chip is that row's first option, so the default stage is
 * enough). "All" is written into the address as stage=all, so it stays one
 * click away. Any filter in the address wins.
 */
export function tutorStageFromAddress(sp: Record<string, string | string[] | undefined>): PipeStage | 'all' | typeof REUPLOADED {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const stage = one(sp.stage)
  if (stage === 'all' || stage === REUPLOADED || isPipeStage(stage)) return stage as PipeStage | 'all' | typeof REUPLOADED
  const filtered = TUTOR_FILTER_KEYS.some((k) => one(sp[k]).trim() !== '')
  return filtered ? 'all' : 'approved'
}

/** The Overview to-do rows that open a stage view. */
export const FEE_PENDING_KEY = 'todo-fee-pending'
export const REJECTED_UNINFORMED_KEY = 'todo-rejected-uninformed'

/** Old People → Tutors chips (?docs=, ?paid=) → the stage they meant, or null
 *  when the address is already current. */
export function legacyPeopleTutorHref(sp: Record<string, string | string[] | undefined>): string | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const docs = one(sp.docs)
  const paid = one(sp.paid)
  if (!docs && !paid) return null
  const stage: PipeStage | null =
    paid === 'paid'
      ? 'paid'
      : docs === 'waiting'
        ? 'waiting'
        : docs === 'rejected'
          ? 'rejected'
          : docs === 'approved'
            ? 'approved'
            : docs === 'none' || docs === 'partial'
              ? 'missing'
              : null
  const q = new URLSearchParams()
  q.set('tab', 'tutors')
  if (stage) q.set('stage', stage)
  for (const k of ['q', 'all', 'deleted']) if (one(sp[k])) q.set(k, one(sp[k]))
  return `/admin/users?${q}`
}
