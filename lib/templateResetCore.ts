// lib/templateResetCore.ts
//
// What "Reset to default" in Team inbox → Templates puts back (owner, 28 Oct
// 2026): the CURRENTLY APPROVED wording, not the old built-in one. Pure — the
// route, the editor and the test read the same rule.
//
//   not reviewed, or "Keep current"  → null: the built-in code default stands
//   approved as proposed             → the proposal's wording (lib/templateProposals)
//   approved after an edit           → the wording that went live at approval:
//                                      the body the FIRST later change replaced
//                                      (every later edit or restore keeps the
//                                      wording it replaced in template_history),
//                                      or today's live body when nothing has
//                                      changed it since.
//
// "Restore" from history is a separate action and is unchanged.

export type ReviewFacts = { status: 'approved' | 'kept'; edited: boolean; decidedAt: string }
export type HistoryFacts = { action: string; body: string | null; savedAt: string }

const norm = (s: string) => s.replace(/\r\n/g, '\n').trim()

export function approvedWording(input: {
  review: ReviewFacts | null
  proposalBody: string | null
  history: HistoryFacts[]
  currentBody: string | null
}): string | null {
  const { review } = input
  if (!review || review.status !== 'approved') return null
  if (!review.edited) return input.proposalBody != null ? norm(input.proposalBody) : null
  const decided = new Date(review.decidedAt).getTime()
  const later = input.history
    .filter((h) => h.action !== 'approve' && new Date(h.savedAt).getTime() > decided && h.body != null)
    .sort((a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime())
  if (later.length) return norm(later[0].body as string)
  return input.currentBody != null ? norm(input.currentBody) : null
}

/** The body Reset puts back: the approved wording when there is one, else the code default. */
export function resetBody(approved: string | null, codeDefault: string | null): string | null {
  return approved ?? codeDefault
}
