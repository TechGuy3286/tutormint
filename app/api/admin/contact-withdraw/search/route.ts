import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { ownerContactGate } from '@/lib/contactWithdrawGate'
import { consentReport, searchContact } from '@/lib/contactWithdraw'
import { parseWithdrawNumber } from '@/lib/contactWithdrawCore'
import { parseBody, z } from '@/lib/validate'

// POST { phone } → every place that number is stored as contact data
// (lib/contactWithdraw searchContact). POST so the number never sits in a URL
// or a request log. The site Owner only (signed out 401, anyone else 403). The
// number comes back masked only.
//
// POST { report: true } → the consent report (counts per staff member).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({ phone: z.string().max(40).optional(), report: z.boolean().optional() })

export async function POST(request: Request) {
  const gate = await ownerContactGate(await checkAdminRole(...SCREEN_ACCESS.contactWithdraw), 'search for a phone number in Withdraw a contact')
  if (!gate.ok) return gate.response
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  if (parsed.data.report) return NextResponse.json({ report: await consentReport() })
  const msisdn = parseWithdrawNumber(parsed.data.phone)
  if (!msisdn) return NextResponse.json({ error: 'Enter a Pakistani mobile number, e.g. 0300 1234567.' }, { status: 400 })
  try {
    return NextResponse.json({ result: await searchContact(msisdn) })
  } catch {
    return NextResponse.json({ error: 'The search did not finish. Please try again.' }, { status: 503 })
  }
}
