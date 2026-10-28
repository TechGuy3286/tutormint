/**
 * scripts/test-template-rewrite.ts — the simple-English template rewrite
 * (owner, 28 Oct 2026). Pins:
 *   - every proposed template follows the writing rules (lines, one link, link
 *     last, the support line, no emoji, no jargon, no price except the fee
 *     reply, Urdu unchanged, placeholders its send paths fill);
 *   - every proposal sent through its REAL fill path(s) leaves no placeholder,
 *     ends with the support number, and has its link last;
 *   - parent templates never link to a sign-in or dashboard page; posting
 *     links go to /post-tuition;
 *   - live wording is unchanged until approved (emails fall back to the
 *     built-in wording; the migration writes no template);
 *   - Approve, Edit then approve, Keep, Approve all and Restore (on an
 *     in-memory database, never a real one).
 *
 *   npx tsx --conditions=react-server --test scripts/test-template-rewrite.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { ALL_PROPOSALS, SUPPORT_LINE, WHATSAPP_PROPOSALS, checkWording, proposalFor, urduLines, type Proposal } from '@/lib/templateProposals'
import { LIVE_URDU } from '@/lib/templateUrdu'
import { EMAIL_PROPOSALS, EMAIL_SAMPLE_INPUTS, EMAIL_VARIANTS, emailKey, emailWordingFor } from '@/lib/notify/emailWordingCore'
import { pickEmail } from '@/lib/notify/emailPick'
import { render } from '@/lib/notify/templates'
import { APP_TEMPLATE_DEFAULTS, SAMPLE_VALUES, fillTemplate } from '@/lib/applicationTemplatesCore'
import { FU_FEE_REPLY_DEFAULT, FU_NEW_DEFAULTS, FU_REUSED_DEFAULTS, fillFollowUp } from '@/lib/followUpTemplatesCore'
import { PARENT_DEFAULTS, fillParentFollowUp } from '@/lib/parentFollowUpCore'
import { followUpText } from '@/lib/followUpCore'
import { fillPaymentNotFinished } from '@/lib/startedPaymentCore'
import { fillDocumentsApproved } from '@/lib/documentsApprovedCore'
import { fillStatusMessage, STATUS_IMAGE_DEFAULT } from '@/lib/social/statusImageCore'
import { APPLICANTS_FORWARD_DEFAULT, buildForwardMessage } from '@/lib/applicantForwardCore'
import { completeCommon } from '@/lib/templateFill'
import { composeLink, composeLinkPath } from '@/lib/composeLinks'
import { siteLink } from '@/lib/waLinkCore'
import { POST_TUITION_PUBLIC_PATH } from '@/lib/postTuitionPage'
import { NEXT_STEP_TEMPLATE } from '@/lib/mySignupsCore'
import { TUITION_LIVE_LABEL } from '@/lib/tuitionStatus'
import { approveAllPending, decideTemplate, restoreTemplate } from '@/lib/templateReview'
import { fakeSupabase } from './fakeSupabase'

const SUPPORT = '0321 5872222'
const SUPPORT_SENT = `Need help? WhatsApp ${SUPPORT}`
const OWNER = { id: '11111111-1111-4111-8111-111111111111', email: null, adminRole: 'owner' as const }
const BAD_PARENT_LINK = /\/login\b|\/dashboard\b|\/signin\b/i

const liveFor = (p: Proposal) => (LIVE_URDU[p.key] ? `Old English\n\n${LIVE_URDU[p.key]}` : null)

// ------------------------------------------------------------- the rules

test('every proposed template follows the writing rules', () => {
  for (const p of ALL_PROPOSALS) {
    const problems = checkWording(p, liveFor(p))
    assert.deepEqual(problems, [], `${p.key}: ${problems.join(' | ')}`)
  }
})

test('the rules catch what they should', () => {
  const p = proposalFor('pf_no_tuition')!
  const bad = (body: string, why: RegExp) => assert.ok(checkWording({ ...p, body }).some((x) => why.test(x)), `expected ${why} for:\n${body}`)
  bad(p.body.replace('Assalam o Alaikum {first_name},', 'Assalam o Alaikum {first_name}, 🙂'), /emoji/)
  bad(p.body.replace('Post your tuition', 'Open your dashboard and post your tuition'), /dashboard/)
  bad(p.body.replace('Post your tuition for free', 'Post your tuition for Rs 500'), /price/)
  bad(p.body.replace('{post_link}', '{post_link}\n{tuition_link}'), /exactly one|not last/)
  bad(p.body.replace(`\n\n${SUPPORT_LINE}`, ''), /Need help/)
  bad(p.body.replace('{post_link}', 'Go: {post_link}'), /alone/)
  bad(p.body.replace('You can post it yourself here:', 'Line two.\nLine three.\nYou can post it yourself here:'), /lines before the link/)
  bad(p.body.replace('{first_name}', '{oops}'), /placeholders/)
  bad(p.body.replace('Assalam o Alaikum {first_name},', 'Thanks for joining.'), /greeting/)
  bad(p.body.replace('You can post it yourself here:', 'Reply with the details or post it here:'), /reply/)
  // Urdu must match the live template exactly.
  const fee = proposalFor('fee_not_paid')!
  assert.ok(checkWording({ ...fee, body: fee.body.replace('ٹیوٹر منٹ ٹیم', 'ٹیم') }, liveFor(fee)).some((x) => /Urdu/.test(x)))
})

test('Urdu parts are exactly the live Urdu', () => {
  for (const key of Object.keys(LIVE_URDU)) {
    const p = proposalFor(key)
    assert.ok(p, `${key} has a proposal`)
    assert.equal(urduLines(p!.body).join('\n'), urduLines(LIVE_URDU[key]).join('\n'), key)
    assert.ok(p!.body.includes(LIVE_URDU[key]), `${key}: the Urdu block is byte-for-byte the live one`)
  }
})

test('only the fee reply states a price; receipts use a placeholder', () => {
  for (const p of ALL_PROPOSALS) {
    const words = [p.body, p.subject ?? ''].join(' ').replace(/\{[a-z_]+\}/g, ' ')
    if (p.key === 'fu_fee_reply') assert.match(words, /Rs 199/)
    else assert.doesNotMatch(words, /\bRs\b|\bPKR\b|rupee/i, p.key)
  }
})

test('every member-facing template is covered', () => {
  const live = [
    'address_untraceable', 'app_applied', 'app_contacted', 'app_demo', 'app_forwarded', 'app_hired', 'app_no_response', 'app_not_selected',
    'app_tutor_update', 'applicants_forward', 'awaiting_approval', 'cnic_unclear', 'documents_approved', 'documents_approved_paid',
    'fee_not_paid', 'fu_fee_reply', 'fu_no_cnic', 'fu_no_photo', 'fu_paid_unfinished', 'fu_reupload', 'job_under_review',
    'my_signup_buy_plan', 'my_signup_check_in', 'my_signup_pay_fee', 'my_signup_post_tuition', 'my_signup_upload_documents', 'no_whatsapp',
    'payment_approved', 'payment_not_finished', 'payment_received', 'pf_email_unconfirmed', 'pf_expired', 'pf_hired', 'pf_no_applicants',
    'pf_no_tuition', 'pf_tutors_applied', 'profile_completion_nudge', 'seeded_tuition_live', 'signup_email_unconfirmed',
    'signup_mobile_unverified', 'signup_profile_unfinished', 'status_image_verified', 'video_rerecord',
  ]
  const keys = new Set(WHATSAPP_PROPOSALS.map((p) => p.key))
  for (const k of live) assert.ok(keys.has(k), `${k} has a proposal`)
  for (const v of EMAIL_VARIANTS) assert.ok(proposalFor(emailKey(v)), `email ${v} has a proposal`)
  assert.equal(new Set(ALL_PROPOSALS.map((p) => p.key)).size, ALL_PROPOSALS.length, 'no duplicate keys')
})

// ------------------------------------------------------------- real send paths

function assertSent(key: string, text: string, opts: { link?: boolean; urdu?: boolean } = {}) {
  assert.doesNotMatch(text, /\{[a-z_]+\}/, `${key}: placeholder left:\n${text}`)
  assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `${key}: emoji`)
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  assert.equal(lines[lines.length - 1], SUPPORT_SENT, `${key}: support line last:\n${text}`)
  if (opts.link !== false) assert.match(lines[lines.length - 2], /^https:\/\/www\.tutormint\.org\/\S+$|: https:\/\/www\.tutormint\.org\/\S+$/, `${key}: link last:\n${text}`)
  return lines
}

const pf = (body: string) =>
  fillParentFollowUp(body, {
    firstName: 'Sana',
    tuitionTitle: 'Home Tutor Required | Grade 5',
    tuitionLink: siteLink('/tuitions/lahore/sample-1a2b3c'),
    postLink: siteLink(POST_TUITION_PUBLIC_PATH),
    tutorName: 'Rida Saeed',
    reviewLink: siteLink('/review?application=1'),
    tutorLinks: [siteLink('/tutor/rida-saeed-tutor')],
    signinLink: siteLink('/login'),
    repostLink: siteLink(POST_TUITION_PUBLIC_PATH),
    supportWhatsapp: SUPPORT,
  })

const fu = (body: string) =>
  fillFollowUp(body, {
    firstName: 'Rida',
    completion: 60,
    nextStep: 'add your profile photo',
    continueLink: siteLink('/tutor/dashboard'),
    payLink: siteLink('/pay/choose?plan=verified'),
    document: 'selfie',
    reason: 'Reason: face not clear.',
    supportWhatsapp: SUPPORT,
  })

const compose = (key: string, body: string, role: 'tutor' | 'parent') =>
  completeCommon(body.replace(/\{name\}/g, 'Sana Ahmed').replace(/\{job_title\}/g, 'Home Tutor Required').replace(/\{reason\}/g, 'The sound is not clear.'), {
    name: 'Sana Ahmed',
    link: composeLink(key, role),
    supportWhatsapp: SUPPORT,
  })

test('every WhatsApp / Team proposal sent through its real fill path(s)', () => {
  for (const p of WHATSAPP_PROPOSALS) {
    const k = p.key
    const opts = { link: !p.noLink }
    if (k.startsWith('app_')) assertSent(k, fillTemplate(p.body, { ...SAMPLE_VALUES, support_whatsapp: SUPPORT }), opts)
    else if (k === 'applicants_forward') {
      const text = buildForwardMessage({ template: p.body, parentName: 'Sana', tuitionTitle: 'Home Tutor Required', area: 'DHA', tutors: [{ name: 'Rida Saeed', profileUrl: siteLink('/tutor/rida-saeed-tutor') }], supportWhatsapp: SUPPORT })
      assertSent(k, text, opts)
    } else if (k.startsWith('pf_')) assertSent(k, pf(p.body), opts)
    else if (k === 'documents_approved' || k === 'documents_approved_paid') {
      assertSent(k, fillDocumentsApproved(p.body, { name: 'Rida Saeed', payLink: siteLink('/pay/choose?plan=verified'), profileLink: siteLink('/tutor/rida'), supportWhatsapp: SUPPORT }), opts)
    } else if (k === 'status_image_verified') assertSent(k, fillStatusMessage(p.body, 'Rida', SUPPORT), opts)
    else if (k === 'seeded_tuition_live') {
      const t = p.body.replaceAll('{name}', 'Sana').replaceAll('{tuition_url}', siteLink('/tuitions/lahore/x-1a2b3c'))
      assertSent(k, completeCommon(t, { name: 'Sana', supportWhatsapp: SUPPORT }), opts)
    } else if (k.startsWith('my_signup_')) {
      assertSent(k, followUpText(p.body, { name: 'Sana', step: null, link: siteLink('/x'), supportWhatsapp: SUPPORT }), opts)
    } else if (p.kind === 'team') assertSent(k, compose(k, p.body, p.recipient === 'parent' ? 'parent' : 'tutor'), opts)
    else {
      // Follow-ups → Tutors, and the shared ones.
      assertSent(k, fu(p.body), opts)
      if (k === 'payment_not_finished') assertSent(k, fillPaymentNotFinished(p.body, { name: 'Rida Saeed', payLink: siteLink('/pay/choose?plan=verified'), supportWhatsapp: SUPPORT }))
      if (k === 'profile_completion_nudge' || k === 'signup_mobile_unverified' || k === 'fee_not_paid') assertSent(k, compose(k, p.body, 'tutor'), opts)
      if (k === 'profile_completion_nudge' || k === 'signup_mobile_unverified') {
        const text = followUpText(p.body, { name: 'Rida', step: 'Photo', link: siteLink('/tutor/onboarding'), missing: ['profile photo'], supportWhatsapp: SUPPORT })
        const lines = assertSent(k, text)
        assert.match(lines[lines.length - 3], /^Still to do:/, `${k}: "Still to do" sits just above the link:\n${text}`)
      }
    }
  }
})

test('every email proposal renders with no placeholder left and the support line under the button', () => {
  for (const v of EMAIL_VARIANTS) {
    const p = proposalFor(emailKey(v))!
    const m = pickEmail(EMAIL_SAMPLE_INPUTS[v], new Map([[v, { subject: p.subject!, body: p.body }]]), SUPPORT)
    assert.doesNotMatch(m.subject + m.text + m.html, /\{[a-z_]+\}/, `${v}: placeholder left`)
    assert.ok(m.text.includes(SUPPORT_SENT), `${v}: support line`)
    assert.ok(m.html.includes(SUPPORT_SENT), `${v}: support line in html`)
    if (p.button) assert.ok(m.html.includes(p.button), `${v}: button`)
    assert.equal(m.essential, render(EMAIL_SAMPLE_INPUTS[v]).essential, `${v}: essential unchanged`)
  }
})

// ------------------------------------------------------------- parents and posting

test('parent templates never link to a sign-in or dashboard page; posting goes to /post-tuition', () => {
  for (const p of ALL_PROPOSALS.filter((x) => x.recipient === 'parent')) {
    assert.ok(!/\{(signin_link|repost_link)\}/.test(p.body), `${p.key} uses no sign-in or repost link`)
    if (p.kind === 'team') assert.doesNotMatch(composeLinkPath(p.key, 'parent'), BAD_PARENT_LINK, p.key)
    if (p.kind === 'email') {
      const v = p.key.replace('email:', '') as (typeof EMAIL_VARIANTS)[number]
      const href = emailWordingFor(EMAIL_SAMPLE_INPUTS[v], TUITION_LIVE_LABEL)?.href ?? ''
      assert.doesNotMatch(href, BAD_PARENT_LINK, p.key)
    }
    if (p.key.startsWith('pf_')) {
      const text = pf(p.body)
      for (const url of text.match(/https:\/\/\S+/g) ?? []) assert.doesNotMatch(url, BAD_PARENT_LINK, `${p.key}: ${url}`)
    }
  }
  // Every team template's parent link (the compose box).
  for (const p of ALL_PROPOSALS.filter((x) => x.kind === 'team' && x.recipient !== 'tutor')) assert.doesNotMatch(composeLinkPath(p.key, 'parent'), BAD_PARENT_LINK, p.key)
  assert.equal(NEXT_STEP_TEMPLATE.post_tuition.path, POST_TUITION_PUBLIC_PATH)
  assert.match(readFileSync('lib/parentWhatsApp.ts', 'utf8'), /postLink: siteLink\(POST_TUITION_PUBLIC_PATH\)/)
  for (const k of ['pf_no_tuition', 'pf_email_unconfirmed', 'pf_expired', 'my_signup_post_tuition']) assert.match(proposalFor(k)!.body, /\{(post_link|link)\}/, k)
  assert.equal(emailWordingFor(EMAIL_SAMPLE_INPUTS.welcome_parent, '')?.href, POST_TUITION_PUBLIC_PATH)
})

// ------------------------------------------------------------- live until approved

test('live wording is unchanged until approved', () => {
  // Emails: no approved wording → the built-in email, byte for byte.
  for (const v of EMAIL_VARIANTS) {
    const input = EMAIL_SAMPLE_INPUTS[v]
    assert.deepEqual(pickEmail(input, new Map(), SUPPORT), render(input), v)
  }
  // The built-in fallbacks in code are the old wording, not the proposals.
  const old: Record<string, string> = {
    ...APP_TEMPLATE_DEFAULTS, ...FU_NEW_DEFAULTS, ...FU_REUSED_DEFAULTS, ...PARENT_DEFAULTS,
    fu_fee_reply: FU_FEE_REPLY_DEFAULT, status_image_verified: STATUS_IMAGE_DEFAULT, applicants_forward: APPLICANTS_FORWARD_DEFAULT,
  }
  for (const [k, body] of Object.entries(old)) if (proposalFor(k)) assert.notEqual(body, proposalFor(k)!.body, `${k}: default is still the old wording`)
  // The migration writes no template and no wording.
  const sql = readFileSync('supabase/migrations/212_template_review.sql', 'utf8').toLowerCase()
  assert.doesNotMatch(sql, /(insert into|update)\s+public\.(admin_message_templates|email_wordings|template_reviews|template_history)/)
  // The send path picks the approved wording, else the built-in one.
  assert.match(readFileSync('lib/notify/index.ts', 'utf8'), /await renderEmail\(input\)/)
})

// ------------------------------------------------------------- approve / keep / restore

function seedDb() {
  const rows = WHATSAPP_PROPOSALS.map((p) => ({
    key: p.key,
    title: p.title,
    subject: p.title,
    body: LIVE_URDU[p.key] ? `Old ${p.key}\n\n${LIVE_URDU[p.key]}` : `Old wording of ${p.key}`,
  }))
  return fakeSupabase({ admin_message_templates: rows, profiles: [{ id: OWNER.id, full_name: 'alee sabeer' }] })
}

test('Approve puts the proposal live and keeps the old wording in history; Restore puts it back', async () => {
  const { client, tables } = seedDb()
  const live = () => tables.admin_message_templates.find((r) => r.key === 'pf_no_tuition')!.body
  assert.equal(live(), 'Old wording of pf_no_tuition')
  const res = await decideTemplate(OWNER, 'pf_no_tuition', 'approve', null, client)
  assert.deepEqual(res, { ok: true })
  assert.equal(live(), proposalFor('pf_no_tuition')!.body)
  assert.equal(tables.template_history.length, 1)
  assert.equal(tables.template_history[0].body, 'Old wording of pf_no_tuition')
  assert.equal(tables.template_history[0].action, 'approve')
  assert.equal(tables.template_reviews[0].status, 'approved')
  assert.equal(tables.template_reviews[0].decided_by_name, 'Alee Sabeer')
  // Restore.
  const back = await restoreTemplate(OWNER, tables.template_history[0].id as string, client)
  assert.deepEqual(back, { ok: true })
  assert.equal(live(), 'Old wording of pf_no_tuition')
  assert.equal(tables.template_history.length, 2, 'the replaced wording is kept again')
  assert.equal(tables.template_history[1].body, proposalFor('pf_no_tuition')!.body)
})

test('Keep current leaves the live wording as it is', async () => {
  const { client, tables } = seedDb()
  const res = await decideTemplate(OWNER, 'app_demo', 'keep', null, client)
  assert.deepEqual(res, { ok: true })
  assert.equal(tables.admin_message_templates.find((r) => r.key === 'app_demo')!.body, 'Old wording of app_demo')
  assert.equal(tables.template_reviews[0].status, 'kept')
  assert.equal((tables.template_history ?? []).length, 0)
})

test('Edit then approve: a wording that breaks the rules is refused; a good edit goes live, marked edited', async () => {
  const { client, tables } = seedDb()
  const p = proposalFor('pf_hired')!
  const bad = await decideTemplate(OWNER, 'pf_hired', 'approve', { body: p.body.replace('Thank you', 'Thank you 🙂 Open your dashboard') }, client)
  assert.equal(bad.ok, false)
  assert.ok(!bad.ok && (bad.problems ?? []).length > 0)
  assert.equal(tables.admin_message_templates.find((r) => r.key === 'pf_hired')!.body, 'Old wording of pf_hired')
  const good = p.body.replace('A short review helps other parents.', 'A short review helps other parents choose.')
  const ok = await decideTemplate(OWNER, 'pf_hired', 'approve', { body: good }, client)
  assert.deepEqual(ok, { ok: true })
  assert.equal(tables.admin_message_templates.find((r) => r.key === 'pf_hired')!.body, good)
  assert.equal(tables.template_reviews.find((r) => r.key === 'pf_hired')!.edited, true)
})

test('Urdu changed in an edit is refused', async () => {
  const { client } = seedDb()
  const p = proposalFor('no_whatsapp')!
  const res = await decideTemplate(OWNER, 'no_whatsapp', 'approve', { body: p.body.replace('شکریہ', 'شکریہ!') }, client)
  assert.equal(res.ok, false)
  assert.ok(!res.ok && (res.problems ?? []).some((x) => /Urdu/.test(x)))
})

test('Approving an email stores its wording; restoring goes back to the built-in email', async () => {
  const { client, tables } = seedDb()
  const res = await decideTemplate(OWNER, 'email:welcome_parent', 'approve', null, client)
  assert.deepEqual(res, { ok: true })
  assert.equal(tables.email_wordings.length, 1)
  assert.equal(tables.email_wordings[0].body, proposalFor('email:welcome_parent')!.body)
  assert.equal(tables.template_history[0].body, null, 'the built-in wording is recorded as null')
  const back = await restoreTemplate(OWNER, tables.template_history[0].id as string, client)
  assert.deepEqual(back, { ok: true })
  assert.equal(tables.email_wordings.length, 0)
})

test('Approve all approves every undecided template and leaves decided ones alone', async () => {
  const { client, tables } = seedDb()
  await decideTemplate(OWNER, 'app_demo', 'keep', null, client)
  const res = await approveAllPending(OWNER, client)
  assert.ok(res.ok)
  if (!res.ok) return
  assert.deepEqual(res.skipped, [])
  assert.equal(res.approved.length, ALL_PROPOSALS.length - 1)
  assert.equal(tables.admin_message_templates.find((r) => r.key === 'app_demo')!.body, 'Old wording of app_demo')
  assert.equal(tables.admin_message_templates.find((r) => r.key === 'fee_not_paid')!.body, proposalFor('fee_not_paid')!.body)
  assert.equal(tables.email_wordings.length, EMAIL_PROPOSALS.length)
})

test('only the Owner decides (route) and the page is owner-only', () => {
  const route = readFileSync('app/api/admin/templates/review/route.ts', 'utf8')
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.templateReview\)/)
  assert.match(route, /adminRole !== 'owner'/)
  assert.match(readFileSync('lib/adminAccessCore.ts', 'utf8'), /templateReview: \[\] as AdminRole\[\]/)
})
