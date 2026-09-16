import { NextResponse } from 'next/server'

import { checkAdminRole } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { recomputeCompletion } from '@/lib/completion'
import { parseBody, z } from '@/lib/validate'

// Clear a mobile number's verification from ONE chosen account (owner PR8 §1.5).
// This is how the owner resolves a number verified on more than one account
// (§1.4): pick the losing account and clear it here, then the held unique index
// (migration 90) can be applied. Owner ONLY, and audit-logged.
//
// It clears only the verification fields — the number itself, and everything
// else, is left as-is, so the account can re-verify a (different) number later.

export const runtime = 'nodejs'

const Body = z.object({ tutorId: z.string().min(1) })

export async function POST(request: Request) {
  // owner-only: roleSatisfies(['owner']) admits the owner and nobody else.
  const gate = await checkAdminRole('owner')
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Temporarily unavailable.' }, { status: 503 })

  const { data: profile } = await admin
    .from('profiles')
    .select('id, phone_number, phone_verified_at')
    .eq('id', parsed.data.tutorId)
    .maybeSingle()

  if (!profile) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
  if (!profile.phone_verified_at) {
    return NextResponse.json({ error: "This account's number is not verified." }, { status: 400 })
  }

  const { error } = await admin
    .from('profiles')
    .update({ phone_verified_at: null, phone_verified: false, phone_verified_via: null })
    .eq('id', parsed.data.tutorId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await recomputeCompletion(parsed.data.tutorId)

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'mobile.clear_verification',
    targetType: 'tutor',
    targetId: parsed.data.tutorId,
    // The number itself is not written to the audit detail — the account already
    // holds it, and the timeline does not need to carry a mobile number.
    detail: { cleared: 'phone_verification' },
  })

  return NextResponse.json({ success: true })
}
