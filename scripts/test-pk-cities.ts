/**
 * scripts/test-pk-cities.ts — npm run test:pkcities
 *
 * Every Pakistani city and town on the city list (owner, 20 Oct 2026): Kasur
 * is choosable and the server's "listed cities only" check accepts it; alias
 * search; no duplicates and the existing 26 unchanged; an empty new city has
 * no page (404) and no sitemap entry; the Browse filter hides empty cities.
 * Pure rules, the generated data and migration, and source scans. No DB.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { PK_CITIES } from '../lib/pkCityData'
import { HAND_CITY_COORDS } from '../lib/cityCoordsHand'
import { browseCityOptions, citySubtitle, foldCity, resolveCity, searchCities } from '../lib/pkCitiesCore'
import { matchCuratedCity } from '../lib/staffAreaCore'
import { hubSitemapEntries } from '../lib/sitemapCore'
import { slugify } from '../lib/slugs'
import { provinceForCity } from '../lib/pkLocations'
import { cityCoord } from '../lib/cityDistance'

const SQL = readFileSync('supabase/migrations/188_all_pk_cities.sql', 'utf8')
const EXISTING_26 = [
  'Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Abbottabad', 'Bahawalpur', 'Dera Ghazi Khan', 'Faisalabad',
  'Gujranwala', 'Gujrat', 'Hyderabad', 'Jhang', 'Jhelum', 'Larkana', 'Mardan', 'Mingora', 'Multan', 'Peshawar',
  'Quetta', 'Rahim Yar Khan', 'Sahiwal', 'Sargodha', 'Sheikhupura', 'Sialkot', 'Sukkur', 'Wah Cantt',
]
/** location_cities after migration 188: the 26 plus every name it inserts. */
const insertBlock = SQL.split('insert into public.location_cities')[1].split('on conflict')[0]
const inserted = [...insertBlock.matchAll(/\('((?:[^']|'')+)', 100\)/g)].map((m) => m[1].replace(/''/g, "'"))
const listedAfter = [...EXISTING_26, ...inserted]

test('Kasur is on the list, found by typing, and accepted by the server check', () => {
  assert.ok(PK_CITIES.some((c) => c.name === 'Kasur' && c.province === 'Punjab' && c.district === 'Kasur'))
  assert.equal(searchCities(PK_CITIES, 'kas')[0].name, 'Kasur')
  assert.equal(searchCities(PK_CITIES, 'Kasur')[0].name, 'Kasur')
  assert.ok(inserted.includes('Kasur'))
  // Staff posting runs curatedCityName() = matchCuratedCity(location_cities names, typed).
  assert.equal(matchCuratedCity(listedAfter, 'Kasur'), 'Kasur')
  assert.equal(matchCuratedCity(listedAfter, 'kasur'), 'Kasur')
  assert.equal(matchCuratedCity(listedAfter, 'Atlantis'), null)
  assert.equal(slugify('Kasur'), 'kasur')
  assert.equal(provinceForCity('Kasur'), 'Punjab')
  assert.ok(cityCoord('Kasur'))
})

test('alias search finds the common other spellings', () => {
  const first = (q: string) => searchCities(PK_CITIES, q)[0]?.name
  assert.equal(first('D.I. Khan'), 'Dera Ismail Khan')
  assert.equal(first('di khan'), 'Dera Ismail Khan')
  assert.equal(first('Shaheed Benazirabad'), 'Nawabshah')
  assert.equal(first('Faislabad'), 'Faisalabad')
  assert.equal(first('Lyallpur'), 'Faisalabad')
  assert.equal(first('pindi'), 'Rawalpindi')
  assert.equal(first('D.G. Khan'), 'Dera Ghazi Khan')
  assert.equal(first('Rabwah'), 'Chenab Nagar')
  assert.equal(resolveCity(PK_CITIES, 'Shaheed Benazirabad')?.name, 'Nawabshah')
  assert.equal(resolveCity(PK_CITIES, 'Wah')?.name, 'Wah Cantt')
  // Aliases reach site search through the existing taxonomy_aliases mechanism.
  assert.match(SQL, /\('city', 'Nawabshah', 'shaheed benazirabad'\)/)
  assert.match(SQL, /\('city', 'Dera Ismail Khan', 'd\.i\. khan'\)/)
  assert.match(SQL, /on conflict \(kind, slug, alias\) do nothing;/)
})

test('a city shows its district and province; homonyms carry the district', () => {
  const k = PK_CITIES.find((c) => c.name === 'Dera Ismail Khan')!
  assert.equal(citySubtitle(k), 'Khyber Pakhtunkhwa')
  assert.equal(citySubtitle(PK_CITIES.find((c) => c.name === 'Taxila')!), 'Rawalpindi district, Punjab')
  assert.ok(PK_CITIES.some((c) => c.name === 'Sahiwal' && c.existing))
  assert.ok(PK_CITIES.some((c) => c.name === 'Sahiwal (Sargodha)' && !c.existing))
})

test('no duplicates, and the existing 26 are unchanged', () => {
  const folds = PK_CITIES.map((c) => foldCity(c.name))
  assert.equal(new Set(folds).size, folds.length, 'names unique')
  const slugs = PK_CITIES.map((c) => slugify(c.name))
  assert.equal(new Set(slugs).size, slugs.length, 'URL slugs unique')
  // Every alias belongs to one city and is no other city's name.
  for (const c of PK_CITIES) for (const a of c.aliases) assert.ok(!PK_CITIES.some((o) => o !== c && foldCity(o.name) === foldCity(a)), a)
  // The 26: present, flagged, with their hand coordinates.
  const existing = PK_CITIES.filter((c) => c.existing)
  assert.deepEqual(existing.map((c) => c.name).sort(), [...EXISTING_26].sort())
  for (const c of existing) assert.deepEqual({ lat: c.lat, lng: c.lng }, HAND_CITY_COORDS[c.name])
  // The migration never re-inserts or touches an existing city, and is re-runnable.
  for (const n of EXISTING_26) assert.ok(!inserted.includes(n), `${n} re-inserted`)
  assert.match(SQL, /on conflict \(name\) do nothing;/)
  assert.doesNotMatch(SQL, /\b(update|delete)\b/i)
  assert.equal(new Set(inserted.map(foldCity)).size, inserted.length)
  // No second Wah beside Wah Cantt; no second Jhang beside Jhang.
  assert.ok(!PK_CITIES.some((c) => /^wah\b/i.test(c.name) && c.name !== 'Wah Cantt'))
  assert.ok(!PK_CITIES.some((c) => /^jhang\b/i.test(c.name) && c.name !== 'Jhang'))
  // Big four first, as today.
  assert.deepEqual(PK_CITIES.slice(0, 4).map((c) => c.name), ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi'])
})

test('an empty new city has no page and no sitemap entry', () => {
  // City pages are built from OPEN tuitions only — never from the city list —
  // and a city with no page is a 404.
  const jobs = readFileSync('lib/cityJobs.ts', 'utf8')
  const pagesFn = jobs.slice(jobs.indexOf('export async function cityPages'), jobs.indexOf('export async function indexableCityPages'))
  assert.match(pagesFn, /openRows\(\)/)
  assert.doesNotMatch(pagesFn, /location_cities/)
  assert.match(jobs, /export const CITY_PAGE_THRESHOLD = 3/)
  const page = readFileSync('app/(site)/tuition-jobs/[city]/page.tsx', 'utf8')
  assert.match(page, /if \(!page\) notFound\(\)/)
  // And the sitemap lists a city hub only at 3+ open tuitions.
  const base = 'https://www.tutormint.org'
  const entries = hubSitemapEntries(base, [
    { path: '/tuition-jobs/kasur', count: 0, threshold: 3 },
    { path: '/tuition-jobs/taxila', count: 2, threshold: 3 },
    { path: '/tuition-jobs/lahore', count: 40, threshold: 3 },
  ])
  assert.deepEqual(entries.map((e) => e.url), [`${base}/tuition-jobs/lahore`])
})

test('the Browse filter lists only cities with tuitions or tutors', () => {
  const all = PK_CITIES.map((c) => c.name)
  const active = ['lahore', 'Karachi', 'Kasur']
  assert.deepEqual(browseCityOptions(all, active), ['Lahore', 'Karachi', 'Kasur'])
  // The city already chosen stays visible even when it has nothing now.
  assert.deepEqual(browseCityOptions(all, active, 'Taxila'), ['Taxila', 'Lahore', 'Karachi', 'Kasur'])
  // A typed city with activity that is not on the list is kept, at the end.
  assert.deepEqual(browseCityOptions(all, ['Lahore', 'Chak 45 GB']), ['Lahore', 'Chak 45 GB'])
  assert.equal(browseCityOptions(all, []).length, 0)
  // Both Browse filter bars use it with the live list; the forms use every city.
  for (const f of ['app/(site)/browse/tuitions/JobFilterBar.tsx', 'app/(site)/browse/tutors/TutorFilterBar.tsx']) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /useBrowseCities\(\)/)
    assert.match(src, /browseCityOptions\(/)
    assert.match(src, /<CityPicker[\s\S]*?only=\{/)
  }
})

test('every city-choosing form uses the searchable picker', () => {
  for (const f of [
    'components/forms/WhereHowWhen.tsx',
    'components/tutor/NewOnboardingFlow.tsx',
    'components/tutor/CompleteProfileFlow.tsx',
    'components/tutor/TutorCitiesEditor.tsx',
    'app/(site)/parent/dashboard/settings/SettingsClient.tsx',
    'app/admin/tutors/[id]/TutorFieldEditor.tsx',
  ]) assert.match(readFileSync(f, 'utf8'), /<CityPicker/, f)
  // Staff posting stays curated-only on the server.
  assert.match(readFileSync('lib/jobs.ts', 'utf8'), /if \(!curatedCity\) return \{ ok: false, status: 400, error: 'Choose the city from the list\.' \}/)
})
