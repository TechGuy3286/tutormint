import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { callerIp, rateLimit } from '@/lib/rateLimit'
import { CONTACT_FAILED, CONTACT_SENT, CONTACT_TOO_MANY, parseContact } from '@/lib/contactFormCore'
import { submitContactMessage } from '@/lib/contactForm'

// POST /api/contact { name, contact, message, website } — the public /contact
// form (owner, 24 Nov 2026 — PR-20 Part A). The message lands in the Team inbox
// and is emailed to support. Spam: the hidden "website" honeypot (a filled one
// is answered "sent" and dropped, nothing stored) and 5 messages an hour per IP.
// Nothing from the form is logged. A signed-in member is linked to the message.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Please fill in the form.' }, { status: 400 })
  }
  const parsed = parseContact(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  // A bot that filled the hidden field is told it worked and nothing happens.
  if (parsed.spam) return NextResponse.json({ ok: true, message: CONTACT_SENT })

  const limit = await rateLimit('contact_form', callerIp(request))
  if (!limit.allowed) return NextResponse.json({ error: CONTACT_TOO_MANY }, { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } })

  let memberId: string | null = null
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    memberId = data.user?.id ?? null
  } catch {
    memberId = null
  }

  const res = await submitContactMessage(parsed, memberId)
  if (!res.ok) return NextResponse.json({ error: CONTACT_FAILED }, { status: 503 })
  return NextResponse.json({ ok: true, message: CONTACT_SENT }, { headers: { 'cache-control': 'no-store' } })
}
