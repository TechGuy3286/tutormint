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
 * THE MODEL — one constant, changed here and nowhere else.
 *
 * Sonnet rather than Haiku: this writes words a member puts their name to on a
 * public page, a few hundred tokens a handful of times a day. The id below is
 * the current Sonnet-class model; `listModels()` reports what this key can
 * actually reach, and the generation route surfaces that list when a call
 * fails so the id can be checked against reality. Overridable by env so it can
 * be retargeted without a deploy if the default is retired.
 */
export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models'
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

export type ModelsResult =
  | { ok: true; ids: string[] }
  | { ok: false; reason: string }

/**
 * The models this key can reach (GET /v1/models).
 *
 * Used only to diagnose a failed completion: when a call comes back "model not
 * found", the accessible list tells us the right id to use instead of guessing.
 * NEVER THROWS, same as complete(); the reason string is for our logs and the
 * admin diagnostic, never the member.
 */
export async function listModels(): Promise<ModelsResult> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, reason: 'ANTHROPIC_API_KEY is not set' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${MODELS_ENDPOINT}?limit=100`, {
      signal: controller.signal,
      headers: { 'x-api-key': key, 'anthropic-version': API_VERSION },
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { ok: false, reason: `anthropic ${res.status}: ${detail.slice(0, 300)}` }
    }
    const json = (await res.json()) as { data?: { id?: string }[] }
    const ids = (json.data ?? []).map((m) => m.id ?? '').filter(Boolean)
    return { ok: true, ids }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return { ok: false, reason: aborted ? `timed out after ${TIMEOUT_MS}ms` : String(e) }
  } finally {
    clearTimeout(timer)
  }
}
