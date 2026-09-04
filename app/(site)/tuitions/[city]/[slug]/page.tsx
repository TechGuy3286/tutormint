import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { Briefcase, CalendarDays, Clock, GraduationCap, MapPin, Wallet } from 'lucide-react'

import Avatar from '@/components/Avatar'
import BadgeRow from '@/components/badges/BadgeRow'
import Breadcrumbs from '@/components/Breadcrumbs'
import FeaturedTag from '@/components/badges/FeaturedTag'
import TimeAgo from '@/components/TimeAgo'
import ReportButton from '@/components/ReportButton'
import { budgetLabel } from '@/lib/feeBands'
import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'
import { jobByPublicSlug } from '@/lib/jobFeed'
import { citySegment } from '@/lib/slugs'
import { formatDate } from '@/lib/datetime'
import { teachingMode } from '@/lib/display'
import { PREVIEW_MODE } from '@/lib/preview'
import { absoluteUrl } from '@/lib/siteUrl'
import { jobPostingJsonLd, jsonLdScript, pageDescription, pageTitle } from '@/lib/seo'
import ApplyPanel from './ApplyPanel'

// A posted tuition, with its own address.
//
// UNTIL NOW THERE WAS NONE. A job existed only as a row inside /browse/tuitions
// -- "View details" on every card pointed at `?job=<id>`, a parameter that page
// does not read, so the link took the reader back to the list they were already
// on. Google therefore had nothing to index for a tuition, and JobPosting
// structured data had nowhere to live. This is that page.
//
// THREE STATES, and each has to be honest about itself:
//
//   open              the full page, JobPosting JSON-LD, Apply behind the gate.
//   closed or hired   404, rendered by not-found.tsx in this folder.
//   missing           404, the same page.
//
// A CLOSED TUITION IS A 404, and the three states collapse to two on purpose.
// The first version of this page answered 200 with a "this tuition has closed"
// body, because the App Router gives a page no way to set its own status; the
// version before that got a real 410 out of proxy.ts at the cost of a database
// round trip on EVERY tuition request, open ones included. notFound() is the
// one interrupt that does carry a status, and 404 is true of an address that no
// longer serves anything — so the status, the body and the query count are all
// right at once, with no proxy involvement.
//
// It also drops the second query. Telling "closed" from "filled" from "never
// existed" meant asking job_page_status() after jobByPublicSlug() had already
// come back empty, and all three answers led to the same place.
//
// THE CITY SEGMENT IS DECORATION, and deliberately so: `public_slug` alone
// identifies the row. A parent who corrects the city on a posted tuition
// therefore does not break the link they already shared -- the old URL still
// resolves and this page redirects it to the canonical one.

export const dynamic = 'force-dynamic'

type Params = Promise<{ city: string; slug: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const job = await jobByPublicSlug(slug)

  // `job.status !== 'open'` for the same reason the body checks it: an admin
  // and the job's own parent can read a closed row, and a title carrying the
  // tuition's own headline on a page answering 404 is a page arguing with its
  // status code. Next injects noindex on a 404 by itself; `follow` keeps the
  // links onward to the city's open board worth something.
  if (!job || job.status !== 'open') {
    return { title: pageTitle('Tuition closed'), robots: { index: false, follow: true } }
  }

  const where = job.city ? ` in ${job.area ? `${job.area}, ` : ''}${job.city}` : ''
  const title = pageTitle(`${job.title}${where}`)
  const description = pageDescription(
    job.description?.trim()
      ? job.description.trim().slice(0, 150)
      : `${job.title}${where} — apply free`,
  )

  return {
    title,
    description,
    alternates: { canonical: `/tuitions/${citySegment(job.city)}/${job.public_slug}` },
    openGraph: { title, description, type: 'article' },
    // Preview mode is site-wide in app/layout.tsx; repeated here because this
    // page sets its own robots for the closed case and an object replaces the
    // inherited one rather than merging with it.
    ...(PREVIEW_MODE ? { robots: { index: false, follow: false } } : {}),
  }
}

export default async function TuitionPage({ params }: { params: Params }) {
  const { city: citySeg, slug } = await params

  const job = await jobByPublicSlug(slug)

  // ------------------------------------------------------------ gone / 404 --
  //
  // `job.status !== 'open'` is not redundant with the null check. An ADMIN and
  // the job's own parent CAN read a closed row — jobs_public_read_open is
  // `status = 'open' OR parent_id = auth.uid() OR is_admin()` — so without it
  // those two would get the full open page, Apply button and JobPosting
  // structured data, for a tuition that has been filled. A parent's own view
  // of their closed tuition is on their dashboard, where it can be reopened.
  if (!job || job.status !== 'open') notFound()

  // The slug is the identity; the city segment is a label. A stale one is
  // corrected rather than 404'd, so a link shared before the parent fixed
  // their city keeps working.
  const canonicalCity = citySegment(job.city)
  if (citySeg !== canonicalCity) {
    permanentRedirect(`/tuitions/${canonicalCity}/${job.public_slug}`)
  }

  // ------------------------------------------------------------- the viewer --
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let isTutor = false
  let applied = false

  if (user) {
    const ent = await getEntitlements(user.id)
    isTutor = ent.audience === 'tutor'
    if (isTutor) {
      const { data: mine } = await supabase
        .from('applications')
        .select('id')
        .eq('tutor_id', user.id)
        .eq('job_id', job.id)
        .maybeSingle()
      applied = !!mine
    }
  }

  // Guests see Apply -- pressing it is what opens the sign-in modal. A parent
  // browsing the board has no use for it.
  const showApply = !user || isTutor
  const url = absoluteUrl(`/tuitions/${canonicalCity}/${job.public_slug}`)
  const budget = budgetLabel(job.budget_min_pkr, job.budget_max_pkr, job.budget_pkr)
  const mode = teachingMode(job.teaching_mode)

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          jobPostingJsonLd({
            url,
            title: job.title,
            description:
              job.description?.trim() ||
              `${job.title}${job.city ? ` in ${job.city}` : ''}. Posted by a verified parent on TutorMint.`,
            datePosted: job.created_at,
            city: job.city,
            area: job.area,
            subjects: job.subjects ?? [],
            budgetMin: job.budget_min_pkr ?? job.budget_pkr ?? null,
            budgetMax: job.budget_max_pkr ?? null,
          }),
        )}
      />

      <Breadcrumbs
        items={[
          { label: 'Find tuitions', href: '/browse/tuitions' },
          ...(job.city
            ? [
                {
                  label: job.city,
                  href: `/browse/tuitions?city=${encodeURIComponent(job.city)}`,
                },
              ]
            : []),
          { label: job.title },
        ]}
      />

      <article className="relative space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
        {job.is_featured && <FeaturedTag className="absolute right-3 top-3 sm:right-4 sm:top-4" />}

        <header className="space-y-2 pr-16 sm:pr-20">
          <h1 className="text-xl font-black leading-snug text-tm-navy sm:text-2xl">{job.title}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
            <Clock size={12} aria-hidden className="shrink-0" />
            <TimeAgo iso={job.created_at} />
            <span aria-hidden>·</span>
            <CalendarDays size={12} aria-hidden className="shrink-0" />
            Posted {formatDate(job.created_at)}
          </p>
        </header>

        {job.subjects && job.subjects.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {job.subjects.map((s) => {
              const link = job.subject_links?.find((l) => l.label === s)
              const cls =
                'rounded-full bg-tm-bg px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-gray-200'
              // Every mention of a thing links to the thing: a subject goes to
              // the tutors who teach that exact level-and-subject, in this city.
              return link ? (
                <Link
                  key={s}
                  href={`/browse/tutors?subject=${link.masterId}${job.city ? `&city=${encodeURIComponent(job.city)}` : ''}`}
                  className={`${cls} hover:ring-tm-navy`}
                >
                  {s}
                </Link>
              ) : (
                <span key={s} className={cls}>
                  {s}
                </span>
              )
            })}
          </div>
        )}

        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {job.class_level && (
            <Fact icon={<GraduationCap size={14} aria-hidden />} label="Level">
              {job.class_level}
            </Fact>
          )}
          <Fact icon={<MapPin size={14} aria-hidden />} label="Where">
            {job.city ? (
              <>
                {job.area ? `${job.area}, ` : ''}
                <Link
                  href={`/browse/tuitions?city=${encodeURIComponent(job.city)}`}
                  className="font-bold text-tm-navy hover:underline"
                >
                  {job.city}
                </Link>
              </>
            ) : (
              (mode ?? 'Flexible')
            )}
          </Fact>
          {mode && (
            <Fact icon={<Briefcase size={14} aria-hidden />} label="Mode">
              {mode}
            </Fact>
          )}
          {budget && (
            <Fact icon={<Wallet size={14} aria-hidden />} label="Budget">
              <span className="font-black text-tm-navy">{budget}</span> / month
            </Fact>
          )}
        </dl>

        {job.description && (
          <div className="space-y-1">
            <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">
              What the parent wrote
            </h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
              {job.description}
            </p>
          </div>
        )}

        {showApply && (
          <div className="border-t border-gray-100 pt-4">
            <ApplyPanel
              jobId={job.id}
              title={job.title}
              signedIn={!!user}
              applied={applied}
            />
          </div>
        )}
      </article>

      {/* Who posted it. Name, picture and badges — never a number, an email or
          an address. Contact details are what a Featured plan buys, and a
          public URL is the last place to give them away. */}
      {job.parent_id && job.parent_name && (
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">
            Posted by
          </h2>
          <div className="flex items-center gap-3">
            <Avatar
              name={job.parent_name}
              src={job.parent_avatar_url}
              seed={job.parent_id}
              decorative
              className="h-12 w-12 shrink-0 text-sm"
            />
            <div className="min-w-0 space-y-1">
              <Link
                href={`/parent/${job.parent_id}`}
                className="inline-flex min-h-[24px] items-center text-sm font-black text-tm-navy hover:text-tm-red hover:underline"
              >
                {job.parent_name}
              </Link>
              {job.parent_badges.length > 0 && <BadgeRow badges={job.parent_badges} size="sm" />}
              <p className="text-[11px] leading-relaxed text-gray-500">
                {job.parent_can_hire
                  ? 'Featured parent — able to complete a hire.'
                  : 'Verified parent — cannot complete a hire yet.'}
              </p>
            </div>
          </div>

          {user && (
            <ReportButton
              reportedId={job.parent_id}
              targetType="job"
              targetId={job.id}
              label="Report this post"
            />
          )}
        </section>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed text-gray-500 sm:p-5">
        Looking for something else?{' '}
        <Link href="/browse/tuitions" className="font-bold text-tm-red hover:underline">
          All open tuitions
        </Link>
        {job.city && (
          <>
            {' · '}
            <Link
              href={`/browse/tutors?city=${encodeURIComponent(job.city)}`}
              className="font-bold text-tm-red hover:underline"
            >
              Tutors in {job.city}
            </Link>
          </>
        )}
        {' · '}
        <Link href="/faq" className="font-bold text-tm-red hover:underline">
          How applying works
        </Link>
      </section>
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
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-gray-500">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</dt>
        <dd className="text-sm text-slate-700">{children}</dd>
      </div>
    </div>
  )
}
