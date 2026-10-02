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
//   - listed_tutor_slugs()   ⇔ tutorProfileIndexable  (tutor_directory + step 1:
//                               fee paid + CNIC/picture/selfie approved, not seed)
//   - indexable_job_slugs()  ⇔ tuitionIndexable        (status='open' + not a
//                               fixture: seed parent / JOB-TRK / SEED-JOB, unless
//                               a genuine team post)
// PR37 §5 verifies the SQL result and these predicates agree.

export type TutorIndexFacts = {
  /** The one-time Rs 199 verification fee is paid (verified_fee_paid_at is set). */
  feePaid: boolean | null | undefined
  /** The tutor's profile completion — the SAME % shown on their dashboard
   *  (profiles.profile_completion). Indexing needs 100. */
  completion: number | null | undefined
  /** A seed / example / fixture account — never indexed, whatever its state. */
  isSeed?: boolean | null
  /** A reported profile, temporarily delisted. */
  underReview?: boolean | null
}

/**
 * A tutor profile is indexable and in the sitemap ONLY when BOTH are true
 * (owner, PR100), REPLACING the earlier "step 1 complete" rule:
 *   (1) profile completion = 100% — the same figure on the tutor's dashboard, and
 *   (2) the Rs 199 verification fee is paid.
 * Otherwise the page is still VISIBLE on TutorMint (browse, search, direct
 * link) but carries noindex and stays out of the sitemap.
 *
 * A seed/fixture account and a profile under review are NEVER indexed, whatever
 * their state. The SQL mirror is listed_tutor_slugs() (built on tutor_directory,
 * which enforces moderation/mobile/city/subjects and excludes seed/suspended/
 * banned/rejected/under-review); they must stay in lockstep.
 *
 * NOTE on completion: the dashboard % counts UPLOADED documents, not staff
 * APPROVAL (lib/profileChecklist — "by uploading a CNIC, not by having it
 * verified"); this rule uses that same %, deliberately (owner, PR100).
 *
 * (A tutor whose page does not render at all — suspended / banned / rejected /
 * unclaimed import — is handled upstream by tutor_visible_profiles; this only
 * decides index vs noindex for a page that DOES render.)
 */
export function tutorProfileIndexable(f: TutorIndexFacts): boolean {
  if (f.isSeed) return false
  if (f.underReview) return false
  if (!f.feePaid) return false
  if ((f.completion ?? 0) < 100) return false
  return true
}

/**
 * The minimum description length for a tuition page to stand alone as an indexed
 * page (PR43 §3). Below this it is noindex and out of the sitemap — a one-line
 * request is too thin to be worth a search result. Mirrored in the sitemap's
 * indexable_job_slugs() (migration 102), so page and sitemap agree.
 */
export const MIN_TUITION_DESC = 40

export type TuitionIndexFacts = {
  /** jobs.status — only 'open' is indexable; 'paused'/'closed'/'hired' are not. */
  status: string | null | undefined
  /** A fixture tuition (seed parent / JOB-TRK / SEED-JOB, not a team post). */
  isFixture: boolean
  /** Trimmed length of the parent's description; a very short one is too thin. */
  descriptionLength?: number | null
}

/**
 * A tuition is indexable ONLY when it is OPEN, not a fixture, AND carries enough
 * unique requirement text to stand alone (PR37 §1, PR43 §3). A paused
 * (auto-paused after 15 days) or closed/hired tuition, any seed/example tuition,
 * and any one-line post below MIN_TUITION_DESC is noindex and out of the
 * sitemap; a genuine team post is not a fixture (decided by isFixtureTuition
 * before this is called). `descriptionLength` is optional so an existing caller
 * that does not pass it keeps the pre-PR43 behaviour.
 */
export function tuitionIndexable(f: TuitionIndexFacts): boolean {
  if (f.isFixture) return false
  if ((f.status ?? '') !== 'open') return false
  if (f.descriptionLength != null && f.descriptionLength < MIN_TUITION_DESC) return false
  return true
}

/**
 * A parent public card (/parent/[id]) is a reference page a tutor lands on from
 * a job, not an organic-search target — it is NEVER indexed and never in the
 * sitemap, seed or real. (The page already sets robots noindex unconditionally;
 * this constant states the rule in one place so a seed parent card is covered by
 * the same "seed → noindex" intent as the other two page types.)
 */
export const PARENT_CARD_INDEXABLE = false as const
