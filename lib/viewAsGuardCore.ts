// lib/viewAsGuardCore.ts — PURE, no imports. "View as" without signing in
// (owner, 27 Oct 2026).
//
// While the Owner views a member's account, every Supabase request made for the
// page — on the server (lib/supabase/fetch) and in the browser
// (lib/supabase/client) — goes through viewAsWriteBlocked() first. Reads pass;
// every change is answered 403 without reaching Supabase:
//
//   - GET / HEAD pass (selects, auth getUser, admin getUserById, storage reads);
//   - POST /auth/v1/token passes — it refreshes the OWNER's own session, which
//     is the only session in the browser;
//   - POST /storage/v1/object/sign/… passes — it makes a read link;
//   - POST /rest/v1/rpc/<fn> passes only for the read-only functions below;
//   - everything else (insert, update, upsert, delete, any other RPC, a file
//     upload, a password / email / phone change, sign-in, sign-out) is refused.

/** The header proxy.ts stamps (always overwritten or removed) on a request made
 *  while a live View-as ticket is in the browser — not on the exit route. */
export const VIEW_AS_HEADER = 'x-tm-view-as'

/** Read-only database functions a member's pages call. Anything not listed is
 *  treated as a write. */
export const VIEW_AS_READ_RPCS: ReadonlySet<string> = new Set([
  'is_blocked_pair',
  'rank_tutors',
  'listed_tutor_slugs',
  'indexable_tuitions',
  'indexable_job_slugs',
  'tutor_slug_redirect',
  'tutor_public_page',
  'tutor_canonical_slug',
  'search_suggest',
  'popular_subjects',
  'job_applied_counts',
  'cnic_in_use',
  'can_review_tutor',
])

export const VIEW_AS_REFUSED_MESSAGE = 'Viewing as this member — read only. Exit to make changes.'

export function viewAsWriteBlocked(url: string, method: string): boolean {
  const m = (method || 'GET').toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    /* a relative path — use it as is */
  }
  if (m === 'POST' && /\/auth\/v1\/token$/.test(path)) return false
  if (m === 'POST' && path.includes('/storage/v1/object/sign/')) return false
  const rpc = /\/rest\/v1\/rpc\/([a-z0-9_]+)$/i.exec(path)
  if (m === 'POST' && rpc) return !VIEW_AS_READ_RPCS.has(rpc[1].toLowerCase())
  return true
}

/** The 403 a refused request gets — shaped like a PostgREST error so
 *  supabase-js reports `{ error }` instead of throwing. */
export function viewAsRefusal(): Response {
  return new Response(JSON.stringify({ message: VIEW_AS_REFUSED_MESSAGE, code: '42501', details: null, hint: null }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  })
}

/** Wrap a fetch so that, when isViewAs() says so, writes are refused. */
export function guardFetch(inner: typeof fetch, isViewAs: () => boolean | Promise<boolean>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? (typeof input === 'object' && !(input instanceof URL) && 'method' in input ? input.method : 'GET')
    if (viewAsWriteBlocked(url, method) && (await isViewAs())) return viewAsRefusal()
    return inner(input, init)
  }) as typeof fetch
}

/** The readable browser cookie's value: the member's id, so the browser client
 *  can answer "who am I" as the member (reads then go through the Owner's own
 *  session, which may read every row an admin may). */
export function viewAsUiMemberId(cookieHeader: string | null | undefined): string | null {
  const m = /(?:^|;\s*)tm_view_as_ui=([0-9a-f-]{36})(?:;|$)/i.exec(cookieHeader ?? '')
  return m ? m[1] : null
}
