'use client'

import { postGated } from '@/lib/gatedFetch'
import TimeAgo from '@/components/TimeAgo'
import { budgetLabel } from '@/lib/feeBands'
import { tuitionPath } from '@/lib/slugs'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { useToast } from '@/components/ui/Toast'
import Link from 'next/link'
import { useState } from 'react'
import { Building2, Clock, FileText, GraduationCap, MapPin, Wallet } from 'lucide-react'
import BadgeRow from '@/components/badges/BadgeRow'
import OnlineSuitableChip from '@/components/OnlineSuitableChip'
import { showsOnlineChip } from '@/lib/matchChip'
import { teachingMode } from '@/lib/display'
import FeaturedTag from '@/components/badges/FeaturedTag'
import Avatar from '@/components/Avatar'
import AuthGateModal from '@/components/AuthGateModal'
import ReportButton from '@/components/ReportButton'
import type { BadgeName } from '@/lib/planBadges'

// A posted tuition, in the same card language as TutorCard.
//
// The parent's badges are shown because tutors have asked for exactly one
// thing: to know before they spend an application whether the person on the
// other end can actually hire. Only a Featured parent can complete a hire, so
// `parentCanHire` is surfaced as plain words, not a colour.
//
// Applying happens here: guests get the sign-in modal with the job kept as a
// draft, and a signed-in tutor's press goes straight to /api/applications,
// which re-checks every gate (listed, not blocked, job open, not already
// applied, quota). The button never decides anything -- it only reports what
// the server said, including the upgrade path when the refusal is a quota one.

export type JobCardData = {
  id: string
  job_tx_id: string | null
  /** The public tuition page's address. Set once at posting, never changes. */
  public_slug: string | null
  status: string
  title: string
  subjects: string[] | null
  /**
   * The same subjects with their taxonomy_master ids, so each chip links to
   * the tutors who teach that exact level-and-subject. Empty for a job posted
   * before the join table existed, whose subjects survive only as text.
   */
  subject_links?: { label: string; masterId: number; href?: string }[]
  class_level: string | null
  city: string | null
  area: string | null
  teaching_mode: string | null
  budget_pkr: number | null
  budget_min_pkr?: number | null
  budget_max_pkr?: number | null
  description: string | null
  created_at: string
  is_featured: boolean | null
  parent_id: string | null
  parent_name: string | null
  parent_avatar_url: string | null
  parent_badges: BadgeName[]
  parent_can_hire: boolean
}

export default function JobCard({
  job,
  href,
  signedIn = false,
  showApply = false,
  applied = false,
  viewerCity = null,
}: {
  job: JobCardData
  href?: string
  signedIn?: boolean
  /** Rendered for tutors and guests; a parent browsing their own board has no use for it. */
  showApply?: boolean
  /** This tutor has already applied. */
  applied?: boolean
  /**
   * The viewing tutor's own city, when the viewer is a signed-in tutor. Used
   * only to show the "Suitable for online" chip on a cross-city online job.
   * Null for guests and parents — no chip, the board still shows every job.
   */
  viewerCity?: string | null
}) {
  const upgradeSheet = useUpgradeSheet()
  const toast = useToast()
  const [gateOpen, setGateOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'done'>(applied ? 'done' : 'idle')
  const [notice, setNotice] = useState<string | null>(null)
  // The tuition's own page. Until migration 40 there was none, and every
  // "View details" on the platform went to the unfiltered browse list --
  // which is to say, back to the page the reader was already on.
  const detailHref = href ?? tuitionPath(job)

  const apply = async () => {
    if (!signedIn) return setGateOpen(true)
    setState('sending')
    setNotice(null)
    try {
      const r = await postGated('/api/applications', { jobId: job.id }, upgradeSheet?.showGate)
      if (r.ok) {
        setState('done')
        setNotice('Application sent.')
        toast.success('Application sent.')
      } else {
        // A gate has already been explained by the sheet. Repeating it as a
        // red line under the button says the same thing twice and reads as a
        // second, different problem.
        setNotice(r.gated ? null : r.error)
        if (!r.gated) toast.error(r.error)
        setState('idle')
      }
    } catch {
      setNotice('Could not send your application.')
      toast.error('Could not send your application.')
      setState('idle')
    }
  }

  return (
    <>
      <article className="relative rounded-2xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md sm:p-6">
        {job.is_featured && <FeaturedTag className="absolute right-3 top-3 sm:right-4 sm:top-4" />}

        <div className="space-y-3">
          <div className="space-y-1 pr-16 sm:pr-20">
            <h3 className="text-base font-black leading-snug text-tm-navy sm:text-lg">
              {/* min-h-[44px], not py-0.5: the title is the thing people tap on
                  a card, and at a 22px line box it was half the minimum target.
                  inline-flex rather than block so a two-line title still wraps
                  and the box grows with it. */}
              <Link
                href={detailHref}
                className="inline-flex min-h-[44px] items-center py-1 hover:underline"
              >
                {job.title}
              </Link>
            </h3>
            {/* Who posted it. The avatar is here because a job board of
                identical cards gives a tutor nothing to recognise between
                visits, and a face is what people actually remember. It is a
                picture, not contact information -- the number, WhatsApp and
                email stay behind canViewContact. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
              {job.parent_name && (
                <Avatar
                  name={job.parent_name}
                  src={job.parent_avatar_url}
                  seed={job.parent_id}
                  decorative
                  ring="border border-gray-200"
                  className="h-7 w-7 text-[10px]"
                />
              )}
              <Clock size={12} className="shrink-0" />
              <TimeAgo iso={job.created_at} />
              {job.parent_name && (
                <>
                  <span aria-hidden="true">·</span>
                  {/* Every member name is a link. relative z-10 so the card's
                      own stretched link does not swallow it -- same reason the
                      four buttons on a TutorCard carry it. */}
                  {job.parent_id ? (
                    <Link
                      href={`/parent/${job.parent_id}`}
                      className="relative z-10 inline-flex min-h-[24px] items-center font-semibold text-slate-700 hover:text-tm-red hover:underline"
                    >
                      {job.parent_name}
                    </Link>
                  ) : (
                    <span className="font-semibold text-slate-700">{job.parent_name}</span>
                  )}
                </>
              )}
              {job.parent_badges.length > 0 && <BadgeRow badges={job.parent_badges} size="sm" />}
            </div>
          </div>

          {job.subjects && job.subjects.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {job.subjects.map((s) => {
                const link = job.subject_links?.find((l) => l.label === s)
                const cls =
                  'rounded-full bg-tm-bg px-2.5 py-1 text-[11px] font-bold text-slate-700 ring-1 ring-gray-200'
                // Every mention of a thing links to the thing. relative z-10 for
                // the same reason the parent's name carries it -- the card's own
                // links must not swallow it.
                return link ? (
                  <Link
                    key={s}
                    href={
                      link.href ??
                      `/browse/tutors?subject=${link.masterId}${job.city ? `&city=${encodeURIComponent(job.city)}` : ''}`
                    }
                    className={`${cls} relative z-10 hover:ring-tm-navy`}
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

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {job.class_level && (
              <p className="flex items-center gap-2 text-xs text-slate-700">
                <GraduationCap size={14} className="shrink-0 text-gray-500" />
                {job.class_level}
              </p>
            )}
            <p className="flex items-center gap-2 text-xs text-slate-700">
              <MapPin size={14} className="shrink-0 text-gray-500" />
              {[job.area, job.city].filter(Boolean).join(', ') ||
                teachingMode(job.teaching_mode) ||
                'Flexible'}
            </p>
            {teachingMode(job.teaching_mode) && (
              <p className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                <Building2 size={14} className="shrink-0 text-gray-500" />
                {teachingMode(job.teaching_mode)}
                {showsOnlineChip(job.city, job.teaching_mode, viewerCity) && <OnlineSuitableChip />}
              </p>
            )}
            {/* The BAND the parent chose, when there is one. Rendering only
                its lower bound would under-state a band-posted job by up to
                ten thousand rupees. */}
            {budgetLabel(job.budget_min_pkr, job.budget_max_pkr, job.budget_pkr) ? (
              <p className="flex items-center gap-2 text-xs font-black text-tm-navy">
                <Wallet size={14} className="shrink-0 text-gray-500" />
                {budgetLabel(job.budget_min_pkr, job.budget_max_pkr, job.budget_pkr)} / month
              </p>
            ) : null}
          </div>

          {job.description && (
            <p className="line-clamp-2 text-xs leading-relaxed text-slate-700">{job.description}</p>
          )}

          {/* Tutor-side steering: say plainly who can finish a hire. */}
          <p className="text-[11px] font-semibold text-gray-500">
            {job.parent_can_hire
              ? 'Featured parent — can complete a hire'
              : 'Verified parent — cannot complete a hire yet'}
          </p>

          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Link
              href={detailHref}
              className="gap-1.5 inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 bg-tm-bg px-4 text-xs font-bold text-slate-700 transition-colors hover:bg-gray-100"
            >
              <FileText aria-hidden size={14} />
              View details
            </Link>
            {showApply && (
              <button
                type="button"
                onClick={apply}
                disabled={state !== 'idle'}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover disabled:bg-gray-300"
              >
                {state === 'done' ? 'Applied' : state === 'sending' ? 'Sending…' : 'Apply'}
              </button>
            )}
          </div>

          {/* Reporting a post is only meaningful once signed in -- an
              anonymous report has nobody to answer questions about it. */}
          {signedIn && job.parent_id && (
            <ReportButton
              reportedId={job.parent_id}
              targetType="job"
              targetId={job.id}
              label="Report this post"
            />
          )}

          {/* Plain outcomes only. Anything a plan or a suspension caused is
              now the upgrade sheet's job, so there is no second 'See options'
              link competing with it. */}
          {notice && (
            <p className="text-[11px] font-semibold leading-snug text-slate-700">{notice}</p>
          )}
        </div>
      </article>

      <AuthGateModal
        open={gateOpen}
        intent="apply"
        draft={{ jobId: job.id, title: job.title }}
        onClose={() => setGateOpen(false)}
      />
    </>
  )
}
