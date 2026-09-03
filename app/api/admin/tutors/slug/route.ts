import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import { applySlug, suggestSlug } from '@/lib/tutorSlug'
import { slugify } from '@/lib/slugs'
import { parseBody, z, uuid } from '@/lib/validate'

// Change a tutor's public address.
//
// MANAGER, NOT VERIFIER. A verifier works the moderation queue and decides
// whether a video and a set of certificates are acceptable. Moving somebody's
// public URL is a different kind of decision: it breaks nothing (the old
// address 301s) but it is what a search engine has indexed and what the tutor
// has pasted into WhatsApp, and it is not a queue-worker's call.
//
// TUTORS CANNOT DO THIS AT ALL. There is no self-serve field anywhere. An
// address a member can change at will is an address that changes when somebody
// is unhappy with a review, and every change costs the profile whatever
// ranking the old URL had accumulated.
//
// THREE THINGS HAPPEN, and this route does all three so a screen written later
// cannot do two of them: the address moves (with the old one retired into
// slug_history in the same statement), the change is audited, and the tutor is
// told. A tutor discovering their profile URL changed by finding a dead link
// is the version of this that generates a support ticket.

export const runtime = 'nodejs'

const SlugBody = z.object({
  tutorId: uuid,
  slug: z.string().min(2).max(90),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tutorSlug)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  const parsed = await parseBody(request, SlugBody)
  if (!parsed.ok) return parsed.response

  const tutorId = parsed.data.tutorId ?? ''
  // Normalised the same way the database will normalise it, so the admin is
  // shown the address that was actually saved rather than the one they typed.
  const wanted = slugify(parsed.data.slug ?? '')

  if (!wanted) {
    return NextResponse.json(
      { error: 'A profile address needs at least one letter or number.' },
      { status: 400 },
    )
  }

  const { data: tutor } = await admin
    .from('tutor_profiles')
    .select('id, full_name, slug')
    .eq('id', tutorId)
    .maybeSingle()

  if (!tutor) return NextResponse.json({ error: 'Tutor not found.' }, { status: 404 })

  const previous = (tutor.slug as string | null) ?? null
  if (previous === wanted) {
    return NextResponse.json({ success: true, slug: wanted, unchanged: true })
  }

  const applied = await applySlug(tutorId, wanted)
  if (!applied.ok) {
    // set_tutor_slug raises on a collision with a live slug or with another
    // tutor's retired one; those messages are written to be read by the admin.
    return NextResponse.json({ error: applied.error }, { status: 409 })
  }

  // An admin decision freezes the address: the automatic refresh must not
  // quietly overwrite it the next time the tutor edits their city. Set here
  // rather than inside set_tutor_slug(), because the automatic path uses that
  // same function and a refresh is not a decision.
  await admin.from('tutor_profiles').update({ slug_locked: true }).eq('id', tutorId)

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'tutor.slug',
    targetType: 'tutor_profile',
    targetId: tutorId,
    detail: { from: previous, to: applied.slug },
  })

  await logActivity({
    userId: tutorId,
    event: 'profile_updated',
    targetType: 'tutor_profile',
    targetId: tutorId,
    meta: { field: 'slug', from: previous, to: applied.slug, byAdmin: true },
  })

  await notify({
    userId: tutorId,
    kind: 'profile_address_changed',
    title: 'Your profile address has changed',
    body: previous
      ? `Your profile is now at /tutor/${applied.slug}. The old link still works and sends people to the new one.`
      : `Your profile is now at /tutor/${applied.slug}.`,
    href: `/tutor/${applied.slug}`,
  })

  return NextResponse.json({ success: true, slug: applied.slug, previous })
}

/** What the canonical address would be. Proposes; never applies. */
export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tutorSlug)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const tutorId = new URL(request.url).searchParams.get('tutorId') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(tutorId)) {
    return NextResponse.json({ error: 'Missing tutor.' }, { status: 400 })
  }

  return NextResponse.json({ slug: await suggestSlug(tutorId) })
}
