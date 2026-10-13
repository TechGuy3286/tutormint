import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { applyLocationActions, type ReviewAction } from '@/lib/locationReview'
import { parseBody, z } from '@/lib/validate'

// Admin → Locations (owner, 13 Oct 2026): approve one or many review rows —
// "Add as new area", "Same as existing area", "Not an area". The same roles
// that open the Locations screen (SCREEN_ACCESS.seo); signed out 401. Nothing
// is deleted and the text on tuitions and profiles is never rewritten; every
// action is written to the Audit log by lib/locationReview.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

const Body = z.object({ items: z.array(Item).min(1, 'Choose at least one row.').max(400) })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.seo)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const out = await applyLocationActions(parsed.data.items as ReviewAction[], gate.actor)
  const saved = out.results.filter((r) => r.ok).length
  const failed = out.results.filter((r) => !r.ok)
  if (saved === 0) {
    return NextResponse.json({ error: failed[0]?.message ?? 'That did not save. Please try again.', results: out.results }, { status: 400 })
  }
  return NextResponse.json({ ok: true, saved, failed: failed.length, results: out.results, hubsQueued: out.hubsQueued })
}
