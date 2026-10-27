// lib/feeMatch.ts — the I/O half of lib/feeMatchCore (owner, 27 Oct 2026).
//
// Payment auto-linking: the Fee match range setting, the automatic link run
// (after a credit is added by hand or by the bank email reader, and the
// one-time clean-up), the credit attached when the Owner approves a receipt,
// "Link this credit to that payment", "Mark as duplicate — refund due",
// and re-labelling a credit "Owner / partner transfer (not revenue)".
//
// A link here is a settlement_links 'receipt' row like a hand link; the
// automatic ones carry a note starting "Automatic fee match", so the board
// shows them as automatic. The extra above the fee goes on the payment as
// payments.rounding_pkr. Nothing activates, approves or grants anything.
// Every write is audit-logged. Never logs a name, number or account.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { pageAll } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { buildBoard, type Board, type CreditView } from '@/lib/settlementMatchCore'
import { clearLinks, loadAll, type Actor } from '@/lib/settlementMatch'
import {
  AUTO_LINK_NOTE_PREFIX,
  FEE_NAME_HOW,
  FEE_MATCH_DEFAULT,
  FEE_MAX_KEY,
  FEE_MIN_KEY,
  REFUND_DUE_TARGET,
  approvalPick,
  autoLinkPlan,
  feeRangeProblem,
  inFeeRange,
  likelyMember,
  parseFeeRange,
  partialShort,
  relabelPatch,
  roundingOf,
  type CreditLabel,
  type ExistingFee,
  type FeeRange,
  type FreeCredit,
  type OpenFeePayment,
} from '@/lib/feeMatchCore'

const NOT_NOW = 'This is not working right now. Please try again in a few minutes.'

// ----------------------------------------------------------------- setting

export async function loadFeeRange(): Promise<FeeRange> {
  const admin = createAdminClient()
  if (!admin) return { ...FEE_MATCH_DEFAULT }
  const { data } = await admin.from('app_settings').select('key, value').in('key', [FEE_MIN_KEY, FEE_MAX_KEY])
  const by = new Map(((data ?? []) as { key: string; value: string | null }[]).map((r) => [r.key, r.value]))
  return parseFeeRange(by.get(FEE_MIN_KEY), by.get(FEE_MAX_KEY))
}

/** The Verification Fee's own price (plans 'verified'), 199 when unreadable. */
export async function loadFeePrice(): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 199
  const { data } = await admin.from('plans').select('price_pkr').eq('code', 'verified').maybeSingle()
  const n = Number(data?.price_pkr)
  return Number.isFinite(n) && n > 0 ? n : 199
}

/** OWNER ONLY (the route checks). Audited with before → after. */
export async function saveFeeRange(min: number, max: number, actor: Actor): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: NOT_NOW }
  const problem = feeRangeProblem(min, max, await loadFeePrice())
  if (problem) return { ok: false, error: problem }
  const before = await loadFeeRange()
  const { error } = await admin.from('app_settings').upsert(
    [
      { key: FEE_MIN_KEY, value: String(min) },
      { key: FEE_MAX_KEY, value: String(max) },
    ],
    { onConflict: 'key' },
  )
  if (error) return { ok: false, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'settings.fee_match_range',
    targetType: 'app_settings',
    targetId: FEE_MIN_KEY,
    detail: { before, after: { min, max } },
  })
  return { ok: true }
}

// ----------------------------------------------------------------- board facts

export function freeCredits(board: Board): FreeCredit[] {
  return board.credits
    .filter((c) => c.state === 'unmatched' && !c.isPaypro)
    .map((c) => ({ id: c.id, date: c.date, time: c.time, amountPkr: c.amountPkr, senderName: c.senderName, isPaypro: c.isPaypro }))
}

/** Approved Verification Fee bank-transfer payments with no bank credit yet. */
export function openFeePayments(board: Board): OpenFeePayment[] {
  return board.receipts
    .filter((r) => r.state === 'waiting' && r.planCode === 'verified')
    .map((r) => ({
      id: r.id,
      ref: r.ref,
      memberId: r.memberId ?? null,
      memberName: r.payerName ? formatName(r.payerName) : null,
      amountPkr: r.amountPkr,
      createdAt: r.createdAt ?? null,
      reviewedAt: r.reviewedAt ?? null,
    }))
}

async function loadBoard(): Promise<Board | null> {
  const all = await loadAll()
  return all ? buildBoard({ ...all, nowIso: new Date().toISOString() }) : null
}

/** Is any live link already pointing at this payment? (one credit per payment) */
async function paymentAlreadyLinked(admin: NonNullable<ReturnType<typeof createAdminClient>>, paymentId: string, exceptTransfer: string): Promise<boolean> {
  const { data } = await admin.from('settlement_links').select('transfer_id').eq('kind', 'receipt').eq('target', paymentId).is('removed_at', null)
  return ((data ?? []) as { transfer_id: string }[]).some((l) => l.transfer_id !== exceptTransfer)
}

/** Store one credit → payment link, put the rounding on the payment, audit it. */
async function storeLink(
  input: { creditId: string; paymentId: string; rounding: number; note: string; action: string; detail?: Record<string, unknown> },
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: NOT_NOW }
  if (await paymentAlreadyLinked(admin, input.paymentId, input.creditId)) return { ok: false, error: 'That payment is already linked to another bank credit.' }
  if (!(await clearLinks(input.creditId, actor))) return { ok: false, error: 'That did not save. Please try again.' }
  const { error } = await admin.from('settlement_links').insert({
    transfer_id: input.creditId,
    kind: 'receipt',
    target: input.paymentId,
    note: input.note.slice(0, 500),
    linked_by: actor.id,
    linked_by_email: actor.email ?? null,
  })
  if (error) return { ok: false, error: 'That did not save. Please try again.' }
  await admin.from('payments').update({ rounding_pkr: input.rounding > 0 ? input.rounding : null }).eq('id', input.paymentId)
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: input.action,
    targetType: 'bank_transfer',
    targetId: input.creditId,
    detail: { paymentId: input.paymentId, roundingPkr: input.rounding, ...(input.detail ?? {}) },
  })
  return { ok: true }
}

const rs = (n: number) => `Rs ${n.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`

// ----------------------------------------------------------------- the run

export type AutoLinkOutcome = {
  linked: { creditId: string; paymentId: string; paymentRef: string; memberName: string | null; amountPkr: number; rounding: number }[]
  suggestions: { creditId: string; paymentRef: string; memberName: string | null; amountPkr: number }[]
  /** Free credits the rule could not place, with the reason in plain words. */
  stillNeeds: { creditId: string; amountPkr: number; date: string; senderName: string | null; why: string }[]
}

/**
 * Link every safe free credit (in range, within 48 h, name matches) to its
 * open fee payment. `onlyCredits` limits the run to credits just added.
 */
export async function runFeeAutoLink(actor: Actor, opts: { dryRun?: boolean; onlyCredits?: string[]; auditNote?: string } = {}): Promise<AutoLinkOutcome | null> {
  const board = await loadBoard()
  if (!board) return null
  const range = await loadFeeRange()
  const price = await loadFeePrice()
  const credits = freeCredits(board).filter((c) => !opts.onlyCredits || opts.onlyCredits.includes(c.id))
  const payments = openFeePayments(board)
  const plan = autoLinkPlan(credits, payments, range)
  const payBy = new Map(payments.map((p) => [p.id, p]))
  const creditBy = new Map(credits.map((c) => [c.id, c]))

  const out: AutoLinkOutcome = { linked: [], suggestions: [], stillNeeds: [] }

  // The board already pairs a fee-range credit with a same-name fee payment
  // (FEE_NAME_HOW). Pin each such pair as a stored link and record its rounding,
  // so it holds even when later credits arrive.
  const receiptBy = new Map(board.receipts.map((r) => [r.id, r]))
  for (const c of board.credits) {
    if (opts.onlyCredits && !opts.onlyCredits.includes(c.id)) continue
    if (c.state !== 'matched' || !c.match || c.match.how !== FEE_NAME_HOW || c.match.receipts.length !== 1) continue
    const r = receiptBy.get(c.match.receipts[0])
    if (!r) continue
    const rounding = roundingOf(c.amountPkr, r.amountPkr)
    if (!opts.dryRun) {
      const res = await storeLink(
        {
          creditId: c.id,
          paymentId: r.id,
          rounding,
          note: `${AUTO_LINK_NOTE_PREFIX}: ${r.ref}${rounding > 0 ? ` · ${rs(rounding)} rounding` : ''}`,
          action: 'settlement.auto_link',
          detail: { paymentRef: r.ref, amountPkr: c.amountPkr, ...(opts.auditNote ? { note: opts.auditNote } : {}) },
        },
        actor,
      )
      if (!res.ok) {
        out.stillNeeds.push({ creditId: c.id, amountPkr: c.amountPkr, date: c.date, senderName: c.senderName, why: res.error })
        continue
      }
    }
    out.linked.push({ creditId: c.id, paymentId: r.id, paymentRef: r.ref, memberName: r.payerName ? formatName(r.payerName) : null, amountPkr: c.amountPkr, rounding })
  }

  for (const l of plan.links) {
    const p = payBy.get(l.paymentId)!
    const c = creditBy.get(l.creditId)!
    if (!opts.dryRun) {
      const r = await storeLink(
        {
          creditId: l.creditId,
          paymentId: l.paymentId,
          rounding: l.rounding,
          note: `${AUTO_LINK_NOTE_PREFIX}: ${p.ref}${l.rounding > 0 ? ` · ${rs(l.rounding)} rounding` : ''}`,
          action: 'settlement.auto_link',
          detail: { paymentRef: p.ref, amountPkr: c.amountPkr, ...(opts.auditNote ? { note: opts.auditNote } : {}) },
        },
        actor,
      )
      if (!r.ok) {
        out.stillNeeds.push({ creditId: c.id, amountPkr: c.amountPkr, date: c.date, senderName: c.senderName, why: r.error })
        continue
      }
    }
    out.linked.push({ creditId: c.id, paymentId: p.id, paymentRef: p.ref, memberName: p.memberName, amountPkr: c.amountPkr, rounding: l.rounding })
  }
  const linkedIds = new Set(plan.links.map((l) => l.creditId))
  const suggested = new Map(plan.suggestions.map((s) => [s.creditId, s]))
  for (const c of credits) {
    if (linkedIds.has(c.id)) continue
    const s = suggested.get(c.id)
    if (s) {
      out.suggestions.push({ creditId: c.id, paymentRef: s.paymentRef, memberName: s.memberName, amountPkr: c.amountPkr })
      out.stillNeeds.push({ creditId: c.id, amountPkr: c.amountPkr, date: c.date, senderName: c.senderName, why: `the sender name does not match ${s.memberName ?? 'the member'} (${s.paymentRef}) — one-tap suggestion shown` })
      continue
    }
    const short = partialShort(c.amountPkr, range, price)
    let why: string
    if (short !== null) why = `partial — ${rs(short)} short of the fee`
    else if (!inFeeRange(c.amountPkr, range)) why = `the amount is outside the fee match range (${rs(range.min)}–${rs(range.max)}) — a plan or something else`
    else why = 'no approved fee payment without a credit within 48 hours'
    out.stillNeeds.push({ creditId: c.id, amountPkr: c.amountPkr, date: c.date, senderName: c.senderName, why })
  }
  return out
}

/** The run after credits are added (by hand or the bank email reader). Never throws. */
export async function autoLinkNewCredits(creditIds: string[], actor: Actor): Promise<void> {
  if (creditIds.length === 0) return
  try {
    await runFeeAutoLink(actor, { onlyCredits: creditIds })
  } catch {
    /* fail open: a credit stays in Needs attention for the Owner */
  }
}

// ----------------------------------------------------------------- hints

export type CreditHint =
  | { kind: 'suggest'; paymentId: string; paymentRef: string; memberId: string | null; memberName: string | null }
  | { kind: 'partial'; short: number; memberId: string | null; memberName: string | null }
  | { kind: 'rounding'; rounding: number }

/** Needs-attention hints per credit: a one-tap suggestion, a partial flag
 *  (with the likely member), or the rounding a linked fee credit carried. */
export async function creditHints(board: Board): Promise<Record<string, CreditHint>> {
  const range = await loadFeeRange()
  const price = await loadFeePrice()
  const credits = freeCredits(board)
  const plan = autoLinkPlan(credits, openFeePayments(board), range)
  const out: Record<string, CreditHint> = {}
  for (const s of plan.suggestions) out[s.creditId] = { kind: 'suggest', paymentId: s.paymentId, paymentRef: s.paymentRef, memberId: s.memberId, memberName: s.memberName }

  const partials = credits.filter((c) => !out[c.id] && partialShort(c.amountPkr, range, price) !== null)
  if (partials.length > 0) {
    // Tutors who have not paid, and members whose fee payment has no credit yet.
    const open = openFeePayments(board).filter((p) => p.memberId).map((p) => ({ id: p.memberId!, name: p.memberName }))
    const members = [...new Map([...(await unpaidTutors()), ...open].map((m) => [m.id, m])).values()]
    for (const c of partials) {
      const m = likelyMember(c.senderName, members)
      out[c.id] = { kind: 'partial', short: partialShort(c.amountPkr, range, price)!, memberId: m?.id ?? null, memberName: m?.name ?? null }
    }
  }
  for (const c of board.credits as CreditView[]) {
    if (c.state !== 'matched' || !c.match || c.match.orders.length > 0 || c.match.receipts.length !== 1) continue
    const extra = Math.round((c.amountPkr - c.match.expected) * 100) / 100
    if (extra > 0.005 && inFeeRange(c.amountPkr, range)) out[c.id] = { kind: 'rounding', rounding: extra }
  }
  return out
}

/** Tutors who have not paid the fee (for "likely member" on a partial credit). */
async function unpaidTutors(): Promise<{ id: string; name: string | null }[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const rows = await pageAll((from, to) =>
    admin.from('tutor_profiles').select('id').is('verified_fee_paid_at', null).order('id').range(from, to),
  )
  const ids = (rows as { id: string }[]).map((r) => r.id)
  const out: { id: string; name: string | null }[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin
      .from('profiles')
      .select('id, full_name, is_test_name, hidden_from_public, is_seed')
      .in('id', ids.slice(i, i + 200))
      .eq('role', 'tutor')
    for (const p of (data ?? []) as Record<string, unknown>[]) {
      if (p.is_test_name || p.hidden_from_public || p.is_seed) continue
      out.push({ id: String(p.id), name: formatName(p.full_name as string | null) || null })
    }
  }
  return out
}

// ----------------------------------------------------------------- approval

/**
 * The Owner approved a receipt: attach the closest unlinked in-range credit
 * within 48 hours. Returns the credit used, or null. Never throws.
 */
export async function attachCreditOnApproval(paymentId: string, actor: Actor): Promise<{ amountPkr: number; date: string; time: string | null; reference: string | null; senderName: string | null; rounding: number } | null> {
  try {
    const board = await loadBoard()
    if (!board) return null
    const receipt = board.receipts.find((r) => r.id === paymentId)
    if (!receipt || receipt.state !== 'waiting' || receipt.planCode !== 'verified') return null
    const range = await loadFeeRange()
    const credits = freeCredits(board)
    const pick = approvalPick({ createdAt: receipt.createdAt ?? null, reviewedAt: receipt.reviewedAt ?? null }, credits, range)
    if (!pick) return null
    const c = board.credits.find((x) => x.id === pick.creditId)!
    const rounding = roundingOf(c.amountPkr, receipt.amountPkr)
    const r = await storeLink(
      {
        creditId: c.id,
        paymentId,
        rounding,
        note: `${AUTO_LINK_NOTE_PREFIX} on approval: ${receipt.ref}${rounding > 0 ? ` · ${rs(rounding)} rounding` : ''}`,
        action: 'settlement.approval_link',
        detail: { paymentRef: receipt.ref, amountPkr: c.amountPkr },
      },
      actor,
    )
    if (!r.ok) return null
    return { amountPkr: c.amountPkr, date: c.date, time: c.time, reference: c.reference, senderName: c.senderName, rounding }
  } catch {
    return null
  }
}

// ----------------------------------------------------------------- already paid

/** The member's counted Verification Fee payment and whether a credit already pays it. */
export async function existingFeeFor(memberId: string, board?: Board | null): Promise<ExistingFee | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('payments')
    .select('id, provider_ref, amount_pkr, reviewed_at, provider, status, refunded_amount_pkr, refunded_at')
    .eq('user_id', memberId)
    .eq('plan_code', 'verified')
    .eq('status', 'approved')
    .order('reviewed_at', { ascending: true })
  const counted = ((data ?? []) as Record<string, unknown>[]).filter((p) => !(Number(p.refunded_amount_pkr) > 0 || p.refunded_at))
  const p = counted[0]
  if (!p) return null
  const b = board ?? (await loadBoard())
  const receipt = b?.receipts.find((r) => r.id === p.id)
  return {
    paymentId: String(p.id),
    ref: String(p.provider_ref ?? p.id),
    amountPkr: Number(p.amount_pkr) || 0,
    approvedAt: (p.reviewed_at as string | null) ?? null,
    provider: String(p.provider ?? 'manual'),
    hasCredit: p.provider !== 'manual' || receipt?.state === 'matched',
  }
}

/** "Link this credit to that payment" — OWNER ONLY (the route checks). */
export async function linkCreditToExisting(input: { transferId: string; paymentId: string }, actor: Actor): Promise<{ ok: true; rounding: number } | { ok: false; status: number; error: string }> {
  const board = await loadBoard()
  if (!board) return { ok: false, status: 503, error: NOT_NOW }
  const c = board.credits.find((x) => x.id === input.transferId)
  if (!c) return { ok: false, status: 404, error: 'That bank credit was not found.' }
  if (c.state !== 'unmatched' && c.state !== 'held') return { ok: false, status: 409, error: 'This bank credit is already linked or set aside. Put it back to automatic first.' }
  const r = board.receipts.find((x) => x.id === input.paymentId)
  if (!r) return { ok: false, status: 404, error: 'That payment is not an approved bank-transfer payment.' }
  if (r.state !== 'waiting') return { ok: false, status: 409, error: 'That payment already has a bank credit. Mark this one as a duplicate instead.' }
  const range = await loadFeeRange()
  const fee = r.planCode === 'verified'
  if (fee ? !inFeeRange(c.amountPkr, range) : Math.abs(c.amountPkr - r.amountPkr) > 0.005) {
    return { ok: false, status: 409, error: fee ? `The credit is outside the fee match range (${rs(range.min)}–${rs(range.max)}).` : 'The credit is not the same amount as that payment.' }
  }
  const rounding = roundingOf(c.amountPkr, r.amountPkr)
  const res = await storeLink(
    {
      creditId: c.id,
      paymentId: r.id,
      rounding,
      note: `Linked by the Owner to the earlier payment ${r.ref}${rounding > 0 ? ` · ${rs(rounding)} rounding` : ''}`,
      action: 'settlement.link_existing',
      detail: { paymentRef: r.ref, amountPkr: c.amountPkr },
    },
    actor,
  )
  return res.ok ? { ok: true, rounding } : { ok: false, status: 409, error: res.error }
}

// ----------------------------------------------------------------- refund due

export type RefundDue = {
  id: string
  memberId: string | null
  memberName: string | null
  transferId: string
  paymentId: string | null
  paymentRef: string | null
  amountPkr: number
  note: string | null
  createdAt: string
  createdByName: string | null
  refundedAt: string | null
}

/** "Mark as duplicate — refund due" — OWNER ONLY (the route checks). */
export async function markRefundDue(input: { transferId: string; memberId: string; paymentId: string | null; note: string | null }, actor: Actor & { name?: string | null }): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data: t } = await admin.from('bank_transfers').select('id, amount_pkr').eq('id', input.transferId).maybeSingle()
  if (!t) return { ok: false, status: 404, error: 'That bank credit was not found.' }
  const { data: have } = await admin.from('refund_dues').select('id').eq('transfer_id', input.transferId).maybeSingle()
  if (have) return { ok: false, status: 409, error: 'A refund is already due for this bank credit.' }
  const amount = Number(t.amount_pkr) || 0
  const { data: row, error } = await admin
    .from('refund_dues')
    .insert({
      member_id: input.memberId,
      transfer_id: input.transferId,
      payment_id: input.paymentId,
      amount_pkr: amount,
      note: input.note?.trim().slice(0, 500) || null,
      created_by: actor.id,
      created_by_name: actor.name ?? null,
    })
    .select('id')
    .single()
  if (error || !row) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  if (await clearLinks(input.transferId, actor)) {
    await admin.from('settlement_links').insert({
      transfer_id: input.transferId,
      kind: 'none',
      target: REFUND_DUE_TARGET,
      note: input.note?.trim().slice(0, 500) || 'Duplicate payment — refund due',
      linked_by: actor.id,
      linked_by_email: actor.email ?? null,
    })
  }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'settlement.refund_due',
    targetType: 'profile',
    targetId: input.memberId,
    detail: { refundDueId: row.id, bankTransferId: input.transferId, paymentId: input.paymentId, amountPkr: amount },
  })
  return { ok: true, id: row.id as string }
}

/** Mark a refund due as refunded — OWNER ONLY (the route checks). */
export async function markRefundDone(input: { id: string; note: string | null }, actor: Actor & { name?: string | null }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data: due } = await admin.from('refund_dues').select('id, member_id, amount_pkr, refunded_at').eq('id', input.id).maybeSingle()
  if (!due) return { ok: false, status: 404, error: 'That refund was not found.' }
  if (due.refunded_at) return { ok: false, status: 409, error: 'This refund is already marked refunded.' }
  const { error } = await admin
    .from('refund_dues')
    .update({ refunded_at: new Date().toISOString(), refunded_by: actor.id, refunded_by_name: actor.name ?? null, refund_note: input.note?.trim().slice(0, 500) || null })
    .eq('id', input.id)
    .is('refunded_at', null)
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'settlement.refund_done',
    targetType: 'profile',
    targetId: (due.member_id as string | null) ?? input.id,
    detail: { refundDueId: input.id, amountPkr: Number(due.amount_pkr) || 0 },
  })
  return { ok: true }
}

export async function loadRefundDues(opts: { memberId?: string; openOnly?: boolean } = {}): Promise<RefundDue[]> {
  const admin = createAdminClient()
  if (!admin) return []
  let q = admin.from('refund_dues').select('id, member_id, transfer_id, payment_id, amount_pkr, note, created_at, created_by_name, refunded_at').order('created_at', { ascending: false }).limit(500)
  if (opts.memberId) q = q.eq('member_id', opts.memberId)
  if (opts.openOnly) q = q.is('refunded_at', null)
  const { data, error } = await q
  if (error) return []
  const rows = (data ?? []) as Record<string, unknown>[]
  const memberIds = [...new Set(rows.map((r) => r.member_id).filter((v): v is string => typeof v === 'string'))]
  const payIds = [...new Set(rows.map((r) => r.payment_id).filter((v): v is string => typeof v === 'string'))]
  const [{ data: ps }, { data: pays }] = await Promise.all([
    memberIds.length ? admin.from('profiles').select('id, full_name').in('id', memberIds) : Promise.resolve({ data: [] }),
    payIds.length ? admin.from('payments').select('id, provider_ref').in('id', payIds) : Promise.resolve({ data: [] }),
  ])
  const names = new Map(((ps ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, formatName(p.full_name)]))
  const refs = new Map(((pays ?? []) as { id: string; provider_ref: string | null }[]).map((p) => [p.id, p.provider_ref]))
  return rows.map((r) => ({
    id: String(r.id),
    memberId: (r.member_id as string | null) ?? null,
    memberName: typeof r.member_id === 'string' ? (names.get(r.member_id) ?? null) : null,
    transferId: String(r.transfer_id),
    paymentId: (r.payment_id as string | null) ?? null,
    paymentRef: typeof r.payment_id === 'string' ? (refs.get(r.payment_id) ?? null) : null,
    amountPkr: Number(r.amount_pkr) || 0,
    note: (r.note as string | null) ?? null,
    createdAt: String(r.created_at),
    createdByName: (r.created_by_name as string | null) ?? null,
    refundedAt: (r.refunded_at as string | null) ?? null,
  }))
}

// ----------------------------------------------------------------- re-label

/** Re-label a credit — OWNER ONLY (the route checks); a reason is required. */
export async function relabelCredit(input: { transferId: string; to: CreditLabel; reason: string }, actor: Actor): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const reason = input.reason.trim()
  if (reason.length < 3) return { ok: false, status: 400, error: 'Add a short reason.' }
  const { data: t } = await admin.from('bank_transfers').select('id, gateway, category, amount_pkr').eq('id', input.transferId).maybeSingle()
  if (!t) return { ok: false, status: 404, error: 'That bank credit was not found.' }
  const from = t.category === 'owner_transfer' ? 'owner_transfer' : t.gateway === 'paypro' ? 'paypro' : 'member'
  if (from === input.to) return { ok: false, status: 409, error: 'This credit already has that label.' }
  const patch = relabelPatch(input.to)
  const { error } = await admin
    .from('bank_transfers')
    .update({ ...patch, category_reason: reason.slice(0, 500), category_by: actor.id, category_at: new Date().toISOString() })
    .eq('id', input.transferId)
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'settlement.relabel',
    targetType: 'bank_transfer',
    targetId: input.transferId,
    detail: { from, to: input.to, reason: reason.slice(0, 500), amountPkr: Number(t.amount_pkr) || 0 },
  })
  return { ok: true }
}
