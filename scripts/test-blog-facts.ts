// scripts/test-blog-facts.ts — the TutorMint facts sheet, the smarter blog
// checker, the fixer and the self-check loop (owner, 7 Oct 2026).
//
// The regression sentences are copied EXACTLY from the published post
// /blog/how-to-become-a-home-tutor-in-pakistan-a-step-by-step-start, which went
// live saying the Verified badge needs a degree and an intro video.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildPlatformFacts, factsSheetText, DEFAULT_PLANS } from '../lib/ai/factsSheet'
import {
  contradictionViolations,
  priceViolations,
  ctaViolation,
  seoFieldViolations,
  noindexLinkViolations,
  isGenericLinkText,
  linkRuleViolations,
} from '../lib/ai/platformFacts'
import { collectBlogProblems, sanitizeDraft } from '../lib/ai/blogChecker'
import { applyPassageEdits } from '../lib/ai/passageEdits'
import { selfCorrect, selfCheckLabel } from '../lib/ai/selfCheck'

const facts = buildPlatformFacts(DEFAULT_PLANS)

// ── item 1: the facts sheet ──────────────────────────────────────────────────

test('the facts sheet states the owner’s facts, built from the plan rows', () => {
  const t = factsSheetText(facts)
  assert.ok(t.includes('Signing up is free'))
  assert.ok(t.includes('mobile number is verified and their city, area, subjects and gender are set'))
  assert.ok(t.includes('“Spam Free Platform Fee”') || t.includes('"Spam Free Platform Fee"'))
  assert.ok(/Never write any amount or price/.test(t))
  assert.ok(/Verified badge comes from the Spam Free Platform Fee plus submitting a CNIC, a profile photo and a selfie/.test(t))
  assert.ok(/degree, certificates and an introduction video are OPTIONAL/.test(t))
  assert.ok(t.includes('Tutor plans: Featured, Premium and Basic'))
  assert.ok(t.includes('Search order: Featured, then Premium, then Verified, then everyone else.'))
  assert.ok(/Parents verify their CNIC and address \(free\) before they can post a tuition, message a tutor or request a demo/.test(t))
  assert.ok(/takes no commission/.test(t) && /never promises tuitions, replies, applications, hires or income/.test(t))
  assert.ok(!/\bRs\b|PKR|\b(199|499|999)\b/.test(t), 'the sheet itself carries no price')
  // The allowances come from the plans page settings (owner, 7 Oct 2026).
  assert.ok(t.includes('applications — Featured unlimited, Premium 100, Basic 10'))
  assert.ok(t.includes("Seeing a parent's phone number and email — Featured unlimited, Premium 100, Basic 10"))
  assert.ok(t.includes('every verified tutor, Basic included, can message parents in the app'))
  assert.ok(t.includes('- Parent plans:'))
})

test('the sheet follows the live plan settings (who can start a conversation)', () => {
  // Today every fee-paid plan may start one.
  assert.ok(factsSheetText(facts).includes('every verified tutor, Basic included, can message parents in the app'))
  // If Basic loses that right, the sheet says so.
  const restricted = buildPlatformFacts(DEFAULT_PLANS.map((p) => (p.code === 'basic' ? { ...p, canInitiateMessage: false } : p)))
  assert.ok(factsSheetText(restricted).includes('Who can start a conversation with a parent: Featured and Premium tutors only'))
})

// ── item 4: the three regression cases, verbatim ─────────────────────────────

const BADGE_SENTENCE =
  'You can create a profile without one, but the Verified badge requires a reviewed degree certificate on file, along with your identity document and an introduction video the team looks at.'
const MESSAGING_SENTENCE = 'Only Premium and Featured tutors can start a conversation with a parent.'

test('regression: the degree + intro video badge sentence is flagged and quoted', () => {
  const v = contradictionViolations(BADGE_SENTENCE, facts)
  assert.equal(v.length, 1)
  assert.equal(v[0].kind, 'badge_rule')
  assert.ok(v[0].line.includes('the Verified badge requires a reviewed degree certificate'))
  // The second wrong badge sentence in the same post.
  const v2 = contradictionViolations(
    'Completing your one-time verification adds the Verified badge next to your name, which includes your reviewed degree certificate, and it’s what lets you reply to parents and apply to tuitions directly, such as the open tuitions posted for various grades.',
    facts,
  )
  assert.equal(v2[0]?.kind, 'badge_rule')
})

test('regression: “Only Premium and Featured tutors can start a conversation” is NOT flagged', () => {
  assert.deepEqual(contradictionViolations(MESSAGING_SENTENCE, facts), [])
  // Nor when Basic really cannot start one.
  const restricted = buildPlatformFacts(DEFAULT_PLANS.map((p) => (p.code === 'basic' ? { ...p, canInitiateMessage: false } : p)))
  assert.deepEqual(contradictionViolations(MESSAGING_SENTENCE, restricted), [])
  // An OVER-claim is flagged when the live plan lacks the right.
  assert.ok(contradictionViolations('Basic tutors can start a conversation with any parent.', restricted).length > 0)
})

test('regression: “one-time verification fee” is flagged with the suggested name', () => {
  const v = contradictionViolations('You pay a one-time verification fee to apply.', facts)
  assert.equal(v[0]?.kind, 'fee_name')
  assert.equal(v[0]?.suggestion, 'You pay a one-time Spam Free Platform Fee to apply.')
  const p = collectBlogProblems('You pay a one-time verification fee to apply.', { publishedPostSlugs: [], landingPaths: [], facts })
  assert.ok(p.some((x) => x.message.includes('Suggested: “You pay a one-time Spam Free Platform Fee to apply.”')))
})

test('correct statements from the published post are never flagged', () => {
  for (const s of [
    'To get verified, you submit your CNIC, a profile photo and a selfie, which the team checks.',
    'Adding your degree and a short introduction video is optional, but both help parents trust you before they get in touch.',
    'A verified tutor on the Basic plan can reply to any parent who messages first.',
    'From there, most tutors choose to pay the one-time Spam Free Platform Fee.',
    'That’s visibility, not a guarantee — TutorMint doesn’t promise replies, applications or hires.',
    'Yes — Premium and Featured tutors rank above others, and verified tutors rank above unverified ones.',
    'Keep in mind that the subjects and grades you list are self-declared — TutorMint doesn’t check them.',
    'Signing up is free, and parents can browse tutors without an account.',
    'TutorMint takes no commission on what you charge.',
    'Payments are non-refundable.',
    // From the live Terms and Support pages (7 Oct 2026) — correct, never flagged.
    'We do not set fees, supervise lessons, guarantee results, or take a commission on anything you earn or pay.',
    'Do you take a commission on my earnings or my fees?',
    'Are memberships refundable?',
    'Browsing tutors and tuitions is completely free and always will be, with no account needed.',
    'Every verified tutor can message parents in the app.',
  ]) {
    assert.deepEqual(contradictionViolations(s, facts), [], s)
  }
})

test('other contradictions are flagged: refunds, commission, promises, parents, unverified tutors', () => {
  for (const s of [
    'If it does not work out you can get a full refund.',
    'TutorMint takes a commission on every tuition.',
    'Join today and we guarantee you students within a week.',
    'Parents can post a tuition without verifying anything.',
    'Unverified tutors can still reply to parents.',
    'TutorMint is completely free for tutors.',
  ]) {
    assert.ok(contradictionViolations(s, facts).length > 0, s)
  }
})

// ── item 4: link text, CTA, prices, SEO fields, noindex links ───────────────

test('descriptive link text is accepted; only generic text is flagged', () => {
  for (const t of ['open tuitions for Grade 3 Mathematics in Karachi', 'open Grade 3 Mathematics tuitions in Karachi', 'Tuition jobs in Karachi']) {
    assert.equal(isGenericLinkText(t), false, t)
  }
  for (const t of ['click here', 'this page', 'a related guide', 'Read more.']) assert.equal(isGenericLinkText(t), true, t)
  const body = [
    'See [open tuitions for Grade 3 Mathematics in Karachi](/tuitions/karachi/grade-3-mathematics).',
    'Also [Tuition jobs in Karachi](/tuition-jobs/karachi) and [a related guide](/blog/x).',
  ].join('\n')
  const v = linkRuleViolations(body, { hasPublishedPosts: true, hasLandingPages: true })
  assert.deepEqual(v.filter((s) => /descriptive/.test(s)).length, 1)
  assert.ok(v.some((s) => s.includes('a related guide')))
})

test('a closing call to action without a link is flagged; the fixer links it by audience', () => {
  const body = '## Start\n\nSome advice.\n\nReady to put your profile in front of parents? Create your listing and start browsing open tuitions today.'
  const v = ctaViolation(body, 'tutors')
  assert.ok(v && v.path === '/apply')
  assert.equal(ctaViolation(body + ' [Create your profile](/apply).', 'tutors'), null)
  const fixed = sanitizeDraft(body, { blogSlugs: ['other-post'], audience: 'tutors', landingPaths: ['/tuitions/karachi/grade-3-mathematics'] })
  assert.equal(ctaViolation(fixed, 'tutors'), null)
  assert.ok(fixed.includes('](/apply)'))
  assert.ok(sanitizeDraft(body, { blogSlugs: [], audience: 'parents' }).includes('](/browse/tutors)'))
  assert.ok(sanitizeDraft(body, { blogSlugs: [], audience: 'both' }).includes('](/browse/tuitions)'))
})

test('any price or Rs amount is flagged', () => {
  for (const s of ['Fees start at Rs 8,000 a month.', 'It costs PKR 199 once.', 'Expect 15000 rupees.', '| Grade 1 | Rs. 5000 |']) {
    assert.equal(priceViolations(s).length, 1, s)
  }
  assert.deepEqual(priceViolations('Grade 9 and 10 students sit board exams in 2026.'), [])
})

test('SEO fields: length, the tagline, and a contradicting meta description', () => {
  const tagline = seoFieldViolations({ title: 'How to become a home tutor', description: 'Learn how to start tutoring. No fee, no commission, no middleman' }, facts)
  assert.ok(tagline.some((s) => s.field === 'seoDescription' && /tagline/.test(s.message)))
  // The CURRENT tagline (owner, 8 Oct 2026) is true and allowed.
  const current = seoFieldViolations({ title: 'How to become a home tutor', description: 'Learn how to start tutoring. Free to join. No commission. No middleman.' }, facts)
  assert.deepEqual(current, [])
  const long = seoFieldViolations({ title: 'x'.repeat(61), description: 'y '.repeat(80) }, facts)
  assert.ok(long.some((s) => s.field === 'seoTitle' && /61 characters/.test(s.message)))
  assert.ok(long.some((s) => s.field === 'seoDescription' && /characters/.test(s.message)))
  const contra = seoFieldViolations({ title: 'Ok', description: 'Get the Verified badge by uploading your degree and an intro video.' }, facts)
  assert.ok(contra.some((s) => /contradicts/.test(s.message)))
  assert.deepEqual(seoFieldViolations({ title: 'Become a home tutor in Pakistan', description: 'How to set up your TutorMint profile, set a fair fee and find your first tuitions.' }, facts), [])
})

test('a link to a noindex page is flagged with the city page instead, and the fixer swaps it', () => {
  const noindex = { '/tuitions/karachi/grade-5-urdu': '/tuition-jobs/karachi' }
  const body = 'Look at [open Grade 5 Urdu tuitions in Karachi](/tuitions/karachi/grade-5-urdu).'
  assert.deepEqual(noindexLinkViolations(body, noindex), [{ href: '/tuitions/karachi/grade-5-urdu', instead: '/tuition-jobs/karachi' }])
  const p = collectBlogProblems(body, { publishedPostSlugs: [], landingPaths: [], noindexLinks: noindex, cityJobPaths: ['/tuition-jobs/karachi'] })
  assert.ok(p.some((x) => x.kind === 'noindex_link' && x.message.includes('/tuition-jobs/karachi')))
  assert.ok(!p.some((x) => x.kind === 'dead_link'), 'a noindex page is not reported as missing')
  const fixed = sanitizeDraft(body, { blogSlugs: [], audience: 'both', noindexLinks: noindex, cityJobPaths: ['/tuition-jobs/karachi'] })
  assert.ok(fixed.includes('](/tuition-jobs/karachi)'))
})

test('the fixer never adds “a related guide” — an added post link uses the post title', () => {
  const fixed = sanitizeDraft('Plain text only.', {
    blogSlugs: ['o-and-a-level-october-november-exam-prep-2026'],
    blogTitles: { 'o-and-a-level-october-november-exam-prep-2026': 'O and A Level October–November exam prep, 2026' },
    audience: 'both',
  })
  assert.ok(!fixed.includes('a related guide'))
  assert.ok(fixed.includes('[O and A Level October–November exam prep, 2026](/blog/o-and-a-level-october-november-exam-prep-2026)'))
})

// ── items 3 + 5: passage edits and the self-check loop ───────────────────────

test('applyPassageEdits replaces only the flagged passage', () => {
  const post = { body: 'One. Two is wrong. Three.', seoTitle: 'T', seoDescription: 'D' }
  const out = applyPassageEdits(post, [{ field: 'body', before: 'Two is wrong.', after: 'Two is right.' }])
  assert.equal(out.body, 'One. Two is right. Three.')
  assert.equal(out.seoTitle, 'T')
  const out2 = applyPassageEdits(post, [{ field: 'seoDescription', before: 'D', after: 'New description.' }])
  assert.equal(out2.seoDescription, 'New description.')
  assert.equal(out2.body, post.body)
})

test('selfCorrect: up to 2 rounds, recorded; 0 rounds when the first check is clean', async () => {
  const check = (d: { body: string }) =>
    contradictionViolations(d.body, facts).map((v) => ({ message: v.why, heading: null, blocking: true as const, kind: v.kind, match: v.match }))
  // Clean draft → no rounds.
  const clean = await selfCorrect({ body: 'Signing up is free.', seoTitle: '', seoDescription: '' }, { check, fix: async () => [] })
  assert.equal(clean.record.rounds, 0)
  assert.equal(selfCheckLabel(clean.record), 'Self-checked: 0 rounds, 0 issues left')
  // A fixer that corrects the passage → 1 round, 0 left.
  const one = await selfCorrect(
    { body: 'You pay a one-time verification fee.', seoTitle: '', seoDescription: '' },
    { check, fix: async (_d, ps) => ps.map((p) => ({ field: 'body' as const, before: p.match!, after: 'You pay the one-time Spam Free Platform Fee.' })) },
  )
  assert.equal(one.record.rounds, 1)
  assert.equal(one.record.issuesLeft, 0)
  // A fixer that never manages it → stops after 2 rounds, issue reported.
  let calls = 0
  const stuck = await selfCorrect(
    { body: 'You pay a one-time verification fee.', seoTitle: '', seoDescription: '' },
    {
      check,
      fix: async (d) => {
        calls++
        return [{ field: 'body' as const, before: d.body, after: d.body.replace('fee.', 'fee!') }]
      },
    },
  )
  assert.equal(calls, 2)
  assert.equal(stuck.record.rounds, 2)
  assert.equal(stuck.record.issuesLeft, 1)
  assert.equal(selfCheckLabel(stuck.record), 'Self-checked: 2 rounds, 1 issue left')
})
