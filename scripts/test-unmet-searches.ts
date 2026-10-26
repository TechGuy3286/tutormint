/**
 * scripts/test-unmet-searches.ts — npm run test:unmetsearches
 * Overview → "Unmet searches this week", made actionable (owner, 11 Oct 2026):
 *   - searches by staff, test accounts and test text are left out, and counted
 *   - identical searches (case and spacing) merge into one card with a total
 *   - "Add search word" makes the search find results (subject, school, level, city)
 *   - "Mark done" moves a card to Done; the same search later makes a new card
 *   - the hiring post template fills {city}
 *   - who may act
 * Pure rules plus source scans; nothing touches a database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isReadOnlyRole, roleSatisfies, SCREEN_ACCESS } from '../lib/adminAccessCore'
import { OVERVIEW_ITEMS } from '../lib/overviewItemsCore'
import { parseQuery, understood, type Dict } from '../lib/smartSearchCore'
import {
  HIRING_TEMPLATE_DEFAULT,
  aliasKind,
  buildUnmet,
  cleanWord,
  excludeReason,
  filterTargets,
  hiringPost,
  searchKey,
  whatsappShareLink,
  type UnmetRow,
  type WordTarget,
} from '../lib/unmetSearchCore'

const root = join(__dirname, '..')
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8').replace(/\r\n/g, '\n')

let seq = 0
const row = (o: Partial<UnmetRow> & { query: string }): UnmetRow => ({
  id: ++seq,
  surface: 'tutors',
  city: null,
  subject: null,
  level: null,
  school: null,
  role: null,
  is_test: false,
  created_at: '2026-10-10T08:00:00Z',
  ...o,
})

test('searches by staff, test accounts and obvious test text are left out, and counted', () => {
  assert.equal(excludeReason({ query: 'physics tutor sahiwal', role: 'admin', is_test: false }), 'staff')
  assert.equal(excludeReason({ query: 'physics tutor sahiwal', role: 'tutor', is_test: true }), 'test_account')
  assert.equal(excludeReason({ query: 'Smoke  Test tutor', role: null, is_test: false }), 'test_text')
  assert.equal(excludeReason({ query: 'TEST HIDDEN lahore', role: 'parent', is_test: null }), 'test_text')
  for (const role of ['tutor', 'parent', null]) assert.equal(excludeReason({ query: 'physics tutor sahiwal', role, is_test: false }), null)
  // "Test preparation" is a real thing people search for.
  assert.equal(excludeReason({ query: 'test preparation tutor', role: null, is_test: false }), null)

  const board = buildUnmet(
    [
      row({ query: 'physics tutor sahiwal', role: 'parent' }),
      row({ query: 'physics tutor sahiwal', role: 'admin' }),
      row({ query: 'smoke test 123', role: null }),
      row({ query: 'quran teacher', role: 'tutor', is_test: true }),
    ],
    [],
  )
  assert.equal(board.excluded, 3)
  assert.deepEqual(board.toReview.map((c) => [c.query, c.count]), [['physics tutor sahiwal', 1]])
})

test('identical searches merge into one card with a total, ignoring case and spacing', () => {
  assert.equal(searchKey('  Physics   TUTOR  sahiwal '), 'physics tutor sahiwal')
  const board = buildUnmet(
    [
      row({ query: 'Physics tutor Sahiwal', surface: 'tutors', role: 'parent', city: 'Sahiwal', subject: 'Physics', created_at: '2026-10-09T08:00:00Z' }),
      row({ query: 'physics  tutor   sahiwal', surface: 'tuitions', role: null, created_at: '2026-10-10T09:00:00Z' }),
      row({ query: 'PHYSICS TUTOR SAHIWAL', surface: 'tutors', role: 'tutor', created_at: '2026-10-08T08:00:00Z' }),
      row({ query: 'urdu teacher', role: null }),
    ],
    [],
  )
  assert.equal(board.toReview.length, 2)
  const card = board.toReview[0]
  assert.deepEqual([card.key, card.count, card.city, card.subject], ['physics tutor sahiwal', 3, 'Sahiwal', 'Physics'])
  assert.deepEqual(card.surfaces, ['tuitions', 'tutors'])
  assert.deepEqual(card.roles, ['guest', 'parent', 'tutor'])
  assert.equal(card.last, '2026-10-10T09:00:00Z')
  assert.equal(board.toReview[1].count, 1, 'most searched first')
})

test('"Mark done" moves the card to Done; the same search made later is a new card', () => {
  const rows = [
    row({ query: 'physics tutor sahiwal', created_at: '2026-10-08T08:00:00Z' }),
    row({ query: 'Physics tutor sahiwal', created_at: '2026-10-09T08:00:00Z' }),
    row({ query: 'urdu teacher', created_at: '2026-10-09T08:00:00Z' }),
  ]
  const done = [{ query_key: 'physics tutor sahiwal', done_at: '2026-10-09T12:00:00+00:00' }]
  const after = buildUnmet(rows, done)
  assert.deepEqual(after.toReview.map((c) => c.key), ['urdu teacher'], 'the done card has left To review')
  // The same search again, after it was marked done: a new card counting only the new search.
  const again = buildUnmet([...rows, row({ query: 'physics tutor sahiwal', created_at: '2026-10-10T07:00:00Z' })], done)
  const card = again.toReview.find((c) => c.key === 'physics tutor sahiwal')!
  assert.equal(card.count, 1)
  // The latest done time is the one that counts.
  assert.equal(buildUnmet(rows, [...done, { query_key: 'physics tutor sahiwal', done_at: '2026-10-08T09:00:00Z' }]).toReview.length, 1)

  const lib = read('lib', 'unmetSearches.ts')
  assert.ok(lib.includes("from('search_unmet_done').insert("))
  assert.ok(lib.includes('done_by: actor.id') && lib.includes('done_by_email') && lib.includes('done_by_name'), 'who')
  assert.ok(lib.includes("'search_unmet.done'") && lib.includes('logAdminAction('), 'audited')
  assert.ok(!lib.includes('.delete('), 'nothing is deleted')
  const ui = read('app', 'admin', 'overview', 'todo-unmet', 'UnmetSearchesClient.tsx')
  assert.ok(ui.includes('done by {d.done_by_name ?? shownEmail(d.done_by_email)') && ui.includes('formatDateTime(d.done_at)'), 'the Done tab shows who and when')
  assert.ok(ui.includes('Note (optional)'))
})

const dict = (aliases: Dict['aliases']): Dict => ({
  builtin: false,
  cities: ['Lahore', 'Sahiwal'],
  levels: [
    { slug: 'g9', name: 'Grade 9', category: 'Matriculation / Secondary' },
    { slug: 'o', name: 'O Levels', category: 'IGCSE' },
  ],
  subjects: [
    { slug: 'physics', name: 'Physics' },
    { slug: 'beaconhouse-school', name: 'Beaconhouse School', school: true },
  ],
  aliases,
})

test('"Add search word" makes the search find results: subject, school, level and city', () => {
  // Before: nothing in "tabiyat teacher swl" is understood.
  const before = parseQuery('tabiyat teacher swl', dict([]))
  assert.equal(understood(before), false)

  const after = parseQuery(
    'tabiyat teacher swl',
    dict([
      { kind: 'subject', slug: 'physics', alias: 'tabiyat' },
      { kind: 'city', slug: 'Sahiwal', alias: 'swl' },
    ]),
  )
  assert.equal(understood(after), true)
  assert.deepEqual([after.subject?.slug, after.city], ['physics', 'Sahiwal'])

  // A whole searched phrase as the word.
  const phrase = parseQuery('bss lahore', dict([{ kind: 'subject', slug: 'beaconhouse-school', alias: 'bss' }]))
  assert.deepEqual([phrase.school?.slug, phrase.city], ['beaconhouse-school', 'Lahore'])
  const level = parseQuery('nawi jamat physics', dict([{ kind: 'level', slug: 'g9', alias: 'nawi jamat' }]))
  assert.deepEqual([level.levels, level.subject?.slug], [['Grade 9'], 'physics'])
  // A city word for a city that is not in the list changes nothing.
  assert.equal(understood(parseQuery('xyz', dict([{ kind: 'city', slug: 'Nowhere', alias: 'xyz' }]))), false)

  // How it is stored: a school is a subject in the Search words table.
  assert.deepEqual((['subject', 'school', 'level', 'city'] as const).map(aliasKind), ['subject', 'subject', 'level', 'city'])
  assert.equal(cleanWord('  Tabiyat   Teacher '), 'tabiyat teacher')
  assert.equal(cleanWord('a'), null)
  assert.equal(cleanWord('x'.repeat(41)), null)

  // The picker.
  const targets: WordTarget[] = [
    { kind: 'subject', slug: 'physics', name: 'Physics' },
    { kind: 'school', slug: 'beaconhouse-school', name: 'Beaconhouse School' },
    { kind: 'level', slug: 'g9', name: 'Grade 9' },
    { kind: 'city', slug: 'Sahiwal', name: 'Sahiwal' },
  ]
  assert.deepEqual(filterTargets(targets, 'beacon sch').map((t) => t.slug), ['beaconhouse-school'])
  assert.equal(filterTargets(targets, '').length, 4)

  // The same Search words table as Settings → Subjects, then the search is run again.
  const lib = read('lib', 'unmetSearches.ts')
  assert.ok(lib.includes("from('taxonomy_aliases').insert({ kind, slug: target.slug, alias: word, created_by: actor.id })"))
  assert.ok(read('lib', 'subjectsCore.ts').includes("from('taxonomy_aliases').insert("))
  assert.ok(lib.includes("action: 'taxonomy.search_words'") && lib.includes('revalidateTag(SMART_SEARCH_TAG'))
  assert.ok(lib.includes('now: await rerunSearch(input.query)') && lib.includes('loadSearchDictFresh()'), 'run again with the new word, not a cached list')
  const ui = read('app', 'admin', 'overview', 'todo-unmet', 'UnmetSearchesClient.tsx')
  assert.ok(ui.includes('Now finds ${resultsWord('))
  // The database accepts a city word, and the live search reads it.
  assert.ok(read('supabase', 'migrations', '163_photo_crop_unmet_actions.sql').includes("check (kind in ('category', 'level', 'subject', 'city'))"))
  assert.ok(read('lib', 'smartSearch.ts').includes("a.kind === 'subject' || a.kind === 'level' || a.kind === 'city'"))
})

test('the hiring post template fills {city}, with a copy button and a WhatsApp share link', () => {
  assert.equal(
    hiringPost(HIRING_TEMPLATE_DEFAULT, 'Sahiwal'),
    'Hiring tutors in Sahiwal! Join TutorMint free — find home and online tuitions near you. No commission, no middleman. Join: https://www.tutormint.org/register',
  )
  // {join_link} = the sending staff member's own link (owner, 15 Oct 2026).
  assert.equal(
    hiringPost(HIRING_TEMPLATE_DEFAULT, 'Sahiwal', 'https://www.tutormint.org/join/aseer'),
    'Hiring tutors in Sahiwal! Join TutorMint free — find home and online tuitions near you. No commission, no middleman. Join: https://www.tutormint.org/join/aseer',
  )
  assert.equal(hiringPost('Tutors wanted in {city}. {city} only.', ' Okara '), 'Tutors wanted in Okara. Okara only.')
  assert.equal(hiringPost('', 'Sahiwal'), hiringPost(HIRING_TEMPLATE_DEFAULT, 'Sahiwal'), 'an empty template falls back')
  assert.equal(hiringPost(null, 'Sahiwal'), hiringPost(HIRING_TEMPLATE_DEFAULT, 'Sahiwal'))
  const link = whatsappShareLink('Hiring tutors in Sahiwal! Apply: https://tutormint.org/apply')
  assert.ok(link.startsWith('https://api.whatsapp.com/send?text=') && link.includes('Sahiwal') && !link.includes(' '))

  // Editable with the other templates (Team inbox → Templates lists every row).
  const sql = read('supabase', 'migrations', '163_photo_crop_unmet_actions.sql')
  assert.ok(sql.includes("('city_hiring_post', 'Hiring post for a city'"))
  // Migration 175 gave the seeded wording {join_link}; the code default matches it.
  assert.ok(read('supabase', 'migrations', '175_staff_signups.sql').includes(`set body = '${HIRING_TEMPLATE_DEFAULT}'`))
  assert.ok(read('lib', 'unmetSearches.ts').includes(".eq('key', HIRING_TEMPLATE_KEY)"))
  const ui = read('app', 'admin', 'overview', 'todo-unmet', 'UnmetSearchesClient.tsx')
  assert.ok(ui.includes('Hiring post for {c.city}') && ui.includes('{c.city && ('), 'only when the search named a city')
  assert.ok(ui.includes('whatsappShareLink(post, refCode)') && ui.includes('Copy'))
})

test('the Overview number is the To review tab; owner, Partner, admin and operations act', () => {
  assert.equal(OVERVIEW_ITEMS['todo-unmet'].screen, 'unmetSearches')
  assert.deepEqual(SCREEN_ACCESS.unmetSearches, ['admin', 'operations', 'supervisor'])
  assert.deepEqual(SCREEN_ACCESS.unmetSearches, SCREEN_ACCESS.seo, 'the roles that could already open the list')
  for (const r of ['owner', 'admin', 'operations'] as const) assert.equal(roleSatisfies(r, SCREEN_ACCESS.unmetSearches), true, r)
  assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS.unmetSearches), false)
  assert.equal(roleSatisfies('partner', SCREEN_ACCESS.unmetSearches), true)
  assert.equal(isReadOnlyRole('partner'), false) // full management since 13 Oct 2026 (was view-only)

  // One loader: the Overview count, the list and the screen.
  const items = read('lib', 'overviewItems.ts')
  assert.ok(items.includes('const board = await loadUnmetBoard(now)') && items.includes('const list = board.toReview'))
  const page = read('app', 'admin', 'overview', 'todo-unmet', 'page.tsx')
  assert.ok(page.includes('requireAdminRole(...SCREEN_ACCESS.unmetSearches)') && page.includes('loadUnmetBoard()'))
  assert.ok(page.includes("['review', 'To review', board.toReview.length]") && page.includes("['done', 'Done', board.done.length]"))
  assert.ok(page.includes('{board.excluded} search'), 'the excluded count is shown')
  for (const route of ['search-word', 'done']) {
    assert.ok(read('app', 'api', 'admin', 'unmet-searches', route, 'route.ts').includes('checkAdminRole(...SCREEN_ACCESS.unmetSearches)'), route)
  }
  const ui = read('app', 'admin', 'overview', 'todo-unmet', 'UnmetSearchesClient.tsx')
  assert.ok(ui.includes('useAdminReadOnly()') && (ui.match(/\{!readOnly && /g) ?? []).length >= 4, 'no buttons for the Partner')
  // New searches record who searched, so staff and test accounts can be left out.
  const log = read('lib', 'smartSearch.ts')
  assert.ok(log.includes('user_id: input.userId ?? null') && log.includes('is_test: isTest'))
})
