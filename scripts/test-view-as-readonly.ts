/**
 * scripts/test-view-as-readonly.ts — "View as" without signing in (owner,
 * 27 Oct 2026): no session is minted for the member, their last sign-in is not
 * touched, every write is refused (database, storage, auth), the Owner alone
 * may start it, and the member is never counted as active. Invented data only.
 *   npm run test:viewasreadonly
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { guardFetch, VIEW_AS_READ_RPCS, viewAsUiMemberId, viewAsWriteBlocked } from '../lib/viewAsGuardCore'
import { viewAsDecision, VIEW_AS_MS } from '../lib/viewAsCore'

const read = (p: string) => readFileSync(p, 'utf8')
const SB = 'https://example-ref.supabase.co'
const MEMBER = '11111111-2222-4333-8444-555555555555'

test('no session is minted for the member and their last sign-in is never touched', () => {
  const lib = read('lib/viewAs.ts')
  // None of the calls that sign someone in, or move auth.users.last_sign_in_at.
  for (const call of ['generateLink', 'verifyOtp', 'signInWithPassword', 'signInWithOtp', 'setSession(', 'getUserById']) {
    assert.ok(!lib.includes(call), `lib/viewAs.ts must not call ${call}`)
  }
  assert.match(lib, /session_id: randomUUID\(\)/, 'the stored id matches no real session')
  assert.match(lib, /signedIn: false/)
  // The member's user is READ (GET /auth/v1/admin/users/<id>), never signed in.
  const ctx = read('lib/viewAsContext.ts')
  assert.match(ctx, /admin\.auth\.admin\.getUserById\(/)
  assert.ok(!/generateLink|verifyOtp|setSession/.test(ctx))
  assert.equal(viewAsWriteBlocked(`${SB}/auth/v1/admin/users/${MEMBER}`, 'GET'), false)
})

test('the view only applies to the Owner who started it, with a live, signed ticket', () => {
  const ctx = read('lib/viewAsContext.ts')
  assert.match(ctx, /get\(VIEW_AS_HEADER\) === '1'/)
  assert.match(ctx, /readTicket\(jar\.get\(VIEW_AS_COOKIE\)/)
  assert.match(ctx, /row\.ended_at \|\| Date\.parse\(row\.expires_at as string\) <= Date\.now\(\)/)
  assert.match(ctx, /realUser\.id !== row\.owner_id/)
  assert.match(ctx, /owner\?\.admin_role !== 'owner'/)
  const start = read('app/api/admin/view-as/start/route.ts')
  assert.match(start, /refuseUnlessOwnerApproval\(gate\.actor/)
  assert.match(start, /requireFreshAuth\(gate\.actor\.id\)/)
  // The header is stamped by the proxy only — always overwritten or removed —
  // and never on the exit route (which must write to end the view).
  const proxy = read('proxy.ts')
  assert.match(proxy, /pathname !== VIEW_AS_EXIT_PATH\) headers\.set\(VIEW_AS_HEADER, '1'\)\s*else headers\.delete\(VIEW_AS_HEADER\)/)
  // A normal request still gets the plain cookie client.
  assert.match(read('lib/supabase/server.ts'), /if \(ctx\) return viewAsClient\(ctx\)[^\n]*\n\s*return createRealClient\(opts\)/)
})

test('every database, storage and auth write is refused; reads pass', () => {
  const writes: Array<[string, string]> = [
    [`${SB}/rest/v1/profiles?id=eq.${MEMBER}`, 'PATCH'],
    [`${SB}/rest/v1/tutor_profiles`, 'POST'],
    [`${SB}/rest/v1/messages?id=eq.x`, 'DELETE'],
    [`${SB}/rest/v1/rpc/consume_rate_limit`, 'POST'],
    [`${SB}/rest/v1/rpc/bump_activity_session`, 'POST'],
    [`${SB}/rest/v1/rpc/revoke_user_sessions`, 'POST'],
    [`${SB}/storage/v1/object/avatars/${MEMBER}/photo.jpg`, 'POST'],
    [`${SB}/storage/v1/object/identity-docs/x.jpg`, 'PUT'],
    [`${SB}/storage/v1/object/avatars/x.jpg`, 'DELETE'],
    [`${SB}/auth/v1/user`, 'PUT'], // password, email or phone change
    [`${SB}/auth/v1/otp`, 'POST'],
    [`${SB}/auth/v1/logout`, 'POST'],
    [`${SB}/auth/v1/signup`, 'POST'],
    [`${SB}/auth/v1/admin/users/${MEMBER}`, 'PUT'],
    [`${SB}/auth/v1/verify`, 'POST'],
  ]
  for (const [url, method] of writes) assert.equal(viewAsWriteBlocked(url, method), true, `${method} ${url}`)
  const reads: Array<[string, string]> = [
    [`${SB}/rest/v1/profiles?select=*`, 'GET'],
    [`${SB}/rest/v1/jobs?select=id`, 'HEAD'],
    [`${SB}/rest/v1/rpc/rank_tutors`, 'POST'],
    [`${SB}/storage/v1/object/sign/identity-docs/x.jpg`, 'POST'],
    [`${SB}/auth/v1/token?grant_type=refresh_token`, 'POST'], // the Owner's own session refresh
    [`${SB}/auth/v1/user`, 'GET'],
  ]
  for (const [url, method] of reads) assert.equal(viewAsWriteBlocked(url, method), false, `${method} ${url}`)
  assert.ok(!VIEW_AS_READ_RPCS.has('consume_rate_limit'))
})

test('the guard answers 403 without calling Supabase, only while viewing', async () => {
  let calls = 0
  const inner = (async () => {
    calls++
    return new Response('[]', { status: 200 })
  }) as typeof fetch
  const viewing = guardFetch(inner, () => true)
  const res = await viewing(`${SB}/rest/v1/profiles?id=eq.${MEMBER}`, { method: 'PATCH', body: '{"full_name":"X"}' })
  assert.equal(res.status, 403)
  assert.equal(((await res.json()) as { code: string }).code, '42501')
  assert.equal(calls, 0, 'the write never left the server')
  assert.equal((await viewing(`${SB}/rest/v1/profiles?select=id`)).status, 200)
  assert.equal(calls, 1)
  const normal = guardFetch(inner, () => false)
  assert.equal((await normal(`${SB}/rest/v1/profiles?id=eq.${MEMBER}`, { method: 'PATCH' })).status, 200, 'a normal request is untouched')
})

test('every server and browser Supabase client goes through the guard', () => {
  assert.match(read('lib/supabase/fetch.ts'), /export const supabaseFetch: FetchFn = guardFetch\(makeSupabaseFetch\(\), requestIsViewAs\)/)
  for (const f of ['lib/supabase/serverReal.ts', 'lib/supabase/admin.ts']) assert.match(read(f), /fetch: supabaseFetch/, f)
  const server = read('lib/supabase/server.ts')
  assert.match(server, /global: \{ fetch: supabaseFetch \}/)
  for (const name of ['updateUser', 'signOut', 'verifyOtp', 'setSession', 'refreshSession', 'resetPasswordForEmail']) assert.ok(server.includes(`'${name}'`), name)
  const browser = read('lib/supabase/client.ts')
  assert.match(browser, /isSingleton: false, global: \{ fetch: guardFetch\(/)
  for (const name of ['updateUser', 'signOut', 'verifyOtp', 'resetPasswordForEmail']) assert.ok(browser.includes(`'${name}'`), name)
  assert.equal(viewAsUiMemberId(`a=1; tm_view_as_ui=${MEMBER}; b=2`), MEMBER)
  assert.equal(viewAsUiMemberId('tm_view_as_ui=1'), null)
})

test('pages, API writes, /api/auth and the activity beacon are refused by the proxy', () => {
  const t = { id: MEMBER, expiresAt: Date.parse('2026-10-27T12:00:00Z') + VIEW_AS_MS }
  const now = Date.parse('2026-10-27T12:00:00Z')
  assert.equal(viewAsDecision(t, { method: 'POST', pathname: '/api/activity' }, now), 'block', 'no visit is recorded as the member’s')
  assert.equal(viewAsDecision(t, { method: 'POST', pathname: '/api/auth/login' }, now), 'block')
  assert.equal(viewAsDecision(t, { method: 'GET', pathname: '/api/auth/callback' }, now), 'block')
  assert.equal(viewAsDecision(t, { method: 'POST', pathname: '/api/profile/save' }, now), 'block')
  assert.equal(viewAsDecision(t, { method: 'POST', pathname: '/api/documents/upload' }, now), 'block')
  assert.equal(viewAsDecision(t, { method: 'GET', pathname: '/tutor/dashboard' }, now), 'pass')
})

test('the banner, the 30-minute limit, Exit and the logging stay', () => {
  assert.equal(VIEW_AS_MS, 30 * 60_000)
  const lib = read('lib/viewAs.ts')
  assert.match(lib, /action: 'member\.view_as_start'/)
  assert.match(lib, /action: 'member\.view_as_end'/)
  assert.match(read('components/ViewAsBanner.tsx'), /Viewing as \{name\} — read only/)
  assert.match(read('components/SiteChrome.tsx'), /await currentViewAs\(\)/)
  assert.match(read('app/api/cron/paypro-reconcile/route.ts'), /await endExpiredViews\(\)/)
})
