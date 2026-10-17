import { NextResponse } from 'next/server'

import { checkAdminRole } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { revealCnic } from '@/lib/cnicRevealCore'
import { parseBody, z } from '@/lib/validate'

// Reveal a member's full CNIC number — the Owner only (owner, 17 Oct 2026).
// Every admin screen is sent the masked number; the full number is fetched
// here, once, on the Owner's explicit "Show", and every Show is written to
// admin_audit_log (who, which member, when) before the number is returned.
// Any other staff role gets 403 and nothing is read. Works for a tutor or a
// parent (`tutorId` is kept as an alias of `memberId` for older screens).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({ memberId: z.string().min(1).optional(), tutorId: z.string().min(1).optional() })

export async function POST(request: Request) {
  const gate = await checkAdminRole('admin', 'partner') // owner too; the reveal rule then admits the Owner only
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const memberId = parsed.data.memberId ?? parsed.data.tutorId
  if (!memberId) return NextResponse.json({ error: 'Which member? Reload the page and try again.' }, { status: 400 })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Temporarily unavailable.' }, { status: 503 })

  const result = await revealCnic(gate.actor, memberId, {
    loadNumber: async (id) => {
      const { data } = await admin.from('profiles').select('cnic_number').eq('id', id).maybeSingle()
      return (data?.cnic_number as string | null) ?? null
    },
    log: async ({ memberId: id }) => {
      await logAdminAction({
        actorId: gate.actor.id,
        actorRole: gate.actor.adminRole,
        actorEmail: gate.actor.email,
        action: 'cnic.reveal',
        targetType: 'profile',
        targetId: id,
      })
    },
  })
  return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'private, no-store' } })
}
