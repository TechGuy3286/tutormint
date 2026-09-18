'use client'

import { postGated } from '@/lib/gatedFetch'
import { armEscape, submitSignal } from '@/lib/submit'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { useToast } from '@/components/ui/Toast'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BookOpen, Briefcase, MapPin, Building2, Heart, Play, Mail, Star, Eye, Handshake, BadgeCheck, X } from 'lucide-react'
import JobTypesChip from '@/components/JobTypesChip'
import CardActions, { type CardAction } from '@/components/CardActions'
import Avatar from '@/components/Avatar'
import BadgeRow from '@/components/badges/BadgeRow'
import NotVerifiedBadge from '@/components/badges/NotVerifiedBadge'
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
  job_types: string[] | null
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
  /**
   * Whether a reviewed degree is on file. The Verified badge is degree-gated for
   * tutors (owner, 10 Sep 2026): a paid, listed tutor without one is shown, but
   * carries no Verified badge. Optional; absent means "assume yes" so surfaces
   * that do not carry the signal are unchanged.
   */
  has_degree?: boolean
  /**
   * PR16 §1.2/§1.3 — has this tutor paid the one-time verification fee? A verified
   * tutor shows the Verified badge (and any plan badge); a visible-but-unverified
   * tutor shows the neutral "Not verified" chip and no Verified badge. Optional;
   * absent means "assume verified" so surfaces that do not carry the signal (and
   * cards known to be verified) are unchanged.
   */
  verified?: boolean
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
      prefetch={false}
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
  hideShortlist = false,
  showHire = false,
  hired = false,
  onRemove,
  removeBusy = false,
}: {
  tutor: TutorCardData
  viewer?: CardViewer
  initiallySaved?: boolean
  /** Shown to guests and to parents; a tutor browsing tutors cannot message them. */
  showMessage?: boolean
  /**
   * Omit the Shortlist toggle. Used on the parent's own "Shortlisted tutors"
   * section, where removal is the top-right X (below) — so an in-card toggle
   * that silently un-saves would be a second, confusing path.
   */
  hideShortlist?: boolean
  /** Add a Hire action to the button grid (parent's shortlist card, PR26 §1.2). */
  showHire?: boolean
  /** This parent has already hired this tutor — Hire reads "Hired" (§1). */
  hired?: boolean
  /** When set, a small X at the top-right removes the card (parent shortlist, §1.3). */
  onRemove?: () => void
  removeBusy?: boolean
}) {
  const router = useRouter()
  const [saved, setSaved] = useState(initiallySaved)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [gateOpen, setGateOpen] = useState(false)
  const [gateIntent, setGateIntent] = useState<AuthIntent>('shortlist')
  const upgradeSheet = useUpgradeSheet()
  const toast = useToast()

  const profileHref = tutor.slug ? `/tutor/${tutor.slug}` : '#'
  // PR16 §1.2/§1.3 — badges turn on the verification fee. `verified` absent means
  // "assume verified" (surfaces that pre-date the signal). A fee-paid Basic tutor
  // has no subscription (plan_code null), so synthesise 'basic' for the badge.
  const isVerified = tutor.verified ?? true
  const effectivePlan = tutor.plan_code ?? (isVerified ? 'basic' : null)
  const badges = isVerified ? badgesForPlan(effectivePlan, true, tutor.has_degree ?? true) : []
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
      toast.success(json.saved ? 'Added to your shortlist.' : 'Removed from your shortlist.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update your shortlist.')
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
      const msg = `Demo requested. ${tutor.full_name.split(' ')[0]} will reply with a time.`
      setNotice(msg)
      toast.success(msg)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send your demo request.')
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
    if (!r.gated) {
      setNotice(r.error)
      toast.error(r.error)
    }
    setBusy(false)
  }

  // Hire (parent shortlist card, §1.2). Non-Featured → the parent_hire upgrade
  // sheet (price on the sheet, fetched on the tap). Featured → the existing
  // per-application hire flow (Posted tuitions); no jobless direct hire exists.
  const onHire = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/gate', {
        signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'parent_hire' }),
      })
      const json = (await res.json().catch(() => ({}))) as { gate?: import('@/lib/gate').Gate | null }
      if (json.gate && upgradeSheet?.showGate) {
        upgradeSheet.showGate(json.gate)
        return
      }
      toast.success('Open a posted tuition to hire a tutor from its interested tutors.')
      router.push('/parent/dashboard/jobs')
    } catch {
      toast.error('Could not open hire. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <article className="relative rounded-2xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md sm:p-6">
        {isFeaturedPlan(tutor.plan_code) && (
          // Shifts left of the remove X on a shortlist card so the two never overlap.
          <FeaturedTag
            className={`absolute top-3 sm:top-4 ${onRemove ? 'right-12 sm:right-14' : 'right-3 sm:right-4'}`}
          />
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={removeBusy}
            aria-label={`Remove ${tutor.full_name} from your shortlist`}
            data-tip="Remove from shortlist"
            className="absolute right-2 top-2 z-20 grid h-9 w-9 place-items-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors hover:border-tm-red hover:text-tm-red disabled:opacity-60"
          >
            <X aria-hidden size={16} />
          </button>
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
                prefetch={false}
                href={profileHref}
                className="inline-flex min-h-[44px] items-center py-0.5 after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-navy"
              >
                {tutor.full_name}
              </Link>
            </h3>
            {/* PR17 §2 — the stars, "New tutor", the Verified/Premium/Featured
                badges and the red "Not verified" badge all sit on ONE line. The
                job-type chip stays on its own line below. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Stars rating={rating} count={reviews} />
              {badges.length > 0 && <BadgeRow badges={badges} size="sm" />}
              {!isVerified && <NotVerifiedBadge />}
            </div>
            {tutor.headline && (
              <p className="line-clamp-2 text-xs font-semibold text-tm-green-deep">{tutor.headline}</p>
            )}
          </div>

          <div className="col-span-2 space-y-2 sm:col-span-1 sm:col-start-2 sm:row-start-2">
            {/* Job type on its own line (§2.2). */}
            <JobTypesChip types={tutor.job_types} />

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
                value={tutor.area || 'Flexible'}
              >
                {tutor.area && tutor.city ? (
                  <InlineLink
                    href={`/browse/tutors?city=${encodeURIComponent(tutor.city)}&area=${encodeURIComponent(tutor.area)}`}
                  >
                    {tutor.area}
                  </InlineLink>
                ) : (
                  tutor.area || 'Flexible'
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
            {/* Four visible actions, no hidden menu (PR25 §3): View Profile,
                Message, Demo, Shortlist as a 2×2 grid — two rows of two on a
                phone, the same grid centred on desktop. A tutor viewer has three
                (no Message). */}
            <CardActions
              actions={
                [
                  {
                    key: 'view',
                    label: 'View Profile',
                    icon: <Eye size={14} aria-hidden />,
                    className: 'bg-tm-black text-white hover:bg-tm-navy',
                    href: profileHref,
                    tooltip: `View ${tutor.full_name.split(' ')[0]}’s profile`,
                  },
                  ...(showMessage
                    ? [
                        {
                          key: 'message',
                          label: 'Message',
                          icon: <Mail size={14} aria-hidden />,
                          className: 'bg-tm-green-deep text-white hover:bg-tm-green-deep-hover',
                          onClick: onMessage,
                          disabled: busy,
                          tooltip: 'Send a message to this tutor',
                        } as CardAction,
                      ]
                    : []),
                  {
                    key: 'demo',
                    // A parent reads "Demo lesson" (matches the dashboard tile,
                    // §2.1); a guest or tutor keeps the short "Demo".
                    label: viewer.role === 'parent' ? 'Demo lesson' : 'Demo',
                    icon: <Play size={14} aria-hidden />,
                    className: 'bg-tm-red text-white hover:bg-tm-red-hover',
                    onClick: requestDemo,
                    disabled: busy,
                    tooltip: 'Ask for a demo lesson',
                  },
                  ...(hideShortlist
                    ? []
                    : [
                        {
                          key: 'shortlist',
                          label: saved ? 'Shortlisted' : 'Shortlist',
                          icon: <Heart size={14} className={saved ? 'fill-tm-red' : ''} aria-hidden />,
                          className: 'border border-tm-red text-tm-red hover:bg-tm-tint-red',
                          onClick: toggleShortlist,
                          disabled: busy,
                          ariaPressed: saved,
                          tooltip: saved ? 'Remove from your shortlist' : 'Save to your shortlist',
                        } as CardAction,
                      ]),
                  // Hire, inside the grid (§1.2). Red, never gold (§1.4). A tutor
                  // already hired reads "Hired".
                  ...(showHire
                    ? [
                        hired
                          ? ({
                              key: 'hire',
                              label: 'Hired',
                              icon: <BadgeCheck size={14} aria-hidden />,
                              className: 'bg-tm-tint-green text-tm-green-deep',
                              onClick: () => {},
                              disabled: true,
                            } as CardAction)
                          : ({
                              key: 'hire',
                              label: 'Hire',
                              icon: <Handshake size={14} aria-hidden />,
                              // Navy (§1.1). Gold stays reserved for Featured.
                              className: 'bg-tm-navy text-white hover:bg-tm-navy-hover',
                              onClick: onHire,
                              disabled: busy,
                              tooltip: 'Hire this tutor',
                            } as CardAction),
                      ]
                    : []),
                ] as CardAction[]
              }
            />

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
