import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliverEmail } from '@/lib/notify'
import { logActivity } from '@/lib/activityLog'
import { homeForRole, type Role } from '@/lib/authRoutes'

// Supabase email-confirmation callback.
//
// This path previously held the YouTube OAuth handler, which has moved to
// /api/auth/youtube/callback. CLAUDE.md assigns /api/auth/callback to the
// Supabase code exchange, and the YouTube flow is a one-off developer tool for
// minting a refresh token.
// ACTION REQUIRED: update YOUTUBE_REDIRECT_URI and the Authorised redirect URI
// in the Google Cloud console to the new path before using that flow again.

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  // An EXPLICIT, same-origin next only (password-reset sends one). A signup
  // confirmation link carries none, so this is null there and the role decides.
  const explicitNext = searchParams.get('next')
  const safeExplicit =
    explicitNext && explicitNext.startsWith('/') && !explicitNext.startsWith('//')
      ? explicitNext
      : null

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`)
  }

  // The welcome email is sent here rather than at sign-up, and once only.
  //
  // At sign-up we do not yet know the address is real -- that is exactly what
  // the confirmation link proves -- and mailing unconfirmed addresses is how a
  // sending domain's reputation gets spent. Sending it from a route the user
  // reaches by clicking a link in their own inbox also means it cannot be
  // triggered by anyone else on their behalf.
  //
  // welcomed_at makes it once-only: this callback also runs on a magic-link or
  // password-recovery exchange, and a second welcome to someone who has been a
  // member for a month reads as a bug, because it is one. The return value is
  // true only on the FIRST confirmation, which is exactly the email verification
  // we want to confirm on screen (see ?verified=email below).
  const firstConfirmation = await sendWelcomeOnce()

  // The email path chose a role at /register; it must drive the landing page,
  // not silently fall to '/'. When the link carried no explicit next, route by
  // the role written at signup (ensureProfile). A role-less profile would be a
  // bug — fall back to the neutral homepage rather than silently picking parent.
  let dest = safeExplicit
  if (!dest) {
    const role = await currentRole()
    try {
      dest = homeForRole(role)
    } catch {
      dest = '/'
    }
  }

  // No silent transitions (owner, 9 Sep): the confirmation link is the moment
  // the email is verified, and clicking it used to drop the member on a
  // dashboard with nothing said. On the genuine first confirmation of a signup
  // (no explicit next — a password reset carries one), hand the dashboard a
  // one-time flag so it toasts "Your email is confirmed". Not added on a magic
  // link or a repeat click (firstConfirmation is false then).
  const verifiedParam = !safeExplicit && firstConfirmation
  const url = new URL(`${origin}${dest}`)
  if (verifiedParam) url.searchParams.set('verified', 'email')

  return NextResponse.redirect(url.toString())
}

/** The signed-in member's role, read through the service role, or null. */
async function currentRole(): Promise<Role | null> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    const admin = createAdminClient()
    if (!admin) return null
    const { data } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    return (data?.role as Role) ?? null
  } catch {
    return null
  }
}

/** True only on the FIRST confirmation (welcome just sent); false on a repeat
 *  callback (magic link, password recovery, an already-welcomed member). */
async function sendWelcomeOnce(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return false

    const admin = createAdminClient()
    if (!admin) return false

    const { data: profile } = await admin
      .from('profiles')
      .select('full_name, role, welcomed_at')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile || profile.welcomed_at) return false

    // Stamped before sending, not after. A retry storm here would mail the
    // same person repeatedly; one lost welcome is a far smaller problem than
    // ten delivered ones.
    await admin.from('profiles').update({ welcomed_at: new Date().toISOString() }).eq('id', user.id)

    await deliverEmail(
      { userId: user.id },
      {
        id: 'welcome',
        name: (profile.full_name as string) ?? 'there',
        role: (profile.role as 'tutor' | 'parent' | 'admin' | null) ?? null,
      },
    )

    await logActivity({ userId: user.id, event: 'email_confirmed' })
    return true
  } catch (e) {
    // Never let a welcome email stop somebody from getting into their account.
    console.error('[auth/callback] welcome email failed', e)
    return false
  }
}
