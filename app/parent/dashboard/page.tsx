import Link from 'next/link'
import { AlertTriangle, Info, Plus } from 'lucide-react'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEntitlements } from '@/lib/entitlements'
import { computeCompletion } from '@/lib/completion'
import BadgeRow from '@/components/badges/BadgeRow'
import FeaturedTag from '@/components/badges/FeaturedTag'
import ProfileCompletionWidget from '@/components/ProfileCompletionWidget'
import ChildrenManager, { type Child } from './ChildrenManager'
import DemoInbox, { type DemoRow } from './DemoInbox'

// The parent dashboard.
//
// Order of business: can I post yet, who are my children, what have I posted,
// what is happening with my demos. Verification comes first because until CNIC
// and address are approved a parent can do almost nothing -- and being told
// that plainly, once, is better than discovering it at every locked button.

export const dynamic = 'force-dynamic'

export default async function ParentDashboardPage() {
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  const [{ data: profile }, completion, ent] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, verification_state, cnic_verified_at, address_verified_at, verification_rejection_reason')
      .eq('id', userId)
      .maybeSingle(),
    computeCompletion(userId),
    getEntitlements(userId),
  ])

  const verified = !!profile?.cnic_verified_at && !!profile?.address_verified_at

  const [{ data: children }, { data: jobs }, { data: demos }] = await Promise.all([
    supabase.from('children').select('id, name, class_level, notes').eq('parent_id', userId).order('created_at'),
    supabase
      .from('jobs')
      .select('id, job_tx_id, title, city, status, is_featured, created_at, budget_pkr')
      .eq('parent_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('demo_requests')
      .select('id, tutor_id, status, mode, proposed_time, decline_reason, created_at')
      .eq('parent_id', userId)
      .order('created_at', { ascending: false }),
  ])

  // Applicant counts and tutor names both need the service-role client:
  // applications are readable by the job's parent, but `profiles` is self-read
  // only, so a parent cannot read a tutor's name with their own client.
  const admin = createAdminClient()
  const applicantCount = new Map<string, number>()
  const tutorNames = new Map<string, { name: string; slug: string | null }>()

  if (admin) {
    const jobIds = (jobs ?? []).map((j) => j.id as string)
    if (jobIds.length > 0) {
      const { data: apps } = await admin
        .from('applications')
        .select('job_id')
        .in('job_id', jobIds)
        .is('withdrawn_at', null)
      for (const a of apps ?? []) {
        const k = a.job_id as string
        applicantCount.set(k, (applicantCount.get(k) ?? 0) + 1)
      }
    }

    const tutorIds = Array.from(new Set((demos ?? []).map((d) => d.tutor_id as string)))
    if (tutorIds.length > 0) {
      const { data: tutors } = await admin
        .from('tutor_profiles')
        .select('id, full_name, slug')
        .in('id', tutorIds)
      for (const t of tutors ?? []) {
        tutorNames.set(t.id as string, {
          name: (t.full_name as string) ?? 'Tutor',
          slug: (t.slug as string) ?? null,
        })
      }
    }
  }

  const firstName = (profile?.full_name ?? 'there').split(' ')[0]
  const openJobs = (jobs ?? []).filter((j) => j.status === 'open')

  const demoRows: DemoRow[] = (demos ?? []).map((d) => ({
    id: d.id as string,
    tutorId: d.tutor_id as string,
    tutorName: tutorNames.get(d.tutor_id as string)?.name ?? 'Tutor',
    tutorSlug: tutorNames.get(d.tutor_id as string)?.slug ?? null,
    status: d.status as DemoRow['status'],
    mode: (d.mode as string) ?? null,
    proposedTime: (d.proposed_time as string) ?? null,
    declineReason: (d.decline_reason as string) ?? null,
    createdAt: d.created_at as string,
  }))

  return (
    <main className="min-h-screen bg-[#F8FAFC] px-4 py-6 text-[#334155] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl font-black text-[#0F172A] sm:text-2xl">Welcome back, {firstName}</h1>
          <p className="text-xs text-gray-500">
            {verified ? 'Your account is verified' : 'Verification pending'}
            {ent.planName ? ` · ${ent.planName} plan` : ''}
          </p>
        </header>

        {/* ------------------------------------------------- verification --- */}
        {!verified && (
          <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="flex items-start gap-2 text-xs font-semibold leading-relaxed text-[#92400E]">
              <AlertTriangle size={16} className="mt-px shrink-0" />
              {profile?.verification_state === 'submitted'
                ? 'Your CNIC and address are with our team. You can post a job as soon as they are approved.'
                : profile?.verification_state === 'rejected'
                  ? `Your verification was not accepted: ${profile.verification_rejection_reason ?? 'please check your details'}`
                  : 'Verify your CNIC and address to post jobs, message tutors and request demos.'}
            </p>
            <Link
              href="/parent/verify"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#0F172A] px-5 text-xs font-bold text-white"
            >
              {profile?.verification_state === 'submitted' ? 'Check status' : 'Verify now'}
            </Link>
          </section>
        )}

        {completion && completion.percent < 100 && (
          <ProfileCompletionWidget percent={completion.percent} items={completion.items} role="parent" />
        )}

        {/* --------------------------------------------------------- plan --- */}
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-black text-[#0F172A]">
              {ent.planName ? `${ent.planName} plan` : 'No plan yet'}
            </h2>
            {ent.badges.length > 0 && <BadgeRow badges={ent.badges} size="sm" showLabel />}
          </div>

          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                Job posts left
              </dt>
              <dd className="text-lg font-black text-[#0F172A]">
                {ent.plan ? ent.quotaLeft : '—'}
                {ent.plan && (
                  <span className="text-xs font-semibold text-gray-400"> of {ent.displayedQuota}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Hiring</dt>
              <dd className="text-lg font-black text-[#0F172A]">
                {ent.canHire ? 'Enabled' : 'Featured only'}
              </dd>
            </div>
          </dl>

          {!ent.canHire && (
            <p className="flex items-start gap-2 rounded-xl bg-[#FFFBEB] p-3 text-[11px] leading-relaxed text-[#92400E]">
              <Info size={14} className="mt-px shrink-0" />
              You can post jobs, message tutors and request demos. Completing a hire and seeing a
              tutor&apos;s phone number are Featured features.
            </p>
          )}

          <Link
            href="/parent/packages"
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-[#0F172A] px-5 text-xs font-bold text-white sm:w-auto"
          >
            {ent.canHire ? 'Compare packages' : 'See what Featured adds'}
          </Link>
        </section>

        <ChildrenManager children={(children ?? []) as Child[]} />

        {/* --------------------------------------------------------- jobs --- */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-black text-[#0F172A]">
              My tuitions {jobs && jobs.length > 0 ? `(${openJobs.length} open)` : ''}
            </h2>
            {verified && (
              <Link
                href="/parent/dashboard/post-job"
                className="inline-flex min-h-[44px] items-center gap-1 text-xs font-bold text-[#d60008]"
              >
                <Plus size={14} />
                Post a job
              </Link>
            )}
          </div>

          {(jobs ?? []).length === 0 ? (
            <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-6 text-center">
              <p className="text-xs font-bold text-[#0F172A]">You have not posted a tuition yet</p>
              <p className="mx-auto max-w-sm text-xs leading-relaxed text-gray-500">
                {verified
                  ? 'Post what you need and tutors will apply. Or browse tutors and message one directly.'
                  : 'Once your CNIC and address are approved you can post a job.'}
              </p>
              <div className="flex flex-col justify-center gap-2 sm:flex-row">
                {verified && (
                  <Link
                    href="/parent/dashboard/post-job"
                    className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#d60008] px-5 text-xs font-bold text-white"
                  >
                    Post a job
                  </Link>
                )}
                <Link
                  href="/browse/tutors"
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-[#334155]"
                >
                  Browse tutors
                </Link>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {(jobs ?? []).map((j) => (
                <li key={j.id as string}>
                  <Link
                    href={`/parent/dashboard/job/${j.job_tx_id ?? j.id}`}
                    className="relative flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="block truncate text-xs font-black text-[#0F172A]">
                        {j.title as string}
                      </span>
                      <span className="block text-[11px] text-gray-500">
                        {(j.city as string) ?? '—'} ·{' '}
                        {j.status === 'open'
                          ? `${applicantCount.get(j.id as string) ?? 0} applicant${(applicantCount.get(j.id as string) ?? 0) === 1 ? '' : 's'}`
                          : j.status === 'hired'
                            ? 'Hired'
                            : 'Closed'}
                      </span>
                    </span>
                    {j.is_featured ? <FeaturedTag /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <DemoInbox role="parent" demos={demoRows} />

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href="/parent/dashboard/messages"
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-[#334155]"
          >
            Messages
          </Link>
          <Link
            href="/browse/tutors"
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-[#334155]"
          >
            Browse tutors
          </Link>
        </div>
      </div>
    </main>
  )
}
