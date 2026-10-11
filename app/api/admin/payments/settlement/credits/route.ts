import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { addBankCredit } from '@/lib/settlementMatch'
import { parseBody, rupees, z } from '@/lib/validate'

// Settlements → "Add bank credit" (owner, 11 Oct 2026). OWNER ONLY — the gate of
// Admin → Finance (SCREEN_ACCESS.finance = []); the view-only Partner is refused
// by checkAdminRole, every other staff role gets 403. A duplicate transaction
// reference is refused (409). Audit-logged in lib/settlementMatch.

export const runtime = 'nodejs'

const optionalText = (max: number) =>
  z
    .string()
    .max(max, 'That is too long.')
    .optional()
    .nullable()
    .transform((s) => (s && s.trim() ? s.trim() : null))

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date of the credit.'),
  time: z
    .string()
    .optional()
    .nullable()
    .transform((s) => (s && s.trim() ? s.trim().slice(0, 5) : null))
    .refine((s) => s === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(s), { message: 'Enter the time like 14:35, or leave it empty.' }),
  amountPkr: rupees.refine((n) => n > 0, { message: 'Enter the amount received, like 386.' }),
  senderName: optionalText(160),
  senderBank: optionalText(160),
  reference: z.string().trim().min(1, 'Enter the transaction reference from the bank alert.').max(120, 'That reference is too long.'),
  note: optionalText(500),
  isPaypro: z.boolean(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const result = await addBankCredit(parsed.data, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.duplicate ? 409 : 400 })
  return NextResponse.json({ ok: true, id: result.id })
}
