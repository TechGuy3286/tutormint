import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { applyPlanFlags } from '@/lib/payments/activate'

// Manual plan grant / revoke — the pre-launch testing tool.
//
// owner + manager only. finance can SEE the plans screen but cannot mutate,
// so this route checks plansMutate, which is deliberately narrower than the
// screen's own read permission.
//
// Grants are written with source='admin_grant' so pre-launch test
// subscriptions can be told apart from real revenue later.

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.plansMutate)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Server is not configured for admin actions.' }, { status: 503 })
  }

  let body: { userId?: string; action?: string; planCode?: string; days?: number; note?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { userId, action } = body
  const note = (body.note ?? '').trim()

  if (!userId || (action !== 'grant' && action !== 'revoke')) {
    return NextResponse.json({ error: 'Missing account or unknown action.' }, { status: 400 })
  }

  const { data: target } = await admin
    .from('profiles')
    .select('id, email, role')
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

  return NextResponse.json({
    success: true, action, planCode, expiresAt: expiresAt.toISOString(), subscriptionId: created.id,
  })
}
