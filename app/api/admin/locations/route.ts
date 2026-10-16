import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import {
  applyLocationActions,
  bulkReviewActions,
  loadLocationReviewPage,
  REVIEW_BATCH_MAX,
  type ReviewAction,
  type ReviewKind,
} from '@/lib/locationReview'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { parseBody, z } from '@/lib/validate'

// Admin → Locations (owner, 13 + 16 Oct 2026).
//
//   GET  ?kind=all|same|not_area|add&q=&offset=      one page of typed areas,
//                                                    suggestions computed here
//   GET  ?kind=same|not_area|add&bulk=1              every row of ONE kind as
//                                                    its suggested action, and
//                                                    a sample of 5 to confirm
//   POST { items }                                   approve at most 25 rows —
//                                                    "Add as new area", "Same
//                                                    as existing area", "Not an
//                                                    area"
//
// Reading is open to the roles that open Locations (SCREEN_ACCESS.seo).
// Approving is OWNER ONLY on the server: every other role gets 403 and the
// Owner is told of the attempt. A big approval is sent by the screen in
// batches, so no request runs long. Nothing is deleted and the text on
// tuitions and profiles is never rewritten; every action is in the Audit log.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const KINDS = ['all', 'same', 'not_area', 'add'] as const

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.seo)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const sp = new URL(request.url).searchParams
  const kindRaw = sp.get('kind') ?? 'all'
  const kind: ReviewKind = (KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as ReviewKind) : 'all'
  if (sp.get('bulk') === '1') {
    if (kind === 'all') return NextResponse.json({ error: 'Choose one kind to approve.' }, { status: 400 })
    return NextResponse.json(await bulkReviewActions(kind))
  }
  const offset = Number(sp.get('offset') ?? 0) || 0
  return NextResponse.json(await loadLocationReviewPage({ kind, q: sp.get('q') ?? '', offset }))
}

const Item = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), value: z.string().trim().min(1).max(200), city: z.string().max(120), name: z.string().trim().min(2, 'Enter the area name.').max(80) }),
  z.object({ action: z.literal('same'), value: z.string().trim().min(1).max(200), city: z.string().max(120), areaId: z.number().int().positive() }),
  z.object({
    action: z.literal('not_area'),
    value: z.string().trim().min(1).max(200),
    city: z.string().max(120),
    reason: z.enum(['school', 'address', 'online', 'junk'], { message: 'Choose what it is.' }),
  }),
])

const Body = z.object({ items: z.array(Item).min(1, 'Choose at least one row.').max(REVIEW_BATCH_MAX, `Send at most ${REVIEW_BATCH_MAX} rows at a time.`) })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.seo)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  // Approvals are the Owner's (owner, 16 Oct 2026).
  const refused = await refuseUnlessOwnerApproval(gate.actor, 'Locations: approve typed areas')
  if (refused) return refused

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const out = await applyLocationActions(parsed.data.items as ReviewAction[], gate.actor)
  const saved = out.results.filter((r) => r.ok).length
  const failed = out.results.filter((r) => !r.ok)
  if (saved === 0) {
    return NextResponse.json({ error: failed[0]?.message ?? 'That did not save. Please try again.', results: out.results }, { status: 400 })
  }
  return NextResponse.json({ ok: true, saved, failed: failed.length, results: out.results })
}
