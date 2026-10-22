/**
 * scripts/test-applications-v2.ts — npm run test:applicationsv2
 * Owner, 22 Oct 2026 — Applications v2:
 *   - its own sidebar item in Tuitions with the overdue badge; Follow-ups has no
 *     Applications tab and no applications badge
 *   - every old link redirects, filters kept; /tuitions → /browse/tuitions
 *   - the Staff filter (view others, edit only own; the Owner any)
 *   - "Posted by" on the admin Tuitions page
 *   - grouping and sort order; a worked item sinks and comes back when overdue
 *   - search finds worked and Older items
 *   - the 30-day Older rule does not change a stage or the tutor dashboard
 *   - city owners never touch staff-posted tuitions
 *   - a parent hire sets Hired without touching JobPosting, expiry or noindex
 * Pure rules + source scans. No browser, no network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  APPLICATIONS_PATH,
  groupBoard,
  groupCountLine,
  isOlderTuition,
  isWorked,
  itemOverdue,
  legacyApplicationsHref,
  matchesStaff,
  mayEditStage,
  overdueBadgeCount,
  parseStaffFilter,
  parseStageFilter,
  searchMatches,
  shortTitle,
  staffChoices,
  workedLine,
  type BoardItem,
  type Stage,
} from '../lib/applicationStageCore'
import { cityOwnerFor, cityRuleApplies, matchStaffName, CITY_OWNER_SEED } from '../lib/cityOwnersCore'
import { followUpTabsFor } from '../lib/followUpsPageCore'
import { NAV_GROUPS, SECTION_LABELS } from '../lib/adminNav'
import { roleMayWrite, roleSatisfies, SCREEN_ACCESS } from '../lib/adminAccessCore'
import { jobPostingJsonLd } from '../lib/seo'
import { tuitionPublicState } from '../lib/tuitionStatus'

const code = (p: string) => readFileSync(p, 'utf8')
const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-10-22T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

const OWNER = { id: 'owner-1', adminRole: 'owner' }
const AQSA = { id: '11111111-1111-1111-1111-111111111111', adminRole: 'admin' }
const KHIZRA = { id: '22222222-2222-2222-2222-222222222222', adminRole: 'operations' }

type Row = BoardItem & { jobId: string; tutorName: string; jobRef: string | null; jobTitle: string; jobCity: string | null }

function row(p: Partial<Row> & { id: string; jobId: string }): Row {
  return {
    stage: 'applied' as Stage,
    stageChangedAt: ago(2 * HOUR),
    ownerId: AQSA.id,
    createdAt: ago(2 * HOUR),
    workedAt: null,
    jobCreatedAt: ago(5 * DAY),
    tutorName: 'Tutor',
    jobRef: 'TM-1001',
    jobTitle: 'Home Tutor Required',
    jobCity: 'Lahore',
    ...p,
  }
}

// --------------------------------------------------------------- sidebar --

test('Applications is its own item in the Tuitions group, after Post a tuition, with the overdue badge', () => {
  const group = NAV_GROUPS.find((g) => g.title === 'Tuitions')!
  const hrefs = group.items.map((i) => i.href)
  assert.ok(hrefs.includes('/admin/applications'))
  assert.equal(hrefs.indexOf('/admin/applications'), hrefs.indexOf('/admin/jobs/new') + 1)
  assert.equal(group.items.find((i) => i.href === '/admin/applications')!.screen, 'applicantForwards')
  assert.equal(SECTION_LABELS.applications, 'Applications')
  const layout = code('app/admin/layout.tsx')
  assert.match(layout, /'\/admin\/applications': overdue/)
  // The Follow-ups badge no longer counts applications.
  assert.doesNotMatch(layout, /'\/admin\/follow-ups':/)
})

test('the badge: own overdue items, all for the Owner; Older tuitions never count', () => {
  const items: BoardItem[] = [
    row({ id: 'a', jobId: 'j1', stageChangedAt: ago(2 * DAY) }),
    row({ id: 'k', jobId: 'j2', ownerId: KHIZRA.id, stageChangedAt: ago(2 * DAY) }),
    row({ id: 'old', jobId: 'j3', stageChangedAt: ago(40 * DAY), jobCreatedAt: ago(40 * DAY) }),
  ]
  assert.equal(overdueBadgeCount(items, AQSA, NOW), 1)
  assert.equal(overdueBadgeCount(items, KHIZRA, NOW), 1)
  assert.equal(overdueBadgeCount(items, OWNER, NOW), 2)
})

test('Follow-ups keeps its sign-up tabs only', () => {
  for (const r of ['owner', 'admin', 'operations', 'partner'] as const) assert.deepEqual(followUpTabsFor(r), ['tutors', 'parents', 'orphans'])
  assert.deepEqual(followUpTabsFor('tuitions_staff'), ['tutors'])
  assert.doesNotMatch(code('app/admin/follow-ups/page.tsx'), /ApplicationsClient|loadApplicationBoard/)
})

// ------------------------------------------------------------- redirects --

test('every old link redirects to the new page, keeping filters', () => {
  assert.equal(legacyApplicationsHref({ tab: 'applications' }), APPLICATIONS_PATH)
  assert.equal(legacyApplicationsHref({ tab: 'applications', show: 'mine' }), '/admin/applications?staff=mine')
  assert.equal(legacyApplicationsHref({ tab: 'applications', show: 'unassigned' }), '/admin/applications?staff=unassigned')
  assert.equal(legacyApplicationsHref({ tab: 'applications', show: 'demo' }), '/admin/applications?show=demo')
  // v3 (owner, 22 Oct 2026): the Forward to parents tab is gone — its links land on the page.
  assert.equal(legacyApplicationsHref({ tab: 'applications', view: 'forward', fwd: 'outcome' }), APPLICATIONS_PATH)
  // Applicants to forward and its sub-tabs.
  assert.equal(legacyApplicationsHref({ tab: 'to_forward' }), APPLICATIONS_PATH)
  assert.equal(legacyApplicationsHref({ tab: 'forwarded', staff: 'all' }), '/admin/applications?staff=all')
  assert.match(code('app/admin/follow-ups/page.tsx'), /if \(sp\.tab === 'applications'\) permanentRedirect\(legacyApplicationsHref\(sp\)\)/)
  assert.match(code('app/admin/jobs/applicants/page.tsx'), /permanentRedirect\(legacyApplicationsHref\(/)
  assert.doesNotMatch(code('app/admin/applications/ForwardToParents.tsx'), /view=forward/)
})

test('/tuitions is a permanent redirect to /browse/tuitions, and only the bare address', () => {
  const cfg = code('next.config.ts')
  assert.match(cfg, /\{ source: '\/tuitions', destination: '\/browse\/tuitions', permanent: true \}/)
  assert.doesNotMatch(cfg, /source: '\/tuitions\/:/)
})

// ---------------------------------------------------------- staff filter --

test('Staff filter: staff open on their own name, the Owner on All; anyone may view another list', () => {
  assert.equal(parseStaffFilter(undefined, AQSA), AQSA.id)
  assert.equal(parseStaffFilter(undefined, OWNER), 'all')
  assert.equal(parseStaffFilter('mine', KHIZRA), KHIZRA.id)
  assert.equal(parseStaffFilter(AQSA.id, KHIZRA), AQSA.id)
  assert.equal(parseStaffFilter('unassigned', KHIZRA), 'unassigned')
  assert.equal(parseStaffFilter('<script>', KHIZRA), KHIZRA.id)
  const items = [row({ id: 'a', jobId: 'j1' }), row({ id: 'k', jobId: 'j2', ownerId: KHIZRA.id }), row({ id: 'u', jobId: 'j3', ownerId: null })]
  assert.deepEqual(items.filter((i) => matchesStaff(i, AQSA.id)).map((i) => i.id), ['a'])
  assert.deepEqual(items.filter((i) => matchesStaff(i, 'unassigned')).map((i) => i.id), ['u'])
  const choices = staffChoices(items, new Map([[AQSA.id, 'Aqsa Mughal'], [KHIZRA.id, 'Khizra Danish']]), KHIZRA)
  assert.deepEqual(
    choices.map((c) => [c.key, c.count]),
    [['all', 3], [KHIZRA.id, 1], [AQSA.id, 1], ['unassigned', 1]],
  )
  assert.match(choices[1].label, /^Mine \(Khizra Danish\)$/)
  assert.equal(parseStageFilter('demo'), 'demo')
  assert.equal(parseStageFilter('x'), 'any')
})

test('viewing another staff list does not grant editing: own tuitions only, the Owner any', () => {
  assert.equal(mayEditStage(KHIZRA, AQSA.id), false)
  assert.equal(mayEditStage(KHIZRA, KHIZRA.id), true)
  assert.equal(mayEditStage(OWNER, AQSA.id), true)
  // The server route still applies it.
  assert.match(code('lib/applicationTracking.ts'), /if \(!mayEditStage\(args\.actor, ownerId\)\)/)
})

// -------------------------------------------------------------- posted by --

test('Posted by filter on the admin Tuitions page reads posted_by, with counts, from the URL', () => {
  const lib = code('lib/adminJobs.ts')
  assert.match(lib, /tuition_owners!inner\(posted_by\)/)
  assert.match(lib, /q = q\.eq\('tuition_owners\.posted_by', poster\)/)
  assert.match(lib, /export async function adminPosterFacets/)
  const page = code('app/admin/jobs/page.tsx')
  assert.match(page, /poster: postedBy === 'admin' \? \(sp\.poster \?\? ''\) : ''/)
  assert.match(code('app/admin/jobs/JobFilters.tsx'), /\{p\.name\} \(\{p\.count\}\)/)
  assert.match(code('app/api/admin/jobs/route.ts'), /poster: get\('poster'\)/)
})

// ----------------------------------------------------- grouping and order --

test('grouping: one group per tuition; overdue first (oldest), then unworked, then worked (most recent last)', () => {
  const rows = [
    row({ id: 'w1', jobId: 'worked-old', stage: 'forwarded', stageChangedAt: ago(1 * DAY), workedAt: ago(1 * DAY) }),
    row({ id: 'w2', jobId: 'worked-new', stage: 'forwarded', stageChangedAt: ago(1 * HOUR), workedAt: ago(1 * HOUR) }),
    row({ id: 'o1', jobId: 'overdue-young', stageChangedAt: ago(2 * DAY) }),
    row({ id: 'o2', jobId: 'overdue-old', stageChangedAt: ago(5 * DAY) }),
    row({ id: 'f1', jobId: 'fresh', stageChangedAt: ago(3 * HOUR), createdAt: ago(3 * HOUR) }),
    row({ id: 'f2', jobId: 'fresh', stage: 'forwarded', stageChangedAt: ago(2 * HOUR), workedAt: ago(2 * HOUR) }),
  ]
  const { main, older } = groupBoard(rows, NOW)
  assert.equal(older.length, 0)
  assert.deepEqual(main.map((g) => g.jobId), ['overdue-old', 'overdue-young', 'fresh', 'worked-old', 'worked-new'])
  assert.deepEqual(main.map((g) => g.state), ['overdue', 'overdue', 'open', 'worked', 'worked'])
  // Inside a group the worked row is at the bottom.
  assert.deepEqual(main[2].rows.map((r) => r.id), ['f1', 'f2'])
  assert.equal(groupCountLine(['applied', 'applied', 'forwarded', 'hired']), '4 applied · 2 forwarded · 1 hired')
  assert.equal(groupCountLine(['applied', 'forwarded']), '2 applied · 1 forwarded')
  assert.equal(shortTitle('Female Home Tutor Required | Grade 1–5 | DHA Phase 6 | Lahore extra words here', 40), 'Female Home Tutor Required | Grade 1–5…')
})

test('an item sinks after activity and comes back with its flag when overdue again', () => {
  const before = row({ id: 'a', jobId: 'j', stageChangedAt: ago(3 * DAY) })
  assert.equal(itemOverdue(before, NOW), 'forward_overdue')
  assert.equal(isWorked(before, NOW), false)
  // A WhatsApp tap an hour ago: worked, not overdue (counted from the tap).
  const tapped = { ...before, workedAt: ago(1 * HOUR) }
  assert.equal(itemOverdue(tapped, NOW), null)
  assert.equal(isWorked(tapped, NOW), true)
  const g = groupBoard([tapped, row({ id: 'b', jobId: 'j', stageChangedAt: ago(1 * HOUR) })], NOW).main[0]
  assert.deepEqual(g.rows.map((r) => r.id), ['b', 'a'])
  // Still Applied 25 hours after the tap: overdue again, back on top.
  const later = NOW + 25 * HOUR
  assert.equal(itemOverdue(tapped, later), 'forward_overdue')
  assert.equal(isWorked(tapped, later), false)
  assert.equal(groupBoard([tapped, row({ id: 'b', jobId: 'j', stageChangedAt: ago(1 * HOUR) })], later).main[0].rows[0].id, 'a')
  assert.equal(workedLine(ago(2 * DAY), 'Aqsa Mughal', NOW), 'Updated 2 days ago by Aqsa Mughal')
  // Activity is recorded on a stage change, a WhatsApp tap and a forward.
  const lib = code('lib/applicationTracking.ts')
  assert.match(lib, /worked_at: now,\s*worked_by: actor\.id,\s*worked_by_name: name/)
  assert.match(code('app/api/admin/applications/whatsapp/route.ts'), /await recordCheckInTap\(gate\.actor, id\.data\)/)
  assert.match(lib, /await markWorked\(admin, actor, name, touched\)/)
})

// ----------------------------------------------------------------- search --

test('search finds worked items and Older items by tutor, TM number, title or city', () => {
  const worked = { tutorName: 'Sana Riaz', jobRef: 'TM-1300', jobTitle: 'O Level Physics', jobCity: 'Karachi' }
  assert.ok(searchMatches(worked, 'sana'))
  assert.ok(searchMatches(worked, 'TM-1300'))
  assert.ok(searchMatches(worked, '1300'))
  assert.ok(searchMatches(worked, 'tm1300'))
  assert.ok(searchMatches(worked, 'physics'))
  assert.ok(searchMatches(worked, 'karachi'))
  assert.equal(searchMatches(worked, 'lahore'), false)
  // The page searches EVERY row — staff and stage filters are set aside, and
  // the Older section opens when it holds a match.
  const ui = code('app/admin/applications/ApplicationsClient.tsx')
  // v3: search covers To do, Sent and Older, filters set aside (no Older section while searching).
  assert.ok(ui.includes('const listed = searching ? all.filter((r) => hits.has(r.id))'))
  assert.ok(ui.includes('const olderRows = searching ? []'))
  assert.match(ui, /hit \? 'bg-tm-tint-gold'/)
})

// ------------------------------------------------------------------ older --

test('Older: a tuition posted over 30 days ago is collapsed, never overdue; its stage is untouched', () => {
  assert.equal(isOlderTuition(ago(31 * DAY), NOW), true)
  assert.equal(isOlderTuition(ago(30 * DAY), NOW), false)
  const old = row({ id: 'o', jobId: 'old', stageChangedAt: ago(20 * DAY), jobCreatedAt: ago(45 * DAY) })
  assert.equal(itemOverdue(old, NOW), null)
  const { main, older } = groupBoard([old, row({ id: 'n', jobId: 'new' })], NOW)
  assert.deepEqual(older.map((g) => g.jobId), ['old'])
  assert.deepEqual(main.map((g) => g.jobId), ['new'])
  assert.equal(older[0].rows[0].stage, 'applied')
  // Nothing writes a stage for Older, and the tutor dashboard reads stage as stored.
  assert.doesNotMatch(code('lib/applicationTracking.ts'), /isOlderTuition|OLDER_AFTER_DAYS/)
  assert.match(code('lib/applicationTracking.ts'), /stage: \(\(a\.stage as Stage\) \?\? 'applied'\) as Stage/)
})

// ------------------------------------------------------------ city owners --

test('city owners: names match exactly one staff account, never a guess', () => {
  const staff = [
    { id: '1', name: 'Nabeel' },
    { id: '2', name: 'Inzamam Ullah' },
    { id: '3', name: 'Aqsa Mughal' },
    { id: '4', name: 'Ali Khan' },
    { id: '5', name: 'Ali Raza' },
  ]
  assert.equal(matchStaffName('Nabeel', staff)?.id, '1')
  assert.equal(matchStaffName('Inzamam', staff)?.id, '2')
  assert.equal(matchStaffName('aqsa  mughal', staff)?.id, '3')
  assert.equal(matchStaffName('Ali', staff), null)
  assert.equal(matchStaffName('Nobody', staff), null)
  assert.equal(CITY_OWNER_SEED.find((s) => s.name === 'Aqsa Mughal')!.cities[0], 'Lahore')
})

test('city owners never touch a staff-posted tuition or a hand-chosen owner', () => {
  assert.equal(cityRuleApplies(undefined), true)
  assert.equal(cityRuleApplies({ staffId: null, source: 'poster', postedBy: null }), true)
  assert.equal(cityRuleApplies({ staffId: 'x', source: 'city', postedBy: null }), true)
  assert.equal(cityRuleApplies({ staffId: 'aqsa', source: 'poster', postedBy: 'aqsa' }), false)
  assert.equal(cityRuleApplies({ staffId: 'k', source: 'reassigned', postedBy: 'aqsa' }), false)
  assert.equal(cityRuleApplies({ staffId: null, source: 'reassigned', postedBy: null }), false)
  const map = new Map([['lahore', 'aqsa']])
  assert.equal(cityOwnerFor('Lahore', map, 'alee'), 'aqsa')
  assert.equal(cityOwnerFor('Swat', map, 'alee'), 'alee')
  // A parent's own post gets its city owner; a staff post records its poster.
  const jobs = code('lib/jobs.ts')
  assert.match(jobs, /await assignNewTuitionOwner\(job\.id as string\)/)
  assert.match(code('lib/applicationTracking.ts'), /posted_by: staffId, source: 'poster'/)
  // Only the site Owner edits: the list names nobody, and setCityOwner checks again.
  assert.deepEqual(SCREEN_ACCESS.cityOwners, [])
  assert.equal(roleSatisfies('partner', SCREEN_ACCESS.cityOwners), true)
  assert.equal(roleMayWrite('partner', SCREEN_ACCESS.cityOwners), false)
  assert.equal(roleSatisfies('admin', SCREEN_ACCESS.cityOwners), false)
  assert.match(code('lib/cityOwners.ts'), /if \(args\.actor\.adminRole !== 'owner'\) return \{ ok: false, status: 403/)
  assert.match(code('supabase/migrations/193_applications_v2.sql'), /create policy city_owners_admin_read on public\.city_owners\s*for select using \(public\.is_admin\(\)\)/)
})

// ------------------------------------------------------------ parent hire --

test('a parent hire sets Hired, recorded as by "Parent", without touching JobPosting, expiry or noindex', () => {
  const jobs = code('lib/jobs.ts')
  const hire = jobs.slice(jobs.indexOf('export async function hireApplicant'))
  assert.match(hire, /await recordParentHire\(\{ jobId: job\.id as string, tutorId: application\.tutor_id as string, parentId \}\)/)
  const lib = code('lib/applicationTracking.ts')
  const rec = lib.slice(lib.indexOf('export async function recordParentHire'))
  assert.match(rec, /stage_changed_by_name: PARENT_NAME/)
  assert.match(rec, /from\('application_stage_events'\)\.insert/)
  assert.match(rec, /action: 'application\.stage'/)
  assert.match(rec, /event: 'application_stage_changed'/)
  // It never writes the tuition, and never marks the other applicants.
  const body = rec.slice(0, rec.indexOf('\n}\n'))
  assert.doesNotMatch(body, /from\('jobs'\)/)
  assert.doesNotMatch(body, /not_selected/)
  // The tuition's page rules depend on the tuition's status only.
  assert.equal(tuitionPublicState('open').emitJobPosting, true)
  assert.equal(tuitionPublicState('open').indexable, true)
  // JobPosting is built from the tuition alone — never an application stage.
  const seo = code('lib/seo.ts')
  const jp = seo.slice(seo.indexOf('export function jobPostingJsonLd'), seo.indexOf('export function jobPostingJsonLd') + 4000)
  assert.doesNotMatch(jp, /stage|hired_by|recordParentHire/)
  assert.equal(typeof jobPostingJsonLd, 'function')
  // The tutor dashboard shows Hired from the stored stage, and the timeline says by the parent.
  assert.match(code('lib/timelineText.ts'), /str\(meta\.by\) === 'parent' \? 'the parent' : 'staff'/)
})
