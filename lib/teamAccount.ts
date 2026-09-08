// lib/teamAccount.ts
//
// The team-operated TutorMint parent account (owner, 9 Sep 2026).
//
// Admin-posted tuitions belong to a REAL parent account granted parent_featured,
// so every downstream flow -- applications, threads, shortlisting, hiring --
// works through the ordinary parent path with no special-casing. This module is
// the one place that answers "which account is that?", read from the
// profiles.is_team_account flag (migration 63) rather than an id hardcoded
// anywhere.
//
// The account is provisioned once by scripts/provision-team-parent.ts. If it has
// not been provisioned, teamParentId() returns null and the admin posting path
// refuses with a plain message rather than inventing a recipient.

import { createAdminClient } from '@/lib/supabase/admin'

/** What every public surface shows in place of the team account's own name. */
export const TEAM_DISPLAY_NAME = 'TutorMint'

/**
 * The team parent account's auth.users id, or null if it has not been
 * provisioned yet. Read through the service role -- `profiles` is self-read
 * under RLS, and this is asked from server code paths (job posting, decoration)
 * that are not signed in as that account.
 */
export async function teamParentId(): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('is_team_account', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data?.id as string) ?? null
}
