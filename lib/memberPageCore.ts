// lib/memberPageCore.ts
//
// The admin member page's top section in plain words (owner, 20 Oct 2026).
// PURE — unit-tested by scripts/test-admin-cleanup.ts.

import { DOC_KIND_TONE, type DocSummaryKind } from '@/lib/tutorDocSummaryCore'

// ── Documents: the same words and colours as the Documents row on tutor cards.

export const DOC_KIND_WORD: Record<DocSummaryKind, string> = {
  approved: 'Approved',
  waiting: 'Waiting for approval',
  partial: 'Partly approved',
  rejected: 'Rejected',
  none: 'Not uploaded',
}

export function documentsFact(kind: DocSummaryKind): { text: string; tone: string } {
  return { text: DOC_KIND_WORD[kind], tone: DOC_KIND_TONE[kind] }
}

type ItemStatus = { status: 'none' | 'pending' | 'approved' | 'rejected'; hasUpload: boolean }

/** A parent's two items (CNIC, typed address) → one combined kind, with the
 *  tutor card's precedence: Rejected, Waiting, Partly approved, Not uploaded. */
export function parentDocKind(items: ItemStatus[]): DocSummaryKind {
  const state = (s: ItemStatus) =>
    s.status === 'rejected' ? 'rejected' : s.status === 'approved' ? 'approved' : s.status === 'pending' && s.hasUpload ? 'waiting' : 'none'
  const st = items.map(state)
  if (st.includes('rejected')) return 'rejected'
  if (st.includes('waiting')) return 'waiting'
  if (st.length > 0 && st.every((s) => s === 'approved')) return 'approved'
  if (st.includes('approved')) return 'partial'
  return 'none'
}

// ── Video: one line ─────────────────────────────────────────────────────

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** "None", or "Uploaded · Private" / "Approved · Public". */
export function videoFact(status: string | null | undefined, visibility: string | null | undefined): string {
  const s = (status ?? '').trim().toLowerCase()
  if (!s || s === 'none') return 'None'
  return `${cap(s)} · ${cap((visibility ?? 'private').trim().toLowerCase() || 'private')}`
}

// ── Tutor status, with why it is pending ────────────────────────────────

/**
 * "Pending: fee not paid · documents waiting", or the status in words.
 *
 * tutor_profiles.verification_status stays 'pending' after the fee and the
 * documents are done (only the video review sets 'verified'), so a tutor with
 * the Verification Fee paid and CNIC, photo and selfie approved — the site's
 * Verified-badge rule — reads "Verified", not "Pending" (owner, 21 Oct 2026).
 */
export function tutorStatusFact(
  status: string | null | undefined,
  f: { feePaid: boolean; docKind: DocSummaryKind },
): string {
  const s = (status ?? '').trim().toLowerCase()
  if (!s) return '—'
  if (s !== 'pending') return cap(s)
  if (f.feePaid && f.docKind === 'approved') return 'Verified'
  const why: string[] = []
  if (!f.feePaid) why.push('fee not paid')
  if (f.docKind === 'waiting') why.push('documents waiting')
  if (f.docKind === 'rejected') why.push('documents rejected')
  if (f.docKind === 'none' || f.docKind === 'partial') why.push('documents missing')
  return why.length ? `Pending: ${why.join(' · ')}` : 'Pending'
}

// ── Empty boxes on one grey line ────────────────────────────────────────

export type MemberBox = 'jobs' | 'applications' | 'payments' | 'subscriptions' | 'reportsAbout' | 'reportsBy' | 'penalties' | 'flags'

const BOX_WORD: Record<MemberBox, string> = {
  jobs: 'jobs',
  applications: 'applications',
  payments: 'payments',
  subscriptions: 'subscriptions',
  reportsAbout: 'reports about them',
  reportsBy: 'reports they filed',
  penalties: 'penalties',
  flags: 'flags',
}

const ORDER: MemberBox[] = ['jobs', 'applications', 'payments', 'subscriptions', 'reportsAbout', 'reportsBy', 'penalties', 'flags']

/** "No jobs, applications, subscriptions, reports, penalties or flags." — or
 *  null when every box has something. Both report boxes empty read "reports". */
export function emptySectionsLine(empty: MemberBox[]): string | null {
  const set = new Set(empty)
  const words: string[] = []
  for (const b of ORDER) {
    if (!set.has(b)) continue
    if (b === 'reportsAbout' && set.has('reportsBy')) {
      words.push('reports')
      continue
    }
    if (b === 'reportsBy' && set.has('reportsAbout')) continue
    words.push(BOX_WORD[b])
  }
  if (words.length === 0) return null
  if (words.length === 1) return `No ${words[0]}.`
  return `No ${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}.`
}
