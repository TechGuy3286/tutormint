/**
 * scripts/test-sendpk.ts
 *
 *   npm run test:sendpk
 *
 * Pure parser tests for the SendPK adapter (lib/sms/sendpk.ts), against the
 * VERBATIM response bodies observed by scripts/sendpk-probe.ts on the live
 * account. No network — the end-to-end send is proven only against the live
 * account with a real key. These pin the classification that must never regress:
 * the ONLY success is success==="true" AND results[0].status==="OK"; every other
 * body is a failure carrying the provider's own text, whatever code it holds.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseSendpkResponse,
  otpDigits,
  sendpkParams,
  sendpkEndpoint,
  type SendpkConfig,
} from '../lib/sms/sendpk'

const CFG: SendpkConfig = {
  apiKey: 'secret-key',
  sender: '8584',
  templateId: '10728',
  baseUrl: 'https://sendpk.com',
}

// The exact success body from the probe.
const SUCCESS =
  '{"success":"true","type":"API","totalprice":"4.8","totalgsm":"1",' +
  '"remaincredit":"31.20 PKR","results":[{"status":"OK",' +
  '"messageid":"b89edfca-705d-41f2-afbd-518762c6a884","gsm":"923211045245"}]}'

test('success shape → ok, with messageid, totalprice and remaincredit', () => {
  const p = parseSendpkResponse(SUCCESS)
  assert.equal(p.ok, true)
  if (p.ok) {
    assert.equal(p.messageid, 'b89edfca-705d-41f2-afbd-518762c6a884')
    assert.equal(p.totalprice, '4.8')
    assert.equal(p.remaincredit, '31.20 PKR')
  }
})

test('code 1 (bad key OR blocked IP) → failure carrying the full text', () => {
  // Doc-error #2: 1 means both, told apart only by the text — so the text, not
  // just the code, must survive to the caller.
  const p = parseSendpkResponse('1 : Invalid Username Or Password')
  assert.equal(p.ok, false)
  if (!p.ok) assert.equal(p.message, '1 : Invalid Username Or Password')
})

test('code 12 (dead number — undocumented) → failure, not switched away', () => {
  // Doc-error #1: the table stops at 9, yet a dead number returns 12. Because we
  // do not switch on a code list, 12 is a failure like any non-success body.
  const p = parseSendpkResponse('12 : Please Type A Valid Pakistani Mobile Number')
  assert.equal(p.ok, false)
  if (!p.ok) assert.equal(p.message, '12 : Please Type A Valid Pakistani Mobile Number')
})

test('a body that is neither JSON nor a code → failure with the text', () => {
  const p = parseSendpkResponse('<html><body>Gateway Timeout</body></html>')
  assert.equal(p.ok, false)
  if (!p.ok) assert.ok(p.message.includes('Gateway Timeout'))
})

test('empty body → failure, never a success', () => {
  const p = parseSendpkResponse('')
  assert.equal(p.ok, false)
  if (!p.ok) assert.equal(p.message, 'empty response')
})

test('success:"true" but results[0].status not OK → failure', () => {
  // Both conditions are required; a "true" flag alone is not a delivered send.
  const body = '{"success":"true","results":[{"status":"FAILED","messageid":"x"}]}'
  const p = parseSendpkResponse(body)
  assert.equal(p.ok, false)
})

test('success:"true" with an empty results array → failure', () => {
  const p = parseSendpkResponse('{"success":"true","results":[]}')
  assert.equal(p.ok, false)
})

test('otpDigits takes the 6-digit code, never the "10" of "10 minutes"', () => {
  assert.equal(otpDigits('Your TutorMint verification code is 123456. It expires in 10 minutes.'), '123456')
  assert.equal(otpDigits('no code here'), null)
})

test('sendpkParams sends template variables as a JSON string, plus format=json', () => {
  const q = sendpkParams(CFG, '923211045245', '123456')
  assert.equal(q.get('api_key'), 'secret-key')
  assert.equal(q.get('sender'), '8584')
  assert.equal(q.get('mobile'), '923211045245')
  assert.equal(q.get('template_id'), '10728')
  assert.equal(q.get('message'), '{"otp":"123456"}')
  assert.equal(q.get('format'), 'json')
})

test('sendpkEndpoint tolerates a trailing slash on the base URL', () => {
  assert.equal(sendpkEndpoint('https://sendpk.com'), 'https://sendpk.com/api/sms.php')
  assert.equal(sendpkEndpoint('https://sendpk.com/'), 'https://sendpk.com/api/sms.php')
})
