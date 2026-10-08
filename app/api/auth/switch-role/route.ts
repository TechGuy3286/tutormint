import { NextResponse } from 'next/server'
import { switchToRole } from '@/lib/secondRole'
import { parseBody, z } from '@/lib/validate'

// POST /api/auth/switch-role — "Continue as Tutor or Parent?" (owner, 8 Oct
// 2026). Only from a session that already belongs to one of two LINKED
// accounts; the server mints the other account's session itself.

const Body = z.object({ role: z.enum(['tutor', 'parent']) })

export async function POST(request: Request) {
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await switchToRole(parsed.data.role)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true, role: r.role, next: r.role === 'tutor' ? '/tutor/dashboard' : '/parent/dashboard' })
}
