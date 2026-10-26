/**
 * scripts/test-follow-ups-reasons.ts — npm run test:followupreasons
 *
 * Follow-ups shows every unfinished sign-up with a clear reason (owner,
 * 21 Oct 2026): old sign-ups appear, rejected-document tutors appear with the
 * reason, "Not interested" hides and undo brings back, the reason order, the
 * Waiting on the tutor / Waiting on us split with no WhatsApp on Waiting on us,
 * and every pre-filled WhatsApp message carrying ONE full https://www link on
 * its own line. Pure rules + source scans; no DB, no network, no phone number.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { tutorInScope } from '../lib/staffOutreachCore'
import {
  chipsFor,
  FOLLOW_CHIP_LABEL,
  FOLLOW_CHIPS,
  followReason,
  followUpMessage,
  primaryChip,
  reasonKind,
  showWhatsApp,
  tutorDone,
  waitChip,
  type TutorFollowFacts,
} from '../lib/tutorFollowUpCore'
import { adminMemberMessage, adminWaLink } from '../lib/adminWhatsAppCore'
import { DOCUMENTS_APPROVED_FALLBACK, fillDocumentsApproved, waMeHref } from '../lib/documentsApprovedCore'
import { fillPaymentNotFinished, PAYMENT_NOT_FINISHED_FALLBACK } from '../lib/startedPaymentCore'
import { followUpText, followUpWaLink } from '../lib/followUpCore'
import { finishWaText, fullSiteLinks, linkOnOwnLine, siteLinksIn } from '../lib/waLinkCore'
import { onParentsTab } from '../lib/followUpsPageCore'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-21T10:00:00Z')
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

const base: TutorFollowFacts = {
  feePaid: false,
  completion: 40,
  stoppedStep: 'subjects',
  docsApproved: false,
  rejected: [],
  startedPayment: null,
  lastContactAt: null,
  docsWaiting: false,
  waitingSince: null,
  joinedAt: ago(2),
  lastSeenAt: ago(1),
}

// ------------------------------------------------------------ Part A

test('old sign-ups (over 30 days) appear in "Older than 30 days" — paid or not', () => {
  const old = { joinedAt: ago(90), feeStamped: false }
  assert.equal(tutorInScope(old, 'older', NOW), true)
  assert.equal(tutorInScope(old, 'recent', NOW), false)
  // A paid tutor who has not finished is no longer left out by the fee.
  assert.equal(tutorInScope({ joinedAt: ago(90), feeStamped: true }, 'older', NOW), true)
  assert.equal(tutorInScope({ joinedAt: ago(5), feeStamped: true }, 'recent', NOW), true)
  assert.equal(tutorInScope({ joinedAt: ago(90), feeStamped: true }, 'paid_unfinished', NOW), true)
})

test('rejected-document tutors appear, with the reason, even when they paid', () => {
  const f: TutorFollowFacts = {
    ...base,
    feePaid: true,
    stoppedStep: null,
    rejected: [{ doc: 'selfie', reason: 'Face not clear.' }],
  }
  assert.equal(tutorDone(f), false)
  assert.equal(followReason(f, NOW).text, 'Documents rejected — Selfie: Face not clear')
  const two = followReason({ ...f, rejected: [{ doc: 'cnic', reason: 'blurry' }, { doc: 'photo', reason: null }] }, NOW).text
  assert.equal(two, 'Documents rejected — CNIC: blurry; Profile photo')
})

test('a member leaves only when done (fee paid + CNIC, photo, selfie approved + steps done)', () => {
  const done = { feePaid: true, docsApproved: true, rejected: [], stoppedStep: null }
  assert.equal(tutorDone(done), true)
  assert.equal(tutorDone({ ...done, feePaid: false }), false)
  assert.equal(tutorDone({ ...done, docsApproved: false }), false)
  assert.equal(tutorDone({ ...done, stoppedStep: 'tagline' }), false)
})

test('"Not interested" hides the member from every group; undo brings them back', () => {
  const t = { joinedAt: ago(3), feeStamped: false }
  assert.equal(tutorInScope({ ...t, notInterested: true }, 'recent', NOW), false)
  assert.equal(tutorInScope({ ...t, notInterested: true }, 'older', NOW), false)
  assert.equal(tutorInScope({ ...t, notInterested: true }, 'paid_unfinished', NOW), false)
  assert.equal(tutorInScope({ ...t, notInterested: true, startedPayment: true }, 'recent', NOW), false)
  assert.equal(tutorInScope({ ...t, notInterested: true }, 'not_interested', NOW), true)
  // Undo = the live mark is gone.
  assert.equal(tutorInScope({ ...t, notInterested: false }, 'recent', NOW), true)
  assert.equal(tutorInScope({ ...t, notInterested: false }, 'not_interested', NOW), false)
})

test('"Not interested" is server-side, audited, undone by stamping (never deleted)', () => {
  const lib = readFileSync('lib/followUpDismissals.ts', 'utf8')
  assert.match(lib, /member\.not_interested'/)
  assert.match(lib, /member\.not_interested_undo'/)
  assert.match(lib, /undone_at: new Date\(\)/)
  assert.doesNotMatch(lib, /\.delete\(/)
  const route = readFileSync('app/api/admin/follow-ups/not-interested/route.ts', 'utf8')
  assert.match(route, /checkAdminRole\(/)
  assert.match(route, /roleMayWrite\(/)
  const sql = readFileSync('supabase/migrations/191_follow_up_not_interested.sql', 'utf8')
  assert.match(sql, /where undone_at is null/)
  assert.match(sql, /for select using \(public\.is_admin\(\)\)/)
})

test('every unfinished tutor is on the Tutors tab, never also on Parents', () => {
  assert.equal(onParentsTab({ stage: 'email_unconfirmed', role: 'tutor' }), false)
  assert.equal(onParentsTab({ stage: 'profile_unfinished', role: 'tutor' }), false)
  assert.equal(onParentsTab({ stage: 'email_unconfirmed', role: 'parent' }), true)
})

test('staff and test accounts use the People page rule on both tabs', () => {
  const loader = readFileSync('lib/staffOutreach.ts', 'utf8')
  assert.match(loader, /loadDirectory\(\)/)
  assert.match(loader, /excluded !== null/)
  // The Parents tab reads lib/parentFollowUps (owner, 26 Oct 2026): the same rule.
  const parents = readFileSync('lib/parentFollowUps.ts', 'utf8')
  assert.match(parents, /p\.excluded === null && !p\.suspended && !p\.banned/)
})

// ------------------------------------------------------------ Part B

test('reason order — first match wins', () => {
  const all: TutorFollowFacts = {
    ...base,
    rejected: [{ doc: 'cnic', reason: 'blurry' }],
    docsWaiting: true,
    waitingSince: ago(3),
    startedPayment: { planCode: 'verified', startedAt: ago(0.2) },
    docsApproved: true,
    stoppedStep: 'mobile',
  }
  assert.equal(reasonKind(all), 'rejected')
  assert.equal(reasonKind({ ...all, rejected: [] }), 'waiting')
  assert.equal(followReason({ ...all, rejected: [] }, NOW).text, 'Waiting for our approval (3 days)')
  assert.equal(followReason({ ...all, rejected: [], waitingSince: ago(1) }, NOW).text, 'Waiting for our approval (1 day)')
  assert.equal(reasonKind({ ...all, rejected: [], docsWaiting: false }), 'started')
  assert.equal(followReason({ ...all, rejected: [], docsWaiting: false }, NOW).text, "Started Rs 199 payment, didn't finish")
  const noPay = { ...all, rejected: [], docsWaiting: false, startedPayment: null, stoppedStep: null }
  assert.equal(followReason(noPay, NOW).text, 'Documents approved, fee not paid')
  assert.equal(followReason({ ...noPay, docsApproved: false, stoppedStep: 'cnic_photos' }, NOW).text, 'Stopped at: CNIC photos')
  assert.equal(followReason({ ...noPay, docsApproved: false, stoppedStep: 'mobile' }, NOW).text, 'Signed up, never verified mobile')
})

test('"No activity for N days" is added when last seen 14+ days ago', () => {
  const idle = { ...base, joinedAt: ago(60), lastSeenAt: ago(20) }
  assert.equal(followReason(idle, NOW).text, 'Stopped at: Subjects · No activity for 20 days')
  assert.equal(followReason({ ...idle, lastSeenAt: ago(13) }, NOW).text, 'Stopped at: Subjects')
  // Never seen since sign-up: counted from the sign-up.
  assert.equal(followReason({ ...base, joinedAt: ago(30), lastSeenAt: null }, NOW).text, 'Stopped at: Subjects · No activity for 30 days')
})

test('Waiting on the tutor / Waiting on us — a split, every card in exactly one', () => {
  assert.ok(FOLLOW_CHIPS.includes('on_tutor') && FOLLOW_CHIPS.includes('on_us'))
  assert.equal(FOLLOW_CHIP_LABEL.on_tutor, 'Waiting on the tutor')
  assert.equal(FOLLOW_CHIP_LABEL.on_us, 'Waiting on us')
  const waiting = { ...base, docsWaiting: true, waitingSince: ago(2) }
  assert.equal(waitChip(waiting), 'on_us')
  assert.equal(waitChip(base), 'on_tutor')
  // A rejected document is the tutor's to fix, even with another one waiting.
  assert.equal(waitChip({ ...waiting, rejected: [{ doc: 'photo', reason: null }] }), 'on_tutor')
  for (const f of [base, waiting]) {
    const chips = chipsFor(f, NOW)
    assert.equal(Number(chips.has('on_us')) + Number(chips.has('on_tutor')), 1)
    // The wait chips never become the card's state badge.
    assert.ok(!['on_us', 'on_tutor'].includes(primaryChip(chips)))
  }
})

test('no WhatsApp button on Waiting on us; "Review" for the Owner instead', () => {
  assert.equal(showWhatsApp([...chipsFor({ ...base, docsWaiting: true }, NOW)]), false)
  assert.equal(showWhatsApp([...chipsFor(base, NOW)]), true)
  const card = readFileSync('app/admin/follow-ups/UnpaidSignupRow.tsx', 'utf8')
  // The WhatsApp button exists only when chase is true (owner, 23 Oct 2026).
  assert.match(card, /\{chase \? \(\s*<TutorFollowUpButtons/)
  assert.match(card, /!chase && isOwner/)
  assert.match(card, />\s*<ClipboardCheck aria-hidden size=\{13\} \/> Review/)
  assert.match(card, /\{row\.reason\}/)
})

// ------------------------------------------------------------ Part C

const SITE = 'https://www.tutormint.org'

function assertOneLinkOnItsOwnLine(text: string, label: string) {
  const links = siteLinksIn(text)
  assert.ok(links.length >= 1, `${label}: no link`)
  assert.equal(new Set(links).size, 1, `${label}: more than one link`)
  for (const l of links) assert.ok(l.startsWith(`${SITE}/`) || l === SITE, `${label}: ${l}`)
  assert.ok(
    text.split('\n').some((line) => line.trim() === links[0]),
    `${label}: link is not on its own line`,
  )
  // No bare-domain or non-www form left in the text.
  assert.doesNotMatch(text.replace(new RegExp(`${SITE.replace(/[./]/g, '\\$&')}\\S*`, 'g'), ''), /tutormint\.org\//)
}

function decodeWa(href: string | null): string {
  assert.ok(href, 'no wa.me link')
  return new URL(href!).searchParams.get('text') ?? ''
}

test('every Follow-ups message: one full https://www link on its own line', () => {
  const cases: [string, TutorFollowFacts][] = [
    ['next step', base],
    ['fee due', { ...base, docsApproved: true, stoppedStep: null }],
    ['started fee', { ...base, startedPayment: { planCode: 'verified', startedAt: ago(0.2) } }],
    ['started plan', { ...base, startedPayment: { planCode: 'premium', startedAt: ago(0.2) } }],
    ['re-upload', { ...base, rejected: [{ doc: 'selfie', reason: 'blurry' }] }],
  ]
  for (const [label, f] of cases) {
    const m = followUpMessage(f, 'Ayesha Khan', NOW)
    assertOneLinkOnItsOwnLine(m.text, label)
    assertOneLinkOnItsOwnLine(decodeWa(followUpWaLink('923001234567', m.text)), `${label} (wa.me)`)
  }
})

test('member page / People / Documents to approve messages carry the full link', () => {
  const msgs = [
    adminMemberMessage({ role: 'tutor', name: 'Ali', tutor: { facts: base, docsWaiting: true }, nowMs: NOW }),
    adminMemberMessage({ role: 'tutor', name: 'Ali', tutor: { facts: { ...base, rejected: [{ doc: 'cnic', reason: 'blurry' }] }, docsWaiting: false }, nowMs: NOW }),
    adminMemberMessage({ role: 'tutor', name: 'Ali', tutor: { facts: { ...base, docsApproved: true, stoppedStep: null }, docsWaiting: false }, nowMs: NOW }),
  ]
  for (const m of msgs) {
    assertOneLinkOnItsOwnLine(m.text, m.type)
    assertOneLinkOnItsOwnLine(decodeWa(adminWaLink('03001234567', m.text)), `${m.type} (wa.me)`)
  }
})

test('fee, payment and documents-approved messages carry the full link', () => {
  const pay = fillPaymentNotFinished(PAYMENT_NOT_FINISHED_FALLBACK, { name: 'Sara', payLink: `${SITE}/pay/choose?plan=verified` })
  assertOneLinkOnItsOwnLine(pay, 'payment not finished')
  for (const key of Object.keys(DOCUMENTS_APPROVED_FALLBACK)) {
    const t = fillDocumentsApproved(DOCUMENTS_APPROVED_FALLBACK[key], {
      name: 'Sara',
      payLink: `${SITE}/pay/choose?plan=verified`,
      profileLink: `${SITE}/tutor/sara-khan-tutor`,
    })
    assertOneLinkOnItsOwnLine(decodeWa(waMeHref('923001234567', t)), key)
  }
  // My sign-ups: the stored templates end with the link on its own line.
  const my = followUpText('Hi {name}, this is TutorMint. You can pay it here:\n{link}', { name: 'Sara', step: null, link: `${SITE}/pay/choose?plan=verified` })
  assertOneLinkOnItsOwnLine(my, 'my sign-ups')
})

test('a bare or non-www link is written in full and moved onto its own line', () => {
  assert.equal(fullSiteLinks('pay: tutormint.org/pay/choose.'), `pay: ${SITE}/pay/choose.`)
  assert.equal(fullSiteLinks('see https://tutormint.org/login'), `see ${SITE}/login`)
  assert.equal(fullSiteLinks('mail support@tutormint.org'), 'mail support@tutormint.org')
  assert.equal(linkOnOwnLine(`Continue here: ${SITE}/tutor/dashboard. Reply if stuck.`), `Continue here. Reply if stuck.\n\n${SITE}/tutor/dashboard`)
  assert.equal(linkOnOwnLine(`Pay it here: ${SITE}/pay/choose`), `Pay it here:\n${SITE}/pay/choose`)
  const edited = finishWaText('Hi, finish here: http://tutormint.org/tutor/dashboard. Thanks!')
  assertOneLinkOnItsOwnLine(edited, 'admin-edited template')
  // Several different links (the Featured tuition list) stay where they are.
  const many = `1. ${SITE}/tuitions/a-1\n2. tutormint.org/tuitions/b-2`
  assert.equal(finishWaText(many), `1. ${SITE}/tuitions/a-1\n2. ${SITE}/tuitions/b-2`)
})

test('no admin WhatsApp message source writes a bare tutormint.org link', () => {
  for (const f of ['lib/tutorFollowUpCore.ts', 'lib/adminWhatsAppCore.ts', 'lib/documentsApprovedCore.ts', 'lib/startedPaymentCore.ts']) {
    const src = readFileSync(f, 'utf8')
    assert.doesNotMatch(src, /[^/.@]tutormint\.org\/(pay|tutor|membership)/, f)
  }
  // Every wa.me builder goes through finishWaText.
  for (const f of ['lib/staffOutreachCore.ts', 'lib/followUpCore.ts', 'lib/adminWhatsAppCore.ts', 'lib/documentsApprovedCore.ts']) {
    assert.match(readFileSync(f, 'utf8'), /finishWaText\(/, f)
  }
})

test('the sign-in page has its own link preview (logo, "Sign in to TutorMint")', () => {
  const src = readFileSync('app/(site)/login/layout.tsx', 'utf8')
  assert.match(src, /socialMeta\(\{/)
  assert.match(src, /title: 'Sign in to TutorMint'/)
})
