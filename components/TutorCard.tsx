'use client'

import { useState } from 'react'
import Link from 'next/link'
import { BookOpen, Briefcase, MapPin, Building2, Heart, Play, Mail, Star } from 'lucide-react'
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
              i < Math.round(rating) ? 'fill-[#F59E0B] text-[#F59E0B]' : 'fill-gray-200 text-gray-200'
            }
          />
        ))}
      </span>
      <span className="text-[11px] font-bold text-[#334155]">
        {count > 0 ? (
          <>
            {rating.toFixed(1)}
            <span className="font-normal text-gray-400"> ({count})</span>
          </>
        ) : (
          <span className="font-normal text-gray-400">New tutor</span>
        )}
      </span>
    </span>
  )
}

function DetailLine({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <p className="flex items-start gap-2 text-xs leading-snug text-[#334155]">
      <span className="mt-px shrink-0 text-gray-400">{icon}</span>
      <span className="min-w-0">
        <span className="font-bold text-[#0F172A]">{label}:</span> <span>{value}</span>
      </span>
    </p>
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

  const profileHref = tutor.slug ? `/tutor/${tutor.slug}` : '#'
  const badges = badgesForPlan(tutor.plan_code, true)
  const rating = Number(tutor.rating_avg ?? 0)
  const reviews = tutor.rating_count ?? 0

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
      const res = await fetch('/api/shortlist', {
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
      const res = await fetch('/api/demo/request', {
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
    try {
      const res = await fetch('/api/messages/thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otherId: tutor.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not open the conversation.')
      window.location.href = `/messages/${json.threadId}`
    } catch (e) {
      // The refusal text from the server is the useful part -- an unverified
      // parent is told to verify, not just told no.
      setNotice(e instanceof Error ? e.message : 'Could not open the conversation.')
      setBusy(false)
    }
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
            {tutor.avatar_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={tutor.avatar_url}
                alt={tutor.full_name}
                className="h-[72px] w-[72px] rounded-full border-2 border-gray-100 bg-[#F8FAFC] object-cover sm:h-[140px] sm:w-[140px]"
              />
            ) : (
              /* Initials rather than a stock photo: a placeholder face on a
                 tutor profile is a small lie about a real person. */
              <div
                aria-hidden="true"
                className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-2 border-gray-100 bg-[#F8FAFC] text-lg font-black text-[#0F172A] sm:h-[140px] sm:w-[140px] sm:text-3xl"
              >
                {tutor.full_name
                  .split(' ')
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((w) => w[0])
                  .join('')
                  .toUpperCase()}
              </div>
            )}
          </div>

          <div className="col-start-2 row-start-1 min-w-0 space-y-1.5 pr-16 sm:pr-20">
            <h3 className="truncate text-base font-black text-[#0F172A] sm:text-lg">
              <Link href={profileHref} className="hover:underline">
                {tutor.full_name}
              </Link>
            </h3>
            <Stars rating={rating} count={reviews} />
            {tutor.headline && (
              <p className="line-clamp-2 text-xs font-semibold text-[#059669]">{tutor.headline}</p>
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
              <DetailLine icon={<BookOpen size={14} />} label="Subjects" value={subjects} />
              <DetailLine icon={<Briefcase size={14} />} label="Experience" value={experience} />
              <DetailLine
                icon={<MapPin size={14} />}
                label="Area"
                value={tutor.area || tutor.teaching_mode || 'Flexible'}
              />
              <DetailLine
                icon={<Building2 size={14} />}
                label="City"
                value={tutor.city || 'Online'}
              />
            </div>

            {tutor.hourly_rate_pkr ? (
              <p className="pt-0.5 text-xs font-black text-[#0F172A]">
                Rs. {tutor.hourly_rate_pkr.toLocaleString('en-PK')}
                <span className="font-semibold text-gray-400"> / month</span>
              </p>
            ) : null}
          </div>

          <div className="col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-3">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Link
                href={profileHref}
                className={`${btn} bg-[#0F172A] text-white hover:bg-[#1E293B]`}
              >
                View Profile
              </Link>

              <button
                type="button"
                onClick={toggleShortlist}
                disabled={busy}
                aria-pressed={saved}
                className={`${btn} border border-[#d60008] text-[#d60008] hover:bg-red-50`}
              >
                <Heart size={14} className={saved ? 'fill-[#d60008]' : ''} />
                {saved ? 'Shortlisted' : 'Shortlist'}
              </button>

              <button
                type="button"
                onClick={requestDemo}
                disabled={busy}
                className={`${btn} bg-[#d60008] text-white hover:bg-red-700`}
              >
                <Play size={14} className="fill-white" />
                Demo
              </button>

              {showMessage && (
                <button
                  type="button"
                  onClick={onMessage}
                  disabled={busy}
                  className={`${btn} bg-[#059669] text-white hover:bg-emerald-700`}
                >
                  <Mail size={14} />
                  Send Message
                </button>
              )}
            </div>

            {notice && (
              <p className="pt-2 text-[11px] font-semibold leading-snug text-[#334155]">{notice}</p>
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
