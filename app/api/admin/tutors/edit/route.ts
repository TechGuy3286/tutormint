import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { recomputeCompletion } from '@/lib/completion'
import { ensureTutorSlug } from '@/lib/tutorSlug'
import { activatePausedIfListed } from '@/lib/payments/goLive'
import { numberSavedElsewhere, NUMBER_TAKEN_MESSAGE } from '@/lib/phoneAccount'
import { normalisePkMobile, formatPkMobile, syntheticEmail, isSyntheticEmail } from '@/lib/phone'
import { isValidCnic, formatCnic, CNIC_FORMAT_HINT } from '@/lib/cnic'
import { recordFieldChanges, maskCnicHistory, type Step1Field } from '@/lib/fieldHistory'

// PR83 (Part B) — staff edits of a tutor's step-1 TEXT/SET fields from
// /admin/tutors/[id]: mobile, CNIC number, subjects, city, areas. Images
// (CNIC front/back, profile picture, selfie) go through the sibling /media
// route. admin/operations only (SCREEN_ACCESS.tutorEdit).
//
// Every write goes through the SERVICE ROLE — which bypasses the PR72 member
// field-locks; those locks stay exactly as they are for members. Every action
// records a change-history row (best-effort), an admin_audit_log row and a
// member-timeline row, and requires a reason (the spec). A CNIC number is
// stored on the tutor as usual but recorded in history showing only the last 4.

export const runtime = 'nodejs'

type Body = {
  action?: string
  tutorId?: string
  reason?: string
  mobile?: string
  cnicNumber?: string
  subjectMasterIds?: number[]
  city?: string
  areas?: string[]
}

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tutorEdit)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const action = body.action
  const tutorId = body.tutorId
  const reason = (body.reason ?? '').trim()

  if (!tutorId) return NextResponse.json({ error: 'Missing tutor.' }, { status: 400 })
  if (reason.length < 3) {
    return NextResponse.json({ error: 'A reason is required (at least 3 characters).' }, { status: 400 })
  }

  // The target must be a tutor.
  const { data: prof } = await admin
    .from('profiles')
    .select('role, email, phone_number, cnic_number')
    .eq('id', tutorId)
    .maybeSingle()
  if (!prof || prof.role !== 'tutor') {
    return NextResponse.json({ error: 'Not a tutor account.' }, { status: 404 })
  }

  const actorEmail = gate.actor.email
  const audit = (field: Step1Field, detail: Record<string, unknown> = {}) =>
    logAdminAction({
      actorId: gate.actor.id,
      actorRole: gate.actor.adminRole,
      actorEmail,
      action: 'tutor.edit',
      targetType: 'tutor_profile',
      targetId: tutorId,
      detail: { field, reason, ...detail },
    })
  const timeline = (field: Step1Field) =>
    logActivity({ userId: tutorId, event: 'profile_updated', targetType: 'tutor_profile', targetId: tutorId, meta: { field, by: 'staff' } })

  // ---------------------------------------------------------------- mobile ---
  if (action === 'set-mobile') {
    const newMobile = normalisePkMobile(body.mobile ?? '')
    if (!newMobile) return NextResponse.json({ error: 'Enter a valid Pakistani mobile number.' }, { status: 400 })
    if (await numberSavedElsewhere(admin, newMobile, tutorId)) {
      return NextResponse.json({ error: NUMBER_TAKEN_MESSAGE }, { status: 409 })
    }
    const oldMobile = (prof.phone_number as string | null) ?? null
    // Move a synthetic (mobile-first) login address with the number.
    if (isSyntheticEmail(prof.email as string)) {
      const wanted = syntheticEmail(newMobile)
      if (wanted !== prof.email) {
        await admin.auth.admin.updateUserById(tutorId, { email: wanted, email_confirm: true })
      }
    }
    const { error } = await admin
      .from('profiles')
      .update({
        phone_number: newMobile,
        ...(isSyntheticEmail(prof.email as string) ? { email: syntheticEmail(newMobile) } : {}),
        // A staff edit vouches for the number — it stays a verified, usable
        // number (distinguishable as 'admin' from a real OTP verify).
        phone_verified_at: new Date().toISOString(),
        phone_verified: true,
        phone_verified_via: 'admin',
        phone_gate_required: false,
      })
      .eq('id', tutorId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    // Any outstanding code for this account is now moot.
    await admin.from('phone_otps').update({ consumed_at: new Date().toISOString() }).eq('user_id', tutorId).is('consumed_at', null)
    await activatePausedIfListed(tutorId)
    await recordFieldChanges([{ tutorId, field: 'mobile', oldValue: oldMobile ? formatPkMobile(oldMobile) : null, newValue: formatPkMobile(newMobile), changedBy: gate.actor.id, changedByRole: 'staff', changedByEmail: actorEmail, reason }])
    await audit('mobile')
    await timeline('mobile')
    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------- cnic number ---
  if (action === 'set-cnic-number') {
    const raw = body.cnicNumber ?? ''
    if (!isValidCnic(raw)) return NextResponse.json({ error: CNIC_FORMAT_HINT }, { status: 400 })
    const oldCnic = (prof.cnic_number as string | null) ?? null
    const formatted = formatCnic(raw)
    const { error } = await admin.from('profiles').update({ cnic_number: formatted }).eq('id', tutorId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await recordFieldChanges([{ tutorId, field: 'cnic_number', oldValue: maskCnicHistory(oldCnic), newValue: maskCnicHistory(formatted), changedBy: gate.actor.id, changedByRole: 'staff', changedByEmail: actorEmail, reason }])
    await audit('cnic_number')
    await timeline('cnic_number')
    return NextResponse.json({ ok: true })
  }

  // -------------------------------------------------------------- subjects ---
  if (action === 'set-subjects') {
    const ids = Array.from(new Set((body.subjectMasterIds ?? []).filter((n) => Number.isInteger(n) && n > 0)))
    if (ids.length === 0) return NextResponse.json({ error: 'Choose at least one subject.' }, { status: 400 })
    const { data: oldRows } = await admin.from('tutor_subjects').select('master_id').eq('tutor_id', tutorId)
    const oldIds = (oldRows ?? []).map((r) => r.master_id as number).sort((a, b) => a - b)
    const del = await admin.from('tutor_subjects').delete().eq('tutor_id', tutorId)
    if (del.error) return NextResponse.json({ error: del.error.message }, { status: 400 })
    const ins = await admin.from('tutor_subjects').insert(ids.map((master_id) => ({ tutor_id: tutorId, master_id })))
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 400 })
    await recordFieldChanges([{ tutorId, field: 'subjects', oldValue: oldIds.join(','), newValue: [...ids].sort((a, b) => a - b).join(','), changedBy: gate.actor.id, changedByRole: 'staff', changedByEmail: actorEmail, reason }])
    await audit('subjects', { count: ids.length })
    await timeline('subjects')
    await recomputeCompletion(tutorId)
    return NextResponse.json({ ok: true })
  }

  // ------------------------------------------------------------------ city ---
  if (action === 'set-city') {
    const city = (body.city ?? '').trim()
    if (!city) return NextResponse.json({ error: 'Enter a city.' }, { status: 400 })
    const { data: tp } = await admin.from('tutor_profiles').select('city').eq('id', tutorId).maybeSingle()
    const oldCity = (tp?.city as string | null) ?? null
    const upd = await admin.from('tutor_profiles').update({ city }).eq('id', tutorId)
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 400 })
    // Mirror onto profiles.city (the member save does the same).
    await admin.from('profiles').update({ city }).eq('id', tutorId)
    await recordFieldChanges([{ tutorId, field: 'city', oldValue: oldCity, newValue: city, changedBy: gate.actor.id, changedByRole: 'staff', changedByEmail: actorEmail, reason }])
    await audit('city')
    await timeline('city')
    // A city change can move an unlisted tutor's slug; the DB trigger fires the
    // refresh and slug_history captures the old URL for the permanent redirect.
    await ensureTutorSlug(tutorId)
    await recomputeCompletion(tutorId)
    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------------- areas ---
  if (action === 'set-areas') {
    const areas = Array.from(new Set((body.areas ?? []).map((a) => (a ?? '').trim()).filter(Boolean)))
    if (areas.length === 0) return NextResponse.json({ error: 'Add at least one area.' }, { status: 400 })
    const { data: tp } = await admin.from('tutor_profiles').select('city').eq('id', tutorId).maybeSingle()
    const areaCity = ((tp?.city as string | null) ?? '').trim()
    const { data: oldRows } = await admin.from('tutor_areas').select('area').eq('tutor_id', tutorId)
    const oldAreas = (oldRows ?? []).map((r) => r.area as string).sort()
    const updOne = await admin.from('tutor_profiles').update({ area: areas[0] }).eq('id', tutorId)
    if (updOne.error) return NextResponse.json({ error: updOne.error.message }, { status: 400 })
    const del = await admin.from('tutor_areas').delete().eq('tutor_id', tutorId)
    if (del.error && del.error.code !== '42P01') return NextResponse.json({ error: del.error.message }, { status: 400 })
    const ins = await admin.from('tutor_areas').insert(areas.map((area) => ({ tutor_id: tutorId, city: areaCity, area })))
    if (ins.error && ins.error.code !== '42P01') return NextResponse.json({ error: ins.error.message }, { status: 400 })
    await recordFieldChanges([{ tutorId, field: 'areas', oldValue: oldAreas.join(', '), newValue: [...areas].sort().join(', '), changedBy: gate.actor.id, changedByRole: 'staff', changedByEmail: actorEmail, reason }])
    await audit('areas', { count: areas.length })
    await timeline('areas')
    await recomputeCompletion(tutorId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
