import { NextResponse } from 'next/server'

import { cronAuthorised } from '@/lib/internalAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { linkCreditToMember } from '@/lib/bankPaymentLink'

// POST /api/internal/link-ayaz-bank-credit — the one-time fix of 21 Oct 2026,
// done on the Owner's instruction, driven by scripts/dataop-link-ayaz-bank-credit.ts.
// CRON_SECRET-protected.
//
// Ayaz Hussain paid the Rs 199 Verification Fee by Raast (bank ref 261838203082,
// 20 Oct 2026) with no receipt; the Owner granted the fee by hand. The automatic
// same-amount rule then matched his bank credit to ANOTHER tutor's bank receipt
// approved on 18 Oct (TM-MVCYYLHV-ED2EEA6E1C85, Saleem Khan), so Ayaz had no
// payment and the credit looked settled.
//
// This links that ONE credit to that ONE member through the same path as
// Finance → "Link to member" (lib/bankPaymentLink.ts): an approved bank-transfer
// payment dated with the credit, attached to the manual grant (nothing granted
// again), the receipt email, Ayaz's open PayPro checkout closed "Paid by another
// method", and an audit row as the Owner with a note naming this fix. Nothing
// is fixed here but these two ids; nothing is deleted. `apply: false` (the
// default) returns the decision and changes nothing. A second run is refused
// (the fee is then paid and the credit matched by hand).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CREDIT_ID = 'c1513148-5452-4b3e-9a5d-daf4909f7ea0'
const MEMBER_ID = '58346e9e-7a03-45c2-b3af-cec96ee3c5e1'
const NOTE = "Done by the 21 Oct 2026 PR on the Owner's instruction: Ayaz Hussain's Raast credit (ref 261838203082) had been matched automatically to another tutor's receipt."

export async function POST(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { apply?: boolean }
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'not configured' }, { status: 503 })

  const { data: owner } = await admin.from('profiles').select('id, email').eq('role', 'admin').eq('admin_role', 'owner').limit(2)
  if (!owner || owner.length !== 1) return NextResponse.json({ error: 'expected exactly one Owner account' }, { status: 409 })

  const result = await linkCreditToMember(
    { transferId: CREDIT_ID, memberId: MEMBER_ID, planCode: 'verified', amountPkr: 199 },
    { id: owner[0].id as string, adminRole: 'owner', email: (owner[0].email as string | null) ?? null },
    { auditNote: NOTE, dryRun: body.apply !== true },
  )
  return NextResponse.json(result, { status: result.ok ? 200 : result.status })
}
