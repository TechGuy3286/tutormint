import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { Briefcase, CalendarDays, Clock, GraduationCap, MapPin, ShieldCheck, Wallet, UserRound } from 'lucide-react'
import { genderPrefSentence, genderApplyBlocked } from '@/lib/genderPref'

import Avatar from '@/components/Avatar'
import ContactReveal from '@/components/ContactReveal'
import BadgeRow from '@/components/badges/BadgeRow'
import Breadcrumbs from '@/components/Breadcrumbs'
import FeaturedTag from '@/components/badges/FeaturedTag'
import TimeAgo from '@/components/TimeAgo'
import ReportButton from '@/components/ReportButton'
import { budgetLabel } from '@/lib/feeBands'
import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'
import { jobByPublicSlug, similarOpenTuitions } from '@/lib/jobFeed'
import { tuitionPublicState, pauseCountdownLabel } from '@/lib/tuitionStatus'
import { isFixtureTuition } from '@/lib/fixtures'
import { tuitionIndexable } from '@/lib/seo/indexable'
import JobCard from '@/components/JobCard'
import ResumeInline from './ResumeInline'
import { citySegment } from '@/lib/slugs'
import { formatDate } from '@/lib/datetime'
import { jobType } from '@/lib/display'
import { absoluteUrl } from '@/lib/siteUrl'
import { jobPostingJsonLd, jsonLdScript, pageDescription, pageTitle, socialMeta } from '@/lib/seo'
import { preferHumanTitle } from '@/lib/jobDisplayTitle'
import { isSubjectSlug, resolveLanding, getLandingLinker } from '@/lib/landing'
import LandingView from '@/components/landing/LandingView'
import ApplyPanel from './ApplyPanel'

// THIS ROUTE SERVES TWO PAGES. Next forbids two dynamic param names at one
// position, so /tuitions/[city]/[subject] (the T9.1 landing) cannot be its own
// route alongside /tuitions/[city]/[slug] (this tuition detail). They share the
// segment: if it is a known taxonomy SUBJECT slug (o-levels-physics), this is a
// landing page; otherwise it is a tuition's public_slug. The two namespaces do
// not collide — a public_slug always carries a hash suffix — so the subject
// check is unambiguous and runs first.

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
  const { city, slug } = await params

  // Landing page (a subject slug), not a tuition.
  if (await isSubjectSlug(slug)) {
    const combo = await resolveLanding('tuitions', city, slug)
    if (!combo) return { title: pageTitle('Tuitions'), robots: { index: false, follow: true } }
    const heading = `${combo.subjectName} tuitions in ${combo.city}`
    const lead = `${combo.count} open ${combo.subjectName} tuition${combo.count === 1 ? '' : 's'} in ${combo.city}`
    const title = pageTitle(heading)
    const description = pageDescription(lead)
    return {
      title,
      description,
      alternates: { canonical: `/tuitions/${combo.citySlug}/${combo.subjectSlug}` },
      // Branded default image — a landing page has no imagery of its own.
      ...socialMeta({
        title,
        description,
        path: `/tuitions/${combo.citySlug}/${combo.subjectSlug}`,
        type: 'website',
      }),
    }
  }

  const job = await jobByPublicSlug(slug)

  // Only a slug that does not exist is a 404 (PR28). The body renders 200 for a
  // paused/closed/hired tuition; here we give the missing case a generic noindex
  // title. `follow` keeps the onward links worth something.
  if (!job) {
    return { title: pageTitle('Tuition'), robots: { index: false, follow: true } }
  }

  // The PAGE <title> and JobPosting JSON-LD use the stored human headline the
  // parent/admin wrote — a pipe-joined field list reads as a database row in a
  // browser tab and a Google Jobs result. Falls back to the composed string only
  // when there is no stored title (owner, 11 Sep 2026). The CARD keeps composed.
  const pageHeadline = preferHumanTitle(job.headline, job.title)
  const title = pageTitle(pageHeadline)
  const description = pageDescription(
    job.description?.trim()
      ? job.description.trim().slice(0, 150)
      : `${pageHeadline} — apply free`,
  )

  // A FIXTURE tuition (seed parent / JOB-TRK bulk import / SEED-JOB) is noindex
  // regardless (owner, 10 Sep 2026). And a paused/closed/hired tuition is 200 +
  // noindex (PR28 §6) — de-listed from Google's jobs results while it is not
  // accepting applications, reversing cleanly on resume. Only an OPEN, non-fixture
  // tuition is indexable (matching the sitemap and the JobPosting JSON-LD below).
  const fixture = isFixtureTuition({
    jobTxId: job.job_tx_id,
    parentIsSeed: job.poster_is_seed,
    postedByTeam: job.posted_by_team,
  })
  // PR37 §2 / PR43 §3 — the one shared indexability rule: open + not a fixture +
  // enough description to stand alone (a one-line post is too thin to index).
  const noindex = !tuitionIndexable({
    status: job.status,
    isFixture: fixture,
    descriptionLength: job.description?.trim().length ?? 0,
  })

  return {
    title,
    description,
    alternates: { canonical: `/tuitions/${citySegment(job.city)}/${job.public_slug}` },
    // Branded default image (a tuition has no imagery of its own), complete OG +
    // Twitter so the share is not a bare link. The title/description carry the
    // job title, place and (public) description only — never the posting
    // parent's account name, which is not in this data.
    ...socialMeta({
      title,
      description,
      path: `/tuitions/${citySegment(job.city)}/${job.public_slug}`,
      type: 'article',
    }),
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function TuitionPage({ params }: { params: Params }) {
  const { city: citySeg, slug } = await params

  // Landing page branch: a subject slug renders the city × subject landing,
  // 404 below the threshold. A tuition slug falls through to the detail page.
  if (await isSubjectSlug(slug)) {
    const combo = await resolveLanding('tuitions', citySeg, slug)
    if (!combo) notFound()
    return <LandingView combo={combo} />
  }

  const job = await jobByPublicSlug(slug)

  // ------------------------------------------------------------------ 404 --
  //
  // 404 is ONLY for a slug that does not exist (PR28). A paused/closed/hired
  // tuition renders 200 with a plain status banner — never a 404, so an indexed
  // URL that auto-pauses does not flap 200↔404 and no state is a dead end.
  if (!job) notFound()

  // The public state of the page: open accepts applications, is indexable, emits
  // JobPosting and sits in the sitemap; paused/closed/hired do none of those and
  // carry a plain banner. All render 200.
  const state = tuitionPublicState(job.status)

  // The page's title/heading is the stored human headline (composed only as a
  // fallback) — the composed field list belongs on the card, not on the page or
  // in a JobPosting result. The card component (JobCard) is unaffected.
  const pageHeadline = preferHumanTitle(job.headline, job.title)

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
  let tutorGender: string | null = null
  let isPoster = false
  let isAdmin = false

  if (user) {
    const ent = await getEntitlements(user.id)
    isTutor = ent.audience === 'tutor'
    isAdmin = ent.role === 'admin'
    isPoster = job.parent_id === user.id
    if (isTutor) {
      const [{ data: mine }, { data: me }] = await Promise.all([
        supabase.from('applications').select('id').eq('tutor_id', user.id).eq('job_id', job.id).maybeSingle(),
        supabase.from('tutor_profiles').select('gender').eq('id', user.id).maybeSingle(),
      ])
      applied = !!mine
      tutorGender = (me?.gender as string | null) ?? null
    }
  }

  // §7 — the poster (and admin) see when their OPEN tuition will auto-pause,
  // derived at read time from coalesce(resumed_at, created_at) + 15 days. The
  // poster reads their own row, so no service role is needed.
  let pauseLabel: string | null = null
  if ((isPoster || isAdmin) && state.isOpen) {
    const { data: clock } = await supabase
      .from('jobs')
      .select('created_at, resumed_at')
      .eq('id', job.id)
      .maybeSingle()
    const base =
      (clock?.resumed_at as string | null) ?? (clock?.created_at as string | null) ?? job.created_at
    pauseLabel = pauseCountdownLabel(base)
  }

  // A non-open tuition is never a dead end (§3): offer similar OPEN tuitions,
  // same city first then same subject, plus the browse links already below.
  const similar = !state.isOpen
    ? await similarOpenTuitions(
        job.id,
        job.city,
        (job.subject_links ?? []).map((l) => l.masterId),
        3,
      )
    : []

  // §3 — an OPEN tuition is cross-linked too, so the page carries more unique,
  // useful content than a single row: the matching landing page (all tuitions for
  // this subject in this city, when one exists) and a few live related tuitions.
  let landingHref: string | null = null
  let landingLabel: string | null = null
  let relatedOpen: typeof similar = []
  if (state.isOpen && job.city) {
    // The first of this tuition's subjects that HAS a landing page (a job lists
    // several subjects and the first is not always one that clears the
    // threshold). A real /tuitions/ path — not the /browse fallback — means the
    // page exists.
    const linker = await getLandingLinker()
    for (const s of job.subject_links ?? []) {
      const href = linker.tuitionSubjectHref(s.masterId, job.city)
      if (href.startsWith('/tuitions/')) {
        landingHref = href
        landingLabel = s.label
        break
      }
    }
    relatedOpen = await similarOpenTuitions(
      job.id,
      job.city,
      (job.subject_links ?? []).map((l) => l.masterId),
      3,
    )
  }

  // The gender-preference sentence, shown plainly to everyone. And, for a
  // signed-in tutor whose gender does not match, the Apply-blocking reason —
  // the SAME server rule (genderApplyBlocked), so the button and the API agree.
  // An unset tutor gender never blocks (owner, 11 Sep 2026).
  const genderSentence = genderPrefSentence(job.gender_preference)
  const genderBlockedNotice =
    isTutor && genderApplyBlocked(job.gender_preference, tutorGender) ? genderSentence : null

  // A staff-posted team tuition carries the real external parent's contact
  // (job_contacts). Since PR57 it is revealed through the SAME counted flow as a
  // parent account's contact — a "Show phone & email" button on the poster card
  // below (ContactReveal jobId=…), not rendered into this page. It is never in
  // the HTML, props, metadata, JSON-LD, OG or sitemap before a tutor taps.

  // Guests see Apply -- pressing it is what opens the sign-in modal. A parent
  // browsing the board has no use for it. Only an OPEN tuition shows Apply; a
  // paused/closed/hired one hides it (and the server refuses regardless, §4).
  const showApply = state.isOpen && (!user || isTutor)
  const url = absoluteUrl(`/tuitions/${canonicalCity}/${job.public_slug}`)
  const budget = budgetLabel(job.budget_min_pkr, job.budget_max_pkr, job.budget_pkr)
  const mode = jobType(job.teaching_mode)

  // A fixture tuition emits NO JobPosting structured data (owner, 10 Sep 2026):
  // JobPosting markup on an indexed fixture can surface in Google's jobs listings
  // as a real vacancy. The page still renders in full on-site; only the machine-
  // readable job claim is withheld. A genuine team post keeps its markup.
  const fixture = isFixtureTuition({
    jobTxId: job.job_tx_id,
    parentIsSeed: job.poster_is_seed,
    postedByTeam: job.posted_by_team,
  })

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
      {/* JobPosting structured data: OPEN, non-fixture tuitions only (§6). A
          paused/closed/hired tuition must not sit in Google's jobs results. */}
      {!fixture && state.emitJobPosting && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={jsonLdScript(
            jobPostingJsonLd({
              url,
              title: pageHeadline,
              description:
                job.description?.trim() ||
                `${pageHeadline}. ${
                  job.posted_by_team
                    ? 'Posted by the TutorMint team.'
                    : 'Posted by a verified parent on TutorMint.'
                }`,
              datePosted: job.created_at,
              city: job.city,
              area: job.area,
              subjects: job.subjects ?? [],
              budgetMin: job.budget_min_pkr ?? job.budget_pkr ?? null,
              budgetMax: job.budget_max_pkr ?? null,
            }),
          )}
        />
      )}

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
          { label: pageHeadline },
        ]}
      />

      <article className="relative space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
        {job.is_featured && <FeaturedTag className="absolute right-3 top-3 sm:right-4 sm:top-4" />}

        {/* Status banner for a non-open tuition (§2): plain, in the same voice as
            the rest of the page. Vocabulary stays paused/closed/hired. */}
        {state.banner && (
          <div
            className={`space-y-2 rounded-xl p-3 ${
              state.banner.tone === 'gold'
                ? 'bg-tm-tint-gold text-tm-gold-ink'
                : state.banner.tone === 'green'
                  ? 'bg-tm-tint-green text-tm-green-deep'
                  : 'bg-tm-tint-navy text-tm-navy'
            }`}
          >
            <p className="text-xs font-bold">{state.banner.text}</p>
            {/* The poster's own Resume, inline (§5) — reuses /api/parent/jobs/resume. */}
            {isPoster && job.status === 'paused' && <ResumeInline jobId={job.id} />}
            {/* An admin manages pause/resume on the admin tuition page (§5). */}
            {isAdmin && !isPoster && (
              <Link
                href={`/admin/jobs/${job.id}`}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-current px-4 text-xs font-bold"
              >
                Manage this tuition in admin
              </Link>
            )}
          </div>
        )}

        {/* §7 — the poster/admin see when an OPEN tuition will auto-pause. The
            label never shows 0 or a negative (PR29 §B): "pauses today" covers the
            last day and the past-due-but-unswept window; it still takes
            applications until the sweep actually pauses it. */}
        {pauseLabel && state.isOpen && (
          <p className="rounded-xl bg-tm-bg p-3 text-[11px] font-semibold text-gray-500">
            {pauseLabel === 'pauses today'
              ? 'Pauses today unless you resume it — after that it is hidden from tutors until you resume it.'
              : `This tuition ${pauseLabel} — after that, resume it to keep it visible to tutors.`}
          </p>
        )}

        {job.under_review && (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-tm-tint-gold px-3 py-1 text-[11px] font-black uppercase tracking-wide text-tm-gold-ink">
            Under review
          </p>
        )}

        {/* A trusted team tuition — the platform's own vetting, not a parent's. */}
        {job.posted_by_team && (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-tm-tint-navy px-3 py-1 text-[11px] font-black uppercase tracking-wide text-tm-navy">
            <ShieldCheck aria-hidden size={13} />
            Posted by TutorMint
          </p>
        )}

        <header className="space-y-2 pr-16 sm:pr-20">
          <h1 className="text-xl font-black leading-snug text-tm-navy sm:text-2xl">{pageHeadline}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
            <Clock size={12} aria-hidden className="shrink-0" />
            <TimeAgo iso={job.created_at} />
            <span aria-hidden>·</span>
            <CalendarDays size={12} aria-hidden className="shrink-0" />
            Posted {formatDate(job.created_at)}
            {job.ref_id && (
              <>
                <span aria-hidden>·</span>
                <span className="font-semibold tabular-nums text-slate-700">Ref {job.ref_id}</span>
              </>
            )}
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
                  href={
                    link.href ??
                    `/browse/tutors?subject=${link.masterId}${job.city ? `&city=${encodeURIComponent(job.city)}` : ''}`
                  }
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

        {genderSentence && (
          <p className="flex items-center gap-2 rounded-xl bg-tm-tint-navy p-3 text-xs font-semibold text-tm-navy">
            <UserRound aria-hidden size={14} className="shrink-0" />
            {genderSentence}
          </p>
        )}

        {job.description && (
          <div className="space-y-1">
            <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">
              {job.posted_by_team ? 'About this tuition' : 'What the parent wrote'}
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
              title={pageHeadline}
              signedIn={!!user}
              applied={applied}
              underReview={!!job.under_review}
              genderBlockedNotice={genderBlockedNotice}
              city={job.city}
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
                className="inline-flex min-h-[24px] items-center gap-1.5 text-sm font-black text-tm-navy hover:text-tm-red hover:underline"
              >
                {job.posted_by_team && <ShieldCheck aria-hidden size={14} className="text-tm-navy" />}
                {job.parent_name}
              </Link>
              {job.parent_badges.length > 0 && <BadgeRow badges={job.parent_badges} size="sm" />}
              <p className="text-[11px] leading-relaxed text-gray-500">
                {job.posted_by_team
                  ? 'A verified team tuition, posted and managed by the TutorMint team.'
                  : job.parent_can_hire
                    ? 'Featured parent — able to complete a hire.'
                    : 'Verified parent — cannot complete a hire yet.'}
              </p>
              {/* Tutor-only contact reveal. Real-parent tuitions reveal the
                  parent account (PR56); staff-posted team tuitions reveal the
                  external parent's job contact (PR57), never the team account.
                  Both go through the same counted /api/contact/reveal flow, so
                  no contact is in this page until a tutor taps. */}
              {isTutor && !job.posted_by_team && (
                <ContactReveal parentId={job.parent_id} className="pt-1" />
              )}
              {isTutor && job.posted_by_team && (
                <ContactReveal jobId={job.id} className="pt-1" />
              )}
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

      {/* No dead end (§3): a paused/closed/hired page offers live tuitions to go
          to — same city first, then same subject. */}
      {!state.isOpen && similar.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-black text-tm-navy">Similar open tuitions</h2>
          <div className="space-y-4">
            {similar.map((t) => (
              <JobCard
                key={t.id}
                job={t}
                signedIn={!!user}
                showApply={!user || isTutor}
                viewerCity={job.city}
              />
            ))}
          </div>
        </section>
      )}

      {/* §3 — an OPEN tuition points at more of the same: the matching landing
          page and a few live related tuitions, so it is not a dead-end single row. */}
      {state.isOpen && (landingHref || relatedOpen.length > 0) && (
        <section className="space-y-3">
          {landingHref && landingLabel && (
            <Link
              href={landingHref}
              className="flex items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-sm font-bold text-tm-navy hover:border-tm-navy sm:p-5"
            >
              <span className="inline-flex items-center gap-2">
                <Briefcase aria-hidden size={16} className="text-gray-500" />
                See all {landingLabel} tuitions in {job.city}
              </span>
              <span aria-hidden className="text-tm-red">→</span>
            </Link>
          )}
          {relatedOpen.length > 0 && (
            <>
              <h2 className="text-sm font-black text-tm-navy">
                More open tuitions{job.city ? ` in ${job.city}` : ''}
              </h2>
              <div className="space-y-4">
                {relatedOpen.map((t) => (
                  <JobCard
                    key={t.id}
                    job={t}
                    signedIn={!!user}
                    showApply={!user || isTutor}
                    viewerCity={job.city}
                  />
                ))}
              </div>
            </>
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
