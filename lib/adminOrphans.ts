import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

// Auth users with no matching profiles row — the failure class that hid 24 real
// signups for three days when the on_auth_user_created trigger was silently
// dropped (see migration 59). The admin tutor and member lists read from
// `profiles`, so an account with no profile is invisible everywhere; this view
// reads `auth.users` directly (through the Auth admin API, which the service
// role can enumerate) and subtracts the ones that DO have a profile.
//
// It fixes nothing on its own — it makes the silence loud, so this never goes
// unnoticed again.

export type OrphanAccount = {
  id: string
  /** The address the account was created with (synthetic for mobile signups). */
  email: string | null
  /** Best-effort mobile: the auth phone, or the msisdn out of a synthetic email. */
  mobile: string | null
  /** The role chosen at signup, from raw_user_meta_data — often what a backfill
   *  would use. '(none)' when the signup set no role. */
  metaRole: string
  fullName: string | null
  createdAt: string
  emailConfirmed: boolean
}

/** Extract the msisdn from a synthetic <msisdn>@users.tutormint.org address. */
function mobileFromEmail(email: string | null): string | null {
  if (!email) return null
  const local = email.split('@')[0]
  return /^92\d{10}$/.test(local) ? local : null
}

export async function loadOrphanedAccounts(): Promise<{ rows: OrphanAccount[]; ok: boolean }> {
  const admin = createAdminClient()
  if (!admin) return { rows: [], ok: false }

  // Every profiles id, to subtract from the auth users. Small on this platform;
  // if it ever grows past a few thousand this becomes a keyset scan, but a
  // missing-profile check is inherently a full anti-join.
  const profileIds = new Set<string>()
  {
    // Page through profiles ids so a cap does not silently hide orphans.
    const pageSize = 1000
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await admin
        .from('profiles')
        .select('id')
        .range(from, from + pageSize - 1)
      if (error) break
      for (const p of data ?? []) profileIds.add(p.id as string)
      if (!data || data.length < pageSize) break
    }
  }

  // Enumerate auth users through the Auth admin API and keep the ones with no
  // profile. Paginated; perPage is the Supabase max.
  const rows: OrphanAccount[] = []
  const perPage = 200
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) return { rows, ok: false }
    const users = data?.users ?? []
    for (const u of users) {
      if (profileIds.has(u.id)) continue
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>
      rows.push({
        id: u.id,
        email: u.email ?? null,
        mobile: (u.phone && u.phone.trim()) || mobileFromEmail(u.email ?? null),
        metaRole: typeof meta.role === 'string' && meta.role ? meta.role : '(none)',
        fullName: typeof meta.full_name === 'string' && meta.full_name ? meta.full_name : null,
        createdAt: u.created_at ?? '',
        emailConfirmed: !!u.email_confirmed_at,
      })
    }
    if (users.length < perPage) break
  }

  // Newest first — a fresh orphan is the one most worth catching.
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return { rows, ok: true }
}
