import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliverEmail } from '@/lib/notify'
import { logActivity } from '@/lib/activityLog'

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
  const next = searchParams.get('next') ?? '/'

  // Only same-origin paths, never an absolute URL from the query string.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'

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
  // member for a month reads as a bug, because it is one.
  await sendWelcomeOnce()

  return NextResponse.redirect(`${origin}${safeNext}`)
}

async function sendWelcomeOnce(): Promise<void> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const admin = createAdminClient()
    if (!admin) return

    const { data: profile } = await admin
      .from('profiles')
      .select('full_name, role, welcomed_at')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile || profile.welcomed_at) return

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
  } catch (e) {
    // Never let a welcome email stop somebody from getting into their account.
    console.error('[auth/callback] welcome email failed', e)
  }
}
