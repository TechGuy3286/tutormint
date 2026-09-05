/**
 * scripts/test-messaging.ts
 *
 *   npm run test:messaging
 *
 * The security-critical rules of Messaging part 2, unit-tested against
 * lib/messagingRules.ts (pure — no DB, no server-only). The end-to-end wiring
 * (routes, RLS, Realtime) is proven by the live smoke; these pin the decisions
 * that must never regress:
 *   1. a message "deleted for me" is invisible to that reader, and only them;
 *   2. a photo attachment is served only to a participant of its thread;
 *   3. the paperclip is enabled only for a member who may see contact details.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  messageVisibleTo,
  isThreadParticipant,
  mayAttachPhoto,
  isAllowedAttachment,
  sanitizeQuickReplies,
  previewText,
  MAX_QUICK_REPLIES,
  ATTACHMENT_MAX_BYTES,
} from '../lib/messagingRules'

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

// ---- deleted-for-me --------------------------------------------------------

test('a message deleted for me is invisible to me and no one else', () => {
  const msg = { deletedFor: [A] }
  assert.equal(messageVisibleTo(msg, A), false) // the deleter cannot see it
  assert.equal(messageVisibleTo(msg, B), true) // the other participant still can
})

test('a message deleted by nobody is visible to everyone', () => {
  assert.equal(messageVisibleTo({ deletedFor: [] }, A), true)
  assert.equal(messageVisibleTo({ deletedFor: null }, A), true)
  assert.equal(messageVisibleTo({}, A), true)
})

// ---- participant-only media ------------------------------------------------

test('only a participant of a thread may view its attachment', () => {
  const thread = { participant_a: A, participant_b: B }
  assert.equal(isThreadParticipant(thread, A), true)
  assert.equal(isThreadParticipant(thread, B), true)
  assert.equal(isThreadParticipant(thread, C), false) // a stranger to the thread
})

// ---- attachment gate -------------------------------------------------------

test('the paperclip follows contact rights — the same check, no new rule', () => {
  assert.equal(mayAttachPhoto({ canViewContact: true }), true)
  assert.equal(mayAttachPhoto({ canViewContact: false }), false)
})

test('attachments are JPG/PNG up to 5 MB', () => {
  assert.equal(isAllowedAttachment('image/jpeg', 1024), true)
  assert.equal(isAllowedAttachment('image/png', ATTACHMENT_MAX_BYTES), true)
  assert.equal(isAllowedAttachment('image/png', ATTACHMENT_MAX_BYTES + 1), false) // too big
  assert.equal(isAllowedAttachment('image/gif', 1024), false) // wrong type
  assert.equal(isAllowedAttachment('application/pdf', 1024), false)
  assert.equal(isAllowedAttachment('image/jpeg', 0), false) // empty
})

// ---- quick replies ---------------------------------------------------------

test('quick replies are trimmed, de-blanked and capped at six', () => {
  const cleaned = sanitizeQuickReplies([
    '  Hello  ',
    '',
    '   ',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six — dropped past the cap',
  ])
  assert.equal(cleaned.length, MAX_QUICK_REPLIES)
  assert.equal(cleaned[0], 'Hello')
  assert.ok(!cleaned.includes(''))
})

test('quick replies reject non-strings', () => {
  assert.deepEqual(sanitizeQuickReplies([1, null, {}, 'ok'] as unknown), ['ok'])
  assert.deepEqual(sanitizeQuickReplies('not an array' as unknown), [])
})

// ---- list preview ----------------------------------------------------------

test('a bare attachment previews as "Photo"; a caption wins', () => {
  assert.equal(previewText('', true), 'Photo')
  assert.equal(previewText('   ', true), 'Photo')
  assert.equal(previewText('see this', true), 'see this')
  assert.equal(previewText('hello', false), 'hello')
  assert.equal(previewText('', false), '')
})
