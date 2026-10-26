/**
 * scripts/test-view-as-and-fixes.ts — "View as" (owner only, read only,
 * expiring, logged) and the small fixes: the People-card badge on the name
 * line, the masked member-page header with a logged Show, the AI assistants
 * source, and no secrets in logs (owner, 26 Oct 2026). Invented data only.
 *   npm run test:viewas
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { makeTicket, readTicket, sessionIdOf, ticketExpired, VIEW_AS_EXIT_PATH, VIEW_AS_MS, viewAsDecision } from '../lib/viewAsCore'
import { maskEmailDisplay, maskPhoneDisplay, realEmail } from '../lib/contactMaskCore'
import { aiAssistantTotals } from '../lib/signupSourceCore'

const read = (p: string) => readFileSync(p, 'utf8')
const SECRET = 'test-secret-not-real'
const NOW = Date.parse('2026-10-26T12:00:00Z')

test('View as is owner only, with the password asked again', () => {
  const start = read('app/api/admin/view-as/start/route.ts')
  assert.match(start, /refuseUnlessOwnerApproval\(gate\.actor/)
  assert.match(start, /requireFreshAuth\(gate\.actor\.id\)/)
  assert.match(read('components/admin/ViewAsButton.tsx'), /useCanApprove\(\)/)
  assert.match(read('app/admin/users/[id]/page.tsx'), /canApprove\(actor\.adminRole\)[^\n]*\n?[^\n]*<ViewAsButton/)
})

test('read only: every write answers 403 while viewing; the exit route passes', () => {
  const t = { id: '11111111-2222-4333-8444-555555555555', expiresAt: NOW + VIEW_AS_MS }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(viewAsDecision(t, { method, pathname: '/api/profile/save' }, NOW), 'block', method)
    assert.equal(viewAsDecision(t, { method, pathname: '/tutor/dashboard' }, NOW), 'block', `${method} on a page (server action)`)
  }
  assert.equal(viewAsDecision(t, { method: 'GET', pathname: '/tutor/dashboard' }, NOW), 'pass')
  assert.equal(viewAsDecision(t, { method: 'GET', pathname: '/api/admin/whatsapp' }, NOW), 'block')
  assert.equal(viewAsDecision(t, { method: 'GET', pathname: '/api/auth/confirm-email' }, NOW), 'block')
  assert.equal(viewAsDecision(t, { method: 'POST', pathname: VIEW_AS_EXIT_PATH }, NOW), 'pass')
  const proxy = read('proxy.ts')
  assert.match(proxy, /if \(decision === 'block' \|\| \(decision === 'exit' && isApi\)\) \{\s*return NextResponse\.json\(\{ error: VIEW_AS_READ_ONLY, viewAs: true \}, \{ status: 403 \}\)/)
  // The database refuses every write made with the minted session too.
  const sql = read('supabase/migrations/201_status_merge_parents_viewas.sql')
  assert.match(sql, /as restrictive for insert to authenticated with check \(not \(select public\.is_view_as_session\(\)\)\)/)
  assert.match(sql, /as restrictive for update to authenticated/)
  assert.match(sql, /as restrictive for delete to authenticated/)
  assert.match(sql, /on storage\.objects as restrictive for insert/)
  // A password or email change from the browser is refused as well.
  // (27 Oct: every browser write is refused — scripts/test-view-as-readonly.ts.)
  assert.match(read('lib/supabase/client.ts'), /viewAsUiMemberId\(document\.cookie\)[\s\S]{0,1500}'updateUser'/)
})

test('it expires after 30 minutes, and a forged or stretched ticket is refused', () => {
  assert.equal(VIEW_AS_MS, 30 * 60_000)
  const t = { id: '11111111-2222-4333-8444-555555555555', expiresAt: NOW + VIEW_AS_MS }
  const raw = makeTicket(t, SECRET)
  assert.deepEqual(readTicket(raw, SECRET), t)
  assert.equal(readTicket(raw, 'another-secret'), null)
  const [id, , mac] = raw.split('.')
  assert.equal(readTicket(`${id}.${NOW + 10 * VIEW_AS_MS}.${mac}`, SECRET), null, 'cannot be stretched')
  assert.equal(readTicket('nonsense', SECRET), null)
  assert.equal(ticketExpired(t, NOW + VIEW_AS_MS), true)
  assert.equal(viewAsDecision(t, { method: 'GET', pathname: '/tutor/dashboard' }, NOW + VIEW_AS_MS + 1), 'exit')
  assert.match(read('app/api/cron/paypro-reconcile/route.ts'), /await endExpiredViews\(\)/, 'ended even when the browser never comes back')
})

test('start and end are logged (Audit and the member’s Activity tab); no password or code is shown', () => {
  const lib = read('lib/viewAs.ts')
  assert.match(lib, /action: 'member\.view_as_start'/)
  assert.match(lib, /action: 'member\.view_as_end'/)
  // 27 Oct 2026: no session is minted for the member at all.
  assert.doesNotMatch(lib, /generateLink|verifyOtp|setSession\(/, 'nobody is signed in as the member')
  assert.doesNotMatch(lib, /console\.(log|warn|info)/)
  const journey = read('lib/journey.ts')
  assert.match(journey, /'member\.view_as_start',\s*'member\.view_as_end',/)
  // The minted session's id is read from the token.
  const payload = Buffer.from(JSON.stringify({ session_id: 'abc-123' })).toString('base64url')
  assert.equal(sessionIdOf(`x.${payload}.y`), 'abc-123')
  assert.match(read('components/ViewAsBanner.tsx'), /Viewing as \{name\} — read only/)
})

test('People cards: the Verified badge sits on the name line', () => {
  const grid = read('components/admin/OverviewCardGrid.tsx')
  assert.match(grid, /<p className="flex min-h-\[20px\] min-w-0 items-center gap-1\.5" data-name-row="">\s*<span className="min-w-0 truncate[^"]*">\{m\.name\}<\/span>\s*\{m\.badges\.length > 0 && <BadgeRow[^>]*nowrap \/>\}/)
  assert.match(read('components/badges/BadgeRow.tsx'), /nowrap \? 'flex-nowrap' : 'flex-wrap'/)
})

test('the member page header: masked phone, real email only, a logged Show', () => {
  assert.equal(maskPhoneDisplay('923481234733'), '0348 •••• 733')
  assert.equal(maskPhoneDisplay('0348-1234733'), '0348 •••• 733')
  assert.equal(maskPhoneDisplay(null), null)
  assert.equal(maskEmailDisplay('923481234733@users.tutormint.org'), null, 'the auto-made address is never shown')
  assert.equal(maskEmailDisplay('ayesha.example@gmail.com'), 'ay•••@gmail.com')
  assert.equal(realEmail('923481234733@users.tutormint.org'), null)
  const page = read('app/admin/users/[id]/page.tsx')
  assert.doesNotMatch(page, /\{profile\.email as string\}\s*\{profile\.phone_number \?/)
  assert.match(page, /<MaskedContact memberId=\{id\} field="phone" masked=\{headerPhone\} \/>/)
  const route = read('app/api/admin/members/reveal-contact/route.ts')
  assert.ok(route.indexOf("action: 'member.contact_reveal'") < route.indexOf('value }'), 'Audit is written before the value is returned')
  assert.match(route, /detail: \{ field \}/, 'the value itself is never logged')
})

test('AI assistants: sign-ups and paid tutors for 7 days, 30 days and all time', () => {
  const t = aiAssistantTotals(
    [
      { createdAtMs: NOW - 2 * 86_400_000, utmSource: 'chatgpt.com', role: 'tutor', paid: true },
      { createdAtMs: NOW - 10 * 86_400_000, utmSource: 'gemini.google.com', role: 'parent', paid: false },
      { createdAtMs: NOW - 40 * 86_400_000, utmSource: 'perplexity.ai', role: 'tutor', paid: true },
      { createdAtMs: NOW - 1 * 86_400_000, utmSource: 'facebook', role: 'tutor', paid: true },
      { createdAtMs: NOW - 3 * 86_400_000, utmSource: 'claude.ai', role: 'tutor', paid: false },
    ],
    NOW,
  )
  assert.deepEqual(t.signups, { last7: 2, last30: 3, all: 4 })
  assert.deepEqual(t.paidTutors, { last7: 1, last30: 1, all: 2 })
  assert.deepEqual(t.sites.map((s) => s.site).sort(), ['chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'])
  assert.match(read('app/admin/page.tsx'), /<AiAssistantsTable ai=\{ai\} \/>/)
  assert.match(read('lib/signupSourceCore.ts'), /return \['AI assistant', site, \.\.\.rest\]\.join\(' · '\)/, 'the member page keeps "AI assistant · <site>"')
})

test('no secrets, phones, emails or account numbers in logs (the new code)', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(f)) files.push(p)
    }
  }
  for (const d of ['app/api/admin/view-as', 'app/api/admin/members/merge', 'app/api/admin/members/duplicates', 'app/api/admin/members/reveal-contact', 'app/api/admin/follow-ups/status-image', 'app/api/admin/follow-ups/parent', 'app/api/tutor/social/status', 'app/api/tutor/status-card']) walk(d)
  files.push(
    'lib/viewAs.ts',
    'lib/viewAsCore.ts',
    'lib/memberMerge.ts',
    'lib/memberDuplicates.ts',
    'lib/parentFollowUps.ts',
    'lib/social/statusImage.ts',
    'lib/social/imageVersion.ts',
    'lib/contactMaskCore.ts',
    'lib/mergedTutorRedirect.ts',
  )
  for (const f of files) {
    const src = read(f)
    const logs = src.match(/console\.(log|warn|error|info)\([^)]*\)/g) ?? []
    for (const l of logs) assert.doesNotMatch(l, /phone|email|cnic|iban|account|token|password|secret|key|msisdn/i, `${f}: ${l}`)
  }
})
