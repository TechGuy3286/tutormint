// PURE. What /api/viewer/jobs answers (push 3, owner 1 Nov 2026): the signed-in
// visitor's side of a list of job cards on a cached public page.

import type { ApplyBlock } from '@/lib/applyBlock'

export type ViewerJobsPayload =
  | { signedIn: false }
  | {
      signedIn: true
      isTutor: boolean
      cities: string[]
      jobTypes: string[]
      blocks: Record<string, ApplyBlock | null>
      saved: string[]
      /** Tuitions whose gender preference this tutor does not match. */
      genderBlocked: string[]
    }

/** The ids a cached page asks about: unique, in order, at most 60. */
export function viewerJobIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].slice(0, 60)
}

/** On a guest-rendered card list, Apply shows for guests and tutors, never for
 *  a signed-in parent or staff member (the rule CityJobsView and the blog block
 *  applied on the server before push 3). */
export function showApplyFor(v: ViewerJobsPayload | null): boolean {
  return !v || !v.signedIn || v.isTutor
}
