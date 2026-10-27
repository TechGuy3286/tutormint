// lib/bankPaymentLink.ts
//
// Link a bank credit to a member (owner, 20 Oct 2026) — the I/O half. Rules
// are pure in lib/bankPaymentLinkCore.ts.
//
// Linking records ONE approved bank-transfer payment on the member, dated when
// the money arrived (the credit's date and time), and links the credit to it in
// the settlement check (a manual 'receipt' link). From then on it is an ordinary
// approved payment: Overview Revenue, Paid counts, the member's payment history,
// Follow-ups, My sign-ups and Team activity all read payments.reviewed_at.
//
//   • Nothing exists yet → the same activatePayment an approved receipt runs
//     (badge or plan, notification, receipt email, payment.approve audit).
//   • A manual grant already gave the badge / plan → the payment is approved and
//     attached to it; nothing is granted again and no plan is extended. The
//     receipt email still goes, as for any approved bank receipt.
//   • A fee the member already paid → refused (ALREADY_PAID).
//
// OWNER ONLY — the route refuses everyone else before anything here runs.
// Nothing is deleted: a link that could not be finished leaves its payment
// marked rejected with the reason.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeOrTerm } from '@/lib/pgFilter'
import { normalisePkMobile } from '@/lib/phone'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { deliverEmail } from '@/lib/notify'
import { formatDate } from '@/lib/datetime'
import { formatName } from '@/lib/formatName'
import { newPaymentReference } from '@/lib/payments/provider'
import { activatePayment } from '@/lib/payments/activate'
import { closeOtherCheckouts } from '@/lib/payments/closeOtherCheckouts'
import { buildBoard } from '@/lib/settlementMatchCore'
import { clearLinks, loadAll, type Actor } from '@/lib/settlementMatch'
import {
  ALREADY_PAID,
  autoReceiptMatch,
  bankPaymentRow,
  feeAmountSplit,
  creditPaidAt,
  pickerOffers,
  linkDecision,
  type ExistingPayment,
  type ExistingSub,
  type LinkPlan,
} from '@/lib/bankPaymentLinkCore'
import { existingFeeFor, loadFeeRange } from '@/lib/feeMatch'
import type { ExistingFee } from '@/lib/feeMatchCore'

const NOT_NOW = 'This is not working right now. Please try again in a few minutes.'

export type LinkableCredit = {
  id: string
  date: string
  time: string | null
  amountPkr: number
  reference: string | null
  senderName: string | null
  isPaypro: boolean
  /** Set when the credit is now matched AUTOMATICALLY to a bank-transfer
   *  receipt: that receipt's TM reference(s). Linking replaces the guess. */
  replacesReceipts: string[]
}

/** The credits "Record a bank payment" may offer (owner, 27 Oct 2026): only
 *  unlinked credits — never one already matched (by hand OR by the automatic
 *  receipt guess), never a PayPro payout, never one above Rs 5,000 — newest
 *  first. The picker puts credits for the selected amount on top
 *  (lib/bankPaymentLinkCore pickerCredits). A credit's own "Link to member"
 *  on Finance still offers an automatically matched credit (21 Oct). */
export async function linkableCredits(): Promise<LinkableCredit[] | null> {
  const all = await loadAll()
  if (!all) return null
  const board = buildBoard({ ...all, nowIso: new Date().toISOString() })
  return board.credits
    .filter((c) => pickerOffers({ state: c.state, isPaypro: c.isPaypro, amountPkr: c.amountPkr, date: c.date, time: c.time }))
    .map((c) => ({
      id: c.id,
      date: c.date,
      time: c.time,
      amountPkr: c.amountPkr,
      reference: c.reference,
      senderName: c.senderName,
      isPaypro: c.isPaypro,
      replacesReceipts: replacedReceiptRefs(board, c.id),
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? ''))
}

/** The receipts an automatic match of this credit points at (empty when the
 *  credit is not matched, or matched by hand). */
export function replacedReceiptRefs(board: ReturnType<typeof buildBoard>, creditId: string): string[] {
  const c = board.credits.find((x) => x.id === creditId)
  if (!c || !autoReceiptMatch(c.state, c.match)) return []
  const refs = new Map(board.receipts.map((r) => [r.id, r.ref]))
  return c.match!.receipts.map((id) => refs.get(id) ?? id)
}

export type LinkMember = { id: string; name: string; role: string; city: string | null; joined: string }

/** Tutors and parents by name, email or mobile. Never returns a contact field. */
export async function searchLinkMembers(query: string): Promise<LinkMember[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const q = query.trim()
  if (q.length < 2) return []
  const clean = sanitizeOrTerm(q)
  if (!clean) return []
  const like = `%${clean}%`
  const ors = [`full_name.ilike.${like}`, `email.ilike.${like}`]
  const msisdn = normalisePkMobile(q)
  if (msisdn) ors.push(`phone_number.eq.${msisdn}`, `whatsapp.eq.${msisdn}`)
  const { data } = await admin
    .from('profiles')
    .select('id, full_name, role, city, created_at')
    .in('role', ['tutor', 'parent'])
    .or(ors.join(','))
    .order('created_at', { ascending: false })
    .limit(12)
  return ((data ?? []) as { id: string; full_name: string | null; role: string; city: string | null; created_at: string }[]).map((p) => ({
    id: p.id,
    name: formatName(p.full_name) || 'No name',
    role: p.role,
    city: p.city,
    joined: p.created_at,
  }))
}

/** What a member's payment could be for: the active, paid packages of their audience. */
export async function linkPlansFor(role: string): Promise<LinkPlan[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin.from('plans').select('code, name, audience, price_pkr, active').eq('audience', role === 'tutor' ? 'tutor' : 'parent')
  return ((data ?? []) as { code: string; name: string; audience: string; price_pkr: number | null; active: boolean | null }[])
    .map((p) => ({ code: p.code, name: p.code === 'verified' ? 'Verification Fee' : p.name, audience: p.audience, pricePkr: Number(p.price_pkr) || 0, active: p.code === 'verified' || p.active !== false }))
    .filter((p) => p.pricePkr > 0 && p.active)
    .sort((a, b) => (a.code === 'verified' ? -1 : b.code === 'verified' ? 1 : a.pricePkr - b.pricePkr))
}

export type LinkResult =
  | { ok: true; paymentId: string; reference: string; mode: 'activate' | 'attach'; paidAt: string; replacedReceipts: string[]; closedCheckouts: string[] }
  | { ok: true; dryRun: true; mode: 'activate' | 'attach'; paidAt: string; replacedReceipts: string[]; creditState: string }
  | { ok: false; status: number; error: string; existing?: ExistingFee | null }

export async function linkCreditToMember(
  input: { transferId: string; memberId: string; planCode: string; amountPkr: number },
  actor: Actor,
  /** Written into the audit row — e.g. that a data step did this on the Owner's instruction. */
  opts: { auditNote?: string; dryRun?: boolean } = {},
): Promise<LinkResult> {
  const admin = createAdminClient()
  const all = await loadAll()
  if (!admin || !all) return { ok: false, status: 503, error: NOT_NOW }

  const board = buildBoard({ ...all, nowIso: new Date().toISOString() })
  const credit = board.credits.find((c) => c.id === input.transferId)
  if (!credit) return { ok: false, status: 404, error: 'That bank credit was not found.' }

  const [{ data: profile }, { data: tp }, { data: planRow }, { data: pays }, { data: subRows }] = await Promise.all([
    admin.from('profiles').select('id, role, full_name').eq('id', input.memberId).maybeSingle(),
    admin.from('tutor_profiles').select('verified_fee_paid_at').eq('id', input.memberId).maybeSingle(),
    admin.from('plans').select('code, name, audience, price_pkr, active').eq('code', input.planCode).maybeSingle(),
    admin.from('payments').select('id, plan_code, status, refunded_amount_pkr, refunded_at').eq('user_id', input.memberId),
    admin.from('subscriptions').select('id, plan_code, status, payment_id').eq('user_id', input.memberId).in('status', ['active', 'paused']),
  ])
  if (!profile) return { ok: false, status: 404, error: 'That member was not found.' }

  const plan: LinkPlan | null = planRow
    ? {
        code: planRow.code as string,
        name: planRow.code === 'verified' ? 'Verification Fee' : (planRow.name as string),
        audience: planRow.audience as string,
        pricePkr: Number(planRow.price_pkr) || 0,
        // The fee row is kept active=false on purpose (migration 86): it is still the fee.
        active: planRow.code === 'verified' || planRow.active !== false,
      }
    : null
  const payments: ExistingPayment[] = ((pays ?? []) as Record<string, unknown>[]).map((p) => ({
    id: String(p.id),
    planCode: (p.plan_code as string | null) ?? null,
    status: String(p.status),
    refundedAmountPkr: p.refunded_amount_pkr === null ? null : Number(p.refunded_amount_pkr),
    refundedAt: (p.refunded_at as string | null) ?? null,
  }))
  const subs: ExistingSub[] = ((subRows ?? []) as Record<string, unknown>[]).map((s) => ({
    id: String(s.id),
    planCode: String(s.plan_code),
    status: String(s.status),
    paymentId: (s.payment_id as string | null) ?? null,
  }))
  const feePaidAt = (tp?.verified_fee_paid_at as string | null) ?? null
  const feeRange = await loadFeeRange()

  const decision = linkDecision({
    memberRole: profile.role as string,
    feePaidAt,
    plan,
    payments,
    subs,
    creditState: credit.state,
    creditMatch: credit.match,
    creditAmountPkr: credit.amountPkr,
    amountPkr: input.amountPkr,
    feeRange,
  })
  if (!decision.ok) {
    // 'Already paid' says which payment, so the Owner can link this credit to it
    // (it has no credit yet) or mark this one a duplicate — refund due.
    const existing = decision.error === ALREADY_PAID && plan?.code === 'verified' ? await existingFeeFor(input.memberId, board) : null
    return { ok: false, status: 409, error: decision.error, existing }
  }

  const replacedReceipts = replacedReceiptRefs(board, credit.id)
  const paidAt = creditPaidAt(credit.date, credit.time)
  if (opts.dryRun) return { ok: true, dryRun: true, mode: decision.mode, paidAt, replacedReceipts, creditState: credit.state }
  const reference = newPaymentReference()
  const split = feeAmountSplit(plan!.code, input.amountPkr, plan!.pricePkr, feeRange)
  const row = bankPaymentRow({
    userId: input.memberId,
    planCode: plan!.code,
    amountPkr: split.amountPkr,
    roundingPkr: split.roundingPkr,
    providerRef: reference,
    bankReference: credit.reference,
    creditId: credit.id,
    creditDate: credit.date,
  })
  const { data: created, error: insertError } = await admin.from('payments').insert(row).select('id').single()
  if (insertError || !created) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  const paymentId = created.id as string

  const giveUp = async (why: string): Promise<LinkResult> => {
    await admin
      .from('payments')
      .update({ status: 'rejected', rejection_reason: `Not recorded: ${why}`, reviewed_by: actor.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', paymentId)
    return { ok: false, status: 400, error: why }
  }

  const name = formatName(profile.full_name as string | null) || 'there'

  if (decision.mode === 'activate') {
    const result = await activatePayment({ paymentId, source: 'manual_approval', actor: { id: actor.id, adminRole: actor.adminRole, email: actor.email ?? null } })
    if (!result.ok) return giveUp(result.error)
  } else {
    // A manual grant already gave it: approve and attach, grant nothing again.
    const { error } = await admin
      .from('payments')
      .update({ status: 'approved', reviewed_by: actor.id, reviewed_at: paidAt, updated_at: new Date().toISOString() })
      .eq('id', paymentId)
    if (error) return giveUp('That did not save. Please try again.')

    let expiresAt: string | null = null
    if (decision.subscriptionId) {
      const { data: sub } = await admin
        .from('subscriptions')
        .update({ payment_id: paymentId })
        .eq('id', decision.subscriptionId)
        .select('expires_at')
        .maybeSingle()
      expiresAt = (sub?.expires_at as string | null) ?? null
    }

    // The receipt email, as for any approved bank receipt.
    const mailed =
      plan!.code === 'verified'
        ? await deliverEmail({ userId: input.memberId }, { id: 'verification_fee_paid', name, amountPkr: input.amountPkr })
        : await deliverEmail(
            { userId: input.memberId },
            { id: 'plan_activated', name, planName: plan!.name, expiresAt: expiresAt ? formatDate(expiresAt) : 'the day your plan starts', amountPkr: input.amountPkr },
          )
    if (!mailed.ok) console.info('[bank-link] receipt email not sent:', mailed.reason, input.memberId)

    await logActivity({
      userId: input.memberId,
      event: plan!.code === 'verified' ? 'verification_fee_paid' : 'plan_purchased',
      targetType: 'payment',
      targetId: paymentId,
      meta: { amountPkr: input.amountPkr, provider: 'manual', source: 'bank_credit_link', attachedToGrant: true },
    })
  }

  // Paid: any other open checkout for the same thing is closed "Paid by
  // another method" (activatePayment already did it on the activate path).
  const closedCheckouts = await closeOtherCheckouts(admin, { userId: input.memberId, paymentId, planCode: plan!.code, actorId: actor.id })

  // Revenue and every paid count read reviewed_at: the day the money arrived,
  // not the day it was linked.
  await admin.from('payments').update({ reviewed_at: paidAt }).eq('id', paymentId)

  // The settlement check: this credit pays exactly this payment.
  const note = `Linked to ${name} (${plan!.name})`
  const cleared = await clearLinks(credit.id, actor)
  const { error: linkError } = cleared
    ? await admin.from('settlement_links').insert({ transfer_id: credit.id, kind: 'receipt', target: paymentId, note, linked_by: actor.id, linked_by_email: actor.email ?? null })
    : { error: { message: 'clear failed' } }

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'payment.bank_link',
    targetType: 'payment',
    targetId: paymentId,
    detail: {
      userId: input.memberId,
      planCode: plan!.code,
      amountPkr: input.amountPkr,
      bankTransferId: credit.id,
      bankReference: credit.reference,
      paidAt,
      mode: decision.mode,
      reference,
      settlementLinked: !linkError,
      replacedAutoMatch: replacedReceipts,
      closedCheckouts: closedCheckouts.length,
      ...(opts.auditNote ? { note: opts.auditNote } : {}),
    },
  })

  if (linkError) {
    return {
      ok: false,
      status: 500,
      error: `The payment ${reference} was recorded, but linking it to the bank credit did not save. Link the credit to bank transfer ${reference} by hand on the Settlement check.`,
    }
  }
  return { ok: true, paymentId, reference, mode: decision.mode, paidAt, replacedReceipts, closedCheckouts }
}
