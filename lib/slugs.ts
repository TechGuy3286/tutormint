// lib/slugs.ts
//
// URL-shaped strings, in one place.
//
// The database has its own `tm_slugify()` (migration 40) and it is the
// authority — the trigger that names every new tuition and the function that
// proposes a tutor's canonical address both use it. This file is the mirror
// for the two things that have to build the same string in TypeScript: the
// admin Suggest button showing a preview before anything is saved, and every
// link on the platform that has to point at a tuition page.
//
// The two implementations are exercised by the same rows, so a divergence
// shows up immediately as a Suggest that proposes something different from
// what the trigger actually wrote.
//
// NO PHONE DIGITS IN ANY URL. The bulk import used to append the last four
// digits of the tutor's mobile to keep two people of the same name apart.
// Four digits is not a secret on its own, but it is personal data in a string
// that gets pasted into WhatsApp, printed on a social post and indexed — and
// it tells a parent nothing. Collisions are broken with a hash of the row's
// own uuid instead, which carries no information about the person.

/** Mirrors public.tm_slugify(): lowercase, non-alphanumerics to hyphens. */
export function slugify(text: string | null | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining marks so "Ayeshá" and "Ayesha" are the same slug rather
    // than the accent silently becoming a hyphen. \p{M} rather than a literal
    // range, so the source stays legible.
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The city segment of a tuition URL.
 *
 * A job with no city still needs an address, and "pakistan" is the honest
 * answer for a tuition whose city was never recorded — it is also what the
 * page's own copy says.
 */
export function citySegment(city: string | null | undefined): string {
  return slugify(city) || 'pakistan'
}

/**
 * The public URL of one tuition.
 *
 * `public_slug` is set once by a trigger and never changes, so this is stable
 * for the life of the job. The city segment is derived from the CURRENT city:
 * if a parent edits it, the old URL still resolves and the page redirects to
 * the new one, because the slug alone identifies the row.
 */
export function tuitionPath(job: {
  public_slug?: string | null
  city?: string | null
  job_tx_id?: string | null
  id?: string
}): string {
  if (job.public_slug) return `/tuitions/${citySegment(job.city)}/${job.public_slug}`
  // A row written before migration 40 and somehow missed by the backfill. The
  // browse list is a worse destination than the page, but it is a real one —
  // and it is what every job link on the platform pointed at until now.
  return `/browse/tuitions?job=${job.job_tx_id ?? job.id ?? ''}`
}

/** The public URL of one tutor. Null slug means the profile has no address yet. */
export function tutorPath(slug: string | null | undefined): string | null {
  return slug ? `/tutor/${slug}` : null
}
