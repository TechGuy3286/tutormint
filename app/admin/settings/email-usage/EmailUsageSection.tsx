import { loadEmailUsage, loadEmailTypes } from '@/lib/email/settings'
import EmailUsageView from './EmailUsageView'

// Admin → Settings → Email usage (owner, 27 Oct 2026): per day (UTC — Resend's
// limit day) and per type, the emails sent, skipped (with the reason), failed
// and held for later, for the last 30 days. Owner only; the Partner views. No
// address is shown.

export default async function EmailUsageSection() {
  const [rows, { dailyLimit }] = await Promise.all([loadEmailUsage(30), loadEmailTypes()])
  return (
    <section id="usage" className="scroll-mt-24">
      <EmailUsageView rows={rows} dailyLimit={dailyLimit} />
    </section>
  )
}
