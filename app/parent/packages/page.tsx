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
