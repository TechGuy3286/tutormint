/**
 * scripts/test-application-tracking.ts — npm run test:applicationtracking
 * Owner, 22 Oct 2026 — application tracking:
 *   - stage changes write the history, the tuition's audit trail and the tutor's timeline
 *   - staff edit only their own tuitions' applications; the Owner edits any
 *   - reassigning is Owner-only and logged
 *   - overdue flags at exactly 1 and 3 days
 *   - the Follow-ups badge count
 *   - public pages never show names, stages or "Hired"
 *   - the tutor dashboard wording
 *   - the Success story button hidden for unverified tutors
 *   - JobPosting, expiry and noindex unchanged after a Hired
 * Pure rules + source scans. No browser, no network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  adminStageLine,
  boardCounts,
  checkInMessage,
  defaultFilter,
  matchesFilter,
  mayEditStage,
  mayReassign,
  otherOpenOnJob,
  overdueBadgeCount,
  overdueFlag,
  parseFilter,
  publicAppliedLine,
  sortBoard,
  STAGES,
  successStoryAction,
  tallyStages,
  TUTOR_STAGE_TEXT,
  type BoardItem,
  type Stage,
} from '../lib/applicationStageCore'
import { timelineSentence } from '../lib/timelineText'
import { jobPostingJsonLd } from '../lib/seo'
import { tuitionPublicState } from '../lib/tuitionStatus'

const code = (p: string) => readFileSync(p, 'utf8')
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-22T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

const OWNER = { id: 'owner-1', adminRole: 'owner' }
const AQSA = { id: 'staff-a', adminRole: 'operations' }
const NABEEL = { id: 'staff-n', adminRole: 'tuitions_staff' }
const PARTNER = { id: 'pm-1', adminRole: 'partner' }

// ------------------------------------------------------------ stage changes

test('stages: the seven stages, in order', () => {
  assert.deepEqual([...STAGES], ['applied', 'forwarded', 'contacted', 'demo', 'hired', 'not_selected', 'no_response'])
})

test('a stage change writes the history, the tuition audit row and the tutor timeline', () => {
  const src = code('lib/applicationTracking.ts')
  const body = src.slice(src.indexOf('async function writeStage'), src.indexOf('export async function changeStage'))
  assert.match(body, /from\('applications'\)\s*\.update\(\{\s*stage: to,\s*stage_changed_at: now,\s*stage_changed_by: actor\.id/)
  assert.match(body, /from\('application_stage_events'\)\.insert/)
  assert.match(body, /action: 'application\.stage',\s*targetType: 'job'/)
  assert.match(body, /event: 'application_stage_changed'/)
  // The tutor's timeline names it in plain English.
  assert.equal(timelineSentence('application_stage_changed', { stage: 'Forwarded' }), 'Application moved to Forwarded by staff')
  assert.ok(code('lib/memberTimelineCore.ts').includes("'application_stage_changed'"))
  assert.ok(code('lib/timelineLabelsCore.ts').includes("'application.stage'"))
})

test('only the service role changes a stage (migration 192 trigger)', () => {
  const sql = code('supabase/migrations/192_application_stages.sql')
  assert.match(sql, /create trigger application_stage_guard\s+before update on public\.applications/)
  assert.match(sql, /if auth\.uid\(\) is null then\s+return new;/)
  assert.match(sql, /errcode = '42501'/)
})

test('a forward to the parent moves Applied → Forwarded', () => {
  const src = code('lib/applicantForwards.ts')
  assert.match(src, /await advanceForwarded\(args\.actor, args\.jobId, tutorIds\)/)
  // Applications v2 (owner, 22 Oct 2026): only an Applied one moves; the others
  // keep their stage and are marked worked.
  assert.match(code('lib/applicationTracking.ts'), /if \(a\.stage !== 'applied'\) \{\s*touched\.push\(a\.id\)/)
})

test('Hired: the other open applications are offered, the default leaves them', () => {
  const all = [
    { id: 'a', jobId: 'j1', stage: 'forwarded' as Stage },
    { id: 'b', jobId: 'j1', stage: 'applied' as Stage },
    { id: 'c', jobId: 'j1', stage: 'not_selected' as Stage },
    { id: 'd', jobId: 'j2', stage: 'applied' as Stage },
  ]
  assert.deepEqual(otherOpenOnJob(all, { id: 'a', jobId: 'j1' }).map((x) => x.id), ['b'])
  const ui = code('app/admin/applications/ApplicationsClient.tsx')
  // Nothing ticked unless staff tick it.
  assert.match(ui, /setHire\(\{ row, others: data\?\.others \?\? \[\], close: new Set\(\) \}\)/)
  // Only the ticked ones are closed, server-side, as Not selected.
  assert.match(code('lib/applicationTracking.ts'), /if \(!wanted\.has\(s\.id\)\) continue\s+if \(await writeStage\(admin, args\.actor, name, s, 'not_selected'/)
})

// -------------------------------------------------------------- who may edit

test('staff edit only their own tuitions; the Owner edits any; others read-only', () => {
  assert.equal(mayEditStage(OWNER, null), true)
  assert.equal(mayEditStage(OWNER, AQSA.id), true)
  assert.equal(mayEditStage(AQSA, AQSA.id), true)
  assert.equal(mayEditStage(AQSA, NABEEL.id), false)
  assert.equal(mayEditStage(AQSA, null), false)
  assert.equal(mayEditStage(PARTNER, AQSA.id), false)
  assert.equal(mayEditStage(PARTNER, PARTNER.id), true)
  assert.equal(mayEditStage(null, AQSA.id), false)
  // The route goes through changeStage, which refuses with 403 before writing.
  const src = code('lib/applicationTracking.ts')
  const change = src.slice(src.indexOf('export async function changeStage'), src.indexOf('export type OtherOpen'))
  assert.ok(change.indexOf('mayEditStage(args.actor, ownerId)') < change.indexOf('writeStage('))
  assert.match(change, /status: 403/)
  assert.match(code('app/api/admin/applications/stage/route.ts'), /changeStage\(\{ actor: gate\.actor/)
})

test('reassigning is Owner-only and logged', () => {
  assert.equal(mayReassign(OWNER), true)
  for (const a of [AQSA, NABEEL, PARTNER, { id: 'x', adminRole: 'admin' }]) assert.equal(mayReassign(a), false)
  const src = code('lib/applicationTracking.ts')
  const fn = src.slice(src.indexOf('export async function reassignOwner'), src.indexOf('export async function recordPoster'))
  // The Owner check is the very first thing — before any database work.
  assert.ok(fn.indexOf('if (!mayReassign(args.actor))') < fn.indexOf('createAdminClient()'))
  assert.match(fn, /action: 'job\.owner_assign'/)
  assert.match(fn, /detail: \{ from, to: args\.staffId \}/)
  assert.match(code('app/api/admin/applications/owner/route.ts'), /reassignOwner\(\{ actor: gate\.actor/)
})

test('a new staff tuition is owned by the staff member who posted it', () => {
  const jobs = code('lib/jobs.ts')
  assert.match(jobs, /await recordPoster\(admin, job\.id as string, actor\.id\)/)
})

// ------------------------------------------------------------------ overdue

test('Forward overdue: Applied for more than 1 day — exactly 1 day is not yet', () => {
  assert.equal(overdueFlag('applied', ago(DAY), NOW), null)
  assert.equal(overdueFlag('applied', ago(DAY + 1), NOW), 'forward_overdue')
  assert.equal(overdueFlag('applied', ago(DAY - 1), NOW), null)
})

test('Check in: Forwarded / Contacted / Demo with no update for more than 3 days', () => {
  for (const s of ['forwarded', 'contacted', 'demo'] as Stage[]) {
    assert.equal(overdueFlag(s, ago(3 * DAY), NOW), null, s)
    assert.equal(overdueFlag(s, ago(3 * DAY + 1), NOW), 'check_in', s)
  }
  for (const s of ['hired', 'not_selected', 'no_response'] as Stage[]) assert.equal(overdueFlag(s, ago(30 * DAY), NOW), null, s)
})

test('overdue rows sort to the top', () => {
  const items: BoardItem[] = [
    { id: 'fresh', stage: 'applied', stageChangedAt: ago(1000), ownerId: AQSA.id, createdAt: ago(1000) },
    { id: 'check', stage: 'forwarded', stageChangedAt: ago(4 * DAY), ownerId: AQSA.id, createdAt: ago(5 * DAY) },
    { id: 'late', stage: 'applied', stageChangedAt: ago(2 * DAY), ownerId: AQSA.id, createdAt: ago(2 * DAY) },
    { id: 'hired', stage: 'hired', stageChangedAt: ago(10 * DAY), ownerId: AQSA.id, createdAt: ago(10 * DAY) },
  ]
  assert.deepEqual(sortBoard(items, NOW).map((i) => i.id), ['late', 'check', 'fresh', 'hired'])
})

test('the Follow-ups badge: own overdue applications; every one for the Owner', () => {
  const items: BoardItem[] = [
    { id: '1', stage: 'applied', stageChangedAt: ago(2 * DAY), ownerId: AQSA.id, createdAt: ago(2 * DAY) },
    { id: '2', stage: 'demo', stageChangedAt: ago(5 * DAY), ownerId: NABEEL.id, createdAt: ago(9 * DAY) },
    { id: '3', stage: 'applied', stageChangedAt: ago(2 * DAY), ownerId: null, createdAt: ago(2 * DAY) },
    { id: '4', stage: 'applied', stageChangedAt: ago(DAY), ownerId: AQSA.id, createdAt: ago(DAY) }, // exactly 1 day
    { id: '5', stage: 'hired', stageChangedAt: ago(9 * DAY), ownerId: AQSA.id, createdAt: ago(9 * DAY) },
  ]
  assert.equal(overdueBadgeCount(items, AQSA, NOW), 1)
  assert.equal(overdueBadgeCount(items, NABEEL, NOW), 1)
  assert.equal(overdueBadgeCount(items, OWNER, NOW), 3)
  assert.equal(overdueBadgeCount(items, PARTNER, NOW), 0)
  const layout = code('app/admin/layout.tsx')
  assert.match(layout, /'\/admin\/applications': overdue/)
  assert.match(layout, /overdueApplicationsCount\(actor\)/)
})

test('filters: Mine for staff, All for the Owner; chips count every stage', () => {
  assert.equal(defaultFilter(OWNER), 'all')
  assert.equal(defaultFilter(AQSA), 'mine')
  assert.equal(parseFilter('nonsense', AQSA), 'mine')
  assert.equal(parseFilter('demo', AQSA), 'demo')
  const items: BoardItem[] = [
    { id: '1', stage: 'applied', stageChangedAt: ago(1), ownerId: AQSA.id, createdAt: ago(1) },
    { id: '2', stage: 'hired', stageChangedAt: ago(1), ownerId: null, createdAt: ago(1) },
  ]
  const c = boardCounts(items, AQSA.id)
  assert.equal(c.mine, 1)
  assert.equal(c.all, 2)
  assert.equal(c.unassigned, 1)
  assert.equal(c.hired, 1)
  assert.equal(items.filter((i) => matchesFilter(i, 'unassigned', AQSA.id)).length, 1)
})

// ------------------------------------------------------------ public pages

test('public pages: a count only — never a name, a stage or "Hired"', () => {
  assert.equal(publicAppliedLine(0), null)
  assert.equal(publicAppliedLine(null), null)
  assert.equal(publicAppliedLine(1), '1 tutor applied')
  assert.equal(publicAppliedLine(6), '6 tutors applied')
  for (const n of [1, 2, 9, 120]) assert.doesNotMatch(publicAppliedLine(n) ?? '', /hired|forward|contact|demo|selected|response/i)
  // The public function returns a count and nothing else.
  const sql = code('supabase/migrations/192_application_stages.sql')
  assert.match(sql, /returns table \(job_id uuid, applied integer\)/)
  // The card and the page read the count through publicAppliedLine only.
  for (const f of ['components/JobCard.tsx', 'app/(site)/tuitions/[city]/[slug]/page.tsx']) {
    const src = code(f)
    assert.match(src, /publicAppliedLine\(job\.applied_count\)/, f)
    assert.doesNotMatch(src, /applicationStageCore'[\s\S]*STAGE_LABEL|TUTOR_STAGE_TEXT|stageLine|tallyStages/, f)
  }
  // The feed fills applied_count from the count function — never a stage.
  const feed = code('lib/jobFeed.ts')
  assert.match(feed, /rpc\('job_applied_counts'/)
  assert.doesNotMatch(feed, /\bstage\b/)
})

test('admin tuition card: "6 applied · 2 forwarded · 1 hired"', () => {
  const t = tallyStages(['applied', 'applied', 'applied', 'forwarded', 'hired', 'not_selected'])
  assert.deepEqual(t, { applied: 6, forwarded: 2, hired: 1 })
  assert.equal(adminStageLine(t), '6 applied · 2 forwarded · 1 hired')
  assert.equal(adminStageLine({ applied: 0, forwarded: 0, hired: 0 }), null)
})

// ------------------------------------------------------------ tutor wording

test('the tutor dashboard says it in the owner\'s words', () => {
  assert.deepEqual(TUTOR_STAGE_TEXT, {
    applied: 'Application received',
    forwarded: 'Shared with the parent',
    contacted: 'Parent contacted you',
    demo: 'Demo/interview stage',
    hired: 'You got this tuition ✓',
    not_selected: 'The parent chose another tutor',
    no_response: 'No reply from the parent',
  })
  const section = code('components/tutor/MyApplicationsSection.tsx')
  assert.match(section, /TUTOR_STAGE_TEXT\[c\.stage\]/)
  assert.doesNotMatch(section, /parent_name|phone|whatsapp/i)
  const dash = code('app/(site)/tutor/dashboard/page.tsx')
  assert.match(dash, /<MyApplicationsSection cards=\{myApplications\} hired=\{hiredCount\} \/>/)
  assert.match(dash, /label: 'Hired'/)
})

test('the check-in message is English and never carries a phone number', () => {
  for (const s of STAGES) {
    const m = checkInMessage({ stage: s, tutorName: 'Ali Raza', title: 'Home Tutor Required | Grade 5', city: 'Lahore', tuitionPath: '/tuitions/lahore/x-abc123' })
    assert.match(m, /^Assalam o Alaikum Ali, this is TutorMint about your application/)
    assert.doesNotMatch(m, /\d{7,}/)
    assert.match(m, /\n\nhttps:\/\/www\.tutormint\.org\//)
  }
})

// ------------------------------------------------------------ success story

test('Success story: only on Hired, only for a verified tutor', () => {
  assert.deepEqual(successStoryAction({ stage: 'hired', tutorVerified: true, tutorSlug: 'ali-raza' }), {
    href: '/admin/social?tutor=ali-raza&template=success&success=hired',
  })
  assert.deepEqual(successStoryAction({ stage: 'hired', tutorVerified: false, tutorSlug: 'ali-raza' }), { label: 'Verify first' })
  assert.deepEqual(successStoryAction({ stage: 'hired', tutorVerified: true, tutorSlug: null }), { label: 'Verify first' })
  assert.equal(successStoryAction({ stage: 'demo', tutorVerified: true, tutorSlug: 'ali-raza' }), null)
  // Social posts reads the preselection.
  const page = code('app/admin/social/page.tsx')
  assert.match(page, /isSocialTemplate\(sp\.template\)/)
})

// ------------------------------------------- a Hired never touches the tuition

test('JobPosting, expiry and noindex unchanged after a Hired', () => {
  const src = code('lib/applicationTracking.ts')
  // No write to the tuition row anywhere in application tracking.
  assert.doesNotMatch(src, /from\('jobs'\)\s*\.(update|upsert|insert|delete)/)
  // The tuition's public state and its JobPosting come from the tuition alone.
  const open = tuitionPublicState('open', null)
  assert.equal(open.indexable, true)
  assert.equal(open.emitJobPosting, true)
  assert.equal(open.inSitemap, true)
  const base = {
    url: 'https://www.tutormint.org/tuitions/lahore/x-abc123',
    title: 'Home Tutor Required',
    description: 'Grade 5 Maths in DHA, Lahore.',
    datePosted: '2026-10-20T00:00:00Z',
    city: 'Lahore',
    area: 'DHA',
    subjects: ['Mathematics'],
    budgetMin: 10000,
    budgetMax: 15000,
    validThrough: '2026-11-09T00:00:00Z',
    refId: 'TM-2000',
  }
  const before = JSON.stringify(jobPostingJsonLd(base))
  const after = JSON.stringify(jobPostingJsonLd({ ...base, ...({ applied_count: 3, stage: 'hired' } as object) } as typeof base))
  assert.equal(after, before)
  // The page builds JobPosting without any application data.
  const page = code('app/(site)/tuitions/[city]/[slug]/page.tsx')
  const jp = page.slice(page.indexOf('jobPostingJsonLd({'), page.indexOf('jobPostingJsonLd({') + 1500)
  assert.doesNotMatch(jp, /applied_count|stage/)
})

// -------------------------------------------------------------- old address

test('Applicants to forward redirects to Tuitions → Applications', () => {
  // Applications v2 (owner, 22 Oct 2026): its own page.
  const page = code('app/admin/jobs/applicants/page.tsx')
  assert.match(page, /permanentRedirect\(legacyApplicationsHref\(/)
  assert.doesNotMatch(code('lib/adminNav.ts'), /'\/admin\/jobs\/applicants'/)
})
