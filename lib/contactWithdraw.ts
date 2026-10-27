// lib/contactWithdraw.ts — "Withdraw a contact" and the "Do not use" list
// (owner, 27 Oct 2026). Rules in lib/contactWithdrawCore.ts.
//
//   searchContact(msisdn)      every place the number is stored as contact data:
//                              tuitions (job_contacts phone / WhatsApp / social,
//                              or written in the title / description), accounts
//                              (mobile, WhatsApp, second number), parent-posted
//                              tuitions of such accounts, and the imported leads
//                              (legacy_* tables). Counts of tutors who applied
//                              or opened each tuition's number.
//   withdrawContact(...)       closes every tuition whose own contact data holds
//                              the number (status 'hidden', hidden_reason
//                              'contact_withdrawn' → 301, noindex, no JobPosting,
//                              out of every list; applications "no longer
//                              available"), removes the number from job_contacts
//                              and the tuition text, clears it from the imported
//                              leads, and adds it to the Do not use list.
//                              ACCOUNTS are not changed: a parent account that
//                              owns the number gets the existing "Close account
//                              and erase data" offer instead.
//   doNotUseRefusal(numbers)   the check every posting path runs.
//   loadDoNotUseList / removeFromDoNotUse — the Owner's list.
//   consentReport()            staff-posted tuitions with a parent number that
//                              belongs to no account, counted per staff member.
//
// Service role throughout. Never logs or audits a number.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminActor } from '@/lib/adminAuth'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { revalidateLanding } from '@/lib/landingRevalidate'
import { formatName } from '@/lib/formatName'
import {
  DO_NOT_USE_MESSAGE,
  listedNumber,
  maskNumber,
  numberHash,
  sameNumber,
  textHasNumber,
  WITHDRAWN_LABEL,
  WITHDRAWN_REASON,
  consentCounts,
  closeUpdate,
  contactUpdate,
} from '@/lib/contactWithdrawCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

export type MatchVia = 'contact_phone' | 'contact_whatsapp' | 'contact_text' | 'tuition_text' | 'parent_account'

export type TuitionMatch = {
  id: string
  ref: string | null
  title: string
  city: string | null
  status: string
  statusLabel: string
  postedBy: string
  via: MatchVia[]
  applied: number
  revealed: number
  /** Closed by "Withdraw this contact" (its own contact data holds the number). */
  willClose: boolean
  alreadyWithdrawn: boolean
}

export type AccountMatch = {
  id: string
  name: string
  role: string
  fields: ('mobile' | 'WhatsApp' | 'second number' | 'tutor profile number')[]
  /** A parent / institution account: offer "Close account and erase data". */
  isParent: boolean
}

export type LeadMatch = { table: string; column: string; rows: number }

export type SearchResult = {
  masked: string
  tuitions: TuitionMatch[]
  accounts: AccountMatch[]
  leads: LeadMatch[]
  listed: boolean
  pastWithdrawals: number
}

const LEAD_COLUMNS: { table: string; column: string }[] = [
  { table: 'legacy_parent_profiles', column: 'phone' },
  { table: 'legacy_parents', column: 'phone' },
  { table: 'legacy_parents', column: 'whatsapp' },
  { table: 'legacy_tutors', column: 'phone' },
  { table: 'legacy_tutors', column: 'whatsapp' },
]

const STATUS_WORDS: Record<string, string> = { open: 'Open', paused: 'Paused', closed: 'Closed', hired: 'Hired', hidden: 'Hidden' }

async function liveHashes(admin: Admin): Promise<Set<string>> {
  const { data, error } = await admin.from('do_not_use_numbers').select('number_hash').is('removed_at', null)
  if (error) throw new Error('do_not_use_numbers unreadable')
  return new Set((data ?? []).map((r) => r.number_hash as string))
}

/**
 * The check every posting path runs: the refusal message when any of these
 * numbers is on the Do not use list, else null. It FAILS OPEN (null) when the
 * list cannot be read, so a database wobble never stops tuitions being posted;
 * the failure is logged without any number.
 */
export async function doNotUseRefusal(numbers: (string | null | undefined)[]): Promise<string | null> {
  if (!numbers.some((n) => !!n)) return null
  const admin = createAdminClient()
  if (!admin) return null
  try {
    return listedNumber(numbers, await liveHashes(admin)) ? DO_NOT_USE_MESSAGE : null
  } catch {
    console.warn('[do-not-use] list unreadable; check skipped')
    return null
  }
}

/** Raw values in a lead column that are this number (any stored format). */
async function leadValues(admin: Admin, table: string, column: string, msisdn: string): Promise<string[]> {
  let data: Record<string, unknown>[]
  try {
    data = await pageAll<Record<string, unknown>>((from, to) => admin.from(table).select(column).not(column, 'is', null).order(column).range(from, to) as never)
  } catch {
    return []
  }
  const out = new Set<string>()
  for (const r of data) {
    const v = r[column]
    if (typeof v === 'string' && sameNumber(v, msisdn)) out.add(v)
  }
  return [...out]
}

export async function searchContact(msisdn: string): Promise<SearchResult> {
  const admin = createAdminClient()
  if (!admin) throw new Error('unavailable')

  const [contacts, jobsText, profiles, tutorProfiles, hashes, past] = await Promise.all([
    pageAll<{ job_id: string; contact_phone: string | null; contact_whatsapp: string | null; contact_social: string | null; contact_address: string | null }>((from, to) =>
      admin.from('job_contacts').select('job_id, contact_phone, contact_whatsapp, contact_social, contact_address').order('job_id').range(from, to),
    ),
    pageAll<{ id: string; title: string | null; description: string | null }>((from, to) =>
      admin.from('jobs').select('id, title, description').order('id').range(from, to),
    ),
    pageAll<{ id: string; role: string | null; full_name: string | null; phone_number: string | null; whatsapp: string | null; secondary_phone: string | null; is_team_account: boolean | null }>((from, to) =>
      admin.from('profiles').select('id, role, full_name, phone_number, whatsapp, secondary_phone, is_team_account').order('id').range(from, to),
    ),
    pageAll<{ id: string; phone_number: string | null; whatsapp_number: string | null }>((from, to) =>
      admin.from('tutor_profiles').select('id, phone_number, whatsapp_number').order('id').range(from, to),
    ),
    liveHashes(admin).catch(() => new Set<string>()),
    admin.from('contact_withdrawals').select('id', { count: 'exact', head: true }).eq('number_hash', numberHash(msisdn)),
  ])

  // Tuitions whose OWN contact data holds the number.
  const via = new Map<string, Set<MatchVia>>()
  const add = (id: string, v: MatchVia) => {
    if (!via.has(id)) via.set(id, new Set())
    via.get(id)!.add(v)
  }
  for (const c of contacts) {
    if (sameNumber(c.contact_phone, msisdn)) add(c.job_id, 'contact_phone')
    if (sameNumber(c.contact_whatsapp, msisdn)) add(c.job_id, 'contact_whatsapp')
    if (textHasNumber(c.contact_social, msisdn) || textHasNumber(c.contact_address, msisdn)) add(c.job_id, 'contact_text')
  }
  for (const j of jobsText) if (textHasNumber(j.title, msisdn) || textHasNumber(j.description, msisdn)) add(j.id, 'tuition_text')

  // Accounts holding the number.
  const tpBy = new Map(tutorProfiles.map((t) => [t.id, t]))
  const accounts: AccountMatch[] = []
  for (const p of profiles) {
    if (p.is_team_account) continue
    const fields: AccountMatch['fields'] = []
    if (sameNumber(p.phone_number, msisdn)) fields.push('mobile')
    if (sameNumber(p.whatsapp, msisdn)) fields.push('WhatsApp')
    if (sameNumber(p.secondary_phone, msisdn)) fields.push('second number')
    const tp = tpBy.get(p.id)
    if (tp && (sameNumber(tp.phone_number, msisdn) || sameNumber(tp.whatsapp_number, msisdn))) fields.push('tutor profile number')
    if (fields.length === 0) continue
    const role = p.role ?? 'member'
    accounts.push({ id: p.id, name: formatName(p.full_name ?? '') || 'Member', role, fields, isParent: role === 'parent' || role === 'academy' })
  }
  // A parent account's own tuitions carry its mobile as their contact.
  const parentIds = accounts.filter((a) => a.isParent).map((a) => a.id)
  if (parentIds.length > 0) {
    const own = await pageAllIn<{ id: string }, string>(parentIds, (part, from, to) => admin.from('jobs').select('id').in('parent_id', part).order('id').range(from, to))
    for (const j of own) add(j.id, 'parent_account')
  }

  const ids = [...via.keys()]
  const tuitions: TuitionMatch[] = []
  if (ids.length > 0) {
    const [jobs, apps, access, owners] = await Promise.all([
      pageAllIn<{ id: string; ref_id: string | null; title: string | null; city: string | null; status: string | null; parent_id: string | null; hidden_reason: string | null }, string>(ids, (part, from, to) =>
        admin.from('jobs').select('id, ref_id, title, city, status, parent_id, hidden_reason').in('id', part).order('id').range(from, to),
      ),
      pageAllIn<{ job_id: string; withdrawn_at: string | null }, string>(ids, (part, from, to) =>
        admin.from('applications').select('id, job_id, withdrawn_at').in('job_id', part).order('id').range(from, to),
      ),
      pageAllIn<{ job_id: string }, string>(ids, (part, from, to) =>
        admin.from('tuition_access').select('tutor_id, job_id').in('job_id', part).order('tutor_id').order('job_id').range(from, to),
      ),
      pageAllIn<{ job_id: string; posted_by: string | null }, string>(ids, (part, from, to) =>
        admin.from('tuition_owners').select('job_id, posted_by').in('job_id', part).order('job_id').range(from, to),
      ),
    ])
    const nameBy = new Map(profiles.map((p) => [p.id, { name: formatName(p.full_name ?? '') || 'Member', team: !!p.is_team_account }]))
    const posterBy = new Map(owners.map((o) => [o.job_id, o.posted_by]))
    const appCount = new Map<string, number>()
    for (const a of apps) if (!a.withdrawn_at) appCount.set(a.job_id, (appCount.get(a.job_id) ?? 0) + 1)
    const accessCount = new Map<string, number>()
    for (const a of access) accessCount.set(a.job_id, (accessCount.get(a.job_id) ?? 0) + 1)
    for (const j of jobs) {
      const v = [...(via.get(j.id) ?? [])]
      const staffId = posterBy.get(j.id) ?? null
      const parent = j.parent_id ? nameBy.get(j.parent_id) : undefined
      const postedBy = staffId ? `Staff — ${nameBy.get(staffId)?.name ?? 'Former staff'}` : parent?.team ? 'Staff — unknown' : `Parent — ${parent?.name ?? 'Member'}`
      const withdrawn = j.status === 'hidden' && j.hidden_reason === WITHDRAWN_REASON
      tuitions.push({
        id: j.id,
        ref: j.ref_id,
        title: (j.title ?? '').trim() || 'Untitled tuition',
        city: j.city,
        status: j.status ?? 'open',
        statusLabel: withdrawn ? WITHDRAWN_LABEL : STATUS_WORDS[j.status ?? 'open'] ?? (j.status ?? 'open'),
        postedBy,
        via: v,
        applied: appCount.get(j.id) ?? 0,
        revealed: accessCount.get(j.id) ?? 0,
        willClose: v.some((x) => x !== 'parent_account'),
        alreadyWithdrawn: withdrawn,
      })
    }
    tuitions.sort((a, b) => (a.ref ?? '').localeCompare(b.ref ?? ''))
  }

  const leads: LeadMatch[] = []
  for (const l of LEAD_COLUMNS) {
    const vals = await leadValues(admin, l.table, l.column, msisdn)
    if (vals.length > 0) leads.push({ table: l.table, column: l.column, rows: vals.length })
  }

  return {
    masked: maskNumber(msisdn),
    tuitions,
    accounts,
    leads,
    listed: hashes.has(numberHash(msisdn)),
    pastWithdrawals: past.count ?? 0,
  }
}

export type WithdrawResult =
  | { ok: true; withdrawalId: string; closed: number; contactsCleared: number; leadsCleared: number; listed: boolean; parentAccounts: AccountMatch[] }
  | { ok: false; status: number; error: string }

export async function withdrawContact(args: { actor: AdminActor; actorName: string; msisdn: string; reason: string }): Promise<WithdrawResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { msisdn } = args
  const reason = args.reason.trim()
  const found = await searchContact(msisdn)
  const hash = numberHash(msisdn)
  const masked = found.masked

  // 1. Close each tuition whose own contact data holds the number, and take
  //    the number out of its text.
  const toClose = found.tuitions.filter((t) => t.willClose)
  const closedRefs: string[] = []
  const now = new Date().toISOString()
  for (const t of toClose) {
    const { data: job } = await admin.from('jobs').select('id, status, hidden_prev_status, title, description').eq('id', t.id).maybeSingle()
    if (!job) continue
    const update = closeUpdate(job as { status: string | null; title: string | null; description: string | null }, msisdn, now)
    const { error } = await admin.from('jobs').update(update).eq('id', t.id)
    if (error) return { ok: false, status: 500, error: 'A tuition could not be closed. Nothing else was changed after it; try again.' }
    closedRefs.push(t.ref ?? t.id)
    await logAdminAction({
      actorId: args.actor.id,
      actorRole: args.actor.adminRole,
      actorEmail: args.actor.email,
      action: 'job.close_contact_withdrawn',
      targetType: 'job',
      targetId: t.id,
      detail: { previousStatus: job.status, ref: t.ref },
    })
  }

  // 2. Remove the number from every matching job_contacts row.
  let contactsCleared = 0
  const contactIds = found.tuitions.filter((t) => t.via.some((v) => v === 'contact_phone' || v === 'contact_whatsapp' || v === 'contact_text')).map((t) => t.id)
  for (const id of contactIds) {
    const { data: c } = await admin.from('job_contacts').select('contact_phone, contact_whatsapp, contact_social, contact_address').eq('job_id', id).maybeSingle()
    if (!c) continue
    const update = contactUpdate(c as Parameters<typeof contactUpdate>[0], msisdn)
    if (!update) continue
    const { error } = await admin.from('job_contacts').update(update).eq('job_id', id)
    if (!error) contactsCleared++
  }

  // 3. The imported leads.
  let leadsCleared = 0
  for (const l of LEAD_COLUMNS) {
    const vals = await leadValues(admin, l.table, l.column, msisdn)
    if (vals.length === 0) continue
    const { error } = await admin.from(l.table).update({ [l.column]: null }).in(l.column, vals)
    if (!error) leadsCleared += vals.length
  }

  // 4. The Do not use list (one live row per number).
  const { data: live } = await admin.from('do_not_use_numbers').select('id').eq('number_hash', hash).is('removed_at', null).maybeSingle()
  if (!live) {
    const { error } = await admin.from('do_not_use_numbers').insert({
      number_hash: hash,
      masked,
      reason,
      source: 'withdraw',
      added_by: args.actor.id,
      added_by_name: args.actorName,
    })
    if (error) return { ok: false, status: 500, error: 'The tuitions were closed, but the number could not be added to the Do not use list. Try again.' }
  }

  const parentAccounts = found.accounts.filter((a) => a.isParent)
  const summary = {
    tuitionIds: toClose.map((t) => t.id),
    refs: closedRefs,
    closed: closedRefs.length,
    contactsCleared,
    leadsCleared,
    accountsMatched: found.accounts.length,
    parentAccounts: parentAccounts.map((a) => a.id),
  }
  const { data: w } = await admin
    .from('contact_withdrawals')
    .insert({ number_hash: hash, masked, reason, done_by: args.actor.id, done_by_name: args.actorName, summary })
    .select('id')
    .single()
  const withdrawalId = (w?.id as string | undefined) ?? 'unknown'
  await logAdminAction({
    actorId: args.actor.id,
    actorRole: args.actor.adminRole,
    actorEmail: args.actor.email,
    action: 'contact.withdraw',
    targetType: 'contact_withdrawal',
    targetId: withdrawalId,
    detail: { reason, ...summary, alreadyListed: !!live },
  })

  revalidateLanding()
  return { ok: true, withdrawalId, closed: closedRefs.length, contactsCleared, leadsCleared, listed: true, parentAccounts }
}

export type ListRow = { id: string; masked: string; reason: string; source: string; addedByName: string | null; addedAt: string }

export async function loadDoNotUseList(): Promise<ListRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin
    .from('do_not_use_numbers')
    .select('id, masked, reason, source, added_by_name, added_at')
    .is('removed_at', null)
    .order('added_at', { ascending: false })
  return (data ?? []).map((r) => ({
    id: r.id as string,
    masked: r.masked as string,
    reason: r.reason as string,
    source: r.source as string,
    addedByName: (r.added_by_name as string | null) ?? null,
    addedAt: r.added_at as string,
  }))
}

export async function removeFromDoNotUse(args: { actor: AdminActor; actorName: string; id: string; reason: string }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now.' }
  const { data, error } = await admin
    .from('do_not_use_numbers')
    .update({ removed_at: new Date().toISOString(), removed_by: args.actor.id, removed_by_name: args.actorName, removed_reason: args.reason.trim() })
    .eq('id', args.id)
    .is('removed_at', null)
    .select('id')
  if (error) return { ok: false, status: 500, error: 'That did not save. Try again.' }
  if (!data || data.length === 0) return { ok: false, status: 404, error: 'That entry is not on the list.' }
  await logAdminAction({
    actorId: args.actor.id,
    actorRole: args.actor.adminRole,
    actorEmail: args.actor.email,
    action: 'contact.do_not_use_remove',
    targetType: 'do_not_use_number',
    targetId: args.id,
    detail: { reason: args.reason.trim() },
  })
  return { ok: true }
}

/** Staff-posted tuitions with a parent number that belongs to no account,
 *  per staff member (counts only). */
export async function consentReport(): Promise<{ staff: string; count: number }[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data: team } = await admin.from('profiles').select('id').eq('is_team_account', true)
  const teamIds = (team ?? []).map((t) => t.id as string)
  if (teamIds.length === 0) return []
  const [jobs, profiles] = await Promise.all([
    pageAllIn<{ id: string }, string>(teamIds, (part, from, to) => admin.from('jobs').select('id').in('parent_id', part).order('id').range(from, to)),
    pageAll<{ id: string; full_name: string | null; phone_number: string | null; whatsapp: string | null; secondary_phone: string | null; is_team_account: boolean | null }>((from, to) =>
      admin.from('profiles').select('id, full_name, phone_number, whatsapp, secondary_phone, is_team_account').order('id').range(from, to),
    ),
  ])
  const ids = jobs.map((j) => j.id)
  const [contacts, owners] = await Promise.all([
    pageAllIn<{ job_id: string; contact_phone: string | null; contact_whatsapp: string | null }, string>(ids, (part, from, to) =>
      admin.from('job_contacts').select('job_id, contact_phone, contact_whatsapp').in('job_id', part).order('job_id').range(from, to),
    ),
    pageAllIn<{ job_id: string; posted_by: string | null }, string>(ids, (part, from, to) =>
      admin.from('tuition_owners').select('job_id, posted_by').in('job_id', part).order('job_id').range(from, to),
    ),
  ])
  const accountNumbers = new Set<string>()
  const { normalisePkMobile } = await import('@/lib/phone')
  for (const p of profiles) {
    if (p.is_team_account) continue
    for (const v of [p.phone_number, p.whatsapp, p.secondary_phone]) {
      const m = normalisePkMobile(v)
      if (m) accountNumbers.add(m)
    }
  }
  const names = new Map(profiles.map((p) => [p.id, formatName(p.full_name ?? '') || 'Former staff']))
  const posterBy = new Map(owners.map((o) => [o.job_id, o.posted_by]))
  const rows = contacts.map((c) => ({ postedBy: posterBy.get(c.job_id) ?? null, number: c.contact_phone ?? c.contact_whatsapp }))
  return consentCounts(rows, accountNumbers, (id) => names.get(id) ?? 'Former staff')
}

/** For a batch (bulk import): one read of the list, then a cheap check per
 *  number. Fails open like doNotUseRefusal. */
export async function doNotUseChecker(): Promise<(numbers: (string | null | undefined)[]) => boolean> {
  const admin = createAdminClient()
  if (!admin) return () => false
  try {
    const hashes = await liveHashes(admin)
    return (numbers) => listedNumber(numbers, hashes)
  } catch {
    console.warn('[do-not-use] list unreadable; check skipped')
    return () => false
  }
}
