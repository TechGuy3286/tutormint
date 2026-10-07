// lib/ai/selfCheck.ts
//
// SELF-CORRECTION (owner, 7 Oct 2026). After a draft is assembled the checker
// runs; if issues remain, the draft and the issue list go back to the writer to
// fix ONLY those passages, then the checker runs again — up to 2 rounds. The
// result is recorded on the draft ("Self-checked: 2 rounds, 0 issues left").
//
// PURE orchestration: the caller passes the checker, the fixer (a network call
// in the editor and the harness) and the deterministic sanitiser, so the editor
// and the internal test harness run the identical loop.

import { applyPassageEdits, type AppliedEdit } from './passageEdits'
import type { BlogProblem } from './blogChecker'

export const SELF_CHECK_MAX_ROUNDS = 2

export type SelfCheckRecord = {
  /** Fix rounds actually used (0 when the first check was clean). */
  rounds: number
  /** Issues the checker still reports after the last round. */
  issuesLeft: number
  /** Issues the first check found. */
  issuesFound: number
  at: string
}

export type DraftState = { body: string; seoTitle: string; seoDescription: string }

export async function selfCorrect(
  draft: DraftState,
  deps: {
    check: (d: DraftState) => BlogProblem[]
    fix: (d: DraftState, problems: BlogProblem[]) => Promise<AppliedEdit[] | null>
    sanitize?: (body: string) => string
    maxRounds?: number
    now?: () => Date
  },
): Promise<{ draft: DraftState; problems: BlogProblem[]; record: SelfCheckRecord }> {
  const max = deps.maxRounds ?? SELF_CHECK_MAX_ROUNDS
  let current = draft
  let problems = deps.check(current)
  const issuesFound = problems.length
  let rounds = 0
  while (problems.length > 0 && rounds < max) {
    rounds++
    const edits = await deps.fix(current, problems)
    if (!edits || edits.length === 0) break
    const next = applyPassageEdits(current, edits)
    current = {
      body: deps.sanitize ? deps.sanitize(next.body) : next.body,
      seoTitle: next.seoTitle,
      seoDescription: next.seoDescription,
    }
    problems = deps.check(current)
  }
  return {
    draft: current,
    problems,
    record: { rounds, issuesLeft: problems.length, issuesFound, at: (deps.now?.() ?? new Date()).toISOString() },
  }
}

/** The line the editor shows: "Self-checked: 2 rounds, 0 issues left". */
export function selfCheckLabel(r: Pick<SelfCheckRecord, 'rounds' | 'issuesLeft'>): string {
  return `Self-checked: ${r.rounds} round${r.rounds === 1 ? '' : 's'}, ${r.issuesLeft} issue${r.issuesLeft === 1 ? '' : 's'} left`
}
