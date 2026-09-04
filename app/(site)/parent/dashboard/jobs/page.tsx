import Breadcrumbs from '@/components/Breadcrumbs'
import Link from 'next/link'
import { Plus, ShieldCheck } from 'lucide-react'

import FeaturedTag from '@/components/badges/FeaturedTag'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

// The parent's tuitions, in full.
//
// This list used to live inline on the dashboard, where nine jobs took 600px
// and pushed everything below them off the page. It is the same list, on the
// page whose job it is -- the dashboard now shows the count and links here.

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'My tuitions | TutorMint',
  robots: { index: false, follow: false },
}

export default async function ParentJobsPage() {
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, job_tx_id, title, city, status, is_featured, created_at')
    .eq('parent_id', userId)
    .order('created_at', { ascending: false })

  const verified =
    !!session?.profile?.cnic_verified_at && !!session?.profile?.address_verified_at

  // Applicant counts: applications are readable by the job's parent, so the
  // member's own client is enough here.
  const counts = new Map<string, number>()
  const ids = (jobs ?? []).map((j) => j.id as string)
  if (ids.length > 0) {
    const { data: apps } = await supabase
      .from('applications')
      .select('job_id')
      .in('job_id', ids)
      .is('withdrawn_at', null)
    for (const a of apps ?? []) {
      const k = a.job_id as string
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }

  const open = (jobs ?? []).filter((j) => j.status === 'open').length

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Breadcrumbs
          items={[{ label: 'Parent dashboard', href: '/parent/dashboard' }, { label: 'My tuitions' }]}
        />

        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <h1 className="text-xl font-black text-tm-navy sm:text-2xl">My tuitions</h1>
            <p className="text-xs text-gray-500">
              {(jobs ?? []).length === 0
                ? 'Nothing posted yet'
                : `${open} open of ${(jobs ?? []).length}`}
            </p>
          </div>
          {/* An ACTION, not navigation: it creates something. */}
          {verified && (
            <Link
              href="/parent/dashboard/post-job"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-red px-4 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover"
            >
              <Plus aria-hidden size={14} />
              Post a job
            </Link>
          )}
        </header>

        {(jobs ?? []).length === 0 ? (
          <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-6 text-center">
            <p className="text-xs font-bold text-tm-navy">You have not posted a tuition yet</p>
            <p className="mx-auto max-w-sm text-xs leading-relaxed text-gray-500">
              {verified
                ? 'Post what you need and tutors will apply.'
                : 'Once your CNIC and address are approved you can post a job.'}
            </p>
            {!verified && (
              <Link
                href="/parent/verify"
                className="gap-1.5 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-red px-5 text-xs font-bold text-white"
              >
                <ShieldCheck aria-hidden size={14} />
                Verify now
              </Link>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {(jobs ?? []).map((j) => {
              const n = counts.get(j.id as string) ?? 0
              return (
                <li key={j.id as string}>
                  <Link
                    href={`/parent/dashboard/job/${(j.job_tx_id as string) ?? (j.id as string)}`}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="block truncate text-xs font-black text-tm-navy">
                        {j.title as string}
                      </span>
                      <span className="block text-[11px] text-gray-500">
                        {(j.city as string) ?? '—'} ·{' '}
                        {j.status === 'open'
                          ? `${n} applicant${n === 1 ? '' : 's'}`
                          : j.status === 'hired'
                            ? 'Hired'
                            : 'Closed'}
                      </span>
                    </span>
                    {j.is_featured ? <FeaturedTag /> : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </main>
  )
}
