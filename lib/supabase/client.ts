import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = 
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL and API Key are missing from environment variables!')
  }

  const client = createBrowserClient(supabaseUrl, supabaseKey)
  // "View as" (owner, 26 Oct 2026): while the Owner views a member's account, an
  // account change (password, email) from the browser is refused here too — the
  // database and the server refuse every other write.
  if (typeof document !== 'undefined' && /(?:^|;\s*)tm_view_as_ui=1/.test(document.cookie)) {
    const refuse = async () => ({ data: { user: null }, error: new Error('Viewing as this member — read only.') })
    ;(client.auth as unknown as { updateUser: unknown }).updateUser = refuse
  }
  return client
}