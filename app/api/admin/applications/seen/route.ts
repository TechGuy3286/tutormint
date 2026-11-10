import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { markApplicationsSeen } from '@/lib/applicationTracking'
import { markSummaryDirty } from '@/lib/summaryDirty'
import { parseBody, uuid, z } from '@/lib/validate'

// POST /api/admin/applications/seen (owner, 10 Nov 2026) — a staff member
// opened these applications on Tuitions → Applications (the tutor's page, the
// forward panel, a WhatsApp, a stage change). The first view of each is kept;
// the sidebar badge counts only applications nobody has opened yet. A read
// receipt, not a change to the application, so it is not in Audit.

export const dynamic = 'force-dynamic'

const Body = z.object({ ids: z.array(uuid).min(1).max(200) })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.applicantForwards)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const added = await markApplicationsSeen([...new Set(parsed.data.ids)], gate.actor)
  // The badge is pre-calculated: the next summary run drops what was just opened.
  if (added > 0) await markSummaryDirty('application_seen')
  return NextResponse.json({ success: true, added })
}
