import { createBrowserClient } from '@supabase/ssr'

import { guardFetch, viewAsUiMemberId, VIEW_AS_REFUSED_MESSAGE } from '@/lib/viewAsGuardCore'

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL and API Key are missing from environment variables!')
  }

  // "View as" (owner, 27 Oct 2026; lib/viewAsGuardCore): while the Owner views
  // a member's account the readable tm_view_as_ui cookie holds the member's id.
  // The browser's only session is the Owner's own, so every write from the
  // browser — database, storage, password, email, phone — is refused here, and
  // "who am I" answers with the member so client components ask for the
  // member's rows (read with the Owner's admin rights).
  const viewing = typeof document !== 'undefined' ? viewAsUiMemberId(document.cookie) : null
  const client = viewing
    ? createBrowserClient(supabaseUrl, supabaseKey, { isSingleton: false, global: { fetch: guardFetch((...a) => fetch(...a), () => true) } })
    : createBrowserClient(supabaseUrl, supabaseKey)
  if (viewing) {
    const auth = client.auth as unknown as Record<string, unknown>
    const member = { id: viewing, email: null, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' }
    auth.getUser = async () => ({ data: { user: member }, error: null })
    const refuse = async () => ({ data: { user: null, session: null }, error: new Error(VIEW_AS_REFUSED_MESSAGE) })
    for (const name of ['updateUser', 'signOut', 'signInWithPassword', 'signInWithOtp', 'signUp', 'verifyOtp', 'resend', 'resetPasswordForEmail', 'reauthenticate']) {
      auth[name] = refuse
    }
  }
  return client
}
