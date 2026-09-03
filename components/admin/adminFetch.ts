'use client'

import { submitError, submitSignal } from '@/lib/submit'

// adminFetch — fetch, plus the password prompt for destructive actions.
//
// The server decides which actions need a fresh password (lib/reauth.ts) and
// answers 401 with { reauth: true }. Putting the response to that in ONE place
// means an admin screen written later gets the behaviour by calling adminFetch
// instead of fetch, and cannot forget to handle it — a screen that forgets
// would show "Confirm your password to continue" as a raw error and leave the
// admin with no way to do so.
//
// window.prompt is deliberate. A styled modal would need to be mounted by every
// screen that might need it, which is the thing this helper exists to avoid,
// and the browser's own prompt is the one dialog on the page that a phishing
// overlay cannot imitate. It is also — usefully — impossible to submit by
// muscle memory.

export type AdminFetchResult<T = unknown> = {
  ok: boolean
  status: number
  data: T
}

async function attempt<T>(
  input: string,
  init?: RequestInit,
): Promise<{ res: Response; data: T & { reauth?: boolean; error?: string } } | { failure: string }> {
  try {
    const res = await fetch(input, { ...init, signal: submitSignal() })
    const data = (await res.json().catch(() => ({}))) as T & { reauth?: boolean; error?: string }
    return { res, data }
  } catch (e) {
    return { failure: submitError(e, 'Could not reach the server.') }
  }
}

export async function adminFetch<T = Record<string, unknown>>(
  input: string,
  init?: RequestInit,
): Promise<AdminFetchResult<T>> {
  const first = await attempt<T>(input, init)
  if ('failure' in first) {
    return { ok: false, status: 0, data: { error: first.failure } as T }
  }
  let res = first.res
  let data = first.data

  if (res.status === 401 && data?.reauth) {
    const password = window.prompt(
      'For your security, confirm your password before making this change.',
    )

    // Cancelled. Hand back the original refusal so the caller shows the
    // server's message rather than inventing one.
    if (!password) return { ok: false, status: res.status, data }

    const confirmed = await attempt<{ error?: string }>('/api/admin/reauth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if ('failure' in confirmed) {
      return { ok: false, status: 0, data: { error: confirmed.failure } as T }
    }

    if (!confirmed.res.ok) {
      return {
        ok: false,
        status: confirmed.res.status,
        data: { error: confirmed.data.error ?? 'That password is not right.' } as T,
      }
    }

    // Retry once. Only once: if it comes back asking again, something is wrong
    // with the clock or the session, and a loop would just keep asking.
    const second = await attempt<T>(input, init)
    if ('failure' in second) {
      return { ok: false, status: 0, data: { error: second.failure } as T }
    }
    res = second.res
    data = second.data
  }

  return { ok: res.ok, status: res.status, data }
}
