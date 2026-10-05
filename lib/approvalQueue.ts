import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { formatName } from '@/lib/formatName'

// "Approval needed" (PR106-H1 §3): tutors with at least one uploaded document
// waiting for a staff decision. Fee-paid members first (they are waiting for
// their Verified badge), then oldest account first within each group. Each row
// carries the chips of exactly what is waiting and whether the fee is paid.
//
// WAITING = a real reviewable status is pending:
//   CNIC   — profiles.verification_state = 'submitted' (uploaded, not yet
//            approved/rejected)
//   Photo  — profiles.profile_pic_status = 'pending'
//   Selfie — profiles.selfie_status = 'pending'
//   Video  — tutor_profiles.video_status = 'uploaded' (awaiting approval)
// Certificates are NOT queued: there is no per-certificate approve/reject status
// in the schema today (the Verified badge is degree-gated by "a reviewed degree
// on file", not a pending flag), so there is nothing to mark as waiting.
//
// Fixtures, banned and suspended accounts are excluded.

export type ApprovalRow = { id: string; name: string; waiting: string[]; paid: boolean; createdAt: string }

async function build(): Promise<ApprovalRow[]> {
  const admin = createAdminClient()
  if (!admin) return []

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, created_at, is_seed, is_banned, is_suspended, is_team_account, verification_state, profile_pic_status, selfie_status')
    .eq('role', 'tutor')
  const live = (profiles ?? []).filter((p) => !p.is_seed && !p.is_banned && !p.is_suspended && !p.is_team_account)
  if (live.length === 0) return []

  const ids = live.map((p) => p.id as string)
  const { data: tps } = await admin.from('tutor_profiles').select('id, video_status, verified_fee_paid_at').in('id', ids)
  const tp = new Map((tps ?? []).map((t) => [t.id as string, t]))

  const rows: ApprovalRow[] = []
  for (const p of live) {
    const t = tp.get(p.id as string)
    const waiting: string[] = []
    if (p.verification_state === 'submitted') waiting.push('CNIC')
    if (p.profile_pic_status === 'pending') waiting.push('Photo')
    if (p.selfie_status === 'pending') waiting.push('Selfie')
    if (t?.video_status === 'uploaded') waiting.push('Video')
    if (waiting.length === 0) continue
    rows.push({
      id: p.id as string,
      name: formatName(p.full_name as string | null) || 'Unnamed tutor',
      waiting,
      paid: !!t?.verified_fee_paid_at,
      createdAt: (p.created_at as string) ?? '',
    })
  }

  // Fee-paid first; oldest account first within each group (a proxy for oldest
  // upload, deterministic and index-friendly).
  rows.sort((a, b) => (a.paid === b.paid ? a.createdAt.localeCompare(b.createdAt) : a.paid ? -1 : 1))
  return rows
}

export async function approvalNeeded(): Promise<ApprovalRow[]> {
  return build()
}

export async function approvalNeededCount(): Promise<number> {
  return (await build()).length
}
