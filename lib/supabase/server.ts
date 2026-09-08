import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { PERSIST_COOKIE, persistOffFrom, applySessionPersistence } from '@/lib/sessionCookies'

export async function createClient(opts?: { sessionOnly?: boolean }) {
  const cookieStore = await cookies()

  // "Publishable key" is the new name for the anon key; fall back to
  // ANON_KEY for environments that still only define the old name.
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // "Remember me": off means session cookies. The login route passes
  // sessionOnly explicitly (the flag cookie is set in the same response, so it
  // is not yet readable here); everything else reads the persisted flag.
  const persistOff = opts?.sessionOnly ?? persistOffFrom(cookieStore.get(PERSIST_COOKIE)?.value)

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach((cookie) => {
              const { name, value, options } = applySessionPersistence(cookie, persistOff)
              cookieStore.set(name, value, options)
            })
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    }
  )
}