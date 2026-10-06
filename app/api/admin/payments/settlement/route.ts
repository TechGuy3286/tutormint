import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { requireFreshAuth } from '@/lib/reauth'
import { importBankCsv, importPayproFile, recordTransfer } from '@/lib/reconciliation'
import { addDeduction, removeDeduction } from '@/lib/settlement'
import { parseBody, rupees, z } from '@/lib/validate'

// Settlement check writes (owner, 6 Oct 2026). OWNER ONLY — the same gate as
// the Payment gateways screen (SCREEN_ACCESS.paymentGateways = []), so an
// admin or any staff role gets 403 here whatever a screen shows.
//
//   multipart/form-data  file + kind ('gateway' = the gateway's own export —
//                        for PayPro the Orders .xlsx/.csv; 'bank' = a bank
//                        statement csv) + gateway
//   application/json     { action: 'transfer' | 'add_deduction' | 'remove_deduction', … }
//
// Nothing here changes a payment's status. Every write is audit-logged in
// lib/reconciliation and lib/settlement.

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES = 8 * 1024 * 1024
const GATEWAYS = ['paypro'] as const

const optionalNumber = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((v) => {
    if (v === null || v === undefined || String(v).trim() === '') return null
    const n = Number(String(v).replace(/[,%\s]/g, ''))
    return Number.isFinite(n) ? n : NaN
  })
  .refine((n) => n === null || !Number.isNaN(n), { message: 'Enter a number, like 2.5.' })

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('transfer'),
    gateway: z.enum(GATEWAYS),
    transferredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the transfer date.'),
    amountPkr: rupees.refine((n) => n > 0, { message: 'Enter the amount received, like 1500.' }),
    reference: z.string().max(300, 'That reference is too long.').optional().nullable(),
    accountLast4: z
      .string()
      .transform((s) => s.replace(/\D/g, ''))
      .refine((s) => s === '' || s.length === 4, { message: 'Enter the last 4 digits of the account, like 4821.' })
      .optional()
      .nullable(),
  }),
  z.object({
    action: z.literal('add_deduction'),
    gateway: z.enum(GATEWAYS),
    name: z.string().max(80, 'Keep the name under 80 characters.'),
    percent: optionalNumber,
    fixedPkr: optionalNumber,
    effectiveFrom: z.string(),
  }),
  z.object({
    action: z.literal('remove_deduction'),
    gateway: z.enum(GATEWAYS),
    id: z.guid(),
  }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.paymentGateways)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const actor = { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email }

  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return NextResponse.json({ error: 'We could not read that upload. Please try again.' }, { status: 400 })
    }
    const gateway = String(form.get('gateway') ?? 'paypro')
    if (!(GATEWAYS as readonly string[]).includes(gateway)) {
      return NextResponse.json({ error: 'That gateway is not connected.' }, { status: 400 })
    }
    const kind = String(form.get('kind') ?? '')
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'That file is larger than 8 MB. Export one month at a time.' }, { status: 400 })
    }
    const name = file.name.toLowerCase()
    if (kind === 'bank') {
      if (!name.endsWith('.csv') && !name.endsWith('.txt')) {
        return NextResponse.json({ error: 'Upload the bank statement as a CSV.' }, { status: 400 })
      }
      const result = await importBankCsv(Buffer.from(await file.arrayBuffer()).toString('utf8'), file.name, actor, gateway)
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
      return NextResponse.json({ ok: true, added: result.added, skipped: result.skipped })
    }
    if (kind !== 'gateway') return NextResponse.json({ error: 'Unknown upload.' }, { status: 400 })
    if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm') && !name.endsWith('.csv')) {
      return NextResponse.json({ error: 'Upload the PayPro Orders export as .xlsx or .csv.' }, { status: 400 })
    }
    const result = await importPayproFile(Buffer.from(await file.arrayBuffer()), file.name, actor, gateway)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, rowCount: result.rowCount })
  }

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  if (body.action === 'transfer') {
    const result = await recordTransfer(
      {
        transferredOn: body.transferredOn,
        amountPkr: body.amountPkr,
        reference: body.reference ? body.reference.trim() || null : null,
        accountLast4: body.accountLast4 ? body.accountLast4 : null,
      },
      actor,
      body.gateway,
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json({ ok: true, id: result.id })
  }

  // Deduction lines change what "expected in bank" means — ask for the password
  // again when it is stale, the same as the other owner payment settings.
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  if (body.action === 'add_deduction') {
    const result = await addDeduction(
      body.gateway,
      { name: body.name, percent: body.percent, fixedPkr: body.fixedPkr, effectiveFrom: body.effectiveFrom },
      actor,
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, id: result.id })
  }

  const result = await removeDeduction(body.gateway, body.id, actor)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
