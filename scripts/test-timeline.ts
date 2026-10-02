import { test } from 'node:test'
import assert from 'node:assert/strict'

import { timelineSentence, collapseTimeline } from '../lib/timelineText'

// PR100 §3 — every timeline line is a plain English sentence (no key:value, no
// codes, no JSON), and a run of subject edits collapses into one line.

test('timelineSentence: the owner’s raw examples become plain English', () => {
  assert.equal(timelineSentence('search_performed', { city: 'Lahore', results: 76, surface: 'tuitions' }), 'Searched tuitions in Lahore — 76 results')
  assert.equal(timelineSentence('verification_decision_received', { reason: 'verified', attempts: 0, decision: 'approve' }), 'Identity approved by staff')
  assert.equal(timelineSentence('verification_decision_received', { item: 'cnic', decision: 'approve' }), 'CNIC approved by staff')
  assert.equal(timelineSentence('login', { via: 'mobile' }), 'Signed in with their mobile number')
  assert.equal(timelineSentence('registered', { role: 'tutor' }), 'Registered as a tutor')
  assert.equal(timelineSentence('registered', { role: 'parent' }), 'Registered as a parent')
})

test('timelineSentence: no raw key/value, code or JSON for any event', () => {
  const events = [
    'registered','email_confirmed','login','otp_verified','profile_updated','completion_changed',
    'subjects_changed','document_uploaded','video_submitted','verification_submitted',
    'verification_decision_received','video_visibility_changed','job_posted','job_edited','job_closed',
    'application_submitted','application_withdrawn','demo_requested','demo_accepted','demo_declined',
    'demo_completed','message_sent','shortlist_added','shortlist_removed','saved_job_added',
    'saved_job_removed','profile_viewed','search_performed','payment_submitted','payment_rejected',
    'payment_approved','verification_fee_paid','plan_purchased','plan_granted','plan_revoked',
    'plan_expiring','plan_expired','blocked','blocked_by','unblocked','reported','reported_by',
    'report_resolved','warned','suspended','unsuspended','banned','unbanned','staff_created',
    'staff_role_changed','staff_removed','staff_suspended','staff_reactivated','admin_message_received',
    'seeded_contact_messaged','password_changed','terms_accepted','profile_claimed','imported','cv_downloaded',
    'some_future_event',
  ]
  for (const e of events) {
    const s = timelineSentence(e, { foo: 'bar', n: 3, obj: { a: 1 } })
    assert.doesNotMatch(s, /:\s|[{}\[\]]|foo|bar/, `"${e}" rendered raw: ${s}`)
    assert.ok(s.length > 0 && /^[A-Z]/.test(s), `"${e}" not a sentence: ${s}`)
  }
})

test('timelineSentence: subjects added/removed with total', () => {
  assert.equal(
    timelineSentence('subjects_changed', { added: ['Physics', 'Chemistry'], removed: ['Urdu'], total: 53 }),
    'Changed subjects: added Physics, Chemistry · removed Urdu (now 53 subjects)',
  )
  assert.equal(timelineSentence('subjects_changed', { count: 53 }), 'Updated their subjects (now 53 subjects)')
})

test('collapseTimeline: 53 consecutive count-only edits within 10 min → one line', () => {
  const base = Date.parse('2026-09-26T10:00:00Z')
  const rows = Array.from({ length: 53 }, (_, i) => ({
    id: `r${i}`,
    event: 'subjects_changed',
    meta: { count: 53 - i },
    at: new Date(base - i * 5000).toISOString(), // 5s apart, newest first
  }))
  const out = collapseTimeline(rows)
  assert.equal(out.length, 1, 'all 53 collapse to one row')
  const s = timelineSentence(out[0].event, out[0].meta)
  assert.match(s, /^Changed subjects 53 times on 26 Sep/) // "Sep"/"Sept" per ICU
  assert.match(s, /ended with 53 subjects/)
})

test('collapseTimeline: a >10-min gap breaks the run; other events are untouched', () => {
  const t = (iso: string) => Date.parse(iso)
  const rows = [
    { id: 'a', event: 'subjects_changed', meta: { total: 10, added: ['Maths'] }, at: new Date(t('2026-09-26T10:20:00Z')).toISOString() },
    { id: 'b', event: 'subjects_changed', meta: { total: 9 }, at: new Date(t('2026-09-26T10:00:00Z')).toISOString() }, // 20 min earlier
    { id: 'c', event: 'login', meta: { via: 'email' }, at: new Date(t('2026-09-26T09:50:00Z')).toISOString() },
  ]
  const out = collapseTimeline(rows)
  assert.equal(out.length, 3, 'the 20-min gap keeps the two subject edits separate')
  assert.equal(out[2].event, 'login')
})
