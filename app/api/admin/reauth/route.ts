import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminActor } from '@/lib/adminAuth'
import { stampReauth } from '@/lib/reauth'
import { rateLimit, tooManyRequests } from '@/lib/rateLimit'
import { parseBody, z } from '@/lib/validate'

// Confirm an admin's password without disturbing their session.
//
// signInWithPassword() on the server client would issue a new session and
// rewrite the auth cookies, which is a lot of moving parts for a yes/no
// question. A SEPARATE, cookie-less client verifies the password and its
// session is thrown away; the admin's own session is untouched.
//
// Rate-limited on the same bucket as login, and by user id rather than by IP:
// this is a password oracle for one specific account, and the account is the
// thing worth budgeting.

const Body = z.object({
  password: z.string().min(1, 'Enter your password.'),
})

export async function POST(request: Request) {
  const actor = await getAdminActor()
  if (!actor) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const limit = await rateLimit('login', `reauth:${actor.id}`)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'attempts')

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  if (!actor.email) {
    return NextResponse.json({ error: 'This account has no email address.' }, { status: 400 })
  }

  // A throwaway client with no cookie storage, so verifying the password
  // cannot replace the session the admin is currently using.
  const { createClient: createRawClient } = await import('@supabase/supabase-js')
  const probe = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { error } = await probe.auth.signInWithPassword({
    email: actor.email,
    password: parsed.data.password,
  })

  if (error) {
    return NextResponse.json({ error: 'That password is not right.' }, { status: 401 })
  }

  // Sign the throwaway session straight back out. It was never written to a
  // cookie, but leaving a valid refresh token alive for no reason is untidy.
  await probe.auth.signOut()

  await stampReauth(actor.id)

  // Confirm the caller is still who the session says, now that a password has
  // been checked against it. Cheap, and it closes the gap where the session
  // changed between getAdminActor() and here.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || user.id !== actor.id) {
    return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  }

  return NextResponse.json({ success: true })
}
