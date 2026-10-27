import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { resendDomainTracking } from '@/lib/email/send'

// GET /api/internal/email-tracking (owner, 27 Oct 2026). CRON_SECRET only.
// Read only: whether Resend has open tracking on for tutormint.org, and whether
// the webhook secret is set (opens reach us only through the webhook). Never
// returns a key or a secret.

export const dynamic = 'force-dynamic'

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : header
  const a = Buffer.from(secret, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const domain = await resendDomainTracking()
  return NextResponse.json({ domain, webhookSecretSet: !!process.env.RESEND_WEBHOOK_SECRET })
}
