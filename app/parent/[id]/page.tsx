import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Briefcase, CalendarDays, MapPin } from 'lucide-react'
import Avatar from '@/components/Avatar'
import BadgeRow from '@/components/badges/BadgeRow'
import Breadcrumbs from '@/components/Breadcrumbs'
import TimeAgo from '@/components/TimeAgo'
import { publicParent } from '@/lib/publicParent'
import { formatMonthYear } from '@/lib/datetime'
import { budgetLabel } from '@/lib/feeBands'
import { teachingMode } from '@/lib/display'
import { tuitionPath } from '@/lib/slugs'
import { pageDescription, pageTitle } from '@/lib/seo'

// The parent, as a tutor sees them before applying.
//
// WHAT IS DELIBERATELY NOT HERE: phone, WhatsApp, email, home address, CNIC,
// and the children. A tutor deciding whether to spend one of ten monthly
// applications needs to know the person is real, verified, and has posted
// tuitions before. None of that requires contact details, and contact details
// are what a Featured plan buys -- putting them on a public URL would give
// away the thing the platform sells and expose a parent's number to anyone
// with the id.
//
// Children are excluded on a stronger principle than product design: they are
// minors who did not sign up for anything, and a public page naming a child
// and their grade is a page about a child.
//
// NOT INDEXED. Parents did not publish themselves the way a tutor did; a tutor
// profile is a marketing surface a tutor chose, and this is a reference card a
// tutor lands on from a job. It is reachable by anyone with the link -- there
// is nothing sensitive on it -- but it is not something to put in a search
// index without asking every parent first.

export const dynamic = 'force-dynamic'

type Params = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params
  const parent = await publicParent(id)
  if (!parent) return { title: pageTitle('Member not found'), robots: { index: false, follow: false } }

  return {
    title: pageTitle(`${parent.name} — parent in ${parent.city ?? 'Pakistan'}`),
    description: pageDescription(
      `${parent.name} posts tuitions${parent.city ? ` in ${parent.city}` : ''}`,
    ),
    robots: { index: false, follow: false },
  }
}

export default async function PublicParentPage({ params }: { params: Params }) {
  const { id } = await params
  const parent = await publicParent(id)

  // A suspended parent, a tutor's id, or a made-up one all land here
  // identically -- nobody learns which.
  if (!parent) notFound()

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
      <Breadcrumbs
        items={[{ label: 'Tuitions', href: '/browse/tuitions' }, { label: parent.name }]}
      />

      <section className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <Avatar
          name={parent.name}
          src={parent.avatarUrl}
          seed={parent.id}
          className="h-16 w-16 shrink-0 text-lg sm:h-20 sm:w-20 sm:text-xl"
          decorative
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">{parent.name}</h1>
          {parent.badges.length > 0 && <BadgeRow badges={parent.badges} size="sm" />}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
            {parent.city && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={12} aria-hidden />
                {parent.city}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={12} aria-hidden />
              Member since {formatMonthYear(parent.memberSince)}
            </span>
          </div>
          {/* Said plainly, because it is the single fact a tutor is weighing
              when they decide whether to spend an application. */}
          <p className="text-[11px] leading-relaxed text-slate-700">
            {parent.canHire
              ? 'Featured parent — able to complete a hire.'
              : parent.verified
                ? 'Verified parent — CNIC and address approved. Hiring needs a Featured plan.'
                : 'This member has not completed verification yet.'}
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-black text-tm-navy">
          Open tuitions{parent.jobs.length > 0 ? ` (${parent.jobs.length})` : ''}
        </h2>

        {parent.jobs.length === 0 ? (
          <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-500">
            {parent.name} has no open tuitions right now.{' '}
            <Link href="/browse/tuitions" className="font-bold text-tm-red hover:underline">
              Browse every open tuition
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            {parent.jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={tuitionPath({
                    public_slug: job.publicSlug,
                    city: job.city,
                    job_tx_id: job.jobTxId,
                    id: job.id,
                  })}
                  className="flex min-h-[64px] flex-col gap-1 p-4 transition-colors hover:bg-gray-50"
                >
                  <span className="text-xs font-black text-tm-navy">{job.title}</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
                    <Briefcase size={11} aria-hidden />
                    {[job.classLevel, job.area ?? job.city, teachingMode(job.teachingMode)]
                      .filter(Boolean)
                      .join(' · ')}
                    {budgetLabel(job.budgetMin, job.budgetMax, job.budgetPkr) && (
                      <>
                        <span aria-hidden>·</span>
                        {budgetLabel(job.budgetMin, job.budgetMax, job.budgetPkr)}
                      </>
                    )}
                    <span aria-hidden>·</span>
                    <TimeAgo iso={job.createdAt} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] leading-relaxed text-gray-500">
        Contact details are never shown on this page. Tutors on the Featured plan see a parent&apos;s
        phone and WhatsApp once they are working together.
      </p>
    </main>
  )
}
