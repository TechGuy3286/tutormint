// lib/reportCardCore.ts
//
// PURE. What a Reports & flags card says about the thing reported and the
// person who reported it (owner, 27 Oct 2026):
//   • a link to the EXACT tuition (TM number + title) or profile reported;
//   • the reporter's paid / verified status;
//   • the reporter's applications on that tuition, with whether staff have
//     forwarded them to the parent.

import { STAGE_LABEL, isStage, type Stage } from '@/lib/applicationStageCore'

export type ReportTarget =
  | {
      kind: 'tuition'
      jobId: string
      refId: string | null
      title: string
      /** The admin page for the tuition. */
      adminHref: string
      /** The public tuition page, or null. */
      publicHref: string | null
      postedByTeam: boolean
    }
  | { kind: 'profile'; memberId: string; name: string; adminHref: string; publicHref: string | null }
  | { kind: 'conversation'; memberId: string | null; name: string | null; adminHref: string | null }
  | { kind: 'unknown' }

/** "TM-1234 · Home Tutor Required | Grade 5 | DHA | Lahore", or the title alone. */
export function tuitionLinkText(refId: string | null | undefined, title: string | null | undefined): string {
  const t = (title ?? '').trim() || 'Tuition'
  return refId ? `${refId} · ${t}` : t
}

export type ReporterFacts = {
  role: string | null
  /** Tutor: the Verification Fee is paid. */
  feePaid: boolean
  /** Tutor: holds the Verified badge. Parent: CNIC and address approved. */
  verified: boolean
  mobileVerified: boolean
}

/** One short line: "Tutor · Fee paid · Verified badge" / "Parent · Mobile verified". */
export function reporterStatusLine(f: ReporterFacts | null | undefined): string {
  if (!f) return 'Account no longer available'
  if (f.role === 'tutor') {
    return ['Tutor', f.feePaid ? 'Fee paid' : 'Fee not paid', f.verified ? 'Verified badge' : 'No Verified badge'].join(' · ')
  }
  if (f.role === 'parent' || f.role === 'academy') {
    return ['Parent', f.verified ? 'Verified (CNIC + address)' : f.mobileVerified ? 'Mobile verified' : 'Mobile not verified'].join(' · ')
  }
  if (f.role === 'admin') return 'Staff'
  return 'Member'
}

export type ReporterApplication = { stage: Stage | string; appliedAt: string; withdrawn: boolean }

/** Forwarded = the stage has moved past Applied (and is not a closed-out "Not selected"). */
export function forwardStatus(stage: string): 'Not forwarded yet' | 'Forwarded to the parent' | 'Not selected' {
  if (stage === 'applied') return 'Not forwarded yet'
  if (stage === 'not_selected') return 'Not selected'
  return 'Forwarded to the parent'
}

/** "Applied 26 Oct · Stage: Forwarded · Forwarded to the parent" — open applications only. */
export function reporterApplicationLines(apps: ReporterApplication[], fmtDate: (iso: string) => string): string[] {
  return apps
    .filter((a) => !a.withdrawn)
    .map((a) => {
      const stage = isStage(a.stage) ? STAGE_LABEL[a.stage] : String(a.stage)
      return `Applied ${fmtDate(a.appliedAt)} · Stage: ${stage} · ${forwardStatus(String(a.stage))}`
    })
}

/** The words for a reported member's name: the team account never by its own name. */
export { TEAM_MEMBER_NAME } from '@/lib/teamPosterCore'
