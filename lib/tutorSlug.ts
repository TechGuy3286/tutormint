// lib/tutorSlug.ts
//
// A tutor's public address: who assigns it, when it is allowed to change, and
// how an old one still works.
//
// THE RULE LIVES IN THE DATABASE, in refresh_tutor_slug() (migration 41), and
// this file is a thin set of callers. That is not indirection for its own sake:
// /api/profile/save is not the only writer of a tutor's profile —
// /tutor/dashboard/settings upserts `tutor_profiles` straight from the client
// — so a rule expressed as a call in one route would have missed the writer
// that actually sets `city`. A trigger catches every writer; the rule is one
// function; this file calls it.
//
// What the rule says: an address may improve while the tutor is NOT LISTED,
// because search, browse, the sitemap and every social post read
// tutor_directory, so nobody can be holding a link to a profile that is not in
// it. Being listed freezes it, and so does an admin setting one by hand
// (`slug_locked`) — after that a tutor who moves city keeps their URL, because
// the page updates from the row and an address is a name, not a fact.
//
// Every move, automatic or deliberate, goes through set_tutor_slug(), which
// writes the retired address to slug_history in the same statement. There is
// no code path — and no checkbox anywhere in the UI — that can move an address
// without leaving a redirect behind.

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * The tutor's current address for a retired one, or null if that address was
 * never in use.
 *
 * Never a chain: the function reads the tutor's LIVE slug rather than walking
 * history forward, so however many times an address has moved there is exactly
 * one hop from any of them to the current page.
 */
export async function currentSlugForRetired(oldSlug: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('tutor_slug_redirect', { p_old: oldSlug })
  return (data as string | null) ?? null
}

/** What the canonical address for this tutor would be, right now. */
export async function suggestSlug(tutorId: string): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin.rpc('tutor_canonical_slug', { p_tutor: tutorId })
  return (data as string | null) ?? null
}

/**
 * Set the address, retiring the current one. Admin path.
 *
 * The database raises on a collision (with another tutor's live slug, or with
 * another tutor's retired one, which must never be reused — it would send
 * people following an old link to the wrong person). Those messages are
 * written to be shown to the admin as-is.
 */
export async function applySlug(
  tutorId: string,
  slug: string,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'Service role unavailable.' }

  const { data, error } = await admin.rpc('set_tutor_slug', { p_tutor: tutorId, p_slug: slug })
  if (error) return { ok: false, error: error.message }
  return { ok: true, slug: data as string }
}

/**
 * Give a tutor an address, or improve the one they have.
 *
 * THE RULE ITSELF IS IN THE DATABASE — refresh_tutor_slug(), migration 41 —
 * and this is one of its two callers. That is deliberate: /api/profile/save is
 * NOT the only writer of a tutor's profile. /tutor/dashboard/settings upserts
 * `tutor_profiles` straight from the client, and that is where `city` is
 * actually set, so a rule written here as TypeScript would have missed the one
 * case the feature exists for. A trigger on `tutor_profiles` catches every
 * writer that touches the row.
 *
 * What the trigger CANNOT see is a subjects-only change: `tutor_subjects` is a
 * different table, and the main subject is half of the canonical address. That
 * is what this call is for.
 *
 * Silent on failure. A profile save must not fail because an address could not
 * be improved — the save is what the tutor asked for, and an admin can fix an
 * address with one click.
 */
export async function ensureTutorSlug(tutorId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin.rpc('refresh_tutor_slug', { p_tutor: tutorId })
}
