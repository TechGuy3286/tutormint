// scripts/test-reset-approved.ts — "Reset to default" restores the approved
// wording (owner, 28 Oct 2026).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { approvedWording, resetBody } from '../lib/templateResetCore'

const decidedAt = '2026-10-28T10:00:00Z'

test('not reviewed, or kept → the built-in default', () => {
  assert.equal(approvedWording({ review: null, proposalBody: 'P', history: [], currentBody: 'C' }), null)
  assert.equal(approvedWording({ review: { status: 'kept', edited: false, decidedAt }, proposalBody: 'P', history: [], currentBody: 'C' }), null)
  assert.equal(resetBody(null, 'Old default'), 'Old default')
})

test('approved as proposed → the proposal', () => {
  const body = approvedWording({ review: { status: 'approved', edited: false, decidedAt }, proposalBody: 'Hi {first_name}\r\nNew\n', history: [], currentBody: 'Later edit' })
  assert.equal(body, 'Hi {first_name}\nNew')
  assert.equal(resetBody(body, 'Old default'), 'Hi {first_name}\nNew')
})

test('approved after an edit → the wording that went live at approval', () => {
  const review = { status: 'approved' as const, edited: true, decidedAt }
  // Nothing changed since: today's live body is the approved one.
  assert.equal(approvedWording({ review, proposalBody: 'P', history: [], currentBody: 'Edited approved' }), 'Edited approved')
  // Two later edits: the first one kept the approved wording it replaced.
  const history = [
    { action: 'approve', body: 'Before approval', savedAt: '2026-10-28T09:59:59Z' },
    { action: 'edit', body: 'Second change replaced this', savedAt: '2026-10-28T12:00:00Z' },
    { action: 'edit', body: 'Edited approved', savedAt: '2026-10-28T11:00:00Z' },
  ]
  assert.equal(approvedWording({ review, proposalBody: 'P', history, currentBody: 'Latest' }), 'Edited approved')
})

test('the route and the editor use it; Restore from history is untouched', () => {
  const route = readFileSync('app/api/admin/inbox/route.ts', 'utf8')
  assert.match(route, /resetBody\(\(await approvedTemplateBodies\(\)\)\.get\(t\.key\) \?\? null, templateDefault\(t\.key\)\)/)
  assert.match(readFileSync('app/admin/inbox/ApplicationTemplates.tsx', 'utf8'), /template\.resetBody \?\? info\.defaultBody/)
  assert.match(readFileSync('lib/templateReview.ts', 'utf8'), /export async function restoreTemplate\(/)
})
