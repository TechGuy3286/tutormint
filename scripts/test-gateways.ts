/**
 * scripts/test-gateways.ts — Payment gateways settings (owner, 6 Oct 2026, item
 * 19) and the Tuitions-staff activity filter (item 18). Pure rules only.
 *
 *   npm run test:gateways
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_GATEWAY_SETTINGS,
  GATEWAY_KEYS,
  activeChangeError,
  checkoutMethodsOf,
  methodChangeError,
  onlineCheckoutOn,
  parseGatewaySettings,
} from '../lib/payments/gatewaySettingsCore'
import { SCREEN_ACCESS, roleSatisfies } from '../lib/adminAccessCore'
import { TUITION_ACTIVITY_ACTIONS, isTuitionActivityAction, tuitionActionLabel } from '../lib/staffActivityCore'

test('missing settings read as today’s state: PayPro on, bank transfer and Pay later off', () => {
  assert.deepEqual(parseGatewaySettings([]), DEFAULT_GATEWAY_SETTINGS)
  assert.deepEqual(checkoutMethodsOf(parseGatewaySettings([])), { online: true, bankTransfer: false, payLater: false })
})

test('settings parse from app_settings rows', () => {
  const s = parseGatewaySettings([
    { key: GATEWAY_KEYS.bank_transfer, value: 'true' },
    { key: GATEWAY_KEYS.paypro_online, value: 'false' },
    { key: GATEWAY_KEYS.payLater, value: 'true' },
  ])
  assert.deepEqual(checkoutMethodsOf(s), { online: false, bankTransfer: true, payLater: true })
  // An unknown gateway value falls back to PayPro.
  assert.equal(parseGatewaySettings([{ key: GATEWAY_KEYS.active, value: 'other' }]).active, 'paypro')
})

test('at least one method must stay on', () => {
  const onlyOnline = DEFAULT_GATEWAY_SETTINGS
  assert.equal(methodChangeError(onlyOnline, 'paypro_online', false), 'At least one payment method must stay on.')
  assert.equal(methodChangeError(onlyOnline, 'bank_transfer', true), null)
  const both = { ...onlyOnline, methods: { paypro_online: true, bank_transfer: true } }
  assert.equal(methodChangeError(both, 'paypro_online', false), null)
})

test('an unconfigured gateway cannot be made active; online checkout needs PayPro active and on', () => {
  assert.match(activeChangeError('assanpay', { paypro: true, assanpay: false }) ?? '', /AssanPay is not configured/)
  assert.equal(activeChangeError('paypro', { paypro: true, assanpay: false }), null)
  assert.equal(onlineCheckoutOn({ ...DEFAULT_GATEWAY_SETTINGS, active: 'assanpay' }), false)
  assert.equal(onlineCheckoutOn({ ...DEFAULT_GATEWAY_SETTINGS, methods: { paypro_online: false, bank_transfer: true } }), false)
})

test('Payment gateways is owner only', () => {
  assert.equal(roleSatisfies('owner', SCREEN_ACCESS.paymentGateways), true)
  for (const r of ['admin', 'operations', 'tuitions_staff'] as const) {
    assert.equal(roleSatisfies(r, SCREEN_ACCESS.paymentGateways), false, r)
  }
})

test('Tuitions staff see tuition-posting actions only', () => {
  for (const a of ['job.post', 'job.edit', 'job.resume', 'job.refresh', 'job.close', 'job.merge']) {
    assert.equal(isTuitionActivityAction(a), true, a)
  }
  for (const a of ['payment.approve', 'payments.switch', 'payments.gateway', 'member.message', 'tutor.approve', 'parent.verify.approve', 'staff.role', 'plan.grant']) {
    assert.equal(isTuitionActivityAction(a), false, a)
  }
  assert.ok(TUITION_ACTIVITY_ACTIONS.every((a) => a.startsWith('job.')))
  assert.equal(tuitionActionLabel('job.post', true), 'Posted anyway after a duplicate warning')
  assert.equal(tuitionActionLabel('job.resume'), 'Reopened a tuition')
  // The role keeps its menu entry and is refused payments on the server.
  assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS.staffActivity), true)
  assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS.payments), false)
})
