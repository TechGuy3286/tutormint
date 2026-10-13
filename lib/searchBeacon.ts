import 'server-only'

// lib/searchBeacon.ts
//
// The server half of the search beacon (owner, 13 Oct 2026): the Browse pages
// call searchBeaconToken() while rendering — which writes NOTHING — and the
// route POST /api/search/log calls recordBeaconSearch() when a real browser
// posts the ticket back. Rules and the ticket format: lib/searchBeaconCore.

import { createAdminClient } from '@/lib/supabase/admin'
import { logSearchPerformed } from '@/lib/activityLog'
import { logAnonSearch } from '@/lib/anonSearch'
import { logUnmetSearch, resolveSmartQuery } from '@/lib/smartSearch'
import { beaconWorthSending, readBeacon, signBeacon, type BeaconPayload } from '@/lib/searchBeaconCore'

// The same server-only secret lib/matchEmail signs with. Never sent to a browser.
const secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/** The ticket for the search this page just rendered, or null when it was not a search. */
export function searchBeaconToken(input: Omit<BeaconPayload, 't'>): string | null {
  if (!beaconWorthSending(input)) return null
  return signBeacon({ ...input, t: Math.floor(Date.now() / 1000) }, secret())
}

export function verifyBeaconToken(token: unknown): BeaconPayload | null {
  return readBeacon(token, secret())
}

/**
 * Record one search from a verified ticket. `userId` is the signed-in member
 * (their timeline) or null (the anonymous log, keyed on `anonId`). The three
 * logs apply the bot / own-crawler / staff / 30-minute repeat rules themselves.
 */
export async function recordBeaconSearch(p: BeaconPayload, who: { userId: string | null; anonId: string | null }): Promise<void> {
  let role: string | null = null
  if (who.userId) {
    try {
      const admin = createAdminClient()
      if (admin) {
        const { data } = await admin.from('profiles').select('role').eq('id', who.userId).maybeSingle()
        role = (data?.role as string | null) ?? null
      }
    } catch {
      /* unknown role */
    }
  }

  if (p.x) {
    if (who.userId) {
      await logSearchPerformed({
        userId: who.userId,
        surface: p.s,
        filters:
          p.s === 'tutors'
            ? { master_id: p.f.master_id ?? null, city: p.f.city ?? null, area: p.f.area ?? null, mode: p.f.mode ?? null, gender: p.f.gender ?? null }
            : { master_id: p.f.master_id ?? null, city: p.f.city ?? null, mode: p.f.mode ?? null },
        results: p.r,
        fromBeacon: true,
      })
    } else if (who.anonId) {
      await logAnonSearch({ sessionId: who.anonId, surface: p.s, filters: p.f, results: p.r, fromBeacon: true })
    }
  }

  if (p.u) {
    const parsed = (await resolveSmartQuery(p.u).catch(() => null))?.parsed ?? null
    await logUnmetSearch({ query: p.u, surface: p.s, parsed, role, userId: who.userId, fromBeacon: true })
  }
}
