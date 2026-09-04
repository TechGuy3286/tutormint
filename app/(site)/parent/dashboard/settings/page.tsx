import type { Metadata } from 'next'
import Link from 'next/link'

import Breadcrumbs from '@/components/Breadcrumbs'
import ChildrenManager, { type Child } from '@/app/(site)/parent/dashboard/ChildrenManager'
import NotificationForm from '@/app/(site)/account/notifications/settings/NotificationForm'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

import SettingsClient, { type ParentSettings } from './SettingsClient'

// Parent settings.
//
// Parents had none. Tutors have had /tutor/dashboard/settings since T4; the
// parent equivalent was never built, so a parent could not add a picture,
// correct a phone number they mistyped at signup, or say which part of a city
// they live in. The only writes available to them were the verification
// submission and the children editor.
//
// WHAT IS AND IS NOT HERE. Name, picture, phone, city, area, address, children
// and email preferences — the things that are theirs to change. CNIC number,
// CNIC image and the verification decision are NOT: those are the verification
// flow's, and an approved identity that could be edited afterwards from a
// settings page would not be an identity check.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Settings | TutorMint',
  robots: { index: false, follow: false },
}

export default async function ParentSettingsPage() {
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  const [{ data: profile }, { data: children }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'full_name, avatar_url, phone_number, phone_verified_at, city, area, address, email, email_opt_out, cnic_verified_at, address_verified_at',
      )
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('children')
      .select('id, name, class_level, notes')
      .eq('parent_id', userId)
      .order('created_at'),
  ])

  const initial: ParentSettings = {
    userId,
    fullName: (profile?.full_name as string) ?? '',
    avatarUrl: (profile?.avatar_url as string) ?? null,
    phone: (profile?.phone_number as string) ?? '',
    phoneVerified: !!profile?.phone_verified_at,
    city: (profile?.city as string) ?? '',
    area: (profile?.area as string) ?? '',
    address: (profile?.address as string) ?? '',
  }

  const verified = !!profile?.cnic_verified_at && !!profile?.address_verified_at

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Breadcrumbs
          items={[{ label: 'Parent dashboard', href: '/parent/dashboard' }, { label: 'Settings' }]}
        />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Settings</h1>
          <p className="text-xs text-gray-500">Your details, your children and what we email you.</p>
        </header>

        <SettingsClient initial={initial} />

        {/* Children keep their own component: it is the same editor the
            dedicated page uses, and two copies would drift. */}
        <section className="space-y-3">
          <ChildrenManager children={(children ?? []) as Child[]} />
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="space-y-0.5">
            <h2 className="text-sm font-black text-tm-navy">Emails</h2>
            <p className="text-[11px] leading-relaxed text-gray-500">
              Going to {(profile?.email as string) ?? 'your address'}.
            </p>
          </div>
          <NotificationForm optedOut={!!profile?.email_opt_out} />
        </section>

        {/* Identity is deliberately a link out, not a form. It is the
            verification flow's to own, and an approved CNIC that could be
            edited here afterwards would not be a verified CNIC. */}
        <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-black text-tm-navy">Identity</h2>
          <p className="text-[11px] leading-relaxed text-gray-500">
            {verified
              ? 'Your CNIC and address are verified. Contact support if any of it needs to change.'
              : 'Your CNIC and address are checked separately before you can post a tuition.'}
          </p>
          <Link
            href="/parent/verify"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
          >
            {verified ? 'View verification' : 'Go to verification'}
          </Link>
        </section>
      </div>
    </main>
  )
}
