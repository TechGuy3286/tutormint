import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { normaliseStoredContact, type JobContactRecord } from '@/lib/jobContactCore'

// The real poster's contact for a seeded (admin-posted) tuition. It lives in the
// locked `job_contacts` table (migration 65, extended migration 76), NOT on the
// anon-readable jobs row, so it can only ever be read here — through the service
// role, in server code — and never leaks into the public job feed, a card,
// JSON-LD, an OG image or the sitemap. Rendered only for a signed-in tutor on the
// job page, and for admins.

export type JobContact = JobContactRecord

/** Read the contact for one job, or null when there is none. Service-role. */
export async function loadJobContact(jobId: string): Promise<JobContact | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('job_contacts')
    .select('contact_name, contact_phone, contact_whatsapp, contact_email, contact_address, contact_social')
    .eq('job_id', jobId)
    .maybeSingle()
  return normaliseStoredContact(data as Partial<JobContactRecord> | null)
}
