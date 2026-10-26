// npm run test:addresschip — the parent admin page's Home address chip (owner,
// 27 Oct 2026): Waiting for review / Approved / Rejected / Not provided. It
// used to read "Not provided" for an address entered and waiting. Invented data.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { addressChipLabel, parentAddressState, parentWaiting } from '../lib/parentDocsCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = { hasCnicFront: false, hasCnicBack: false }

test('an address entered and not yet decided reads Waiting for review', () => {
  for (const address_status of [null, 'pending', '', 'none']) {
    const f = { ...base, address: 'House 12, Street 4, Gulberg III', address_status, verification_state: 'none' }
    assert.equal(parentAddressState(f).status, 'pending', String(address_status))
    assert.equal(addressChipLabel(parentAddressState(f)), 'Waiting for review')
  }
  assert.deepEqual(parentWaiting({ ...base, address: 'House 12', address_status: null }), ['Address'])
})

test('approved, rejected and empty', () => {
  assert.equal(addressChipLabel(parentAddressState({ ...base, address: 'House 1', address_verified_at: '2026-10-01' })), 'Approved')
  const rej = parentAddressState({ ...base, address: 'House 1', address_status: 'rejected', address_reason: 'Incomplete.' })
  assert.equal(addressChipLabel(rej), 'Rejected')
  assert.equal(rej.reason, 'Incomplete.')
  assert.equal(addressChipLabel(parentAddressState({ ...base, address: '   ' })), 'Not provided')
  assert.equal(addressChipLabel(parentAddressState({ ...base, address: null })), 'Not provided')
})

test('the review card uses the address chip label', () => {
  const src = readFileSync(join(ROOT, 'components/admin/ParentDocumentReview.tsx'), 'utf8')
  assert.match(src, /item === 'address' \? \{ \.\.\.STATUS_LABEL\[status\], text: addressChipLabel\(state\) \}/)
})
