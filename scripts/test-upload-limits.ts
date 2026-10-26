// npm run test:uploadlimits — message photos, admin ad images and refund
// screenshots: shrunk in the browser, a 4 MB limit with a clear message on the
// client and the server, never a bare "did not upload" (owner, 27 Oct 2026).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { UPLOAD_MAX_BYTES, tooLargeMessage, uploadErrorMessage, uploadFileProblem, prepareUploadImage } from '../lib/uploadLimitCore'
import { ATTACHMENT_MAX_BYTES } from '../lib/messagingRules'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

test('4 MB, under Vercel’s ~4.5 MB body cap; messages use the same', () => {
  assert.equal(UPLOAD_MAX_BYTES, 4 * 1024 * 1024)
  assert.ok(UPLOAD_MAX_BYTES < 4.5 * 1024 * 1024)
  assert.equal(ATTACHMENT_MAX_BYTES, UPLOAD_MAX_BYTES)
})

test('the size check and its words', () => {
  assert.equal(uploadFileProblem({ size: UPLOAD_MAX_BYTES }, 'photo'), null)
  assert.equal(uploadFileProblem({ size: UPLOAD_MAX_BYTES + 1 }, 'photo'), 'That photo is larger than 4 MB. Please choose a smaller one.')
  assert.equal(uploadFileProblem(null, 'screenshot'), 'Choose a screenshot first.')
  assert.equal(tooLargeMessage('image'), 'That image is larger than 4 MB. Please choose a smaller one.')
})

test('a failed upload always says why', () => {
  assert.equal(uploadErrorMessage({ status: 413 }, 'photo'), tooLargeMessage('photo'))
  assert.equal(uploadErrorMessage({ status: 400, error: 'Send a JPG or PNG photo.' }, 'photo'), 'Send a JPG or PNG photo.')
  assert.match(uploadErrorMessage({ network: true }, 'image'), /connection dropped/)
  assert.match(uploadErrorMessage({ status: 502 }, 'screenshot'), /problem on our side/)
  for (const m of [uploadErrorMessage({}, 'photo'), uploadErrorMessage({ status: 500 }, 'photo')]) {
    assert.notEqual(m.trim().toLowerCase(), 'did not upload')
    assert.ok(m.length > 'did not upload'.length + 10, m)
  }
})

test('a big photo is shrunk; a non-image is sent as it is', async () => {
  const big = new File([new Uint8Array(6 * 1024 * 1024)], 'p.jpg', { type: 'image/jpeg' })
  const small = new File([new Uint8Array(900 * 1024)], 'p.jpg', { type: 'image/jpeg' })
  const out = await prepareUploadImage(big, async () => small)
  assert.equal(out.size, small.size)
  const pdf = new File([new Uint8Array(10)], 'r.pdf', { type: 'application/pdf' })
  assert.equal(await prepareUploadImage(pdf, async () => small), pdf)
})

test('all three paths shrink in the browser, check 4 MB, and answer 413 on the server', () => {
  for (const p of ['components/messages/Conversation.tsx', 'app/admin/ads/AdsClient.tsx', 'app/admin/payments/RefundControl.tsx']) {
    const s = read(p)
    assert.match(s, /prepareUploadImage\(/, p)
    assert.match(s, /uploadFileProblem\(/, p)
    assert.match(s, /uploadErrorMessage\(/, p)
  }
  for (const p of ['app/api/messages/media/route.ts', 'app/api/admin/ads/route.ts', 'app/api/admin/payments/refund/route.ts']) {
    const s = read(p)
    assert.match(s, /tooLargeMessage\(/, p)
    assert.match(s, /status: 413/, p)
    assert.doesNotMatch(s, /5 \* 1024 \* 1024/, p)
  }
  assert.doesNotMatch(read('app/api/admin/payments/refund/route.ts'), /if \(!error\) proofPath = path/)
})
