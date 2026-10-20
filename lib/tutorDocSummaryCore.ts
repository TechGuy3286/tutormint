// lib/tutorDocSummaryCore.ts
//
// One combined "Documents" status for an admin tutor card (owner, 19 Oct
// 2026). Built ONLY from tutorCardStatuses() — the statuses the member page's
// Documents section (components/admin/TutorDocumentReview via
// lib/tutorDocuments loadDocumentStatuses) shows — so the card and the member
// page can never disagree about a tutor.
//
// Required items: CNIC (front, back and number — lib/cnicStatus decides),
// profile picture, selfie. The intro video is OPTIONAL: it is shown in the
// breakdown and never makes the combined status worse.
//
// Precedence when several apply: Rejected, Waiting, Partly approved, Not
// uploaded. "Approved" is all three approved, which excludes the others.
//
// PURE — unit-tested by scripts/test-doc-summary.ts.

import type { CardDocState, CardStatuses } from '@/lib/tutorDocQueueCore'

export type DocSummaryKind = 'approved' | 'waiting' | 'rejected' | 'partial' | 'none'

export type DocSummary = {
  kind: DocSummaryKind
  /** The row's text, e.g. "🟡 Waiting for approval (2)". */
  label: string
  /** The one-line breakdown: "CNIC ✅ · Photo 🟡 · Selfie ⚪ · Video —". */
  breakdown: string
  /** Required items waiting for a decision. */
  waitingCount: number
}

const ITEMS: { key: keyof CardStatuses; name: string }[] = [
  { key: 'cnic', name: 'CNIC' },
  { key: 'profilePic', name: 'Photo' },
  { key: 'selfie', name: 'Selfie' },
]

/** What one required item counts as. A Pending status with no file on file is
 *  not uploaded — the same rule as the approval queue (tutorWaiting). */
export function itemState(s: CardDocState): 'approved' | 'waiting' | 'rejected' | 'none' {
  if (s.status === 'rejected') return 'rejected'
  if (s.status === 'pending') return s.hasUpload ? 'waiting' : 'none'
  if (s.status === 'approved') return 'approved'
  return 'none'
}

const ICON = { approved: '✅', waiting: '🟡', rejected: '🔴', none: '⚪' } as const

function videoIcon(videoStatus: string | null | undefined): string {
  if (videoStatus === 'approved') return '✅'
  if (videoStatus === 'uploaded') return '🟡'
  if (videoStatus === 'rejected') return '🔴'
  return '—'
}

export function docSummary(statuses: CardStatuses, videoStatus?: string | null): DocSummary {
  const states = ITEMS.map((i) => ({ name: i.name, state: itemState(statuses[i.key]) }))
  const breakdown = [...states.map((s) => `${s.name} ${ICON[s.state]}`), `Video ${videoIcon(videoStatus)}`].join(' · ')
  const rejected = states.filter((s) => s.state === 'rejected').map((s) => s.name)
  const waitingCount = states.filter((s) => s.state === 'waiting').length
  const approved = states.filter((s) => s.state === 'approved').length

  if (rejected.length > 0) return { kind: 'rejected', label: `🔴 Rejected — ${rejected.join(', ')}`, breakdown, waitingCount }
  if (waitingCount > 0) return { kind: 'waiting', label: `🟡 Waiting for approval (${waitingCount})`, breakdown, waitingCount }
  if (approved === ITEMS.length) return { kind: 'approved', label: '✅ Approved', breakdown, waitingCount }
  if (approved > 0) return { kind: 'partial', label: `🟠 ${approved} of ${ITEMS.length} approved`, breakdown, waitingCount }
  return { kind: 'none', label: '⚪ Not uploaded', breakdown, waitingCount }
}

/** One colour per status, shared by the tutor cards' Documents row and the
 *  member page's Documents fact (owner, 20 Oct 2026): green approved, amber
 *  waiting or partly approved, red only for rejected, grey for not uploaded. */
export const DOC_KIND_TONE: Record<DocSummaryKind, string> = {
  approved: 'text-tm-green-deep',
  waiting: 'text-tm-gold-ink',
  partial: 'text-tm-gold-ink',
  rejected: 'text-tm-red',
  none: 'text-gray-500',
}

// ── The Tutors list's filter chips ────────────────────────────────────────

export type DocFilter = 'all' | 'waiting' | 'partial' | 'approved' | 'rejected' | 'none'
// 'Partly approved' (owner, 20 Oct 2026): some required items approved, the rest
// not uploaded — the card's own 'k of 3 approved' status.
export const DOC_FILTERS: DocFilter[] = ['all', 'waiting', 'partial', 'approved', 'rejected', 'none']

export function isDocFilter(v: string): v is DocFilter {
  return (DOC_FILTERS as string[]).includes(v)
}

export function docFilterLabel(f: DocFilter, isOwner: boolean): string {
  if (f === 'waiting') return isOwner ? 'Waiting for my approval' : 'Waiting for approval'
  return { all: 'All', partial: 'Partly approved', approved: 'Approved', rejected: 'Rejected', none: 'Not uploaded' }[f]
}

type WithDocs = { docs?: { kind: DocSummaryKind; oldestUploadAt: string | null } | null }

export function matchesDocFilter(it: WithDocs, f: DocFilter): boolean {
  if (f === 'all') return true
  return it.docs?.kind === f
}

/** The rows a chip shows, in order. "Waiting" is oldest upload first (an
 *  unknown upload time goes last); every other chip keeps the list's order. */
export function applyDocFilter<T extends WithDocs>(items: T[], f: DocFilter): T[] {
  const out = items.filter((it) => matchesDocFilter(it, f))
  if (f !== 'waiting') return out
  return out
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const x = a.it.docs?.oldestUploadAt ?? null
      const y = b.it.docs?.oldestUploadAt ?? null
      if (x && y && x !== y) return x.localeCompare(y)
      if (x && !y) return -1
      if (!x && y) return 1
      return a.i - b.i
    })
    .map((p) => p.it)
}

/** Each chip's count — by construction the length of what the chip shows. */
export function docFilterCounts<T extends WithDocs>(items: T[]): Record<DocFilter, number> {
  const out = {} as Record<DocFilter, number>
  for (const f of DOC_FILTERS) out[f] = applyDocFilter(items, f).length
  return out
}

/** The card's free-text line without its "Joined <date>" part — the details
 *  table already shows the joined date (owner, 19 Oct 2026) — and without a
 *  "stopped at …" / "Next: …" / "Still to do …" part: the card shows the step
 *  once, as its own "Next:" line (owner, 20 Oct 2026). */
export function withoutJoined(detail: string | null | undefined): string | null {
  if (!detail) return null
  const kept = detail
    .split(' · ')
    .map((s) => s.trim())
    .filter((s) => s && !/^(joined|stopped at|next:|still to do)/i.test(s))
  return kept.length ? kept.join(' · ') : null
}

// ── One way to turn stored rows into the card statuses ────────────────────
// Used by BOTH the member page's loader (lib/tutorDocuments
// loadDocumentStatuses) and the batch loader for the cards
// (lib/tutorDocSummaries), so the two read the same facts the same way.

export type TutorDocRow = {
  verification_state?: string | null
  verification_rejection_reason?: string | null
  cnic_verified_at?: string | null
  cnic_number?: string | null
  cnic_image_path?: string | null
  avatar_url?: string | null
  profile_pic_status?: string | null
  profile_pic_reason?: string | null
  profile_pic_rereview_at?: string | null
  selfie_status?: string | null
  selfie_reason?: string | null
}

export function tutorDocFactsFromRow(
  p: TutorDocRow,
  docs: { hasSelfieFile: boolean; hasCnicReview: boolean; hasSelfieReview: boolean },
): import('@/lib/tutorDocQueueCore').TutorDocFacts {
  return {
    verification_state: p.verification_state ?? null,
    verification_rejection_reason: p.verification_rejection_reason ?? null,
    cnic_verified_at: p.cnic_verified_at ?? null,
    cnic_number: p.cnic_number ?? null,
    cnic_image_path: p.cnic_image_path ?? null,
    avatar_url: p.avatar_url ?? null,
    profile_pic_status: p.profile_pic_status ?? null,
    profile_pic_reason: p.profile_pic_reason ?? null,
    selfie_status: p.selfie_status ?? null,
    selfie_reason: p.selfie_reason ?? null,
    hasSelfieFile: docs.hasSelfieFile,
    hasCnicReview: docs.hasCnicReview,
    hasSelfieReview: docs.hasSelfieReview,
    profile_pic_rereview_at: p.profile_pic_rereview_at ?? null,
  }
}
