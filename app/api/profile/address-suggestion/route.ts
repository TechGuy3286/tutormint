import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activityLog'
import { recomputeCompletion } from '@/lib/completion'
import { serverError } from '@/lib/errorResponse'
import { parseBody, z } from '@/lib/validate'
import { markSuggestionDecided, memberAddressState, pendingSuggestion } from '@/lib/cnicAddress'
import { addressSaveRefusal } from '@/lib/cnicAddressCore'

// Home address (owner, 18 Nov 2026 — PR-07), tutor and parent, own account only.
//
// GET  → the member's address and, while they have none, the address read from
//        their CNIC back as a suggestion (lib/cnicAddressCore).
// POST { action: 'confirm' }               → the suggestion becomes their address.
// POST { action: 'edit', address: '…' }    → their typed address is saved (and a
//                                            pending suggestion is marked edited).
//
// SCOPED TO THE SESSION: profiles.address is written with the member's own
// client (.eq('id', user.id)), exactly like typing it in Settings. Only Confirm
// or Edit marks the suggestion confirmed. Under View as every write is refused
// (lib/supabase/fetch). The address is never logged.

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })
  const state = await memberAddressState(user.id)
  return NextResponse.json(state, { headers: NO_STORE })
}

const Body = z.object({
  action: z.enum(['confirm', 'edit']),
  address: z.string().trim().max(600).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { action } = parsed.data

  const suggestion = await pendingSuggestion(user.id)
  const refusal = addressSaveRefusal(action, { suggestion, text: parsed.data.address })
  if (refusal) return NextResponse.json({ error: refusal }, { status: 400 })

  const address = action === 'confirm' ? (suggestion?.address ?? '') : (parsed.data.address ?? '').replace(/\s+/g, ' ').trim()
  const { error } = await supabase.from('profiles').update({ address }).eq('id', user.id)
  if (error) return serverError(error, 'profile/address-suggestion')

  if (suggestion) await markSuggestionDecided(user.id, action === 'confirm' ? 'confirmed' : 'edited')
  await recomputeCompletion(user.id)
  // No address in the log — only what happened.
  await logActivity({
    userId: user.id,
    event: 'profile_updated',
    targetType: 'profile',
    targetId: user.id,
    meta: { source: 'home_address', action, fromCnic: !!suggestion },
  })
  return NextResponse.json({ success: true, address }, { headers: NO_STORE })
}
