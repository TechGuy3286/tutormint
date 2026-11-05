import type { Metadata } from 'next'
import Link from 'next/link'

import Breadcrumbs from '@/components/Breadcrumbs'
import ChildrenManager, { type Child } from '@/app/(site)/parent/dashboard/ChildrenManager'
import NotificationForm from '@/app/(site)/account/notifications/settings/NotificationForm'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { isSyntheticEmail, formatPkMobile } from '@/lib/phone'

import SettingsClient, { type ParentSettings } from './SettingsClient'
import { formatName } from '@/lib/formatName'
import MemberLockBox from '@/components/account/MemberLockBox'
import { maskCnic } from '@/lib/cnic'
import { cnicLocked } from '@/lib/memberLocksCore'

// Parent Edit Profile (was "Settings"; renamed 4 Nov 2026 — the address is unchanged).
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
  title: 'Edit Profile | TutorMint',
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
        'full_name, cnic_name, display_name, avatar_url, phone_number, phone_verified_at, city, area, address, email, email_opt_out, cnic_verified_at, address_verified_at, cnic_number, verification_state',
      )
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('children')
      .select('id, name, class_level, notes')
      .eq('parent_id', userId)
      .order('created_at'),
  ])

  // A synthetic <msisdn>@users.tutormint.org address is not one the member
  // chose — it reads as empty so the card offers "Add an email".
  const rawEmail = (profile?.email as string) ?? ''
  const realEmail = isSyntheticEmail(rawEmail) ? '' : rawEmail

  const initial: ParentSettings = {
    userId,
    // Two names (owner, 5 Nov 2026): fullName is the Name on CNIC here.
    fullName: formatName(((profile?.cnic_name ?? profile?.full_name) as string | null) ?? null),
    displayName: formatName((profile?.display_name as string | null) ?? null),
    cnicNameLocked: !!profile?.cnic_verified_at || String(profile?.verification_state ?? '').toLowerCase() === 'approved',
    avatarUrl: (profile?.avatar_url as string) ?? null,
    // Shown as 0321 1045245 (owner PR8 §4.1); storage stays 92XXXXXXXXXX and the
    // server re-normalises on save. Change-detection compares national digits, so
    // the display form does not trip a false "changed".
    phone: formatPkMobile((profile?.phone_number as string) ?? ''),
    phoneVerified: !!profile?.phone_verified_at,
    email: realEmail,
    city: (profile?.city as string) ?? '',
    area: (profile?.area as string) ?? '',
    address: (profile?.address as string) ?? '',
  }

  const verified = !!profile?.cnic_verified_at && !!profile?.address_verified_at
  // Only the mobile, the CNIC and the email are locked (owner, 4 Nov 2026).
  const cnicIsLocked = cnicLocked({ cnicVerifiedAt: (profile?.cnic_verified_at as string | null) ?? null, verificationState: (profile?.verification_state as string | null) ?? null })

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Breadcrumbs
          items={[{ label: 'Parent dashboard', href: '/parent/dashboard' }, { label: 'Edit Profile' }]}
        />
        {/* Heading removed (PR61 §A1) — the breadcrumb stays. */}

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
              {realEmail ? `Going to ${realEmail}.` : 'Add an email above to receive receipts and reminders.'}
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
              ? 'Your CNIC and address are verified. You can change your address on the verification page.'
              : 'Optional. Add your CNIC and home address to earn the green Verified badge. A verified mobile is all you need to post tuitions, message tutors and request demos.'}
          </p>
          {cnicIsLocked && <MemberLockBox field="cnic" value={maskCnic(profile?.cnic_number as string | null)} />}
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
