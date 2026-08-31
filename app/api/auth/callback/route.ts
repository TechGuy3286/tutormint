import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

  return NextResponse.redirect(`${origin}${safeNext}`)
}
