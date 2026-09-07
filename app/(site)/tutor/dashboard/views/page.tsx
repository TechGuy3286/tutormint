import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

import Breadcrumbs from '@/components/Breadcrumbs'
import TimeAgo from '@/components/TimeAgo'
import ViewerFace from '@/components/dashboard/ViewerFace'
import UpgradeTrigger from '@/components/upgrade/UpgradeTrigger'
import { getSessionUser } from '@/lib/auth'
import { getEntitlements } from '@/lib/entitlements'
import { viewSummary } from '@/lib/profileViews'

// Everyone who has opened this tutor's profile.
//
// The dashboard card is a summary and a button; this is where the button goes.
// It exists because "See who" has to lead somewhere real: a card that expands
// into six rows in place is the list the card was written to replace, and a
// button that opens a modal of the same rows is that list with an extra tap.
//
// IDENTITY IS STILL WITHHELD IN SERVER CODE. viewSummary() is passed
// `ent.canSeeViewerIdentity` and does the redaction itself — a free tutor is
// sent no name and no avatar URL, so this page is the same page for both, and
// the difference is in what the server decided to put in it. Reaching this URL
// without the plan shows the same rows the card does, plus the offer.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Who looked at you | TutorMint',
  robots: { index: false, follow: false },
}

export default async function ProfileViewsPage() {
  const session = await getSessionUser()
  if (!session) redirect('/login?next=/tutor/dashboard/views')
  if (session.profile?.role !== 'tutor') redirect('/')

  const ent = await getEntitlements(session.user.id)
  const views = await viewSummary(session.user.id, ent.canSeeViewerIdentity, 60)

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Breadcrumbs
          items={[
            { label: 'Tutor dashboard', href: '/tutor/dashboard' },
            { label: 'Who looked at you' },
          ]}
        />

        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Who looked at you</h1>
          <p className="text-xs text-gray-500">
            {views.total} {views.total === 1 ? 'view' : 'views'} in total
            {views.thisWeek > 0 ? ` · ${views.thisWeek} this week` : ''}
          </p>
        </header>

        {!ent.canSeeViewerIdentity && views.total > 0 && (
          <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-xs leading-relaxed text-slate-700">
              These are real people who opened your profile. Premium shows their name and photo,
              alongside the subject and area they searched for.
            </p>
            <UpgradeTrigger
              reason="tutor_viewer_identity"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-gold px-5 text-xs font-black text-tm-navy transition-opacity hover:opacity-90"
            >
              See who
            </UpgradeTrigger>
          </section>
        )}

        {views.teasers.length === 0 ? (
          <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs leading-relaxed text-gray-500">
            No profile views yet. Views appear here as parents find you in search.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            {views.teasers.map((t) => (
              <li key={t.id} className="flex items-center gap-3 p-3 sm:p-4">
                <ViewerFace
                  identified={t.identified}
                  name={t.text.split(' ')[0]}
                  avatarUrl={t.avatarUrl}
                  seed={t.id}
                />
                <p
                  className={`min-w-0 flex-1 text-xs leading-relaxed ${
                    t.identified ? 'font-bold text-tm-navy' : 'text-slate-700'
                  }`}
                >
                  {t.text}
                </p>
                <span className="shrink-0 text-[10px] text-gray-500">
                  <TimeAgo iso={t.at} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
