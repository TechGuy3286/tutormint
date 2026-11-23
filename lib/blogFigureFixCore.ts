// lib/blogFigureFixCore.ts — PURE (owner, 24 Nov 2026 — PR-20 B.1).
//
// "Fix it with AI" on ONE flagged figure in the blog editor's figure checker.
// The AI rewrites only the sentence that holds the figure so it no longer needs
// the number (or rewords it safely within the TutorMint facts); the editor shows
// the new sentence inline with Keep / Undo. This file finds that sentence,
// writes the one problem the writer is sent, and checks the answer: the edit
// must be inside that sentence, and the figure must be gone from it.

import { unsupportedFigures } from '@/lib/ai/blogBrief'

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The figure as a whole number in text: not part of a longer digit run. */
function figureRe(figure: string): RegExp {
  return new RegExp(`(?<![\\d,.])${escapeRe(figure)}(?![\\d,]*\\d)`, 'g')
}

/** Does `text` still state `figure` (as a whole number)? */
export function mentionsFigure(text: string, figure: string): boolean {
  return figureRe(figure).test(text) || figureRe(figure.replace(/,/g, '')).test(text.replace(/(\d),(\d{3})/g, '$1$2'))
}

/**
 * The sentence in `body` that holds `figure` as a flagged figure — the first
 * one where the figure checker itself would flag it (so a "Class 4" or a link
 * target never counts). A sentence ends at . ! ? followed by a space, or at a
 * line break. Null when none is found.
 */
export function sentenceWithFigure(body: string, figure: string): string | null {
  const re = figureRe(figure)
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const lineStart = body.lastIndexOf('\n', m.index) + 1
    const nl = body.indexOf('\n', m.index)
    const lineEnd = nl < 0 ? body.length : nl
    const line = body.slice(lineStart, lineEnd)
    const at = m.index - lineStart
    // Sentence starts after the last ". " / "! " / "? " before the figure.
    let start = 0
    for (const s of line.slice(0, at).matchAll(/[.!?]["'”’)]*\s+/g)) start = s.index + s[0].length
    const after = line.slice(at).search(/[.!?]["'”’)]*(\s|$)/)
    let end = after < 0 ? line.length : at + after + 1
    while (end < line.length && /["'”’)]/.test(line[end])) end++
    const sentence = line.slice(start, end).trim()
    if (!sentence) continue
    // A notes string with no digits: the checker flags every number it would flag.
    if (unsupportedFigures(sentence, 'none', '', []).some((f) => f === figure || f.replace(/,/g, '') === figure.replace(/,/g, ''))) {
      return sentence
    }
  }
  return null
}

/** The single problem sent to the writer for one figure. */
export function figureFixProblem(sentence: string, figure: string) {
  return {
    message:
      `The figure “${figure}” is not in the fact notes, so it cannot be published. Rewrite ONLY this one sentence so it no longer needs that number ` +
      '(or reword it safely within the TutorMint facts). Add no other number, price, count or percentage. Keep its Markdown links.',
    kind: 'figure',
    match: sentence,
    field: 'body' as const,
  }
}

export type FigureEdit = { before: string; after: string }

/**
 * The writer's answer, checked: the first body edit whose passage is inside the
 * flagged sentence, applied to that sentence. Null when there is no such edit
 * or the new sentence still states the figure.
 */
export function figureRewrite(sentence: string, figure: string, edits: { field: string; before: string; after: string }[]): FigureEdit | null {
  for (const e of edits) {
    if (e.field !== 'body' || !e.before || !sentence.includes(e.before)) continue
    const next = sentence.replace(e.before, e.after).trim()
    if (!next || next === sentence || mentionsFigure(next, figure)) continue
    return { before: sentence, after: next }
  }
  return null
}

/** Put the new sentence in the body (the first copy of the old one). */
export function applyFigureRewrite(body: string, edit: FigureEdit): string {
  const at = body.indexOf(edit.before)
  return at < 0 ? body : body.slice(0, at) + edit.after + body.slice(at + edit.before.length)
}

/** Undo: the old sentence back in place of the new one. */
export function undoFigureRewrite(body: string, edit: FigureEdit): string {
  const at = body.indexOf(edit.after)
  return at < 0 ? body : body.slice(0, at) + edit.before + body.slice(at + edit.after.length)
}
