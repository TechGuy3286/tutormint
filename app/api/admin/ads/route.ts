import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { safeTargetUrl } from '@/lib/ads'

// Advertisement CRUD. owner / manager.
//
// v1 sales are manual: after an academy pays off-platform, the owner or a
// manager creates their ad with an end date. Self-serve ad purchase is
// deliberately not built.
//
// The creative is uploaded through this route rather than straight to storage
// so the file is checked (image, size) and the path is ours to choose. The
// bucket is public -- a banner on a public page has to be -- which is exactly
// why nothing but an admin may write to it.

export const runtime = 'nodejs'

const MAX_BYTES = 5 * 1024 * 1024

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.ads)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const action = String(form.get('action') ?? 'create')
  const adId = String(form.get('adId') ?? '')

  // ------------------------------------------------------------- status ---
  if (action === 'status' || action === 'delete') {
    if (!adId) return NextResponse.json({ error: 'Missing ad.' }, { status: 400 })

    const { data: existing } = await admin
      .from('advertisements')
      .select('id, title, status')
      .eq('id', adId)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Ad not found.' }, { status: 404 })

    if (action === 'delete') {
      const { error } = await admin.from('advertisements').delete().eq('id', adId)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAdminAction({
        actorId: gate.actor.id,
        actorRole: gate.actor.adminRole,
        actorEmail: gate.actor.email,
        action: 'ad.delete',
        targetType: 'advertisement',
        targetId: adId,
        detail: { title: existing.title },
      })
      return NextResponse.json({ success: true })
    }

    const status = String(form.get('status') ?? '')
    if (!['draft', 'active', 'paused'].includes(status)) {
      return NextResponse.json({ error: 'Unknown status.' }, { status: 400 })
    }

    const { error } = await admin
      .from('advertisements')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', adId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logAdminAction({
      actorId: gate.actor.id,
      actorRole: gate.actor.adminRole,
      actorEmail: gate.actor.email,
      action: 'ad.status',
      targetType: 'advertisement',
      targetId: adId,
      detail: { title: existing.title, from: existing.status, to: status },
    })
    return NextResponse.json({ success: true, status })
  }

  // ------------------------------------------------------ create / edit ---
  const title = String(form.get('title') ?? '').trim()
  const clientName = String(form.get('clientName') ?? '').trim()
  const description = String(form.get('description') ?? '').trim()
  const targetUrlRaw = String(form.get('targetUrl') ?? '').trim()
  const audience = String(form.get('audience') ?? 'both')
  const weight = Number(form.get('weight') ?? 1)
  const startsAt = String(form.get('startsAt') ?? '').trim()
  const endsAt = String(form.get('endsAt') ?? '').trim()
  const file = form.get('image')

  if (title.length < 3) {
    return NextResponse.json({ error: 'Give the ad a title.' }, { status: 400 })
  }
  if (!['parents', 'tutors', 'both'].includes(audience)) {
    return NextResponse.json({ error: 'Choose who sees it.' }, { status: 400 })
  }
  if (!Number.isInteger(weight) || weight < 1 || weight > 100) {
    return NextResponse.json({ error: 'Weight must be a whole number from 1 to 100.' }, { status: 400 })
  }

  const targetUrl = targetUrlRaw ? safeTargetUrl(targetUrlRaw) : null
  if (targetUrlRaw && !targetUrl) {
    return NextResponse.json(
      { error: 'The destination must be a full http:// or https:// address.' },
      { status: 400 },
    )
  }

  // An end date in the past would create an ad that has already expired, which
  // is a confusing way to spend an advertiser's money.
  if (endsAt && startsAt && new Date(endsAt) <= new Date(startsAt)) {
    return NextResponse.json({ error: 'The end date must be after the start date.' }, { status: 400 })
  }

  let imagePath: string | null = null
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'That image is larger than 5 MB.' }, { status: 400 })
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'The creative must be an image.' }, { status: 400 })
    }
    const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${globalThis.crypto.randomUUID()}.${ext}`
    const { error: uploadError } = await admin.storage
      .from('ads')
      .upload(path, new Uint8Array(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: false,
      })
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 400 })
    imagePath = path
  }

  const patch: Record<string, unknown> = {
    title,
    client_name: clientName,
    description,
    target_url: targetUrl,
    audience,
    weight,
    starts_at: startsAt ? new Date(startsAt).toISOString() : new Date().toISOString(),
    ends_at: endsAt ? new Date(endsAt).toISOString() : null,
    updated_at: new Date().toISOString(),
  }
  if (imagePath) patch.image_path = imagePath

  if (action === 'edit') {
    if (!adId) return NextResponse.json({ error: 'Missing ad.' }, { status: 400 })
    const { error } = await admin.from('advertisements').update(patch).eq('id', adId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logAdminAction({
      actorId: gate.actor.id,
      actorRole: gate.actor.adminRole,
      actorEmail: gate.actor.email,
      action: 'ad.edit',
      targetType: 'advertisement',
      targetId: adId,
      detail: { title, audience, weight, endsAt: patch.ends_at },
    })
    return NextResponse.json({ success: true, id: adId })
  }

  const { data: created, error } = await admin
    .from('advertisements')
    .insert({
      ...patch,
      // New ads start as drafts. Nothing an admin is halfway through typing
      // should be able to appear on a public page.
      status: 'draft',
      created_by: gate.actor.id,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'ad.create',
    targetType: 'advertisement',
    targetId: created.id as string,
    detail: { title, clientName, audience, weight, endsAt: patch.ends_at },
  })

  return NextResponse.json({ success: true, id: created.id })
}
