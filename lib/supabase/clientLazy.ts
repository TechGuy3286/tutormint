'use client'

import type { SupabaseClient } from '@supabase/supabase-js'

// The browser Supabase client, loaded ON DEMAND (owner, 6 Oct 2026 — site speed).
//
// `@supabase/ssr` + `@supabase/supabase-js` (with the realtime WebSocket client)
// is a 246 KB module. Every client component that imported `lib/supabase/client`
// STATICALLY pulled it into the page's initial JavaScript — including the header
// (NotificationBell, UserMenu) that sits in the (site) layout, so every public
// page, signed out, downloaded and parsed it and used none of it (Lighthouse:
// 100% unused on the tuition page and the blog post). A dynamic import() lets
// the bundler split it into its own chunk, fetched the first time something
// actually needs a client: a filter bar loading its options after hydration, the
// bell subscribing for a signed-in member, a sign-out.
//
// One shared promise, so concurrent callers (three filter hooks mounting at
// once) load the chunk once and share the client.

let clientPromise: Promise<SupabaseClient> | null = null

export function getBrowserClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = import('./client').then((m) => m.createClient() as SupabaseClient)
    // A failed load (offline, blocked) must not poison every later call.
    clientPromise.catch(() => {
      clientPromise = null
    })
  }
  return clientPromise
}
