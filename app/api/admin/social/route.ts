import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'

// Record that a promotional post was generated for a tutor.
//
// Deliberately separate from the image route. That route is a GET and re-runs
// on every preview keystroke; auditing there would bury the log in noise and
// make a GET a writing request. This is called once, when an admin actually
// downloads a post to publish — which is the moment worth a record.

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.social)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  let body: { slug?: string; template?: string; format?: string; edited?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const slug = (body.slug ?? '').trim()
  if (!slug) return NextResponse.json({ error: 'Missing tutor.' }, { status: 400 })

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'social.generate',
    targetType: 'tutor_profile',
    targetId: slug,
    detail: {
      slug,
      template: body.template ?? null,
      format: body.format ?? null,
      // Whether the one editable line was overridden, so a post that reads
      // oddly later can be traced to a person rather than to the profile.
      headlineEdited: !!body.edited,
    },
  })

  return NextResponse.json({ success: true })
}
