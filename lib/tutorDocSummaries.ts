// lib/tutorDocSummaries.ts
//
// The combined "Documents" status for every tutor on an admin card list
// (owner, 19 Oct 2026), loaded for the WHOLE page at once — three batched reads
// (profiles, tutor_profiles, user_documents), paged and chunked, never one read
// per card. Statuses come from the same row-to-facts mapping and the same
// tutorCardStatuses() as the member page (lib/tutorDocuments), so the card and
// the member page always agree. Service role, admin only. Nothing here is
// logged; no CNIC number leaves this file (it is only read to decide the
// CNIC's status).

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAllIn } from '@/lib/pageAll'
import { tutorCardStatuses, type CardStatuses } from '@/lib/tutorDocQueueCore'
import { docSummary, itemState, tutorDocFactsFromRow, type DocSummary, type TutorDocRow } from '@/lib/tutorDocSummaryCore'

export type CardDocs = DocSummary & {
  /** The oldest upload still waiting for a decision (for "oldest first"). */
  oldestUploadAt: string | null
  /** The per-item statuses (and rejection reasons) the summary was built from. */
  statuses: CardStatuses
  /** The current or waiting selfie looks the same as the profile picture
   *  (owner, 21 Oct 2026; lib/selfieMatch) — a warning only. */
  selfieLooksLikePhoto: boolean
}

const PROFILE_COLS =
  'id, created_at, verification_state, verification_rejection_reason, cnic_verified_at, cnic_number, cnic_image_path, avatar_url, profile_pic_status, profile_pic_reason, profile_pic_rereview_at, selfie_status, selfie_reason'

export async function loadTutorDocSummaries(tutorIds: string[]): Promise<Map<string, CardDocs>> {
  const out = new Map<string, CardDocs>()
  const admin = createAdminClient()
  const ids = Array.from(new Set(tutorIds.filter(Boolean)))
  if (!admin || ids.length === 0) return out

  const [profs, tps, docs] = await Promise.all([
    pageAllIn(ids, (part, from, to) => admin.from('profiles').select(PROFILE_COLS).in('id', part).order('id').range(from, to)),
    pageAllIn(ids, (part, from, to) =>
      admin.from('tutor_profiles').select('id, video_status').in('id', part).order('id').range(from, to),
    ),
    pageAllIn(ids, (part, from, to) =>
      admin
        .from('user_documents')
        .select('id, user_id, kind, status, created_at, same_as_profile_photo')
        .in('kind', ['cnic', 'selfie'])
        .in('status', ['active', 'review'])
        .in('user_id', part)
        .order('id')
        .range(from, to),
    ),
  ])
  const video = new Map(tps.map((t) => [t.id as string, (t.video_status as string | null) ?? null]))
  const byUser = new Map<string, { kind: string; status: string; created_at: string; same?: boolean }[]>()
  for (const d of docs) {
    const k = d.user_id as string
    const list = byUser.get(k) ?? []
    list.push({ kind: d.kind as string, status: d.status as string, created_at: (d.created_at as string) ?? '', same: d.same_as_profile_photo === true })
    byUser.set(k, list)
  }

  for (const p of profs) {
    const id = p.id as string
    const mine = byUser.get(id) ?? []
    const statuses = tutorCardStatuses(
      tutorDocFactsFromRow(p as TutorDocRow, {
        hasSelfieFile: mine.some((d) => d.kind === 'selfie' && d.status === 'active'),
        hasCnicReview: mine.some((d) => d.kind === 'cnic' && d.status === 'review'),
        hasSelfieReview: mine.some((d) => d.kind === 'selfie' && d.status === 'review'),
      }),
    )
    const summary = docSummary(statuses, video.get(id) ?? null)

    // Oldest upload among the items that are waiting.
    const times: string[] = []
    const pick = (kind: 'cnic' | 'selfie', rereview: boolean) =>
      mine.filter((d) => d.kind === kind && d.status === (rereview ? 'review' : 'active')).forEach((d) => d.created_at && times.push(d.created_at))
    if (itemState(statuses.cnic) === 'waiting') pick('cnic', !!statuses.cnic.rereview)
    if (itemState(statuses.selfie) === 'waiting') pick('selfie', !!statuses.selfie.rereview)
    if (itemState(statuses.profilePic) === 'waiting' && statuses.profilePic.rereview && p.profile_pic_rereview_at)
      times.push(p.profile_pic_rereview_at as string)
    times.sort()
    const oldest = summary.kind === 'waiting' ? (times[0] ?? (p.created_at as string | null) ?? null) : null

    out.set(id, { ...summary, oldestUploadAt: oldest, statuses, selfieLooksLikePhoto: mine.some((d) => d.kind === 'selfie' && d.same === true) })
  }
  return out
}
