import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getViewerEntitlements } from '@/lib/entitlements'
import { getProvider } from '@/lib/payments'
import PackagesTable, { type PlanRow } from '@/components/PackagesTable'

// Tutor plan comparison and checkout.
//
// Plan rows are read live, so the prices and quotas shown are the ones
// lib/entitlements.ts enforces. ?plan= highlights the card that whichever
// upgrade prompt sent the tutor here is actually about -- a tutor who ran out
// of applications arrives with Premium picked out rather than facing three
// equal cards.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Tutor packages | TutorMint',
  description:
    'Verified, Premium and Featured plans for tutors on TutorMint: application quotas, search ranking, badges and parent contact access.',
}

export default async function TutorPackagesPage({
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
    .eq('audience', 'tutor')
    .order('price_pkr')

  const ent = await getViewerEntitlements()
  const provider = getProvider()

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Tutor packages</h1>
          <p className="text-xs text-gray-500">
            Your plan decides how many jobs you can apply to, where you rank in search, and which
            badges parents see.
          </p>
          {ent && !ent.profileComplete && (
            <p className="rounded-xl bg-tm-tint-gold p-3 text-[11px] leading-relaxed text-tm-gold-ink">
              You can buy a plan now, but badges stay hidden until your profile reaches 100% and
              your video is approved. Nothing is lost — the badge appears the moment you get there.
            </p>
          )}
        </header>

        <PackagesTable
          plans={(data ?? []) as PlanRow[]}
          audience="tutor"
          currentPlan={ent?.plan ?? null}
          expiresAt={ent?.expiresAt ?? null}
          highlight={highlight ?? null}
          quotaNoun="job applications"
          instantActivation={provider.id !== 'manual'}
          signedIn={!!ent}
        />
      </div>
    </main>
  )
}
