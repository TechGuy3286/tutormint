import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBody, z } from '@/lib/validate'
import { rebuildContentQueue } from '@/lib/contentQueue/build'

// Content-queue actions: snooze, dismiss, and a manual rebuild.
//
// Manager + support (SCREEN_ACCESS.blogQueue) — the same reach as drafting a
// post. These are workflow decisions on suggestions, not member-facing
// mutations, so they are not audited; the decision itself is recorded on the
// row (status, dismiss_reason) and survives the nightly rebuild.
//
// 'drafted' is NOT set here — it is set by the save route when a post is first
// saved from a suggestion, so a topic only leaves the queue once real work
// exists.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A manual rebuild does the same work as the nightly one.
export const maxDuration = 60

const SNOOZE_DAYS = 14

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('snooze'), id: z.string().min(1) }),
  z.object({ action: z.literal('dismiss'), id: z.string().min(1), reason: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('rebuild') }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.blogQueue)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  if (body.action === 'rebuild') {
    const result = await rebuildContentQueue()
    return NextResponse.json({ success: true, ...result })
  }

  const nowIso = new Date().toISOString()

  if (body.action === 'snooze') {
    const until = new Date(Date.now() + SNOOZE_DAYS * 86_400_000).toISOString()
    const { error } = await admin
      .from('content_suggestions')
      .update({ status: 'snoozed', snooze_until: until, updated_at: nowIso })
      .eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, snoozedUntil: until })
  }

  // dismiss — the frozen evidence_hash on the row is what a later rebuild
  // compares against, so a dismissed topic returns only on a material change.
  const { error } = await admin
    .from('content_suggestions')
    .update({ status: 'dismissed', dismiss_reason: (body.reason ?? '').trim() || null, updated_at: nowIso })
    .eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
