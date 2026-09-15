import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

import Breadcrumbs from '@/components/Breadcrumbs'
import { getViewerEntitlements } from '@/lib/entitlements'
import { buildGate } from '@/lib/gate'
import VerifyClient from './VerifyClient'

// The one-time Rs 199 verification flow, as a page (owner, Part 4). Tutors reach
// the same flow from the apply-gate sheet; this is the standalone route the
// account menu, the packages "Get verified" button, and the gate href point to.
//
// A tutor who has already paid the fee (any plan) has nothing to do here → sent
// to the dashboard. A signed-out visitor is sent to sign in first.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Get verified | TutorMint',
  robots: { index: false, follow: true },
}

export default async function TutorVerifyPage() {
  const ent = await getViewerEntitlements()
  if (!ent) redirect('/login?next=/tutor/verify')
  if (ent.audience !== 'tutor') redirect('/')
  // Already verified/on a plan — the fee is paid, nothing to do.
  if (ent.plan) redirect('/tutor/dashboard')

  const gate = await buildGate('tutor_verify', ent)

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-md space-y-4">
        <Breadcrumbs items={[{ label: 'Tutor dashboard', href: '/tutor/dashboard' }, { label: 'Get verified' }]} />
        <div className="rounded-3xl border border-gray-200 bg-white p-5 sm:p-6">
          <h1 className="text-base font-black leading-tight text-tm-navy">{gate.title}</h1>
          <VerifyClient />
        </div>
      </div>
    </main>
  )
}
