import { CalendarDays, GraduationCap, MapPin, Search, Wallet } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import Breadcrumbs from '@/components/Breadcrumbs'
import { getSessionUser } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { budgetLabel } from '@/lib/feeBands'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { tuitionPath } from '@/lib/slugs'

// One application, in full.
//
// WHY IT EXISTS. The applications list linked each row at the TUITION, and at
// the board when that tuition had closed. So a tutor who wanted to know what
// happened to an application — what they wrote, when they applied, whether
// anybody shortlisted them — was sent either to the parent's advertisement or
// to a list of other people's tuitions. The one thing the row was about had no
// page.
//
// A SNAPSHOT OF THE TUITION AS IT WAS. The job's title, subjects, area and
// budget are read here even when the tuition is closed, hired, or the parent
// has been suspended — through the service-role client, because
// jobs_public_read_open shows anon nothing but open rows. That is deliberate
// and it is the point: an application is a record of something the tutor did,
// and a record that disappears when the other party closes their advert is not
// a record. Nothing else about the parent is exposed — no contact, no address,
// which is what a Featured plan is for.
//
// It is scoped to the signed-in tutor by `tutor_id`, not by RLS alone: this
// route takes an id from the URL, and "not yours" and "does not exist" answer
// identically, so the page cannot be used to find out whether an application
// id is real.

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Your application | TutorMint',
  robots: { index: false, follow: false },
}

type Params = Promise<{ id: string }>

const STATUS: Record<string, { label: string; className: string }> = {
  applied: { label: 'Awaiting the parent', className: 'bg-tm-tint-navy text-tm-navy' },
  shortlisted: { label: 'Shortlisted', className: 'bg-tm-tint-gold text-tm-gold-ink' },
  hired: { label: 'Hired', className: 'bg-tm-tint-green text-tm-green-deep' },
  rejected: { label: 'Not selected', className: 'bg-tm-tint-red text-tm-red-hover' },
}

export default async function ApplicationDetailPage({ params }: { params: Params }) {
  const { id } = await params
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  const { data: application } = await supabase
    .from('applications')
    .select('id, job_id, message, status, created_at, status_changed_at, withdrawn_at')
    .eq('id', id)
    .eq('tutor_id', userId)
    .maybeSingle()

  if (!application) notFound()

  const admin = createAdminClient()
  const { data: job } = admin
    ? await admin
        .from('jobs')
        .select(
          'id, job_tx_id, public_slug, title, description, class_level, city, area, status, budget_pkr, budget_min_pkr, budget_max_pkr, created_at',
        )
        .eq('id', application.job_id as string)
        .maybeSingle()
    : { data: null }

  // The subjects, through the join table and the taxonomy slugs -- never the
  // retired jobs.subjects text[] column. taxonomy_master carries slugs only,
  // so the display names come from taxonomy_levels and taxonomy_subjects, the
  // same two-hop lib/jobFeed.ts makes.
  let subjects: string[] = []
  let subjectSlug: string | null = null
  if (admin && job) {
    const { data: links } = await admin
      .from('job_subjects')
      .select('master_id')
      .eq('job_id', job.id as string)
    const ids = (links ?? []).map((l) => l.master_id as number)
    if (ids.length > 0) {
      const { data: masters } = await admin
        .from('taxonomy_master')
        .select('id, level_slug, subject_slug')
        .in('id', ids)

      const levelSlugs = [...new Set((masters ?? []).map((m) => m.level_slug as string))]
      const subjectSlugs = [
        ...new Set((masters ?? []).map((m) => m.subject_slug as string | null).filter(Boolean)),
      ] as string[]

      const [{ data: levels }, { data: names }] = await Promise.all([
        admin.from('taxonomy_levels').select('slug, name').in('slug', levelSlugs),
        subjectSlugs.length > 0
          ? admin.from('taxonomy_subjects').select('slug, name').in('slug', subjectSlugs)
          : Promise.resolve({ data: [] as { slug: string; name: string }[] }),
      ])

      const levelName = new Map((levels ?? []).map((l) => [l.slug as string, l.name as string]))
      const subjectName = new Map((names ?? []).map((n) => [n.slug as string, n.name as string]))

      subjects = (masters ?? []).map((m) =>
        [
          levelName.get(m.level_slug as string) ?? null,
          m.subject_slug ? (subjectName.get(m.subject_slug as string) ?? null) : null,
        ]
          .filter(Boolean)
          .join(' '),
      )
      subjectSlug = ((masters ?? [])[0]?.subject_slug as string | null) ?? null
    }
  }

  const withdrawn = !!application.withdrawn_at
  const status = withdrawn ? 'withdrawn' : (application.status as string)
  const chip = withdrawn
    ? { label: 'Withdrawn', className: 'bg-tm-bg text-gray-500' }
    : (STATUS[status] ?? { label: status, className: 'bg-tm-bg text-gray-500' })

  const open = job?.status === 'open'
  const decidedAt = (application.status_changed_at as string | null) ?? null

  // Where "Find similar tuitions" goes: the same subject in the same city,
  // which is the search that produced this application in the first place.
  const similar = new URLSearchParams()
  if (subjectSlug) similar.set('subject', subjectSlug)
  if (job?.city) similar.set('city', job.city as string)

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Breadcrumbs
          items={[
            { label: 'Tutor dashboard', href: '/tutor/dashboard' },
            { label: 'My applications', href: '/tutor/dashboard/applications' },
            { label: (job?.title as string) ?? 'Your application' },
          ]}
        />

        {/* --------------------------------------------- the tuition, as it was */}
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h1 className="text-lg font-black leading-tight text-tm-navy sm:text-xl">
              {(job?.title as string) ?? 'This tuition is no longer on record'}
            </h1>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${chip.className}`}
            >
              {chip.label}
            </span>
          </div>

          {subjects.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {subjects.map((s) => (
                <li
                  key={s}
                  className="rounded-full bg-tm-tint-navy px-2.5 py-1 text-[10px] font-bold text-tm-navy"
                >
                  {s}
                </li>
              ))}
            </ul>
          )}

          <dl className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
            <Fact icon={<GraduationCap aria-hidden size={13} />} label="Level">
              {(job?.class_level as string | null) || '—'}
            </Fact>
            <Fact icon={<MapPin aria-hidden size={13} />} label="Area">
              {[job?.area as string | null, job?.city as string | null].filter(Boolean).join(', ') ||
                '—'}
            </Fact>
            <Fact icon={<Wallet aria-hidden size={13} />} label="Budget">
              {job
                ? budgetLabel(
                    job.budget_min_pkr as number | null,
                    job.budget_max_pkr as number | null,
                    job.budget_pkr as number | null,
                  )
                : '—'}
            </Fact>
            <Fact icon={<CalendarDays aria-hidden size={13} />} label="Posted">
              {job?.created_at ? formatDate(job.created_at as string) : '—'}
            </Fact>
          </dl>

          {job?.description ? (
            <p className="whitespace-pre-line rounded-xl bg-tm-bg p-3 text-xs leading-relaxed text-slate-700">
              {job.description as string}
            </p>
          ) : null}

          {open && job?.public_slug ? (
            <Link
              href={tuitionPath({
                public_slug: job.public_slug as string,
                city: job.city as string | null,
              })}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
            >
              <GraduationCap aria-hidden size={14} />
              See the tuition
            </Link>
          ) : (
            <div className="space-y-2 rounded-xl bg-tm-bg p-3">
              <p className="text-xs font-semibold leading-relaxed text-slate-700">
                This tuition has closed. The parent has finished hiring.
              </p>
              <Link
                href={`/browse/tuitions${similar.toString() ? `?${similar}` : ''}`}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-black px-4 text-xs font-bold text-white transition-colors hover:bg-slate-700"
              >
                <Search aria-hidden size={14} />
                Find similar tuitions
              </Link>
            </div>
          )}
        </section>

        {/* ----------------------------------------------------- what you wrote */}
        <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <h2 className="text-xs font-black text-tm-navy">What you wrote</h2>
          {application.message ? (
            <p className="whitespace-pre-line rounded-xl bg-tm-bg p-3 text-xs leading-relaxed text-slate-700">
              {application.message as string}
            </p>
          ) : (
            <p className="text-[11px] leading-relaxed text-gray-500">
              You applied without a message. A short note about what you would do with this student
              is what gets an application read.
            </p>
          )}
        </section>

        {/* --------------------------------------------------------- what happened */}
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <h2 className="text-xs font-black text-tm-navy">What happened</h2>
          <ol className="space-y-0">
            <Step
              label="You applied"
              at={application.created_at as string}
              done
              first
              last={status === 'applied'}
            />
            {status === 'withdrawn' && (
              <Step
                label="You withdrew this application"
                at={application.withdrawn_at as string}
                done
                last
              />
            )}
            {(status === 'shortlisted' || status === 'hired') && (
              <Step
                label="The parent shortlisted you"
                at={status === 'shortlisted' ? decidedAt : null}
                done
                last={status === 'shortlisted'}
              />
            )}
            {status === 'hired' && <Step label="You were hired" at={decidedAt} done last tone="good" />}
            {status === 'rejected' && (
              <Step label="Not selected" at={decidedAt} done last tone="bad" />
            )}
          </ol>
          {status === 'applied' && (
            <p className="text-[11px] leading-relaxed text-gray-500">
              Nothing else is needed from you. Parents usually read applications within a few days.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}

function Fact({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-0.5">
      <dt className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-gray-500">
        {icon}
        {label}
      </dt>
      <dd className="text-xs font-bold text-tm-navy">{children}</dd>
    </div>
  )
}

/**
 * One rung of the timeline.
 *
 * `at` is nullable and rendered as "date not recorded" rather than omitted or
 * guessed: applications.status_changed_at was added with this page, so every
 * decision made before it exists happened on a day nobody wrote down. Printing
 * the row's created_at there would be inventing a date, and inventing a date on
 * a record of who hired whom is worse than admitting the gap.
 */
function Step({
  label,
  at,
  done,
  first = false,
  last = false,
  tone = 'plain',
}: {
  label: string
  at: string | null
  done: boolean
  first?: boolean
  last?: boolean
  tone?: 'plain' | 'good' | 'bad'
}) {
  const dot =
    tone === 'good' ? 'bg-tm-green-deep' : tone === 'bad' ? 'bg-tm-red' : 'bg-tm-navy'
  return (
    <li className="flex gap-3">
      <span className="flex flex-col items-center" aria-hidden>
        {!first && <span className="h-2 w-px bg-gray-200" />}
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${done ? dot : 'bg-gray-200'}`} />
        {!last && <span className="w-px flex-1 bg-gray-200" />}
      </span>
      <span className="min-w-0 flex-1 pb-3">
        <span className="block text-xs font-bold text-tm-navy">{label}</span>
        <span className="block text-[11px] text-gray-500">
          {at ? formatDate(at) : 'date not recorded'}
        </span>
      </span>
    </li>
  )
}
