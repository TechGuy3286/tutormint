import 'server-only'
import { loadAvatarFacts, loadErasedAt } from '@/lib/memberAvatars'

// lib/bankStatement.ts — the I/O half of the Faysal Bank statement import
// (owner, 17 Nov 2026 — PR-03). Rules in lib/bankStatementCore.ts.
//
//   importStatement()          store each transaction once (Tran Seq No), turn
//                              every new credit into a bank credit (or link it to
//                              the one already recorded), then match.
//   refreshStatementMatches()  re-run the matching and store the result on each
//                              row (after an import, on the page, every 5 minutes).
//   loadStatementBoard()       the Owner's page: imports, the four lists, rows.
//   reclassify / undoReclassify, markRowPersonal / undoRowPersonal,
//   revealRowAccount, resolveUnclear — Owner only (the routes check), audited.
//
// OWNER ONLY data. Nothing here logs a name, account number, mobile or full
// reference: audit rows carry counts, amounts, days and row ids.

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { normalisePkMobile } from '@/lib/phone'
import { autoLinkNewCredits, loadFeeBoard, loadFeeRange, freeCredits, linkStatementCredit, STATEMENT_AUTO_NOTE } from '@/lib/feeMatch'
import { siteOwnerId } from '@/lib/staffHandover'
import { clearLinks } from '@/lib/settlementMatch'
import { maskPhoneDisplay } from '@/lib/contactMaskCore'
import { markPersonal, undoPersonal } from '@/lib/personalCredits'
import type { Actor } from '@/lib/settlementMatch'
import {
  CLASS_LABEL,
  classifyRow,
  contraMobile,
  decideStatementCredit,
  descriptionFacts,
  feeAmounts,
  importSummary,
  masked,
  matchFeeCredits,
  pairApprovedPayments,
  possibleDuplicates,
  parseStatement,
  resultLists,
  senderOf,
  statementRefs,
  suggestPersonal,
  type ApprovedBankPayment,
  type ApprovedPairing,
  type CreditMatch,
  type FeeCredit,
  type ImportSummary,
  type MatchMember,
  type PendingReceipt,
  type RecordedCredit,
  type StatementClass,
  type StatementRow,
} from '@/lib/bankStatementCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>
type Result<T = unknown> = ({ ok: true } & T) | { ok: false; status: number; error: string }
const NOT_NOW = 'This is not working right now. Please try again in a few minutes.'

async function nameOf(admin: Admin, id: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle()
  return formatName((data?.full_name as string | null) ?? '') || null
}

// ===========================================================================
// Import

export type ImportOutcome = ImportSummary & { importId: string; creditsAdded: number; creditsLinked: number; creditsUnclear: number; unreadable: number }

export async function importStatement(html: string, filename: string | null, actor: Actor): Promise<Result<{ outcome: ImportOutcome }>> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const parsed = parseStatement(html)
  if ('error' in parsed) return { ok: false, status: 400, error: parsed.error }

  const seqs = parsed.rows.map((r) => r.seqNo)
  const existingRows = await pageAllIn<{ tran_seq_no: string }, string>(seqs, (part, from, to) =>
    admin.from('bank_statement_rows').select('tran_seq_no').in('tran_seq_no', part).order('tran_seq_no').range(from, to),
  )
  const existing = new Set(existingRows.map((r) => r.tran_seq_no))
  const summary = importSummary(parsed, existing)

  const { data: plans } = await admin.from('plans').select('price_pkr, active')
  const fees = feeAmounts(((plans ?? []) as { price_pkr: number | null; active: boolean | null }[]).filter((p) => p.active !== false).map((p) => Number(p.price_pkr)))

  const { data: imp, error: impErr } = await admin
    .from('bank_statement_imports')
    .insert({
      filename: filename ? filename.slice(0, 200) : null,
      uploaded_by: actor.id,
      uploaded_by_name: await nameOf(admin, actor.id),
      period_from: summary.periodFrom,
      period_to: summary.periodTo,
      rows_total: summary.rowsTotal,
      rows_new: summary.rowsNew,
      rows_duplicate: summary.rowsDuplicate,
      total_credits: summary.totalCredits,
      total_debits: summary.totalDebits,
      opening_balance: summary.openingBalance,
      closing_balance_file: summary.closingBalanceFile,
      closing_balance_computed: summary.closingBalanceComputed,
    })
    .select('id')
    .single()
  if (impErr || !imp) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  const importId = String(imp.id)

  const fresh = parsed.rows.filter((r) => !existing.has(r.seqNo))
  const inserted: { id: string; row: StatementRow; cls: StatementClass }[] = []
  for (let i = 0; i < fresh.length; i += 200) {
    const part = fresh.slice(i, i + 200)
    const payload = part.map((r) => {
      const cls = classifyRow(r, fees)
      const f = descriptionFacts(r.description)
      return {
        import_id: importId,
        tran_seq_no: r.seqNo,
        serial_no: r.serialNo,
        tran_date: r.date,
        effect_date: r.effectDate,
        tran_time: r.time,
        tran_type: r.type,
        description: r.description,
        stan: r.stan,
        debit_credit: r.debitCredit,
        reference: r.reference,
        withdrawal: r.withdrawal,
        deposit: r.deposit,
        balance: r.balance,
        ref_bank: r.refBank,
        time_stamp: r.timeStamp,
        transfer_account_no: r.transferAccountNo,
        transfer_account_title: r.transferAccountTitle,
        contra_account: f.contra,
        sender_name: senderOf(r, cls),
        sender_bank: f.senderBank,
        account_last4: f.last4 ?? (f.contra ? f.contra.slice(-4) : null) ?? (r.transferAccountNo ? r.transferAccountNo.replace(/[^0-9]/g, '').slice(-4) || null : null),
        class_auto: cls,
        class: cls,
      }
    })
    const { data, error } = await admin
      .from('bank_statement_rows')
      .upsert(payload, { onConflict: 'tran_seq_no', ignoreDuplicates: true })
      .select('id, tran_seq_no, class')
    if (error) return { ok: false, status: 500, error: 'Some rows did not save. Import the same file again — saved rows are skipped.' }
    const bySeq = new Map(part.map((r) => [r.seqNo, r]))
    for (const d of data ?? []) {
      const row = bySeq.get(String(d.tran_seq_no))
      if (row) inserted.push({ id: String(d.id), row, cls: d.class as StatementClass })
    }
  }

  // Each new credit → a bank credit (or the one already recorded).
  const creditRows = inserted.filter((x) => x.cls !== 'debit' && x.row.deposit > 0)
  let added = 0
  let linked = 0
  let unclear = 0
  const newTransferIds: string[] = []
  if (creditRows.length) {
    const days = creditRows.map((x) => x.row.date).sort()
    const recorded = await loadRecorded(admin, days[0], days[days.length - 1])
    for (const x of creditRows) {
      const sender = senderOf(x.row, x.cls)
      const decision = decideStatementCredit({ ...x.row, sender }, recorded)
      if (decision.action === 'link') {
        await admin.from('bank_transfers').update({ statement_row_id: x.id }).eq('id', decision.creditId).is('statement_row_id', null)
        await admin.from('bank_statement_rows').update({ transfer_id: decision.creditId, transfer_how: 'linked' }).eq('id', x.id)
        const r = recorded.find((c) => c.id === decision.creditId)
        if (r) r.statementRowId = x.id
        linked++
      } else if (decision.action === 'unclear') {
        await admin.from('bank_statement_rows').update({ transfer_how: 'unclear' }).eq('id', x.id)
        unclear++
      } else {
        const id = await addTransferFor(admin, x.id, x.row, x.cls, actor)
        if (id) {
          added++
          newTransferIds.push(id)
          recorded.push({ id, reference: null, amountPkr: x.row.deposit, date: x.row.date, time: x.row.time, senderName: sender, source: 'statement', statementRowId: x.id })
        }
      }
    }
  }
  await admin.from('bank_statement_imports').update({ credits_added: added, credits_linked: linked, credits_unclear: unclear }).eq('id', importId)
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'settlement.statement_import',
    targetType: 'bank_statement_import',
    targetId: importId,
    // Counts and totals only.
    detail: { rowsNew: summary.rowsNew, rowsDuplicate: summary.rowsDuplicate, totalCredits: summary.totalCredits, totalDebits: summary.totalDebits, balanceMatches: summary.balanceMatches, added, linked, unclear, from: summary.periodFrom, to: summary.periodTo },
  })
  // The existing fee rule links a fee credit to an approved payment by name within 48 hours.
  await autoLinkNewCredits(newTransferIds, actor)
  await refreshStatementMatches().catch(() => null)
  return { ok: true, outcome: { ...summary, importId, creditsAdded: added, creditsLinked: linked, creditsUnclear: unclear, unreadable: parsed.unreadable } }
}

async function loadRecorded(admin: Admin, from: string, to: string): Promise<RecordedCredit[]> {
  const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
  const rows = await pageAll<{ id: string; reference: string | null; amount_pkr: number; transferred_on: string; transferred_time: string | null; sender_name: string | null; source: string; statement_row_id: string | null }>((f, t) =>
    admin
      .from('bank_transfers')
      .select('id, reference, amount_pkr, transferred_on, transferred_time, sender_name, source, statement_row_id')
      .gte('transferred_on', shift(from, -1))
      .lte('transferred_on', shift(to, 1))
      .order('id')
      .range(f, t),
  )
  return rows.map((r) => ({
    id: String(r.id),
    reference: r.reference,
    amountPkr: Number(r.amount_pkr),
    date: String(r.transferred_on).slice(0, 10),
    time: r.transferred_time ? String(r.transferred_time).slice(0, 5) : null,
    senderName: r.sender_name,
    source: r.source,
    statementRowId: r.statement_row_id,
  }))
}

async function addTransferFor(admin: Admin, rowId: string, row: StatementRow, cls: StatementClass, actor: Actor): Promise<string | null> {
  const f = descriptionFacts(row.description)
  const ref = statementRefs(row)[0] ?? null
  const { data, error } = await admin
    .from('bank_transfers')
    .insert({
      transferred_on: row.date,
      transferred_time: row.time,
      amount_pkr: row.deposit,
      reference: ref,
      account_last4: f.last4 ?? (f.contra ? f.contra.slice(-4) : null),
      sender_name: senderOf(row, cls),
      sender_bank: f.senderBank,
      source: 'statement',
      gateway: cls === 'paypro' ? 'paypro' : 'manual',
      channel: /RAAST/i.test(row.description) ? 'raast' : 'ibft',
      statement_row_id: rowId,
      recorded_by: actor.id,
    })
    .select('id')
    .single()
  if (error || !data) return null
  await admin.from('bank_statement_rows').update({ transfer_id: data.id, transfer_how: 'added' }).eq('id', rowId)
  return String(data.id)
}

// ===========================================================================
// Matching

type RowRecord = {
  id: string
  tran_date: string
  tran_time: string | null
  deposit: number
  withdrawal: number
  description: string | null
  reference: string | null
  stan: string | null
  transfer_account_no: string | null
  sender_name: string | null
  class: StatementClass
  class_auto: StatementClass
  transfer_id: string | null
  transfer_how: string | null
  personal_at: string | null
  match_kind: string | null
  match_payment_id: string | null
  match_member_id: string | null
  match_reason: string | null
  match_note: string | null
  auto_link_undone_at: string | null
}

const ROW_COLUMNS =
  'id, tran_date, tran_time, deposit, withdrawal, description, reference, stan, transfer_account_no, sender_name, class, class_auto, transfer_id, transfer_how, personal_at, match_kind, match_payment_id, match_member_id, match_reason, match_note, auto_link_undone_at'

async function loadRows(admin: Admin): Promise<RowRecord[]> {
  return pageAll<RowRecord>((f, t) => admin.from('bank_statement_rows').select(ROW_COLUMNS).order('tran_date', { ascending: false }).order('id').range(f, t))
}

type MatchInputs = { credits: FeeCredit[]; receipts: PendingReceipt[]; approved: ApprovedBankPayment[]; members: MatchMember[] }

async function matchInputs(admin: Admin, rows: RowRecord[]): Promise<MatchInputs | null> {
  const board = await loadFeeBoard()
  if (!board) return null
  const free = new Set(freeCredits(board).map((c) => c.id))
  // A row waiting under "Check: possibly already recorded" has no bank credit
  // of its own yet and may be money already recorded — it is never matched
  // until the Owner decides (PR-04), so it can never be counted twice.
  const feeRows = rows.filter((r) => r.class === 'fee' && Number(r.deposit) > 0 && !(r.transfer_how === 'unclear' && !r.transfer_id))
  const credits: FeeCredit[] = feeRows.map((r) => ({
    rowId: r.id,
    transferId: r.transfer_id,
    date: String(r.tran_date).slice(0, 10),
    time: r.tran_time ? String(r.tran_time).slice(0, 5) : null,
    amount: Number(r.deposit),
    senderName: r.sender_name,
    refs: statementRefs({ reference: r.reference, stan: r.stan, description: r.description ?? '' }),
    mobile: contraMobile({ description: r.description ?? '', transferAccountNo: r.transfer_account_no }),
    // Linked to a payment already, or set aside — or personal on the row.
    settled: !!r.personal_at || (!!r.transfer_id && !free.has(r.transfer_id)),
  }))

  const pending = await pageAll<{ id: string; user_id: string | null; plan_code: string | null; amount_pkr: number; created_at: string; reference: string | null }>((f, t) =>
    admin
      .from('payments')
      .select('id, user_id, plan_code, amount_pkr, created_at, reference')
      .eq('provider', 'manual')
      .eq('status', 'pending')
      .not('screenshot_path', 'is', null)
      .is('checkout_closed_at', null)
      .order('id')
      .range(f, t),
  )
  const people = await pageAll<{ id: string; full_name: string | null; cnic_name: string | null; phone_number: string | null; phone_verified_at: string | null; whatsapp: string | null; created_at: string; role: string }>((f, t) =>
    admin
      .from('profiles')
      .select('id, full_name, cnic_name, phone_number, phone_verified_at, whatsapp, created_at, role')
      .in('role', ['tutor', 'parent', 'academy'])
      .order('id')
      .range(f, t),
  )
  const feePaid = new Set(
    (await pageAll<{ id: string }>((f, t) => admin.from('tutor_profiles').select('id').not('verified_fee_paid_at', 'is', null).order('id').range(f, t))).map((r) => r.id),
  )
  const nameBy = new Map(people.map((p) => [p.id, formatName(p.full_name ?? '') || null]))
  const receipts: PendingReceipt[] = pending.map((p) => ({
    id: p.id,
    memberId: p.user_id,
    memberName: p.user_id ? (nameBy.get(p.user_id) ?? null) : null,
    planCode: p.plan_code,
    amount: Number(p.amount_pkr),
    createdAt: p.created_at,
    reference: p.reference,
  }))
  const approved: ApprovedBankPayment[] = board.receipts.map((r) => ({
    id: r.id,
    memberId: r.memberId ?? null,
    memberName: r.memberId ? (nameBy.get(r.memberId) ?? r.payerName) : r.payerName,
    planCode: r.planCode ?? null,
    amount: r.amountPkr,
    approvedAt: r.reviewedAt ?? `${r.approvedDay}T12:00:00+05:00`,
    createdAt: r.createdAt ?? null,
    hasCredit: r.state === 'matched',
  }))
  const members: MatchMember[] = people.map((p) => ({
    id: p.id,
    names: [p.full_name, p.cnic_name].filter((v): v is string => !!v),
    mobiles: [p.phone_verified_at ? normalisePkMobile(p.phone_number) : null, normalisePkMobile(p.whatsapp)].filter((v): v is string => !!v),
    createdAt: p.created_at,
    feePaid: p.role === 'tutor' ? feePaid.has(p.id) : false,
  }))
  return { credits, receipts, approved, members }
}

type MatchRun = { matches: Map<string, CreditMatch>; pairing: ApprovedPairing; inputs: MatchInputs; autoLinked: number }

const STATEMENT_ACTOR = 'system: statement matching'

/**
 * Work the matches out (PR-04). A unique approved-payment pairing is LINKED
 * here, once (lib/feeMatch linkStatementCredit refuses a credit or payment that
 * already has a link); a row the Owner unlinked (auto_link_undone_at) is never
 * linked automatically again. One extra pass after linking, so the result shown
 * is the state the links left.
 */
async function runMatches(admin: Admin, rows: RowRecord[], opts: { autoLink: boolean }): Promise<MatchRun | null> {
  let inputs = await matchInputs(admin, rows)
  if (!inputs) return null
  const range = await loadFeeRange()
  let matches = matchFeeCredits({ ...inputs, range })
  let autoLinked = 0
  if (opts.autoLink) {
    const rowBy = new Map(rows.map((r) => [r.id, r]))
    const owner = await siteOwnerId(admin)
    for (const [rowId, m] of matches) {
      if (m.kind !== 'approved' || !m.auto || !owner) continue
      const row = rowBy.get(rowId)
      if (!row?.transfer_id || row.auto_link_undone_at) continue
      const r = await linkStatementCredit({ transferId: row.transfer_id, paymentId: m.paymentId, auto: true }, { id: owner, adminRole: 'owner', email: STATEMENT_ACTOR })
      if (r.ok) autoLinked++
    }
    if (autoLinked) {
      inputs = (await matchInputs(admin, rows)) ?? inputs
      matches = matchFeeCredits({ ...inputs, range })
    }
  }
  // Suggestions for "Approved, no bank credit": the credits still unmatched,
  // closest by time first. An auto pair the Owner undid stays a suggestion.
  const left = inputs.credits.filter((c) => matches.get(c.rowId)?.kind === 'unmatched' || (matches.get(c.rowId) as { auto?: boolean } | undefined)?.auto)
  const pairing = pairApprovedPayments(
    left.map((c) => ({ rowId: c.rowId, date: c.date, time: c.time, amount: c.amount })),
    inputs.approved,
    range,
  )
  // An auto pair that was not linked (undone, or no bank credit) reads as unmatched + a suggestion.
  for (const [rowId, m] of matches) {
    if (m.kind === 'approved' && m.auto) matches.set(rowId, { kind: 'unmatched', note: null })
  }
  return { matches, pairing, inputs, autoLinked }
}

export async function refreshStatementMatches(): Promise<{ changed: number; autoLinked: number } | null> {
  const r = await refreshWithRun()
  return r ? { changed: r.changed, autoLinked: r.run?.autoLinked ?? 0 } : null
}

async function refreshWithRun(): Promise<{ changed: number; run: MatchRun | null } | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const rows = await loadRows(admin)
  if (!rows.some((r) => r.class === 'fee')) return { changed: 0, run: null }
  const run = await runMatches(admin, rows, { autoLink: true })
  if (!run) return null
  const { matches } = run
  let changed = 0
  const now = new Date().toISOString()
  for (const r of rows) {
    const m: CreditMatch | null = r.class === 'fee' ? (matches.get(r.id) ?? null) : null
    const next = {
      match_kind: m?.kind ?? null,
      match_payment_id: m && (m.kind === 'receipt' || m.kind === 'approved') ? m.paymentId : null,
      match_member_id: m && m.kind === 'member' ? m.memberId : null,
      match_reason: m && 'reason' in m ? m.reason : null,
      match_note: m && m.kind === 'unmatched' ? m.note : null,
    }
    if (
      next.match_kind === r.match_kind &&
      next.match_payment_id === r.match_payment_id &&
      next.match_member_id === r.match_member_id &&
      next.match_reason === r.match_reason &&
      next.match_note === r.match_note
    )
      continue
    await admin.from('bank_statement_rows').update({ ...next, matched_at: now }).eq('id', r.id)
    changed++
  }
  return { changed, run }
}

/** Payment id → why it is Bank-matched (no rupees — safe for every staff role). */
export async function bankMatchedReceipts(paymentIds: string[]): Promise<Map<string, string>> {
  const admin = createAdminClient()
  const out = new Map<string, string>()
  if (!admin || !paymentIds.length) return out
  const rows = await pageAllIn<{ match_payment_id: string; match_reason: string | null }, string>(paymentIds, (part, f, t) =>
    admin.from('bank_statement_rows').select('match_payment_id, match_reason').eq('match_kind', 'receipt').in('match_payment_id', part).order('id').range(f, t),
  )
  for (const r of rows) out.set(String(r.match_payment_id), r.match_reason ?? 'Bank statement')
  return out
}

/** The bank credit a statement match ties to this pending receipt, when it is still free. */
export async function statementCreditFor(paymentId: string): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin.from('bank_statement_rows').select('transfer_id').eq('match_kind', 'receipt').eq('match_payment_id', paymentId).not('transfer_id', 'is', null).limit(1).maybeSingle()
  return (data?.transfer_id as string | undefined) ?? null
}

// ===========================================================================
// The Owner's page

export type BoardRow = {
  id: string
  date: string
  time: string | null
  type: string | null
  description: string
  deposit: number
  withdrawal: number
  sender: string | null
  account: string | null
  cls: StatementClass
  clsAuto: StatementClass
  clsLabel: string
  canUndoClass: boolean
  transferId: string | null
  transferHow: string | null
  personalAt: string | null
  personalNote: string | null
  suggestPersonal: boolean
}

export type CandidateMember = { id: string; name: string; mobile: string | null }
export type DuplicateCredit = { id: string; date: string; time: string | null; amount: number; sender: string | null; source: string }
export type AutoLinkView = { row: BoardRow; paymentId: string; paymentRef: string; memberId: string | null; memberName: string | null; linkedAt: string }

export type StatementBoard = {
  imports: { id: string; createdAt: string; filename: string | null; byName: string | null; periodFrom: string | null; periodTo: string | null; rowsNew: number; rowsDuplicate: number; totalCredits: number; totalDebits: number; closingFile: number | null; closingComputed: number | null; added: number; linked: number; unclear: number }[]
  rows: BoardRow[]
  lists: {
    bankMatched: { row: BoardRow; paymentId: string; paymentRef: string; memberId: string | null; memberName: string | null; reason: string }[]
    paidNotRecorded: { row: BoardRow; memberId: string; memberName: string | null; reason: string }[]
    /** `candidates`: the accounts a shared number (or a similar name) points at — the Owner picks one (PR-04). */
    unmatched: { row: BoardRow; note: string | null; candidates: CandidateMember[] }[]
    approvedNoCredit: {
      paymentId: string
      paymentRef: string
      memberId: string | null
      memberName: string | null
      amount: number
      approvedAt: string
      suggestion: { row: BoardRow; reason: string } | null
      /** Every likely credit, the closest first (PR-04). */
      suggestions: { row: BoardRow; reason: string }[]
    }[]
    /** Statement credits linked to an approved payment by the matching, with Undo (PR-04). */
    autoLinked: AutoLinkView[]
  }
  /** `duplicates`: the recorded credits each row may be the same money as (PR-04). */
  unclear: (BoardRow & { duplicates: DuplicateCredit[] })[]
  /** Member pictures by id (PR-04): the default + No photo tag when none. */
  avatars: Record<string, { src: string | null; gender: string | null }>
  /** PR-11: members erased on request (id → erased_at) — grey "Deleted user" rows. */
  erased: Record<string, string>
}

export async function loadStatementBoard(): Promise<StatementBoard | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const refreshed = await refreshWithRun().catch(() => null)
  const run = refreshed?.run ?? null
  const [imports, rows] = await Promise.all([
    admin.from('bank_statement_imports').select('*').order('created_at', { ascending: false }).limit(20),
    pageAll<RowRecord & { tran_type: string | null; contra_account: string | null; class_prev: string | null; personal_note: string | null; account_last4: string | null }>((f, t) =>
      admin
        .from('bank_statement_rows')
        .select(`${ROW_COLUMNS}, tran_type, contra_account, class_prev, personal_note, account_last4`)
        .order('tran_date', { ascending: false })
        .order('id')
        .range(f, t),
    ),
  ])
  const view = (r: (typeof rows)[number]): BoardRow => ({
    id: r.id,
    date: String(r.tran_date).slice(0, 10),
    time: r.tran_time ? String(r.tran_time).slice(0, 5) : null,
    type: r.tran_type,
    // The description can carry a full account number: shown masked.
    description: maskDigits(r.description ?? ''),
    deposit: Number(r.deposit),
    withdrawal: Number(r.withdrawal),
    sender: r.sender_name,
    account: masked(r.account_last4 ?? r.contra_account ?? r.transfer_account_no),
    cls: r.class,
    clsAuto: r.class_auto,
    clsLabel: CLASS_LABEL[r.class],
    canUndoClass: !!r.class_prev,
    transferId: r.transfer_id,
    transferHow: r.transfer_how,
    personalAt: r.personal_at,
    personalNote: r.personal_note,
    suggestPersonal: !r.personal_at && suggestPersonal({ deposit: Number(r.deposit), type: r.tran_type }, r.class),
  })
  const byId = new Map(rows.map((r) => [r.id, view(r)]))
  const rowByTransfer = new Map(rows.filter((r) => r.transfer_id).map((r) => [r.transfer_id!, r.id]))

  // The matches as this run worked them out (candidates and suggestions are
  // not stored); the stored columns when the run could not be made.
  const matches = new Map<string, CreditMatch>()
  if (run) for (const [k, v] of run.matches) matches.set(k, v)
  else
    for (const r of rows) {
      if (r.class !== 'fee' || !r.match_kind) continue
      const k = r.match_kind
      if (k === 'receipt' || k === 'approved') matches.set(r.id, { kind: k, paymentId: r.match_payment_id!, reason: (r.match_reason ?? '') as never })
      else if (k === 'member') matches.set(r.id, { kind: 'member', memberId: r.match_member_id!, reason: (r.match_reason ?? '') as never })
      else if (k === 'unmatched') matches.set(r.id, { kind: 'unmatched', note: r.match_note })
      else matches.set(r.id, { kind: 'settled' })
    }

  // Automatic statement links still standing.
  const autoLinks = await pageAll<{ transfer_id: string; target: string | null; created_at: string }>((f, t) =>
    admin.from('settlement_links').select('transfer_id, target, created_at').eq('kind', 'receipt').is('removed_at', null).like('note', `${STATEMENT_AUTO_NOTE}%`).order('id').range(f, t),
  )

  const paymentIds = [...new Set(rows.map((r) => r.match_payment_id).filter((v): v is string => !!v))]
  const board = await loadFeeBoard()
  const approvedPays = board ? board.receipts.filter((r) => r.state === 'waiting') : []
  const allPayIds = [...new Set([...paymentIds, ...approvedPays.map((r) => r.id), ...autoLinks.map((l) => l.target).filter((v): v is string => !!v), ...[...matches.values()].flatMap((m) => (m.kind === 'receipt' || m.kind === 'approved' ? [m.paymentId] : []))])]
  const pays = await pageAllIn<{ id: string; provider_ref: string | null; user_id: string | null }, string>(allPayIds, (part, f, t) =>
    admin.from('payments').select('id, provider_ref, user_id').in('id', part).order('id').range(f, t),
  )
  const payBy = new Map(pays.map((p) => [p.id, p]))
  const candidateIds = [...matches.values()].flatMap((m) => (m.kind === 'unmatched' ? (m.candidates ?? []) : []))
  const memberIds = [
    ...new Set(
      [...pays.map((p) => p.user_id), ...rows.map((r) => r.match_member_id), ...[...matches.values()].flatMap((m) => (m.kind === 'member' ? [m.memberId] : [])), ...candidateIds].filter(
        (v): v is string => !!v,
      ),
    ),
  ]
  const people = await pageAllIn<{ id: string; full_name: string | null; phone_number: string | null; whatsapp: string | null }, string>(memberIds, (part, f, t) =>
    admin.from('profiles').select('id, full_name, phone_number, whatsapp').in('id', part).order('id').range(f, t),
  )
  const nameBy = new Map(people.map((p) => [p.id, formatName(p.full_name ?? '') || 'Member']))
  const personBy = new Map(people.map((p) => [p.id, p]))

  const days = rows.map((r) => String(r.tran_date).slice(0, 10)).sort()
  const approvedIn: ApprovedBankPayment[] = approvedPays.map((r) => ({
    id: r.id,
    memberId: r.memberId ?? null,
    memberName: r.payerName,
    planCode: r.planCode ?? null,
    amount: r.amountPkr,
    approvedAt: r.reviewedAt ?? `${r.approvedDay}T12:00:00+05:00`,
    createdAt: r.createdAt ?? null,
    hasCredit: false,
  }))
  const lists = resultLists(matches, approvedIn, { from: days[0] ?? null, to: days[days.length - 1] ?? null }, run?.pairing)
  const avatars = await loadAvatarFacts([...memberIds, ...approvedIn.map((a) => a.memberId)])
  const erased = await loadErasedAt([...memberIds, ...approvedIn.map((a) => a.memberId)])
  const ref = (id: string) => String(payBy.get(id)?.provider_ref ?? id.slice(0, 8))
  const member = (id: string) => payBy.get(id)?.user_id ?? null

  // "Check: possibly already recorded": the recorded credits each row may duplicate.
  const unclearRows = rows.filter((r) => r.transfer_how === 'unclear' && !r.transfer_id)
  let recorded: RecordedCredit[] = []
  if (unclearRows.length) {
    const ud = unclearRows.map((r) => String(r.tran_date).slice(0, 10)).sort()
    recorded = await loadRecorded(admin, ud[0], ud[ud.length - 1])
  }

  return {
    imports: ((imports.data ?? []) as Record<string, unknown>[]).map((i) => ({
      id: String(i.id),
      createdAt: String(i.created_at),
      filename: (i.filename as string | null) ?? null,
      byName: (i.uploaded_by_name as string | null) ?? null,
      periodFrom: (i.period_from as string | null) ?? null,
      periodTo: (i.period_to as string | null) ?? null,
      rowsNew: Number(i.rows_new) || 0,
      rowsDuplicate: Number(i.rows_duplicate) || 0,
      totalCredits: Number(i.total_credits) || 0,
      totalDebits: Number(i.total_debits) || 0,
      closingFile: i.closing_balance_file == null ? null : Number(i.closing_balance_file),
      closingComputed: i.closing_balance_computed == null ? null : Number(i.closing_balance_computed),
      added: Number(i.credits_added) || 0,
      linked: Number(i.credits_linked) || 0,
      unclear: Number(i.credits_unclear) || 0,
    })),
    rows: rows.map((r) => byId.get(r.id)!),
    lists: {
      bankMatched: lists.bankMatched.map((m) => ({ row: byId.get(m.rowId)!, paymentId: m.paymentId, paymentRef: ref(m.paymentId), memberId: member(m.paymentId), memberName: member(m.paymentId) ? (nameBy.get(member(m.paymentId)!) ?? null) : null, reason: m.reason })),
      paidNotRecorded: lists.paidNotRecorded.map((m) => ({ row: byId.get(m.rowId)!, memberId: m.memberId, memberName: nameBy.get(m.memberId) ?? null, reason: m.reason })),
      unmatched: lists.unmatched.map((m) => ({
        row: byId.get(m.rowId)!,
        note: m.note,
        candidates: m.candidates.map((id) => {
          const p = personBy.get(id)
          return { id, name: nameBy.get(id) ?? 'Member', mobile: maskPhoneDisplay(p?.phone_number ?? p?.whatsapp ?? null) }
        }),
      })),
      approvedNoCredit: lists.approvedNoCredit.map((a) => {
        const p = approvedIn.find((x) => x.id === a.paymentId)!
        const sugg = a.suggestions.filter((s) => byId.has(s.rowId)).map((s) => ({ row: byId.get(s.rowId)!, reason: s.reason }))
        return {
          paymentId: a.paymentId,
          paymentRef: ref(a.paymentId),
          memberId: p.memberId,
          memberName: p.memberId ? (nameBy.get(p.memberId) ?? p.memberName) : p.memberName,
          amount: p.amount,
          approvedAt: p.approvedAt,
          suggestion: sugg[0] ?? null,
          suggestions: sugg,
        }
      }),
      autoLinked: autoLinks
        .filter((l) => l.target && rowByTransfer.has(l.transfer_id))
        .map((l) => {
          const rowId = rowByTransfer.get(l.transfer_id)!
          const pid = l.target!
          return { row: byId.get(rowId)!, paymentId: pid, paymentRef: ref(pid), memberId: member(pid), memberName: member(pid) ? (nameBy.get(member(pid)!) ?? null) : null, linkedAt: l.created_at }
        })
        .sort((a, b) => b.linkedAt.localeCompare(a.linkedAt)),
    },
    avatars,
    erased,
    unclear: unclearRows.map((r) => {
      const v = byId.get(r.id)!
      const dups = possibleDuplicates({ deposit: Number(r.deposit), date: v.date, time: v.time, sender: r.sender_name }, recorded)
      return { ...v, duplicates: dups.map((d) => ({ id: d.id, date: d.date, time: d.time, amount: d.amountPkr, sender: d.senderName, source: d.source })) }
    }),
  }
}


/** Every run of 6+ digits in a description, masked to its last 4. */
export function maskDigits(s: string): string {
  return s.replace(/\d{6,}/g, (m) => `••••${m.slice(-4)}`)
}

// ===========================================================================
// Owner actions

async function loadRow(admin: Admin, id: string) {
  const { data } = await admin
    .from('bank_statement_rows')
    .select('id, class, class_prev, class_gateway_prev, transfer_id, deposit, withdrawal, tran_date, personal_at, personal_note, transfer_account_no, contra_account, description')
    .eq('id', id)
    .maybeSingle()
  return data as {
    id: string
    class: StatementClass
    class_prev: StatementClass | null
    class_gateway_prev: string | null
    transfer_id: string | null
    deposit: number
    withdrawal: number
    tran_date: string
    personal_at: string | null
    personal_note: string | null
    transfer_account_no: string | null
    contra_account: string | null
    description: string | null
  } | null
}

export async function reclassifyRow(rowId: string, to: StatementClass, actor: Actor): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const row = await loadRow(admin, rowId)
  if (!row) return { ok: false, status: 404, error: 'That statement row was not found.' }
  if (row.class === to) return { ok: false, status: 409, error: 'It already has that type.' }
  const isCredit = Number(row.deposit) > 0
  if (isCredit && to === 'debit') return { ok: false, status: 400, error: 'A credit cannot be a withdrawal.' }
  if (!isCredit && to !== 'debit') return { ok: false, status: 400, error: 'A withdrawal cannot be a credit.' }
  let gatewayPrev: string | null = null
  if (row.transfer_id) {
    const { data: t } = await admin.from('bank_transfers').select('gateway').eq('id', row.transfer_id).maybeSingle()
    gatewayPrev = (t?.gateway as string | null) ?? null
    const gateway = to === 'paypro' ? 'paypro' : 'manual'
    if (gatewayPrev !== gateway) await admin.from('bank_transfers').update({ gateway }).eq('id', row.transfer_id)
  }
  const { error } = await admin
    .from('bank_statement_rows')
    .update({ class: to, class_prev: row.class, class_gateway_prev: gatewayPrev, class_changed_at: new Date().toISOString(), class_changed_by: actor.id })
    .eq('id', rowId)
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email ?? null,
    action: 'settlement.statement_reclassify', targetType: 'bank_statement_row', targetId: rowId,
    detail: { from: row.class, to, date: row.tran_date, amountPkr: Number(row.deposit) || Number(row.withdrawal) },
  })
  await refreshStatementMatches().catch(() => null)
  return { ok: true }
}

export async function undoReclassifyRow(rowId: string, actor: Actor): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const row = await loadRow(admin, rowId)
  if (!row) return { ok: false, status: 404, error: 'That statement row was not found.' }
  if (!row.class_prev) return { ok: false, status: 409, error: 'There is no change to undo.' }
  if (row.transfer_id && row.class_gateway_prev) await admin.from('bank_transfers').update({ gateway: row.class_gateway_prev }).eq('id', row.transfer_id)
  const { error } = await admin
    .from('bank_statement_rows')
    .update({ class: row.class_prev, class_prev: null, class_gateway_prev: null, class_changed_at: new Date().toISOString(), class_changed_by: actor.id })
    .eq('id', rowId)
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email ?? null,
    action: 'settlement.statement_reclassify_undo', targetType: 'bank_statement_row', targetId: rowId,
    detail: { from: row.class, to: row.class_prev },
  })
  await refreshStatementMatches().catch(() => null)
  return { ok: true }
}

export async function markRowPersonal(rowId: string, note: string, actor: Actor): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const row = await loadRow(admin, rowId)
  if (!row) return { ok: false, status: 404, error: 'That statement row was not found.' }
  if (row.personal_at) return { ok: false, status: 409, error: 'This entry is already marked as personal.' }
  const n = note.trim()
  if (n.length < 3) return { ok: false, status: 400, error: 'Add a short note.' }
  if (n.length > 500) return { ok: false, status: 400, error: 'Keep the note under 500 characters.' }
  if (row.transfer_id) {
    const r = await markPersonal({ transferId: row.transfer_id, note: n }, actor)
    if (!r.ok && r.status !== 409) return r
  }
  const { error } = await admin
    .from('bank_statement_rows')
    .update({ personal_at: new Date().toISOString(), personal_by: actor.id, personal_by_name: await nameOf(admin, actor.id), personal_note: n })
    .eq('id', rowId)
    .is('personal_at', null)
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email ?? null,
    action: 'settlement.statement_personal', targetType: 'bank_statement_row', targetId: rowId,
    detail: { amountPkr: Number(row.deposit) || Number(row.withdrawal), date: row.tran_date, note: n, bankCredit: !!row.transfer_id },
  })
  return { ok: true }
}

export async function undoRowPersonal(rowId: string, actor: Actor): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const row = await loadRow(admin, rowId)
  if (!row) return { ok: false, status: 404, error: 'That statement row was not found.' }
  if (!row.personal_at) return { ok: false, status: 409, error: 'This entry is not marked as personal.' }
  if (row.transfer_id) {
    const r = await undoPersonal({ transferId: row.transfer_id }, actor)
    if (!r.ok && r.status !== 409) return r
  }
  const { error } = await admin
    .from('bank_statement_rows')
    .update({ personal_at: null, personal_undone_at: new Date().toISOString(), personal_undone_by: actor.id })
    .eq('id', rowId)
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email ?? null,
    action: 'settlement.statement_personal_undo', targetType: 'bank_statement_row', targetId: rowId,
    detail: { amountPkr: Number(row.deposit) || Number(row.withdrawal), date: row.tran_date, earlierNote: row.personal_note },
  })
  return { ok: true }
}

/** The full account / mobile number of one row, for the Owner. Logged (field only). */
export async function revealRowAccount(rowId: string, actor: Actor): Promise<Result<{ value: string | null }>> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const row = await loadRow(admin, rowId)
  if (!row) return { ok: false, status: 404, error: 'That statement row was not found.' }
  await logAdminAction({
    actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email ?? null,
    action: 'settlement.statement_reveal', targetType: 'bank_statement_row', targetId: rowId,
    detail: { field: 'account' },
  })
  return { ok: true, value: row.transfer_account_no ?? row.contra_account ?? null }
}

/** An unclear credit: add it as a new bank credit, or say it is a recorded one. */
export async function resolveUnclearRow(rowId: string, choice: { kind: 'new' } | { kind: 'same'; transferId: string }, actor: Actor): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data } = await admin
    .from('bank_statement_rows')
    .select('id, transfer_id, transfer_how, tran_date, tran_time, deposit, withdrawal, description, reference, stan, transfer_account_no, transfer_account_title, class, tran_type, serial_no, tran_seq_no')
    .eq('id', rowId)
    .maybeSingle()
  if (!data) return { ok: false, status: 404, error: 'That statement row was not found.' }
  if (data.transfer_id) return { ok: false, status: 409, error: 'This row already has a bank credit.' }
  if (!(Number(data.deposit) > 0)) return { ok: false, status: 400, error: 'Only a credit can be added.' }
  if (choice.kind === 'same') {
    const { data: t } = await admin.from('bank_transfers').select('id, statement_row_id').eq('id', choice.transferId).maybeSingle()
    if (!t) return { ok: false, status: 404, error: 'That bank credit was not found.' }
    if (t.statement_row_id) return { ok: false, status: 409, error: 'That bank credit already belongs to another statement row.' }
    await admin.from('bank_transfers').update({ statement_row_id: rowId }).eq('id', choice.transferId)
    await admin.from('bank_statement_rows').update({ transfer_id: choice.transferId, transfer_how: 'linked' }).eq('id', rowId)
  } else {
    const row: StatementRow = {
      serialNo: data.serial_no as number | null,
      seqNo: String(data.tran_seq_no),
      date: String(data.tran_date).slice(0, 10),
      effectDate: null,
      time: data.tran_time ? String(data.tran_time).slice(0, 5) : null,
      type: data.tran_type as string | null,
      description: String(data.description ?? ''),
      stan: data.stan as string | null,
      debitCredit: 'C',
      reference: data.reference as string | null,
      withdrawal: 0,
      deposit: Number(data.deposit),
      balance: null,
      refBank: null,
      timeStamp: null,
      transferAccountNo: data.transfer_account_no as string | null,
      transferAccountTitle: data.transfer_account_title as string | null,
    }
    const id = await addTransferFor(admin, rowId, row, data.class as StatementClass, actor)
    if (!id) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
    await autoLinkNewCredits([id], actor)
  }
  await logAdminAction({
    actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email ?? null,
    action: 'settlement.statement_resolve', targetType: 'bank_statement_row', targetId: rowId,
    detail: { choice: choice.kind, date: String(data.tran_date), amountPkr: Number(data.deposit) },
  })
  await refreshStatementMatches().catch(() => null)
  return { ok: true }
}

// ===========================================================================
// PR-04 actions — Owner only (the route checks), audited, nothing deleted.

/** "Link": a statement credit to an approved bank payment with no credit. */
export async function linkRowToApproved(rowId: string, paymentId: string, actor: Actor): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data: row } = await admin.from('bank_statement_rows').select('id, transfer_id, personal_at').eq('id', rowId).maybeSingle()
  if (!row) return { ok: false, status: 404, error: 'That statement row was not found.' }
  if (row.personal_at) return { ok: false, status: 409, error: 'This entry is marked personal.' }
  if (!row.transfer_id) return { ok: false, status: 409, error: 'This row has no bank credit yet. Decide "Same money" or "Add as a new credit" first.' }
  const r = await linkStatementCredit({ transferId: row.transfer_id as string, paymentId, auto: false }, actor)
  if (!r.ok) return r
  await refreshStatementMatches().catch(() => null)
  return { ok: true }
}

/** Undo a statement link (automatic or the Owner's). The link is stamped
 *  removed, and the row is never linked automatically again. */
export async function unlinkRow(rowId: string, actor: Actor): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data: row } = await admin.from('bank_statement_rows').select('id, transfer_id, deposit, tran_date').eq('id', rowId).maybeSingle()
  if (!row?.transfer_id) return { ok: false, status: 404, error: 'That statement row has no bank credit.' }
  const { data: links } = await admin.from('settlement_links').select('id, target').eq('transfer_id', row.transfer_id).eq('kind', 'receipt').is('removed_at', null)
  if (!(links ?? []).length) return { ok: false, status: 409, error: 'This credit is not linked to a payment.' }
  if (!(await clearLinks(row.transfer_id as string, actor))) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await admin.from('bank_statement_rows').update({ auto_link_undone_at: new Date().toISOString(), auto_link_undone_by: actor.id }).eq('id', rowId)
  await logAdminAction({
    actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email ?? null,
    action: 'settlement.statement_link_undo', targetType: 'bank_statement_row', targetId: rowId,
    detail: { paymentIds: (links ?? []).map((l) => l.target), date: row.tran_date, amountPkr: Number(row.deposit) },
  })
  await refreshStatementMatches().catch(() => null)
  return { ok: true }
}

/** "Same money — link": the statement row IS a credit already recorded. No
 *  new money: the row points at the existing credit. Only a recorded credit of
 *  the same amount, not tied to another statement row, may be chosen. */
export async function sameMoneyRow(rowId: string, transferId: string, actor: Actor): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data: row } = await admin.from('bank_statement_rows').select('id, transfer_id, deposit').eq('id', rowId).maybeSingle()
  if (!row) return { ok: false, status: 404, error: 'That statement row was not found.' }
  if (row.transfer_id) return { ok: false, status: 409, error: 'This row already has a bank credit.' }
  const { data: t } = await admin.from('bank_transfers').select('id, amount_pkr, statement_row_id').eq('id', transferId).maybeSingle()
  if (!t) return { ok: false, status: 404, error: 'That bank credit was not found.' }
  if (Math.abs(Number(t.amount_pkr) - Number(row.deposit)) > 0.005) return { ok: false, status: 409, error: 'That recorded credit is a different amount.' }
  return resolveUnclearRow(rowId, { kind: 'same', transferId }, actor)
}

/** Undo "Same money — link": the row goes back to "possibly already recorded". */
export async function undoSameMoneyRow(rowId: string, actor: Actor): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data: row } = await admin.from('bank_statement_rows').select('id, transfer_id, transfer_how').eq('id', rowId).maybeSingle()
  if (!row?.transfer_id || row.transfer_how !== 'linked') return { ok: false, status: 409, error: 'There is no "Same money" link to undo.' }
  await admin.from('bank_transfers').update({ statement_row_id: null }).eq('id', row.transfer_id).eq('statement_row_id', rowId)
  await admin.from('bank_statement_rows').update({ transfer_id: null, transfer_how: 'unclear' }).eq('id', rowId)
  await logAdminAction({
    actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email ?? null,
    action: 'settlement.statement_same_undo', targetType: 'bank_statement_row', targetId: rowId,
    detail: { transferId: row.transfer_id },
  })
  await refreshStatementMatches().catch(() => null)
  return { ok: true }
}

/** "Assign to a member" on a fee row with no bank credit (and not waiting
 *  under "possibly already recorded"): the bank credit is made first. */
export async function ensureRowCredit(rowId: string, actor: Actor): Promise<Result<{ transferId: string }>> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data } = await admin.from('bank_statement_rows').select('id, transfer_id, transfer_how, deposit').eq('id', rowId).maybeSingle()
  if (!data) return { ok: false, status: 404, error: 'That statement row was not found.' }
  if (data.transfer_id) return { ok: true, transferId: String(data.transfer_id) }
  if (data.transfer_how === 'unclear') return { ok: false, status: 409, error: 'This row may be money already recorded. Decide "Same money" or "Add as a new credit" first.' }
  if (!(Number(data.deposit) > 0)) return { ok: false, status: 400, error: 'Only a credit can be assigned.' }
  const r = await resolveUnclearRow(rowId, { kind: 'new' }, actor)
  if (!r.ok) return r
  const { data: after } = await admin.from('bank_statement_rows').select('transfer_id').eq('id', rowId).maybeSingle()
  return after?.transfer_id ? { ok: true, transferId: String(after.transfer_id) } : { ok: false, status: 500, error: 'That did not save. Please try again.' }
}

/** The statement list counts, READ ONLY (PR-04 report): the same matching as
 *  the page, with no automatic link and nothing stored. Counts only. */
export async function statementListCounts(): Promise<{ bankMatched: number; paidNotRecorded: number; unmatched: number; possiblyRecorded: number; approvedNoCredit: number; linkedAutomatically: number } | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const rows = await loadRows(admin)
  const run = await runMatches(admin, rows, { autoLink: false })
  if (!run) return null
  const board = await loadFeeBoard()
  const approvedIn: ApprovedBankPayment[] = (board?.receipts ?? [])
    .filter((r) => r.state === 'waiting')
    .map((r) => ({ id: r.id, memberId: r.memberId ?? null, memberName: r.payerName, planCode: r.planCode ?? null, amount: r.amountPkr, approvedAt: r.reviewedAt ?? `${r.approvedDay}T12:00:00+05:00`, createdAt: r.createdAt ?? null, hasCredit: false }))
  const days = rows.map((r) => String(r.tran_date).slice(0, 10)).sort()
  const lists = resultLists(run.matches, approvedIn, { from: days[0] ?? null, to: days[days.length - 1] ?? null }, run.pairing)
  const { count } = await admin.from('settlement_links').select('id', { count: 'exact', head: true }).eq('kind', 'receipt').is('removed_at', null).like('note', `${STATEMENT_AUTO_NOTE}%`)
  return {
    bankMatched: lists.bankMatched.length,
    paidNotRecorded: lists.paidNotRecorded.length,
    unmatched: lists.unmatched.length,
    possiblyRecorded: rows.filter((r) => r.transfer_how === 'unclear' && !r.transfer_id).length,
    approvedNoCredit: lists.approvedNoCredit.length,
    linkedAutomatically: count ?? 0,
  }
}
