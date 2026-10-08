import 'server-only'
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'

// Test-named accounts (owner, 8 Oct 2026): any account whose name contains the
// whole word "test", or is exactly "New User" (profiles.is_test_name, migration
// 154). They still work for testing, but never reach Browse, search, landing
// pages, the sitemap, the Overview counts or the funnel. tutor_directory and the
// landing/sitemap SQL exclude them in the database; this list is for the few
// reads that filter tuitions by their poster.

export const testAccountIds = cache(async (): Promise<string[]> => {
  const admin = createAdminClient()
  if (!admin) return []
  try {
    const rows = await pageAll((from, to) =>
      admin.from('profiles').select('id').eq('is_test_name', true).order('id').range(from, to),
    )
    return rows.map((r) => r.id as string)
  } catch {
    return []
  }
})
