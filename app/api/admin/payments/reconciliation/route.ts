import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { importBankCsv, importPayproFile, recordTransfer } from '@/lib/reconciliation'
import { parseBody, rupees, z } from '@/lib/validate'

// PayPro reconciliation writes (owner, 6 Oct 2026). owner + admin only.
//
// Two request shapes on one route:
//   multipart/form-data  file + kind ('paypro' = the Orders export, xlsx or csv;
//                        'bank' = a bank statement csv)
//   application/json     { action: 'transfer', transferredOn, amountPkr,
//                          reference, accountLast4 } — one transfer typed by hand
//
// Nothing here changes a payment's status; the screen reports and a person
// decides in the payments queue. Every write is audit-logged in lib/reconciliation.

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES = 8 * 1024 * 1024

const TransferBody = z.object({
  action: z.literal('transfer', { message: 'Unknown action.' }),
  transferredOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the transfer date.'),
  amountPkr: rupees.refine((n) => n > 0, { message: 'Enter the amount received, like 1500.' }),
  reference: z.string().max(300, 'That reference is too long.').optional().nullable(),
  accountLast4: z
    .string()
    .transform((s) => s.replace(/\D/g, ''))
    .refine((s) => s === '' || s.length === 4, {
      message: 'Enter the last 4 digits of the account, like 4821.\nاکاؤنٹ کے آخری 4 ہندسے درج کریں۔',
    })
    .optional()
    .nullable(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
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

    const kind = String(form.get('kind') ?? 'paypro')
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'Choose a file to upload.\nفائل منتخب کریں۔' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'That file is larger than 8 MB. Export one month at a time.' }, { status: 400 })
    }

    const name = file.name.toLowerCase()

    if (kind === 'bank') {
      if (!name.endsWith('.csv') && !name.endsWith('.txt')) {
        return NextResponse.json({ error: 'Upload the bank statement as a CSV.' }, { status: 400 })
      }
      const text = Buffer.from(await file.arrayBuffer()).toString('utf8')
      const result = await importBankCsv(text, file.name, actor)
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
      return NextResponse.json({ ok: true, added: result.added, skipped: result.skipped })
    }

    if (kind !== 'paypro') {
      return NextResponse.json({ error: 'Unknown upload kind.' }, { status: 400 })
    }
    if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm') && !name.endsWith('.csv')) {
      return NextResponse.json(
        { error: 'Upload the PayPro Orders export as .xlsx or .csv.\nپے پرو کی فائل .xlsx یا .csv میں اپ لوڈ کریں۔' },
        { status: 400 },
      )
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await importPayproFile(buffer, file.name, actor)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, importId: result.importId, rowCount: result.rowCount, sheet: result.sheet })
  }

  const parsed = await parseBody(request, TransferBody)
  if (!parsed.ok) return parsed.response
  const { transferredOn, amountPkr, reference, accountLast4 } = parsed.data

  const result = await recordTransfer(
    {
      transferredOn,
      amountPkr,
      reference: reference ? reference.trim() || null : null,
      accountLast4: accountLast4 ? accountLast4 : null,
    },
    actor,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ ok: true, id: result.id })
}
