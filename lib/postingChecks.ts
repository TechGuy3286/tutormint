import 'server-only'

// lib/postingChecks.ts — the server half of lib/postingChecksCore (owner, 23
// Nov 2026 — PR-18 Part A.3). The contact checks run by EVERY posting route:
// staff create and edit (createTeamJob / updateTeamJob — the AI-filled form and
// the manual form are the same form and the same route), the form's live check
// (/api/admin/jobs/contact-check) and the parent's own post (block only).
//
//   postingBlock(numbers)  — Do not use (withdrawn) → erased member → on hold
//   numberRepeats(...)     — the same number, overlapping grade or subject,
//                            open or paused, last 30 days
//
// Targeted reads only. The Do not use / hold lists are read by hash, the erased
// list by HMAC fingerprint (lib/eraseFingerprintCore) — a number is never
// stored, returned or logged. Reading the erased list here records NO
// "blocked re-sign-up" attempt (that list is for sign-ups).
//
// Fails open on a read error, like doNotUseRefusal, so a database wobble never
// stops tuitions being posted; the failure is logged without any number.

import { createAdminClient } from '@/lib/supabase/admin'
import { numberHash, sameNumber } from '@/lib/contactWithdrawCore'
import { fingerprint } from '@/lib/eraseFingerprintCore'
import { fingerprintSecret } from '@/lib/eraseFingerprint'
import { lastTen } from '@/lib/numberFirstCore'
import { pageAllIn } from '@/lib/pageAll'
import { logAdminAction } from '@/lib/auditLog'
import { findPhoneSpans } from '@/lib/masking'
import type { AdminRole } from '@/lib/adminAuth'
import { blockFor, repeatsFor, REPEAT_WINDOW_DAYS, type BlockKind, type ContactBlock, type ContactCheckResult, type RepeatCandidate, type RepeatHit } from '@/lib/postingChecksCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

/** Is any of these numbers on the erased list (not allowed back by the Owner)? */
async function erasedAny(admin: Admin, msisdns: string[]): Promise<boolean> {
  const secret = fingerprintSecret()
  if (!secret || msisdns.length === 0) return false
  const fps = msisdns.map((m) => fingerprint('mobile', m, secret)).filter((x): x is string => !!x)
  if (fps.length === 0) return false
  const { data, error } = await admin.from('erased_fingerprints').select('id').eq('kind', 'mobile').in('fingerprint', fps).is('allowed_at', null).limit(1)
  if (error) throw new Error('erased_fingerprints unreadable')
  return (data ?? []).length > 0
}

/** The block for these numbers (MSISDNs), or null. Fails open. */
export async function postingBlock(msisdns: (string | null | undefined)[]): Promise<ContactBlock | null> {
  const nums = [...new Set(msisdns.filter((x): x is string => !!x))]
  if (nums.length === 0) return null
  const admin = createAdminClient()
  if (!admin) return null
  try {
    const hashes = nums.map(numberHash)
    const [dnu, hold, erased] = await Promise.all([
      admin.from('do_not_use_numbers').select('id').in('number_hash', hashes).is('removed_at', null).limit(1),
      admin.from('contact_holds').select('id').in('number_hash', hashes).is('released_at', null).limit(1),
      erasedAny(admin, nums),
    ])
    if (dnu.error) throw new Error('do_not_use_numbers unreadable')
    return blockFor({ withdrawn: (dnu.data ?? []).length > 0, erased, onHold: !hold.error && (hold.data ?? []).length > 0 })
  } catch (e) {
    console.error('[posting-checks] block check failed open:', e instanceof Error ? e.message : 'error')
    return null
  }
}

/** Open / paused tuitions in the last 30 days on this number that overlap. */
export async function numberRepeats(
  msisdn: string | null,
  me: { levels: string[]; masterIds: number[] },
  excludeJobId: string | null = null,
): Promise<RepeatHit[]> {
  if (!msisdn) return []
  const admin = createAdminClient()
  if (!admin) return []
  try {
    const tail = `%${lastTen(msisdn)}`
    const { data: contacts, error } = await admin
      .from('job_contacts')
      .select('job_id, contact_phone, contact_whatsapp')
      .or(`contact_phone.like.${tail},contact_whatsapp.like.${tail}`)
      .limit(300)
    if (error) throw new Error('job_contacts unreadable')
    const ids = [...new Set((contacts ?? []).filter((c) => sameNumber(c.contact_phone as string | null, msisdn) || sameNumber(c.contact_whatsapp as string | null, msisdn)).map((c) => c.job_id as string))]
    if (ids.length === 0) return []
    const since = new Date(Date.now() - REPEAT_WINDOW_DAYS * 86_400_000).toISOString()
    const { data: jobs, error: jErr } = await admin
      .from('jobs')
      .select('id, ref_id, title, status, created_at, class_levels, class_level, merged_into')
      .in('id', ids.slice(0, 200))
      .in('status', ['open', 'paused'])
      .is('merged_into', null)
      .gte('created_at', since)
    if (jErr) throw new Error('jobs unreadable')
    const live = jobs ?? []
    if (live.length === 0) return []
    const subs = await pageAllIn(
      live.map((j) => j.id as string),
      (part, from, to) => admin.from('job_subjects').select('job_id, master_id').in('job_id', part).order('job_id').order('master_id').range(from, to),
    )
    const byJob = new Map<string, number[]>()
    for (const s of subs) byJob.set(s.job_id as string, [...(byJob.get(s.job_id as string) ?? []), s.master_id as number])
    const rows: RepeatCandidate[] = live.map((j) => ({
      id: j.id as string,
      ref: (j.ref_id as string | null) ?? null,
      title: (j.title as string | null) ?? 'Tuition',
      status: j.status as string,
      postedAt: String(j.created_at),
      href: `/admin/jobs/${j.id as string}`,
      levels: ((j.class_levels as string[] | null) ?? []).length > 0 ? ((j.class_levels as string[]) ?? []) : j.class_level ? [j.class_level as string] : [],
      masterIds: byJob.get(j.id as string) ?? [],
    }))
    return repeatsFor(me, rows, Date.now(), excludeJobId)
  } catch (e) {
    console.error('[posting-checks] repeat check failed open:', e instanceof Error ? e.message : 'error')
    return []
  }
}

/** Both checks for a staff post. */
export async function runContactChecks(a: {
  phone: string | null
  whatsapp?: string | null
  textNumbers?: string[]
  levels: string[]
  masterIds: number[]
  excludeJobId?: string | null
  isOwner: boolean
}): Promise<ContactCheckResult> {
  const [block, repeats] = await Promise.all([
    postingBlock([a.phone, a.whatsapp ?? null, ...(a.textNumbers ?? [])]),
    numberRepeats(a.phone, { levels: a.levels, masterIds: a.masterIds }, a.excludeJobId ?? null),
  ])
  return { block, repeats, ownerMayOverride: a.isOwner && !!block }
}

/** The Owner posted a blocked number — logged with the reason (any digits in
 *  the reason are taken out), never the number. */
export async function auditOwnerOverride(
  actor: { id: string; adminRole: AdminRole; email?: string | null },
  a: { jobId: string; kind: BlockKind; reason: string; where: 'post' | 'edit' },
): Promise<void> {
  let reason = a.reason.trim().slice(0, 300)
  for (const s of findPhoneSpans(reason).reverse()) reason = reason.slice(0, s.start) + '[number]' + reason.slice(s.end)
  reason = reason.replace(/\d{6,}/g, '[number]')
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'job.contact_check_override',
    targetType: 'job',
    targetId: a.jobId,
    detail: { kind: a.kind, reason, where: a.where },
  })
}

/** AI-filled or typed (counts only, PR-18 A.4). Best effort. */
export async function recordPostSource(jobId: string, source: 'ai' | 'manual', staffId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin.from('tuition_post_sources').upsert({ job_id: jobId, source, staff_id: staffId }, { onConflict: 'job_id', ignoreDuplicates: true }).then(
    () => undefined,
    () => undefined,
  )
}
