'use client'

import { postGated } from '@/lib/gatedFetch'
import { armEscape, submitSignal } from '@/lib/submit'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { useState } from 'react'
import Link from 'next/link'
import { BookOpen, Briefcase, MapPin, Building2, Heart, Play, Mail, Star } from 'lucide-react'
import { teachingMode } from '@/lib/display'
import Avatar from '@/components/Avatar'
import BadgeRow from '@/components/badges/BadgeRow'
import FeaturedTag from '@/components/badges/FeaturedTag'
import AuthGateModal, { type AuthIntent } from '@/components/AuthGateModal'
import { badgesForPlan, isFeaturedPlan } from '@/lib/planBadges'

// The tutor card, rebuilt against design/reference/tutor-card.jpeg.
//
// Mobile (360px up): 72px avatar with the name and stars beside it, badges
// below, then the four detail lines, then buttons two-up. Desktop: 140px
// avatar on the left, everything else in a column on the right, buttons in a
// single row -- exactly the reference.
//
// Two rules this component must never break:
//
//   * No contact details. There is no phone or WhatsApp field in the props at
//     all, so the card cannot leak one by accident. Contact appears on the
//     profile page only, and only when the viewer's entitlements allow it.
//
//   * No badge the entitlements layer has not granted. Badges are derived
//     from the plan code the ranking function returned, and every listed tutor
//     is at 100% completion by definition of tutor_directory.

export type TutorCardData = {
  id: string
  slug: string | null
  full_name: string
  headline: string | null
  avatar_url: string | null
  city: string | null
  area: string | null
  teaching_mode: string | null
  hourly_rate_pkr: number | null
  experience_years: number | null
  rating_avg: number | string | null
  rating_count: number | null
  subject_labels: string[] | null
  /**
   * The same subjects with their taxonomy_master ids, so each one links to the
   * tutors who teach that exact level-and-subject. Matching everywhere on this
   * platform is on master_id, so a link built from the label alone would be a
   * text search dressed up as a filter.
   */
  subject_links?: { label: string; masterId: number; href?: string }[]
  plan_code: string | null
}

export type CardViewer = {
  signedIn: boolean
  /** parent | tutor | academy | admin */
  role: string | null
  /** Verified-or-better parent: may request a demo. */
  verifiedParent: boolean
  canInitiateMessage: boolean
}

const GUEST: CardViewer = {
  signedIn: false,
  role: null,
  verifiedParent: false,
  canInitiateMessage: false,
}

function Stars({ rating, count }: { rating: number; count: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star
            key={i}
            size={14}
            className={
              i < Math.round(rating) ? 'fill-tm-gold stroke-tm-gold' : 'fill-gray-200 stroke-gray-200'
            }
          />
        ))}
      </span>
      <span className="text-[11px] font-bold text-slate-700">
        {count > 0 ? (
          <>
            {rating.toFixed(1)}
            <span className="font-normal text-gray-500"> ({count})</span>
          </>
        ) : (
          <span className="font-normal text-gray-500">New tutor</span>
        )}
      </span>
    </span>
  )
}

function DetailLine({
  icon,
  label,
  value,
  children,
}: {
  icon: React.ReactNode
  label: string
  value?: string
  /** Linked content, when the value names something with a page of its own. */
  children?: React.ReactNode
}) {
  return (
    <p className="flex items-start gap-2 text-xs leading-snug text-slate-700">
      <span className="mt-px shrink-0 text-gray-500">{icon}</span>
      <span className="min-w-0">
        <span className="font-bold text-tm-navy">{label}:</span>{' '}
        <span>{children ?? value}</span>
      </span>
    </p>
  )
}

/**
 * A link that must survive the card's own stretched link.
 *
 * relative z-10 for the same reason the four action buttons carry it: the card
 * is clickable as a whole, and without it every inner link is swallowed.
 */
function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="relative z-10 font-semibold text-slate-700 underline decoration-gray-200 underline-offset-2 hover:text-tm-red hover:decoration-tm-red"
    >
      {children}
    </Link>
  )
}

export default function TutorCard({
  tutor,
  viewer = GUEST,
  initiallySaved = false,
  showMessage = false,
}: {
  tutor: TutorCardData
  viewer?: CardViewer
  initiallySaved?: boolean
  /** Shown to guests and to parents; a tutor browsing tutors cannot message them. */
  showMessage?: boolean
}) {
  const [saved, setSaved] = useState(initiallySaved)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [gateOpen, setGateOpen] = useState(false)
  const [gateIntent, setGateIntent] = useState<AuthIntent>('shortlist')
  const upgradeSheet = useUpgradeSheet()

  const profileHref = tutor.slug ? `/tutor/${tutor.slug}` : '#'
  const badges = badgesForPlan(tutor.plan_code, true)
  const rating = Number(tutor.rating_avg ?? 0)
  const reviews = tutor.rating_count ?? 0

  const links = tutor.subject_links ?? []
  const subjects =
    tutor.subject_labels && tutor.subject_labels.length > 0
      ? tutor.subject_labels.join(', ')
      : 'Subjects being added'

  const experience =
    tutor.experience_years && tutor.experience_years > 0
      ? `${tutor.experience_years} year${tutor.experience_years === 1 ? '' : 's'}`
      : 'New to TutorMint'

  const gate = (intent: AuthIntent) => {
    setGateIntent(intent)
    setGateOpen(true)
  }

  const toggleShortlist = async () => {
    if (!viewer.signedIn) return gate('shortlist')
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/shortlist', { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorId: tutor.id, action: saved ? 'remove' : 'add' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not update your shortlist.')
      setSaved(json.saved)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not update your shortlist.')
    } finally {
      setBusy(false)
    }
  }

  const requestDemo = async () => {
    if (!viewer.signedIn) return gate('demo')
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/demo/request', { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorId: tutor.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send your demo request.')
      setNotice(`Demo requested. ${tutor.full_name.split(' ')[0]} will reply with a time.`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not send your demo request.')
    } finally {
      setBusy(false)
    }
  }

  const onMessage = async () => {
    if (!viewer.signedIn) return gate('message')
    setBusy(true)
    setNotice(null)
    const r = await postGated<{ threadId: string }>(
      '/api/messages/thread',
      { otherId: tutor.id },
      upgradeSheet?.showGate,
    )
    if (r.ok) {
      // A full navigation, so the spinner is meant to end with the page. It is
      // still given a deadline: a browser that blocks or loses the assignment
      // would otherwise leave this button disabled with the thread already
      // created and no way to reach it.
      const href = `/messages/${r.data.threadId}`
      armEscape(() => {
        setBusy(false)
        setNotice('Your conversation is ready — open Messages to continue.')
      })
      window.location.href = href
      return
    }
    // A plan or verification refusal is the sheet's to explain, with the tap
    // that resolves it. Only genuine failures land in the notice line.
    if (!r.gated) setNotice(r.error)
    setBusy(false)
  }

  const btn =
    'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold transition-colors disabled:opacity-60'

  return (
    <>
      <article className="relative rounded-2xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md sm:p-6">
        {isFeaturedPlan(tutor.plan_code) && (
          <FeaturedTag className="absolute right-3 top-3 sm:right-4 sm:top-4" />
        )}

        <div className="grid grid-cols-[72px_1fr] items-start gap-x-4 gap-y-4 sm:grid-cols-[140px_1fr] sm:gap-x-6">
          {/* Avatar spans the whole card on desktop, one row on mobile. */}
          <div className="col-start-1 row-start-1 row-span-1 sm:row-span-3">
            {/* Initials rather than a stock photo: a placeholder face on a
                tutor profile is a small lie about a real person. */}
            <Avatar
              name={tutor.full_name}
              src={tutor.avatar_url}
              seed={tutor.id}
              decorative
              className="h-[72px] w-[72px] text-lg sm:h-[140px] sm:w-[140px] sm:text-3xl"
            />
          </div>

          <div className="col-start-2 row-start-1 min-w-0 space-y-1.5 pr-16 sm:pr-20">
            <h3 className="truncate text-base font-black text-tm-navy sm:text-lg">
              {/* THE WHOLE CARD IS THIS LINK.
                  `after:absolute after:inset-0` stretches an invisible overlay
                  from the name across the entire (relative) article, so a tap
                  anywhere that is not a control opens the profile. It is done
                  from the name rather than by wrapping the card in an <a>
                  because a link may not contain buttons — nesting them is
                  invalid HTML and browsers recover from it unpredictably.
                  It is also ONE tab stop: the card announces itself as the
                  tutor's name and the four controls follow it in order. */}
              <Link
                href={profileHref}
                className="inline-flex min-h-[44px] items-center py-0.5 after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-navy"
              >
                {tutor.full_name}
              </Link>
            </h3>
            <Stars rating={rating} count={reviews} />
            {tutor.headline && (
              <p className="line-clamp-2 text-xs font-semibold text-tm-green-deep">{tutor.headline}</p>
            )}
          </div>

          <div className="col-span-2 space-y-2 sm:col-span-1 sm:col-start-2 sm:row-start-2">
            {badges.length > 0 && (
              <>
                {/* Icons only on the narrowest screens, icon + label from sm.
                    The visibility class goes on a WRAPPER, not on BadgeRow
                    itself: BadgeRow's own `inline-flex` and a passed `hidden`
                    are both display utilities, and which one wins depends on
                    stylesheet order, not on the order they are written. Both
                    rows rendered at 360px until this was wrapped. */}
                <span className="block sm:hidden">
                  <BadgeRow badges={badges} size="sm" />
                </span>
                <span className="hidden sm:block">
                  <BadgeRow badges={badges} size="md" showLabel />
                </span>
              </>
            )}

            <div className="space-y-1.5 pt-0.5">
              {/* Every mention of a thing links to the thing: each subject to
                  the tutors who teach it, the area and the city to that slice
                  of the directory. Falls back to plain text when there is no
                  id to link with -- a profile whose subjects predate the join
                  table, or a tutor teaching online with no city. */}
              <DetailLine icon={<BookOpen size={14} />} label="Subjects" value={subjects}>
                {links.length > 0
                  ? links.map((l, i) => (
                      <span key={l.masterId}>
                        {i > 0 && ', '}
                        <InlineLink
                          href={
                            l.href ??
                            `/browse/tutors?subject=${l.masterId}${
                              tutor.city ? `&city=${encodeURIComponent(tutor.city)}` : ''
                            }`
                          }
                        >
                          {l.label}
                        </InlineLink>
                      </span>
                    ))
                  : subjects}
              </DetailLine>
              <DetailLine icon={<Briefcase size={14} />} label="Experience" value={experience} />
              <DetailLine
                icon={<MapPin size={14} />}
                label="Area"
                value={tutor.area || teachingMode(tutor.teaching_mode) || 'Flexible'}
              >
                {tutor.area && tutor.city ? (
                  <InlineLink
                    href={`/browse/tutors?city=${encodeURIComponent(tutor.city)}&area=${encodeURIComponent(tutor.area)}`}
                  >
                    {tutor.area}
                  </InlineLink>
                ) : (
                  (tutor.area || teachingMode(tutor.teaching_mode) || 'Flexible')
                )}
              </DetailLine>
              <DetailLine
                icon={<Building2 size={14} />}
                label="City"
                value={tutor.city || 'Online'}
              >
                {tutor.city ? (
                  <InlineLink href={`/browse/tutors?city=${encodeURIComponent(tutor.city)}`}>
                    {tutor.city}
                  </InlineLink>
                ) : (
                  'Online'
                )}
              </DetailLine>
            </div>

            {tutor.hourly_rate_pkr ? (
              <p className="pt-0.5 text-xs font-black text-tm-navy">
                Rs. {tutor.hourly_rate_pkr.toLocaleString('en-PK')}
                <span className="font-semibold text-gray-500"> / month</span>
              </p>
            ) : null}
          </div>

          <div className="col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-3">
            {/* relative + z-10 lifts every control ABOVE the stretched overlay.
                Without it the overlay swallows Shortlist, Demo and Send
                Message, and all four buttons would silently become "open the
                profile" — the exact failure this pattern is known for. */}
            <div className="relative z-10 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Link
                href={profileHref}
                className={`${btn} bg-tm-black text-white hover:bg-tm-navy`}
              >
                View Profile
              </Link>

              <button
                type="button"
                onClick={toggleShortlist}
                disabled={busy}
                aria-pressed={saved}
                className={`${btn} border border-tm-red text-tm-red hover:bg-tm-tint-red`}
              >
                <Heart size={14} className={saved ? 'fill-tm-red' : ''} />
                {saved ? 'Shortlisted' : 'Shortlist'}
              </button>

              <button
                type="button"
                onClick={requestDemo}
                disabled={busy}
                className={`${btn} bg-tm-red text-white hover:bg-tm-red-hover`}
              >
                <Play size={14} className="fill-white" />
                Demo
              </button>

              {showMessage && (
                <button
                  type="button"
                  onClick={onMessage}
                  disabled={busy}
                  className={`${btn} bg-tm-green-deep text-white hover:bg-tm-green-deep-hover`}
                >
                  <Mail size={14} />
                  Send Message
                </button>
              )}
            </div>

            {notice && (
              <p className="relative z-10 pt-2 text-[11px] font-semibold leading-snug text-slate-700">
                {notice}
              </p>
            )}
          </div>
        </div>
      </article>

      <AuthGateModal
        open={gateOpen}
        intent={gateIntent}
        draft={{ tutorId: tutor.id, tutorName: tutor.full_name }}
        onClose={() => setGateOpen(false)}
      />
    </>
  )
}
