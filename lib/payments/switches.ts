import 'server-only'

import { createClient } from '@/lib/supabase/server'

// The two owner-controlled "open payments" switches (PR105 §1), in app_settings.
// Default OFF, and FAIL CLOSED: if the settings cannot be read, both are false,
// so a misread never opens checkout to normal members.
//
//   pay.fee_open   → the Rs 199 verification fee is open to ALL tutors
//   pay.plans_open → Premium/Featured (tutor and parent) are open to ALL

export const SWITCH_KEYS = {
  feeOpen: 'pay.fee_open',
  plansOpen: 'pay.plans_open',
} as const

export type PaymentSwitches = { feeOpen: boolean; plansOpen: boolean }

export async function getPaymentSwitches(): Promise<PaymentSwitches> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', [SWITCH_KEYS.feeOpen, SWITCH_KEYS.plansOpen])
    const m = new Map((data ?? []).map((r) => [r.key as string, String(r.value ?? '')]))
    return {
      feeOpen: m.get(SWITCH_KEYS.feeOpen) === 'true',
      plansOpen: m.get(SWITCH_KEYS.plansOpen) === 'true',
    }
  } catch {
    return { feeOpen: false, plansOpen: false }
  }
}

/** Whether a payment of `planCode` is OPEN to everyone, given the switches. The
 *  Rs 199 fee (planCode 'verified') follows feeOpen; every other plan follows
 *  plansOpen. */
export function planOpenToAll(planCode: string, switches: PaymentSwitches): boolean {
  return planCode === 'verified' ? switches.feeOpen : switches.plansOpen
}
