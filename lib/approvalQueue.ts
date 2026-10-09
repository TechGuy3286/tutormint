import 'server-only'

import { pageAll, pageAllIn } from '@/lib/pageAll'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatName } from '@/lib/formatName'
import { parentsAwaitingReview } from '@/lib/parentDocuments'
import { tutorWaiting } from '@/lib/tutorDocQueueCore'

// "Approval needed" (PR106-H1 §3): tutors with at least one uploaded document
// waiting for a staff decision. Fee-paid members first (they are waiting for
// their Verified badge), then oldest account first within each group. Each row
// carries the chips of exactly what is waiting and whether the fee is paid.
//
// WAITING = what the review card shows as Pending with a file to decide on —
// lib/tutorDocQueueCore tutorWaiting(), the SAME statuses the card reads
// (owner, 9 Oct 2026). Before, CNIC was the raw verification_state, so a tutor
// whose CNIC was approved and who later re-uploaded a side stayed queued while
// her card said Approved. Video — tutor_profiles.video_status = 'uploaded'.
// Certificates are NOT queued: there is no per-certificate approve/reject status
// in the schema today (the Verified badge is degree-gated by "a reviewed degree
// on file", not a pending flag), so there is nothing to mark as waiting.
//
// Fixtures, banned and suspended accounts are excluded.
//
// PARENTS (owner, 8 Oct 2026): a parent with their CNIC or address waiting
// (lib/parentDocuments parentsAwaitingReview — the Verification → Parents
// queue's own list) is a row here too, so the Overview "Documents to approve"
// count, its list and the People badge all include waiting parents.

export type ApprovalRow = {
  id: string
  name: string
  waiting: string[]
  paid: boolean
  createdAt: string
  kind: 'tutor' | 'parent'
  /** Where to review this member's documents. */
  href: string
}

async function build(): Promise<ApprovalRow[]> {
  const admin = createAdminClient()
  if (!admin) return []

  const profiles = await pageAll((from, to) =>
    admin
      .from('profiles')
      .select('id, full_name, created_at, is_seed, is_banned, is_suspended, is_team_account, verification_state, cnic_verified_at, cnic_number, cnic_image_path, avatar_url, profile_pic_status, selfie_status')
      .eq('role', 'tutor')
      .order('id')
      .range(from, to),
  )
  const live = profiles.filter((p) => !p.is_seed && !p.is_banned && !p.is_suspended && !p.is_team_account)

  const ids = live.map((p) => p.id as string)
  const tps = await pageAllIn(ids, (part, from, to) =>
    admin.from('tutor_profiles').select('id, video_status, verified_fee_paid_at').in('id', part).order('id').range(from, to),
  )
  const tp = new Map(tps.map((t) => [t.id as string, t]))
  // Active selfie documents (the card's "a selfie is on file").
  const selfies = await pageAllIn(ids, (part, from, to) =>
    admin.from('user_documents').select('id, user_id').eq('kind', 'selfie').eq('status', 'active').in('user_id', part).order('id').range(from, to),
  )
  const hasSelfie = new Set(selfies.map((d) => d.user_id as string))

  const rows: ApprovalRow[] = []
  for (const p of live) {
    const t = tp.get(p.id as string)
    const waiting = tutorWaiting({
      verification_state: p.verification_state as string | null,
      cnic_verified_at: p.cnic_verified_at as string | null,
      cnic_number: p.cnic_number as string | null,
      cnic_image_path: p.cnic_image_path as string | null,
      avatar_url: p.avatar_url as string | null,
      profile_pic_status: p.profile_pic_status as string | null,
      selfie_status: p.selfie_status as string | null,
      hasSelfieFile: hasSelfie.has(p.id as string),
      video_status: (t?.video_status as string | null) ?? null,
    })
    if (waiting.length === 0) continue
    rows.push({
      id: p.id as string,
      name: formatName(p.full_name as string | null) || 'Unnamed tutor',
      waiting,
      paid: !!t?.verified_fee_paid_at,
      createdAt: (p.created_at as string) ?? '',
      kind: 'tutor',
      href: `/admin/tutors/${p.id as string}`,
    })
  }

  // Fee-paid first; oldest account first within each group (a proxy for oldest
  // upload, deterministic and index-friendly).
  rows.sort((a, b) => (a.paid === b.paid ? a.createdAt.localeCompare(b.createdAt) : a.paid ? -1 : 1))

  // Waiting parents after the tutors, oldest submission first.
  const parents = await parentsAwaitingReview()
  for (const p of parents) {
    rows.push({
      id: p.parentId,
      name: p.name,
      waiting: p.waiting,
      paid: false,
      createdAt: p.submittedAt ?? '',
      kind: 'parent',
      href: `/admin/users/${p.parentId}#documents`,
    })
  }
  return rows
}

export async function approvalNeeded(): Promise<ApprovalRow[]> {
  return build()
}

export async function approvalNeededCount(): Promise<number> {
  return (await build()).length
}
