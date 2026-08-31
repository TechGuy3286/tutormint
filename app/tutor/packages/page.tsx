import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getViewerEntitlements } from '@/lib/entitlements'
import PackagesTable, { type PlanRow } from '@/components/PackagesTable'

// Tutor plan comparison. Checkout is T6; this page exists now because the
// dashboard, the locked contact row and the house ads all need somewhere
// honest to point. It reads live plan rows, so the prices and quotas shown
// are the ones the entitlements layer enforces.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Tutor packages | TutorMint',
  description:
    'Verified, Premium and Featured plans for tutors on TutorMint: application quotas, search ranking, badges and parent contact access.',
}

export default async function TutorPackagesPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('plans')
    .select('code, name, price_pkr, displayed_quota, can_view_contact, can_whatsapp, can_initiate_message, can_hire, badges')
    .eq('audience', 'tutor')
    .order('price_pkr')

  const ent = await getViewerEntitlements()

  return (
    <main className="min-h-screen bg-[#F8FAFC] px-4 py-6 text-[#334155] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="space-y-1">
          <h1 className="text-xl font-black text-[#0F172A] sm:text-2xl">Tutor packages</h1>
          <p className="text-xs text-gray-500">
            Your plan decides how many jobs you can apply to, where you rank in search, and which
            badges parents see.
          </p>
        </header>
        <PackagesTable
          plans={(data ?? []) as PlanRow[]}
          audience="tutor"
          currentPlan={ent?.plan ?? null}
          quotaNoun="job applications"
        />
      </div>
    </main>
  )
}
