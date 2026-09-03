// lib/ai/anthropic.ts
//
// The Claude API, server-side only.
//
// ANTHROPIC_API_KEY IS NOT PREFIXED NEXT_PUBLIC_ AND MUST NEVER BE. This file
// is imported only from route handlers; a client component importing it would
// be a build-time leak of a billable credential into every browser bundle.
// `import 'server-only'` makes that a build error rather than a code review
// someone has to remember to do.
//
// Same discipline as lib/sms and lib/notify: `isConfigured()` is asked first
// and a missing key returns a stated failure rather than a cheerful success.
// Nothing here has a "pretend it worked" branch, because the caller's whole
// job is to fall back to something real when this cannot answer.

import 'server-only'

/**
 * The model.
 *
 * Sonnet rather than Haiku: this writes the words a parent puts their name to
 * on a public board, and it is one short call per job post -- a few hundred
 * tokens, a handful of times a day. Overridable so the model can be changed
 * without a deploy if the default is retired.
 */
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

/** How long to wait before giving up and letting the caller compose its own. */
const TIMEOUT_MS = 20_000

export type CompletionResult =
  | { ok: true; text: string }
  | { ok: false; reason: string }

export function isConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

/**
 * One completion. Returns the assistant's text, or a stated reason it could
 * not.
 *
 * NEVER THROWS. Every caller of this is on a path where the member is trying
 * to do something else -- post a job -- and a generation failure must not
 * become a failure of that. The reason string is for our logs; what the member
 * sees is the caller's fallback.
 */
export async function complete({
  system,
  prompt,
  maxTokens = 600,
  temperature = 0.4,
}: {
  system: string
  prompt: string
  maxTokens?: number
  temperature?: number
}): Promise<CompletionResult> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, reason: 'ANTHROPIC_API_KEY is not set' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      // The body can carry the real cause (bad key, rate limit, model name),
      // and it is worth having in the log. It never reaches the member.
      const detail = await res.text().catch(() => '')
      return { ok: false, reason: `anthropic ${res.status}: ${detail.slice(0, 300)}` }
    }

    const json = (await res.json()) as {
      content?: { type: string; text?: string }[]
    }

    const text = (json.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim()

    if (!text) return { ok: false, reason: 'anthropic returned no text' }
    return { ok: true, text }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return { ok: false, reason: aborted ? `timed out after ${TIMEOUT_MS}ms` : String(e) }
  } finally {
    clearTimeout(timer)
  }
}
