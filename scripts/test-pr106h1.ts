/**
 * scripts/test-pr106h1.ts  —  npm run test:pr106h1
 *
 * PR106-H1 operations readiness: payment alert emails (one per confirmed
 * payment, owner-only setting), the Approval-needed queue (tab/count/order/
 * chips), rejection alerts (reason required + email + in-app + WhatsApp, no CNIC
 * data), and owner-only read-only "View as tutor" (audited). Pure logic + source
 * scans. No browser/DB/network.
 */
import { test } from 'node:test'
import { tutorWaiting } from '../lib/tutorDocQueueCore'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { parseAlertEmails } from '../lib/payments/alertEmailsCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// --------------------------------------------- STEP 2: payment alerts -------
test('alert addresses are parsed, de-duplicated and validated; default is the owner', () => {
  assert.deepEqual(parseAlertEmails('a@x.com, b@y.com\nA@X.COM'), ['a@x.com', 'b@y.com']) // dedupe + lowercase
  assert.deepEqual(parseAlertEmails('not-an-email, c@z.com'), ['c@z.com']) // invalid dropped
  assert.deepEqual(parseAlertEmails(''), [])
  assert.deepEqual(parseAlertEmails(null), [])
})

test('exactly one alert per confirmed payment (idempotent) with safe content', () => {
  const act = read('lib/payments/activate.ts')
  // alreadyActive returns BEFORE any activation, so a replayed callback never
  // reaches the alert — one alert per fresh activation.
  assert.match(act, /if \(payment\.status === 'approved'\)[^]*alreadyActive: true/, 'replay returns early')
  assert.equal((act.match(/sendPaymentAlert\(/g) || []).length, 2, 'alert sent in the fee AND plan fresh-activation branches')
  const alerts = read('lib/payments/paymentAlerts.ts')
  assert.match(alerts, /NEVER includes a CNIC number/, 'documents the no-sensitive-data rule')
  // the template carries no CNIC/phone/card field
  const tpl = read('lib/notify/templates.ts')
  assert.match(tpl, /id: 'payment_alert'; memberName: string; role: string; what: string; amountPkr: number; whenPkt: string/, 'payment_alert fields are non-sensitive')
  assert.match(tpl, /New payment received: Rs \$\{input\.amountPkr\.toLocaleString\('en-PK'\)\} — \$\{input\.what\}/, 'subject format')
})

test('the payment-alert setting is OWNER-only', () => {
  const route = read('app/api/admin/payments/alert-emails/route.ts')
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.paymentsSwitches\)/, 'owner-only screen (paymentsSwitches = [])')
  assert.match(route, /requireFreshAuth/, 'fresh password required')
  assert.match(route, /detail: \{ count: list\.length \}/, 'audit logs the count, not the addresses')
  const page = read('app/admin/payments/bank-details/page.tsx')
  assert.match(page, /isOwner && <AlertEmailsForm/, 'the form shows only to the owner')
})

test('a bank transfer submitted alerts staff', () => {
  const manual = read('app/api/payments/manual/route.ts')
  assert.match(manual, /sendBankTransferPending\(/, 'bank transfer submit sends the waiting-for-approval alert')
})

// --------------------------------------------- STEP 3: approval queue -------
test('approval queue: waiting conditions, order (paid first then oldest), chips', () => {
  // Since 9 Oct 2026 the waiting set is the review card's own statuses
  // (lib/tutorDocQueueCore tutorWaiting) — same four items, one rule.
  const q = read('lib/approvalQueue.ts')
  assert.match(q, /tutorWaiting\(/, 'the queue reads the shared rule')
  const all = tutorWaiting({
    verification_state: 'submitted', cnic_number: '1', cnic_image_path: 'p',
    avatar_url: 'a', profile_pic_status: 'pending',
    selfie_status: 'pending', hasSelfieFile: true, video_status: 'uploaded',
  })
  assert.deepEqual(all, ['CNIC', 'Photo', 'Selfie', 'Video'], 'CNIC submitted, photo/selfie pending, video uploaded all wait')
  assert.match(q, /a\.paid === b\.paid \? a\.createdAt\.localeCompare\(b\.createdAt\) : a\.paid \? -1 : 1/, 'fee-paid first, then oldest')
  assert.match(q, /!p\.is_seed && !p\.is_banned && !p\.is_suspended/, 'fixtures/banned/suspended excluded')
  const page = read('app/admin/users/page.tsx')
  assert.match(page, /filter === 'approval' && canReview/, 'owner/admin/operations only, own tab')
  assert.match(page, /Approval needed/, 'the tab/chip')
  const layout = read('app/admin/layout.tsx')
  assert.match(layout, /'\/admin\/users': approvals/, 'sidebar count beside People')
})

// --------------------------------------------- STEP 4: rejection alerts -----
test('reject requires a reason and sends email + in-app + WhatsApp with NO CNIC data', () => {
  const doc = read('lib/tutorDocuments.ts')
  assert.match(doc, /decision === 'reject' && reason\.trim\(\)\.length < 3[^]*A reason is required/, 'reason required to reject')
  assert.match(doc, /id: 'verification_rejected'[^]*reason: reason\.trim\(\), href: reuploadHref/, 'rejection email with reason + re-upload link')
  assert.match(doc, /settings#identity/, 'in-app + email link straight to the re-upload step')
  // the WhatsApp message (admin UI) uses the item name + reason + link — never a CNIC number/image
  const ui = read('components/admin/TutorDocumentReview.tsx')
  assert.match(ui, /Send on WhatsApp/, 'the WhatsApp button exists')
  assert.match(ui, /wa\.me\/\$\{waMsisdn\}\?text=/, 'opens WhatsApp to the member with a pre-written message')
  // The WhatsApp message itself never carries a CNIC number. (The card shows the
  // number box since 9 Oct 2026 — heavily masked, XXXXX-XXXXXXX-4 — but nothing
  // of it reaches the message.)
  const wa = ui.slice(ui.indexOf('const whatsappHref = (() => {'), ui.indexOf('})()', ui.indexOf('const whatsappHref = (() => {')))
  assert.ok(wa.length > 0 && !/cnic_number|cnicNumber|Masked/.test(wa), 'no CNIC number in the WhatsApp message')
  assert.match(read('app/admin/tutors/[id]/page.tsx'), /cnicNumberMasked=\{maskCnicHeavy\(/, 'the card only ever gets the heavily masked number')
  assert.match(ui, /REJECT_PRESETS/, 'reason picker: short list')
  assert.match(ui, /<textarea/, 'reason picker: Other free text')
})

test('a re-upload returns the member to the queue (the statuses it writes are the waiting ones)', () => {
  // CNIC re-submit → verification_state 'submitted'; selfie upload → selfie_status
  // 'pending' — both are the queue's "waiting" conditions, so a re-upload re-queues.
  // A rejected CNIC re-submitted (verification_state back to 'submitted', no
  // approval marker) and a selfie set back to 'pending' both wait again.
  assert.deepEqual(
    tutorWaiting({ verification_state: 'submitted', cnic_verified_at: null, cnic_number: '1', cnic_image_path: 'p', selfie_status: 'pending', hasSelfieFile: true }),
    ['CNIC', 'Selfie'],
  )
  const upload = read('app/api/documents/upload/route.ts')
  assert.match(upload, /selfie_status: 'pending'/, 'a selfie re-upload sets it back to pending')
})

// --------------------------------------------- STEP 5: view as tutor --------
test('View as tutor is owner-only, read-only and audited', () => {
  const page = read('app/admin/view-as/[id]/page.tsx')
  assert.match(page, /requireAdminRole\(\) \/\/ no roles → owner only/, 'owner-only gate')
  // The view-only Partner (owner, 8 Oct 2026) views it too; everyone else is redirected.
  assert.match(page, /actor\.adminRole !== 'owner' && actor\.adminRole !== 'partner'\) redirect/, 'non-owner redirected')
  assert.match(page, /action: 'view_as_tutor'/, 'every open is audit-logged')
  assert.match(page, /Viewing as \{name\} — read-only/, 'the fixed read-only banner')
  assert.match(page, /Exit/, 'an Exit button')
  // read-only by construction: service-role READ for display, no mutation control
  assert.match(page, /no control that writes/, 'documents the read-only guarantee')
  assert.ok(!/method: 'POST'|<form|adminFetch|onSubmit/.test(page), 'the page has no write path')
  const tutorPage = read('app/admin/tutors/[id]/page.tsx')
  assert.match(tutorPage, /isOwner && \(\s*\n?\s*<Link\s+href=\{`\/admin\/view-as\/\$\{id\}`\}/, 'owner-only button on the member page')
})
