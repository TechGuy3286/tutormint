import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recomputeCompletion } from '@/lib/completion'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z, pkMobile } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'
import { sendOtp, verifyOtp, consumeOtp } from '@/lib/otp'
import { activatePausedIfListed } from '@/lib/payments/goLive'
import { normalisePkMobile, formatPkMobile, syntheticEmail, isSyntheticEmail } from '@/lib/phone'
import { numberSavedElsewhere, NUMBER_TAKEN_MESSAGE, NUMBER_TAKEN_MESSAGE_UR } from '@/lib/phoneAccount'
import { recordTutorSelfChanges } from '@/lib/fieldHistory'
import { RELOAD_AND_RETRY } from '@/lib/tutorSubjectCap'

// Phone / SMS OTP for the SIGNED-IN account.
//
//   POST { action: 'send',   phone }
//   POST { action: 'verify', phone, code }
//
// The rules themselves (expiry, single use, five attempts, cooldown, sends per
// hour) live in lib/otp.ts, because registration and password reset need the
// same ones and three copies would drift. This route is the signed-in door to
// them: it establishes who is asking, rate-limits by IP, and on success writes
// the verification onto the profile.
//
// DEV_DEFAULT_OTP: when set AND this is not the live site, that code verifies,
// so several test users can verify without a live SMS provider and a Vercel
// preview is testable end to end. It is never read on tutormint.org — see
// devOtpCode() in lib/sms, the one place that reads it, and
// instrumentation.ts, which refuses to boot a production server that has it.

const OtpBody = z.object({
  action: z.enum(['send', 'verify'], { message: 'That request was not understood. Reload the page and try again.\nیہ درخواست سمجھ نہیں آئی۔ صفحہ دوبارہ لوڈ کر کے کوشش کریں۔' }),
  phone: pkMobile,
  // Kept loose on purpose: a wrong-length code is a wrong code, and telling
  // somebody their guess was the wrong SHAPE is a hint they did not need.
  code: z.string({ message: RELOAD_AND_RETRY }).max(32, { message: 'That code is not right. Please check it and try again.\nیہ کوڈ درست نہیں۔ دوبارہ چیک کر کے کوشش کریں۔' }).optional(),
}, { message: RELOAD_AND_RETRY })

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Please sign in first, then try again.\nپہلے سائن ان کریں، پھر دوبارہ کوشش کریں۔' }, { status: 401 })
  }

  const parsed = await parseBody(request, OtpBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  // Two limits, on purpose. lib/otp caps sends per PHONE per hour, which stops
  // one number being spammed. This caps per IP, which stops one script walking
  // a list of numbers — a different attack, and the one that costs real money.
  //
  // Sends and verifies get separate budgets because they are separate threats:
  // a send costs us money, a verify is a guess at a code.
  const bucket = body.action === 'verify' ? 'otp_verify' : 'otp_send'
  const limit = await rateLimit(bucket, callerIp(request))
  if (!limit.allowed) {
    return tooManyRequests(
      limit.retryAfterSeconds,
      bucket === 'otp_send' ? 'code requests' : 'attempts',
    )
  }

  const phone = normalisePkMobile(body.phone)
  if (!phone) {
    return NextResponse.json({ error: 'Enter a valid mobile number.' }, { status: 400 })
  }

  // ONE NUMBER PER ACCOUNT (PR16 §4.2). Do not send a code to — or verify — a
  // number SAVED on ANOTHER account, verified or not, matched on the normalised
  // MSISDN across phone_number and whatsapp. Checked on both send and verify, and
  // before any SMS goes out. Never reveals which account holds it.
  const admin = createAdminClient()
  if (admin && (await numberSavedElsewhere(admin, phone, user.id))) {
    return NextResponse.json({ error: NUMBER_TAKEN_MESSAGE, errorUr: NUMBER_TAKEN_MESSAGE_UR }, { status: 409 })
  }

  // PR17 §3.2 — once a number is VERIFIED it is read-only; a change goes through
  // support. So a verified account may only ever act on its OWN current number
  // (re-verification is not a thing here). Trying to send/verify a DIFFERENT
  // number is refused with the support instruction. An unverified account may
  // freely edit and verify (§3.1). Belt-and-braces behind the read-only UI.
  if (admin) {
    const { data: me } = await admin
      .from('profiles')
      .select('phone_number, phone_verified_at')
      .eq('id', user.id)
      .maybeSingle()
    if (me?.phone_verified_at && normalisePkMobile(me.phone_number as string) !== phone) {
      return NextResponse.json(
        { error: 'Your number is already verified. To change it, please contact support.' },
        { status: 403 },
      )
    }
  }

  // ---------------------------------------------------------------- send ---
  if (body.action === 'send') {
    const result = await sendOtp({ phone, purpose: 'verify', userId: user.id })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, detail: result.detail },
        { status: result.status },
      )
    }

    return NextResponse.json({
      success: true,
      devBypassActive: result.devBypassActive,
      // One SMS per number: when a live code already exists none is sent, and we
      // say so plainly rather than pretending a new message went out.
      alreadySent: result.alreadySent,
      message: result.devBypassActive
        ? 'Development mode: use the configured DEV_DEFAULT_OTP code.'
        : result.alreadySent
          ? 'We already sent a code to this number. Please use it.'
          : 'Verification code sent.',
    })
  }

  // -------------------------------------------------------------- verify ---
  // commit:false — the code is validated but NOT consumed here. It is marked used
  // only AFTER the save below succeeds (PR79 §2), so a save failure leaves the
  // code valid for a retry rather than burning a one-code-for-life code on a
  // write that did not land (the "correct but could not save" trap).
  const result = await verifyOtp({
    phone,
    code: typeof body.code === 'string' ? body.code : '',
    purpose: 'verify',
    userId: user.id,
    commit: false,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, attemptsLeft: result.attemptsLeft, locked: result.locked },
      { status: result.status },
    )
  }

  // phone_verified_at is the ONE field every reader keys "mobile verified" on —
  // directoryBlockers, the dashboard, the flow, completion and entitlements all
  // read it (owner PR7 §2.1).
  //
  // PR79 §1: this is written with the SERVICE ROLE, not the caller's cookie
  // client. phone_verified_at / phone_verified / phone_verified_via are NOT in
  // the column-level UPDATE grant for `authenticated` (deliberately — a member
  // must not be able to self-verify by writing phone_verified_at directly through
  // PostgREST), so the old cookie-scoped update was denied on phone_verified_at
  // and produced "your code was correct, but we could not save it". The server
  // has just verified the OTP, so it is the trusted writer here. First-time
  // verification is therefore always allowed; the field-lock trigger (which fires
  // only for a MEMBER changing an ALREADY-verified number) is not in this path,
  // and changing a verified number is still refused above (lines ~88-99) and by
  // the trigger for direct member writes. `.select()` still confirms the write.
  const writer = admin ?? supabase
  // The old number, for the change history (best-effort; never blocks verify).
  const { data: beforeProf } = await writer.from('profiles').select('phone_number').eq('id', user.id).maybeSingle()
  const { data: saved, error: updErr } = await writer
    .from('profiles')
    .update({
      phone_number: phone,
      phone_verified_at: new Date().toISOString(),
      phone_verified: true,
      // How it was proved: 'bridge' when the BRIDGE_OTP stopgap verified it, so
      // it is visible in admin/CSV and can be made to re-verify when the real
      // provider lands; 'otp' otherwise.
      phone_verified_via: result.bridged ? 'bridge' : 'otp',
    })
    .eq('id', user.id)
    .select('phone_verified_at')
    .maybeSingle()

  if (updErr || !saved?.phone_verified_at) {
    console.error(`[otp] verify: profile write did not persist for ${user.id}: ${updErr?.message ?? 'no row returned'}`)
    // The code was NOT consumed (commit:false), so the member can retry.
    return NextResponse.json(
      { error: 'Your code was correct, but we could not save it. Please try again.' },
      { status: 500 },
    )
  }

  // Saved — NOW mark the code used (PR79 §2).
  if (result.otpId) await consumeOtp(result.otpId)

  // PR83 (Part C): record a tutor's own mobile change (best-effort; tutor-gated).
  await recordTutorSelfChanges(user.id, [
    { field: 'mobile', oldValue: beforeProf?.phone_number ? formatPkMobile(beforeProf.phone_number as string) : null, newValue: formatPkMobile(phone) },
  ])

  // PR17 §3.1 — a mobile-first account signs in with an address derived from its
  // number (<msisdn>@users.tutormint.org). If the number changed while unverified
  // (edited in settings/onboarding), the login address must move with it, or the
  // new number would not sign them in. Only for synthetic addresses; a real email
  // the member chose is never touched.
  if (admin && isSyntheticEmail(user.email ?? '')) {
    const wanted = syntheticEmail(phone)
    if (wanted !== user.email) {
      const { error: emailErr } = await admin.auth.admin.updateUserById(user.id, {
        email: wanted,
        email_confirm: true,
      })
      if (!emailErr) await admin.from('profiles').update({ email: wanted }).eq('id', user.id)
    }
  }

  await recomputeCompletion(user.id)

  // A REAL verification lifts the BRIDGE lock: if this account paid for a plan
  // while bridge-verified, its subscription was paused (clock stopped) and
  // getEntitlements withheld every power. Now that the number is proved by a
  // real code, start it. Safe when there is nothing paused (a no-op), and only
  // on a genuine code — a bridge verify does not clear its own lock.
  if (!result.bridged) {
    await activatePausedIfListed(user.id)
  }

  await logActivity({
    userId: user.id,
    event: 'otp_verified',
    targetType: 'profile',
    targetId: user.id,
  })

  // Belt-and-braces cache invalidation (owner PR7 §2.3). The tutor dashboard is
  // already force-dynamic and reads phone_verified_at fresh through the service
  // role, so this changes nothing today — but if the dashboard's data is ever
  // cached, a verify must clear it so it never keeps saying "verify your mobile".
  revalidatePath('/tutor/dashboard')
  revalidatePath('/tutor/complete-profile')

  return NextResponse.json({
    success: true,
    devBypass: result.devBypass,
    message: 'Phone number verified.',
  })
}
