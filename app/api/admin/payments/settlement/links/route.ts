import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { setCreditLinks } from '@/lib/settlementMatch'
import { parseBody, z } from '@/lib/validate'

// Settlements → link or unlink a bank credit by hand (owner, 11 Oct 2026).
// OWNER ONLY (SCREEN_ACCESS.finance = []); the Partner is refused by
// checkAdminRole.
//   link    this credit pays exactly these orders / approved bank transfers
//   unlink  leave this credit unmatched
//   auto    forget the manual decision; match automatically again
// A note is required for link and unlink. Audit-logged in lib/settlementMatch.

export const runtime = 'nodejs'

const Body = z.object({
  transferId: z.guid(),
  action: z.enum(['link', 'unlink', 'auto']),
  orders: z.array(z.string().max(120)).max(200).optional(),
  receipts: z.array(z.guid()).max(200).optional(),
  note: z.string().max(500, 'Keep the note under 500 characters.').optional().nullable(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const result = await setCreditLinks(parsed.data, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
