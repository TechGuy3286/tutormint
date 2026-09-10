import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { applyPlanFlags } from '@/lib/payments/activate'
import { notify } from '@/lib/notifications'
import { deliverEmail } from '@/lib/notify'
import { getEntitlements } from '@/lib/entitlements'
import { parseBody, z, uuid } from '@/lib/validate'
import { requireFreshAuth } from '@/lib/reauth'

// What a granted plan unlocks, in the member's own terms. Warm and plain — no
// price, no promise of tuitions or income (owner, 9 Sep). One line per plan.
function planUnlocks(planCode: string): string {
  switch (planCode) {
    case 'verified':
      return 'You can now see who has viewed your profile and apply to tuitions.'
    case 'premium':
      return 'You can now message parents on WhatsApp, apply to more tuitions and appear above Verified tutors in search.'
    case 'featured':
      return 'You can now see parent contact details, sit at the top of search and apply without a monthly limit.'
    case 'parent_featured':
      return 'You can now hire tutors, see their contact details and WhatsApp, and post tuitions without a monthly limit.'
    default:
      return 'Your new plan is now active on your account.'
  }
}

// Manual plan grant / revoke — the pre-launch testing tool.
//
// owner + manager only. finance can SEE the plans screen but cannot mutate,
// so this route checks plansMutate, which is deliberately narrower than the
// screen's own read permission.
//
// Grants are written with source='admin_grant' so pre-launch test
// subscriptions can be told apart from real revenue later.

const PlanGrantBody = z.object({
  userId: uuid,
  action: z.enum(['grant', 'revoke'], { message: 'Choose grant or revoke.' }),
  planCode: z.string().max(64).optional(),
  days: z.coerce.number().int().min(1).max(3650).optional(),
  note: z.string().max(1000, 'That note is too long.').optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.plansMutate)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Server is not configured for admin actions.' }, { status: 503 })
  }

  // Granting a plan by hand is money the platform did not receive.
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  const parsed = await parseBody(request, PlanGrantBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const { userId, action } = body
  const note = (body.note ?? '').trim()

  if (!userId || (action !== 'grant' && action !== 'revoke')) {
    return NextResponse.json({ error: 'Missing account or unknown action.' }, { status: 400 })
  }

  const { data: target } = await admin
    .from('profiles')
    .select('id, email, role, full_name')
    .eq('id', userId)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })

  // ------------------------------------------------------------- revoke ---
  if (action === 'revoke') {
    const { data: revoked, error } = await admin
      .from('subscriptions')
      .update({ status: 'cancelled' })
      .eq('user_id', userId)
      .eq('status', 'active')
      .select('id, plan_code')

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Featured tags follow the plan. Nothing is deleted -- the tutor stays
    // listed and the jobs stay open, they simply stop being promoted.
    if ((revoked ?? []).some((r) => r.plan_code === 'featured')) {
      await admin.from('tutor_profiles').update({ is_featured: false }).eq('id', userId)
    }
    if ((revoked ?? []).some((r) => r.plan_code === 'parent_featured')) {
      await admin.from('jobs').update({ is_featured: false }).eq('parent_id', userId).eq('is_featured', true)
    }

    await logAdminAction({
      actorId: gate.actor.id, actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
      action: 'plan.revoke', targetType: 'profile', targetId: userId,
      detail: { note, revoked: (revoked ?? []).map((r) => r.plan_code) },
    })
    await logActivity({
      userId, event: 'plan_revoked', targetType: 'subscription', targetId: userId,
      meta: { note, plans: (revoked ?? []).map((r) => r.plan_code) },
    })

    // Tell the member their plan ended (owner, 9 Sep — an admin action that
    // changes what they can do must not be silent). Worded as loss of
    // visibility, not an invoice, per the conversion rules; nothing is deleted.
    if ((revoked ?? []).length > 0) {
      await notify({
        userId,
        kind: 'plan_revoked',
        title: 'Your plan has ended',
        body:
          target.role === 'tutor'
            ? 'Your badges are off and you now appear below Verified tutors in search. Nothing has been deleted.'
            : 'You can no longer complete a hire or see tutor contact details. Your tuitions stay open.',
        href: target.role === 'tutor' ? '/tutor/packages' : '/parent/packages',
      })
    }

    return NextResponse.json({ success: true, action, revoked: (revoked ?? []).length })
  }

  // -------------------------------------------------------------- grant ---
  const planCode = body.planCode
  const days = Number(body.days)

  if (!planCode) return NextResponse.json({ error: 'Choose a plan.' }, { status: 400 })
  if (!Number.isFinite(days) || days < 1 || days > 3650) {
    return NextResponse.json({ error: 'Duration must be between 1 and 3650 days.' }, { status: 400 })
  }

  const { data: plan } = await admin
    .from('plans')
    .select('code, audience, name')
    .eq('code', planCode)
    .maybeSingle()
  if (!plan) return NextResponse.json({ error: 'Unknown plan code.' }, { status: 400 })

  // A tutor plan on a parent account (or vice versa) would give nonsense
  // entitlements, so refuse rather than quietly create it.
  const targetAudience = target.role === 'tutor' ? 'tutor' : 'parent'
  if (plan.audience !== targetAudience) {
    return NextResponse.json(
      { error: `"${plan.name}" is a ${plan.audience} plan; this account is a ${targetAudience}.` },
      { status: 400 },
    )
  }

  // One active subscription at a time: supersede any current one.
  await admin.from('subscriptions').update({ status: 'cancelled' }).eq('user_id', userId).eq('status', 'active')

  const startsAt = new Date()
  const expiresAt = new Date(startsAt.getTime() + days * 86_400_000)

  const { data: created, error } = await admin
    .from('subscriptions')
    .insert({
      user_id: userId,
      plan_code: planCode,
      starts_at: startsAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: 'active',
      source: 'admin_grant',
      granted_by: gate.actor.id,
      note: note || null,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Same flag handling a purchase gets, so a granted plan and a bought plan
  // leave the account in identical state.
  await applyPlanFlags(userId, planCode)

  await logAdminAction({
    actorId: gate.actor.id, actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'plan.grant', targetType: 'profile', targetId: userId,
    detail: { planCode, days, note, subscriptionId: created.id, expiresAt: expiresAt.toISOString() },
  })
  await logActivity({
    userId, event: 'plan_granted', targetType: 'subscription', targetId: created.id,
    meta: { planCode, days, note, source: 'admin_grant' },
  })

  // Tell the member — warm, and never silent (owner, 9 Sep). A granted plan
  // changes what they can do, so it notifies in-app AND emails, using the same
  // template library as the other channels. No price (nothing was paid), no
  // promise of tuitions or income. `listed` decides whether a tutor's badge is
  // already live or waits on verification, so the copy is accurate either way.
  const ent = await getEntitlements(userId)
  const unlocks = planUnlocks(planCode)
  // Since 10 Sep the tutor caveat is verification (identity + mobile), not
  // completion — the grant makes the plan active, so ent.listed now reflects
  // exactly whether they still need to verify. A parent tier never waits on it.
  const live = targetAudience === 'parent' ? true : ent.listed
  await notify({
    userId,
    kind: 'plan_activated',
    title: `Your ${plan.name} plan is active`,
    body: live
      ? targetAudience === 'tutor'
        ? `Your ${plan.name} badge is now live on your profile. ${unlocks}`
        : unlocks
      : `${unlocks} Your badge appears once your identity and mobile number are verified.`,
    href: targetAudience === 'tutor' ? '/tutor/dashboard' : '/parent/dashboard',
  })
  await deliverEmail(
    { userId },
    {
      id: 'plan_granted',
      name: (target.full_name as string) ?? 'there',
      planName: plan.name as string,
      unlocks,
      listed: live,
    },
  )

  return NextResponse.json({
    success: true, action, planCode, expiresAt: expiresAt.toISOString(), subscriptionId: created.id,
  })
}
