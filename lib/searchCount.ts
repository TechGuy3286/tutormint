import 'server-only'

// lib/searchCount.ts
//
// The server half of "which searches count" (owner, 13 Oct 2026). Reads the
// request's user-agent and the proxy's new-visitor stamp, and — for a signed-in
// member — whether they are staff. The rule is pure: lib/searchCountCore.
//
// Called by all three search logs (the member timeline's search_performed, the
// anonymous search log, and unmet searches), so no path can count a crawler.

import { headers } from 'next/headers'

import { createAdminClient } from '@/lib/supabase/admin'
import { NEW_VISITOR_HEADER, notCountedReason, type NotCounted } from '@/lib/searchCountCore'

/**
 * Why the current request's search is not counted, or null when it counts.
 * Outside a request (a script) there is nothing to read and nothing is refused.
 */
export async function searchNotCounted(input: { userId?: string | null; role?: string | null } = {}): Promise<NotCounted | null> {
  let userAgent: string | null = null
  let newVisitor: boolean | null = null
  try {
    const h = await headers()
    userAgent = h.get('user-agent')
    const stamp = h.get(NEW_VISITOR_HEADER)
    // No stamp at all: the request did not pass the proxy — not a person browsing.
    newVisitor = stamp === null ? true : stamp === '1'
  } catch {
    return null
  }

  let staff = input.role === 'admin'
  if (!staff && input.userId && input.role == null) {
    try {
      const admin = createAdminClient()
      if (admin) {
        const { data } = await admin.from('profiles').select('role').eq('id', input.userId).maybeSingle()
        staff = data?.role === 'admin'
      }
    } catch {
      /* unknown role: not treated as staff */
    }
  }
  return notCountedReason({ userAgent, staff, signedIn: !!input.userId, newVisitor })
}
