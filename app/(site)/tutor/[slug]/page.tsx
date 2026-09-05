import Avatar from '@/components/Avatar'
import Breadcrumbs from '@/components/Breadcrumbs'
import UpgradeTrigger from '@/components/upgrade/UpgradeTrigger'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { headers } from 'next/headers'
import { MapPin, Building2, Briefcase, Wallet, Lock, Phone, MessageCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEntitlements, badgesForPlan, isFeaturedPlan } from '@/lib/entitlements'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import BadgeRow from '@/components/badges/BadgeRow'
import FeaturedTag from '@/components/badges/FeaturedTag'
import SecureDocumentPreview from '@/components/SecureDocumentPreview'
import ReportButton from '@/components/ReportButton'
import ProfileActions from './ProfileActions'
import { formatDate } from '@/lib/datetime'
import { levelLabel, teachingMode } from '@/lib/display'
import { jsonLdScript, pageDescription, pageTitle, tutorJsonLd } from '@/lib/seo'
import { getLandingLinker } from '@/lib/landing'
import { currentSlugForRetired } from '@/lib/tutorSlug'

// The public tutor profile. Server component, results in the HTML.
//
// Everything a search engine and a parent need is rendered on the server:
// name, headline, subjects, area, experience, reviews. The only client pieces
// are the shortlist/demo buttons and the sign-in modal.
//
// Contact details are the one thing this page is careful about. They are not
// in tutor_public_page() at all -- that function's column list is the
// allowlist -- so they cannot leak into the HTML by accident. When the viewer
// is entitled to them, they are fetched separately, after getEntitlements()
// has said yes.

export const dynamic = 'force-dynamic'

type Params = Promise<{ slug: string }>

type PublicTutor = {
  id: string
  slug: string
  full_name: string
  headline: string | null
  bio: string | null
  avatar_url: string | null
  city: string | null
  area: string | null
  teaching_mode: string | null
  online_platforms: string[] | null
  gender: string | null
  hourly_rate_pkr: number | null
  experience_years: number | null
  degrees: string[] | null
  video_youtube_id: string | null
  video_status: string | null
  rating_avg: string | number | null
  rating_count: number | null
  created_at: string
  plan_code: string | null
  subjects: { master_id: number; category: string; level: string; subject: string | null }[]
  slots: { id: string; text: string; booked: boolean }[]
  reviews: { id: string; rating: number; comment: string | null; created_at: string; reviewer: string }[]
  degree_documents: { id: string; label: string | null }[]
}

async function loadTutor(slug: string): Promise<PublicTutor | null> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('tutor_public_page', { p_slug: slug })
  const row = (data as PublicTutor[] | null)?.[0]
  return row ?? null
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const tutor = await loadTutor(slug)
  if (!tutor) return { title: pageTitle('Tutor not found') }

  const subjects = Array.from(
    new Set(tutor.subjects.map((s) => s.subject ?? s.level).filter(Boolean)),
  ).slice(0, 3)

  const subjectText = subjects.length > 0 ? subjects.join(', ') : 'Verified'
  const city = tutor.city ?? 'Pakistan'
  // The page name is the tutor and what they teach; the template adds the
  // promise and the brand. A long name plus three subjects will be truncated
  // by the search engine, which is preferable to dropping the brand.
  const title = pageTitle(`${tutor.full_name} — ${subjectText} tutor in ${city}`)
  const description = pageDescription(
    tutor.headline
      ? `${tutor.headline} — ${subjectText} in ${city}`
      : `${tutor.full_name} teaches ${subjectText} in ${city}`,
  )

  return {
    title,
    description,
    alternates: { canonical: `/tutor/${tutor.slug}` },
    openGraph: {
      title,
      description,
      type: 'profile',
      images: tutor.avatar_url ? [tutor.avatar_url] : undefined,
    },
  }
}

/**
 * Record the view for the tutor's dashboard teaser.
 *
 * Written with the service-role client because profile_views is admin-read
 * only: if tutors could select their own rows with the anon key, the
 * "anonymised until you upgrade" teaser would be decoration, since viewer_id
 * would be one query away.
 *
 * The search context comes from the Referer when it is one of our own browse
 * URLs -- that is what turns the teaser from "someone viewed you" into "a
 * parent searching O Level Physics in Gulberg viewed you".
 */
async function recordView(tutorId: string, viewerId: string | null, viewerRole: string | null) {
  const admin = createAdminClient()
  if (!admin) return
  if (viewerId === tutorId) return // your own profile is not a lead

  if (viewerId) {
    // One row per viewer per hour, so a refresh is not a new "view".
    const hourAgo = new Date(Date.now() - 3600_000).toISOString()
    const { data: recent } = await admin
      .from('profile_views')
      .select('id')
      .eq('tutor_id', tutorId)
      .eq('viewer_id', viewerId)
      .gt('created_at', hourAgo)
      .maybeSingle()
    if (recent) return
  }

  let searchSubject: string | null = null
  let searchArea: string | null = null
  let searchCity: string | null = null

  try {
    const referer = (await headers()).get('referer')
    if (referer) {
      const url = new URL(referer)
      if (url.pathname.startsWith('/browse/')) {
        searchSubject = url.searchParams.get('subject')
        searchArea = url.searchParams.get('area')
        searchCity = url.searchParams.get('city')
      }
    }
  } catch {
    // A malformed Referer must never cost us the view row.
  }

  await admin.from('profile_views').insert({
    tutor_id: tutorId,
    viewer_id: viewerId,
    viewer_role: viewerRole,
    search_subject: searchSubject,
    search_area: searchArea,
    search_city: searchCity,
    source: searchSubject || searchArea || searchCity ? 'search' : 'direct',
  })

  await notifyProfileViewed({
    admin,
    tutorId,
    subjectMasterId: searchSubject,
    area: searchArea,
    city: searchCity,
  })
}

/**
 * Tell the tutor somebody looked — at most once a day.
 *
 * ONE A DAY, NOT ONE A VIEW. A parent comparing five tutors generates five
 * views in a minute, and a browsing session would otherwise arrive as a
 * notification storm about a fact the dashboard card already totals. The
 * throttle is a query for this tutor's most recent profile_viewed rather than
 * a stored timestamp: the notification IS the record, so there is nothing to
 * keep in step.
 *
 * IT NEVER NAMES THE VIEWER. Identity is what Premium sells and what
 * lib/profileViews withholds in server code; a notification that leaked a name
 * would hand it out through the back door. The body carries the search that
 * led here — the subject and the area — which is the useful half and is not
 * about the person.
 */
async function notifyProfileViewed(params: {
  admin: ReturnType<typeof createAdminClient>
  tutorId: string
  subjectMasterId: string | null
  area: string | null
  city: string | null
}) {
  const { admin, tutorId } = params
  if (!admin) return

  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { data: recent } = await admin
    .from('notifications')
    .select('id')
    .eq('user_id', tutorId)
    .eq('kind', 'profile_viewed')
    .gt('created_at', dayAgo)
    .limit(1)
    .maybeSingle()
  if (recent) return

  let subject: string | null = null
  const masterId = Number(params.subjectMasterId)
  if (Number.isFinite(masterId) && masterId > 0) {
    const { data: m } = await admin
      .from('taxonomy_master')
      .select('level_slug, subject_slug')
      .eq('id', masterId)
      .maybeSingle()
    if (m) {
      const [{ data: level }, { data: sub }] = await Promise.all([
        admin.from('taxonomy_levels').select('name').eq('slug', m.level_slug).maybeSingle(),
        m.subject_slug
          ? admin.from('taxonomy_subjects').select('name').eq('slug', m.subject_slug).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      const levelName = (level?.name as string) ?? ''
      const subjectName = (sub as { name?: string } | null)?.name ?? null
      subject = subjectName ? `${levelName} ${subjectName}`.trim() : levelName || null
    }
  }

  const where = params.area || params.city || null
  const detail =
    subject && where
      ? `Searching ${subject} in ${where}.`
      : subject
        ? `Searching ${subject}.`
        : where
          ? `A parent in ${where}.`
          : null

  await notify({
    userId: tutorId,
    kind: 'profile_viewed',
    title: '1 parent viewed your profile',
    body: detail,
    href: '/tutor/dashboard/views',
  })
}

export default async function TutorPublicProfile({ params }: { params: Params }) {
  const { slug } = await params
  const tutor = await loadTutor(slug)
  // An address that used to work still does.
  //
  // 308, which is what the App Router emits: permanentRedirect() and
  // next.config redirects have no other setting, and Google and Bing treat it
  // exactly as they treat 301 — it is the same instruction, minus the
  // HTTP/1.0-era ambiguity about whether a POST may be replayed as a GET.
  //
  // THE LOOKUP RUNS ONLY WHEN THE PAGE WOULD 404, which is the whole reason it
  // moved here from proxy.ts. There it had to run on every request to
  // /tutor/<anything>, because nothing in a URL says whether an address is
  // live or retired — a database round trip on this site's main organic-search
  // surface to buy a status code nobody distinguishes.
  //
  // Straight to the CURRENT slug, never to another retired one: the lookup
  // reads the tutor's live address rather than walking history forward, so a
  // profile whose URL has changed three times still resolves in one hop.
  if (!tutor) {
    const moved = await currentSlugForRetired(slug)
    if (moved && moved !== slug) permanentRedirect(`/tutor/${moved}`)
    notFound()
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const ent = user ? await getEntitlements(user.id) : null
  const canViewContact = !!ent?.canViewContact
  const isSelf = user?.id === tutor.id

  await recordView(tutor.id, user?.id ?? null, ent?.role ?? null)

  if (user && !isSelf) {
    await logActivity({
      userId: user.id,
      event: 'profile_viewed',
      targetType: 'tutor_profile',
      targetId: tutor.id,
    })
  }

  // Only fetched once entitlements have allowed it.
  //
  // The canonical number is profiles.phone_number -- that is what the OTP
  // route writes when a tutor verifies ownership -- with profiles.whatsapp
  // alongside it. tutor_profiles still carries the pre-migration copies, so
  // they are the fallback for rows that predate T3.
  let contact: { phone: string | null; whatsapp: string | null } | null = null
  if (canViewContact || isSelf) {
    const admin = createAdminClient()
    if (admin) {
      const [{ data: p }, { data: tp }] = await Promise.all([
        admin.from('profiles').select('phone_number, whatsapp').eq('id', tutor.id).maybeSingle(),
        admin
          .from('tutor_profiles')
          .select('phone_number, whatsapp_number')
          .eq('id', tutor.id)
          .maybeSingle(),
      ])
      const phone = (p?.phone_number as string) || (tp?.phone_number as string) || null
      const whatsapp = (p?.whatsapp as string) || (tp?.whatsapp_number as string) || null
      contact = { phone, whatsapp }
    }
  }

  // "Unlocked but empty" and "locked" are different things, and showing the
  // upgrade prompt to someone who has already paid would be selling them
  // something they own. A Featured parent is told the tutor has no number yet.
  const contactUnlocked = canViewContact || isSelf
  const hasContact = !!(contact?.phone || contact?.whatsapp)

  let saved = false
  if (user) {
    const { data } = await supabase
      .from('shortlists')
      .select('tutor_id')
      .eq('tutor_id', tutor.id)
      .maybeSingle()
    saved = !!data
  }

  const badges = badgesForPlan(tutor.plan_code, true)
  const rating = Number(tutor.rating_avg ?? 0)
  const reviews = tutor.rating_count ?? 0

  // Subjects grouped by the level they are taught at.
  //
  // The master_id travels with the label so each chip can link to the tutors
  // who teach that exact level-and-subject. Matching everywhere on this
  // platform is on master_id, so a link built from the label alone would be a
  // text search wearing a filter's clothes.
  const byLevel = new Map<string, { label: string; masterId: number }[]>()
  const levelMaster = new Map<string, number>()
  for (const s of tutor.subjects) {
    const key = `${s.category} — ${s.level}`
    if (!byLevel.has(key)) byLevel.set(key, [])
    if (!levelMaster.has(key)) levelMaster.set(key, s.master_id)
    if (s.subject) byLevel.get(key)!.push({ label: s.subject, masterId: s.master_id })
  }

  /**
   * The landing page for this subject in this tutor's city when one exists,
   * the browse filter otherwise. One helper decides, so a chip never points at
   * a page that is not there.
   */
  const linker = await getLandingLinker()
  const subjectHref = (masterId: number) => linker.tutorSubjectHref(masterId, tutor.city)

  // Person + Service, linked to each other and to the Organization on the
  // homepage. Nothing is asserted that the profile does not hold -- no rating
  // without real reviews, no price without a rate, no area without one chosen.
  // An aggregateRating with a zero count is both a rich-result violation and a
  // claim about a tutor nobody has reviewed.
  const profileSchema = tutorJsonLd({
    slug: tutor.slug,
    name: tutor.full_name,
    headline: tutor.headline,
    avatarUrl: tutor.avatar_url,
    city: tutor.city,
    area: tutor.area,
    subjects: Array.from(
      new Set(tutor.subjects.map((x) => x.subject ?? x.level).filter(Boolean) as string[]),
    ),
    hourlyRatePkr: tutor.hourly_rate_pkr,
    ratingAvg: tutor.rating_avg === null ? null : Number(tutor.rating_avg),
    ratingCount: tutor.rating_count,
  })

  return (
    <main className="min-h-screen bg-tm-bg px-4 pb-28 pt-6 text-slate-700 sm:px-6 sm:pb-8 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(profileSchema)} />
      <div className="mx-auto max-w-3xl space-y-4">
        {/* The breadcrumb replaces the bespoke "← All tutors" link: two ways
            back to the same page is one more than anyone needs, and only one
            of them was in the BreadcrumbList. */}
        <Breadcrumbs
          items={[{ label: 'Find tutors', href: '/browse/tutors' }, { label: tutor.full_name }]}
        />

        {/* ------------------------------------------------------- header --- */}
        <section className="relative rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
          {isFeaturedPlan(tutor.plan_code) && (
            <FeaturedTag className="absolute right-3 top-3 sm:right-4 sm:top-4" />
          )}

          <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
            <Avatar
              name={tutor.full_name}
              src={tutor.avatar_url}
              seed={tutor.id}
              decorative
              className="h-24 w-24 text-2xl sm:h-36 sm:w-36 sm:text-4xl"
            />

            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="text-xl font-black leading-tight text-tm-navy sm:text-2xl">
                {tutor.full_name}
              </h1>
              {tutor.headline && (
                <p className="text-sm font-bold text-tm-green-deep">{tutor.headline}</p>
              )}
              {/* A badge links to the FAQ entry that says what it means.
                  "Verified" on a stranger's profile is a claim, and a claim a
                  parent cannot check is worth very little. */}
              {badges.length > 0 && (
                <Link href="/faq#parents" className="inline-flex" aria-label="What the badges mean">
                  <BadgeRow badges={badges} size="md" showLabel />
                </Link>
              )}

              <p className="text-xs font-bold text-slate-700">
                {reviews > 0 ? (
                  <>
                    ★ {rating.toFixed(1)}{' '}
                    <span className="font-normal text-gray-500">({reviews} reviews)</span>
                  </>
                ) : (
                  <span className="font-normal text-gray-500">No reviews yet</span>
                )}
              </p>

              <div className="grid grid-cols-1 gap-1.5 pt-1 sm:grid-cols-2">
                <p className="flex items-center gap-2 text-xs">
                  <MapPin size={14} className="text-gray-500" />
                  {tutor.area && tutor.city ? (
                    <Link
                      href={`/browse/tutors?city=${encodeURIComponent(tutor.city)}&area=${encodeURIComponent(tutor.area)}`}
                      className="font-semibold hover:text-tm-red hover:underline"
                    >
                      {tutor.area}
                    </Link>
                  ) : (
                    (tutor.area ?? 'Area not set')
                  )}
                </p>
                <p className="flex items-center gap-2 text-xs">
                  <Building2 size={14} className="text-gray-500" />
                  {tutor.city ? (
                    <Link
                      href={`/browse/tutors?city=${encodeURIComponent(tutor.city)}`}
                      className="font-semibold hover:text-tm-red hover:underline"
                    >
                      {tutor.city}
                    </Link>
                  ) : (
                    'Online'
                  )}
                  {teachingMode(tutor.teaching_mode) ? ` · ${teachingMode(tutor.teaching_mode)}` : ''}
                </p>
                <p className="flex items-center gap-2 text-xs">
                  <Briefcase size={14} className="text-gray-500" />
                  {tutor.experience_years
                    ? `${tutor.experience_years} years experience`
                    : 'New to TutorMint'}
                </p>
                {tutor.hourly_rate_pkr ? (
                  <p className="flex items-center gap-2 text-xs font-black text-tm-navy">
                    <Wallet size={14} className="text-gray-500" />
                    Rs. {tutor.hourly_rate_pkr.toLocaleString('en-PK')} / month
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ contact --- */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
          <h2 className="text-sm font-black text-tm-navy">Contact</h2>
          {contactUnlocked && !hasContact ? (
            <p className="mt-3 rounded-xl bg-tm-bg p-4 text-xs text-gray-500">
              {isSelf
                ? 'You have not verified a phone number yet. Add one from your dashboard so Featured parents can reach you.'
                : 'This tutor has not added a phone number yet. Request a demo and they will reply here.'}
            </p>
          ) : contact && hasContact ? (
            <div className="space-y-2 pt-3">
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  className="flex min-h-[44px] items-center gap-2 text-sm font-bold text-tm-navy"
                >
                  <Phone size={16} className="text-gray-500" />
                  {contact.phone}
                </a>
              )}
              {contact.whatsapp && (
                <a
                  href={`https://wa.me/${contact.whatsapp.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                    `Assalam-o-Alaikum ${tutor.full_name}, I found your profile on TutorMint and would like to discuss tuition.`,
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[44px] items-center gap-2 text-sm font-bold text-tm-green-deep"
                >
                  <MessageCircle size={16} />
                  WhatsApp {contact.whatsapp}
                </a>
              )}
              {isSelf && (
                <p className="text-[11px] text-gray-500">
                  This is your own profile. Featured parents see these details.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-3 rounded-xl bg-tm-bg p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-xs font-semibold text-gray-500">
                <Lock size={14} />
                Phone and WhatsApp are hidden
              </p>
              {/* Opens the upgrade sheet rather than linking straight to a
                  priced page: the sheet is where a price is allowed to appear,
                  and it fetches one only once this is pressed. */}
              <UpgradeTrigger
                reason="parent_contact"
                intent="message"
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-gold px-4 text-xs font-black text-tm-navy"
              >
                Unlock with Featured
              </UpgradeTrigger>
            </div>
          )}
        </section>

        {/* -------------------------------------------------------- video --- */}
        {tutor.video_youtube_id && (
          <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
            <h2 className="pb-3 text-sm font-black text-tm-navy">Video introduction</h2>
            <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${tutor.video_youtube_id}`}
                title={`${tutor.full_name} introduction`}
                allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
                allowFullScreen
                className="h-full w-full"
              />
            </div>
          </section>
        )}

        {/* ---------------------------------------------------------- bio --- */}
        {tutor.bio && (
          <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
            <h2 className="pb-2 text-sm font-black text-tm-navy">About</h2>
            <p className="whitespace-pre-line text-xs leading-relaxed">{tutor.bio}</p>
          </section>
        )}

        {/* ----------------------------------------------------- subjects --- */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
          <h2 className="pb-3 text-sm font-black text-tm-navy">Subjects and levels</h2>
          {byLevel.size === 0 ? (
            <p className="text-xs text-gray-500">Subjects are being added.</p>
          ) : (
            <div className="space-y-3">
              {[...byLevel.entries()].map(([level, subjects]) => (
                <div key={level} className="space-y-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                    {levelLabel(level)}
                  </p>
                  {/* Every mention of a thing links to the thing. A
                      level-leaf (Test Preparation, Sports, Holy Quran) has no
                      subject list, so the level itself is the selectable item
                      and the chip is the link. */}
                  <div className="flex flex-wrap gap-1.5">
                    {subjects.length === 0 ? (
                      <Link
                        href={subjectHref(levelMaster.get(level) ?? 0)}
                        className="rounded-full bg-tm-bg px-2.5 py-1 text-[11px] font-bold text-slate-700 ring-1 ring-gray-200 hover:ring-tm-navy"
                      >
                        {levelLabel(level.split(' — ')[1] ?? level)}
                      </Link>
                    ) : (
                      subjects.map((s) => (
                        <Link
                          key={s.masterId}
                          href={subjectHref(s.masterId)}
                          className="rounded-full bg-tm-bg px-2.5 py-1 text-[11px] font-bold text-slate-700 ring-1 ring-gray-200 hover:ring-tm-navy"
                        >
                          {s.label}
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ------------------------------------------------------ degrees --- */}
        {(tutor.degrees?.length ?? 0) > 0 || tutor.degree_documents.length > 0 ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
            <h2 className="pb-3 text-sm font-black text-tm-navy">Qualifications</h2>
            <ul className="space-y-1.5">
              {(tutor.degrees ?? []).map((d) => (
                <li key={d} className="text-xs font-semibold text-tm-navy">
                  {d}
                </li>
              ))}
            </ul>

            {tutor.degree_documents.length > 0 && (
              <div className="pt-4">
                <p className="pb-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  Certificates
                </p>
                {user ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {tutor.degree_documents.map((doc) => (
                      <SecureDocumentPreview
                        key={doc.id}
                        documentId={doc.id}
                        alt={doc.label ?? 'Degree certificate'}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl bg-tm-bg p-3 text-xs text-gray-500">
                    <Link href="/login" className="font-bold text-tm-red hover:underline">
                      Sign in
                    </Link>{' '}
                    to view {tutor.degree_documents.length} uploaded certificate
                    {tutor.degree_documents.length === 1 ? '' : 's'}.
                  </p>
                )}
                <p className="pt-2 text-[10px] leading-relaxed text-gray-500">
                  Certificates are shown as watermarked previews and are protected against casual
                  copying. Originals are never published.
                </p>
              </div>
            )}
          </section>
        ) : null}

        {/* ------------------------------------------------- availability --- */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
          <h2 className="pb-3 text-sm font-black text-tm-navy">Availability</h2>
          {tutor.slots.length === 0 ? (
            <p className="text-xs text-gray-500">
              No fixed slots published. Request a demo and agree a time directly.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tutor.slots.map((s) => (
                <span
                  key={s.id}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${
                    s.booked
                      ? 'bg-gray-100 text-gray-700 ring-gray-200 line-through'
                      : 'bg-tm-bg text-tm-navy ring-gray-200'
                  }`}
                >
                  {s.text}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* ------------------------------------------------------ reviews --- */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
          <h2 className="pb-3 text-sm font-black text-tm-navy">
            Reviews {reviews > 0 ? `(${reviews})` : ''}
          </h2>
          {tutor.reviews.length === 0 ? (
            <p className="text-xs text-gray-500">
              No written reviews yet. Reviews are left by parents after a tuition.
            </p>
          ) : (
            <ul className="space-y-4">
              {tutor.reviews.map((r) => (
                <li key={r.id} className="space-y-1 border-b border-gray-100 pb-3 last:border-0">
                  <p className="text-xs font-black text-tm-navy">
                    ★ {Number(r.rating).toFixed(1)}{' '}
                    <span className="font-semibold text-gray-500">· {r.reviewer}</span>
                  </p>
                  {r.comment && <p className="text-xs leading-relaxed">{r.comment}</p>}
                  <p className="text-[10px] text-gray-500">
                    {formatDate(r.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Reporting a profile. Signed-in only: an anonymous report has nobody
            to ask about it, and a moderator needs to be able to see who filed
            it when the same profile is reported five times in an hour. */}
        {user && !isSelf && (
          <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
            <ReportButton reportedId={tutor.id} targetType="profile" label="Report this profile" />
          </section>
        )}
      </div>

      {/* Sticky primary actions on mobile, inline from sm. */}
      <ProfileActions
        tutorId={tutor.id}
        tutorName={tutor.full_name}
        signedIn={!!user}
        isSelf={isSelf}
        initiallySaved={saved}
        canMessage={!ent || ent.audience !== 'tutor'}
      />
    </main>
  )
}
