// lib/tutorSlug.ts
//
// A tutor's public address: who assigns it, when it is allowed to change, and
// how an old one still works.
//
// THE RULE. A slug is assigned once and then frozen. It is *allowed* to move
// while the tutor is not yet listed — nobody has linked to a profile that
// search, browse and the sitemap all exclude, so improving the address as the
// profile fills in costs nothing. The moment the tutor becomes listed the
// address stops following the data: a tutor who moves city keeps their slug,
// because the page updates from the row and the URL is a name, not a fact.
//
// After that, only an admin changes it, and only through set_tutor_slug(),
// which writes the retired address to slug_history in the same statement.
// There is no code path — and no checkbox anywhere in the UI — that can move
// an address without leaving a redirect behind.
//
// EVERY CALL GOES THROUGH THE DATABASE FUNCTIONS. tutor_canonical_slug() and
// set_tutor_slug() hold the collision rules and the history write; doing any
// of it in TypeScript would mean two implementations of "is this address
// free", and the one that is wrong is the one that hands two tutors the same
// URL.

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
 * Give a tutor an address, or improve the one they have — but only while they
 * are not yet listed.
 *
 * Called after every profile save. Seven of the seventeen tutors that existed
 * before migration 40 had NO slug at all: handle_new_user() creates the
 * tutor_profiles row and never sets one, so anybody who registered normally
 * had a public profile with no address. This is what stops that recurring for
 * the next tutor who signs up.
 *
 * Silent on failure. A profile save must not fail because an address could not
 * be improved — the save is the thing the tutor asked for, and an admin can
 * fix an address with one click.
 */
export async function ensureTutorSlug(tutorId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return

  const { data: current } = await admin
    .from('tutor_profiles')
    .select('slug')
    .eq('id', tutorId)
    .maybeSingle()

  // Listed means somebody may already have the link: browse, search, the
  // sitemap and every social post read tutor_directory, and this is exactly
  // the set they contain.
  if (current?.slug) {
    const { data: listed } = await admin
      .from('tutor_directory')
      .select('id')
      .eq('id', tutorId)
      .maybeSingle()
    if (listed) return
  }

  const canonical = await suggestSlug(tutorId)
  if (!canonical || canonical === current?.slug) return

  await applySlug(tutorId, canonical)
}
