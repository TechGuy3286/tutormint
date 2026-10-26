import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { requireFreshAuth } from '@/lib/reauth'
import { SETTING_KEYS } from '@/lib/payments/manual'
import { alertOwner } from '@/lib/ownerAlerts'
import { changedFields } from '@/lib/ownerAlertCore'

// Save the bank-transfer details members are told to pay into (PR98 §4).
//
// OWNER ONLY (SCREEN_ACCESS.paymentGateways — owner, 11 Oct 2026: these details
// are shown to members on the payment choice screen), fresh password required.
// Text fields land in app_settings (the pay.* keys lib/payments/manual reads);
// an optional QR image goes to the PRIVATE payment-proofs bucket and only its
// storage path is stored, never a URL — it is served solely through the gated
// /api/payments/bank-qr route. The audit row records WHICH fields changed, never
// their values (an account number is a bank detail, kept out of the log).

export const runtime = 'nodejs'

const MAX_QR_BYTES = 4 * 1024 * 1024
const TEXT_FIELDS: { field: string; key: string; label: string }[] = [
  { field: 'accountTitle', key: SETTING_KEYS.accountTitle, label: 'Account title' },
  { field: 'bankName', key: SETTING_KEYS.bankName, label: 'Bank name' },
  { field: 'bankBranch', key: SETTING_KEYS.bankBranch, label: 'Branch' },
  { field: 'accountNumber', key: SETTING_KEYS.accountNumber, label: 'Account number' },
  { field: 'iban', key: SETTING_KEYS.iban, label: 'IBAN' },
  { field: 'raastId', key: SETTING_KEYS.raastId, label: 'Raast ID' },
]

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.paymentGateways)
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

  // What is saved now, so the audit log and the Owner alert can say before →
  // after. An account number or IBAN is only ever written as its last 4 digits.
  const { data: existing } = await admin.from('app_settings').select('key, value').in('key', TEXT_FIELDS.map((f) => f.key))
  const beforeValues: Record<string, string> = {}
  const afterValues: Record<string, string> = {}
  for (const f of TEXT_FIELDS) {
    beforeValues[f.field] = String((existing ?? []).find((r) => r.key === f.key)?.value ?? '')
  }

  const changed: string[] = []
  const rows: { key: string; value: string }[] = []
  for (const { field, key } of TEXT_FIELDS) {
    const value = String(form.get(field) ?? '').trim()
    rows.push({ key, value })
    changed.push(field)
    afterValues[field] = value
  }
  const changes = changedFields(TEXT_FIELDS, beforeValues, afterValues)

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
    // Before → after per changed field; an account number or IBAN is masked to
    // its last 4 digits (lib/ownerAlertCore), never written in full.
    detail: { fields: changed, changes },
  })

  const qrChange = changed.includes('qr') ? [{ label: 'QR image', before: '—', after: 'New image uploaded' }] : changed.includes('qr:cleared') ? [{ label: 'QR image', before: 'Set', after: 'Removed' }] : []
  await alertOwner({
    actor: gate.actor,
    area: 'Bank transfer details',
    changes: [...changes, ...qrChange],
    href: '/admin/payments/settings/gateways#bank-details',
  })

  return NextResponse.json({ ok: true })
}
