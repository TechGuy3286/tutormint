/**
 * scripts/test-people-directory.ts  —  npm run test:people
 *
 * One People page, Tutors | Parents | Staff (owner, 21 Oct 2026): who counts
 * (staff and test accounts left out, the toggle brings them back), the Paid /
 * Unpaid split, the parent chips, possible-duplicate tags, one document-status
 * source (no "CNIC pending" on an approved tutor), the old addresses
 * redirecting to the right tab and chip, the People badge, and the Overview
 * cards counting the same people. Pure logic + source scans.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  OVERVIEW_KEY_PEOPLE,
  PARENT_CHIPS,
  compactName,
  excludedReason,
  findPossibleDuplicates,
  duplicateCount,
  hasActivity,
  overviewPeopleRedirect,
  paidTag,
  parentVerification,
  parentsRedirect,
  peopleHref,
  pickPeopleTab,
  postedTag,
  similarNames,
  staffLinkKeys,
  tutorsRedirect,
  waitingBadge,
} from '../lib/peopleDirectoryCore'
import { tutorCardStatuses } from '../lib/tutorDocQueueCore'
import { docSummary, tutorDocFactsFromRow } from '../lib/tutorDocSummaryCore'
import { NAV_GROUPS } from '../lib/adminNav'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

test('who counts: staff, seed, team and test accounts are left out', () => {
  assert.equal(excludedReason({ role: 'tutor' }), null)
  assert.equal(excludedReason({ role: 'parent' }), null)
  assert.equal(excludedReason({ role: 'admin' }), 'staff')
  assert.equal(excludedReason({ role: 'tutor', isSeed: true }), 'seed')
  assert.equal(excludedReason({ role: 'parent', isTeam: true }), 'team')
  assert.equal(excludedReason({ role: 'tutor', isTestName: true }), 'test')
  assert.equal(excludedReason({ role: 'tutor', hidden: true }), 'test')
  // A staff member's own account with no real activity ("Admin", "Alee",
  // "Ali Bhai" in the parent list) is left out…
  assert.equal(excludedReason({ role: 'parent', staffLinked: true, activity: false }), 'staff')
  // …but a staff member's working tutor account is an ordinary tutor.
  assert.equal(excludedReason({ role: 'tutor', staffLinked: true, activity: true }), null)
})

test('real activity decides whether a staff-linked account counts', () => {
  assert.equal(hasActivity('tutor', {}), false)
  assert.equal(hasActivity('tutor', { feePaid: true }), true)
  assert.equal(hasActivity('tutor', { onboarded: true }), true)
  assert.equal(hasActivity('tutor', { subjects: 3 }), true)
  assert.equal(hasActivity('parent', {}), false)
  assert.equal(hasActivity('parent', { tuitions: 1 }), true)
  assert.equal(hasActivity('parent', { paidPlan: true }), true)
  assert.equal(hasActivity('parent', { submitted: true }), true)
  const keys = staffLinkKeys([{ email: 'A@X.org', phone: '0300-1234567', whatsapp: '923001112233' }])
  assert.ok(keys.emails.has('a@x.org'))
  assert.ok(keys.phones.has('3001234567') && keys.phones.has('3001112233'))
})

test('the toggle brings left-out accounts back; the default leaves them out', () => {
  const src = read('lib/peopleDirectory.ts')
  assert.match(src, /export function inTab\(people: DirectoryPerson\[\], role: 'tutor' \| 'parent', showAll: boolean\)/)
  assert.match(src, /p\.role === role && \(showAll \|\| p\.excluded === null\)/)
  const tabs = read('app/admin/users/PeopleTabs.tsx')
  assert.ok(tabs.includes('Show staff & test accounts'))
  assert.ok(tabs.includes("inTab(d.people, 'tutor', showAll)") && tabs.includes("inTab(d.people, 'parent', showAll)"))
  assert.ok(read('app/admin/users/page.tsx').includes("showAll={all === '1'}"))
})

test('Paid / Unpaid: the Verification Fee by any method, Owner grant included', () => {
  assert.equal(paidTag('2026-10-01T00:00:00Z'), 'paid')
  assert.equal(paidTag(null), 'unpaid')
  assert.equal(paidTag(undefined), 'unpaid')
  // verified_fee_paid_at is the one fact — set by a payment AND by an Owner grant.
  assert.match(read('lib/peopleDirectory.ts'), /feePaidAt: \(t\?\.verified_fee_paid_at as string \| null\) \?\? null/)
  assert.ok(read('app/admin/users/PeopleTabs.tsx').includes("{ paid: paidTag(p.feePaidAt) }"))
})

test('Parents: posted / not posted, and one verification chip each', () => {
  assert.equal(postedTag(0), 'notposted')
  assert.equal(postedTag(3), 'posted')
  assert.equal(parentVerification('approved', 'approved'), 'approved')
  assert.equal(parentVerification('pending', 'none'), 'waiting')
  assert.equal(parentVerification('approved', 'pending'), 'waiting')
  assert.equal(parentVerification('rejected', 'none'), 'rejected')
  assert.equal(parentVerification('none', 'none'), 'none')
  assert.equal(parentVerification('approved', 'none'), 'none')
  assert.deepEqual(
    PARENT_CHIPS.map((c) => c.label),
    ['Waiting for review', 'Verified', 'Not submitted', 'Rejected'],
  )
  assert.ok(!PARENT_CHIPS.some((c) => /none/i.test(c.label)), '"NONE" is gone')
})

test('possible duplicates: same mobile, same CNIC, or a very similar name in the same city', () => {
  assert.equal(compactName('Rab Nawaz'), compactName('Rabnawaz'))
  assert.equal(similarNames('Rabnawaz', 'Rab Nawaz'), true)
  assert.equal(similarNames('Zuha Qasim', 'Zoha Qasim'), true)
  assert.equal(similarNames('Ali', 'Aly'), false, 'short names are not compared fuzzily')
  assert.equal(similarNames('Ayesha Khan', 'Aisha Malik'), false)
  const tags = findPossibleDuplicates([
    { id: 'a', name: 'Rabnawaz', city: 'Lahore', phones: [], cnic: null },
    { id: 'b', name: 'Rab Nawaz', city: 'lahore', phones: [], cnic: null },
    { id: 'c', name: 'Rab Nawaz', city: 'Karachi', phones: [], cnic: null },
    { id: 'd', name: 'Sana', city: 'Multan', phones: ['03001234567'], cnic: null },
    { id: 'e', name: 'Hina', city: 'Quetta', phones: ['923001234567'], cnic: null },
    { id: 'f', name: 'Omar', city: null, phones: [], cnic: '35202-1234567-1' },
    { id: 'g', name: 'Umar', city: null, phones: [], cnic: '3520212345671' },
    // A member's own linked second-role account is never tagged.
    { id: 'h', name: 'Bilal', city: 'Lahore', phones: ['03110000000'], cnic: null, linkedId: 'i' },
    { id: 'i', name: 'Bilal', city: 'Lahore', phones: ['03110000000'], cnic: null, linkedId: 'h' },
  ])
  assert.deepEqual(tags.get('a'), [{ id: 'b', name: 'Rab Nawaz', reason: 'name' }])
  assert.equal(tags.has('c'), false, 'a different city is not tagged')
  assert.equal(tags.get('d')?.[0].reason, 'mobile')
  assert.equal(tags.get('f')?.[0].reason, 'cnic')
  assert.equal(tags.has('h') || tags.has('i'), false)
  assert.equal(duplicateCount(tags), 6)
  // Only tags — nothing in the loader writes.
  const loader = read('lib/peopleDirectory.ts')
  assert.ok(!/\.(update|insert|upsert|delete)\(/.test(loader), 'the directory loader never changes a row')
})

test('one document-status source: no "CNIC pending" on an approved tutor', () => {
  // An approved tutor whose tutor_profiles.verification_status is still
  // 'pending' (it stays so until the intro video is reviewed).
  const statuses = tutorCardStatuses(
    tutorDocFactsFromRow(
      {
        verification_state: 'approved',
        cnic_verified_at: '2026-10-10T00:00:00Z',
        cnic_number: '3520212345671',
        cnic_image_path: 'x/front.jpg',
        avatar_url: 'https://example.org/a.jpg',
        profile_pic_status: 'approved',
        selfie_status: 'approved',
      },
      { hasSelfieFile: true, hasCnicReview: false, hasSelfieReview: false },
    ),
  )
  assert.equal(docSummary(statuses).kind, 'approved')
  const queue = read('app/admin/tutors/videos/TutorModerationClient.tsx')
  assert.ok(!queue.includes('CNIC pending'), 'the old pill is gone')
  assert.ok(!/function CnicPill/.test(queue))
  assert.match(queue, /<DocsPill status=\{t\.verificationStatus\} docs=\{t\.docs\} \/>/)
  assert.ok(read('lib/adminQueues.ts').includes('const docSummaries = await loadTutorDocSummaries(ids)'))
  assert.ok(read('lib/peopleDirectory.ts').includes('loadTutorDocSummaries('))
  assert.ok(read('lib/overviewItems.ts').includes('loadDirectoryDocs()'))
})

test('old addresses redirect to the matching tab and chip', () => {
  assert.equal(pickPeopleTab(undefined), 'tutors')
  assert.equal(pickPeopleTab('parents'), 'parents')
  assert.equal(pickPeopleTab('staff'), 'staff')
  assert.equal(tutorsRedirect({}), '/admin/users?tab=tutors')
  assert.equal(tutorsRedirect({ filter: 'pending' }), '/admin/users?tab=tutors&docs=waiting')
  assert.equal(tutorsRedirect({ filter: 'all', q: ' Ali ' }), '/admin/users?tab=tutors&q=Ali')
  assert.equal(parentsRedirect({}), '/admin/users?tab=parents&pv=waiting')
  assert.equal(parentsRedirect({ filter: 'approved' }), '/admin/users?tab=parents&pv=approved')
  assert.equal(parentsRedirect({ filter: 'all' }), '/admin/users?tab=parents')
  assert.equal(overviewPeopleRedirect('tutors', {}), '/admin/users?tab=tutors')
  assert.equal(overviewPeopleRedirect('tutors', { docs: 'rejected' }), '/admin/users?tab=tutors&docs=rejected')
  assert.equal(overviewPeopleRedirect('parents', {}), '/admin/users?tab=parents')
  assert.equal(overviewPeopleRedirect('todo-docs', {}), '/admin/users?tab=tutors&docs=waiting')
  assert.equal(overviewPeopleRedirect('revenue', {}), null)
  assert.equal(peopleHref('staff'), '/admin/users?tab=staff')
  assert.ok(read('app/admin/tutors/page.tsx').includes('redirect(tutorsRedirect(await searchParams))'))
  assert.ok(read('app/admin/parents/page.tsx').includes('redirect(parentsRedirect(await searchParams))'))
  assert.ok(read('app/admin/overview/[key]/page.tsx').includes('const people = overviewPeopleRedirect(key, sp)'))
  assert.ok(read('app/admin/users/page.tsx').includes("if (filter === 'approval') redirect(peopleHref('tutors', { docs: 'waiting' }))"))
  // The Overview cards and rows link to the same addresses.
  assert.ok(read('app/admin/page.tsx').includes('OVERVIEW_KEY_PEOPLE[k]'))
  assert.equal(OVERVIEW_KEY_PEOPLE['todo-docs'], '/admin/users?tab=tutors&docs=waiting')
  // The intro-video review tool kept its own address.
  assert.ok(read('app/admin/tutors/videos/page.tsx').includes('<TutorModerationClient'))
})

test('the Verification group is gone; People carries the waiting badge', () => {
  assert.ok(!NAV_GROUPS.some((g) => g.title === 'Verification'))
  assert.ok(!NAV_GROUPS.flatMap((g) => g.items).some((i) => i.href === '/admin/tutors' || i.href === '/admin/parents'))
  assert.equal(waitingBadge(['waiting', 'approved', 'waiting', null, 'rejected'], ['waiting', 'approved', 'none']), 3)
  assert.equal(waitingBadge([], []), 0)
  const layout = read('app/admin/layout.tsx')
  assert.ok(layout.includes('peopleWaitingCount()'))
  assert.ok(layout.includes("'/admin/users': waiting"))
  assert.ok(!layout.includes("'/admin/tutors':") && !layout.includes("'/admin/parents':"))
  // The badge, the Overview "Documents to approve" row and the chips read the
  // same loader and the same Waiting rule.
  const loader = read('lib/peopleDirectory.ts')
  assert.ok(loader.includes("tutors.map((t) => docs.get(t.id)?.kind ?? null)"))
  assert.ok(loader.includes("parents.map((p) => p.parent?.verification ?? 'none')"))
})

test('the Overview New tutors / New parents counts use the People rule', () => {
  const items = read('lib/overviewItems.ts')
  assert.ok(items.includes("const rows = await directoryRows('tutor')"))
  assert.ok(items.includes("const rows = await directoryRows('parent')"))
  assert.match(items, /return inTab\(d\.people, role, false\)\.map/)
  assert.match(read('lib/peopleDirectory.ts'), /tutors: inTab\(d\.people, 'tutor', false\)\.length, parents: inTab\(d\.people, 'parent', false\)\.length/)
})

test('the shared load-more hook starts again when its list changes ("That\'s all 25 tutors")', () => {
  const hook = read('lib/useInfinite.ts')
  assert.match(hook, /if \(listKey !== storageKey\) \{/)
  assert.match(hook, /setCursor\(initialCursor\)/)
  assert.ok(read('app/admin/tutors/videos/page.tsx').includes('key={`${filter}:${search}`}'))
})
