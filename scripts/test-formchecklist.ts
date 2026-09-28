/**
 * scripts/test-formchecklist.ts   (npm run test:formchecklist)
 *
 * The shared self-explaining-form logic (lib/formChecklist, PR80): the Save gate
 * opens only when every REQUIRED part is done, optional parts never gate, and the
 * "what's missing" line names the first incomplete required part.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checklistReady, firstMissing, type ChecklistItem } from '../lib/formChecklist'

const it = (en: string, done: boolean, optional = false): ChecklistItem => ({ en, ur: en, done, optional })

test('ready only when every required part is done', () => {
  assert.equal(checklistReady([it('a', true), it('b', true)]), true)
  assert.equal(checklistReady([it('a', true), it('b', false)]), false)
})

test('optional parts never gate the button', () => {
  assert.equal(checklistReady([it('a', true), it('b', false, true)]), true)
  assert.equal(checklistReady([it('a', false), it('b', true, true)]), false)
})

test('firstMissing names the first incomplete REQUIRED part, skipping optional', () => {
  assert.equal(firstMissing([it('a', true), it('b', false, true), it('c', false)])?.en, 'c')
  assert.equal(firstMissing([it('a', true), it('b', true)]), null)
  // An incomplete optional part is never "missing".
  assert.equal(firstMissing([it('a', true), it('opt', false, true)]), null)
})
