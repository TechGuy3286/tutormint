import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureProfile } from '@/lib/ensureProfile'
import { logAdminAction } from '@/lib/auditLog'

// Create the missing profiles row for an orphaned auth user — an account in
// auth.users with no matching profiles row (the failure the Sydney→Mumbai
// migration caused when on_auth_user_created was dropped). Builds the row from
// the auth user's own metadata via the ONE authoritative upsert (ensureProfile),
// so it is identical to what signup would have written, and logs to the audit.
//
// A ROLE IS NEVER INVENTED. If the signup recorded no role (or 'admin' — which
// this button must not grant), the profile is not created and the admin is told
// to handle it manually. This mirrors migration 59, which left the roleless
// orphans for a human rather than guessing.

export const dynamic = 'force-dynamic'

/** The msisdn out of a synthetic <msisdn>@users.tutormint.org address. */
function mobileFromEmail(email: string | null): string | null {
  if (!email) return null
  const local = email.split('@')[0]
  return /^92\d{10}$/.test(local) ? local : null
}

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.orphans)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  const body = (await request.json().catch(() => ({}))) as { userId?: string }
  const userId = (body.userId ?? '').trim()
  if (!userId) return NextResponse.json({ error: 'Missing account id.' }, { status: 400 })

  // The auth user is the source of truth for the backfill.
  const { data: got, error: getErr } = await admin.auth.admin.getUserById(userId)
  if (getErr || !got?.user) {
    return NextResponse.json({ error: 'No such auth user.' }, { status: 404 })
  }
  const user = got.user

  // Already has a profile → nothing to do (it is not an orphan any more).
  const { data: existing } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle()
  if (existing) return NextResponse.json({ ok: true, alreadyExists: true })

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const rawRole = typeof meta.role === 'string' ? meta.role.trim().toLowerCase() : ''
  // Map the recorded role to a member role. 'academy' is an ordinary parent
  // account. 'admin' and an absent role are refused — never grant admin from a
  // button, and never invent a role that was not chosen at signup.
  const role: 'tutor' | 'parent' | null =
    rawRole === 'tutor' ? 'tutor' : rawRole === 'parent' || rawRole === 'academy' ? 'parent' : null
  if (!role) {
    return NextResponse.json(
      {
        error:
          rawRole === 'admin'
            ? 'This account signed up as admin — create it from the Team screen, not here.'
            : 'This signup recorded no role, so a profile cannot be created safely. Investigate and backfill manually.',
      },
      { status: 400 },
    )
  }

  const fullName = typeof meta.full_name === 'string' && meta.full_name.trim() ? meta.full_name.trim() : ''
  const email = user.email ?? ''
  const phoneNumber = (user.phone && user.phone.trim()) || mobileFromEmail(user.email ?? null) || ''
  // A synthetic address means a mobile-first signup: hold it on /verify-phone
  // until the number is proven, exactly as signup would have.
  const synthetic = /@users\.tutormint\.org$/i.test(email)

  const result = await ensureProfile(admin, {
    userId,
    role,
    fullName,
    email,
    phoneNumber,
    phoneGateRequired: synthetic,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'orphan.backfill',
    targetType: 'profile',
    targetId: userId,
    detail: { role, email, synthetic },
  })

  return NextResponse.json({ ok: true })
}
