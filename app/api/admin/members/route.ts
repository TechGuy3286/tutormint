import { NextResponse } from 'next/server'
import { checkAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { warnMember, suspendMember, unsuspendMember, banMember, unbanMember } from '@/lib/moderation'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { activatePausedIfListed } from '@/lib/payments/goLive'
import { numberSavedElsewhere, NUMBER_TAKEN_MESSAGE } from '@/lib/phoneAccount'
import { normalisePkMobile, syntheticEmail, isSyntheticEmail } from '@/lib/phone'
import { parseBody, z, text, uuid } from '@/lib/validate'
import { requireFreshAuth } from '@/lib/reauth'

// Moderation from the member page, without a report in front of you.
//
// warn/suspend/unsuspend are the same implementation the reports queue uses, so
// the outcome does not depend on which screen the admin happened to be on. ban
// and unban are Part 4: a ban is permanent and owner/manager only; an unban is
// owner only.

const MemberActionBody = z.object({
  userId: uuid,
  action: z.enum(['warn', 'suspend', 'unsuspend', 'ban', 'unban', 'verify-mobile', 'change-mobile'], {
    message: 'Choose a valid action.',
  }),
  reason: text({ min: 3, max: 1000, label: 'Reason' }),
  /** For change-mobile: the new number. */
  newMobile: z.string().optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.users)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const actor = { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email }

  // Suspending somebody closes every door on the platform at once, and
  // reinstating restores a paid plan. Both are worth a password.
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  const parsed = await parseBody(request, MemberActionBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const userId = body.userId ?? ''
  const action = body.action ?? ''
  const reason = (body.reason ?? '').trim()

  if (!userId) return NextResponse.json({ error: 'Missing member.' }, { status: 400 })
  if (!['warn', 'suspend', 'unsuspend', 'ban', 'unban', 'verify-mobile', 'change-mobile'].includes(action)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }
  if (reason.length < 5) {
    return NextResponse.json({ error: 'Write a reason for the record.' }, { status: 400 })
  }

  // PR17 §3.2 — change a member's mobile from the drawer. Owner/admin only, reason
  // required, logged. The change CLEARS verification, so the member re-verifies
  // the new number (in settings/onboarding). Duplicate check applies; a
  // synthetic (mobile-first) login address moves with the number.
  if (action === 'change-mobile') {
    if (!roleSatisfies(actor.adminRole, ['admin'])) {
      return NextResponse.json({ error: 'Only an owner or admin can change a number.' }, { status: 403 })
    }
    const admin = createAdminClient()
    if (!admin) return NextResponse.json({ error: 'Temporarily unavailable.' }, { status: 503 })
    const newMobile = normalisePkMobile(body.newMobile ?? '')
    if (!newMobile) {
      return NextResponse.json({ error: 'Enter a valid Pakistani mobile number.' }, { status: 400 })
    }
    if (await numberSavedElsewhere(admin, newMobile, userId)) {
      return NextResponse.json({ error: NUMBER_TAKEN_MESSAGE }, { status: 409 })
    }
    const { data: prof } = await admin
      .from('profiles')
      .select('phone_number, email')
      .eq('id', userId)
      .maybeSingle()
    if (!prof) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })

    // Move the login address for a synthetic (mobile-first) account.
    if (isSyntheticEmail(prof.email as string)) {
      const wanted = syntheticEmail(newMobile)
      if (wanted !== prof.email) {
        await admin.auth.admin.updateUserById(userId, { email: wanted, email_confirm: true })
      }
    }
    const { error: upErr } = await admin
      .from('profiles')
      .update({
        phone_number: newMobile,
        ...(isSyntheticEmail(prof.email as string) ? { email: syntheticEmail(newMobile) } : {}),
        // Clear verification — the member verifies the NEW number.
        phone_verified_at: null,
        phone_verified: false,
        phone_verified_via: null,
      })
      .eq('id', userId)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })

    // Invalidate any outstanding code for the old and new numbers.
    await admin.from('phone_otps').update({ consumed_at: new Date().toISOString() }).eq('user_id', userId).is('consumed_at', null)

    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email,
      action: 'member.change_mobile',
      targetType: 'profile',
      targetId: userId,
      detail: { reason },
    })
    await logActivity({ userId, event: 'profile_updated', targetType: 'profile', targetId: userId, meta: { changed: 'mobile_by_admin' } })
    return NextResponse.json({ success: true, action })
  }

  // Ban is owner/manager; unban is owner only. (roleSatisfies always admits the
  // owner; an empty list is owner-only.)
  if (action === 'ban' && !roleSatisfies(actor.adminRole, ['admin'])) {
    return NextResponse.json({ error: 'Only an owner or manager can ban an account.' }, { status: 403 })
  }
  if (action === 'unban' && !roleSatisfies(actor.adminRole, [])) {
    return NextResponse.json({ error: 'Only the owner can lift a ban.' }, { status: 403 })
  }

  // PR16 §3.5 — verify a member's mobile MANUALLY when the SMS could not reach
  // them (or their code is locked). Owner/admin only, reason required, logged.
  // Sets phone_verified_via='admin' so it is distinguishable from 'otp'/'bridge'
  // in admin and the CSV, and starts any paused paid plan.
  if (action === 'verify-mobile') {
    if (!roleSatisfies(actor.adminRole, ['admin'])) {
      return NextResponse.json({ error: 'Only an owner or admin can verify a number manually.' }, { status: 403 })
    }
    const admin = createAdminClient()
    if (!admin) return NextResponse.json({ error: 'Temporarily unavailable.' }, { status: 503 })

    const { data: prof } = await admin
      .from('profiles')
      .select('phone_number, phone_verified_at')
      .eq('id', userId)
      .maybeSingle()
    if (!prof) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
    if (!prof.phone_number) {
      return NextResponse.json({ error: 'This account has no mobile number on file to verify.' }, { status: 400 })
    }
    if (prof.phone_verified_at) {
      return NextResponse.json({ success: true, action, alreadyInState: true })
    }

    const { error: upErr } = await admin
      .from('profiles')
      .update({
        phone_verified_at: new Date().toISOString(),
        phone_verified: true,
        phone_verified_via: 'admin',
        phone_gate_required: false,
      })
      .eq('id', userId)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })

    // Any locked/outstanding code for this number is now moot — consume it.
    await admin
      .from('phone_otps')
      .update({ consumed_at: new Date().toISOString() })
      .eq('phone', prof.phone_number as string)
      .is('consumed_at', null)

    await activatePausedIfListed(userId)
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email,
      action: 'member.verify_mobile',
      targetType: 'profile',
      targetId: userId,
      detail: { reason },
    })
    await logActivity({ userId, event: 'otp_verified', targetType: 'profile', targetId: userId, meta: { via: 'admin' } })

    return NextResponse.json({ success: true, action })
  }

  const result =
    action === 'warn'
      ? await warnMember({ userId, reason, actor })
      : action === 'suspend'
        ? await suspendMember({ userId, reason, actor })
        : action === 'unsuspend'
          ? await unsuspendMember({ userId, reason, actor })
          : action === 'ban'
            ? await banMember({ userId, reason, actor })
            : await unbanMember({ userId, reason, actor })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ success: true, action, alreadyInState: !!result.alreadyInState })
}
