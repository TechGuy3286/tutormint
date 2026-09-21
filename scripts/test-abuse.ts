// scripts/test-abuse.ts — npm run test:abuse
//
// The abuse matcher (PR40 §2): English + Roman Urdu obscenities flag, including
// leetspeak, spacing and censoring; and — the check that matters most — ordinary
// clean messages never flag (a false positive suspends an innocent tutor).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { detectAbuse, isAbusive } from '../lib/abuse/filter'

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
