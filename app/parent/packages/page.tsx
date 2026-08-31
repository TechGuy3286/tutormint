import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getViewerEntitlements } from '@/lib/entitlements'
import PackagesTable, { type PlanRow } from '@/components/PackagesTable'

// Parent plan comparison. Same reasoning as the tutor page: the "Unlock with
// Featured" row on a tutor profile has to land somewhere that tells the truth
// about what Featured costs and what it does.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Parent packages | TutorMint',
  description:
    'Verified and Featured plans for parents on TutorMint: job posting quotas, tutor contact access and hiring.',
}

export default async function ParentPackagesPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('plans')
    .select('code, name, price_pkr, displayed_quota, can_view_contact, can_whatsapp, can_initiate_message, can_hire, badges')
    .eq('audience', 'parent')
    .order('price_pkr')

  const ent = await getViewerEntitlements()

  return (
    <main className="min-h-screen bg-[#F8FAFC] px-4 py-6 text-[#334155] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="space-y-1">
          <h1 className="text-xl font-black text-[#0F172A] sm:text-2xl">Parent packages</h1>
          <p className="text-xs text-gray-500">
            Verified is free once your CNIC and address are approved. Featured adds tutor contact
            details and the ability to complete a hire.
          </p>
        </header>
        <PackagesTable
          plans={(data ?? []) as PlanRow[]}
          audience="parent"
          currentPlan={ent?.plan ?? null}
          quotaNoun="job posts"
        />
      </div>
    </main>
  )
}
