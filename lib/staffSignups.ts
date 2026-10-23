import 'server-only'

// lib/staffSignups.ts
//
// Sign-ups by staff (owner, 15 Oct 2026) — the I/O half. The rules are pure in
// lib/staffSignupsCore.ts. Every read and write here uses the service role:
// the four tables (migration 175) have a staff-read policy and no write policy.
//
// Where credit is given:
//   • /join/<slug> records a first-touch visit (recordJoinVisit) and the browser
//     keeps its id in the httpOnly tm_staff_ref cookie for 30 days.
//   • /api/auth/register reads the Staff code (staffCodeVisit) and, for an email
//     sign-up, credits the new account at once (creditNewAccount).
//   • /api/auth/register/verify credits a mobile sign-up when the account is
//     created there.
//   • An approved claim (decideClaim).
// Every credit, claim and decision writes admin_audit_log.

import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { normalisePkMobile, looksLikeEmail } from '@/lib/phone'
import { formatName } from '@/lib/formatName'
import { logAdminAction } from '@/lib/auditLog'
import { absoluteUrl } from '@/lib/siteUrl'
import type { AdminRole } from '@/lib/adminAccessCore'
import {
  REFUSAL_WORDS,
  boardRow,
  claimRefusal,
  codeForSlug,
  creditRefusal,
  isActiveParticipant,
  isParticipantRole,
  joinRefPath,
  linkCreditRefusal,
  mayDecideClaim,
  mayViewStaff,
  normaliseSlug,
  normaliseStaffCode,
  accountsAt,
  inProgressAt,
  isInProgressStep,
  pickSlug,
  seesEveryone,
  sortBoardRows,
  visitExpiry,
  visitValid,
  type AccountFacts,
  type BoardRow,
  type CreditedAccount,
  type MemberRole,
  type Period,
  type StaffContacts,
  type Step,
  type Visit,
} from '@/lib/staffSignupsCore'
import { accountsInRange, allUnpaid, inProgressIn, isInProgressStepFor, statusIn, type Range, type StaffStatus } from '@/lib/staffSignupsCore'
import { firstPaidAt, type PaymentFacts } from '@/lib/staffTargetsCore'
import { ADMIN_DIRECT_NAME, ADMIN_STAFF_ID, CLAIMS_CLOSED, CLAIMS_OPEN, myLinkCounts, sourceRow, type MyLinkCounts, type SourceRow } from '@/lib/staffSignupsCore'
import { formerStaffName } from '@/lib/formerStaffCore'
import { notify } from '@/lib/notifications'
import { MY_SIGNUPS_PATH, newSignupNoticeTitle } from '@/lib/mySignupsCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

export type JoinLink = { staffId: string; slug: string; code: string; url: string }

type StaffRow = {
  id: string
  full_name: string | null
  email: string | null
  phone_number: string | null
  whatsapp: string | null
  admin_role: string | null
  is_suspended: boolean | null
}

async function loadStaff(admin: Admin): Promise<StaffRow[]> {
  const { data } = await admin
    .from('profiles')
    .select('id, full_name, email, phone_number, whatsapp, admin_role, is_suspended')
    .eq('role', 'admin')
  return (data ?? []) as StaffRow[]
}

function contactsOf(staff: StaffRow[]): StaffContacts {
  const mobiles = new Set<string>()
  const emails = new Set<string>()
  for (const s of staff) {
    for (const n of [s.phone_number, s.whatsapp]) {
      const m = normalisePkMobile(n)
      if (m) mobiles.add(m)
    }
    const e = (s.email ?? '').trim().toLowerCase()
    if (e) emails.add(e)
  }
  return { mobiles, emails }
}

// -------------------------------------------------------------- join links

function toLink(r: { staff_id: string; slug: string; code: string }): JoinLink {
  return { staffId: r.staff_id, slug: r.slug, code: r.code, url: absoluteUrl(joinRefPath(r.code)) }
}

/** Every participating staff member gets a link and code; a role given later is
 *  covered the next time this runs (the board calls it). Never changes or
 *  removes an existing link. */
export async function ensureJoinLinks(adminIn?: Admin | null): Promise<JoinLink[]> {
  const admin = adminIn ?? createAdminClient()
  if (!admin) return []
  const [staff, { data: existing }] = await Promise.all([
    loadStaff(admin),
    admin.from('staff_join_links').select('staff_id, slug, code'),
  ])
  const rows = (existing ?? []) as { staff_id: string; slug: string; code: string }[]
  const have = new Set(rows.map((r) => r.staff_id))
  const slugs = new Set(rows.map((r) => r.slug))
  const codes = new Set(rows.map((r) => r.code))
  for (const s of staff) {
    if (have.has(s.id) || !isParticipantRole(s.admin_role)) continue
    let slug = pickSlug(s.full_name, slugs)
    while (codes.has(codeForSlug(slug))) slug = pickSlug(`${slug}x`, slugs)
    const { error } = await admin.from('staff_join_links').insert({ staff_id: s.id, slug, code: codeForSlug(slug) })
    if (!error) {
      rows.push({ staff_id: s.id, slug, code: codeForSlug(slug) })
      slugs.add(slug)
      codes.add(codeForSlug(slug))
    }
  }
  return rows.map(toLink)
}

export async function joinLinkFor(staffId: string): Promise<JoinLink | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin.from('staff_join_links').select('staff_id, slug, code').eq('staff_id', staffId).maybeSingle()
  if (data) return toLink(data as { staff_id: string; slug: string; code: string })
  const all = await ensureJoinLinks(admin)
  return all.find((l) => l.staffId === staffId) ?? null
}

/** The ACTIVE participant a slug or code belongs to, or null. */
async function activeParticipantBy(admin: Admin, field: 'slug' | 'code', value: string): Promise<string | null> {
  const { data: link } = await admin.from('staff_join_links').select('staff_id, deactivated_at').eq(field, value).maybeSingle()
  // A former staff member's link still opens the site, but credits nobody
  // (the sign-up is credited to Admin) — owner, 24 Oct 2026.
  if (!link || link.deactivated_at) return null
  const { data: p } = await admin
    .from('profiles')
    .select('role, admin_role, is_suspended')
    .eq('id', link.staff_id as string)
    .maybeSingle()
  if (!p || !isActiveParticipant({ role: p.role as string, adminRole: p.admin_role as string | null, suspended: p.is_suspended as boolean | null })) return null
  return link.staff_id as string
}

// -------------------------------------------------------------- visits

export async function loadVisit(admin: Admin, cookieValue: string | null | undefined): Promise<Visit | null> {
  const id = (cookieValue ?? '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data } = await admin.from('staff_referral_visits').select('id, staff_id, created_at, expires_at').eq('id', id).maybeSingle()
  if (!data) return null
  return { id: data.id as string, staffId: data.staff_id as string, createdAt: data.created_at as string, expiresAt: data.expires_at as string }
}

async function insertVisit(admin: Admin, staffId: string, source: 'link' | 'code', nowMs: number): Promise<Visit | null> {
  const { data } = await admin
    .from('staff_referral_visits')
    .insert({ staff_id: staffId, source, created_at: new Date(nowMs).toISOString(), expires_at: visitExpiry(nowMs) })
    .select('id, staff_id, created_at, expires_at')
    .maybeSingle()
  if (!data) return null
  return { id: data.id as string, staffId: data.staff_id as string, createdAt: data.created_at as string, expiresAt: data.expires_at as string }
}

/**
 * /join/<slug>. Returns the visit to keep in the cookie (the existing one when
 * it is still valid — first link wins), or null for an unknown slug.
 */
export async function recordJoinVisit(
  rawSlug: string,
  cookieValue: string | null | undefined,
  nowMs = Date.now(),
): Promise<{ visit: Visit | null; recorded: boolean }> {
  const admin = createAdminClient()
  const slug = normaliseSlug(rawSlug)
  if (!admin || !slug) return { visit: null, recorded: false }
  const existing = await loadVisit(admin, cookieValue)
  if (visitValid(existing, nowMs)) return { visit: existing, recorded: false }
  const staffId = await activeParticipantBy(admin, 'slug', slug)
  if (!staffId) return { visit: null, recorded: false }
  const visit = await insertVisit(admin, staffId, 'link', nowMs)
  return { visit, recorded: !!visit }
}

/**
 * The Staff code typed on /register: a new credit only when the browser holds
 * no valid one. Returns the visit to keep (new or existing) or null.
 */
export async function staffCodeVisit(
  rawCode: string | null | undefined,
  cookieValue: string | null | undefined,
  nowMs = Date.now(),
  /** "code" for the old Staff code box; "link" for a ?ref=<code> link
   *  (owner, 23 Oct 2026). */
  source: 'link' | 'code' = 'code',
): Promise<{ visit: Visit | null; recorded: boolean }> {
  const admin = createAdminClient()
  if (!admin) return { visit: null, recorded: false }
  const existing = await loadVisit(admin, cookieValue)
  if (visitValid(existing, nowMs)) return { visit: existing, recorded: false }
  const code = normaliseStaffCode(rawCode)
  if (!code) return { visit: null, recorded: false }
  const staffId = await activeParticipantBy(admin, 'code', code)
  if (!staffId) return { visit: null, recorded: false }
  const visit = await insertVisit(admin, staffId, source, nowMs)
  return { visit, recorded: !!visit }
}

/** A ?ref=<code> on any page (owner, 23 Oct 2026): the same first-link-wins
 *  rule as /join/<slug>, recorded as source "link". */
export function refLinkVisit(rawCode: string | null | undefined, cookieValue: string | null | undefined, nowMs = Date.now()) {
  return staffCodeVisit(rawCode, cookieValue, nowMs, 'link')
}

/**
 * The code a staff member adds to the links they send, or null when they carry
 * none (the site Owner, a Project Manager) or no longer earn credit (removed or
 * paused). Never a mobile, email or name.
 */
export const senderRefCode = cache(async (staffId: string | null | undefined): Promise<string | null> => {
  if (!staffId) return null
  const admin = createAdminClient()
  if (!admin) return null
  const { data: p } = await admin.from('profiles').select('role, admin_role, is_suspended').eq('id', staffId).maybeSingle()
  if (!p || !isActiveParticipant({ role: p.role as string, adminRole: p.admin_role as string | null, suspended: p.is_suspended as boolean | null })) return null
  const link = await joinLinkFor(staffId)
  return link?.code ?? null
})

// -------------------------------------------------------------- account facts

function mobileShapes(m: string): string[] {
  return [m, `0${m.slice(2)}`, `+${m}`]
}

async function accountFacts(admin: Admin, memberId: string): Promise<AccountFacts | null> {
  const { data: p } = await admin
    .from('profiles')
    .select('id, role, created_at, phone_number, whatsapp, email, is_test_name, hidden_from_public, is_seed, is_team_account')
    .eq('id', memberId)
    .maybeSingle()
  if (!p) return null
  const mobiles = [p.phone_number, p.whatsapp].map((n) => normalisePkMobile(n as string | null)).filter((m): m is string => !!m)
  const email = ((p.email as string | null) ?? '').trim().toLowerCase() || null

  // A duplicate: an OLDER account carries the same mobile/WhatsApp or email.
  // (A linked second-role account shares its mobile with the older one, so it
  // is caught here too.)
  const ors: string[] = []
  for (const m of [...new Set(mobiles)]) for (const s of mobileShapes(m)) ors.push(`phone_number.eq.${s}`, `whatsapp.eq.${s}`)
  if (email) ors.push(`email.eq."${email.replace(/"/g, "")}"`)
  let isDuplicate = false
  if (ors.length > 0) {
    const { data: dup } = await admin
      .from('profiles')
      .select('id')
      .neq('id', memberId)
      .lt('created_at', p.created_at as string)
      .or(ors.join(','))
      .limit(1)
    isDuplicate = (dup ?? []).length > 0
  }
  const { data: credit } = await admin.from('staff_signup_credits').select('member_id').eq('member_id', memberId).maybeSingle()
  return {
    id: memberId,
    role: p.role as string | null,
    createdAt: p.created_at as string,
    mobiles,
    email,
    isTest: !!(p.is_test_name || p.hidden_from_public || p.is_seed || p.is_team_account) || p.role === 'admin',
    isDuplicate,
    alreadyCredited: !!credit,
  }
}

/**
 * Credit a NEW account from the browser's stored visit (link or code). Silent:
 * a refused or missing credit never affects the sign-up. Returns what happened,
 * for the tests and the logs.
 */
export async function creditNewAccount(
  memberId: string,
  visitId: string | null | undefined,
  nowMs = Date.now(),
): Promise<{ credited: boolean; reason?: string; direct?: boolean }> {
  try {
    const admin = createAdminClient()
    if (!admin) return { credited: false, reason: 'no_admin' }
    const visit = await loadVisit(admin, visitId)
    if (!visit || !visitValid(visit, nowMs)) return creditDirect(admin, memberId, 'no_credit')
    const staff = await loadStaff(admin)
    const referrer = staff.find((s) => s.id === visit.staffId)
    const { data: link } = await admin.from('staff_join_links').select('deactivated_at').eq('staff_id', visit.staffId).maybeSingle()
    if (!referrer || link?.deactivated_at || !isActiveParticipant({ adminRole: referrer.admin_role, suspended: referrer.is_suspended })) {
      return creditDirect(admin, memberId, 'staff_inactive')
    }
    const facts = await accountFacts(admin, memberId)
    if (!facts) return { credited: false, reason: 'not_member' }
    const refusal = linkCreditRefusal(facts, visit, contactsOf(staff))
    if (refusal) return creditDirect(admin, memberId, refusal)
    const source = await visitSource(admin, visit.id)
    const { data: inserted } = await admin
      .from('staff_signup_credits')
      .upsert(
        { member_id: memberId, staff_id: visit.staffId, member_role: facts.role, source, visit_id: visit.id },
        { onConflict: 'member_id', ignoreDuplicates: true },
      )
      .select('member_id')
    if (!inserted || inserted.length === 0) return { credited: false, reason: 'already_credited' }
    await logAdminAction({
      actorId: visit.staffId,
      actorRole: (referrer.admin_role ?? 'tuitions_staff') as AdminRole,
      actorEmail: referrer.email,
      action: 'staff.signup_credit',
      targetType: 'profile',
      targetId: memberId,
      detail: { source, role: facts.role, automatic: true, visitId: visit.id },
    })
    // Tell the staff member (owner, 16 Oct 2026). Never blocks the sign-up.
    try {
      const { data: who } = await admin.from('profiles').select('full_name').eq('id', memberId).maybeSingle()
      await notify({
        userId: visit.staffId,
        kind: 'staff_signup',
        title: newSignupNoticeTitle(formatName((who?.full_name as string | null) ?? ''), facts.role as MemberRole),
        href: MY_SIGNUPS_PATH,
      })
    } catch (e) {
      console.error('[staff-signups] notice failed:', e instanceof Error ? e.message : e)
    }
    return { credited: true }
  } catch (e) {
    console.error('[staff-signups] credit failed:', e instanceof Error ? e.message : e)
    return { credited: false, reason: 'error' }
  }
}

/**
 * A sign-up with no valid, unexpired staff link (owner, 24 Oct 2026): credited
 * to Admin — a 'direct' row with no staff id. Never for a staff, test, seed or
 * team account, and never over an existing credit. Silent; returns why the
 * staff credit was not given.
 */
async function creditDirect(admin: Admin, memberId: string, reason: string): Promise<{ credited: false; reason: string; direct: boolean }> {
  try {
    const facts = await accountFacts(admin, memberId)
    if (!facts || facts.isTest || facts.alreadyCredited || (facts.role !== 'tutor' && facts.role !== 'parent')) {
      return { credited: false, reason, direct: false }
    }
    const { data } = await admin
      .from('staff_signup_credits')
      .upsert({ member_id: memberId, staff_id: null, member_role: facts.role, source: 'direct' }, { onConflict: 'member_id', ignoreDuplicates: true })
      .select('member_id')
    return { credited: false, reason, direct: (data ?? []).length > 0 }
  } catch (e) {
    console.error('[staff-signups] direct credit failed:', e instanceof Error ? e.message : e)
    return { credited: false, reason, direct: false }
  }
}

async function visitSource(admin: Admin, visitId: string): Promise<'link' | 'code'> {
  const { data } = await admin.from('staff_referral_visits').select('source').eq('id', visitId).maybeSingle()
  return data?.source === 'code' ? 'code' : 'link'
}

// -------------------------------------------------------------- claims

export type ClaimRow = {
  id: string
  memberId: string
  memberName: string
  memberRole: string | null
  memberMobile: string | null
  memberJoinedAt: string | null
  staffId: string
  staffName: string
  note: string
  status: 'pending' | 'approved' | 'rejected'
  reason: string | null
  decidedByName: string | null
  decidedAt: string | null
  createdAt: string
}

/** The one account a mobile number or email names (null + words when none). */
async function findAccount(admin: Admin, identifier: string): Promise<{ id: string } | { error: string }> {
  const raw = identifier.trim()
  if (looksLikeEmail(raw)) {
    const { data } = await admin.from('profiles').select('id').eq('email', raw.toLowerCase()).in('role', ['tutor', 'parent']).limit(2)
    if (!data || data.length === 0) return { error: 'No tutor or parent account uses that email.' }
    if (data.length > 1) return { error: 'More than one account uses that email. Ask the Owner or Admin.' }
    return { id: data[0].id as string }
  }
  const m = normalisePkMobile(raw)
  if (!m) return { error: 'Enter a Pakistani mobile number like 0300 1234567, or an email address.' }
  const ors = mobileShapes(m).flatMap((s) => [`phone_number.eq.${s}`, `whatsapp.eq.${s}`])
  const { data } = await admin.from('profiles').select('id, created_at').in('role', ['tutor', 'parent']).or(ors.join(',')).order('created_at').limit(5)
  if (!data || data.length === 0) return { error: 'No tutor or parent account uses that mobile number.' }
  // Several accounts on one number: the oldest is the member; the rest are
  // duplicates and would be refused anyway.
  return { id: data[0].id as string }
}

export async function submitClaim(
  actor: { id: string; adminRole: AdminRole; email: string | null },
  identifier: string,
  note: string,
  nowMs = Date.now(),
): Promise<{ ok: true; claimId: string } | { ok: false; status: number; error: string }> {
  // New claims are closed (owner, 24 Oct 2026).
  if (!CLAIMS_OPEN) return { ok: false, status: 410, error: CLAIMS_CLOSED }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const staff = await loadStaff(admin)
  const me = staff.find((s) => s.id === actor.id)
  if (!me || !isActiveParticipant({ adminRole: me.admin_role, suspended: me.is_suspended })) {
    return { ok: false, status: 403, error: 'Only staff with a join link can claim a sign-up.' }
  }
  const cleanNote = note.trim()
  if (!cleanNote) return { ok: false, status: 400, error: 'Add a short note: how did you help this person sign up?' }
  const found = await findAccount(admin, identifier)
  if ('error' in found) return { ok: false, status: 404, error: found.error }
  const facts = await accountFacts(admin, found.id)
  if (!facts) return { ok: false, status: 404, error: 'No tutor or parent account was found.' }
  const refusal = claimRefusal(facts, contactsOf(staff), nowMs)
  if (refusal) return { ok: false, status: 409, error: REFUSAL_WORDS[refusal] }
  const { data, error } = await admin
    .from('staff_signup_claims')
    .insert({ member_id: found.id, staff_id: actor.id, note: cleanNote.slice(0, 500) })
    .select('id')
    .maybeSingle()
  if (error || !data) {
    return { ok: false, status: 409, error: 'A claim for this account is already waiting for review.' }
  }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'staff.signup_claim',
    targetType: 'profile',
    targetId: found.id,
    detail: { claimId: data.id, role: facts.role },
  })
  return { ok: true, claimId: data.id as string }
}

export async function decideClaim(
  actor: { id: string; adminRole: AdminRole; email: string | null },
  claimId: string,
  approve: boolean,
  reason: string | null,
): Promise<{ ok: true; status: 'approved' | 'rejected' } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: claim } = await admin
    .from('staff_signup_claims')
    .select('id, member_id, staff_id, status')
    .eq('id', claimId)
    .maybeSingle()
  if (!claim) return { ok: false, status: 404, error: 'That claim was not found.' }
  if (claim.status !== 'pending') return { ok: false, status: 409, error: 'That claim has already been decided.' }
  if (!mayDecideClaim(actor.id, claim.staff_id as string)) {
    return { ok: false, status: 403, error: 'You cannot decide your own claim. The Owner will review it.' }
  }
  const cleanReason = (reason ?? '').trim().slice(0, 500) || null
  let finalApprove = approve
  let finalReason = cleanReason
  if (approve) {
    const staff = await loadStaff(admin)
    const facts = await accountFacts(admin, claim.member_id as string)
    const refusal = facts ? creditRefusal(facts, contactsOf(staff)) : 'not_member'
    if (refusal) {
      return { ok: false, status: 409, error: `${REFUSAL_WORDS[refusal]} Reject the claim instead.` }
    }
    const { data: inserted } = await admin
      .from('staff_signup_credits')
      .upsert(
        { member_id: claim.member_id, staff_id: claim.staff_id, member_role: facts!.role, source: 'claim', claim_id: claim.id },
        { onConflict: 'member_id', ignoreDuplicates: true },
      )
      .select('member_id')
    if (!inserted || inserted.length === 0) {
      finalApprove = false
      finalReason = REFUSAL_WORDS.already_credited
    }
  }
  const status = finalApprove ? 'approved' : 'rejected'
  await admin
    .from('staff_signup_claims')
    .update({ status, reason: finalReason, decided_by: actor.id, decided_at: new Date().toISOString() })
    .eq('id', claimId)
    .eq('status', 'pending')
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: finalApprove ? 'staff.signup_claim_approve' : 'staff.signup_claim_reject',
    targetType: 'profile',
    targetId: claim.member_id as string,
    detail: { claimId, claimant: claim.staff_id, reason: finalReason },
  })
  return { ok: true, status }
}

/** Claims a viewer may see: everyone's for the Owner, Project Managers and
 *  Admin; otherwise their own. Pending first, then the newest decided. */
export async function loadClaims(viewer: { id: string; adminRole: string | null }, opts: { pendingOnly?: boolean } = {}): Promise<ClaimRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  let q = admin
    .from('staff_signup_claims')
    .select('id, member_id, staff_id, note, status, reason, decided_by, decided_at, created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (!seesEveryone(viewer.adminRole)) q = q.eq('staff_id', viewer.id)
  if (opts.pendingOnly) q = q.eq('status', 'pending')
  const { data } = await q
  const rows = data ?? []
  const ids = [...new Set(rows.flatMap((r) => [r.member_id as string, r.staff_id as string, r.decided_by as string | null]).filter((x): x is string => !!x))]
  const people = ids.length
    ? await pageAllIn(ids, (part, from, to) =>
        admin.from('profiles').select('id, full_name, role, phone_number, whatsapp, created_at').in('id', part).range(from, to),
      )
    : []
  const byId = new Map(people.map((p) => [p.id as string, p]))
  const out: ClaimRow[] = rows.map((r) => {
    const m = byId.get(r.member_id as string)
    return {
      id: r.id as string,
      memberId: r.member_id as string,
      memberName: formatName((m?.full_name as string | null) ?? '') || '—',
      memberRole: (m?.role as string | null) ?? null,
      memberMobile: ((m?.phone_number as string | null) ?? (m?.whatsapp as string | null)) || null,
      memberJoinedAt: (m?.created_at as string | null) ?? null,
      staffId: r.staff_id as string,
      staffName: formatName((byId.get(r.staff_id as string)?.full_name as string | null) ?? '') || '—',
      note: r.note as string,
      status: r.status as ClaimRow['status'],
      reason: (r.reason as string | null) ?? null,
      decidedByName: r.decided_by ? formatName((byId.get(r.decided_by as string)?.full_name as string | null) ?? '') || null : null,
      decidedAt: (r.decided_at as string | null) ?? null,
      createdAt: r.created_at as string,
    }
  })
  return out.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'))
}

export async function pendingClaimCount(): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 0
  const { count } = await admin.from('staff_signup_claims').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  return count ?? 0
}

// -------------------------------------------------------------- milestones

/** Every credited account with the time it reached each step. One loader for
 *  the board, the lists and the live test. */
export async function loadCreditedAccounts(): Promise<CreditedAccount[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const credits = await pageAll((from, to) =>
    admin.from('staff_signup_credits').select('member_id, staff_id, member_role, source').order('member_id').range(from, to),
  )
  // A 'direct' credit (no valid staff link — credited to Admin, owner 24 Oct
  // 2026) belongs to no staff member: it is counted by loadAdminDirectAccounts.
  return buildAccounts(admin, credits.filter((c) => !!c.staff_id && c.source !== 'direct'))
}

/**
 * Sign-ups credited to Admin (owner, 24 Oct 2026): every tutor and parent
 * account with no staff credit — a 'direct' credit written since then, or an
 * older sign-up that was never credited (its record is not rewritten). Same
 * milestones as a staff credit; staffId is ADMIN_STAFF_ID. Staff, test, seed,
 * team and hidden accounts are left out (the countable rule).
 */
export async function loadAdminDirectAccounts(): Promise<CreditedAccount[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const [members, credits] = await Promise.all([
    pageAll((from, to) => admin.from('profiles').select('id, role').in('role', ['tutor', 'parent']).order('id').range(from, to)),
    pageAll((from, to) => admin.from('staff_signup_credits').select('member_id, staff_id, source').order('member_id').range(from, to)),
  ])
  const toStaff = new Set(credits.filter((c) => !!c.staff_id && c.source !== 'direct').map((c) => c.member_id as string))
  const rows = members
    .filter((m) => !toStaff.has(m.id as string))
    .map((m) => ({ member_id: m.id, staff_id: ADMIN_STAFF_ID, member_role: m.role, source: 'direct' }))
  const out = await excludedMemberIds(admin, rows.map((r) => r.member_id as string))
  return buildAccounts(admin, rows.filter((r) => !out.has(r.member_id as string)))
}

async function buildAccounts(admin: Admin, credits: Record<string, unknown>[]): Promise<CreditedAccount[]> {
  if (credits.length === 0) return []
  const ids = credits.map((c) => c.member_id as string)
  const [profiles, tutors, payments, jobs] = await Promise.all([
    pageAllIn(ids, (part, from, to) =>
      admin.from('profiles').select('id, full_name, created_at, phone_verified_at, phone_number, whatsapp').in('id', part).order('id').range(from, to),
    ),
    pageAllIn(ids, (part, from, to) =>
      admin.from('tutor_profiles').select('id, onboarded_at').in('id', part).order('id').range(from, to),
    ),
    pageAllIn(ids, (part, from, to) =>
      admin
        .from('payments')
        .select('id, user_id, plan_code, status, reviewed_at, refunded_amount_pkr, refunded_at')
        .in('user_id', part)
        .eq('status', 'approved')
        .order('id')
        .range(from, to),
    ),
    pageAllIn(ids, (part, from, to) =>
      admin.from('jobs').select('id, parent_id, created_at').in('parent_id', part).order('id').range(from, to),
    ),
  ])
  const prof = new Map(profiles.map((p) => [p.id as string, p]))
  const onboarded = new Map(tutors.map((t) => [t.id as string, (t.onboarded_at as string | null) ?? null]))
  // The paid rule (lib/staffTargetsCore firstPaidAt): the first approved, not
  // refunded Verification Fee for a tutor, plan purchase for a parent.
  const payBy = new Map<string, PaymentFacts[]>()
  for (const p of payments) {
    const k = p.user_id as string
    const list = payBy.get(k) ?? []
    list.push({
      planCode: (p.plan_code as string | null) ?? null,
      status: (p.status as string | null) ?? null,
      approvedAt: (p.reviewed_at as string | null) ?? null,
      refundedAmountPkr: (p.refunded_amount_pkr as number | null) ?? null,
      refundedAt: (p.refunded_at as string | null) ?? null,
    })
    payBy.set(k, list)
  }
  const posted = new Map<string, string>()
  for (const j of jobs) {
    const k = j.parent_id as string
    const t = j.created_at as string
    if (!posted.has(k) || Date.parse(t) < Date.parse(posted.get(k)!)) posted.set(k, t)
  }
  const out: CreditedAccount[] = []
  for (const c of credits) {
    const id = c.member_id as string
    const p = prof.get(id)
    if (!p) continue
    const role = c.member_role as MemberRole
    const at: CreditedAccount['at'] = {
      signed_up: p.created_at as string,
      mobile_verified: (p.phone_verified_at as string | null) ?? null,
    }
    if (role === 'tutor') {
      at.onboarded = onboarded.get(id) ?? null
    } else {
      at.posted = posted.get(id) ?? null
    }
    at.paid = firstPaidAt(payBy.get(id) ?? [], role)
    out.push({
      memberId: id,
      staffId: c.staff_id as string,
      role,
      source: (c.source as CreditedAccount['source']) ?? 'link',
      name: formatName((p.full_name as string | null) ?? '') || '—',
      mobile: ((p.phone_number as string | null) ?? (p.whatsapp as string | null)) || null,
      at,
    })
  }
  return out
}

export type SignupBoard = {
  rows: BoardRow[]
  total: BoardRow | null
  everyone: boolean
  myLink: JoinLink | null
  links: Map<string, JoinLink>
}

export async function loadSignupBoard(
  viewer: { id: string; adminRole: string | null },
  period: Period,
  nowMs = Date.now(),
): Promise<SignupBoard> {
  const admin = createAdminClient()
  const empty: SignupBoard = { rows: [], total: null, everyone: seesEveryone(viewer.adminRole), myLink: null, links: new Map() }
  if (!admin) return empty
  const [links, staff, accounts] = await Promise.all([ensureJoinLinks(admin), loadStaff(admin), loadCreditedAccounts()])
  const linkBy = new Map(links.map((l) => [l.staffId, l]))
  const everyone = seesEveryone(viewer.adminRole)
  const byStaff = new Map<string, CreditedAccount[]>()
  for (const a of accounts) {
    const list = byStaff.get(a.staffId) ?? []
    list.push(a)
    byStaff.set(a.staffId, list)
  }
  const rows: BoardRow[] = []
  for (const s of staff) {
    if (!everyone && s.id !== viewer.id) continue
    const mine = byStaff.get(s.id) ?? []
    const row = boardRow(s.id, formatName(s.full_name ?? '') || s.email || '—', mine, period, nowMs)
    const active = isActiveParticipant({ adminRole: s.admin_role, suspended: s.is_suspended })
    const anything = Object.values(row.tutor).some((n) => n > 0) || Object.values(row.parent).some((n) => n > 0)
    // A former participant appears only while they have numbers in the period.
    if (active || anything) rows.push(row)
  }
  const visible = everyone ? accounts : accounts.filter((a) => a.staffId === viewer.id)
  return {
    rows: sortBoardRows(rows),
    total: everyone ? boardRow('team', 'Team total', visible, period, nowMs) : null,
    everyone,
    myLink: linkBy.get(viewer.id) ?? null,
    links: linkBy,
  }
}

export type SignupListResult =
  | { ok: true; staffName: string; accounts: CreditedAccount[] }
  | { ok: false; status: 403 | 404; error: string }

/** The accounts behind one board number. A participant may open only their own. */
export async function loadSignupList(
  viewer: { id: string; adminRole: string | null },
  staffId: string,
  role: MemberRole,
  step: Step,
  period: Period,
  nowMs = Date.now(),
  /** `range` (a calendar month, owner 16 Oct 2026) replaces `period` when set;
   *  `inProgress` then covers parents too (Signed up / Posted, not paid). */
  /** `status` (Team activity's Pending / Signed up, owner 16 Oct 2026) with a
   *  `range` lists by status instead of step. */
  opts: { inProgress?: boolean; range?: Range; status?: StaffStatus; unpaidAll?: boolean } = {},
): Promise<SignupListResult> {
  if (staffId === 'team' ? !seesEveryone(viewer.adminRole) : !mayViewStaff(viewer, staffId)) {
    return { ok: false, status: 403, error: 'You can only see your own sign-ups.' }
  }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 404, error: 'Not available.' }
  let staffName = 'Team total'
  if (staffId !== 'team') {
    const { data } = await admin.from('profiles').select('full_name, role').eq('id', staffId).maybeSingle()
    if (!data || data.role !== 'admin') return { ok: false, status: 404, error: 'That staff member was not found.' }
    staffName = formatName((data.full_name as string | null) ?? '') || '—'
  }
  const all = await loadCreditedAccounts()
  // "All unpaid" (owner, 17 Oct 2026): tutors AND parents, any month — the
  // card's allUnpaid figure, from the same function.
  if (opts.unpaidAll) {
    const people = allUnpaid(all.filter((a) => (staffId === 'team' ? true : a.staffId === staffId)))
    return { ok: true, staffName, accounts: people.sort((a, b) => Date.parse(b.at.signed_up ?? '') - Date.parse(a.at.signed_up ?? '')) }
  }
  const mine = all.filter((a) => a.role === role && (staffId === 'team' ? true : a.staffId === staffId))
  // "In progress": the same step, tutors who have not paid (inProgressAt) — the
  // rule the board's in-progress numbers use.
  if (opts.status && opts.range) {
    const byStatus = statusIn(mine, role, opts.status, opts.range)
    const key = (a: CreditedAccount) => Date.parse((opts.status === 'signed_up' ? a.at.paid : a.at.signed_up) ?? '')
    return { ok: true, staffName, accounts: byStatus.sort((a, b) => key(b) - key(a)) }
  }
  const picked = opts.range
    ? opts.inProgress && isInProgressStepFor(role, step)
      ? inProgressIn(mine, role, step, opts.range)
      : accountsInRange(mine, step, opts.range)
    : opts.inProgress && role === 'tutor' && isInProgressStep(step)
      ? inProgressAt(mine, step, period, nowMs)
      : accountsAt(mine, step, period, nowMs)
  const accounts = picked.sort(
    (a, b) => Date.parse(b.at[step] ?? '') - Date.parse(a.at[step] ?? ''),
  )
  return { ok: true, staffName, accounts }
}

// -------------------------------------------------------------- My link card

/** Members that never count (the People page rule, checked again at read time
 *  in case an account was marked test or hidden after it was credited). */
async function excludedMemberIds(admin: Admin, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const rows = await pageAllIn(ids, (part, from, to) =>
    admin
      .from('profiles')
      .select('id, role, is_test_name, hidden_from_public, is_seed, is_team_account')
      .in('id', part)
      .order('id')
      .range(from, to),
  )
  return new Set(
    rows
      .filter((p) => p.role === 'admin' || p.is_test_name || p.hidden_from_public || p.is_seed || p.is_team_account)
      .map((p) => p.id as string),
  )
}

/** Credited accounts with staff and test accounts left out. */
export async function countableCreditedAccounts(): Promise<CreditedAccount[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const all = await loadCreditedAccounts()
  const out = await excludedMemberIds(admin, all.map((a) => a.memberId))
  return all.filter((a) => !out.has(a.memberId))
}

export type MyLinkCard = { link: JoinLink; counts: MyLinkCounts }

/** The "My link" card (owner, 23 Oct 2026): only for a staff member who
 *  carries a code and still earns credit. */
export async function loadMyLinkCard(staffId: string, nowMs = Date.now()): Promise<MyLinkCard | null> {
  const code = await senderRefCode(staffId)
  if (!code) return null
  const link = await joinLinkFor(staffId)
  if (!link) return null
  const accounts = await countableCreditedAccounts()
  return { link, counts: myLinkCounts(accounts, staffId, nowMs) }
}

export type SourceTable = { rows: SourceRow[]; total: SourceRow | null }

/** Sign-ups by source and tutors paid, per staff member (owner, 23 Oct 2026).
 *  Owner, Project Managers and Admin see everyone and the total; others their
 *  own row only. */
export async function loadSourceTable(viewer: { id: string; adminRole: string | null }, nowMs = Date.now()): Promise<SourceTable> {
  const admin = createAdminClient()
  if (!admin) return { rows: [], total: null }
  const everyone = seesEveryone(viewer.adminRole)
  const [staff, accounts, direct] = await Promise.all([loadStaff(admin), countableCreditedAccounts(), everyone ? loadAdminDirectAccounts() : Promise.resolve([])])
  const credited = new Set(accounts.map((a) => a.staffId))
  const rows: SourceRow[] = []
  const seen = new Set<string>()
  for (const s of staff) {
    if (!everyone && s.id !== viewer.id) continue
    const active = isActiveParticipant({ adminRole: s.admin_role, suspended: s.is_suspended })
    if (!active && !credited.has(s.id)) continue
    seen.add(s.id)
    rows.push(sourceRow(s.id, formatName(s.full_name ?? '') || '—', accounts, nowMs))
  }
  // Former staff keep their past credits, labelled (owner, 24 Oct 2026).
  const gone = [...credited].filter((id) => !seen.has(id) && (everyone || id === viewer.id))
  if (gone.length) {
    const { data } = await admin.from('profiles').select('id, full_name').in('id', gone)
    for (const g of data ?? []) rows.push(sourceRow(g.id as string, formerStaffName(formatName((g.full_name as string | null) ?? '') || 'Staff', 'former'), accounts, nowMs))
  }
  rows.sort((a, b) => b.paidAll - a.paidAll || b.total - a.total || a.name.localeCompare(b.name))
  // Sign-ups with no valid staff link are credited to Admin (owner, 24 Oct 2026).
  if (everyone) rows.push(sourceRow(ADMIN_STAFF_ID, ADMIN_DIRECT_NAME, direct, nowMs))
  const visible = everyone ? [...accounts, ...direct] : accounts.filter((a) => a.staffId === viewer.id)
  return { rows, total: everyone ? sourceRow('team', 'Total', visible, nowMs) : null }
}
