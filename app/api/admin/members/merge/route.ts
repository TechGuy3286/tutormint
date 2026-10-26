import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { requireFreshAuth } from '@/lib/reauth'
import { applyMerge, previewMerge, undoMerge } from '@/lib/memberMerge'
import { maskPhoneDisplay } from '@/lib/contactMaskCore'
import { parseBody, z, uuid } from '@/lib/validate'

// Merge duplicates (owner, 26 Oct 2026; rules lib/memberMergeCore).
//
//   GET  ?a=&b=&keep=          the preview: both accounts side by side (phone
//                              masked), the account to keep (suggested or
//                              picked), exactly what will move, or why it cannot.
//   POST { action: 'merge', keepId, otherId }   the merge.
//   POST { action: 'undo', mergeId }            "Undo merge" — everything back.
//
// Owner only (refuseUnlessOwnerApproval — anyone else 403 and the Owner is
// told), and the password is asked again for both writes. Signed out → 401.

export const dynamic = 'force-dynamic'

const Q = z.object({ a: uuid, b: uuid, keep: uuid.optional() })

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.memberMerge)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const refused = await refuseUnlessOwnerApproval(gate.actor, 'Preview a merge of two accounts', null)
  if (refused) return refused
  const url = new URL(request.url)
  const q = Q.safeParse({ a: url.searchParams.get('a'), b: url.searchParams.get('b'), keep: url.searchParams.get('keep') ?? undefined })
  if (!q.success) return NextResponse.json({ error: 'Pick two accounts.' }, { status: 400 })
  const res = await previewMerge(q.data.a, q.data.b, q.data.keep ?? null, maskPhoneDisplay)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  // The plan's ops (row ids) stay on the server; the preview shows them in words.
  return NextResponse.json(
    { a: res.a, b: res.b, suggestedKeep: res.suggestedKeep, keepId: res.keepId, block: res.block, lines: res.lines },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

const Body = z.union([
  z.object({ action: z.literal('merge'), keepId: uuid, otherId: uuid }),
  z.object({ action: z.literal('undo'), mergeId: uuid }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.memberMerge)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  const refused = await refuseUnlessOwnerApproval(gate.actor, b.action === 'merge' ? 'Merge two accounts' : 'Undo a merge', b.action === 'merge' ? b.otherId : null)
  if (refused) return refused
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response
  if (b.action === 'undo') {
    const res = await undoMerge(gate.actor, b.mergeId)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    return NextResponse.json({ success: true })
  }
  if (b.keepId === b.otherId) return NextResponse.json({ error: 'Pick two different accounts.' }, { status: 400 })
  const res = await applyMerge(gate.actor, b.keepId, b.otherId)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true, mergeId: res.mergeId, lines: res.lines })
}
