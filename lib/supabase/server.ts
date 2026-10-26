import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

import { supabaseFetch } from '@/lib/supabase/fetch'
import { createRealClient } from '@/lib/supabase/serverReal'
import { getViewAsContext, type ViewAsContext } from '@/lib/viewAsContext'
import { VIEW_AS_REFUSED_MESSAGE } from '@/lib/viewAsGuardCore'

export { createRealClient } from '@/lib/supabase/serverReal'

/**
 * The cookie-session Supabase client every server component and route handler
 * uses to ask "who is this?" and read as them.
 *
 * "View as" (owner, 27 Oct 2026; lib/viewAsContext): while the Owner views a
 * member's account, this returns a client that answers auth.getUser() with the
 * MEMBER and reads with the service role. Nobody is signed in as the member,
 * and every write is refused before it leaves the server (lib/supabase/fetch).
 * Account actions (password, email, phone, sign-in, sign-out) are refused here
 * as well. Every other request gets the ordinary cookie client, unchanged.
 */
export async function createClient(opts?: { sessionOnly?: boolean }) {
  const ctx = await getViewAsContext()
  if (ctx) return viewAsClient(ctx) as unknown as Awaited<ReturnType<typeof createRealClient>>
  return createRealClient(opts)
}

function viewAsClient(ctx: ViewAsContext): SupabaseClient {
  const client = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: supabaseFetch },
  })
  const auth = client.auth as unknown as Record<string, unknown>
  auth.getUser = async () => ({ data: { user: ctx.user }, error: null })
  auth.getSession = async () => ({ data: { session: null }, error: null })
  const refuse = async () => ({ data: { user: null, session: null }, error: new Error(VIEW_AS_REFUSED_MESSAGE) })
  for (const name of [
    'updateUser',
    'signOut',
    'signInWithPassword',
    'signInWithOtp',
    'signUp',
    'verifyOtp',
    'setSession',
    'refreshSession',
    'resend',
    'resetPasswordForEmail',
    'exchangeCodeForSession',
    'reauthenticate',
  ]) {
    auth[name] = refuse
  }
  return client
}
