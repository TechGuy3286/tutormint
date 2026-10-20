import 'server-only'

// lib/mySignups.ts
//
// "My sign-ups" (owner, 16 Oct 2026) — the I/O half. The rules are pure in
// lib/mySignupsCore.ts. Service role throughout, so WHO may see WHICH rows is
// decided here and in the routes, never by the browser:
//
//   • loadMySignups(staffId) — the rows credited to that ONE staff member and
//     their own claims. Callers pass the signed-in actor's own id; nothing takes
//     another id from the request. (The database also refuses another staff
//     member's credits to a staff token since migration 182.)
//   • rowsForAccounts(accounts) — the same columns for the lists behind Team
//     activity's numbers (lib/staffSignups loadSignupList already checked the
//     viewer may open them).
//
// Every select here names its columns. CNIC fields are read only to work out
// "documents on file" (a yes/no) and never leave this file; no document,
// receipt, payment amount, bank detail or OTP is ever read into a row.

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAllIn } from '@/lib/pageAll'
import { normalisePkMobile } from '@/lib/phone'
import { formatName } from '@/lib/formatName'
import { absoluteUrl } from '@/lib/siteUrl'
import { logAdminAction } from '@/lib/auditLog'
import { maskMobile } from '@/lib/smsHealthCore'
import { tutorDocStatusesFromProfile } from '@/lib/tutorDocStatus'
import { tutorDocsSubmitted } from '@/lib/badgeRule'
import { flowStateByTutor } from '@/lib/onboardingStop'
import { loadTutorDocSummaries } from '@/lib/tutorDocSummaries'
import { loadStartedNotFinished } from '@/lib/startedPayment'
import { loadFollowUpStates } from '@/lib/followUps'
import { docFactsFrom, followUpMessage } from '@/lib/tutorFollowUpCore'
import { fillPaymentNotFinished, payAgainLink, PAYMENT_NOT_FINISHED_KEY } from '@/lib/startedPaymentCore'
import { loadCreditedAccounts, joinLinkFor, type JoinLink } from '@/lib/staffSignups'
import { loadTargetBoard, type TargetCard } from '@/lib/staffTargets'
import { mayViewStaff, type CreditedAccount, type MemberRole } from '@/lib/staffSignupsCore'
import { isQualifyingPayment, monthKeyOf, type MonthKey } from '@/lib/staffTargetsCore'
import type { AdminRole } from '@/lib/adminAccessCore'
import { NEXT_STEP_TEMPLATE, claimRow, creditRow, type CreditedBy, type MySignupRow } from '@/lib/mySignupsCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

async function templateBodies(admin: Admin): Promise<Record<string, string>> {
  const keys = [...new Set([...Object.values(NEXT_STEP_TEMPLATE).map((t) => t.key), PAYMENT_NOT_FINISHED_KEY])]
  const { data } = await admin.from('admin_message_templates').select('key, body').in('key', keys)
  return Object.fromEntries((data ?? []).map((t) => [t.key as string, t.body as string]))
}

/** The rows for a set of credited accounts (any staff member's). */
export async function rowsForAccounts(accounts: CreditedAccount[]): Promise<MySignupRow[]> {
  const admin = createAdminClient()
  if (!admin || accounts.length === 0) return []
  const ids = accounts.map((a) => a.memberId)
  const [profiles, tutors, selfies, payments, credits, bodies] = await Promise.all([
    pageAllIn(ids, (part, from, to) =>
      admin
        .from('profiles')
        .select(
          'id, full_name, email, city, phone_number, whatsapp, profile_completion, verification_state, cnic_verified_at, cnic_number, cnic_image_path, avatar_url, profile_pic_status, selfie_status',
        )
        .in('id', part)
        .order('id')
        .range(from, to),
    ),
    pageAllIn(ids, (part, from, to) => admin.from('tutor_profiles').select('id, city').in('id', part).order('id').range(from, to)),
    pageAllIn(ids, (part, from, to) =>
      admin.from('user_documents').select('id, user_id').eq('kind', 'selfie').eq('status', 'active').in('user_id', part).order('id').range(from, to),
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
      admin.from('staff_signup_credits').select('member_id, source').in('member_id', part).order('member_id').range(from, to),
    ),
    templateBodies(admin),
  ])
  const prof = new Map(profiles.map((p) => [p.id as string, p]))
  const tutorCity = new Map(tutors.map((t) => [t.id as string, (t.city as string | null) ?? null]))
  const hasSelfie = new Set(selfies.map((s) => s.user_id as string))
  const source = new Map(credits.map((c) => [c.member_id as string, (c.source as CreditedBy | null) ?? 'link']))
  // A payment that WOULD have counted, refunded since.
  const refunded = new Set<string>()
  for (const p of payments) {
    const role = accounts.find((a) => a.memberId === p.user_id)?.role
    if (!role) continue
    const facts = {
      planCode: (p.plan_code as string | null) ?? null,
      status: (p.status as string | null) ?? null,
      approvedAt: (p.reviewed_at as string | null) ?? null,
    }
    const wasRefunded = (Number(p.refunded_amount_pkr) || 0) > 0 || !!p.refunded_at
    if (wasRefunded && isQualifyingPayment(facts, role)) refunded.add(p.user_id as string)
  }

  // Unpaid tutors get the Follow-ups message built from their own state
  // (owner, 20 Oct 2026) — the same text as Follow-ups → Tutors.
  const unpaidTutors = accounts.filter((a) => a.role === 'tutor' && !a.at.paid).map((a) => a.memberId)
  const nowMs = Date.now()
  const [flow, docSums, started, fu] = unpaidTutors.length
    ? await Promise.all([
        flowStateByTutor(admin, unpaidTutors),
        loadTutorDocSummaries(unpaidTutors),
        loadStartedNotFinished(new Date(nowMs)).catch(() => []),
        loadFollowUpStates(unpaidTutors, new Date(nowMs)),
      ])
    : [new Map(), new Map(), [], new Map()] as const
  const startedBy = new Map<string, { planCode: string | null; startedAt: string }>()
  for (const s of started) if (s.userId && !startedBy.has(s.userId)) startedBy.set(s.userId, { planCode: s.planCode, startedAt: s.createdAt })
  const tutorMessage = (a: CreditedAccount, p: Record<string, unknown> | undefined) => {
    if (a.role !== 'tutor' || a.at.paid) return null
    const fs = flow.get(a.memberId)
    const sp = startedBy.get(a.memberId) ?? null
    return followUpMessage(
      {
        feePaid: false,
        completion: Number(p?.profile_completion ?? 0) || 0,
        stoppedStep: fs?.stoppedStep ?? null,
        ...docFactsFrom(docSums.get(a.memberId)?.statuses),
        startedPayment: sp,
        lastContactAt: fu.get(a.memberId)?.lastAt ?? null,
      },
      a.name,
      nowMs,
      sp && bodies[PAYMENT_NOT_FINISHED_KEY] ? fillPaymentNotFinished(bodies[PAYMENT_NOT_FINISHED_KEY], { name: a.name, payLink: payAgainLink(sp.planCode) }) : null,
    )
  }

  return accounts.map((a) => {
    const p = prof.get(a.memberId)
    const phone = ((p?.phone_number as string | null) ?? (p?.whatsapp as string | null)) || a.mobile || null
    const waNumber = normalisePkMobile(((p?.whatsapp as string | null) || phone) ?? '') ?? normalisePkMobile(phone ?? '')
    const docs = p ? tutorDocStatusesFromProfile(p as Record<string, string | null>, hasSelfie.has(a.memberId)) : null
    return creditRow({
      memberId: a.memberId,
      staffId: a.staffId,
      name: a.name,
      phone,
      waNumber: waNumber ?? null,
      email: (p?.email as string | null) ?? null,
      city: (a.role === 'tutor' ? tutorCity.get(a.memberId) : null) || ((p?.city as string | null) ?? null),
      creditedBy: source.get(a.memberId) ?? 'link',
      facts: {
        role: a.role,
        signedUpAt: a.at.signed_up ?? '',
        mobileVerifiedAt: a.at.mobile_verified ?? null,
        onboardedAt: a.at.onboarded ?? null,
        docsSubmitted: docs ? tutorDocsSubmitted(docs) : false,
        postedAt: a.at.posted ?? null,
        paidAt: a.at.paid ?? null,
        refunded: refunded.has(a.memberId),
      },
      templateBodies: bodies,
      siteUrl: absoluteUrl,
      tutorMessage: tutorMessage(a, p as Record<string, unknown> | undefined),
    })
  })
}

/** One staff member's own rows: their credited people and their claims that
 *  are not credited to them. */
export async function loadMySignups(staffId: string, accountsIn?: CreditedAccount[]): Promise<MySignupRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const all = accountsIn ?? (await loadCreditedAccounts())
  const mine = all.filter((a) => a.staffId === staffId)
  const rows = await rowsForAccounts(mine)
  const credited = new Set(mine.map((a) => a.memberId))

  const { data: claims } = await admin
    .from('staff_signup_claims')
    .select('id, member_id, status, reason, created_at')
    .eq('staff_id', staffId)
    .in('status', ['pending', 'rejected'])
    .order('created_at', { ascending: false })
    .limit(200)
  const open = (claims ?? []).filter((c) => !credited.has(c.member_id as string))
  if (open.length > 0) {
    const people = await pageAllIn(
      [...new Set(open.map((c) => c.member_id as string))],
      (part, from, to) => admin.from('profiles').select('id, full_name, role, phone_number, whatsapp').in('id', part).order('id').range(from, to),
    )
    const byId = new Map(people.map((p) => [p.id as string, p]))
    const seen = new Set<string>()
    for (const c of open) {
      const id = c.member_id as string
      if (seen.has(id)) continue
      seen.add(id)
      const p = byId.get(id)
      rows.push(
        claimRow({
          memberId: id,
          staffId,
          name: formatName((p?.full_name as string | null) ?? '') || '—',
          maskedPhone: maskMobile(((p?.phone_number as string | null) ?? (p?.whatsapp as string | null)) || null),
          role: ((p?.role as string) === 'parent' ? 'parent' : 'tutor') as MemberRole,
          claimedAt: c.created_at as string,
          status: c.status as 'pending' | 'rejected',
          reason: (c.reason as string | null) ?? null,
        }),
      )
    }
  }
  return rows
}

export type MyMonthCard =
  | { kind: 'target'; month: MonthKey; card: TargetCard; countingStarts: string; countingFrom: string | null }
  | { kind: 'in_house'; month: MonthKey; paid: number }

/**
 * The month card at the top of the page — the SAME loader Team activity uses
 * (lib/staffTargets loadTargetBoard), seen as that staff member alone, so the
 * numbers cannot differ. On this month's target list → the target card with
 * its pace; otherwise ("in-house") → the paid count only.
 */
export async function loadMyMonthCard(staffId: string, nowMs = Date.now()): Promise<MyMonthCard> {
  const month = monthKeyOf(nowMs)
  const board = await loadTargetBoard({ id: staffId, adminRole: 'self' }, month, nowMs)
  const card = board.scope === 'target_self' ? board.cards.find((c) => c.staffId === staffId) : undefined
  if (card) return { kind: 'target', month, card, countingStarts: board.countingStarts, countingFrom: board.countingFrom }
  return { kind: 'in_house', month, paid: board.ownPaid?.paid ?? 0 }
}

export type MySignupsPage = { rows: MySignupRow[]; card: MyMonthCard; link: JoinLink | null }

export async function loadMySignupsPage(staffId: string, nowMs = Date.now()): Promise<MySignupsPage> {
  const [rows, card, link] = await Promise.all([loadMySignups(staffId), loadMyMonthCard(staffId, nowMs), joinLinkFor(staffId)])
  return { rows, card, link }
}

// --------------------------------------------------------------- the log

type Actor = { id: string; adminRole: AdminRole; email: string | null }

/** Every page open is written to the staff activity log (admin_audit_log). */
export async function logMySignupsOpen(actor: Actor, rows: number): Promise<void> {
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'staff.my_signups_open',
    targetType: 'profile',
    targetId: actor.id,
    detail: { rows },
  })
}

/**
 * A WhatsApp tap on a row. Allowed only when the member is credited to the
 * actor — or to a staff member the actor may view (the Owner, the Project
 * Managers and Admin on another person's list). Returns false when not.
 */
export async function logWhatsAppTap(actor: Actor, memberId: string, nextStep: string | null, messageType: string | null = null): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  const { data: credit } = await admin.from('staff_signup_credits').select('staff_id').eq('member_id', memberId).maybeSingle()
  if (!credit || !mayViewStaff({ id: actor.id, adminRole: actor.adminRole }, credit.staff_id as string)) return false
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'staff.my_signups_whatsapp',
    targetType: 'profile',
    targetId: memberId,
    detail: { nextStep, messageType, creditedTo: credit.staff_id },
  })
  return true
}

export type MySignupsLogEntry = { action: 'open' | 'whatsapp'; at: string; memberId: string | null; memberName: string | null; nextStep: string | null }

/** One staff member's My sign-ups activity, newest first (the staff detail
 *  page: the Owner, the Project Managers and Admin). */
export async function loadMySignupsLog(staffId: string, limit = 50): Promise<MySignupsLogEntry[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin
    .from('admin_audit_log')
    .select('action, target_id, detail, created_at')
    .eq('actor_id', staffId)
    .in('action', ['staff.my_signups_open', 'staff.my_signups_whatsapp'])
    .order('created_at', { ascending: false })
    .limit(limit)
  const rows = data ?? []
  const memberIds = [...new Set(rows.filter((r) => r.action === 'staff.my_signups_whatsapp').map((r) => r.target_id as string))]
  const names = memberIds.length
    ? new Map(
        ((await admin.from('profiles').select('id, full_name').in('id', memberIds)).data ?? []).map((p) => [
          p.id as string,
          formatName((p.full_name as string | null) ?? '') || '—',
        ]),
      )
    : new Map<string, string>()
  return rows.map((r) => {
    const wa = r.action === 'staff.my_signups_whatsapp'
    const d = (r.detail ?? {}) as { nextStep?: string | null }
    return {
      action: wa ? 'whatsapp' : 'open',
      at: r.created_at as string,
      memberId: wa ? (r.target_id as string) : null,
      memberName: wa ? (names.get(r.target_id as string) ?? '—') : null,
      nextStep: wa ? (d.nextStep ?? null) : null,
    }
  })
}
