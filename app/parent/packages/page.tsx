import Breadcrumbs from '@/components/Breadcrumbs'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getViewerEntitlements } from '@/lib/entitlements'
import { getProvider } from '@/lib/payments'
import PackagesTable, { type PlanRow } from '@/components/PackagesTable'

// Parent plan comparison and checkout.
//
// Only one plan here is bought. Verified is free and earned by CNIC + address
// approval, so its card links to verification rather than to a checkout --
// selling something that is already free would be the worst kind of upsell.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Parent packages | TutorMint',
  description:
    'Verified and Featured plans for parents on TutorMint: job posting quotas, tutor contact access and hiring.',
}

export default async function ParentPackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>
}) {
  const { plan: highlight } = await searchParams

  const supabase = await createClient()
  const { data } = await supabase
    .from('plans')
    .select(
      'code, name, price_pkr, monthly_quota, displayed_quota, can_view_contact, can_whatsapp, can_initiate_message, can_hire, can_see_viewer_identity, search_rank, badges, tag_label',
    )
    .eq('audience', 'parent')
    .order('price_pkr')

  const ent = await getViewerEntitlements()
  const provider = getProvider()

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <Breadcrumbs items={[{ label: 'Parent dashboard', href: '/parent/dashboard' }, { label: 'Packages' }]} />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Parent packages</h1>
          <p className="text-xs text-gray-500">
            Verified is free once your CNIC and address are approved. Featured adds tutor contact
            details and the ability to complete a hire.
          </p>
        </header>

        {/* What a parent is actually comparing this against. An academy's cut
            is the real alternative in Lahore and Karachi, and it is a number
            they can check against their own last hire. */}
        <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed sm:p-5">
          <p className="text-slate-700">
            <strong className="text-tm-navy">An academy takes half your first month&apos;s fee.</strong>{' '}
            On a Rs 20,000 tuition that is Rs 10,000 gone before the first class, and many keep a
            share every month after. Featured is Rs 999 a month and you keep every rupee of what
            you pay the tutor — we never touch the fee and never take a commission.
          </p>
          <p className="text-gray-500">
            Browsing, messaging tutors, demo requests and five job posts a month stay free once
            your CNIC and address are approved. Memberships are not refundable.
          </p>
        </section>

        <PackagesTable
          plans={(data ?? []) as PlanRow[]}
          audience="parent"
          currentPlan={ent?.plan ?? null}
          expiresAt={ent?.expiresAt ?? null}
          highlight={highlight ?? null}
          quotaNoun="job posts"
          instantActivation={provider.id !== 'manual'}
          signedIn={!!ent}
        />
      </div>
    </main>
  )
}
