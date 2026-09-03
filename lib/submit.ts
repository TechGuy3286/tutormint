// lib/submit.ts
//
// The two things every submit control on the platform was missing.
//
// THE AUDIT. 54 submit handlers across app/ and components/ set a busy flag.
// Fifteen of them could not clear it on some path -- eight navigate on success
// and clear nothing, on the assumption that the page is about to be replaced --
// and ALL FIFTY-FOUR passed an unbounded fetch. A `finally { setBusy(false) }`
// looks like the fix and is not: it runs when the promise settles, and a
// request that never settles never runs it. A spinner with no exit is the same
// bug whether the cause is a missing branch or a hung socket.
//
// So there are two helpers here, and between them a control cannot be left
// spinning:
//
//   submitSignal()      bounds the request. Ten seconds, then the fetch
//                       rejects with an AbortError and whatever `finally` the
//                       caller has actually runs.
//
//   armEscape()         bounds the NAVIGATION. A handler that hands off to
//                       router.push deliberately keeps its spinner, because
//                       re-enabling the button during a route change invites a
//                       double submit. This gives that spinner a deadline: if
//                       the page is still here ten seconds later, the caller
//                       is told and can say so.
//
// Client-safe: no server imports, so a client component may pull it in.

/**
 * How long any one submit may take before the member is told something.
 *
 * Ten seconds is chosen against a person waiting, not against a p99: past
 * about that point somebody has already decided the button is broken and is
 * pressing it again. Long enough that a slow Pakistani mobile connection on a
 * cold lambda still completes; short enough that "it is stuck" is a message
 * rather than a guess.
 */
export const SUBMIT_TIMEOUT_MS = 10_000

/**
 * The bound for a file upload.
 *
 * Six times the interactive one, because it is a different promise: a CNIC
 * photo or a degree certificate over a Pakistani mobile connection legitimately
 * takes tens of seconds, and cutting that off at ten would turn a slow upload
 * into a failed one. What it is NOT is unbounded -- a stalled upload still ends
 * in a message rather than a permanent spinner.
 */
export const UPLOAD_TIMEOUT_MS = 60_000

export const TIMEOUT_MESSAGE =
  'That is taking longer than it should. Check your connection and try again.'

export const STUCK_MESSAGE =
  'That worked, but this page has not moved. Use the link below to continue.'

/**
 * An abort signal for a submit.
 *
 * `AbortSignal.timeout` where it exists, and a plain controller where it does
 * not -- the fallback is not decoration: this ships to whatever browser a
 * parent in Lahore happens to have, and a missing static method would
 * otherwise throw INSIDE the try and be reported as "could not reach the
 * server" on a request that was never made.
 */
export function submitSignal(ms: number = SUBMIT_TIMEOUT_MS): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

/** True when a caught error is our own timeout rather than a network failure. */
export function isTimeout(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'TimeoutError' || error.name === 'AbortError'
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

/**
 * What to show for a failed submit, in one place.
 *
 * A timeout and a dead connection are different facts and deserve different
 * words; anything else is the caller's own message, or a last-resort sentence
 * that is still a sentence rather than "[object Object]".
 */
export function submitError(error: unknown, fallback: string): string {
  if (isTimeout(error)) return TIMEOUT_MESSAGE
  if (error instanceof TypeError) return 'Could not reach the server. Check your connection.'
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * A deadline for a navigation that may not happen.
 *
 * Call it immediately before router.push(). If the component is still mounted
 * when it fires, the push did not take -- a same-URL push, a route that
 * redirected back, or an RSC fetch that never returned -- and the caller shows
 * a way out instead of a spinner.
 *
 * Returns a cancel function. Nothing bad happens if it is never called: React
 * ignores a setState on an unmounted component, so a page that navigated away
 * simply drops the timer's effect on the floor.
 */
export function armEscape(onStuck: () => void, ms: number = SUBMIT_TIMEOUT_MS): () => void {
  const id = setTimeout(onStuck, ms)
  return () => clearTimeout(id)
}

/**
 * POST JSON, and always settle.
 *
 * Never throws and never hangs: a timeout, a dead network, an HTML error page
 * where JSON was expected, and a 500 with an empty body all come back as the
 * same shape. "Unexpected shape" was one of the outcomes the login form had no
 * branch for -- here it has nowhere to hide.
 */
export async function submitJson<T = Record<string, unknown>>(
  url: string,
  body: unknown,
  init: Omit<RequestInit, 'body' | 'signal'> = {},
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      body: JSON.stringify(body),
      signal: submitSignal(),
    })

    const text = await res.text()
    let data: T | null = null
    try {
      data = text ? (JSON.parse(text) as T) : null
    } catch {
      // A proxy error page, a gateway timeout, an empty 502. The status is
      // still the truth; the body is not JSON and pretending otherwise is how
      // a form ends up awaiting a shape that never arrives.
      return {
        ok: false,
        status: res.status,
        data: null,
        error: 'The server sent something we could not read. Please try again.',
      }
    }

    const error = res.ok
      ? null
      : ((data as { error?: string } | null)?.error ?? 'Something went wrong. Please try again.')

    return { ok: res.ok, status: res.status, data, error }
  } catch (e) {
    return { ok: false, status: 0, data: null, error: submitError(e, 'Could not reach the server.') }
  }
}

/**
 * POST a FormData body, and always settle.
 *
 * The upload twin of submitJson. Same result shape, so a caller reads one
 * `if (!ok)`, and the same guarantee: it neither throws nor hangs.
 */
export async function submitForm<T = Record<string, unknown>>(
  url: string,
  body: FormData,
  timeoutMs: number = UPLOAD_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  try {
    // No Content-Type header: the browser must set the multipart boundary.
    const res = await fetch(url, { method: 'POST', body, signal: submitSignal(timeoutMs) })
    const text = await res.text()
    let data: T | null = null
    try {
      data = text ? (JSON.parse(text) as T) : null
    } catch {
      return {
        ok: false,
        status: res.status,
        data: null,
        error: 'The server sent something we could not read. Please try again.',
      }
    }
    const error = res.ok
      ? null
      : ((data as { error?: string } | null)?.error ?? 'That upload did not work. Please try again.')
    return { ok: res.ok, status: res.status, data, error }
  } catch (e) {
    return { ok: false, status: 0, data: null, error: submitError(e, 'That upload did not work.') }
  }
}
