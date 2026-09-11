import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { Briefcase, CalendarDays, Clock, GraduationCap, Globe, Mail, MapPin, MessageCircle, Phone, ShieldCheck, Wallet, UserRound } from 'lucide-react'
import { genderPrefSentence, genderApplyBlocked } from '@/lib/genderPref'

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
import { isFixtureTuition } from '@/lib/fixtures'
import { citySegment } from '@/lib/slugs'
import { formatDate } from '@/lib/datetime'
import { jobType } from '@/lib/display'
import { absoluteUrl } from '@/lib/siteUrl'
import { jobPostingJsonLd, jsonLdScript, pageDescription, pageTitle, socialMeta } from '@/lib/seo'
import { isSubjectSlug, resolveLanding } from '@/lib/landing'
import { loadJobContact } from '@/lib/jobContact'
import { normalisePkMobile, formatPkMobile } from '@/lib/phone'
import { whatsappHref } from '@/lib/support'
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

  // A FIXTURE tuition (seed parent / JOB-TRK bulk import / SEED-JOB) is noindex
  // regardless of anything else (owner, 10 Sep 2026) — it stays visible and
  // browsable on-site but is kept out of Google, matching its exclusion from the
  // sitemap and the suppressed JobPosting JSON-LD in the body. A genuine team
  // post is never a fixture and stays indexable.
  const fixture = isFixtureTuition({
    jobTxId: job.job_tx_id,
    parentIsSeed: job.poster_is_seed,
    postedByTeam: job.posted_by_team,
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
    // A real open tuition carries no robots key (indexable, matching the
    // sitemap); a fixture is noindex. The closed/missing case above sets its own
    // noindex, and an under-review job stays visible with a sticker (not
    // delisted), so those need nothing here.
    ...(fixture ? { robots: { index: false, follow: true } } : {}),
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
  let tutorGender: string | null = null

  if (user) {
    const ent = await getEntitlements(user.id)
    isTutor = ent.audience === 'tutor'
    if (isTutor) {
      const [{ data: mine }, { data: me }] = await Promise.all([
        supabase.from('applications').select('id').eq('tutor_id', user.id).eq('job_id', job.id).maybeSingle(),
        supabase.from('tutor_profiles').select('gender').eq('id', user.id).maybeSingle(),
      ])
      applied = !!mine
      tutorGender = (me?.gender as string | null) ?? null
    }
  }

  // The gender-preference sentence, shown plainly to everyone. And, for a
  // signed-in tutor whose gender does not match, the Apply-blocking reason —
  // the SAME server rule (genderApplyBlocked), so the button and the API agree.
  // An unset tutor gender never blocks (owner, 11 Sep 2026).
  const genderSentence = genderPrefSentence(job.gender_preference)
  const genderBlockedNotice =
    isTutor && genderApplyBlocked(job.gender_preference, tutorGender) ? genderSentence : null

  // A seeded team tuition can carry the real parent's contact. It is shown
  // OPENLY to a signed-in TUTOR — no plan gate — so a tutor can reach the parent
  // directly. Read via the service role (loadJobContact) and rendered ONLY in
  // this tutor branch: an anonymous crawler, a guest and a parent never receive
  // it, so it is never indexed and never in the metadata, JSON-LD, OG or sitemap.
  const contact = isTutor && job.posted_by_team ? await loadJobContact(job.id) : null
  // Phone and WhatsApp are stored already-normalised (MSISDN), but re-normalise
  // defensively before building tel:/wa.me links.
  const contactMsisdn = contact?.contact_phone ? normalisePkMobile(contact.contact_phone) : null
  const contactWaMsisdn = contact?.contact_whatsapp ? normalisePkMobile(contact.contact_whatsapp) : null
  const contactWa = contactWaMsisdn
    ? whatsappHref(contactWaMsisdn, 'Assalam o Alaikum, I saw your tuition on TutorMint and would like to discuss it.')
    : null
  const contactSocialHref =
    contact?.contact_social && /^https?:\/\//i.test(contact.contact_social) ? contact.contact_social : null
  const hasAnyContact = !!(
    contact &&
    (contact.contact_name ||
      contactMsisdn ||
      contactWa ||
      contact.contact_email ||
      contact.contact_address ||
      contact.contact_social)
  )

  // Guests see Apply -- pressing it is what opens the sign-in modal. A parent
  // browsing the board has no use for it.
  const showApply = !user || isTutor
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
      {!fixture && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={jsonLdScript(
            jobPostingJsonLd({
              url,
              title: job.title,
              description:
                job.description?.trim() ||
                `${job.title}${job.city ? ` in ${job.city}` : ''}. ${
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
          { label: job.title },
        ]}
      />

      <article className="relative space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
        {job.is_featured && <FeaturedTag className="absolute right-3 top-3 sm:right-4 sm:top-4" />}

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
              title={job.title}
              signedIn={!!user}
              applied={applied}
              underReview={!!job.under_review}
              genderBlockedNotice={genderBlockedNotice}
              city={job.city}
            />
          </div>
        )}
      </article>

      {/* A seeded team tuition's real-parent contact — tutors only, no gate.
          Rendered only in the signed-in-tutor branch above, so it never reaches
          a guest, a parent or a crawler. */}
      {hasAnyContact && contact && (
        <section className="space-y-3 rounded-2xl border border-tm-green-deep/30 bg-tm-tint-green p-4 sm:p-5">
          <h2 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-tm-green-deep">
            <Phone aria-hidden size={13} />
            Contact this parent directly
          </h2>
          {contact.contact_name && <p className="text-sm font-black text-tm-navy">{contact.contact_name}</p>}

          {/* Call + WhatsApp buttons. Each renders only if its number is present
              — a job with an email and no numbers shows no button row. */}
          {(contactMsisdn || contactWa) && (
            <div className="flex flex-wrap gap-2">
              {contactMsisdn && (
                <a
                  href={`tel:+${contactMsisdn}`}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white transition-colors hover:bg-tm-green-deep-hover"
                >
                  <Phone aria-hidden size={14} />
                  Call {formatPkMobile(contactMsisdn)}
                </a>
              )}
              {contactWa && (
                <a
                  href={contactWa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-tm-green-deep bg-white px-4 text-xs font-bold text-tm-green-deep transition-colors hover:bg-tm-tint-green"
                >
                  <MessageCircle aria-hidden size={14} />
                  WhatsApp{contactWaMsisdn ? ` ${formatPkMobile(contactWaMsisdn)}` : ''}
                </a>
              )}
            </div>
          )}

          {/* Email, address, social — each a row only when filled; no empty rows
              and no stray labels. */}
          {(contact.contact_email || contact.contact_address || contact.contact_social) && (
            <dl className="space-y-1.5 text-xs text-slate-700">
              {contact.contact_email && (
                <div className="flex items-start gap-2">
                  <Mail aria-hidden size={14} className="mt-0.5 shrink-0 text-tm-green-deep" />
                  <a href={`mailto:${contact.contact_email}`} className="font-semibold text-tm-navy underline">
                    {contact.contact_email}
                  </a>
                </div>
              )}
              {contact.contact_address && (
                <div className="flex items-start gap-2">
                  <MapPin aria-hidden size={14} className="mt-0.5 shrink-0 text-tm-green-deep" />
                  <span className="font-semibold text-tm-navy">{contact.contact_address}</span>
                </div>
              )}
              {contact.contact_social && (
                <div className="flex items-start gap-2">
                  <Globe aria-hidden size={14} className="mt-0.5 shrink-0 text-tm-green-deep" />
                  {contactSocialHref ? (
                    <a
                      href={contactSocialHref}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="font-semibold text-tm-navy underline break-all"
                    >
                      {contact.contact_social}
                    </a>
                  ) : (
                    <span className="font-semibold text-tm-navy break-all">{contact.contact_social}</span>
                  )}
                </div>
              )}
            </dl>
          )}

          <p className="text-[11px] leading-relaxed text-slate-700">
            Posted by TutorMint — you can contact the parent directly, no application needed. You
            can still apply through TutorMint if you prefer.
          </p>
        </section>
      )}

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
