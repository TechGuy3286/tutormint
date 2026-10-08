// scripts/test-self-pause-live.ts — owner, 8 Oct 2026. OPT-IN, writes to the
// one database with a throwaway tutor that it deletes at the end:
//   SELF_PAUSE_LIVE=1 npx tsx --conditions=react-server --env-file=.env.local --test scripts/test-self-pause-live.ts
//
// Covers, against the real database and Auth:
//   * pausing hides the member (out of tutor_directory) and signs them out
//     (their refresh token stops working);
//   * the next sign-in restores them (back in tutor_directory);
//   * a staff-suspended account stays suspended — and paused — after sign-in.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

import { pauseMyAccount, restoreSelfPauseOnSignIn } from '../lib/selfPause'

const on = process.env.SELF_PAUSE_LIVE === '1'
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

test('pause hides + signs out; sign-in restores; a staff suspension survives sign-in', { skip: !on }, async () => {
  const svc = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } })
  const email = `selfpause.test.${Date.now()}@example.com`
  const password = `Sp-${Math.random().toString(36).slice(2)}A9!`
  const { data: created, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Self Pause Test', role: 'tutor' } })
  assert.ifError(error)
  const id = created.user!.id
  const inDirectory = async () => !!(await svc.from('tutor_directory').select('id').eq('id', id).maybeSingle()).data
  const signIn = async () => {
    const c = createClient(URL_, ANON, { auth: { persistSession: false } })
    const { data, error: e } = await c.auth.signInWithPassword({ email, password })
    assert.ifError(e)
    return data.session!
  }
  try {
    await svc.from('profiles').upsert({ id, email, full_name: 'Self Pause Test', role: 'tutor' }, { onConflict: 'id' })
    await svc.from('tutor_profiles').upsert({ id, slug: `self-pause-test-${Date.now()}` }, { onConflict: 'id' })
    assert.equal(await inDirectory(), true, 'a fresh tutor starts in the directory')

    const session = await signIn()
    const paused = await pauseMyAccount(id)
    assert.equal(paused.ok, true)
    assert.equal(await inDirectory(), false, 'paused → hidden')
    const c2 = createClient(URL_, ANON, { auth: { persistSession: false } })
    const { error: refreshError } = await c2.auth.refreshSession({ refresh_token: session.refresh_token })
    assert.ok(refreshError, 'paused → the old session can no longer refresh (signed out everywhere)')
    const { data: prof } = await svc.from('profiles').select('paused_by_user_at, is_suspended').eq('id', id).single()
    assert.ok(prof?.paused_by_user_at)
    assert.equal(prof?.is_suspended, false, 'a self-pause never sets the staff suspension')

    await signIn()
    assert.equal(await restoreSelfPauseOnSignIn(id), true, 'sign-in restores')
    assert.equal(await inDirectory(), true, 'restored → listed again')

    // Staff suspension: pause again, then suspend; signing in must not restore.
    assert.equal((await pauseMyAccount(id)).ok, true)
    await svc.from('profiles').update({ is_suspended: true, suspended_at: new Date().toISOString() }).eq('id', id)
    assert.equal(await restoreSelfPauseOnSignIn(id), false)
    const { data: after } = await svc.from('profiles').select('paused_by_user_at, is_suspended').eq('id', id).single()
    assert.equal(after?.is_suspended, true, 'still suspended after sign-in')
    assert.ok(after?.paused_by_user_at, 'and still paused')
    assert.equal(await inDirectory(), false)
    // A suspended account cannot self-pause either.
    await svc.from('profiles').update({ paused_by_user_at: null }).eq('id', id)
    assert.equal((await pauseMyAccount(id)).ok, false)
  } finally {
    for (const t of ['user_activity_log', 'activity_events', 'activity_sessions', 'notifications']) await svc.from(t).delete().eq('user_id', id)
    await svc.from('tutor_profiles').delete().eq('id', id)
    await svc.from('profiles').delete().eq('id', id)
    await svc.auth.admin.deleteUser(id)
  }
})
