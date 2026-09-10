// lib/fixtures.ts
//
// Which public tuitions are FIXTURES — seed and bulk-import demo data that fills
// the board but describes no real vacancy (owner, 10 Sep 2026). Fixtures stay
// visible and browsable on-site; they are only kept out of search engines
// (noindex, out of the sitemap, and NO JobPosting JSON-LD — an indexed fixture
// with JobPosting markup can surface in Google's jobs listings as a real job).
//
// A tuition is a fixture unless it is a genuine team post. Three fixture signals,
// matching how the demo data was created:
//   * the parent is a seed account (profiles.is_seed — the seed-created JOB-TX
//     tuitions), OR
//   * JOB-TRK<...>  — the pre-rebuild bulk import (real jobs use the JOB-TX-
//     prefix), OR
//   * SEED-JOB<...> — the seeded sample tuitions.
// The one exception that OVERRIDES all three: a post by the team-operated
// TutorMint account (posted_by_team) is a genuine, admin-vetted tuition and
// stays fully indexable.
//
// Pure, so the tuition page, the sitemap and the tests share one rule (the SQL
// indexable_job_slugs() function mirrors it for the sitemap query).

export function isFixtureTuition(input: {
  jobTxId: string | null | undefined
  parentIsSeed?: boolean | null
  postedByTeam?: boolean | null
}): boolean {
  // A genuine team post is never a fixture, whatever its id.
  if (input.postedByTeam) return false
  if (input.parentIsSeed) return true
  const tx = (input.jobTxId ?? '').trim()
  return /^JOB-TRK/i.test(tx) || /^SEED-JOB/i.test(tx)
}
