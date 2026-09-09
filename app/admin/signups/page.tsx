import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadAbandonedSignups } from '@/lib/abandonedSignups'
import { loadTemplates } from '@/lib/adminMessaging'
import SignupsClient from './SignupsClient'

// Abandoned signups — the outreach worklist. Registered but never verified, or
// verified but never finished a profile. Each row is messaged on the channel the
// member actually gave (email for an email signup, WhatsApp for a mobile one)
// through the existing Team channel, template-driven, audited and on the member
// timeline. See lib/abandonedSignups.ts and lib/adminMessaging.ts.

export const dynamic = 'force-dynamic'

const SIGNUP_TEMPLATE_KEYS = [
  'signup_email_unconfirmed',
  'signup_mobile_unverified',
  'signup_profile_unfinished',
] as const

export default async function AdminSignupsPage() {
  await requireAdminRole(...SCREEN_ACCESS.signups)
  const [{ rows, ok }, templates] = await Promise.all([loadAbandonedSignups(), loadTemplates()])

  // Pass only the three signup templates the client needs, as a plain map.
  const bodies: Record<string, string> = {}
  for (const t of templates) {
    if ((SIGNUP_TEMPLATE_KEYS as readonly string[]).includes(t.key)) bodies[t.key] = t.body
  }

  return <SignupsClient rows={rows} ok={ok} templateBodies={bodies} />
}
