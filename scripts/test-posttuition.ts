/**
 * scripts/test-posttuition.ts
 *
 *   npm run test:posttuition
 *
 * Two things this PR must not regress:
 *   1. the gender-preference APPLY rule (owner, 11 Sep 2026) — the pure core the
 *      apply endpoint enforces (lib/genderPref.ts), covering every case in the
 *      brief: a male tutor cannot apply to a female-preference job, a female can,
 *      an unset-gender tutor can apply to anything, and a no-preference job is
 *      unaffected;
 *   2. the ONE shared post-a-tuition form (components/forms/PostTuitionForm.tsx)
 *      renders the same shared fields for the parent and the admin variant, with
 *      only the parent-/admin-only extras differing — proven by server-rendering
 *      both variants and diffing the field labels.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

import {
  genderApplyBlocked,
  genderPrefSentence,
  normaliseGenderPref,
} from '../lib/genderPref'
import PostTuitionForm from '../components/forms/PostTuitionForm'

// ---------------------------------------------------- the apply gate rule ---

test('gender apply: a MALE tutor cannot apply to a FEMALE-preference job', () => {
  assert.equal(genderApplyBlocked('female', 'male'), true)
})

test('gender apply: a FEMALE tutor CAN apply to a female-preference job', () => {
  assert.equal(genderApplyBlocked('female', 'female'), false)
})

test('gender apply: a tutor with UNSET gender can apply to ANY job (no check)', () => {
  assert.equal(genderApplyBlocked('female', null), false)
  assert.equal(genderApplyBlocked('male', ''), false)
  assert.equal(genderApplyBlocked('trans', undefined), false)
})

test('gender apply: a NO-PREFERENCE job is unaffected — anyone may apply', () => {
  assert.equal(genderApplyBlocked(null, 'male'), false)
  assert.equal(genderApplyBlocked('', 'female'), false)
  assert.equal(genderApplyBlocked(undefined, null), false)
})

test('gender apply: trans preference matches only a trans tutor', () => {
  assert.equal(genderApplyBlocked('trans', 'male'), true)
  assert.equal(genderApplyBlocked('trans', 'trans'), false)
})

test('genderPrefSentence: the plain reason, or null for no preference', () => {
  assert.equal(genderPrefSentence('female'), 'Parent is looking for a female tutor.')
  assert.equal(genderPrefSentence('male'), 'Parent is looking for a male tutor.')
  assert.equal(genderPrefSentence(null), null)
  assert.equal(genderPrefSentence(''), null)
})

test('normaliseGenderPref: only male/female/trans survive; everything else is null', () => {
  assert.equal(normaliseGenderPref('Female'), 'female')
  assert.equal(normaliseGenderPref('  male '), 'male')
  assert.equal(normaliseGenderPref('other'), null)
  assert.equal(normaliseGenderPref(''), null)
  assert.equal(normaliseGenderPref(undefined), null)
})

// ------------------------------------------- one shared form, two variants ---

const noop = async () => ({ ok: true as const })

function renderParent(): string {
  return renderToStaticMarkup(
    createElement(PostTuitionForm, {
      children: [{ id: 'c1', name: 'Ayaan', class_level: 'Grade 6' }],
      submitLabel: 'Post this tuition',
      busyLabel: 'Saving…',
      useDraft: true,
      onSubmit: noop,
    }),
  )
}

function renderAdmin(): string {
  return renderToStaticMarkup(
    createElement(PostTuitionForm, {
      teamBanner: true,
      adminExtras: true,
      submitLabel: 'Post team tuition',
      busyLabel: 'Posting…',
      onSubmit: noop,
    }),
  )
}

// The fields both forms MUST render identically — the shared implementation.
const SHARED_LABELS = [
  'What do you need taught?',
  'Where, how and when',
  'Preferred tutor gender (optional)',
  'Your advert',
  'Write this for me',
  'Title',
  'Description',
]

test('shared form: both variants render every shared field', () => {
  const parent = renderParent()
  const admin = renderAdmin()
  for (const label of SHARED_LABELS) {
    assert.ok(parent.includes(label), `parent form missing shared field: ${label}`)
    assert.ok(admin.includes(label), `admin form missing shared field: ${label}`)
  }
  // The gender select offers the four options in both.
  for (const opt of ['No preference', 'Male', 'Female', 'Trans']) {
    assert.ok(parent.includes(opt), `parent gender option missing: ${opt}`)
    assert.ok(admin.includes(opt), `admin gender option missing: ${opt}`)
  }
})

test('shared form: the parent-only child selector is parent-only', () => {
  assert.ok(renderParent().includes('For which child?'))
  assert.ok(!renderAdmin().includes('For which child?'))
})

test('shared form: the admin-only extras are admin-only', () => {
  const admin = renderAdmin()
  const parent = renderParent()
  for (const label of [
    'Posted by TutorMint',
    'Origin (for the audit trail)',
    'Poster contact',
    // The four extra contact fields are admin-only too.
    'WhatsApp number',
    'Social handle',
  ]) {
    assert.ok(admin.includes(label), `admin form missing admin-only extra: ${label}`)
    assert.ok(!parent.includes(label), `parent form wrongly shows admin-only extra: ${label}`)
  }
})
