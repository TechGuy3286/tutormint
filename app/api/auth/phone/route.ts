import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalisePkMobile, syntheticEmail, isSyntheticEmail } from '@/lib/phone'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z, pkMobile } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'
import { sendOtp } from '@/lib/otp'

// Change the mobile number on an account that has not verified one yet.
//
// This is the "wrong number?" link on /verify-phone, and it exists because a
// typo in the number at signup is otherwise unrecoverable: the code goes to a
// stranger's handset and the member is held on a page they can never pass.
//
// ONLY WHILE UNVERIFIED. Once phone_verified_at is set, the number is a
// verified fact and changing it belongs in profile settings behind a fresh
// OTP, not on the gate screen.
//
// THE SYNTHETIC-EMAIL PROBLEM. An account registered with no email signs in
// with an address derived from its number. Changing the number without moving
// the address would leave the member unable to sign in with either the old
// number (no longer theirs on the profile) or the new one (no account at that
// derived address) — locked out by the very screen meant to rescue them. So
// the auth email moves with the number, and only for accounts whose address is
// synthetic; a real address the member chose is never touched.

const PhoneBody = z.object({ mobile: pkMobile })

export async function POST(request: Request) {
  const limit = await rateLimit('otp_send', callerIp(request))
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'changes')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const parsed = await parseBody(request, PhoneBody)
  if (!parsed.ok) return parsed.response

  const msisdn = normalisePkMobile(parsed.data.mobile)
  if (!msisdn) {
    return NextResponse.json({ error: 'Enter a Pakistani mobile number.' }, { status: 400 })
  }

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Temporarily unavailable.' }, { status: 503 })
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('phone_number, phone_verified_at, email')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })

  if (profile.phone_verified_at) {
    return NextResponse.json(
      { error: 'This number is already verified. Change it from your profile settings.' },
      { status: 409 },
    )
  }

  if (profile.phone_number === msisdn) {
    // Not an error worth a red box: resend to the same number instead.
    const resent = await sendOtp({ phone: msisdn, purpose: 'verify', userId: user.id })
    if (!resent.ok) {
      return NextResponse.json({ error: resent.error }, { status: resent.status })
    }
    return NextResponse.json({ success: true, mobile: msisdn, devBypassActive: resent.devBypassActive })
  }

  const national = `0${msisdn.slice(2)}`
  const { data: taken } = await admin
    .from('profiles')
    .select('id')
    .or(`phone_number.eq.${msisdn},phone_number.eq.${national},phone_number.eq.+${msisdn}`)
    .neq('id', user.id)
    .limit(1)
    .maybeSingle()

  if (taken) {
    return NextResponse.json(
      { error: 'An account already uses that mobile number.' },
      { status: 409 },
    )
  }

  // Move the login address with the number, for synthetic addresses only.
  let nextEmail = profile.email as string
  if (isSyntheticEmail(profile.email as string)) {
    nextEmail = syntheticEmail(msisdn)
    const { error: authError } = await admin.auth.admin.updateUserById(user.id, {
      email: nextEmail,
      email_confirm: true,
    })
    if (authError) {
      return NextResponse.json(
        { error: 'Could not update the number. Please try again.' },
        { status: 500 },
      )
    }
  }

  const { error: updateError } = await admin
    .from('profiles')
    .update({ phone_number: msisdn, email: nextEmail })
    .eq('id', user.id)

  if (updateError) {
    return NextResponse.json({ error: 'Could not update the number.' }, { status: 500 })
  }

  await logActivity({
    userId: user.id,
    event: 'profile_updated',
    targetType: 'profile',
    targetId: user.id,
    // The number itself is not written to the timeline: an admin-readable log
    // does not need to carry it, and the profile already holds it.
    meta: { changed: 'mobile_before_verification' },
  })

  const sent = await sendOtp({ phone: msisdn, purpose: 'verify', userId: user.id })
  if (!sent.ok) {
    return NextResponse.json(
      { success: true, mobile: msisdn, codeSent: false, codeError: sent.error },
      { status: 200 },
    )
  }

  return NextResponse.json({
    success: true,
    mobile: msisdn,
    codeSent: true,
    devBypassActive: sent.devBypassActive,
  })
}
