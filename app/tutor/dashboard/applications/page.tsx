import Breadcrumbs from '@/components/Breadcrumbs'
import Link from 'next/link'

import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// The tutor's own applications.
//
// There was no such screen. A tutor could apply from three places and then had
// nowhere to see what they had applied to -- the dashboard only used the ids
// to grey out an Apply button. The dashboard now counts them and links here.

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'My applications | TutorMint',
  robots: { index: false, follow: false },
}

const STATUS: Record<string, { label: string; className: string }> = {
  applied: { label: 'Awaiting the parent', className: 'bg-tm-tint-navy text-tm-navy' },
  shortlisted: { label: 'Shortlisted', className: 'bg-tm-tint-gold text-tm-gold-ink' },
  hired: { label: 'Hired', className: 'bg-tm-tint-green text-tm-green-deep' },
  rejected: { label: 'Not selected', className: 'bg-tm-tint-red text-tm-red-hover' },
}

export default async function TutorApplicationsPage() {
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  const { data: apps } = await supabase
    .from('applications')
    .select('id, job_id, status, created_at, withdrawn_at')
    .eq('tutor_id', userId)
    .order('created_at', { ascending: false })

  // Job titles through the service-role client: these are reads by id, outside
  // the browse view that makes open jobs public.
  const jobs = new Map<string, { title: string; city: string | null; ref: string }>()
  const ids = Array.from(new Set((apps ?? []).map((a) => a.job_id as string)))
  if (ids.length > 0) {
    const admin = createAdminClient()
    if (admin) {
      const { data: rows } = await admin
        .from('jobs')
        .select('id, job_tx_id, title, city')
        .in('id', ids)
      for (const j of rows ?? []) {
        jobs.set(j.id as string, {
          title: (j.title as string) ?? 'Tuition',
          city: (j.city as string) ?? null,
          ref: ((j.job_tx_id as string) ?? (j.id as string)) as string,
        })
      }
    }
  }

  const live = (apps ?? []).filter((a) => !a.withdrawn_at)

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Breadcrumbs
          items={[
            { label: 'Tutor dashboard', href: '/tutor/dashboard' },
            { label: 'My applications' },
          ]}
        />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">My applications</h1>
          <p className="text-xs text-gray-500">
            {live.length === 0 ? 'Nothing applied for yet' : `${live.length} live`}
          </p>
        </header>

        {(apps ?? []).length === 0 ? (
          <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-6 text-center">
            <p className="text-xs font-bold text-tm-navy">You have not applied for a tuition yet</p>
            <p className="mx-auto max-w-sm text-xs leading-relaxed text-gray-500">
              Open tuitions matching your subjects are listed for you. Applying is what puts you in
              front of a parent.
            </p>
            <Link
              href="/tutor/dashboard/jobs"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-red px-5 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover"
            >
              See open tuitions
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {(apps ?? []).map((a) => {
              const job = jobs.get(a.job_id as string)
              const st = a.withdrawn_at
                ? { label: 'Withdrawn', className: 'bg-tm-bg text-gray-500' }
                : (STATUS[a.status as string] ?? {
                    label: a.status as string,
                    className: 'bg-tm-bg text-gray-500',
                  })
              return (
                <li key={a.id as string}>
                  <Link
                    href={job ? `/browse/tuitions?job=${job.ref}` : '/browse/tuitions'}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="block truncate text-xs font-black text-tm-navy">
                        {job?.title ?? 'Tuition'}
                      </span>
                      <span className="block text-[11px] text-gray-500">{job?.city ?? '—'}</span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${st.className}`}
                    >
                      {st.label}
                    </span>
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
