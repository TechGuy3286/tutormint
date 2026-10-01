import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { requireFreshAuth } from '@/lib/reauth'
import { SETTING_KEYS } from '@/lib/payments/manual'

// Save the bank-transfer details members are told to pay into (PR98 §4).
//
// owner + admin only (SCREEN_ACCESS.paymentsSettings), fresh password required.
// Text fields land in app_settings (the pay.* keys lib/payments/manual reads);
// an optional QR image goes to the PRIVATE payment-proofs bucket and only its
// storage path is stored, never a URL — it is served solely through the gated
// /api/payments/bank-qr route. The audit row records WHICH fields changed, never
// their values (an account number is a bank detail, kept out of the log).

export const runtime = 'nodejs'

const MAX_QR_BYTES = 4 * 1024 * 1024
const TEXT_FIELDS: { field: string; key: string }[] = [
  { field: 'accountTitle', key: SETTING_KEYS.accountTitle },
  { field: 'bankName', key: SETTING_KEYS.bankName },
  { field: 'bankBranch', key: SETTING_KEYS.bankBranch },
  { field: 'accountNumber', key: SETTING_KEYS.accountNumber },
  { field: 'iban', key: SETTING_KEYS.iban },
]

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.paymentsSettings)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid submission.' }, { status: 400 })
  }

  const changed: string[] = []
  const rows: { key: string; value: string }[] = []
  for (const { field, key } of TEXT_FIELDS) {
    const value = String(form.get(field) ?? '').trim()
    rows.push({ key, value })
    changed.push(field)
  }

  // Optional QR: upload a new one, or clear it. Stored privately; path only.
  const removeQr = String(form.get('removeQr') ?? '') === '1'
  const file = form.get('qr')
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_QR_BYTES) {
      return NextResponse.json({ error: 'That image is larger than 4 MB.' }, { status: 400 })
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'The QR must be an image.' }, { status: 400 })
    }
    const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
    const path = `bank-qr/qr.${ext}`
    const { error: upErr } = await admin.storage
      .from('payment-proofs')
      .upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, upsert: true })
    if (upErr) return NextResponse.json({ error: 'Could not store the QR image.' }, { status: 400 })
    rows.push({ key: SETTING_KEYS.qrPath, value: path })
    changed.push('qr')
  } else if (removeQr) {
    rows.push({ key: SETTING_KEYS.qrPath, value: '' })
    changed.push('qr:cleared')
  }

  const { error } = await admin.from('app_settings').upsert(rows, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: 'Could not save the details.' }, { status: 400 })

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'payments.bank_details',
    targetType: 'app_settings',
    targetId: 'pay',
    // Field NAMES only — never the account number or IBAN values.
    detail: { fields: changed },
  })

  return NextResponse.json({ ok: true })
}
