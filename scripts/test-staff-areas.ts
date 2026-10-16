/**
 * scripts/test-staff-areas.ts — npm run test:staffareas
 *
 * Staff can add a new area while posting a tuition (owner, 13 Oct 2026): what
 * the field offers, that an added area is saved to the curated list with an
 * audit row, and that a parent's or tutor's free text still goes to the
 * Locations review list as before. Pure rules + source checks.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { addedByLine, staffAreaAdvice } from '../lib/staffAreaCore'
import { areaKey } from '../lib/areaHubCore'

const read = (p: string) => readFileSync(p, 'utf8')
const LAHORE = ['DHA Lahore', 'Gulberg', 'Johar Town', 'Model Town', 'Harbanspura', 'Bahria Town Lahore', 'Wapda Town']

test('a curated area, or a spelling that already counts as one, needs nothing', () => {
  assert.deepEqual(staffAreaAdvice('Lahore', 'Gulberg', LAHORE), { kind: 'listed', area: 'Gulberg', exact: true })
  assert.deepEqual(staffAreaAdvice('Lahore', '  johar town ', LAHORE), { kind: 'listed', area: 'Johar Town', exact: true })
  // "DHA" is the curated "DHA Lahore" without its city.
  assert.equal(staffAreaAdvice('Lahore', 'DHA', LAHORE).kind, 'listed')
  // An approved alias.
  const aliases = { [areaKey('Harbnspura', 'Lahore')]: 'Harbanspura' }
  assert.deepEqual(staffAreaAdvice('Lahore', 'Harbnspura', LAHORE, aliases), { kind: 'listed', area: 'Harbanspura', exact: false })
  assert.deepEqual(staffAreaAdvice('Lahore', '', LAHORE), { kind: 'empty' })
})

test('a new area: "Did you mean" when one is close, and "Add" with the cleaned name', () => {
  // Nothing like it: add it, proper-cased, extra spaces removed, their spelling kept.
  assert.deepEqual(staffAreaAdvice('Lahore', '  izmir   town ', LAHORE), { kind: 'new', didYouMean: null, addName: 'Izmir Town' })
  assert.deepEqual(staffAreaAdvice('Lahore', 'dha rahbar', LAHORE).kind, 'new')
  assert.equal((staffAreaAdvice('Lahore', 'pia housing scheme', LAHORE) as { addName: string }).addName, 'PIA Housing Scheme')
  // A close match is offered AND the add stays available.
  const close = staffAreaAdvice('Lahore', 'Joher Toun', LAHORE)
  assert.equal(close.kind, 'new')
  if (close.kind === 'new') {
    assert.equal(close.didYouMean, 'Johar Town')
    assert.equal(close.addName, 'Joher Toun')
  }
  // A longer text that names a curated area offers that area too.
  assert.equal((staffAreaAdvice('Lahore', 'Gulberg 3 near main market', LAHORE) as { didYouMean: string | null }).didYouMean, 'Gulberg')
})

test('an obvious typo is corrected only when a near-identical curated name exists', () => {
  // One letter off a curated name: offer that name; there is nothing to add.
  assert.deepEqual(staffAreaAdvice('Lahore', 'Gulbreg', LAHORE), { kind: 'new', didYouMean: 'Gulberg', addName: null })
  assert.deepEqual(staffAreaAdvice('Lahore', 'johar twon', LAHORE), { kind: 'new', didYouMean: 'Johar Town', addName: null })
  // No near-identical name: the spelling is kept exactly as typed (proper-cased).
  assert.equal((staffAreaAdvice('Lahore', 'shadbagh', LAHORE) as { addName: string }).addName, 'Shadbagh')
  // Same-city only: a Karachi name is not offered for Lahore.
  assert.equal((staffAreaAdvice('Lahore', 'Clifton', LAHORE) as { didYouMean: string | null }).didYouMean, null)
})

test('the "Added by" line Admin → Locations shows', () => {
  assert.equal(addedByLine('Aqsa Mughal', '13 Oct 2026'), 'Added by Aqsa Mughal, 13 Oct 2026')
  assert.equal(addedByLine(null, null), 'Added by staff')
})

test('adding saves to the curated list, needs a city, records who and when, and is audited', () => {
  const lib = read('lib/staffAreas.ts')
  const add = lib.slice(lib.indexOf('export async function addStaffArea'), lib.indexOf('export type StaffAddedArea'))
  assert.ok(add.includes("if (!cityName) return { ok: false, status: 400, error: 'Choose the city first, then add the area.' }"))
  assert.ok(add.includes(".from('location_areas')") && add.includes('.insert({ city_id: city.id, name, created_by: actor.id, created_by_name: staffName, created_at: now })'))
  assert.ok(add.includes("action: 'location.area_add'") && add.includes("from: 'post_a_tuition'"), 'an Audit log row')
  assert.ok(add.includes('cleanAreaName(input.name)'))
  // An area already there is returned, not duplicated.
  assert.ok(add.includes('existed: true'))
  // SEO: the Indexing API is not used for a hub.
  assert.ok(!/enqueueIndexing|queueIndexingUpdate|indexing_queue/.test(lib))
  // The route: only roles that post a tuition; signed out and other roles are refused.
  const route = read('app/api/admin/locations/area/route.ts')
  assert.ok(route.includes("checkAdminRole(...(action === 'add' ? SCREEN_ACCESS.jobsPost : SCREEN_ACCESS.seo))"))
  // Merges are the Owner's (owner, 16 Oct 2026).
  assert.ok(route.includes("refuseUnlessOwnerApproval(actor, 'Locations: merge an area'"))
  // The new columns exist.
  const sql = read('supabase/migrations/169_onboarding_email_staff_areas.sql')
  for (const col of ['created_by uuid', 'created_by_name text', 'created_at timestamptz', 'removed_at timestamptz']) assert.ok(sql.includes(`add column if not exists ${col}`), col)
})

test('it never blocks posting, and only the STAFF form has it', () => {
  const field = read('components/forms/StaffAreaField.tsx')
  assert.ok(field.includes('You can still post with the area as typed.'))
  assert.ok(field.includes('<LocationInput id="whw-area"'), 'any text is accepted')
  assert.ok(field.includes('Did you mean {advice.didYouMean}?') && field.includes('as new area'))
  const row = read('components/forms/WhereHowWhen.tsx')
  assert.ok(row.includes('{staff ? (\n          <StaffAreaField city={city} area={area} onArea={onArea} curated={areas} onSplit={onSplit} />\n        ) : (\n          <LocationInput'))
  // The shared form turns it on for staff only (post and edit use the same form).
  assert.ok(read('components/forms/PostTuitionForm.tsx').includes('staff={adminExtras}'))
  // The tuition routes do not validate the area against the curated list.
  for (const f of ['app/api/admin/jobs/create/route.ts', 'app/api/parent/jobs/route.ts']) assert.ok(!/location_areas/.test(read(f)), f)
})

test("a parent's or tutor's free text still goes to the Locations review list", () => {
  // Parents and tutors never reach the add route…
  for (const f of ['app/(site)/parent/dashboard/post-job/JobForm.tsx', 'components/tutor/NewOnboardingFlow.tsx', 'components/forms/LocationInput.tsx']) {
    assert.ok(!/StaffAreaField|\/api\/admin\/locations\/area/.test(read(f)), f)
  }
  // …and the review list is still every typed area that is not curated, an alias or ignored.
  const review = read('lib/locationReview.ts')
  assert.ok(review.includes('if (list.some((x) => low(x.name) === low(a))) return'))
  assert.ok(review.includes('if (aliased.has(key) || ignored.has(key)) return'))
  assert.ok(review.includes("admin.from('jobs').select('id, city, area, status')") && review.includes("admin.from('tutor_areas').select('id, city, area')"))
})

test('an added area can be merged later — retired, never deleted', () => {
  const lib = read('lib/staffAreas.ts')
  const merge = lib.slice(lib.indexOf('export async function mergeStaffArea'))
  assert.ok(merge.includes(".from('location_area_aliases')") && merge.includes('removed_at: new Date().toISOString()'))
  assert.ok(!/\.delete\(/.test(lib), 'nothing is deleted')
  assert.ok(merge.includes("action: 'location.alias'"))
  // Every reader of the curated areas leaves a retired one out.
  const readers: [string, string][] = [
    ['lib/cityAreas.ts', ".is('removed_at', null)"],
    ['lib/cityJobs.ts', ".is('removed_at', null)"],
    ['lib/locationReview.ts', ".is('removed_at', null).order('id')"],
    ['lib/locationsAdmin.ts', ".is('removed_at', null)"],
    ['lib/openJobCounts.ts', ".is('removed_at', null)"],
    ['app/api/onboarding/areas/route.ts', ".is('removed_at', null)"],
    ['lib/areaHubRedirect.ts', '&removed_at=is.null'],
  ]
  for (const [f, mark] of readers) assert.ok(read(f).includes(mark), f)
  // Admin → Locations lists them with the merge action.
  assert.ok(read('app/admin/seo/locations/page.tsx').includes('<StaffAddedAreas'))
  assert.ok(read('app/admin/seo/locations/StaffAddedAreas.tsx').includes('Same as existing area'))
})
