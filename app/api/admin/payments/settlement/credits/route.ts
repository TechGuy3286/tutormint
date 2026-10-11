import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { addBankCredits, recordedReferences } from '@/lib/settlementMatch'
import { parseBody, rupees, z } from '@/lib/validate'

// Settlements → "Add bank credit" (owner, 11 Oct 2026). OWNER ONLY — the gate of
// Admin → Finance (SCREEN_ACCESS.finance = []); the view-only Partner is refused
// by checkAdminRole on POST, every other staff role gets 403, signed out 401.
//
//   POST { credits: [...] }   save one or more credits (a paste of bank alerts,
//                             or one typed by hand). A reference that is already
//                             recorded is skipped, never saved twice. The answer
//                             lists, per credit, saved + what it matched, or why
//                             it was not saved. A single refused credit answers
//                             409 (duplicate) or 400.
//   GET  ?refs=a,b            which of these references are already recorded.
//
// Only the read fields arrive here — the pasted alert text stays in the browser,
// so no receiver or full sender account number is ever sent or stored.
// Audit-logged in lib/settlementMatch.

export const runtime = 'nodejs'

const optionalText = (max: number) =>
  z
    .string()
    .max(max, 'That is too long.')
    .optional()
    .nullable()
    .transform((s) => (s && s.trim() ? s.trim() : null))

const Credit = z.object({
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

const Body = z.object({ credits: z.array(Credit).min(1, 'There is nothing to save.').max(50, 'Save at most 50 credits at a time.') })

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const refs = (new URL(request.url).searchParams.get('refs') ?? '')
    .split(',')
    .map((r) => r.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 100)
  return NextResponse.json({ recorded: refs.length > 0 ? await recordedReferences(refs) : [] }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const results = await addBankCredits(parsed.data.credits, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email })
  const only = results.length === 1 ? results[0] : null
  if (only && !only.ok) return NextResponse.json({ error: only.error, results }, { status: only.duplicate ? 409 : 400 })
  return NextResponse.json({ ok: true, results })
}
