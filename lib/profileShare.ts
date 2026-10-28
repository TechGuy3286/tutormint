import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAllIn } from '@/lib/pageAll'
import { directoryBlockers } from '@/lib/tutorListingStatus'
import { fillShareMessage, profileShareState, PROFILE_SHARE_DEFAULT, PROFILE_SHARE_TEMPLATE_KEY, type ProfileShare } from '@/lib/profileShareCore'
import { loadVerifiedBadgeOk } from '@/lib/badgeFacts'
import { subjectDisplayName } from '@/lib/subjectDisplay'
import { formatName } from '@/lib/formatName'

// The "Copy profile link" state for many tutors at once (owner, 20 Oct 2026):
// three batched reads for a whole admin list, then the pure rule in
// lib/profileShareCore. "Listed" is read from the tutor_directory view itself
// (the same source as listedTutorIds), the reasons from the directory mirror.

export async function loadProfileShares(ids: string[]): Promise<Map<string, ProfileShare>> {
  const out = new Map<string, ProfileShare>()
  const admin = createAdminClient()
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (!admin || unique.length === 0) return out

  type P = Record<string, unknown> & { id: string }
  const [profiles, tutors, listed] = await Promise.all([
    pageAllIn<P, string>(unique, (part, from, to) =>
      admin
        .from('profiles')
        .select('id, role, is_suspended, is_banned, is_seed, is_team_account, is_test_name, hidden_from_public, paused_by_user_at, verification_state, profile_pic_status, selfie_status')
        .in('id', part)
        .order('id')
        .range(from, to) as unknown as Promise<{ data: P[] | null; error: { message: string } | null }>,
    ),
    pageAllIn<P, string>(unique, (part, from, to) =>
      admin
        .from('tutor_profiles')
        .select('id, slug, under_review, verification_status, imported, claimed_at')
        .in('id', part)
        .order('id')
        .range(from, to) as unknown as Promise<{ data: P[] | null; error: { message: string } | null }>,
    ),
    pageAllIn<P, string>(unique, (part, from, to) =>
      admin.from('tutor_directory').select('id').in('id', part).order('id').range(from, to) as unknown as Promise<{
        data: P[] | null
        error: { message: string } | null
      }>,
    ),
  ])
  const prof = new Map(profiles.map((p) => [p.id, p]))
  const inDir = new Set(listed.map((r) => r.id))
  for (const tp of tutors) {
    const p = prof.get(tp.id)
    if (!p || p.role !== 'tutor') continue
    const lower = (v: unknown) => String(v ?? '').toLowerCase()
    const blockers = directoryBlockers({
      role: (p.role as string | null) ?? null,
      hiddenFromPublic: (p.hidden_from_public as boolean | null) ?? null,
      isTestName: (p.is_test_name as boolean | null) ?? null,
      pausedByUser: !!p.paused_by_user_at,
      isSuspended: p.is_suspended as boolean | null,
      isBanned: p.is_banned as boolean | null,
      underReview: tp.under_review as boolean | null,
      verificationStatus: tp.verification_status as string | null,
      imported: tp.imported as boolean | null,
      claimedAt: tp.claimed_at as string | null,
      isSeed: p.is_seed as boolean | null,
      isTeamAccount: p.is_team_account as boolean | null,
      cnicRejected: lower(p.verification_state) === 'rejected',
      photoRejected: lower(p.profile_pic_status) === 'rejected',
      selfieRejected: lower(p.selfie_status) === 'rejected',
    } as Parameters<typeof directoryBlockers>[0])
    out.set(tp.id, profileShareState({ slug: tp.slug as string | null, listed: inDir.has(tp.id), blockers }))
  }
  return withShareMessages(out)
}

/**
 * The ready "Share on WhatsApp" message for each tutor whose profile is public
 * (owner, 28 Oct 2026): name, city, up to three subjects, the profile link, and
 * "verified" only for a tutor with the Verified badge. The words come from Team
 * inbox → Templates → Share profile (key profile_share), else the built-in text.
 * Batched: one read per table for the whole list.
 */
export async function withShareMessages(shares: Map<string, ProfileShare>): Promise<Map<string, ProfileShare>> {
  const admin = createAdminClient()
  const ids = [...shares.entries()].filter(([, s]) => s.url).map(([id]) => id)
  if (!admin || ids.length === 0) return shares
  type R = Record<string, unknown> & { id: string }
  const [tpl, people, tutors, links, verified] = await Promise.all([
    admin.from('admin_message_templates').select('body').eq('key', PROFILE_SHARE_TEMPLATE_KEY).maybeSingle(),
    pageAllIn<R, string>(ids, (part, from, to) =>
      admin.from('profiles').select('id, full_name, city').in('id', part).order('id').range(from, to) as unknown as Promise<{ data: R[] | null; error: { message: string } | null }>,
    ),
    pageAllIn<R, string>(ids, (part, from, to) =>
      admin.from('tutor_profiles').select('id, city').in('id', part).order('id').range(from, to) as unknown as Promise<{ data: R[] | null; error: { message: string } | null }>,
    ),
    pageAllIn<R & { tutor_id: string; master_id: number }, string>(ids, (part, from, to) =>
      admin
        .from('tutor_subjects')
        .select('tutor_id, master_id, taxonomy_master(level_slug, subject_slug, taxonomy_subjects(name))')
        .in('tutor_id', part)
        .order('tutor_id')
        .order('master_id')
        .range(from, to) as unknown as Promise<{ data: (R & { tutor_id: string; master_id: number })[] | null; error: { message: string } | null }>,
    ),
    loadVerifiedBadgeOk(ids).catch(() => new Set<string>()),
  ])
  const body = ((tpl.data?.body as string | null) ?? '').trim() || PROFILE_SHARE_DEFAULT
  const person = new Map(people.map((p) => [p.id, p]))
  const tutorCity = new Map(tutors.map((t) => [t.id, (t.city as string | null) ?? null]))
  const subjects = new Map<string, string[]>()
  for (const l of links) {
    const m = l.taxonomy_master as { level_slug?: string; taxonomy_subjects?: { name?: string } | null } | null
    const name = m?.taxonomy_subjects?.name
    // A school (Admission Test Prep) is never shown as a subject.
    if (!name || m?.level_slug === 'admission-test-prep') continue
    const list = subjects.get(l.tutor_id) ?? []
    const shown = subjectDisplayName(name)
    if (!list.includes(shown)) list.push(shown)
    subjects.set(l.tutor_id, list)
  }
  const out = new Map(shares)
  for (const id of ids) {
    const s = shares.get(id)!
    const p = person.get(id)
    const message = fillShareMessage(body, {
      name: formatName((p?.full_name as string | null) ?? ''),
      city: tutorCity.get(id) ?? ((p?.city as string | null) ?? null),
      subjects: subjects.get(id) ?? [],
      link: s.url!,
      verified: verified.has(id),
    })
    out.set(id, { ...s, message })
  }
  return out
}
