// lib/teamPosterCore.ts
//
// PURE, client-safe. How a staff-posted tuition names its poster (owner,
// 27 Oct 2026). Tutors saw staff tuitions as coming from a parent called
// "TutorMint Admin" (the team account's stored name) and reported them as
// fake. Wherever a staff-posted tuition shows who posted it — the public
// tuition page, tutor views, messages, reports — it reads TEAM_POSTER_LABEL,
// never the team account's own name or a staff member's name.

export const TEAM_POSTER_LABEL = 'Posted by TutorMint team for a parent ✓'

/** The name the team account shows as a conversation partner or a reported
 *  member (a person's name never appears for it). */
export const TEAM_MEMBER_NAME = 'TutorMint team'

/** A profile's display name, the team account's own name never shown. */
export function memberDisplayName(fullName: string | null | undefined, isTeamAccount: boolean | null | undefined, fallback = 'TutorMint member'): string {
  if (isTeamAccount) return TEAM_MEMBER_NAME
  const n = (fullName ?? '').trim()
  return n || fallback
}

// ── reports on a staff-posted tuition ────────────────────────────────────
//
// "Fake profile" is not offered on a staff-posted tuition: there is no parent
// profile to be fake. "Problem with this job" replaces it, with four reasons,
// and the report targets the TUITION only — never the team account.

export const JOB_PROBLEM_LABEL = 'Problem with this job'

export const JOB_PROBLEM_REASONS = [
  { code: 'job_no_response', label: 'No response from the parent' },
  { code: 'job_already_filled', label: 'Already filled' },
  { code: 'job_wrong_details', label: 'Wrong details' },
  { code: 'job_other', label: 'Something else' },
] as const

export const MEMBER_REPORT_REASONS = [
  { code: 'spam', label: 'Spam or advertising' },
  { code: 'harassment', label: 'Harassment or abuse' },
  { code: 'fake_profile', label: 'Fake or impersonated profile' },
  { code: 'off_platform_payment', label: 'Asking to pay outside TutorMint' },
  { code: 'inappropriate_content', label: 'Inappropriate content' },
  { code: 'other', label: 'Something else' },
] as const

export type ReportReasonCode = (typeof JOB_PROBLEM_REASONS)[number]['code'] | (typeof MEMBER_REPORT_REASONS)[number]['code']

/** The reasons a report form offers. */
export function reportReasonsFor(teamJob: boolean): readonly { code: string; label: string }[] {
  return teamJob ? JOB_PROBLEM_REASONS : MEMBER_REPORT_REASONS
}

/** Every reason the server accepts. */
export const ALL_REPORT_REASONS: readonly string[] = [...MEMBER_REPORT_REASONS, ...JOB_PROBLEM_REASONS].map((r) => r.code)

/** A reason as words, for the admin queue. */
export function reportReasonLabel(code: string): string {
  const all = [...MEMBER_REPORT_REASONS, ...JOB_PROBLEM_REASONS] as readonly { code: string; label: string }[]
  const hit = all.find((r) => r.code === code)
  if (!hit) return code.replace(/_/g, ' ')
  return JOB_PROBLEM_REASONS.some((r) => r.code === code) ? `${JOB_PROBLEM_LABEL}: ${hit.label.toLowerCase()}` : hit.label
}

/**
 * The server's decision for a job report. On a staff-posted tuition the reason
 * must be one of the job reasons and the report names nobody (reported_id
 * null). Anywhere else the job reasons are refused.
 */
export function jobReportDecision(input: { teamJob: boolean; reason: string; reportedId: string | null }):
  | { ok: true; reportedId: string | null }
  | { ok: false; error: string } {
  const isJobReason = JOB_PROBLEM_REASONS.some((r) => r.code === input.reason)
  if (input.teamJob) {
    if (!isJobReason) return { ok: false, error: `Choose what the problem with this job is.` }
    return { ok: true, reportedId: null }
  }
  if (isJobReason) return { ok: false, error: 'Choose a reason for the report.' }
  return { ok: true, reportedId: input.reportedId }
}
