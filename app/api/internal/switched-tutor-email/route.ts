import { NextResponse } from 'next/server'

import { cronAuthorised } from '@/lib/internalAuth'
import { sendSwitchedTutorEmails } from '@/lib/switchedTutorEmail'
import { parseBody, z } from '@/lib/validate'

// POST /api/internal/switched-tutor-email — the one-time "You can now sign in
// to TutorMint" email to the email-only tutors switched on 13 Oct 2026, driven
// by scripts/send-switched-tutor-email.ts. CRON_SECRET-protected. It exists
// because the Resend key lives only in the production environment.
//
//   { dryRun: true }    counts who would be sent and who is skipped; writes and
//                       sends nothing.
//   { dryRun: false }   sends. Each send is recorded first (one_off_emails,
//                       unique per member), so it can never send twice.
//
// The response is COUNTS ONLY — never a name or an address.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({ dryRun: z.boolean() })

export async function POST(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(await sendSwitchedTutorEmails({ dryRun: parsed.data.dryRun }))
  } catch (e) {
    console.error('[switched-tutor-email] failed:', e instanceof Error ? e.message : 'unknown error')
    return NextResponse.json({ error: 'Could not run. Nothing more was sent.' }, { status: 500 })
  }
}
