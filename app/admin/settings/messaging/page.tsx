import { requireAdminRole, roleMayWrite, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import EmailSection from '../email/EmailSection'
import EmailUsageSection from '../email-usage/EmailUsageSection'
import SmsSection from '../sms/SmsSection'

// Admin → Settings → Messaging (owner, 31 Oct 2026): the Email, Email usage and
// SMS pages on one page, whose old addresses redirect here (each to its
// section). Who sees what is unchanged: the page opens to SCREEN_ACCESS.messaging
// (owner, Partner, admin — the old Email page's audience); the usage and SMS
// sections show only to their own lists (owner, Partner), and only the Owner
// may send a test SMS (its route keeps its own check).

export const dynamic = 'force-dynamic'

export default async function MessagingPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.messaging)
  const showUsage = roleSatisfies(actor.adminRole, SCREEN_ACCESS.emailUsage)
  const showSms = roleSatisfies(actor.adminRole, SCREEN_ACCESS.smsHealth)
  const canSendSms = roleMayWrite(actor.adminRole, SCREEN_ACCESS.smsHealth)

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Messaging</h1>
        <p className="text-xs text-gray-500">Email (Resend), daily email usage by type, failures, and SMS. Read only, except the test SMS.</p>
        <nav aria-label="Sections" className="flex flex-wrap gap-2 pt-1">
          <a href="#email" className="inline-flex min-h-[36px] items-center rounded-full border border-gray-200 bg-white px-3 text-[11px] font-bold text-tm-navy hover:border-tm-navy">Email</a>
          {showUsage && <a href="#usage" className="inline-flex min-h-[36px] items-center rounded-full border border-gray-200 bg-white px-3 text-[11px] font-bold text-tm-navy hover:border-tm-navy">Email usage</a>}
          {showSms && <a href="#sms" className="inline-flex min-h-[36px] items-center rounded-full border border-gray-200 bg-white px-3 text-[11px] font-bold text-tm-navy hover:border-tm-navy">SMS</a>}
        </nav>
      </header>
      <EmailSection />
      {showUsage && <EmailUsageSection />}
      {showSms && <SmsSection canSend={canSendSms} />}
    </div>
  )
}
