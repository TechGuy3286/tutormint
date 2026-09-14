import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadAbandonedSignups } from '@/lib/abandonedSignups'
import { loadOrphanedAccounts } from '@/lib/adminOrphans'
import { loadTemplates } from '@/lib/adminMessaging'
import SignupsClient from './SignupsClient'
import OrphansSection from './OrphansSection'

// Abandoned signups AND orphaned accounts, on one page (owner, 14 Sep 2026).
// They are two DIFFERENT failures and the page keeps them in two sections so it
// never blurs them:
//   Abandoned — a row that expired unverified; never became an account.
//   Orphaned  — an auth.users row with no profiles row; the person can sign in
//               to an app that has no record of them (the Sydney→Mumbai
//               on_auth_user_created failure).
// Each abandoned row is messaged on the channel the member gave; each orphan can
// have its missing profile created from the account's own metadata.

export const dynamic = 'force-dynamic'

const SIGNUP_TEMPLATE_KEYS = [
  'signup_email_unconfirmed',
  'signup_profile_unfinished',
] as const

export default async function AdminSignupsPage() {
  await requireAdminRole(...SCREEN_ACCESS.signups)
  const [{ rows, ok }, orphans, templates] = await Promise.all([
    loadAbandonedSignups(),
    loadOrphanedAccounts(),
    loadTemplates(),
  ])

  // Pass only the signup templates the client needs, as a plain map.
  const bodies: Record<string, string> = {}
  for (const t of templates) {
    if ((SIGNUP_TEMPLATE_KEYS as readonly string[]).includes(t.key)) bodies[t.key] = t.body
  }

  return (
    <div className="space-y-8">
      <SignupsClient rows={rows} ok={ok} templateBodies={bodies} />
      <OrphansSection rows={orphans.rows} ok={orphans.ok} />
    </div>
  )
}
