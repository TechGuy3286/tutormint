/**
 * scripts/test-people-cleanup.ts  —  npm run test:peoplecleanup
 *
 * Owner, 9 Nov 2026: People page clean-up — "act now" badges, one status line
 * per card, the staff default view, the new Waiting for approval rule, no-mobile
 * tutors last, and the "Photo looks blank" flag. Invented data only — no
 * database, no real names, numbers or photos.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

import {
  PIPE_STAGES,
  WAITING_MIN_COMPLETION,
  docsReadyForReview,
  pipelineOrder,
  pipelineStage,
  stageHref,
  tutorStageFromAddress,
  type DocState,
} from '../lib/tutorPipelineCore'
import {
  NO_MOBILE_LINE,
  blankLine,
  feePendingDue,
  pipeCardFrom,
  pipeSortAt,
  pipeStatusLine,
  readyForReviewFrom,
  showProfileShare,
  type PipeDocFacts,
} from '../lib/tutorPipelineCardCore'
import type { CardDocState } from '../lib/tutorDocQueueCore'
import { badgeText, navBadgesFrom, type BadgesPayload } from '../lib/adminSummaryCore'
import { gridHref } from '../lib/cardGridPagingCore'
import { isNewUnseenApplication, type FollowUpRecord } from '../lib/applicationFollowUpCore'
import { BLANK_SIZE, blankRejectReason, currentBlankItems, greyStats, looksBlank } from '../lib/photoBlankCore'
import { REJECT_REASONS } from '../lib/rejectReasonsCore'
import { OVERVIEW_ITEMS, OVERVIEW_ITEM_KEYS } from '../lib/overviewItemsCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const T0 = Date.parse('2026-11-09T06:00:00Z')
const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const STATES: DocState[] = ['approved', 'waiting', 'rejected', 'none']

function cs(s: DocState): CardDocState {
  if (s === 'approved') return { status: 'approved', reason: null, hasUpload: true }
  if (s === 'waiting') return { status: 'pending', reason: null, hasUpload: true }
  if (s === 'rejected') return { status: 'rejected', reason: 'Blurry', hasUpload: true }
  return { status: 'none', reason: null, hasUpload: false }
}
const docs = (cnic: DocState, photo: DocState, selfie: DocState): PipeDocFacts => ({
  statuses: { cnic: cs(cnic), profilePic: cs(photo), selfie: cs(selfie) },
  oldestUploadAt: iso(T0 - DAY),
})
function card(a: { cnic?: DocState; photo?: DocState; selfie?: DocState; feePaid?: boolean; completion?: number; mobileOk?: boolean; blank?: ('photo' | 'selfie')[]; ni?: boolean }) {
  return pipeCardFrom({
    name: 'Invented Tutor',
    feePaid: a.feePaid ?? false,
    completion: a.completion ?? 90,
    mobileOk: a.mobileOk ?? true,
    blank: a.blank ?? [],
    docs: docs(a.cnic ?? 'approved', a.photo ?? 'approved', a.selfie ?? 'approved'),
    contacts: [],
    notInterested: a.ni ?? false,
    paused: false,
    lastActiveAt: iso(T0),
    support: '0300 0000000',
    nowMs: T0,
  })
}

// ---------------------------------------------------- 4. waiting rule ---

test('Waiting for approval needs all three uploaded, one pending, none rejected and 80%+', () => {
  assert.equal(WAITING_MIN_COMPLETION, 80)
  const f = { cnic: 'waiting', photo: 'approved', selfie: 'waiting', feePaid: false } as const
  // The 79% vs 80% edge.
  assert.equal(pipelineStage({ ...f, completion: 80 }), 'waiting')
  assert.equal(pipelineStage({ ...f, completion: 79 }), 'missing')
  assert.equal(docsReadyForReview(f, 80), true)
  assert.equal(docsReadyForReview(f, 79), false)
  // One document not uploaded → Documents missing, even at 100%.
  assert.equal(pipelineStage({ cnic: 'waiting', photo: 'waiting', selfie: 'none', feePaid: false, completion: 100 }), 'missing')
  // Nothing pending → not waiting.
  assert.equal(docsReadyForReview({ cnic: 'approved', photo: 'approved', selfie: 'approved' }, 100), false)
  // A rejected one → Rejected, never Waiting.
  assert.equal(pipelineStage({ cnic: 'waiting', photo: 'rejected', selfie: 'waiting', feePaid: false, completion: 100 }), 'rejected')
})

test('a tutor moved to Documents missing keeps a status line naming the pending document(s)', () => {
  const c = card({ cnic: 'waiting', photo: 'approved', selfie: 'none', completion: 64 })
  assert.equal(c.stage, 'missing')
  assert.equal(pipeStatusLine(c), 'CNIC waiting approval · Selfie missing · Profile 64%')
  const low = card({ cnic: 'waiting', photo: 'waiting', selfie: 'approved', completion: 79 })
  assert.equal(low.stage, 'missing')
  assert.equal(pipeStatusLine(low), 'CNIC waiting approval · Profile photo waiting approval · Profile 79% (80% needed for review)')
  assert.equal(pipeStatusLine(card({ cnic: 'none', selfie: 'none', completion: 64 })), 'Missing: CNIC, Selfie · Profile 64%')
  assert.equal(pipeStatusLine(card({ cnic: 'waiting', completion: 85 })), 'Waiting approval: CNIC · Profile 85%')
  assert.equal(pipeStatusLine(card({ completion: 95 })), 'Documents approved · fee pending · Profile 95%')
  // Staff can still open Review: the card's own documents summary still says waiting.
  assert.match(read('lib/tutorDocSummaryCore.ts'), /if \(waitingCount > 0\) return \{ kind: 'waiting'/)
})

test('every tutor stays in exactly one stage, for every combination and completion', () => {
  let n = 0
  for (const feePaid of [false, true])
    for (const completion of [0, 79, 80, 100])
      for (const cnic of STATES)
        for (const photo of STATES)
          for (const selfie of STATES) {
            const stage = pipelineStage({ cnic, photo, selfie, feePaid, completion })
            assert.equal(PIPE_STAGES.filter((s) => s === stage).length, 1)
            // The status line always describes that one stage.
            const line = pipeStatusLine(card({ cnic, photo, selfie, feePaid, completion }))
            if (stage === 'waiting') assert.match(line, /^Waiting approval: /)
            if (stage === 'rejected') assert.match(line, /^Rejected: /)
            if (stage === 'approved') assert.match(line, /^Documents approved/)
            if (stage === 'paid') assert.match(line, /^Fee paid/)
            n++
          }
  assert.equal(n, 2 * 4 * 64)
})

test('the Overview row and the People badge use the same ready-for-review rule', () => {
  assert.equal(readyForReviewFrom(docs('waiting', 'approved', 'approved'), 80), true)
  assert.equal(readyForReviewFrom(docs('waiting', 'approved', 'approved'), 79), false)
  assert.equal(readyForReviewFrom(docs('waiting', 'none', 'approved'), 100), false)
  const ov = read('lib/overviewItems.ts')
  assert.ok(ov.includes("filter((p) => readyForReviewFrom(docs.get(p.id), p.completion))"))
  assert.ok(read('lib/adminSummary.ts').includes('readyForReviewFrom(docs.get(t.id), t.completion)'))
  assert.ok(read('lib/peopleDirectory.ts').includes('readyForReviewFrom(docs.get(t.id), t.completion)'))
})

// ------------------------------------------------------ 2. cleaner cards ---

test('share buttons only for paid tutors', () => {
  assert.equal(showProfileShare(true), true)
  assert.equal(showProfileShare(false), false)
  assert.equal(showProfileShare(null), false)
  assert.ok(read('components/admin/OverviewCardGrid.tsx').includes("it.share && showProfileShare(m.paid) && <ProfileShareButtons"))
})

test('one status line: no separate "Next:" or Documents row on a pipeline card; Not interested in the ⋯ menu', () => {
  const grid = read('components/admin/OverviewCardGrid.tsx')
  assert.ok(grid.includes('{m.stoppedAt && !it.pipe && ('))
  assert.ok(grid.includes('{it.docs && !it.pipe && <DocsRow'))
  assert.ok(grid.includes('<PipelineMoreMenu memberId={it.memberId} pipe={it.pipe.card} />'))
  const pa = read('components/admin/PipelineActions.tsx')
  const body = pa.slice(0, pa.indexOf('export function PipelineMoreMenu'))
  assert.ok(!body.includes('<NotInterestedButton'), 'Not interested is not in the card body')
  assert.ok(!/Missing: \{/.test(body), 'no separate Missing line')
  assert.ok(body.includes('{pipeStatusLine(pipe)}'))
})

// --------------------------------------------------------- 3. default view ---

test('staff default view, and a URL filter overriding it', () => {
  assert.equal(tutorStageFromAddress({ tab: 'tutors' }), 'approved')
  assert.equal(tutorStageFromAddress({ tab: 'tutors', n: '50' }), 'approved')
  assert.equal(tutorStageFromAddress({ tab: 'tutors', stage: 'all' }), 'all')
  assert.equal(tutorStageFromAddress({ tab: 'tutors', stage: 'missing' }), 'missing')
  assert.equal(tutorStageFromAddress({ tab: 'tutors', q: 'sana' }), 'all')
  assert.equal(tutorStageFromAddress({ tab: 'tutors', ni: '1' }), 'all')
  assert.equal(tutorStageFromAddress({ tab: 'tutors', signed: 'today' }), 'all')
  // "All" is written into the address, so it stays one click away.
  const rows = [{ param: 'stage', keepFirst: true, options: [{ key: 'all' }, ...PIPE_STAGES.map((k) => ({ key: k }))] }]
  const href = gridHref('/admin/users', { keep: { tab: 'tutors' }, q: '', sel: { stage: 'approved' }, docFilter: null }, rows, { stage: 'all' })
  assert.match(href, /stage=all/)
  assert.equal(tutorStageFromAddress(Object.fromEntries(new URL(href, 'https://x').searchParams)), 'all')
  assert.equal(stageHref('all'), '/admin/users?tab=tutors&stage=all')
  assert.ok(read('app/admin/users/PeopleTabs.tsx').includes('tutorStageFromAddress(sp)'))
})

// ------------------------------------------------------- 5. no mobile ---

test('no-mobile tutors sort last in their stage and are never in the badge', () => {
  const rows = [
    { id: 'a', stage: 'approved' as const, section: 'not' as const, paused: false, noMobile: true, lastActiveAt: iso(T0 + DAY) },
    { id: 'b', stage: 'approved' as const, section: 'done' as const, paused: true, noMobile: false, lastActiveAt: iso(T0) },
    { id: 'c', stage: 'approved' as const, section: 'not' as const, paused: false, noMobile: false, lastActiveAt: iso(T0) },
    { id: 'd', stage: 'missing' as const, section: 'not' as const, paused: false, noMobile: true, lastActiveAt: iso(T0) },
    { id: 'e', stage: 'missing' as const, section: 'not' as const, paused: false, noMobile: false, lastActiveAt: iso(T0 - DAY) },
  ]
  assert.deepEqual(pipelineOrder(rows).map((r) => r.id), ['e', 'd', 'c', 'b', 'a'])
  const nm = card({ mobileOk: false })
  assert.equal(nm.noMobile, true)
  assert.equal(pipeSortAt(nm), null)
  assert.equal(feePendingDue(nm), false)
  assert.equal(feePendingDue(card({})), true)
  assert.equal(NO_MOBILE_LINE, "No mobile number — can't follow up")
})

// ------------------------------------------------------- 6. blank photos ---

async function greyOf(img: Buffer): Promise<Uint8Array> {
  return new Uint8Array(await sharp(img).resize(BLANK_SIZE, BLANK_SIZE, { fit: 'fill' }).grayscale().raw().toBuffer())
}

test('blank-photo detection: a black image is blank, a normal photo is not', async () => {
  const black = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 3, g: 3, b: 5 } } }).jpeg().toBuffer()
  const white = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 250, g: 250, b: 250 } } }).png().toBuffer()
  // A stand-in "photo": a face-like disc and shading on a mid-tone background (invented).
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d8fb0"/><stop offset="1" stop-color="#2a3a4a"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="200" cy="170" r="90" fill="#d9b28c"/><rect x="110" y="270" width="180" height="130" fill="#334455"/><circle cx="170" cy="160" r="10" fill="#222"/><circle cx="230" cy="160" r="10" fill="#222"/></svg>`,
  )
  const photo = await sharp(svg).jpeg().toBuffer()
  assert.equal(looksBlank(greyStats(await greyOf(black))), true)
  assert.equal(looksBlank(greyStats(await greyOf(white))), true)
  assert.equal(looksBlank(greyStats(await greyOf(photo))), false)
})

test('a blank flag never rejects automatically; the one-tap reject uses the existing reasons', () => {
  const lib = read('lib/photoBlank.ts')
  // The only table it writes is photo_blank_checks.
  const writes = [...lib.matchAll(/\.from\('([a-z_]+)'\)\s*\.(?:upsert|insert|update|delete)\(/g)].map((m) => m[1])
  assert.deepEqual([...new Set(writes)], ['photo_blank_checks'])
  assert.ok(!/document-review|status: 'rejected'|_status: 'rejected'/.test(lib))
  for (const route of ['app/api/documents/upload/route.ts', 'app/api/profile/photo/route.ts', 'app/api/admin/tutors/media/route.ts']) {
    assert.ok(/checkPhoto(sAfterUpload|Url)\(/.test(read(route)), route)
  }
  // The reasons are the existing quick reasons, not new text.
  const texts = REJECT_REASONS.map((r) => r.text)
  assert.ok(texts.includes(blankRejectReason('photo')))
  assert.ok(texts.includes(blankRejectReason('selfie')))
  // The flag follows the current file only.
  const b = { photo: new Set(['p-old']), selfie: new Set(['s-1']) }
  assert.deepEqual(currentBlankItems({ photoRefs: ['p-new'], selfieRefs: ['s-1'] }, b), ['selfie'])
  assert.deepEqual(currentBlankItems({ photoRefs: ['p-old', null], selfieRefs: [] }, b), ['photo'])
  assert.equal(blankLine({ blank: ['photo', 'selfie'] }), 'Photo looks blank: Profile photo, Selfie')
  assert.equal(blankLine({ blank: [] }), null)
  // The Overview row is there, hidden at 0 like every to-do row.
  assert.ok((OVERVIEW_ITEM_KEYS as readonly string[]).includes('todo-blank-photos'))
  assert.equal(OVERVIEW_ITEMS['todo-blank-photos'].title, 'Blank photos to check')
  assert.ok(read('app/admin/page.tsx').includes(".filter((r) => r.count > 0)"))
})

// ---------------------------------------------------------- 1. badges ---

test('badge counts: only act-now numbers, 99+ above 99', () => {
  const b: BadgesPayload = {
    reports: 1,
    receipts: 2,
    peopleWaiting: 4,
    pipelineDue: 3,
    parentOverdue: 50,
    appsOverdue: { total: 70, byOwner: { s1: 40 } },
    appsNew: { total: 9, byOwner: { s1: 5 } },
    paidRed: { total: 30, byOwner: { s1: 12 } },
  }
  const owner = navBadgesFrom(b, { id: 'o', adminRole: 'owner' }, { followUps: true, paidTutors: true, parentFollowUps: true, users: true })
  assert.equal(owner['/admin/users'], 7) // waiting + fee pending not followed up; no parent follow-ups
  assert.equal(owner['/admin/applications'], 9) // new and unseen only
  assert.equal(owner['/admin/paid-tutors'], undefined) // no badge
  const staff = navBadgesFrom(b, { id: 's1', adminRole: 'operations' }, { followUps: false, users: true })
  assert.equal(staff['/admin/users'], 4)
  assert.equal(staff['/admin/applications'], 5)
  // A stored payload from before this change has no appsNew: no badge, never the overdue figure.
  const { appsNew: _drop, ...old } = b
  void _drop
  assert.equal(navBadgesFrom(old as BadgesPayload, { id: 'o', adminRole: 'owner' }, { followUps: true })['/admin/applications'], 0)
  assert.equal(badgeText(0), null)
  assert.equal(badgeText(7), '7')
  assert.equal(badgeText(99), '99')
  assert.equal(badgeText(100), '99+')
  assert.ok(read('components/admin/AdminShell.tsx').includes('{badgeText(count)}'))
  // The People badge's follow-up part is Approved fee pending only.
  assert.equal(feePendingDue(card({ cnic: 'none' })), false)
  assert.equal(feePendingDue(card({ ni: true })), false)
})

test('a new, unseen application: Applied, nobody has worked it, not Older', () => {
  const base = { id: 'a1', stage: 'applied' as const, stageChangedAt: iso(T0 - DAY), ownerId: 's1', createdAt: iso(T0 - DAY), jobCreatedAt: iso(T0 - 2 * DAY) }
  assert.equal(isNewUnseenApplication(base, [], T0), true)
  assert.equal(isNewUnseenApplication({ ...base, workedAt: iso(T0) }, [], T0), false)
  assert.equal(isNewUnseenApplication({ ...base, stage: 'forwarded' }, [], T0), false)
  assert.equal(isNewUnseenApplication({ ...base, unavailable: true }, [], T0), false)
  assert.equal(isNewUnseenApplication({ ...base, jobCreatedAt: iso(T0 - 40 * DAY) }, [], T0), false)
  const fu: FollowUpRecord = { id: 'f', applicationId: 'a1', stage: 'applied', kind: 'follow_up', recipient: 'parent', messageKey: 'share_profile', staffName: 'Staff', at: iso(T0) } as FollowUpRecord
  assert.equal(isNewUnseenApplication(base, [fu], T0), false)
})
