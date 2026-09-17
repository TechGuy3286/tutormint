import Link from 'next/link'
import Breadcrumbs from '@/components/Breadcrumbs'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getViewerEntitlements } from '@/lib/entitlements'
import { getProvider } from '@/lib/payments'
import PackagesTable, { type PlanRow } from '@/components/PackagesTable'
import PackagesTabs from '@/components/packages/PackagesTabs'
import VerifiedPreview from '@/components/packages/VerifiedPreview'
import { hiresThisMonth } from '@/lib/funnel'

// The ONE packages page (owner PR13 §1). A Tutors tab and a Parents tab, each
// rendering its cards from the plans table — one source, no prices or features
// typed into the components. Reached logged-in or out; /tutor/packages and
// /parent/packages 308 here (next.config), and every link points here.
//
// A price/conversion page reached by a member's own click, not organic content:
// crawlable (so footer/about/faq links do not 404 to a crawler) but never
// indexed.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Packages | TutorMint',
  description:
    'Plans for tutors and parents on TutorMint — application and posting quotas, search ranking, badges and contact access.',
  robots: { index: false, follow: true },
}

const PLAN_COLS =
  'code, name, price_pkr, monthly_quota, displayed_quota, can_view_contact, can_whatsapp, can_initiate_message, can_hire, can_see_viewer_identity, search_rank, badges, tag_label'

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ for?: string; plan?: string }>
}) {
  const { for: forParam, plan: highlight } = await searchParams

  const supabase = await createClient()
  const ent = await getViewerEntitlements()

  const [{ data: tutorPlans }, { data: parentPlans }] = await Promise.all([
    supabase.from('plans').select(PLAN_COLS).eq('audience', 'tutor').eq('active', true).order('price_pkr'),
    supabase.from('plans').select(PLAN_COLS).eq('audience', 'parent').eq('active', true).order('price_pkr'),
  ])

  const provider = getProvider()
  const instant = provider.id !== 'manual'

  // §1.1: a signed-in tutor opens on Tutors, a parent on Parents, a logged-out
  // visitor on Tutors; ?for= overrides.
  const initialTab: 'tutors' | 'parents' =
    forParam === 'parents'
      ? 'parents'
      : forParam === 'tutors'
        ? 'tutors'
        : ent?.audience === 'parent'
          ? 'parents'
          : 'tutors'

  // The current plan / verified state applies to the tab that matches the
  // viewer's own audience; a parent viewing the Tutors tab holds no tutor plan.
  const tutorCurrent = ent?.audience === 'tutor' ? ent.plan ?? null : null
  const tutorExpires = ent?.audience === 'tutor' ? ent.expiresAt ?? null : null
  const tutorVerified = ent?.audience === 'tutor' && !!ent.plan
  const parentCurrent = ent?.audience === 'parent' ? ent.plan ?? null : null
  const parentExpires = ent?.audience === 'parent' ? ent.expiresAt ?? null : null
  const parentVerified = ent?.audience === 'parent' && !!ent.plan

  // The tutor's own preview card, only for a signed-in tutor who has no plan yet.
  const showPreview = ent?.audience === 'tutor' && !ent.plan
  let viewerName = 'Your name'
  let viewerCity: string | null = null
  if (showPreview && ent) {
    const { data: me } = await supabase
      .from('tutor_profiles')
      .select('full_name, city')
      .eq('id', ent.userId)
      .maybeSingle()
    viewerName = (me?.full_name as string) ?? 'Your name'
    viewerCity = (me?.city as string) ?? null
  }
  const hires = await hiresThisMonth()

  const tutorPanel = (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        Your plan decides how many jobs you can apply to, where you rank in search, and which badges
        parents see.
      </p>

      {/* The way onto the platform for a tutor who is not verified yet. The
          price is NOT here — it is on the payment page, one tap past Verify.
          Just the step and the one permitted visibility claim. */}
      {ent?.audience === 'tutor' && !ent.plan && (
        <section className="space-y-2 rounded-2xl border border-tm-navy/20 bg-tm-tint-navy p-4 text-xs leading-relaxed sm:p-5">
          <p className="text-base font-black text-tm-navy">Get verified to be found</p>
          <p className="text-tm-navy">
            Upload your CNIC to become a verified tutor and appear in search. Verified tutors are
            shown to parents first. After that you are on the free Basic plan; Premium and Featured
            below add more.
          </p>
          <Link
            href="/tutor/verify"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-red px-6 text-xs font-bold text-white hover:bg-tm-red-hover"
          >
            Verify
          </Link>
        </section>
      )}

      {showPreview && <VerifiedPreview name={viewerName} city={viewerCity} />}

      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed sm:p-5">
        {hires > 0 && (
          <p className="font-black text-tm-navy">
            {hires === 1 ? '1 tutor was hired' : `${hires} tutors were hired`} on TutorMint this
            month.
          </p>
        )}
        <p className="text-slate-700">
          <strong className="text-tm-navy">An academy keeps half your first month.</strong> On a Rs
          20,000 tuition that is Rs 10,000 out of your first month, every time, and many keep a
          share of every month after. TutorMint takes 0% of what you earn, forever.
        </p>
        <p className="text-gray-500">
          Being verified is what gets you listed. Whether a parent picks you depends on your profile,
          your reply and your experience.
        </p>
      </section>

      <PackagesTable
        plans={(tutorPlans ?? []) as PlanRow[]}
        audience="tutor"
        currentPlan={tutorCurrent}
        expiresAt={tutorExpires}
        highlight={highlight ?? null}
        instantActivation={instant}
        signedIn={!!ent}
        verified={tutorVerified}
      />

      <section className="rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed text-gray-500 sm:p-5">
        <Link href="/faq#tutors" className="font-bold text-tm-red hover:underline">
          What the Verified badge proves
        </Link>
        {' · '}
        <Link href="/browse/tuitions" className="font-bold text-tm-red hover:underline">
          The tuitions you could apply to
        </Link>
        {' · '}
        <Link href="/tutor/complete-profile" className="font-bold text-tm-red hover:underline">
          Finish your profile first
        </Link>
        {' · '}
        <Link href="/terms" className="font-bold text-tm-red hover:underline">
          Terms, including no refunds
        </Link>
      </section>
    </div>
  )

  const parentPanel = (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        Verified is free once your CNIC and address are approved. Featured adds tutor contact details
        and the ability to complete a hire.
      </p>

      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed sm:p-5">
        <p className="text-slate-700">
          <strong className="text-tm-navy">An academy takes half your first month&apos;s fee.</strong>{' '}
          On a Rs 20,000 tuition that is Rs 10,000 gone before the first class, and many keep a share
          every month after. You keep every rupee of what you pay the tutor — we never touch the fee
          and never take a commission.
        </p>
        <p className="text-gray-500">
          Browsing, messaging tutors, demo requests and five job posts a month stay free once your
          CNIC and address are approved. Memberships are not refundable.
        </p>
      </section>

      <PackagesTable
        plans={(parentPlans ?? []) as PlanRow[]}
        audience="parent"
        currentPlan={parentCurrent}
        expiresAt={parentExpires}
        highlight={highlight ?? null}
        instantActivation={instant}
        signedIn={!!ent}
        verified={parentVerified}
      />

      <section className="rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed text-gray-500 sm:p-5">
        <Link href="/faq#parents" className="font-bold text-tm-red hover:underline">
          What the badges mean
        </Link>
        {' · '}
        <Link href="/parent/verify" className="font-bold text-tm-red hover:underline">
          Verify your CNIC and address (free)
        </Link>
        {' · '}
        <Link href="/browse/tutors" className="font-bold text-tm-red hover:underline">
          Browse tutors
        </Link>
        {' · '}
        <Link href="/terms" className="font-bold text-tm-red hover:underline">
          Terms, including no refunds
        </Link>
      </section>
    </div>
  )

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <Breadcrumbs items={[{ label: 'Packages' }]} />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Packages</h1>
          <p className="text-xs text-gray-500">
            Choose the tab that fits you — the plans for tutors and for parents.
          </p>
        </header>

        <PackagesTabs initialTab={initialTab} tutorPanel={tutorPanel} parentPanel={parentPanel} />
      </div>
    </main>
  )
}
