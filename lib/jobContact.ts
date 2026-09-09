import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

// The real-parent contact for a seeded (admin-posted) tuition. It lives in the
// locked `job_contacts` table (migration 65), NOT on the anon-readable jobs row,
// so it can only ever be read here — through the service role, in server code —
// and never leaks into the public job feed, a card, JSON-LD, an OG image or the
// sitemap. Rendered only for a signed-in tutor on the job page, and for admins.

export type JobContact = { name: string | null; phone: string | null }

/** Read the contact for one job, or null when there is none. Service-role. */
export async function loadJobContact(jobId: string): Promise<JobContact | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('job_contacts')
    .select('contact_name, contact_phone')
    .eq('job_id', jobId)
    .maybeSingle()
  if (!data) return null
  const name = ((data.contact_name as string | null) ?? '').trim() || null
  const phone = ((data.contact_phone as string | null) ?? '').trim() || null
  if (!name && !phone) return null
  return { name, phone }
}
