import Breadcrumbs from '@/components/Breadcrumbs'
import Link from 'next/link'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import BadgeRow from '@/components/badges/BadgeRow'
import { badgesForPlan } from '@/lib/entitlements'
import { reviewableEngagements } from '@/lib/reviews'
import ReviewForm from '@/components/ReviewForm'
import { formatDate } from '@/lib/datetime'

// Tutors this parent has actually hired.
//
// The version this replaced queried the legacy parent_jobs table and then read
// the hired tutor's id and NAME out of localStorage keys (`hired_tutor_<id>`),
// so the list existed only in the browser that made the hire and vanished when
// site data was cleared. Hires are rows now: jobs.status='hired' with
// jobs.hired_tutor_id.

export const dynamic = 'force-dynamic'

export default async function HiredTutorsPage() {
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  const reviewable = await reviewableEngagements(userId)

  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, job_tx_id, title, city, hired_tutor_id, hired_at')
    .eq('parent_id', userId)
    .eq('status', 'hired')
    .order('hired_at', { ascending: false })

  // Tutor names come through the service-role client: tutor_profiles is
  // owner-or-admin under RLS. Only public-profile fields cross over.
  const admin = createAdminClient()
  const tutors = new Map<string, { name: string; slug: string | null; plan: string | null; complete: boolean }>()
  const tutorIds = Array.from(
    new Set((jobs ?? []).map((j) => j.hired_tutor_id as string).filter(Boolean)),
  )

  if (admin && tutorIds.length > 0) {
    const [{ data: rows }, { data: subs }, { data: profiles }] = await Promise.all([
      admin.from('tutor_profiles').select('id, full_name, slug').in('id', tutorIds),
      admin
        .from('subscriptions')
        .select('user_id, plan_code')
        .in('user_id', tutorIds)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString()),
      admin.from('profiles').select('id, profile_completion').in('id', tutorIds),
    ])

    const planBy = new Map((subs ?? []).map((s) => [s.user_id as string, s.plan_code as string]))
    const compBy = new Map(
      (profiles ?? []).map((p) => [p.id as string, ((p.profile_completion as number) ?? 0) >= 100]),
    )

    for (const t of rows ?? []) {
      tutors.set(t.id as string, {
        name: (t.full_name as string) ?? 'Tutor',
        slug: (t.slug as string) ?? null,
        plan: planBy.get(t.id as string) ?? null,
        complete: compBy.get(t.id as string) ?? false,
      })
    }
  }

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Breadcrumbs items={[{ label: 'Parent dashboard', href: '/parent/dashboard' }, { label: 'Hired tutors' }]} />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Hired tutors</h1>
        </header>

        {(jobs ?? []).length === 0 ? (
          <p className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-xs text-gray-500">
            You have not hired anyone yet. Hire an applicant from one of your job posts.
          </p>
        ) : (
          <ul className="space-y-2">
            {(jobs ?? []).map((j) => {
              const t = tutors.get(j.hired_tutor_id as string)
              return (
                <li
                  key={j.id as string}
                  className="space-y-1 rounded-2xl border border-gray-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-black text-tm-navy">
                      {t?.slug ? (
                        <Link href={`/tutor/${t.slug}`} className="hover:underline">
                          {t.name}
                        </Link>
                      ) : (
                        (t?.name ?? 'Tutor')
                      )}
                    </span>
                    {t && <BadgeRow badges={badgesForPlan(t.plan, t.complete)} size="sm" />}
                  </div>
                  <p className="text-[11px] text-gray-500">
                    <Link href={`/parent/dashboard/job/${j.job_tx_id ?? j.id}`} className="hover:underline">
                      {j.title as string}
                    </Link>
                    {j.city ? ` · ${j.city}` : ''}
                    {j.hired_at
                      ? ` · hired ${formatDate(j.hired_at as string)}`
                      : ''}
                  </p>

                  {/* Offered only where it has been earned and not yet used. */}
                  {reviewable.reviewedJobIds.has(j.id as string) ? (
                    <p className="text-[11px] font-bold text-tm-green-deep">You reviewed this tutor</p>
                  ) : (
                    <div className="pt-1">
                      <ReviewForm
                        tutorId={j.hired_tutor_id as string}
                        tutorName={t?.name ?? 'this tutor'}
                        jobId={j.id as string}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </main>
  )
}
