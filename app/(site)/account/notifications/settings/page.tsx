import Breadcrumbs from '@/components/Breadcrumbs'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import NotificationForm from './NotificationForm'

// Which emails you get.
//
// This moved from /account/notifications to make room for the notification
// LIST, which is what a member clicking "Notifications" is actually looking
// for. Every link to it moved with it — the two in /privacy and the footer of
// every outgoing email in lib/notify/templates.ts — because a settings link
// that lands on a list is a link that has stopped working.
//
// One switch, and it deliberately does not cover everything. Verification
// decisions, payment receipts, plan expiry and moderation outcomes are sent
// whatever this says, and the page states that plainly rather than showing a
// tick box that quietly does nothing. A settings screen that lies about what it
// controls is worse than one with fewer options.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Notification settings | TutorMint',
  robots: { index: false, follow: false },
}

export default async function NotificationSettingsPage() {
  const session = await getSessionUser()
  if (!session) redirect(`/login?next=${encodeURIComponent('/account/notifications/settings')}`)

  const admin = createAdminClient()
  const { data: profile } = admin
    ? await admin
        .from('profiles')
        .select('email, email_opt_out')
        .eq('id', session.user.id)
        .maybeSingle()
    : { data: null }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'Notifications', href: '/account/notifications' },
          { label: 'Email settings' },
        ]}
      />
      <header className="space-y-1">
        <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Notification settings</h1>
        <p className="text-xs text-gray-500">
          Emails go to {profile?.email ?? session.user.email ?? 'your registered address'}.
        </p>
      </header>

      <NotificationForm optedOut={Boolean(profile?.email_opt_out)} />

      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">
          Always sent, whatever you choose
        </h2>
        <ul className="space-y-1.5 text-xs leading-relaxed text-gray-500">
          <li>· Verification decisions on your profile, video, CNIC or address</li>
          <li>· Payment receipts and plan activation</li>
          <li>· A reminder three days before your plan expires, and when it ends</li>
          <li>· Being shortlisted or hired for a tuition you applied to</li>
          <li>· Warnings, suspensions and reinstatements</li>
        </ul>
        <p className="pt-1 text-[11px] leading-relaxed text-gray-500">
          These are the emails you would be worse off missing, so they are not optional. In-app
          notifications are always shown regardless of this setting.
        </p>
      </section>
    </main>
  )
}
