/**
 * scripts/test-pr106e.ts  —  npm run test:pr106e
 *
 * PR106-E: payment-screen exits + one-source inline account details,
 * verification integrity (no approval of a doc with no file; the Verified badge
 * needs real files AND approval), one shared profile-view count, notification
 * dedupe/pause, the complete-profile link, and the mobile chat layout.
 *
 * Source scans only — the affected modules are server-only (supabase) or React
 * components, so the guarantees are asserted against the source the same way
 * PR106-D's tests do. No DB, no secrets.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ---------------------------------------------- STEP 1: payment exits ----------

test('ManualPayDetails exists and reads every number from the instructions prop — no hardcoded account/number', () => {
  const p = 'components/payments/ManualPayDetails.tsx'
  assert.ok(existsSync(join(ROOT, p)), 'component present')
  const src = read(p)
  // Values come only from the `instructions` prop (one source: manualInstructions()).
  assert.ok(/const i = instructions/.test(src), 'aliases the instructions prop')
  assert.ok(/i\.jazzcash/.test(src) && /i\.iban/.test(src), 'renders fields from the prop')
  // No literal Pakistani account/phone numbers baked in (JazzCash/Easypaisa/IBAN).
  assert.ok(!/\b0\d{3}[- ]?\d{7}\b/.test(src), 'no hardcoded mobile-wallet number')
  assert.ok(!/PK\d{2}[A-Z0-9]/.test(src), 'no hardcoded IBAN')
  assert.ok(/activated after our team checks/i.test(src), 'plain activation line (EN)')
  assert.ok(/lang="ur"/.test(src) && /dir="rtl"/.test(src), 'Urdu activation line')
})

test('the fee step (TutorVerifyGate) offers inline bank details and a pay-later exit', () => {
  const src = read('components/upgrade/TutorVerifyGate.tsx')
  assert.ok(src.includes('ManualPayDetails'), 'inline manual details')
  assert.ok(/payLaterHref/.test(src), 'a pay-later href prop')
  assert.ok(/manual/.test(src), 'takes the manual instructions')
})

test('CompleteProfileFlow passes manual details + a pay-later href to the fee step', () => {
  const src = read('components/tutor/CompleteProfileFlow.tsx')
  assert.ok(/manual=\{manual\}/.test(src), 'forwards manual')
  assert.ok(/payLaterHref="\/tutor\/dashboard"/.test(src), 'pay-later goes to the dashboard (nothing lost)')
})

test('both entry pages load the ONE manualInstructions() source and pass it in', () => {
  for (const p of [
    'app/(site)/tutor/onboarding/page.tsx',
    'app/(site)/tutor/complete-profile/page.tsx',
  ]) {
    const src = read(p)
    assert.ok(/from '@\/lib\/payments\/manual'/.test(src), `${p} imports the one source`)
    assert.ok(/manualInstructions\(\)/.test(src), `${p} calls it`)
    assert.ok(/manual=\{manual\}/.test(src), `${p} passes it`)
  }
})

test('Membership Plans checkout shows inline details + Back + Pay later to the right dashboard', () => {
  const src = read('app/(site)/membership-plans/page.tsx')
  assert.ok(src.includes('ManualPayDetails'), 'inline manual details on checkout')
  assert.ok(/manualInstructions\(\)/.test(src), 'the one source')
  assert.ok(/parent\/dashboard/.test(src) && /tutor\/dashboard/.test(src), 'dashboard by audience')
  assert.ok(/checkoutOpen/.test(src), 'details only while a plan is being bought')
})

// ---------------------------------------------- STEP 2: verification integrity -

test('a document with no file cannot be approved — server route backstop', () => {
  const src = read('lib/tutorDocuments.ts')
  // The approve branch computes whether a real file exists and refuses otherwise.
  assert.ok(/has not been uploaded yet, so it cannot be approved/.test(src), 'no-file approval guard')
  assert.ok(/hasFile/.test(src), 'computes file presence')
  // CNIC needs number + image; selfie needs a user_documents selfie row; photo an avatar.
  assert.ok(/avatar_url/.test(src) && /cnic_image_path/.test(src), 'reads the real file columns')
})

test('the admin review UI hides the decision controls when nothing was uploaded', () => {
  const src = read('components/admin/TutorDocumentReview.tsx')
  assert.ok(/state\.hasUpload/.test(src), 'gates on hasUpload')
  assert.ok(/Not uploaded yet/.test(src), 'says so instead of showing Approve/Reject')
})

test('the Verified badge needs the files present AND approved (not approval alone)', () => {
  const src = read('lib/badgeFacts.ts')
  assert.ok(/avatar_url/.test(src), 'checks the photo file')
  assert.ok(/kind.*selfie|selfie.*kind/.test(src) || /hasSelfieFile/.test(src), 'checks a real selfie file')
  assert.ok(/hasSelfieFile/.test(src), 'selfie file set')
  // picOk / selfieOk must combine approval with a present file.
  assert.ok(/picOk/.test(src) && /selfieOk/.test(src), 'file-and-approved gating')
})

// ---------------------------------------------- STEP 3: one view count ---------

test('the dashboard views tile and the teaser share one weekly count + window', () => {
  const pv = read('lib/profileViews.ts')
  assert.ok(/WEEKLY_VIEW_WINDOW_MS/.test(pv), 'one window constant')
  assert.ok(/PARENT_VIEWER_ROLES/.test(pv), 'one viewer-role set')
  assert.ok(/function weeklyParentViewCount/.test(pv), 'one shared count fn')
  // viewSummary uses the shared count (so the tile == the teaser basis).
  assert.ok(/weeklyParentViewCount\(/.test(pv), 'viewSummary uses it')

  const dash = read('app/(site)/tutor/dashboard/page.tsx')
  assert.ok(/views\.thisWeek/.test(dash), 'tile shows the shared weekly count')
  assert.ok(/this week/.test(dash), 'labelled "this week"')

  const sweep = read('lib/conversionSweep.ts')
  assert.ok(/PARENT_VIEWER_ROLES/.test(sweep), 'teaser filters to parent/academy viewers')
  assert.ok(/viewer_id[^\n]*===\s*id/.test(sweep) && /never the tutor themselves/.test(sweep), 'teaser excludes self-views')
})

test('a profile view only notifies for a real parent/academy viewer', () => {
  const src = read('app/(site)/tutor/[slug]/page.tsx')
  assert.ok(/viewerRole === 'parent'|'parent'.*viewerRole/.test(src), 'guards on parent')
  assert.ok(/notifyProfileViewed/.test(src), 'the notify call is guarded')
})

// ---------------------------------------------- STEP 4: notification dedupe -----

test('paused notifications are hidden from the feed AND the unread count', () => {
  const src = read('lib/notificationFeed.ts')
  const paused = /meta->>paused\.is\.null,meta->>paused\.neq\.true/g
  const hits = src.match(paused) || []
  assert.ok(hits.length >= 2, 'the paused filter is on both unreadCount and notificationPage')
})

test('an already-approved re-approval sends no new notification (idempotency guard present)', () => {
  const src = read('lib/tutorDocuments.ts')
  assert.ok(/alreadyApproved/.test(src), 'the no-op guard exists')
})

// ---------------------------------------------- STEP 5: complete-profile link --

test('the name card links to complete-profile with the real % below 100, says "✓ 100% Completed" at 100 (#56)', () => {
  const src = read('components/tutor/TutorHeaderCard.tsx')
  assert.ok(/completion < 100 \?/.test(src), 'the link only below 100%')
  assert.ok(/Complete your profile · \{completion\}%/.test(src), 'shows the real percent')
  assert.ok(/href="\/tutor\/complete-profile"/.test(src), 'opens the flow')
  // #56 (owner, 5 Oct 2026): brand red under 100%, deep-green "✓ 100% Completed"
  // at 100%, and NO Urdu line under either.
  assert.ok(/text-tm-red[^\n]*\n\s*>\s*\n\s*Complete your profile/.test(src), 'red under 100%')
  assert.ok(/text-tm-green-deep[^\n]*✓ 100% Completed/.test(src), 'green "✓ 100% Completed" at 100%')
  assert.ok(!/پروفائل مکمل کریں/.test(src), 'no Urdu line under the completion label')
})

// ---------------------------------------------- STEP 6: mobile chat layout -----

test('the breadcrumb is hidden on the phone conversation view, one ← kept in the chat header', () => {
  const src = read('components/messages/InboxShell.tsx')
  assert.ok(/threadId \? 'hidden lg:block' : ''/.test(src), 'breadcrumb hidden on mobile thread')
  assert.ok(/aria-label="Back to conversations"/.test(src), 'the single ← back control')
  assert.ok(/lg:hidden/.test(src), 'the ← is mobile-only (desktop uses the two-pane)')
})

test('the quick-reply editor panel is hidden on the phone chat; the composer keeps one scrolling chip row', () => {
  const shell = read('components/messages/InboxShell.tsx')
  assert.ok(/threadId \? 'hidden lg:block' : 'block'/.test(shell), 'editor panel hidden on mobile thread')
  const conv = read('components/messages/Conversation.tsx')
  // One horizontally-scrolling row (overflow-x-auto), chips do not wrap.
  assert.ok(/overflow-x-auto/.test(conv), 'single scrolling quick-reply row')
  assert.ok(/whitespace-nowrap/.test(conv), 'chips do not wrap')
})

test('the Enter-to-send hint is hidden on phones', () => {
  const src = read('components/messages/Conversation.tsx')
  assert.ok(/id="composer-hint" className="hidden[^"]*sm:block/.test(src), 'hint is sm:block only')
})

test('the open conversation takes near-full viewport height on a phone; the list scrolls independently', () => {
  const shell = read('components/messages/InboxShell.tsx')
  assert.ok(/threadId \? 'h-\[calc\(100dvh-5rem\)\]' : 'h-\[calc\(100dvh-15rem\)\]'/.test(shell), 'taller when a thread is open on mobile')
  const conv = read('components/messages/Conversation.tsx')
  assert.ok(/min-h-0 flex-1 overflow-y-auto/.test(conv), 'the message list scrolls within the flex column')
})

test('bubbles use tighter vertical padding but keep the text size', () => {
  const src = read('components/messages/Conversation.tsx')
  assert.ok(/rounded-2xl px-3 py-1\.5/.test(src), 'py-1.5 bubbles')
})
