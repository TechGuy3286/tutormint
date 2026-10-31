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
import type { ListedEntry } from '@/lib/withdrawListedCore'
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
  COMPLAINT_LABEL,
  COMPLAINT_REASON,
  holdSnapshot,
  mayRestore,
  pauseSkips,
  pauseUpdate,
  postingRefusal,
  restoreUpdate,
  type HoldSnapshot,
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
  /** Paused by "Pause all their tuitions" (owner, 27 Oct 2026). */
  pausedOnComplaint: boolean
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
  /** The live Do not use entry for this number (when, by whom) — never the number. */
  listedEntry: ListedEntry | null
  pastWithdrawals: number
  /** The live hold on this number, when one exists. */
  hold: { id: string; heldAt: string; heldByName: string | null } | null
}

const LEAD_COLUMNS: { table: string; column: string }[] = [
  { table: 'legacy_parent_profiles', column: 'phone' },
  { table: 'legacy_parents', column: 'phone' },
  { table: 'legacy_parents', column: 'whatsapp' },
  { table: 'legacy_tutors', column: 'phone' },
  { table: 'legacy_tutors', column: 'whatsapp' },
]

const STATUS_WORDS: Record<string, string> = { open: 'Open', paused: 'Paused', closed: 'Closed', hired: 'Hired', hidden: 'Hidden' }

async function liveHoldHashes(admin: Admin): Promise<Set<string>> {
  const { data, error } = await admin.from('contact_holds').select('number_hash').is('released_at', null)
  if (error) throw new Error('contact_holds unreadable')
  return new Set((data ?? []).map((r) => r.number_hash as string))
}

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
    const [dnu, holds] = await Promise.all([liveHashes(admin), liveHoldHashes(admin).catch(() => new Set<string>())])
    return postingRefusal(numbers, dnu, holds)
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

  const [contacts, jobsText, profiles, tutorProfiles, hashes, past, holdRow, listedRow] = await Promise.all([
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
    admin.from('contact_holds').select('id, held_at, held_by_name').eq('number_hash', numberHash(msisdn)).is('released_at', null).maybeSingle(),
    admin
      .from('do_not_use_numbers')
      .select('id, added_at, added_by_name')
      .eq('number_hash', numberHash(msisdn))
      .is('removed_at', null)
      .order('added_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
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
      const complaint = j.status === 'hidden' && j.hidden_reason === COMPLAINT_REASON
      tuitions.push({
        id: j.id,
        ref: j.ref_id,
        title: (j.title ?? '').trim() || 'Untitled tuition',
        city: j.city,
        status: j.status ?? 'open',
        statusLabel: withdrawn ? WITHDRAWN_LABEL : complaint ? COMPLAINT_LABEL : STATUS_WORDS[j.status ?? 'open'] ?? (j.status ?? 'open'),
        postedBy,
        via: v,
        applied: appCount.get(j.id) ?? 0,
        revealed: accessCount.get(j.id) ?? 0,
        willClose: v.some((x) => x !== 'parent_account'),
        alreadyWithdrawn: withdrawn,
        pausedOnComplaint: complaint,
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
    listed: hashes.has(numberHash(msisdn)) || !!listedRow.data,
    listedEntry: listedRow.data
      ? { id: listedRow.data.id as string, addedAt: listedRow.data.added_at as string, addedByName: (listedRow.data.added_by_name as string | null) ?? null }
      : null,
    pastWithdrawals: past.count ?? 0,
    hold: holdRow.data ? { id: holdRow.data.id as string, heldAt: holdRow.data.held_at as string, heldByName: (holdRow.data.held_by_name as string | null) ?? null } : null,
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

  // A live hold ends: the number is now removed for good.
  await admin
    .from('contact_holds')
    .update({ released_at: now, released_by: args.actor.id, released_by_name: args.actorName, released_reason: 'Removed permanently', released_how: 'removed' })
    .eq('number_hash', hash)
    .is('released_at', null)

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

// ---------------------------------------------------------------------------
// Pause on complaint (owner, 27 Oct 2026). Rules in lib/contactWithdrawCore.

export type PauseResult =
  | { ok: true; holdId: string; paused: number; skipped: number }
  | { ok: false; status: number; error: string }

/** "Pause all their tuitions": every tuition whose own contact data holds the
 *  number is paused on complaint, its exact state kept for "Unpause all", and
 *  the number goes on hold (new tuitions using it are refused). The number is
 *  never written anywhere but as a hash and a masked form. */
export async function pauseContact(args: { actor: AdminActor; actorName: string; msisdn: string; reason: string }): Promise<PauseResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const reason = args.reason.trim()
  const hash = numberHash(args.msisdn)
  const found = await searchContact(args.msisdn)
  if (found.hold) return { ok: false, status: 409, error: 'This number is already on hold. Use Unpause all to lift it.' }

  const { data: hold, error: holdError } = await admin
    .from('contact_holds')
    .insert({ number_hash: hash, masked: found.masked, reason, held_by: args.actor.id, held_by_name: args.actorName })
    .select('id')
    .single()
  if (holdError || !hold) return { ok: false, status: 500, error: 'The hold could not be saved. Nothing was changed; try again.' }
  const holdId = hold.id as string

  const now = new Date().toISOString()
  let paused = 0
  let skipped = 0
  const refs: string[] = []
  for (const t of found.tuitions.filter((x) => x.willClose)) {
    const { data: job } = await admin.from('jobs').select('id, status, hidden_reason, hidden_prev_status, hidden_at, is_featured').eq('id', t.id).maybeSingle()
    if (!job) continue
    const state = job as { status: string | null; hidden_reason: string | null; hidden_prev_status: string | null; hidden_at: string | null; is_featured: boolean | null }
    if (pauseSkips(state)) {
      skipped++
      continue
    }
    const { error: snapError } = await admin.from('contact_hold_jobs').insert({ hold_id: holdId, job_id: t.id, ...holdSnapshot(state), paused_at: now })
    if (snapError) return { ok: false, status: 500, error: 'A tuition could not be paused. The ones before it are paused; try again to finish.' }
    const { error } = await admin.from('jobs').update(pauseUpdate(state, now)).eq('id', t.id)
    if (error) return { ok: false, status: 500, error: 'A tuition could not be paused. The ones before it are paused; try again to finish.' }
    paused++
    refs.push(t.ref ?? t.id)
    await logAdminAction({
      actorId: args.actor.id,
      actorRole: args.actor.adminRole,
      actorEmail: args.actor.email,
      action: 'job.pause_contact_complaint',
      targetType: 'job',
      targetId: t.id,
      detail: { previousStatus: state.status, ref: t.ref },
    })
  }

  await logAdminAction({
    actorId: args.actor.id,
    actorRole: args.actor.adminRole,
    actorEmail: args.actor.email,
    action: 'contact.pause_complaint',
    targetType: 'contact_hold',
    targetId: holdId,
    detail: { reason, paused, skipped, refs },
  })
  revalidateLanding()
  return { ok: true, holdId, paused, skipped }
}

export type UnpauseResult =
  | { ok: true; restored: number; leftAlone: number }
  | { ok: false; status: number; error: string }

/** "Unpause all": every tuition this hold paused goes back to EXACTLY its
 *  earlier state, and the hold is lifted. A tuition withdrawn since is left as
 *  it is. A parent account hidden in the meantime is applied again afterwards
 *  (sync_parent_tuitions), so a hidden parent's tuitions stay hidden. */
export async function unpauseContact(args: { actor: AdminActor; actorName: string; holdId: string; reason: string }): Promise<UnpauseResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: hold } = await admin.from('contact_holds').select('id, released_at').eq('id', args.holdId).maybeSingle()
  if (!hold || hold.released_at) return { ok: false, status: 404, error: 'That number is not on hold.' }

  const { data: rows } = await admin
    .from('contact_hold_jobs')
    .select('job_id, prev_status, prev_hidden_reason, prev_hidden_prev_status, prev_hidden_at, prev_is_featured')
    .eq('hold_id', args.holdId)
    .is('restored_at', null)
  const now = new Date().toISOString()
  let restored = 0
  let leftAlone = 0
  const parents = new Set<string>()
  for (const r of rows ?? []) {
    const jobId = r.job_id as string
    const { data: job } = await admin.from('jobs').select('id, status, hidden_reason, parent_id, ref_id').eq('id', jobId).maybeSingle()
    if (!job || !mayRestore(job as { status: string | null; hidden_reason: string | null })) {
      leftAlone++
      continue
    }
    const { error } = await admin.from('jobs').update(restoreUpdate(r as HoldSnapshot)).eq('id', jobId).eq('hidden_reason', COMPLAINT_REASON)
    if (error) return { ok: false, status: 500, error: 'A tuition could not be put back. The ones before it are back; try again to finish.' }
    await admin.from('contact_hold_jobs').update({ restored_at: now }).eq('hold_id', args.holdId).eq('job_id', jobId)
    if (job.parent_id) parents.add(job.parent_id as string)
    restored++
    await logAdminAction({
      actorId: args.actor.id,
      actorRole: args.actor.adminRole,
      actorEmail: args.actor.email,
      action: 'job.unpause_contact_complaint',
      targetType: 'job',
      targetId: jobId,
      detail: { restoredStatus: r.prev_status, ref: job.ref_id ?? null },
    })
  }
  for (const p of parents) {
    const { error } = await admin.rpc('sync_parent_tuitions', { p_parent: p })
    if (error) console.warn('[contact-hold] parent re-check skipped')
  }

  await admin
    .from('contact_holds')
    .update({ released_at: now, released_by: args.actor.id, released_by_name: args.actorName, released_reason: args.reason.trim(), released_how: 'unpaused' })
    .eq('id', args.holdId)
    .is('released_at', null)
  await logAdminAction({
    actorId: args.actor.id,
    actorRole: args.actor.adminRole,
    actorEmail: args.actor.email,
    action: 'contact.unpause_complaint',
    targetType: 'contact_hold',
    targetId: args.holdId,
    detail: { reason: args.reason.trim(), restored, leftAlone },
  })
  revalidateLanding()
  return { ok: true, restored, leftAlone }
}

export type HoldRow = { id: string; masked: string; reason: string; heldByName: string | null; heldAt: string; tuitions: number }

/** The "On hold" list (masked numbers only). */
export async function loadHoldList(): Promise<HoldRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin.from('contact_holds').select('id, masked, reason, held_by_name, held_at').is('released_at', null).order('held_at', { ascending: false })
  const ids = (data ?? []).map((r) => r.id as string)
  const counts = new Map<string, number>()
  if (ids.length > 0) {
    const { data: jobs } = await admin.from('contact_hold_jobs').select('hold_id').in('hold_id', ids).is('restored_at', null)
    for (const j of jobs ?? []) counts.set(j.hold_id as string, (counts.get(j.hold_id as string) ?? 0) + 1)
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    masked: r.masked as string,
    reason: r.reason as string,
    heldByName: (r.held_by_name as string | null) ?? null,
    heldAt: r.held_at as string,
    tuitions: counts.get(r.id as string) ?? 0,
  }))
}
