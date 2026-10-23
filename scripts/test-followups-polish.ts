/**
 * scripts/test-followups-polish.ts — npm run test:followupspolish
 *
 * Follow-ups polish (owner, 23 Oct 2026):
 *   A  the Follow-ups → Tutors tab "Sent" is now "Followed up" (Applications
 *      keeps "Sent");
 *   B  emoji survive the pre-filled WhatsApp link — the shared builder uses
 *      api.whatsapp.com/send (wa.me turned every emoji into "�"), and every
 *      builder round-trips emoji (skin tones, joiners, ✅) and Urdu exactly;
 *   C  progress resets the 3-message count but keeps the 3-day wait (the rule
 *      itself is tested in scripts/test-tutor-journey.ts);
 *   D  the "About the Verification Fee" reply — its wording, no price warning
 *      for it alone, recorded like any message and counted toward the 3;
 *   …and no phone number or email in what a follow-up logs.
 * Pure rules + source scans. No browser, DB or network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { FU_TAB_LABEL, parseFuTab, progressKey, tabState, unansweredCount } from '../lib/tutorFollowUpTabsCore'
import { safeSlice, waSafeText, waSendHref, finishWaText } from '../lib/waLinkCore'
import { adminWaLink } from '../lib/adminWhatsAppCore'
import { followUpWaLink } from '../lib/followUpCore'
import { waLink } from '../lib/staffOutreachCore'
import { forwardWaLink } from '../lib/applicantForwardCore'
import { whatsappHref } from '../lib/supportContacts'
import { waMeHref } from '../lib/documentsApprovedCore'
import { whatsappShareLink } from '../lib/unmetSearchCore'
import { shortTitle } from '../lib/applicationStageCore'
import {
  FEE_REPLY_PAY_PATH,
  fillFollowUp,
  FU_FEE_REPLY_DEFAULT,
  FU_FEE_REPLY_KEY,
  FU_TEMPLATES,
  fuTemplateDef,
} from '../lib/followUpTemplatesCore'
import { FOLLOW_UPS_GROUP, templateSaveCheck, warningsFor } from '../lib/templateRules'
import { templateWarnings } from '../lib/applicationTemplatesCore'

const read = (p: string) => readFileSync(p, 'utf8')
const DAY = 86_400_000
const NOW = Date.parse('2026-10-23T12:00:00.000Z')
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

// ------------------------------------------------------------- A: the rename

test('A: the Follow-ups → Tutors tab reads "Followed up"; Applications keeps "Sent"', () => {
  assert.deepEqual(FU_TAB_LABEL, { todo: 'To do', sent: 'Followed up' })
  // Old links (?fu=sent) still open the same tab.
  assert.equal(parseFuTab('sent'), 'sent')
  assert.equal(parseFuTab(null), 'todo')
  const page = read('app/admin/follow-ups/page.tsx')
  assert.match(page, /\{FU_TAB_LABEL\[t\]\} <span/)
  assert.doesNotMatch(page, /'To do' : 'Sent'/, 'the old label is gone')
  assert.match(page, /Nobody followed up in the last 3 days\./)
  assert.match(page, /Nobody to message right now\./)
  assert.doesNotMatch(page, /moves to Sent|Tutors messaged in the last 3 days/)
  const buttons = read('components/admin/TutorFollowUpButtons.tsx')
  assert.match(buttons, /moved to Followed up/)
  assert.doesNotMatch(buttons, /moved to Sent/)
  // Applications is unchanged.
  assert.match(read('app/admin/applications/page.tsx'), /"Sent"/)
})

// ------------------------------------------------------- B: emoji round-trip

const EMOJI_URDU =
  'Assalam o Alaikum Ayesha 👍🏽 ✅ 🙂 👨‍👩‍👧 ❤️ 🇵🇰\nآپ کی پروفائل تقریباً مکمل ہے۔\nYou can continue here:\nhttps://www.tutormint.org/tutor/dashboard'

/** The text a WhatsApp link carries, decoded. */
function textOf(href: string | null): string {
  assert.ok(href, 'a link')
  const u = new URL(href!)
  assert.equal(u.origin + u.pathname, 'https://api.whatsapp.com/send', `the direct address, never wa.me: ${href}`)
  return u.searchParams.get('text') ?? ''
}

test('B: the shared builder keeps emoji (skin tones, joiners, flags, ✅) and Urdu exactly', () => {
  const href = waSendHref('923001234567', EMOJI_URDU)
  assert.equal(textOf(href), EMOJI_URDU)
  assert.equal(new URL(href).searchParams.get('phone'), '923001234567')
  assert.ok(!href.includes('%EF%BF%BD'), 'no "�" in the link')
  assert.ok(href.includes('%F0%9F%91%8D%F0%9F%8F%BD'), '👍🏽 encoded whole')
  assert.ok(href.includes('%E2%9C%85'), '✅ encoded whole')
  // No number: WhatsApp asks who to send it to.
  assert.equal(textOf(waSendHref(null, EMOJI_URDU)), EMOJI_URDU)
  assert.equal(new URL(waSendHref('', 'x')).searchParams.has('phone'), false)
})

test('B: every pre-filled builder round-trips the same text (Follow-ups, Applications, By tutor, member page, inbox)', () => {
  // finishWaText only moves the one link onto its own line — already so here.
  assert.equal(finishWaText(EMOJI_URDU), EMOJI_URDU)
  assert.equal(textOf(adminWaLink('0300 1234567', EMOJI_URDU)), EMOJI_URDU) // member page, People, Applications check-ins
  assert.equal(textOf(followUpWaLink('923001234567', EMOJI_URDU)), EMOJI_URDU) // My sign-ups, Team activity
  assert.equal(textOf(waLink('923001234567', EMOJI_URDU)), EMOJI_URDU) // Follow-ups → Tutors, Featured WhatsApp
  assert.equal(textOf(forwardWaLink('923001234567', EMOJI_URDU)), EMOJI_URDU) // Forward to parents
  assert.equal(textOf(whatsappHref('923001234567', EMOJI_URDU)), EMOJI_URDU) // Team inbox, Message parent
  assert.equal(textOf(waMeHref('923001234567', EMOJI_URDU)), EMOJI_URDU) // after documents approved
  assert.equal(textOf(whatsappShareLink(EMOJI_URDU)), EMOJI_URDU) // hiring post
  // The Applications and By-tutor messages go through adminWaLink.
  for (const f of ['lib/applicationFollowUps.ts', 'lib/applicationWhatsApp.ts']) {
    const src = read(f)
    assert.match(src, /adminWaLink\(/, `${f} builds its link with adminWaLink`)
    assert.doesNotMatch(src, /wa\.me\/\$\{/, `${f} builds no wa.me link itself`)
  }
})

test('B: a broken half of an emoji, or a "�", is dropped — never sent', () => {
  const lone = 'Hi \uD83D there \uDE42 and � done'
  assert.equal(waSafeText(lone), 'Hi  there  and  done')
  assert.equal(textOf(waSendHref('923001234567', lone)), 'Hi  there  and  done')
  // encodeURIComponent would THROW on a lone surrogate; the builder never does.
  assert.throws(() => encodeURIComponent('\uD83D'))
  assert.doesNotThrow(() => waSendHref('923001234567', '\uD83D'))
})

test('B: cutting text never splits an emoji', () => {
  assert.equal(safeSlice('ab👍🏽cd', 3), 'ab👍')
  assert.equal(safeSlice('abc', 10), 'abc')
  const title = `${'x'.repeat(58)}🙂🙂 and more words here`
  const cut = shortTitle(title, 59)
  assert.equal(waSafeText(cut), cut, 'no lone half of an emoji in a shortened title')
})

test('B: no pre-filled builder uses wa.me any more (only fixed English member links do)', () => {
  // These carry fixed English text with no emoji; they keep wa.me.
  const FIXED_TEXT = new Set([
    'lib/dailyReportCore.ts',
    'lib/docLockCore.ts',
    'lib/errorMessages.ts',
    'lib/payments/receiptCore.ts',
    'app/(site)/tutor/[slug]/page.tsx',
  ])
  const files = [
    'lib/adminWhatsAppCore.ts',
    'lib/applicantForwardCore.ts',
    'lib/documentsApprovedCore.ts',
    'lib/followUpCore.ts',
    'lib/staffOutreachCore.ts',
    'lib/supportContacts.ts',
    'lib/unmetSearchCore.ts',
    'app/admin/users/[id]/page.tsx',
    'components/admin/ParentDocumentReview.tsx',
    'components/admin/TutorDocumentReview.tsx',
  ]
  for (const f of files) {
    assert.ok(!FIXED_TEXT.has(f))
    const code = read(f).replace(/^\s*(\/\/|\*).*$/gm, '')
    assert.doesNotMatch(code, /wa\.me\/[^`'"]*\?text=/, `${f} builds a wa.me link with text`)
  }
})

// ---------------------------------------------- C: progress keeps the wait

test('C: progress resets the count, the tutor stays in Followed up for 3 days', () => {
  const before = progressKey({ stoppedStep: 'cnic_photos', completion: 53, feePaid: false, docsApproved: false })
  const after = progressKey({ stoppedStep: 'selfie', completion: 73, feePaid: false, docsApproved: false })
  const c = [{ at: ago(2 / 24), progress: before }]
  const s = tabState({ joinedAt: ago(5), progress: after, waitingOnUs: false, contacts: c }, NOW)
  assert.equal(s.tab, 'sent')
  assert.equal(s.unanswered, 0)
  assert.equal(tabState({ joinedAt: ago(5), progress: after, waitingOnUs: false, contacts: [{ at: ago(3), progress: before }] }, NOW).tab, 'todo')
})

// ------------------------------------------------------------- D: fee reply

const VALUES = {
  firstName: 'Ayesha',
  completion: 60,
  nextStep: 'add your selfie',
  continueLink: 'https://www.tutormint.org/tutor/dashboard',
  payLink: 'https://www.tutormint.org/pay/choose',
  supportWhatsapp: '0321 5872222',
}

test('D: "About the Verification Fee" has the owner\'s wording and fills exactly', () => {
  assert.equal(
    FU_FEE_REPLY_DEFAULT,
    'Joining TutorMint is free — no commission, no middleman. To apply to tuitions, tutors pay a one-time Verification Fee of Rs 199. We check your CNIC and selfie, and your profile gets the Verified badge so parents can trust you. You can pay here: {pay_link}. Any questions, message us on WhatsApp {support_whatsapp}.',
  )
  const def = fuTemplateDef(FU_FEE_REPLY_KEY)!
  assert.equal(def.title, 'About the Verification Fee')
  assert.equal(def.reason, null, 'a saved reply, not a reason')
  assert.ok(FU_TEMPLATES.some((t) => t.key === FU_FEE_REPLY_KEY))
  assert.ok(FOLLOW_UPS_GROUP.some((t) => t.key === FU_FEE_REPLY_KEY), 'in Team inbox → Templates → Follow-ups')
  assert.equal(FEE_REPLY_PAY_PATH, '/pay/choose')
  const text = fillFollowUp(FU_FEE_REPLY_DEFAULT, VALUES, 'pay')
  assert.equal(
    text,
    'Joining TutorMint is free — no commission, no middleman. To apply to tuitions, tutors pay a one-time Verification Fee of Rs 199. We check your CNIC and selfie, and your profile gets the Verified badge so parents can trust you. You can pay here: https://www.tutormint.org/pay/choose. Any questions, message us on WhatsApp 0321 5872222.',
    'nothing appended: it has its own link and support number',
  )
  // As sent: the one link goes on its own line.
  const sent = textOf(waLink('923001234567', text))
  assert.ok(sent.endsWith('\n\nhttps://www.tutormint.org/pay/choose'), sent)
  // The migration seeds the same text.
  const mig = read('supabase/migrations/197_fee_reply_template.sql')
  assert.ok(mig.includes(`'${FU_FEE_REPLY_DEFAULT}'`), 'migration 197 seeds the code default')
  assert.match(mig, /on conflict \(key\) do nothing/)
})

test('D: the price warning is not shown for the fee reply — and still is everywhere else', () => {
  assert.ok(templateWarnings(FU_FEE_REPLY_DEFAULT).some((w) => /price/.test(w)), 'the general rule would warn')
  assert.deepEqual(warningsFor(FU_FEE_REPLY_KEY, FU_FEE_REPLY_DEFAULT), [])
  const save = templateSaveCheck(FU_FEE_REPLY_KEY, FU_FEE_REPLY_DEFAULT)
  assert.ok(save.ok && save.warnings.length === 0)
  // A superlative is still a warning for it.
  assert.equal(warningsFor(FU_FEE_REPLY_KEY, `${FU_FEE_REPLY_DEFAULT} The best tutors.`).length, 1)
  // Another Follow-ups template with a price still warns.
  assert.ok(warningsFor('fu_no_cnic', 'Pay Rs 199 now {continue_link}').some((w) => /price/.test(w)))
  // Unknown placeholders still block it.
  assert.equal(templateSaveCheck(FU_FEE_REPLY_KEY, 'Pay at {amount}').ok, false)
  // The editor uses the same rule.
  assert.match(read('app/admin/inbox/ApplicationTemplates.tsx'), /const warnings = warningsFor\(info\.key, body\)/)
})

test('D: a fee reply is recorded like any message and counts toward the 3', () => {
  const P = progressKey({ stoppedStep: 'selfie', completion: 60, feePaid: false, docsApproved: false })
  const msgs = [
    { at: ago(9), progress: P, templateKey: 'fu_no_photo' },
    { at: ago(6), progress: P, templateKey: FU_FEE_REPLY_KEY },
    { at: ago(3.5), progress: P, templateKey: 'fu_no_photo' },
  ]
  assert.equal(unansweredCount(msgs, P), 3)
  assert.equal(tabState({ joinedAt: ago(10), progress: P, waitingOnUs: false, contacts: msgs }, NOW).section, 'no_reply')
  // The button records through the same route, with the same Undo.
  const buttons = read('components/admin/TutorFollowUpButtons.tsx')
  assert.match(buttons, /record\('whatsapp', FU_FEE_REPLY_KEY\)/)
  assert.match(buttons, /Fee reply/)
  assert.match(buttons, /ms: UNDO_MS/)
  // On every row with a number: the chase buttons AND waiting-on-us cards.
  const row = read('app/admin/follow-ups/UnpaidSignupRow.tsx')
  assert.match(row, /feeReplyHref=\{row\.feeReplyHref\}/)
  assert.match(row, /<FeeReplyButton memberId=\{row\.id\}/)
  // The route accepts it even for a tutor waiting on us, and stores the key.
  const route = read('app/api/admin/follow-ups/tutor/route.ts')
  assert.match(route, /const feeReply = b\.channel === 'whatsapp' && b\.templateKey === FU_FEE_REPLY_KEY/)
  assert.match(route, /if \(b\.reason === 'waiting' && !feeReply\)/)
  // The row's link is the stored template (or its default), pay link /pay/choose.
  const rows = read('lib/tutorFollowUps.ts')
  assert.match(rows, /resolveBody\(fuTemplates\.get\(FU_FEE_REPLY_KEY\)\?\.body, asAppDef\(feeReplyDef\)\)/)
  assert.match(rows, /payLink: siteLink\(FEE_REPLY_PAY_PATH\)/)
})

// ------------------------------------------------- no phone or email in logs

test('no phone number or email in what a follow-up logs', () => {
  const lib = read('lib/followUps.ts')
  const rec = lib.slice(lib.indexOf('export async function recordFollowUp'), lib.indexOf('/** Undo: the record stays'))
  // The audit row and the timeline carry ids, channel, template, source, reason.
  const detail = /detail: \{([^}]*)\}/.exec(rec)![1]
  const meta = /meta: \{([^}]*)\}/.exec(rec)![1]
  for (const part of [detail, meta]) {
    assert.doesNotMatch(part, /phone|msisdn|mobile|whatsapp|email|href|text|body/i, part)
  }
  // Nothing on the send path prints to the server log.
  for (const f of [
    'lib/followUps.ts',
    'lib/tutorFollowUps.ts',
    'lib/waLinkCore.ts',
    'app/api/admin/follow-ups/tutor/route.ts',
    'components/admin/TutorFollowUpButtons.tsx',
    'lib/followUpTemplatesCore.ts',
  ]) {
    assert.doesNotMatch(read(f), /console\.(log|info|warn|error|debug)\(/, `${f} logs nothing`)
  }
  // The route reply carries only an id — never the link or the number.
  assert.match(read('app/api/admin/follow-ups/tutor/route.ts'), /NextResponse\.json\(\{ success: true, id: res\.id \}\)/)
})
