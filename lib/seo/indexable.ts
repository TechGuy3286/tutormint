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
  /** profiles.profile_completion — accepted for older callers, NO LONGER part of
   *  the rule (owner, 5 Oct 2026). */
  completion?: number | null | undefined
  /** CNIC approved by staff — deriveCnicStatus(...) === 'approved'. */
  cnicApproved: boolean | null | undefined
  /** profiles.profile_pic_status === 'approved' (staff review). */
  profilePicApproved: boolean | null | undefined
  /** profiles.selfie_status === 'approved' (staff review). */
  selfieApproved: boolean | null | undefined
  /** A seed / example / fixture account — never indexed, whatever its state. */
  isSeed?: boolean | null
  /** A reported profile, temporarily delisted. */
  underReview?: boolean | null
}

/**
 * A tutor profile is indexable and in the sitemap ONLY when BOTH are true
 * (owner, 5 Oct 2026 — "paid + approved"; supersedes PR100's 100% requirement):
 *   (1) the Rs 199 verification fee is paid, and
 *   (2) staff have APPROVED the CNIC, the profile photo and the selfie.
 * 100% profile completion is NO LONGER required (`completion` is accepted for
 * callers that still pass it and ignored). Otherwise the page is still VISIBLE
 * on TutorMint (browse, search, direct link) but carries noindex and stays out
 * of the sitemap.
 *
 * NEVER indexable, whatever their state: a seed/test fixture, a profile under
 * review, and anything the directory view excludes (paused/suspended, banned,
 * hidden, a rejected document — those are not in tutor_directory, which the
 * sitemap's listed_tutor_slugs() is built on). The SQL mirror is
 * listed_tutor_slugs() (migration 139); scripts/test-directory-live.ts fails if
 * the two ever disagree for any account.
 *
 * (A tutor whose page does not render at all — suspended / banned / unclaimed
 * import — is handled upstream by tutor_visible_profiles; this only decides
 * index vs noindex for a page that DOES render.)
 */
export function tutorProfileIndexable(f: TutorIndexFacts): boolean {
  if (f.isSeed) return false
  if (f.underReview) return false
  if (!f.feePaid) return false
  if (!f.cnicApproved) return false
  if (!f.profilePicApproved) return false
  if (!f.selfieApproved) return false
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
 * (auto-paused after 7 days) or closed/hired tuition, any seed/example tuition,
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
