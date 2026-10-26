import 'server-only'

import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import type { User } from '@supabase/supabase-js'

import { createAdminClient } from '@/lib/supabase/admin'
import { createRealClient } from '@/lib/supabase/serverReal'
import { formatName } from '@/lib/formatName'
import { readTicket, ticketExpired, VIEW_AS_COOKIE } from '@/lib/viewAsCore'
import { VIEW_AS_HEADER } from '@/lib/viewAsGuardCore'

// "View as" without signing in (owner, 27 Oct 2026). Who a request is being
// shown as, or null.
//
// Only when ALL of these hold: proxy.ts stamped VIEW_AS_HEADER (a live ticket
// is in the browser and this is not the exit route); the signed tm_view_as
// ticket verifies and is under 30 minutes old; its view_as_sessions row is
// not ended or expired; and the browser's REAL session is the Owner who
// started it. Then lib/supabase/server's createClient() answers "who is this?"
// with the member and reads their data with the service role — the member is
// never signed in, so their last sign-in does not move — and every write is
// refused (lib/viewAsGuardCore through lib/supabase/fetch).

export type ViewAsContext = {
  viewId: string
  ownerId: string
  memberId: string
  memberName: string
  expiresAt: number
  user: User
}

export const getViewAsContext = cache(async function getViewAsContext(): Promise<ViewAsContext | null> {
  let flagged = false
  try {
    flagged = (await headers()).get(VIEW_AS_HEADER) === '1'
  } catch {
    return null
  }
  if (!flagged) return null
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const jar = await cookies()
  const ticket = readTicket(jar.get(VIEW_AS_COOKIE)?.value, key)
  if (!ticket || ticketExpired(ticket, Date.now())) return null
  const admin = createAdminClient()
  if (!admin) return null
  const { data: row } = await admin
    .from('view_as_sessions')
    .select('id, owner_id, member_id, expires_at, ended_at')
    .eq('id', ticket.id)
    .maybeSingle()
  if (!row || row.ended_at || Date.parse(row.expires_at as string) <= Date.now()) return null

  // The browser's own session must be the Owner who started this view.
  const real = await createRealClient()
  const {
    data: { user: realUser },
  } = await real.auth.getUser()
  if (!realUser || realUser.id !== row.owner_id) return null
  const { data: owner } = await admin.from('profiles').select('role, admin_role').eq('id', realUser.id).maybeSingle()
  if (owner?.role !== 'admin' || owner?.admin_role !== 'owner') return null

  const { data: au } = await admin.auth.admin.getUserById(row.member_id as string)
  if (!au?.user) return null
  const { data: p } = await admin.from('profiles').select('full_name').eq('id', row.member_id as string).maybeSingle()
  return {
    viewId: row.id as string,
    ownerId: row.owner_id as string,
    memberId: row.member_id as string,
    memberName: formatName((p?.full_name as string | null) ?? null) || 'this member',
    expiresAt: Math.min(ticket.expiresAt, Date.parse(row.expires_at as string)),
    user: au.user,
  }
})
