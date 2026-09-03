import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink, Flag, MapPin, Wallet, Clock, GraduationCap } from 'lucide-react'
import Avatar from '@/components/Avatar'
import BadgeRow from '@/components/badges/BadgeRow'
import TimeAgo from '@/components/TimeAgo'
import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { badgesForPlan } from '@/lib/entitlements'
import { budgetLabel } from '@/lib/feeBands'
import { applicationStatus, jobStatus, teachingMode } from '@/lib/display'
import { formatDate } from '@/lib/datetime'

import JobActions from './JobActions'

// One tuition, as staff.
//
// The ad as parents see it, who posted it, everyone who applied and where each
// stands, the hire if there is one, and any reports filed against it. That is
// the whole of what somebody needs to answer a support message about a job
// without opening a database client.
//
// Reports are shown WITHOUT message bodies. CLAUDE.md's privacy line is that
// chat content loads only on /admin/reports, for reports whose target is a
// thread, and only there -- so this links to the report rather than inlining
// what was said.

export const dynamic = 'force-dynamic'

export default async function AdminJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.jobs)
  const { id } = await params

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server.
      </p>
    )
  }

  // Accept either the uuid or the human reference, because the reference is
  // what a parent quotes in a support message.
  const isUuid = /^[0-9a-f-]{36}$/i.test(id)
  const { data: job } = await admin
    .from('jobs')
    .select(
      'id, job_tx_id, parent_id, title, description, subjects, class_level, city, area, teaching_mode, budget_pkr, budget_min_pkr, budget_max_pkr, timings, status, is_featured, hired_tutor_id, created_at, closed_at',
    )
    .eq(isUuid ? 'id' : 'job_tx_id', id)
    .maybeSingle()

  if (!job) notFound()

  const [{ data: apps }, { data: parent }, { data: reports }] = await Promise.all([
    admin
      .from('applications')
      .select('id, tutor_id, status, message, created_at')
      .eq('job_id', job.id)
      .order('created_at', { ascending: false }),
    admin
      .from('profiles')
      .select('id, full_name, email, avatar_url, city, cnic_verified_at, address_verified_at, is_suspended, profile_completion')
      .eq('id', job.parent_id as string)
      .maybeSingle(),
    admin
      .from('reports')
      .select('id, reason, status, created_at')
      .eq('target_type', 'job')
      .eq('target_id', job.id)
      .order('created_at', { ascending: false }),
  ])

  const tutorIds = Array.from(
    new Set((apps ?? []).map((a) => a.tutor_id as string).filter(Boolean)),
  )

  const [{ data: tutorProfiles }, { data: tutorRows }, { data: parentSubs }] = await Promise.all([
    tutorIds.length > 0
      ? admin.from('profiles').select('id, full_name, avatar_url').in('id', tutorIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    tutorIds.length > 0
      ? admin.from('tutor_profiles').select('id, slug').in('id', tutorIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    admin
      .from('subscriptions')
      .select('plan_code')
      .eq('user_id', job.parent_id as string)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString()),
  ])

  const tutorName = new Map((tutorProfiles ?? []).map((p) => [p.id as string, p.full_name as string]))
  const tutorAvatar = new Map(
    (tutorProfiles ?? []).map((p) => [p.id as string, (p.avatar_url as string) ?? null]),
  )
  const tutorSlug = new Map((tutorRows ?? []).map((t) => [t.id as string, t.slug as string]))

  const parentVerified = !!parent?.cnic_verified_at && !!parent?.address_verified_at
  const parentBadges = badgesForPlan(
    (parentSubs ?? [])[0]?.plan_code as string | undefined,
    parentVerified,
  )

  const canAct = roleSatisfies(actor.adminRole, SCREEN_ACCESS.jobsMutate)
  const hired = (apps ?? []).find((a) => a.tutor_id === job.hired_tutor_id)

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-black text-tm-navy">{job.title as string}</h2>
          {job.is_featured && (
            <span className="rounded-full bg-tm-gold px-2 py-0.5 text-[10px] font-black text-tm-navy">
              Featured
            </span>
          )}
          <span className="rounded-full bg-tm-bg px-2 py-0.5 text-[10px] font-black text-slate-700">
            {jobStatus(job.status as string)}
          </span>
        </div>
        <p className="font-mono text-[11px] text-gray-500">{(job.job_tx_id as string) ?? job.id}</p>
      </header>

      {/* ------------------------------------------------ the ad as posted */}
      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">
          The tuition, as parents see it
        </h2>
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-700">
          {(job.area || job.city) && (
            <dd className="inline-flex items-center gap-1">
              <MapPin size={12} className="text-gray-500" aria-hidden />
              {[job.area, job.city].filter(Boolean).join(', ')}
            </dd>
          )}
          {job.class_level && (
            <dd className="inline-flex items-center gap-1">
              <GraduationCap size={12} className="text-gray-500" aria-hidden />
              {job.class_level as string}
            </dd>
          )}
          {teachingMode(job.teaching_mode as string) && (
            <dd>{teachingMode(job.teaching_mode as string)}</dd>
          )}
          {budgetLabel(
            job.budget_min_pkr as number | null,
            job.budget_max_pkr as number | null,
            job.budget_pkr as number | null,
          ) && (
            <dd className="inline-flex items-center gap-1 font-black text-tm-navy">
              <Wallet size={12} className="text-gray-500" aria-hidden />
              {budgetLabel(
                job.budget_min_pkr as number | null,
                job.budget_max_pkr as number | null,
                job.budget_pkr as number | null,
              )}
            </dd>
          )}
          {job.timings && <dd>{job.timings as string}</dd>}
          <dd className="inline-flex items-center gap-1 text-gray-500">
            <Clock size={12} aria-hidden />
            <TimeAgo iso={job.created_at as string} />
          </dd>
        </dl>

        {Array.isArray(job.subjects) && (job.subjects as string[]).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(job.subjects as string[]).map((s) => (
              <span
                key={s}
                className="rounded-full bg-tm-bg px-2 py-0.5 text-[10px] font-semibold text-slate-700"
              >
                {s}
              </span>
            ))}
          </div>
        )}

        {job.description ? (
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
            {job.description as string}
          </p>
        ) : (
          <p className="text-xs text-gray-500">No description.</p>
        )}
      </section>

      {/* --------------------------------------------------------- parent */}
      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Posted by</h2>
        {parent ? (
          <div className="flex items-start gap-3">
            <Avatar
              name={parent.full_name as string}
              src={(parent.avatar_url as string) ?? null}
              seed={parent.id as string}
              className="h-11 w-11 shrink-0 text-xs"
              decorative
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {/* In admin the name goes to the ADMIN member page, and the
                    public page is a separate, explicit link -- so nobody
                    clicks a name expecting moderation tools and lands on a
                    marketing page, or the reverse. */}
                <Link
                  href={`/admin/users/${parent.id}`}
                  className="text-sm font-black text-tm-navy hover:text-tm-red hover:underline"
                >
                  {parent.full_name as string}
                </Link>
                {parentBadges.length > 0 && <BadgeRow badges={parentBadges} size="sm" />}
                {parent.is_suspended && (
                  <span className="rounded-full bg-tm-tint-red px-2 py-0.5 text-[10px] font-black text-tm-red">
                    Suspended
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-500">{parent.email as string}</p>
              <Link
                href={`/parent/${parent.id}`}
                className="inline-flex min-h-[28px] items-center gap-1 text-[11px] font-bold text-tm-red hover:underline"
              >
                View public profile
                <ExternalLink size={11} aria-hidden />
              </Link>
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-500">That parent account no longer exists.</p>
        )}
      </section>

      {/* ----------------------------------------------------- applicants */}
      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">
          Applicants ({(apps ?? []).length})
          {hired && <span className="ml-2 text-tm-green-deep">· hired</span>}
        </h2>

        {(apps ?? []).length === 0 ? (
          <p className="text-xs text-gray-500">Nobody has applied yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {(apps ?? []).map((a) => {
              const tid = a.tutor_id as string
              const slug = tutorSlug.get(tid)
              const isHired = tid === job.hired_tutor_id
              return (
                <li key={a.id as string} className="flex items-start gap-3 py-2.5">
                  <Avatar
                    name={tutorName.get(tid) ?? 'Tutor'}
                    src={tutorAvatar.get(tid) ?? null}
                    seed={tid}
                    className="h-9 w-9 shrink-0 text-[10px]"
                    decorative
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin/users/${tid}`}
                        className="text-xs font-black text-tm-navy hover:text-tm-red hover:underline"
                      >
                        {tutorName.get(tid) ?? 'Tutor'}
                      </Link>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                          isHired
                            ? 'bg-tm-tint-green text-tm-green-deep'
                            : 'bg-tm-bg text-slate-700'
                        }`}
                      >
                        {isHired ? 'Hired' : applicationStatus(a.status as string)}
                      </span>
                      {slug && (
                        <Link
                          href={`/tutor/${slug}`}
                          className="inline-flex items-center gap-1 text-[10px] font-bold text-tm-red hover:underline"
                        >
                          View public profile
                          <ExternalLink size={10} aria-hidden />
                        </Link>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-500">
                      Applied {formatDate(a.created_at as string)}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* -------------------------------------------------------- reports */}
      {(reports ?? []).length > 0 && (
        <section className="space-y-2 rounded-2xl border border-tm-red/30 bg-tm-tint-red p-4 sm:p-5">
          <h2 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-tm-red">
            <Flag size={12} aria-hidden />
            Reports against this tuition ({(reports ?? []).length})
          </h2>
          <ul className="space-y-1">
            {(reports ?? []).map((r) => (
              <li key={r.id as string} className="text-[11px] text-tm-red">
                <Link href="/admin/reports" className="font-bold hover:underline">
                  {(r.reason as string) ?? 'Reported'}
                </Link>{' '}
                · {r.status as string} · {formatDate(r.created_at as string)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* -------------------------------------------------------- actions */}
      {canAct ? (
        <JobActions
          jobId={job.id as string}
          status={job.status as string}
          isFeatured={!!job.is_featured}
        />
      ) : (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-[11px] text-gray-500">
          Your admin role can read this screen but not act on it. Closing, un-featuring and removing
          a tuition are manager actions.
        </p>
      )}
    </div>
  )
}
