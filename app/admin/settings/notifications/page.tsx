import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadEmailTypes } from '@/lib/email/settings'
import EmailTypeSwitches from './EmailTypeSwitches'
import OtpAlertSettings from './OtpAlertSettings'
import { loadOtpAlertSettings } from '@/lib/otpAlerts'

// Admin → Settings → Notification settings (owner, 27 Oct 2026). Which emails
// TutorMint sends. Owner only; the Partner views; everyone else is sent away.
// Staff and admin alerts are always in the bell; their email is off by default
// (the bank-transfer alert to the Owner is on). Every change is in Audit.

export const dynamic = 'force-dynamic'

export default async function NotificationSettingsPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.notificationSettings)
  const [{ types, dailyLimit }, otp] = await Promise.all([loadEmailTypes(), loadOtpAlertSettings()])
  return (
    <div className="mx-auto max-w-xl space-y-5" data-notification-settings="">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Notification settings</h1>
        <p className="text-xs text-gray-500">Which emails TutorMint sends. Turning one off never removes anything from the bell.</p>
      </header>
      {otp && <OtpAlertSettings initial={otp} canEdit={actor.adminRole === 'owner'} />}
      <EmailTypeSwitches types={types} dailyLimit={dailyLimit} />
    </div>
  )
}
