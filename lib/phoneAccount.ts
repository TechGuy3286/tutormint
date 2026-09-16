import 'server-only'

import type { createAdminClient } from '@/lib/supabase/admin'
import { normalisePkMobile } from '@/lib/phone'

// One verified mobile number per account (owner PR8 §1). A number may be VERIFIED
// on only one account. This is the code half of that rule (the DB half is a
// partial unique index — migration 90, held until the existing duplicates are
// resolved); every OTP path checks it so a second account can never verify a
// number already verified on a first.
//
// The comparison is on the CANONICAL 92XXXXXXXXXX form (lib/phone), so 03..,
// +92.. and 92.. variants of the same number all collide.

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

/** The exact member-facing message (owner PR8 §1.2). It never reveals which
 *  account holds the number. */
export const NUMBER_TAKEN_MESSAGE =
  'This number is already linked to another TutorMint account. Use a different number, or contact support.'

/**
 * True when a DIFFERENT account already has this number VERIFIED
 * (phone_verified_at set). `exceptUserId` is the account being checked (skipped);
 * omit it for a pre-account signup. Compares on the normalised MSISDN.
 */
export async function numberVerifiedElsewhere(
  admin: Admin,
  rawNumber: string,
  exceptUserId?: string | null,
): Promise<boolean> {
  const target = normalisePkMobile(rawNumber)
  if (!target) return false

  const { data } = await admin
    .from('profiles')
    .select('id, phone_number, phone_verified_at')

  for (const p of data ?? []) {
    if (exceptUserId && p.id === exceptUserId) continue
    if (!p.phone_verified_at) continue
    if (normalisePkMobile(p.phone_number as string) === target) return true
  }
  return false
}
