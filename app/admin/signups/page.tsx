import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadAbandonedSignups } from '@/lib/abandonedSignups'
import { loadOrphanedAccounts } from '@/lib/adminOrphans'
import { loadTemplates } from '@/lib/adminMessaging'
import SignupsClient from './SignupsClient'
import { loadFollowUpStates } from '@/lib/followUps'
import { followUpLine } from '@/lib/followUpCore'
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

  // The shared follow-up record (owner, 9 Oct 2026).
  const now = Date.now()
  const states = await loadFollowUpStates(rows.map((r) => r.userId))
  const followUps: Record<string, { sent: boolean; line: string | null; tag: string | null }> = {}
  for (const r of rows) {
    const st = states.get(r.userId)
    if (st) followUps[r.userId] = { sent: st.sent, line: followUpLine(st, now), tag: st.tag }
  }

  return (
    <div className="space-y-8">
      <SignupsClient rows={rows} ok={ok} templateBodies={bodies} followUps={followUps} />
      <OrphansSection rows={orphans.rows} ok={orphans.ok} />
    </div>
  )
}
