import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadEmailUsage, loadEmailTypes } from '@/lib/email/settings'
import EmailUsageView from './EmailUsageView'

// Admin → Settings → Email usage (owner, 27 Oct 2026): per day (UTC — Resend's
// limit day) and per type, the emails sent, skipped (with the reason), failed
// and held for later, for the last 30 days. Owner only; the Partner views. No
// address is shown.

export const dynamic = 'force-dynamic'

export default async function EmailUsagePage() {
  await requireAdminRole(...SCREEN_ACCESS.emailUsage)
  const [rows, { dailyLimit }] = await Promise.all([loadEmailUsage(30), loadEmailTypes()])
  return <EmailUsageView rows={rows} dailyLimit={dailyLimit} />
}
