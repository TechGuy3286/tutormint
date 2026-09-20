// lib/seo/indexable.ts
//
// THE ONE indexability rule (PR37 §2): "may this page be shown to search
// engines?" for the three public record pages — a tutor profile, a tuition and a
// parent card. Each page's robots meta reads from here, and the sitemap follows
// the SAME rules. Before this the logic lived in three places (a page helper, an
// inline expression, and two SQL functions) that happened to agree; now the TS
// side is one module and the SQL side is documented as its bulk mirror.
//
// PURE — no imports — so the pages, the sitemap builder and the tests all read
// the same predicates.
//
// THE SITEMAP'S BULK QUERY. tutor_profiles and profiles are RLS-protected from
// the publishable key, so the sitemap cannot read completion / fee / is_seed
// directly; it reads two SECURITY DEFINER functions that are the SQL EXPRESSION
// of these same predicates and must stay in lockstep with them:
//   - listed_tutor_slugs()   ⇔ tutorProfileIndexable  (tutor_directory + >=100 +
//                               verified_fee_paid_at not null + not is_seed)
//   - indexable_job_slugs()  ⇔ tuitionIndexable        (status='open' + not a
//                               fixture: seed parent / JOB-TRK / SEED-JOB, unless
//                               a genuine team post)
// PR37 §5 verifies the SQL result and these predicates agree.

export type TutorIndexFacts = {
  /** The one-time Rs 199 verification fee is paid (verified_fee_paid_at is set). */
  feePaid: boolean | null | undefined
  /** profiles.profile_completion (0–100). */
  profileCompletion: number | null | undefined
  /** A seed / example / fixture account — never indexed, whatever its state. */
  isSeed?: boolean | null
  /** A reported profile, temporarily delisted. */
  underReview?: boolean | null
}

/**
 * A tutor profile is indexable ONLY when it is 100% complete AND the fee is
 * paid — and never for a seed account or a profile under review (PR37 §1). Every
 * other tutor profile is noindex and out of the sitemap. (A tutor whose page
 * does not render at all — suspended / banned / rejected / unclaimed import — is
 * handled upstream by tutor_visible_profiles; this only decides index vs
 * noindex for a page that DOES render.)
 */
export function tutorProfileIndexable(f: TutorIndexFacts): boolean {
  if (f.isSeed) return false
  if (f.underReview) return false
  if (!f.feePaid) return false
  return (f.profileCompletion ?? 0) >= 100
}

export type TuitionIndexFacts = {
  /** jobs.status — only 'open' is indexable; 'paused'/'closed'/'hired' are not. */
  status: string | null | undefined
  /** A fixture tuition (seed parent / JOB-TRK / SEED-JOB, not a team post). */
  isFixture: boolean
}

/**
 * A tuition is indexable ONLY when it is OPEN and not a fixture (PR37 §1). A
 * paused (auto-paused after 15 days) or closed/hired tuition, and any
 * seed/example tuition, is noindex and out of the sitemap; a genuine team post
 * is not a fixture (decided by isFixtureTuition before this is called).
 */
export function tuitionIndexable(f: TuitionIndexFacts): boolean {
  if (f.isFixture) return false
  return (f.status ?? '') === 'open'
}

/**
 * A parent public card (/parent/[id]) is a reference page a tutor lands on from
 * a job, not an organic-search target — it is NEVER indexed and never in the
 * sitemap, seed or real. (The page already sets robots noindex unconditionally;
 * this constant states the rule in one place so a seed parent card is covered by
 * the same "seed → noindex" intent as the other two page types.)
 */
export const PARENT_CARD_INDEXABLE = false as const
