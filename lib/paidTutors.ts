// lib/paidTutors.ts
//
// The I/O half of Tuitions → Paid tutors (owner, 23 Oct 2026; rules in
// lib/paidTutorsCore). ONE loader for the page and the sidebar badge, so the
// badge is exactly the red rows the page shows. Service role; the page checks
// SCREEN_ACCESS.paidTutors first. Never returns a phone number, CNIC or email.

import 'server-only'

import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { loadDirectory } from '@/lib/peopleDirectory'
import { cityKey } from '@/lib/cityOwnersCore'
import { latestAt } from '@/lib/journeyCore'
import { paidBadgeCount, sortRows, toRow, type PaidApp, type PaidRow } from '@/lib/paidTutorsCore'

type R = Record<string, unknown>

export type PaidTutorsData = { rows: PaidRow[]; staff: { id: string; name: string }[]; siteOwnerId: string | null }

export const loadPaidTutors = cache(async (): Promise<PaidTutorsData> => {
  const admin = createAdminClient()
  if (!admin) return { rows: [], staff: [], siteOwnerId: null }
  const now = Date.now()
  const directory = await loadDirectory()
  const paid = directory.people.filter((p) => p.role === 'tutor' && p.excluded === null && !!p.feePaidAt)
  const ids = paid.map((p) => p.id)
  if (ids.length === 0) return { rows: [], staff: [], siteOwnerId: null }

  const [tps, apps, forwards, fus, calls, notes, appFus, owners, siteOwner] = await Promise.all([
    pageAllIn(ids, (part, f, t) => admin.from('tutor_profiles').select('id, city, onboarded_at').in('id', part).order('id').range(f, t)),
    pageAllIn(ids, (part, f, t) =>
      admin.from('applications').select('id, job_id, tutor_id, stage, stage_changed_at, created_at, withdrawn_at').in('tutor_id', part).order('id').range(f, t),
    ),
    pageAll<R>((f, t) => admin.from('applicant_forwards').select('id, job_id, tutor_ids').is('undone_at', null).order('id').range(f, t) as never),
    pageAllIn(ids, (part, f, t) => admin.from('member_follow_ups').select('id, member_id, created_at').in('member_id', part).is('undone_at', null).order('id').range(f, t)),
    pageAllIn(ids, (part, f, t) => admin.from('tutor_contact_logs').select('id, tutor_id, created_at').in('tutor_id', part).order('id').range(f, t)),
    pageAllIn(ids, (part, f, t) =>
      admin.from('member_notes').select('id, member_id, created_at').in('member_id', part).is('withdrawn_at', null).order('id').range(f, t),
    ).catch(() => []),
    pageAllIn(ids, (part, f, t) =>
      admin.from('application_follow_ups').select('id, tutor_id, created_at').in('tutor_id', part).eq('recipient', 'tutor').is('undone_at', null).order('id').range(f, t),
    ),
    admin.from('city_owners').select('city, staff_id'),
    admin.from('profiles').select('id').eq('role', 'admin').eq('admin_role', 'owner').limit(1).maybeSingle(),
  ])

  const tpBy = new Map(tps.map((t) => [t.id as string, t]))
  const liveApps = apps.filter((a) => !a.withdrawn_at && a.job_id)
  const jobIds = [...new Set(liveApps.map((a) => a.job_id as string))]
  const jobs = await pageAllIn(jobIds, (part, f, t) => admin.from('jobs').select('id, created_at').in('id', part).order('id').range(f, t))
  const jobCreated = new Map(jobs.map((j) => [j.id as string, j.created_at as string]))
  const forwardedPairs = new Set<string>()
  for (const fw of forwards) for (const tid of (fw.tutor_ids as string[] | null) ?? []) forwardedPairs.add(`${fw.job_id}|${tid}`)

  const contactBy = new Map<string, string[]>()
  const addContact = (id: unknown, at: unknown) => contactBy.set(id as string, [...(contactBy.get(id as string) ?? []), at as string])
  for (const r of fus) addContact(r.member_id, r.created_at)
  for (const r of calls) addContact(r.tutor_id, r.created_at)
  for (const r of notes) addContact(r.member_id, r.created_at)
  for (const r of appFus) addContact(r.tutor_id, r.created_at)

  const ownerMap = new Map<string, string>()
  for (const r of owners.data ?? []) if (r.staff_id) ownerMap.set(cityKey(r.city as string), r.staff_id as string)
  const siteOwnerId = (siteOwner.data?.id as string | undefined) ?? null

  const appsBy = new Map<string, PaidApp[]>()
  for (const a of liveApps) {
    const tid = a.tutor_id as string
    appsBy.set(tid, [
      ...(appsBy.get(tid) ?? []),
      {
        jobId: a.job_id as string,
        stage: a.stage as string,
        createdAt: a.created_at as string,
        stageChangedAt: (a.stage_changed_at as string | null) ?? null,
        jobCreatedAt: jobCreated.get(a.job_id as string) ?? null,
        forwarded: forwardedPairs.has(`${a.job_id}|${tid}`),
      },
    ])
  }

  const rows = paid.map((p) => {
    const tp = tpBy.get(p.id)
    const city = ((tp?.city as string | null) || p.city) ?? null
    return toRow(
      {
        id: p.id,
        name: formatName(p.name) || p.name || '—',
        city,
        paidAt: p.feePaidAt as string,
        apps: appsBy.get(p.id) ?? [],
        lastContactAt: latestAt(contactBy.get(p.id) ?? []),
        profileFinished: !!tp?.onboarded_at,
        ownerId: ownerMap.get(cityKey(city)) ?? siteOwnerId,
      },
      now,
    )
  })

  const staffIds = [...new Set(rows.map((r) => r.ownerId).filter((v): v is string => !!v))]
  const { data: people } = staffIds.length ? await admin.from('profiles').select('id, full_name').in('id', staffIds) : { data: [] }
  const staff = (people ?? [])
    .map((s) => ({ id: s.id as string, name: formatName(s.full_name as string | null) || 'Staff' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { rows: sortRows(rows), staff, siteOwnerId }
})

/** The red Paid tutors badge. Tolerant — 0 on any failure. */
export const paidTutorsBadgeCount = cache(async (actor: { id: string; adminRole: string | null | undefined }): Promise<number> => {
  try {
    return paidBadgeCount((await loadPaidTutors()).rows, actor)
  } catch {
    return 0
  }
})
