import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MapPin, Wallet, Clock, GraduationCap } from 'lucide-react'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEntitlements, badgesForPlan } from '@/lib/entitlements'
import FeaturedTag from '@/components/badges/FeaturedTag'
import ApplicantList, { type Applicant } from './ApplicantList'
import JobActions from './JobActions'

// One of the parent's own tuitions, with its applicants.
//
// The version this replaced read hired state out of localStorage keys like
// `hired_tutor_<id>`, so a hire existed only in the browser that made it: the
// tutor never knew, the other applicants were never told, and clearing site
// data undid it. Hiring now writes applications.status, jobs.status and
// jobs.hired_tutor_id, rejects the other applicants and notifies everyone.

export const dynamic = 'force-dynamic'

export default async function ParentJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  const isUuid = /^[0-9a-f-]{36}$/i.test(jobId)
  const { data: job } = await supabase
    .from('jobs')
    .select(
      'id, job_tx_id, parent_id, title, subjects, class_level, city, area, teaching_mode, budget_pkr, timings, description, status, is_featured, child_id, created_at, hired_tutor_id',
    )
    .eq(isUuid ? 'id' : 'job_tx_id', jobId)
    .maybeSingle()

  if (!job || job.parent_id !== userId) notFound()

  const [{ data: child }, ent] = await Promise.all([
    job.child_id
      ? supabase.from('children').select('name, class_level').eq('id', job.child_id).maybeSingle()
      : Promise.resolve({ data: null }),
    getEntitlements(userId),
  ])

  // Applicant details need the service-role client: `tutor_profiles` and
  // `profiles` are owner-or-admin under RLS, so a parent cannot read the name
  // of somebody who applied to their own job with their own client. Only
  // public-profile fields cross over -- never a phone number.
  const admin = createAdminClient()
  let applicants: Applicant[] = []

  if (admin) {
    const { data: apps } = await admin
      .from('applications')
      .select('id, tutor_id, message, status, withdrawn_at, created_at')
      .eq('job_id', job.id)
      .order('created_at', { ascending: false })

    const tutorIds = Array.from(new Set((apps ?? []).map((a) => a.tutor_id as string)))

    const [{ data: tutors }, { data: subs }, { data: profiles }] =
      tutorIds.length > 0
        ? await Promise.all([
            admin
              .from('tutor_profiles')
              .select('id, full_name, slug, headline, city, rating_avg, rating_count')
              .in('id', tutorIds),
            admin
              .from('subscriptions')
              .select('user_id, plan_code')
              .in('user_id', tutorIds)
              .eq('status', 'active')
              .gt('expires_at', new Date().toISOString()),
            admin.from('profiles').select('id, profile_completion').in('id', tutorIds),
          ])
        : [{ data: [] }, { data: [] }, { data: [] }]

    const planByTutor = new Map<string, string>()
    for (const s of subs ?? []) planByTutor.set(s.user_id as string, s.plan_code as string)

    const completionByTutor = new Map<string, number>()
    for (const p of profiles ?? []) {
      completionByTutor.set(p.id as string, (p.profile_completion as number) ?? 0)
    }

    const tutorById = new Map((tutors ?? []).map((t) => [t.id as string, t]))

    applicants = (apps ?? []).map((a) => {
      const t = tutorById.get(a.tutor_id as string)
      const id = a.tutor_id as string
      return {
        id: a.id as string,
        tutorId: id,
        tutorName: (t?.full_name as string) ?? 'TutorMint tutor',
        tutorSlug: (t?.slug as string) ?? null,
        headline: (t?.headline as string) ?? null,
        city: (t?.city as string) ?? null,
        ratingAvg: Number(t?.rating_avg ?? 0),
        ratingCount: (t?.rating_count as number) ?? 0,
        badges: badgesForPlan(planByTutor.get(id) ?? null, (completionByTutor.get(id) ?? 0) >= 100),
        message: (a.message as string) ?? null,
        status: a.status as Applicant['status'],
        withdrawn: !!a.withdrawn_at,
        createdAt: a.created_at as string,
      }
    })
  }

  const live = applicants.filter((a) => !a.withdrawn).length
  const withdrawn = applicants.length - live

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/parent/dashboard" className="text-xs font-bold text-tm-red hover:underline">
          ← Dashboard
        </Link>

        <section className="relative space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
          {job.is_featured && <FeaturedTag className="absolute right-3 top-3 sm:right-4 sm:top-4" />}

          <div className="space-y-1 pr-16 sm:pr-20">
            <h1 className="text-lg font-black leading-snug text-tm-navy sm:text-xl">
              {job.title as string}
            </h1>
            <p className="text-[11px] text-gray-500">
              {job.job_tx_id as string} ·{' '}
              {job.status === 'open' ? 'Open' : job.status === 'hired' ? 'Hired' : 'Closed'}
              {child ? ` · for ${(child as { name: string }).name}` : ''}
            </p>
          </div>

          {Array.isArray(job.subjects) && job.subjects.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(job.subjects as string[]).map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-tm-bg px-2.5 py-1 text-[11px] font-bold ring-1 ring-gray-200"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {job.class_level && (
              <p className="flex items-center gap-2 text-xs">
                <GraduationCap size={14} className="text-gray-500" />
                {job.class_level as string}
              </p>
            )}
            <p className="flex items-center gap-2 text-xs">
              <MapPin size={14} className="text-gray-500" />
              {[job.area, job.city].filter(Boolean).join(', ') || 'Flexible'}
            </p>
            {job.timings ? (
              <p className="flex items-center gap-2 text-xs">
                <Clock size={14} className="text-gray-500" />
                {job.timings as string}
              </p>
            ) : null}
            {job.budget_pkr ? (
              <p className="flex items-center gap-2 text-xs font-black text-tm-navy">
                <Wallet size={14} className="text-gray-500" />
                Rs. {(job.budget_pkr as number).toLocaleString('en-PK')} / month
              </p>
            ) : null}
          </div>

          {job.description && (
            <p className="whitespace-pre-line text-xs leading-relaxed">{job.description as string}</p>
          )}

          <JobActions
            jobId={job.id as string}
            jobRef={(job.job_tx_id as string) ?? (job.id as string)}
            status={job.status as string}
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-black text-tm-navy">
            Applicants ({live}
            {withdrawn > 0 ? `, ${withdrawn} withdrawn` : ''})
          </h2>
          <ApplicantList
            applicants={applicants}
            canHire={ent.canHire}
            jobStatus={job.status as string}
          />
        </section>
      </div>
    </main>
  )
}
