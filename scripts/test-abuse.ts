// scripts/test-abuse.ts — npm run test:abuse
//
// The abuse matcher (PR40 §2): English + Roman Urdu obscenities flag, including
// leetspeak, spacing and censoring; and — the check that matters most — ordinary
// clean messages never flag (a false positive suspends an innocent tutor).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { detectAbuse, isAbusive } from '../lib/abuse/filter'
import { abuseWarning, flagStageLabel, WITHHELD_MESSAGE_LINE } from '../lib/abuse/warnings'

test('flags English obscenities, incl. leet / spacing / censoring / repeats', () => {
  for (const t of [
    'fuck you', 'f u c k off', 'f.u.c.k', 'f*ck this', 'fuuuck', 'FUCK',
    'you are a bitch', 'b1tch', 'asshole', 'what a dickhead', 'sh1t', 'send me nudes', 'you look sexy',
  ]) {
    assert.ok(isAbusive(t), `should flag: "${t}"`)
  }
})

test('flags Roman Urdu obscenities and slurs', () => {
  for (const t of [
    'gandu', 'tum harami ho', 'kutti', 'ch0d', 'chutiya', 'madarchod', 'bhenchod',
    'g@ndu', 'g a n d u', 'lauda', 'randi', 'tharki', 'bhosdike', 'chodu',
  ]) {
    assert.ok(isAbusive(t), `should flag: "${t}"`)
  }
})

test('returns the matched term(s) for the flag record', () => {
  assert.deepEqual(detectAbuse('you are a gandu'), ['gandu'])
  assert.ok(detectAbuse('fuck you harami').sort().join(',') === 'fuck,harami')
})

test('does NOT flag ordinary clean messages (false-positive guard)', () => {
  for (const t of [
    'Are you available for tuition in my area?',
    'What is your monthly fee for this level?',
    'Can we arrange a demo class?',
    'My budget is 15000-20000 per month',
    'I teach Mathematics, Physics and grass-roots science',
    'Please share your address so I can plan the class',
    'I passed my O Level exams, need help with assignments',
    'Assalam o Alaikum, I am available on weekends',
    'Mahatma Gandhi lived near Uganda',
    'This requires careful analysis of the passage',
    'Class 10 science, chapter on light and sound',
    'Thank you so much, see you at 5 pm',
    'Main Lahore mein hoon, aap kahan se ho?',
  ]) {
    assert.deepEqual(detectAbuse(t), [], `must NOT flag: "${t}"`)
  }
})

// The exact phrasings exercised by hand in the PR41 production verification.
test('flags the by-hand PR41 phrasings', () => {
  assert.deepEqual(detectAbuse('oye gandu kahan ho'), ['gandu'])
  assert.deepEqual(detectAbuse('tum harami insaan ho'), ['harami'])
  assert.deepEqual(detectAbuse('kutti send nudes').sort(), ['kutti', 'nudes'])
})

// The escalating warning (PR41 §3): warning 1, warning 2, then the suspension.
test('escalating warning copy: 1 → 2 → suspension', () => {
  const w1 = abuseWarning(1, false)
  assert.equal(w1.suspended, false)
  assert.match(w1.text, /was not sent/i)
  assert.match(w1.text, /can be suspended/i)

  const w2 = abuseWarning(2, false)
  assert.equal(w2.suspended, false)
  assert.match(w2.text, /second time/i)
  assert.match(w2.text, /will be suspended/i)

  const w3 = abuseWarning(3, true)
  assert.equal(w3.suspended, true)
  assert.match(w3.text, /suspended/i)
  // The appeal route is in the suspension line.
  assert.match(w3.text, /0321 5872222/)
  assert.match(w3.text, /support@tutormint\.org/)

  // A flag beyond the third still reads as the suspension, not "Warning 4".
  assert.equal(abuseWarning(4, false).suspended, true)
})

test('flag stage label maps the warning number', () => {
  assert.equal(flagStageLabel(1), 'Warning 1')
  assert.equal(flagStageLabel(2), 'Warning 2')
  assert.equal(flagStageLabel(3), 'Suspension')
  assert.equal(flagStageLabel(4), 'Suspension')
  assert.equal(flagStageLabel(null), 'Flag')
})

test('the withheld message line never echoes the matched word', () => {
  // It is a fixed line — no interpolation of user content.
  assert.equal(WITHHELD_MESSAGE_LINE, 'Not sent — this message breaks our rules.')
})
