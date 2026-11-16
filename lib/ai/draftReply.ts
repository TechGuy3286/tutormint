// lib/ai/draftReply.ts
//
// Pure helpers for reading what the blog writer sends back (owner, 16 Nov
// 2026). No server-only import, so the unit tests run them on invented replies.
//
//   extractJsonObject — the first VALID JSON object in a reply, wherever it is:
//     inside a ```json code fence, after a sentence of preamble, before a
//     closing note. A reply cut off before its closing brace has none.
//   stripDraftHead — a draft body never starts with a title (H1) or metadata
//     lines ("Title:", "Meta description:", front matter). The page title
//     comes from the Title field.

import { fitSeoDescription } from './blogBrief'

export type OutlineParsed = { ok: true; sections: string[]; seoTitle: string; seoDescription: string } | { ok: false; reason: string }

/** Read an outline reply ({sections, seoTitle, seoDescription}) tolerantly. */
export function parseOutlineReply(raw: string, title: string): OutlineParsed {
  const p = extractJsonObject(raw)
  if (!p) return { ok: false, reason: 'no JSON object' }
  const sections = Array.isArray(p.sections)
    ? p.sections
        .filter((x): x is string => typeof x === 'string' && !!x.trim())
        .map((x) => x.trim().replace(/^#+\s*/, ''))
    : []
  if (sections.length < 3) return { ok: false, reason: 'outline had too few sections' }
  const seoTitle = (typeof p.seoTitle === 'string' ? p.seoTitle.trim() : '').slice(0, 60) || title.slice(0, 60)
  const seoDescription = fitSeoDescription(
    typeof p.seoDescription === 'string' && p.seoDescription.trim() ? p.seoDescription.trim() : title,
  )
  return { ok: true, sections: sections.slice(0, 8), seoTitle, seoDescription }
}

type Call = { ok: true; text: string; stopReason?: string | null } | { ok: false; reason: string }

/**
 * Ask for an outline at most TWICE: the first try, and one retry when the call
 * failed in a way a second try can fix (no text, an unreadable or cut-off
 * reply, an API error) — never on a timeout, which a retry would only repeat.
 * `onFail` gets a technical line for the server log: stop reason, reply length,
 * never the reply text (it can echo the manager's notes).
 */
export async function runOutline(
  call: (attempt: 1 | 2) => Promise<Call>,
  title: string,
  onFail: (attempt: 1 | 2, detail: string) => void = () => {},
): Promise<OutlineParsed & { attempts: number }> {
  let last: OutlineParsed = { ok: false, reason: 'not tried' }
  for (const attempt of [1, 2] as const) {
    const res = await call(attempt)
    if (!res.ok) {
      last = { ok: false, reason: res.reason }
      onFail(attempt, `call failed: ${res.reason.slice(0, 200)}`)
      if (/timed out/.test(res.reason)) break
      continue
    }
    const parsed = parseOutlineReply(res.text, title)
    if (parsed.ok) return { ...parsed, attempts: attempt }
    last = { ok: false, reason: `unparseable outline: ${parsed.reason}` }
    onFail(attempt, `${parsed.reason} (stop_reason=${res.stopReason ?? 'unknown'}, reply ${res.text.length} chars)`)
  }
  return { ...last, attempts: 2 }
}

/** The plain message the editor shows when a draft could not be written. */
export const AI_DRAFT_FAILED_MESSAGE =
  "The AI draft didn't work this time. Your notes are kept — please try again in a minute."

/**
 * The first JSON object in `raw` that parses, or null. Code fences are opened
 * first; then every `{` is tried as a start, scanning to its matching `}` with
 * strings and escapes respected, so a brace inside a heading never confuses it.
 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  const candidates: string[] = []
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = fence.exec(raw))) candidates.push(m[1])
  candidates.push(raw)
  for (const text of candidates) {
    for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
      const end = matchingBrace(text, start)
      if (end === -1) continue
      try {
        const v = JSON.parse(text.slice(start, end + 1)) as unknown
        if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
      } catch {
        // try the next '{'
      }
    }
  }
  return null
}

function matchingBrace(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

// A metadata line a model sometimes puts above a post: "Title: …",
// "**Meta description:** …", "SEO title - …", "Slug: …", "Keywords: …".
const META_LINE =
  /^\s*(?:\*\*|__)?\s*(?:post\s+)?(?:title|seo\s+title|meta\s+title|meta\s+description|description|slug|url|keywords?|tags?|category|cluster|audience|author|date|word\s+count|excerpt)\s*(?:\*\*|__)?\s*[:\-–—]/i

/**
 * Remove a leading title (H1), metadata lines, front matter, a leading
 * horizontal rule and blank lines from a draft; any other H1 becomes an H2.
 */
export function stripDraftHead(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  // Front matter block: --- … ---
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((l, n) => n > 0 && l.trim() === '---')
    if (close > 0) i = close + 1
  }
  for (; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t === '' || t === '---' || t === '***') continue
    if (/^#\s+/.test(t)) continue
    if (META_LINE.test(t)) continue
    break
  }
  return lines
    .slice(i)
    .map((l) => (/^#\s+/.test(l) ? `#${l}` : l))
    .join('\n')
    .trim()
}
