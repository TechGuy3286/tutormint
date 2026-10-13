// npm run test:locationclean — Locations clean-up (owner, 13 Oct 2026):
// suggestions, and an alias counting as the curated area in filters, labels,
// hubs and the hub's 3+ rule.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { cleanAreaName, notAreaReason, suggestFor } from '../lib/locationCleanCore'
import { areaHubsFor, areaStanding, hubSlugRedirect, resolveAreaHub } from '../lib/areaHubCore'
import { areaSpellings, buildAliasIndex, canonArea, canonAreaList } from '../lib/areaAliasCore'
import { distinctAreaLabels } from '../lib/place'

const LAHORE = ['DHA Lahore', 'Johar Town', 'Harbanspura', 'Izmir Town', 'Manawan', 'Thokar Niaz Baig', 'Valencia Town', 'Gulberg', 'Model Town']
const KARACHI = ['Liaqatabad', 'Gulshan-e-Iqbal', 'DHA Karachi', 'North Nazimabad', 'Nazimabad', 'Garden West', 'Garden East']
const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi']

test('names are cleaned up: proper case, known capitals kept', () => {
  assert.equal(cleanAreaName('  harbnspura '), 'Harbnspura')
  assert.equal(cleanAreaName('dha phase 5'), 'DHA Phase 5')
  assert.equal(cleanAreaName('gulshan-e-iqbal'), 'Gulshan-e-Iqbal')
  assert.equal(cleanAreaName('e-11'), 'E-11')
  assert.equal(cleanAreaName('TARIQ ROAD'), 'Tariq Road')
})

test('obvious spelling variants are suggested as the curated area', () => {
  const same = (raw: string, city: string, list: string[]) => {
    const s = suggestFor(raw, city, list, CITIES)
    assert.equal(s.action, 'same', `${raw}: ${JSON.stringify(s)}`)
    return s.action === 'same' ? s.area : ''
  }
  assert.equal(same('harbnspura', 'Lahore', LAHORE), 'Harbanspura')
  assert.equal(same('Liaqatbad', 'Karachi', KARACHI), 'Liaqatabad')
  assert.equal(same('Azmir town', 'Lahore', LAHORE), 'Izmir Town')
  assert.equal(same('Manwan', 'Lahore', LAHORE), 'Manawan')
  assert.equal(same('Thokar Naiz Baig', 'Lahore', LAHORE), 'Thokar Niaz Baig')
  assert.equal(same('valencia', 'Lahore', LAHORE), 'Valencia Town')
  assert.equal(same('DHA Phase 5', 'Lahore', LAHORE), 'DHA Lahore')
  assert.equal(same('Block 13 Gulshan-e-Iqbal', 'Karachi', KARACHI), 'Gulshan-e-Iqbal')
})

test('a school name, an address, "online" and junk are suggested as Not an area', () => {
  const not = (raw: string) => {
    const s = suggestFor(raw, 'Lahore', LAHORE, CITIES)
    assert.equal(s.action, 'not_area', `${raw}: ${JSON.stringify(s)}`)
    return s.action === 'not_area' ? s.reason : ''
  }
  assert.equal(not('Beaconhouse School System'), 'school')
  assert.equal(not('online'), 'online')
  assert.equal(not('House 12, Street 4, near Emporium Mall'), 'address')
  assert.equal(not('n/a'), 'junk')
  assert.equal(not('Lahore'), 'junk')
  assert.equal(notAreaReason('Sabzazar', CITIES), null)
})

test('anything else is a new area with a cleaned name, never auto-approved', () => {
  const s = suggestFor('sabzazar scheme', 'Lahore', LAHORE, CITIES)
  assert.equal(s.action, 'add')
  if (s.action === 'add') assert.equal(s.name, 'Sabzazar Scheme')
  // Two curated areas equally close is not a clear match.
  const g = suggestFor('Garden', 'Karachi', KARACHI, CITIES)
  assert.notEqual(g.action === 'same' && g.confidence === 'high', true)
  // The screen only ever approves what staff tick.
  const src = readFileSync('lib/locationReview.ts', 'utf8')
  assert.ok(!/suggestFor\([^)]*\)[\s\S]{0,200}\.insert\(/.test(src), 'a suggestion is never written by the loader')
})

test('an alias makes the typed value count as the curated area: hubs and the 3+ rule', () => {
  const aliases = buildAliasIndex([
    { city: 'Lahore', raw: 'harbnspura', area: 'Harbanspura' },
    { city: 'Lahore', raw: 'Harbans Pura', area: 'Harbanspura' },
  ])
  // Without the alias the typed spelling belongs to no hub.
  assert.equal(resolveAreaHub('Lahore', 'harbnspura', LAHORE), null)
  assert.deepEqual(resolveAreaHub('Lahore', 'harbnspura', LAHORE, aliases.lahore), { area: 'Harbanspura', how: 'alias' })

  const saved = ['Harbanspura', 'harbnspura', 'Harbans Pura', 'Johar Town']
  const before = areaHubsFor('Lahore', saved, LAHORE).find((h) => h.slug === 'harbanspura')
  assert.equal(before?.count, 1, '1 live item: below the 3+ rule')
  const after = areaHubsFor('Lahore', saved, LAHORE, aliases.lahore).find((h) => h.slug === 'harbanspura')
  assert.equal(after?.count, 3, '3 live items: the hub is indexable')
  // The hub lists every saved spelling; nothing on a tuition was rewritten.
  assert.deepEqual(after?.areas.sort(), ['Harbans Pura', 'Harbanspura', 'harbnspura'])
  // An old hub address made from the typed spelling moves to the curated hub.
  assert.equal(hubSlugRedirect('Lahore', 'harbnspura', LAHORE, aliases.lahore), 'harbanspura')
  assert.equal(areaStanding('Lahore', 'harbnspura', LAHORE, aliases.lahore).kind, 'listed')
  // An alias to an area that is no longer curated decides nothing.
  assert.equal(resolveAreaHub('Lahore', 'harbnspura', ['Johar Town'], aliases.lahore), null)
})

test('an alias makes the typed value count as the curated area: filters and labels', () => {
  const rows = [
    { city: 'Karachi', raw: 'Liaqatbad', area: 'Liaqatabad' },
    { city: 'Karachi', raw: 'liaquatabad', area: 'Liaqatabad' },
    { city: 'Lahore', raw: 'D.H.A', area: 'DHA Lahore' },
  ]
  const index = buildAliasIndex(rows)
  // The area filter matches the curated name and every approved spelling.
  assert.deepEqual(areaSpellings(rows, 'Karachi', 'Liaqatabad'), ['Liaqatabad', 'Liaqatbad', 'liaquatabad'])
  // A link carrying the typed spelling finds the same tuitions.
  assert.deepEqual(areaSpellings(rows, 'Karachi', 'Liaqatbad').sort(), ['Liaqatabad', 'Liaqatbad', 'liaquatabad'].sort())
  // Another city's alias never leaks in.
  assert.deepEqual(areaSpellings(rows, 'Lahore', 'Liaqatabad'), ['Liaqatabad'])
  // Labels: the curated name is shown; the same area is shown once.
  assert.equal(canonArea(index, 'Karachi', 'Liaqatbad'), 'Liaqatabad')
  assert.equal(canonArea(index, 'Lahore', 'Liaqatbad'), 'Liaqatbad')
  const areas = canonAreaList(index, ['Lahore'], ['DHA Lahore', 'D.H.A', 'Johar Town'])
  assert.deepEqual(areas, ['DHA Lahore', 'Johar Town'])
  assert.deepEqual(distinctAreaLabels(areas, 'Lahore').map((a) => a.label), ['DHA', 'Johar Town'], 'no "DHA, DHA"')
})

test('the tutor area match in SQL reads the alias table (migration 166)', () => {
  const sql = readFileSync('supabase/migrations/166_location_aliases.sql', 'utf8')
  assert.ok(sql.includes("'public.area_same(p_city, a, p_area)'"))
  assert.ok(sql.includes('create table if not exists public.location_area_aliases'))
  assert.ok(sql.includes('removed_at timestamptz'), 'an alias is taken back, never deleted')
  assert.ok(!/delete from/i.test(sql))
  // The job feed filter and the display both read the alias.
  const feed = readFileSync('lib/jobFeed.ts', 'utf8')
  assert.ok(feed.includes('spellingsForArea(') && feed.includes('canonArea(areaAliases'))
})
