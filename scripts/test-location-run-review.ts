// scripts/test-location-run-review.ts — Review added areas (owner, 16 Oct 2026).
//   npm run test:locationrunreview
// The warnings, the action checks, Owner-only actions and the merged-area
// redirect.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { areaWarnings, closeSpelling, confirmLine, runActionProblem } from '../lib/locationRunCore'
import { canApprove } from '../lib/adminAccessCore'
import { areaHubSlug, areaHubsFor, hubSlugRedirect } from '../lib/areaHubCore'

const CITIES = ['Lahore', 'Karachi', 'Islamabad']

test('warnings on added areas', () => {
  const w = (name: string, city = 'Karachi', others: string[] = ['Gulshan-e-Iqbal', 'Liaqatabad', 'Clifton']) => areaWarnings(name, city, others, CITIES).warnings
  assert.ok(w('Gulshan Block').includes('landmark_words'))
  assert.ok(w('Qanchi Metro Stop', 'Lahore').includes('landmark_words'))
  assert.deepEqual(w('12'), ['digits_only'])
  assert.ok(w('Ab').includes('too_short'))
  assert.ok(w('Karachi Cantt').includes('city_in_name'))
  assert.ok(w('Liaqatbad').includes('close_spelling'))
  assert.equal(areaWarnings('Liaqatbad', 'Karachi', ['Liaqatabad'], CITIES).closeTo, 'Liaqatabad')
  assert.ok(w('test').includes('junk'))
  assert.deepEqual(w('Askari-2'), [])
  // The same name written twice is two rows for one area.
  assert.equal(closeSpelling('Askari -2', 'Karachi', ['Askari-2']), 'Askari-2')
  assert.equal(closeSpelling('Johar', 'Karachi', ['Clifton']), null)
})

test('action checks before sending', () => {
  assert.equal(runActionProblem({ kind: 'area', id: 1, decision: 'merge', intoAreaId: 0 }), 'Choose the area it is the same as.')
  assert.equal(runActionProblem({ kind: 'area', id: 1, decision: 'merge', intoAreaId: 1 }), 'Choose a different area.')
  assert.equal(runActionProblem({ kind: 'area', id: 1, decision: 'split', intoAreaId: 2, landmark: ' ' }), 'Type the Block / landmark.')
  assert.equal(runActionProblem({ kind: 'area', id: 1, decision: 'split', intoAreaId: 2, landmark: 'Block 1' }), null)
  assert.equal(runActionProblem({ kind: 'ignored', id: 1, decision: 'actually_area', name: 'x' }), 'Enter the area name.')
  assert.equal(runActionProblem({ kind: 'alias', id: 1, decision: 'rematch', areaId: 0 }), 'Choose the area it is the same as.')
  assert.match(confirmLine(12), /^Apply 12 changes\?/)
})

test('Locations review actions are refused for every role but the Owner', () => {
  for (const r of ['admin', 'operations', 'tuitions_staff', 'partner'] as const) assert.equal(canApprove(r), false, r)
  assert.equal(canApprove('owner'), true)
  const route = readFileSync('app/api/admin/locations/run-review/route.ts', 'utf8')
  const post = route.slice(route.indexOf('export async function POST'))
  assert.ok(post.indexOf('refuseUnlessOwnerApproval') > 0, 'POST checks the Owner')
  assert.ok(post.indexOf('refuseUnlessOwnerApproval') < post.indexOf('applyRunActions'), 'before any write')
  // The older Locations routes stay Owner-only too.
  assert.match(readFileSync('app/api/admin/locations/route.ts', 'utf8'), /refuseUnlessOwnerApproval/)
})

test('nothing is deleted', () => {
  const lib = readFileSync('lib/locationRunReview.ts', 'utf8')
  assert.ok(!/\.delete\(/.test(lib), 'no delete')
  assert.ok(!/from\('jobs'\)\.update\(\{ area:/.test(lib), 'jobs.area never rewritten')
  assert.ok(!/from\('profiles'\)\.update/.test(lib), 'profiles never rewritten')
})

test('a merged area\'s hub moves permanently to the area it joined', () => {
  // Before the merge "Gulshan Block" is its own curated area with a hub.
  const before = ['Gulshan-e-Iqbal', 'Gulshan Block']
  assert.equal(areaHubSlug('Gulshan Block', 'Karachi'), 'gulshan-block')
  assert.ok(areaHubsFor('Karachi', ['Gulshan Block', 'Gulshan Block', 'Gulshan Block'], before).some((h) => h.slug === 'gulshan-block'))
  // After: retired (out of the curated list) and saved as a spelling of Gulshan-e-Iqbal.
  const after = ['Gulshan-e-Iqbal']
  const aliases = { 'gulshan block': 'Gulshan-e-Iqbal' }
  assert.equal(hubSlugRedirect('Karachi', 'gulshan-block', after, aliases), 'gulshan-e-iqbal')
  // …and it is never a hub of its own again.
  assert.ok(!areaHubsFor('Karachi', ['Gulshan Block'], after, aliases).some((h) => h.slug === 'gulshan-block'))
  // proxy.ts answers that move with a 301.
  assert.match(readFileSync('proxy.ts', 'utf8'), /areaHubRedirectPath[\s\S]{0,200}NextResponse\.redirect\(target, 301\)/)
  // The merge saves the area's own name as the spelling.
  assert.match(readFileSync('lib/locationRunReview.ts', 'utf8'), /raw: from\.name, area_id: into\.id/)
})

test('an area marked not an area is never a hub', () => {
  // Retired areas are out of every curated read.
  for (const f of ['lib/cityJobs.ts', 'lib/areaHubRedirect.ts']) assert.match(readFileSync(f, 'utf8'), /removed_at/)
  assert.deepEqual(areaHubsFor('Lahore', ['Qanchi Metro Stop', 'Qanchi Metro Stop', 'Qanchi Metro Stop'], ['Johar Town']), [])
})
