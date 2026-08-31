import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

// An anon-key client with no cookie session attached.
//
// For pages that are the same for everybody -- the sitemap, and anything else
// that must stay cacheable. Reading cookies() would force those routes to be
// dynamic on every request for no benefit, since there is no user to vary on.
//
// It has exactly the anon role's rights: RLS applies, and the public read
// paths (tutor_directory, the SECURITY DEFINER functions, open jobs) are all
// it can reach.

let cached: SupabaseClient | null = null

export function createPublicClient(): SupabaseClient {
  if (cached) return cached

  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  cached = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}
