// lib/tutorPipelineCore.ts
//
// PURE, client-safe. ONE tutor pipeline on People (owner, 8 Nov 2026): People
// and Follow-ups became one page, and the many overlapping tutor chips
// ("Partly approved", "Approved", "Closest to paying", Paid / Unpaid…) became
// a few stages. Each tutor is in exactly ONE stage, decided in this order:
//
//   paid      Verification Fee paid. No follow-up.
//   rejected  at least one of CNIC / profile photo / selfie rejected and not
//             re-uploaded.
//   waiting   at least one uploaded and waiting for a decision. A staff action
//             (Review), not a follow-up.
//   missing   at least one not uploaded (nothing waiting or rejected).
//   approved  all three approved, fee not paid ("Approved, fee pending").
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
export type PipeFacts = PipeDocs & { feePaid: boolean }

const DOCS = ['cnic', 'photo', 'selfie'] as const
export const DOC_NAME: Record<(typeof DOCS)[number], string> = { cnic: 'CNIC', photo: 'Profile photo', selfie: 'Selfie' }

/** The ONE stage — precedence Paid → Rejected → Waiting → Missing → Approved. */
export function pipelineStage(f: PipeFacts): PipeStage {
  if (f.feePaid) return 'paid'
  const s = DOCS.map((k) => f[k])
  if (s.includes('rejected')) return 'rejected'
  if (s.includes('waiting')) return 'waiting'
  if (s.includes('none')) return 'missing'
  return 'approved'
}

/** "CNIC, Selfie" — the documents not uploaded. */
export function missingDocs(f: PipeDocs): string[] {
  return DOCS.filter((k) => f[k] === 'none').map((k) => DOC_NAME[k])
}

export function rejectedDocs(f: PipeDocs, reasons: Partial<Record<(typeof DOCS)[number], string | null>> = {}): { name: string; reason: string | null }[] {
  return DOCS.filter((k) => f[k] === 'rejected').map((k) => ({ name: DOC_NAME[k], reason: reasons[k] ?? null }))
}

// ------------------------------------------------------------ contacts ---

export type PipeKind = 'whatsapp' | 'voice' | 'call'
export const KIND_LABEL: Record<PipeKind, string> = { whatsapp: 'WhatsApp', voice: 'Voice note', call: 'Call' }

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
  const m = /^pipe_(?:missing|rejected|approved)_(whatsapp|voice|call)$/.exec(key ?? '')
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

/** The contacts that belong to the tutor's current stage, newest first. */
export function contactsInStage(contacts: PipeContact[], stage: FollowStage): PipeContact[] {
  const sorted = contacts.filter((c) => Number.isFinite(ts(c.at))).sort((a, b) => ts(b.at) - ts(a.at))
  const out: PipeContact[] = []
  for (const c of sorted) {
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
}

export function nextKindFor(n: number): FollowState['nextKind'] {
  return n === 1 ? 'whatsapp' : n === 2 ? 'voice' : 'either'
}

/** Where a tutor stands in their stage's sequence. */
export function followState(stage: FollowStage, contacts: PipeContact[], nowMs: number): FollowState {
  const mine = contactsInStage(contacts, stage)
  const sent = mine.length
  const last = mine[0] ?? null
  const informed = mine.some((c) => c.kind === 'whatsapp' || c.kind === 'voice')
  const nextNumber = sent + 1
  if (!last) return { sent, nextNumber, nextKind: nextKindFor(nextNumber), dueAt: null, section: 'not', last, informed }
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
  }
}

/** Is a recorded kind allowed for the next follow-up? */
export function kindAllowed(nextKind: FollowState['nextKind'], kind: PipeKind): boolean {
  if (nextKind === 'whatsapp') return kind === 'whatsapp'
  if (nextKind === 'voice') return kind === 'voice'
  return kind === 'whatsapp' || kind === 'call'
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
  /** Last seen on the site, else when they signed up. */
  lastActiveAt: string | null
}

/** The list order: stage (chip order), then Not followed up before Followed
 *  up, paused accounts last, newest active first. (Followed up is shown
 *  soonest due first and Waiting oldest upload first — by sort_at.) */
export function pipelineOrder<T extends PipeSortable>(rows: T[]): T[] {
  const rank = (s: PipeStage) => PIPE_STAGES.indexOf(s)
  const sec = (s: T['section']) => (s === 'done' ? 1 : 0)
  return rows
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        rank(a.r.stage) - rank(b.r.stage) ||
        sec(a.r.section) - sec(b.r.section) ||
        Number(a.r.paused) - Number(b.r.paused) ||
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
    body = `${hi} good news: your CNIC, profile photo and selfie are approved. The last step is the one-time Verification Fee. After that you get the Verified badge and can apply to tuitions.`
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

/** A People → Tutors address on a stage (and Followed up split). */
export function stageHref(stage: PipeStage | 'all', fu?: 'not' | 'done' | null): string {
  const q = new URLSearchParams()
  q.set('tab', 'tutors')
  if (stage !== 'all') q.set('stage', stage)
  if (fu) q.set('fu', fu)
  return `/admin/users?${q}`
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
