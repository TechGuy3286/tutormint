// lib/ai/passageEdits.ts
//
// Applying the writer's passage edits (owner, 7 Oct 2026) — "Fix with AI" and the
// self-correction rounds. PURE, so the editor (which shows the before/after and
// applies only on Accept), the generate route and the tests share it.

export type AppliedEdit = {
  field: 'body' | 'seoTitle' | 'seoDescription'
  before: string
  after: string
}

/** Each body edit replaces the FIRST occurrence of its passage; a field edit
 *  replaces the whole field. An edit whose passage is no longer present is
 *  skipped (it was already changed). Returns the new values. */
export function applyPassageEdits(
  post: { body: string; seoTitle: string; seoDescription: string },
  edits: AppliedEdit[],
): { body: string; seoTitle: string; seoDescription: string; applied: number } {
  let { body, seoTitle, seoDescription } = post
  let applied = 0
  for (const e of edits) {
    if (e.field === 'seoTitle') {
      seoTitle = e.after
      applied++
    } else if (e.field === 'seoDescription') {
      seoDescription = e.after
      applied++
    } else {
      const at = body.indexOf(e.before)
      if (at < 0) continue
      body = body.slice(0, at) + e.after + body.slice(at + e.before.length)
      applied++
    }
  }
  return { body, seoTitle, seoDescription, applied }
}
