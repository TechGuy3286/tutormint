import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

// Service-role client. SERVER ONLY.
//
// Used for tables that no browser should ever touch — currently phone_otps,
// which has RLS enabled and deliberately NO policies, so it is unreachable
// with the anon key. OTP codes therefore cannot be read by the account they
// were issued to, which stops the SMS step being bypassed.
//
// Never import this from a client component. The key has no NEXT_PUBLIC_
// prefix, so a client import fails at build rather than leaking it, but the
// rule matters more than the mechanism.
//
// Returns null when the key is absent, so callers can degrade honestly instead
// of crashing. SUPABASE_SERVICE_ROLE_KEY must be added to the Vercel
// environment in T8.

let cached: SupabaseClient | null = null

export function createAdminClient(): SupabaseClient | null {
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null

  cached = createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}
