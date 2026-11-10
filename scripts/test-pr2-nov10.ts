/**
 * scripts/test-pr2-nov10.ts  —  npm run test:pr2nov10
 *
 * Owner, 10 Nov 2026 (PR 2 of 2): the browser brightness check, "Looks fine"
 * on blank-photo flags, the Applications "unseen and recent" badge, the Plan
 * filter on People → Paid and "Upgrades ending in 7 days", no upgrade
 * invitations while upgrades are "Coming soon", and one Paid number on the
 * Overview card and the paid sign-ups view. Invented data only — no database,
 * no real names, numbers or photos.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

import {
  BLANK_SIZE,
  PHOTO_TOO_DARK,
  flaggedRefs,
  greyStats,
  looksBlank,
  needsCheck,
  pixelsLookBlank,
  type BlankCheckRow,
} from '../lib/photoBlankCore'
import { NEW_APPLICATION_DAYS, applicationOpened, isNewUnseenApplication, type FollowUpRecord } from '../lib/applicationFollowUpCore'
import type { BoardItem } from '../lib/applicationStageCore'
import { PLAN_FILTER, pickUpgrade, planCounts, planEndsLine, planTag, upgradeEndingSoon } from '../lib/upgradePlanCore'
import { PROMOTE_UPGRADES, UPGRADES_PAUSED, inviteAllowed, pitchesUpgrade, showUpgradePrompts } from '../lib/upgradesPausedCore'
import { countIn, paidCardCounts, periodCounts, pkDayStart, type PaidSignup } from '../lib/paidSignupsCore'
import { trendWindows } from '../lib/overviewTrendCore'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const DAY = 86_400_000

// ------------------------------------------------------- 1. brightness check --

/** The server's path (lib/photoBlank imageBlankStats): sharp, BLANK_SIZE square, greyscale. */
async function serverBlank(img: Buffer): Promise<boolean> {
  const grey = await sharp(img).resize(BLANK_SIZE, BLANK_SIZE, { fit: 'fill' }).grayscale().raw().toBuffer()
  return looksBlank(greyStats(new Uint8Array(grey)))
}
/** The browser's path (lib/photoBrightness): the same square, RGBA pixels. */
async function browserBlank(img: Buffer): Promise<boolean> {
  const rgba = await sharp(img).resize(BLANK_SIZE, BLANK_SIZE, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
  return pixelsLookBlank(new Uint8Array(rgba))
}
/** An invented "face" picture: a light background with a darker oval and detail. */
async function facePhoto(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
    <rect width="400" height="400" fill="#c9b49a"/>
    <ellipse cx="200" cy="180" rx="110" ry="140" fill="#8a5a3c"/>
    <circle cx="160" cy="160" r="14" fill="#1a1a1a"/><circle cx="240" cy="160" r="14" fill="#1a1a1a"/>
    <rect x="150" y="250" width="100" height="16" fill="#5a2a1a"/>
    <rect y="330" width="400" height="70" fill="#2e4a7a"/></svg>`
  return sharp(Buffer.from(svg)).jpeg().toBuffer()
}
async function darkPhoto(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 6, g: 5, b: 8 } } }).jpeg().toBuffer()
}

test('a dark frame is blocked, a normal photo passes — browser and server agree', async () => {
  const dark = await darkPhoto()
  const face = await facePhoto()
  assert.equal(await browserBlank(dark), true)
  assert.equal(await serverBlank(dark), true)
  assert.equal(await browserBlank(face), false)
  assert.equal(await serverBlank(face), false)
})

test('the browser check uses the server constants and blocks submit with the message', () => {
  assert.equal(PHOTO_TOO_DARK, 'Photo is too dark. Please retake it in good light.')
  const helper = read('lib/photoBrightness.ts')
  assert.match(helper, /BLANK_SIZE, pixelsLookBlank } from '@\/lib\/photoBlankCore'/)
  const selfie = read('components/tutor/LiveSelfieCapture.tsx')
  assert.match(selfie, /blobLooksBlank\(f\)\) \{ setError\(PHOTO_TOO_DARK\); return \}/)
  assert.match(selfie, /disabled=\{!ready\}/, 'Take photo waits for real frames')
  assert.match(selfie, /CAMERA_WARMUP_MS/)
  assert.match(selfie, /if \(sourceLooksBlank\(c\)\) \{ setDark\(true\); return \}/)
  const crop = read('components/photo/usePhotoCropUpload.tsx')
  assert.match(crop, /disabled=\{busy \|\| dark\}/, '"Use photo" stays off for a dark photo')
  assert.match(crop, /if \(!open \|\| busy \|\| dark\) return/)
})

// ------------------------------------------------------------ 2. Looks fine --

test('"Looks fine" clears the flag, Undo restores it, the same file is not re-flagged', () => {
  const rows: BlankCheckRow[] = [
    { item: 'selfie', ref: 'doc-a', blank: true, cleared_at: null },
    { item: 'photo', ref: 'https://x/a.jpg', blank: true, cleared_at: null },
    { item: 'photo', ref: 'https://x/b.jpg', blank: false, cleared_at: null },
  ]
  assert.deepEqual([...flaggedRefs(rows).selfie], ['doc-a'])
  // Looks fine on the selfie
  const cleared = rows.map((r) => (r.ref === 'doc-a' ? { ...r, cleared_at: '2026-11-10T09:00:00Z' } : r))
  assert.equal(flaggedRefs(cleared).selfie.size, 0)
  assert.deepEqual([...flaggedRefs(cleared).photo], ['https://x/a.jpg'])
  // Undo
  const undone = cleared.map((r) => ({ ...r, cleared_at: null }))
  assert.deepEqual([...flaggedRefs(undone).selfie], ['doc-a'])
  // A checked file (cleared or not) is never checked again
  const done = new Set(rows.map((r) => `${r.item}:${r.ref}`))
  assert.equal(needsCheck(done, 'selfie', 'doc-a'), false)
  assert.equal(needsCheck(done, 'selfie', 'doc-new'), true)
  // The store keeps one row per file and never rewrites it
  const io = read('lib/photoBlank.ts')
  assert.match(io, /onConflict: 'item,ref', ignoreDuplicates: true/)
  assert.match(io, /\.is\('cleared_at', null\)/)
  assert.match(io, /\.eq\('cleared_by', actorId\)/, 'Undo only by the staff member who cleared it')
  const route = read('app/api/admin/photos/looks-fine/route.ts')
  assert.match(route, /photo\.blank_cleared/)
  assert.match(route, /photo\.blank_clear_undo/)
})

// ------------------------------------------------------- 3. Applications badge --

const NOW = Date.parse('2026-11-10T07:00:00Z')
const item = (over: Partial<BoardItem>): BoardItem => ({
  id: 'a1',
  stage: 'applied',
  stageChangedAt: null,
  ownerId: 'o1',
  createdAt: new Date(NOW - 2 * DAY).toISOString(),
  ...over,
})

test('the Applications badge counts only unseen applications from the last 7 days', () => {
  assert.equal(NEW_APPLICATION_DAYS, 7)
  assert.equal(isNewUnseenApplication(item({}), [], NOW), true)
  assert.equal(isNewUnseenApplication(item({ seenAt: new Date(NOW - DAY).toISOString() }), [], NOW), false, 'opened by staff')
  assert.equal(isNewUnseenApplication(item({ createdAt: new Date(NOW - 8 * DAY).toISOString() }), [], NOW), false, 'older than 7 days')
  assert.equal(isNewUnseenApplication(item({ createdAt: new Date(NOW - 7 * DAY + 60_000).toISOString() }), [], NOW), true)
  assert.equal(isNewUnseenApplication(item({ workedAt: new Date(NOW).toISOString() }), [], NOW), false)
  assert.equal(isNewUnseenApplication(item({ unavailable: true }), [], NOW), false)
  assert.equal(isNewUnseenApplication(item({ stage: 'forwarded' }), [], NOW), false)
  const fu = [{ kind: 'follow_up' }] as unknown as FollowUpRecord[]
  assert.equal(isNewUnseenApplication(item({}), fu, NOW), false)
  assert.equal(applicationOpened(item({ seenAt: '2026-11-09T00:00:00Z' }), []), true)
  assert.equal(applicationOpened(item({}), []), false)
  // Opened rows are dimmed, and opening is recorded
  const client = read('app/admin/applications/ApplicationsClient.tsx')
  assert.match(client, /isOpened\(r\) \? 'opacity-75' : ''/)
  assert.match(client, /\/api\/admin\/applications\/seen/)
})

// --------------------------------------------------------------- 4. Plan filter --

test('the Plan filter counts and the 7-day ending window', () => {
  assert.deepEqual(PLAN_FILTER.map((p) => p.label), ['All paid', 'Verified', 'Premium', 'Featured'])
  const inDays = (d: number) => new Date(NOW + d * DAY).toISOString()
  const premium = pickUpgrade([{ plan_code: 'premium', status: 'active', expires_at: inDays(3) }], NOW)
  const featured = pickUpgrade(
    [
      { plan_code: 'premium', status: 'active', expires_at: inDays(20) },
      { plan_code: 'featured', status: 'active', expires_at: inDays(10) },
    ],
    NOW,
  )
  assert.equal(premium?.code, 'premium')
  assert.equal(featured?.code, 'featured', 'Featured wins over Premium')
  assert.equal(pickUpgrade([{ plan_code: 'premium', status: 'active', expires_at: inDays(-1) }], NOW), null, 'ended')
  assert.equal(pickUpgrade([{ plan_code: 'premium', status: 'cancelled', expires_at: inDays(5) }], NOW), null)
  assert.equal(pickUpgrade([{ plan_code: 'verified', status: 'active', expires_at: inDays(5) }], NOW), null)

  const tags = [
    planTag('paid', null),
    planTag('paid', null),
    planTag('paid', premium),
    planTag('paid', featured),
    planTag('approved', premium), // not paid → not in the Paid row
  ]
  assert.deepEqual(planCounts(tags), { all: 4, verified: 2, premium: 1, featured: 1 })

  assert.equal(upgradeEndingSoon(premium, NOW), true, '3 days')
  assert.equal(upgradeEndingSoon(featured, NOW), false, '10 days')
  assert.equal(upgradeEndingSoon({ code: 'premium', endsAt: inDays(7) }, NOW), true, 'exactly 7 days')
  assert.equal(upgradeEndingSoon({ code: 'premium', endsAt: inDays(7.01) }, NOW), false)
  assert.equal(upgradeEndingSoon(null, NOW), false)
  assert.equal(planEndsLine({ code: 'premium', endsAt: '2026-12-08T10:00:00Z' }), 'Premium · ends 8 Dec')
  assert.equal(planEndsLine(null), null)
})

// ------------------------------------------------------------ 5. promotion off --

test('no upgrade invitation goes out while the setting is off', () => {
  assert.equal(UPGRADES_PAUSED, true)
  assert.equal(PROMOTE_UPGRADES, false, 'one setting, following the pause')
  assert.equal(showUpgradePrompts(), false)
  assert.equal(inviteAllowed('viewer_weekly_teaser'), false)
  assert.equal(inviteAllowed('quota_nudge'), false)
  assert.equal(inviteAllowed('viewer_weekly_teaser', true), true, 'switched back on')
  assert.equal(inviteAllowed('job_matched'), true, 'other notifications are untouched')
  assert.equal(pitchesUpgrade('premium'), true)
  assert.equal(pitchesUpgrade('parent_featured'), true)
  assert.equal(pitchesUpgrade('verified'), false)
  assert.equal(pitchesUpgrade('parent_verified'), false)
  // The send paths read the one setting.
  assert.match(read('lib/notifications.ts'), /if \(!inviteAllowed\(params\.kind\)\) return/)
  assert.match(read('lib/conversionSweep.ts'), /if \(!showUpgradePrompts\(\)\) return \{ teasersSent: 0, quotaNudgesSent: 0/)
  assert.match(read('lib/payments/expiry.ts'), /!showUpgradePrompts\(\) \? \[\]/)
  assert.match(read('lib/ads.ts'), /promote \|\| !pitchesUpgrade\(ad\.plan\)/)
  for (const f of [
    'components/dashboard/ViewsCard.tsx',
    'components/messages/InboxShell.tsx',
    'components/messages/Conversation.tsx',
    'components/ApplyReasonLine.tsx',
    'components/viewer/TutorViewer.tsx',
    'app/(site)/tutor/dashboard/page.tsx',
    'app/(site)/parent/dashboard/post-job/page.tsx',
    'lib/needsYou.ts',
    'lib/notificationActions.ts',
    'lib/incomingRequests.ts',
  ])
    assert.match(read(f), /showUpgradePrompts\(\)/, f)
  // Templates are kept: the weekly teaser text is still in the code.
  assert.match(read('lib/conversionSweep.ts'), /viewer_weekly_teaser/)
})

// --------------------------------------------------------- 6. one Paid number --

test('the Overview Paid card equals the Paid view for the same periods', () => {
  // Invented paid sign-ups across the last 40 days, each tutor once.
  const rows: PaidSignup[] = []
  for (let i = 0; i < 60; i++) rows.push({ at: new Date(NOW - (i * 17 + 3) * 3_600_000).toISOString(), by: i % 3 ? 'self' : 's1' })
  const card = paidCardCounts(rows, NOW)
  const view = new Map(periodCounts(rows, NOW).map((p) => [p.key, p.count]))
  assert.equal(card.today, view.get('today'))
  assert.equal(card.yesterday, view.get('yesterday'))
  assert.equal(card.month, view.get('this_month'))
  // The last 7 days are the Overview cards' own window (00:00 PKT six days ago → now).
  const w = trendWindows(NOW)
  assert.equal(w.last7.start, pkDayStart(NOW) - 6 * DAY)
  assert.equal(card.last7, countIn(rows, w.last7))
  // The card reads the view's rows, not its own payment rule.
  const ov = read('lib/overviewItems.ts')
  assert.match(ov, /const pf = paidCardCounts\(members, nowMs\)/)
  assert.match(read('lib/paidSignups.ts'), /loadPaidSignupMembers\(\)/)
})
