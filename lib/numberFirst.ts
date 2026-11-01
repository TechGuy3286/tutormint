import 'server-only'

// lib/numberFirst.ts
//
// "Number first" on staff Post a tuition (owner, 31 Oct 2026) — the server half.
// Rules and wording: lib/numberFirstCore. Targeted reads only (every stored
// shape of a Pakistani mobile ends with its last ten digits), so the check is
// quick enough to run before the form opens.

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { formatName } from '@/lib/formatName'
import { numberHash, sameNumber } from '@/lib/contactWithdrawCore'
import {
  countsAsLive,
  isParentAccount,
  lastTen,
  numberFirstOutcome,
  type ExistingTuition,
  type NumberFirstOutcome,
  type ParentAccount,
} from '@/lib/numberFirstCore'
import type { AdminRole } from '@/lib/adminAuth'

export async function checkNumberFirst(
  msisdn: string,
  opts: { excludeJobId?: string | null } = {},
): Promise<NumberFirstOutcome | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const hash = numberHash(msisdn)
  const tail = `%${lastTen(msisdn)}`

  const [dnu, hold, contacts, profiles] = await Promise.all([
    admin.from('do_not_use_numbers').select('id').eq('number_hash', hash).is('removed_at', null).limit(1),
    admin.from('contact_holds').select('id').eq('number_hash', hash).is('released_at', null).limit(1),
    admin.from('job_contacts').select('job_id, contact_phone, contact_whatsapp').or(`contact_phone.like.${tail},contact_whatsapp.like.${tail}`).limit(200),
    admin
      .from('profiles')
      .select('id, full_name, role, phone_number, whatsapp, is_team_account, is_test_name, hidden_from_public, merged_into, created_at')
      .or(`phone_number.like.${tail},whatsapp.like.${tail}`)
      .limit(20),
  ])
  if (dnu.error || hold.error || contacts.error || profiles.error) return null

  const parents = (profiles.data ?? [])
    .filter((p) => isParentAccount(p) && (sameNumber(p.phone_number as string | null, msisdn) || sameNumber(p.whatsapp as string | null, msisdn)))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const parent: ParentAccount | null = parents[0]
    ? { id: parents[0].id as string, name: formatName((parents[0].full_name as string | null) ?? '') || 'Parent' }
    : null

  const jobIds = new Set<string>()
  for (const c of contacts.data ?? []) {
    if (sameNumber(c.contact_phone as string | null, msisdn) || sameNumber(c.contact_whatsapp as string | null, msisdn)) jobIds.add(c.job_id as string)
  }
  const tuitions: ExistingTuition[] = []
  const parentIds = parents.map((p) => p.id as string)
  const ors: string[] = []
  if (jobIds.size > 0) ors.push(`id.in.(${[...jobIds].join(',')})`)
  if (parentIds.length > 0) ors.push(`parent_id.in.(${parentIds.join(',')})`)
  if (ors.length > 0) {
    const { data: jobs, error } = await admin
      .from('jobs')
      .select('id, ref_id, title, city, status, created_at, parent_id, merged_into')
      .or(ors.join(','))
      .in('status', ['open', 'paused'])
      .is('merged_into', null)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) return null
    const live = (jobs ?? []).filter((j) => countsAsLive(j.status as string) && j.id !== opts.excludeJobId)
    const ids = live.map((j) => j.id as string)
    const owners = ids.length
      ? (await admin.from('tuition_owners').select('job_id, posted_by').in('job_id', ids)).data ?? []
      : []
    const posterIds = new Set<string>()
    for (const o of owners) if (o.posted_by) posterIds.add(o.posted_by as string)
    for (const j of live) if (j.parent_id) posterIds.add(j.parent_id as string)
    const names = posterIds.size
      ? (await admin.from('profiles').select('id, full_name, is_team_account').in('id', [...posterIds])).data ?? []
      : []
    const nameOf = new Map(names.map((n) => [n.id as string, n.is_team_account ? 'TutorMint team' : formatName((n.full_name as string | null) ?? '') || 'Member']))
    const postedBy = new Map(owners.map((o) => [o.job_id as string, (o.posted_by as string | null) ?? null]))
    for (const j of live) {
      const staff = postedBy.get(j.id as string)
      tuitions.push({
        id: j.id as string,
        ref: (j.ref_id as string | null) ?? null,
        title: (j.title as string | null) ?? 'Tuition',
        city: (j.city as string | null) ?? null,
        status: j.status as string,
        postedAt: j.created_at as string,
        poster: (staff && nameOf.get(staff)) || nameOf.get(j.parent_id as string) || 'Parent',
        href: `/admin/jobs/${j.id as string}`,
      })
    }
  }

  return numberFirstOutcome({
    msisdn,
    doNotUse: (dnu.data ?? []).length > 0,
    onHold: (hold.data ?? []).length > 0,
    tuitions,
    parent,
  })
}

/** A refused number, audited WITHOUT the number (its hash prefix only). */
export async function auditNumberBlocked(
  actor: { id: string; adminRole: AdminRole; email?: string | null },
  msisdn: string,
  kind: 'do_not_use' | 'on_hold',
  where: 'post' | 'edit',
): Promise<void> {
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'job.number_blocked',
    targetType: 'number',
    targetId: numberHash(msisdn).slice(0, 12),
    detail: { reason: kind, where },
  })
}

/** The parent account holding this number, or null (oldest first). */
export async function parentAccountForNumber(msisdn: string): Promise<ParentAccount | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const tail = `%${lastTen(msisdn)}`
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, role, phone_number, whatsapp, is_team_account, is_test_name, hidden_from_public, merged_into, created_at')
    .or(`phone_number.like.${tail},whatsapp.like.${tail}`)
    .order('created_at', { ascending: true })
    .limit(20)
  if (error) return null
  const p = (data ?? []).find((r) => isParentAccount(r) && (sameNumber(r.phone_number as string | null, msisdn) || sameNumber(r.whatsapp as string | null, msisdn)))
  return p ? { id: p.id as string, name: formatName((p.full_name as string | null) ?? '') || 'Parent' } : null
}

/**
 * Link a staff-posted tuition to the parent account its number belongs to
 * (job_contacts.parent_account_id, admin-only; migration 216), or clear the link
 * when the number no longer belongs to one. Ownership does not change: the
 * tuition stays the team account's. Best-effort — a failure never undoes a post.
 */
export async function linkTuitionToParentByNumber(jobId: string, msisdn: string): Promise<ParentAccount | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const parent = await parentAccountForNumber(msisdn)
  await admin.from('job_contacts').update({ parent_account_id: parent?.id ?? null }).eq('job_id', jobId)
  return parent
}
